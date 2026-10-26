import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { assessmentControls, assessmentResponses, assessments, controls, intakeFiles } from "@/db/schema";
import { createAssessment, createControlTest, updateAssessmentResponse } from "@/lib/domain/assessments";
import { uploadEvidence } from "@/lib/domain/evidence";
import { requireEngagementAccess } from "@/lib/authorization/service";
import { readEvidenceObject } from "@/lib/ai/storage-reader";
import { latestParsed, markProcessed } from "./store";
import { emit } from "@/lib/workspace/emit";

export interface LoadIssue { row?: number; text: string }
export interface LoadResult { created: number; issues: LoadIssue[]; lines: string[] }

/** The engagement's working assessment, created when the scope is locked. */
export async function ensureAssessment(db: RequestDb, userId: string, engagementId: string, organisationId: string): Promise<string> {
  await requireEngagementAccess(db, userId, engagementId, organisationId);
  const [a] = await db.select({ id: assessments.id }).from(assessments).where(and(eq(assessments.engagementId, engagementId), eq(assessments.status, "draft"))).orderBy(desc(assessments.createdAt)).limit(1);
  if (a) return a.id;
  return (await createAssessment(db, userId, { engagementId, assessmentType: "control_readiness", periodLabel: "FY2026-27" })).id;
}

const RESULT: Record<string, "pass" | "fail" | "exception_noted"> = { pass: "pass", fail: "fail", exception: "exception_noted" };

/** Phase 4: records every row of an accepted Control Test Log as a control test, as the person who uploaded it. */
export async function loadControlTests(db: RequestDb, userId: string, scope: { engagementId: string; organisationId: string }): Promise<LoadResult & { fileId: string | null }> {
  const out: LoadResult & { fileId: string | null } = { created: 0, issues: [], lines: [], fileId: null };
  const [file] = await db
    .select()
    .from(intakeFiles)
    .where(and(eq(intakeFiles.engagementId, scope.engagementId), eq(intakeFiles.templateKey, "CONTROL-TEST-LOG"), eq(intakeFiles.status, "accepted"), eq(intakeFiles.uploadedBy, userId)))
    .orderBy(desc(intakeFiles.uploadedAt))
    .limit(1);
  if (!file?.parsed) return out;
  out.fileId = file.id;
  const rows = (file.parsed as { tables: Record<string, Array<{ row: number; v: Record<string, string> }>> }).tables["Tests"] ?? [];
  const assessmentId = await ensureAssessment(db, userId, scope.engagementId, scope.organisationId);
  const ctl = await db
    .select({ id: controls.id, code: controls.code, applicability: assessmentControls.applicabilityDecision })
    .from(assessmentControls)
    .innerJoin(controls, eq(controls.id, assessmentControls.controlId))
    .where(eq(assessmentControls.assessmentId, assessmentId));
  const byCode = new Map(ctl.map((c) => [c.code.toUpperCase(), c]));
  for (const r of rows) {
    const code = r.v.control!.trim().toUpperCase();
    const c = byCode.get(code);
    if (!c) { out.issues.push({ row: r.row, text: `Control ${code} is not part of this engagement's assessment, so this test was not recorded.` }); continue; }
    if (c.applicability === "not_applicable") { out.issues.push({ row: r.row, text: `Control ${code} was decided not applicable in phase 3, so this test was not recorded.` }); continue; }
    await createControlTest(db, userId, {
      assessmentId,
      controlId: c.id,
      methodology: `${r.v.procedure}${r.v.notes ? ` Result notes: ${r.v.notes}` : ""} (tested by ${r.v.tester}; from ${file.filename}, row ${r.row})`.slice(0, 2000),
      sampleDescription: r.v.sample || null,
      result: RESULT[r.v.result!.toLowerCase()] ?? "exception_noted",
      testedAt: r.v.date || null,
    });
    out.created++;
  }
  out.lines.push(`Recorded ${out.created} control tests from ${file.filename}.`);
  await markProcessed(db, file.id, null);
  await emit(db, { engagementId: scope.engagementId, kind: "tests_loaded", summary: `${out.created} control tests were recorded from ${file.filename}`, subjectType: "intake_file", subjectId: file.id, clientVisible: false });
  return out;
}

const EVIDENCE_TYPE: Record<string, "policy_document" | "screenshot" | "signed_agreement" | "certificate" | "other"> = {
  Policy: "policy_document", Procedure: "policy_document", Agreement: "signed_agreement", Certificate: "certificate", Screenshot: "screenshot",
};

/**
 * Phase 5: for every file this person uploaded that the Evidence Index lists, creates the evidence record
 * linked to the control the index names. Files not on the index are left alone and reported.
 */
export async function reconcileEvidence(db: RequestDb, userId: string, scope: { engagementId: string; organisationId: string }): Promise<LoadResult> {
  const out: LoadResult = { created: 0, issues: [], lines: [] };
  const idx = await latestParsed(db, scope.engagementId, "EVIDENCE-INDEX");
  const files = await db.select().from(intakeFiles).where(and(eq(intakeFiles.engagementId, scope.engagementId), eq(intakeFiles.role, "evidence_file"), eq(intakeFiles.phase, 5))).orderBy(asc(intakeFiles.uploadedAt));
  if (!idx) {
    if (files.length) out.issues.push({ text: `${files.length} file${files.length === 1 ? " is" : "s are"} waiting for an Evidence Index. Upload the filled index to say which control each file supports.` });
    return out;
  }
  const rows = idx.data.tables["Evidence"] ?? [];
  const [asm] = await db.select({ id: assessments.id }).from(assessments).where(and(eq(assessments.engagementId, scope.engagementId), eq(assessments.status, "draft"))).orderBy(desc(assessments.createdAt)).limit(1);
  if (!asm) { out.issues.push({ text: "The assessment is not open yet. Finish phase 3 first." }); return out; }
  const acs = await db
    .select({ acId: assessmentControls.id, code: controls.code })
    .from(assessmentControls)
    .innerJoin(controls, eq(controls.id, assessmentControls.controlId))
    .where(eq(assessmentControls.assessmentId, asm.id));
  const acByCode = new Map(acs.map((a) => [a.code.toUpperCase(), a.acId]));
  const loadedBefore = await db.select({ f: intakeFiles.id }).from(intakeFiles).where(and(eq(intakeFiles.engagementId, scope.engagementId), eq(intakeFiles.role, "evidence_file"), eq(intakeFiles.status, "processed")));
  const done = new Set(loadedBefore.map((x) => x.f));
  const mine = files.filter((f) => f.uploadedBy === userId && !done.has(f.id));

  for (const f of mine) {
    const listed = rows.filter((r) => r.v.file!.trim().toLowerCase() === f.filename.toLowerCase());
    if (listed.length === 0) { out.issues.push({ text: `"${f.filename}" is not listed in the Evidence Index (${idx.row.filename}), so it was not linked to a control.` }); continue; }
    const buffer = await readEvidenceObject(f.storagePath);
    let n = 0;
    for (const r of listed) {
      const code = r.v.control!.trim().toUpperCase();
      const acId = acByCode.get(code);
      if (!acId) { out.issues.push({ row: r.row, text: `Index row ${r.row}: control ${code} is not in this assessment.` }); continue; }
      let [resp] = await db.select({ id: assessmentResponses.id }).from(assessmentResponses).where(eq(assessmentResponses.assessmentControlId, acId)).limit(1);
      if (!resp) {
        await updateAssessmentResponse(db, userId, { assessmentControlId: acId, effectivenessRating: "not_assessed", decisionRationale: null });
        [resp] = await db.select({ id: assessmentResponses.id }).from(assessmentResponses).where(eq(assessmentResponses.assessmentControlId, acId)).limit(1);
      }
      await uploadEvidence(db, userId, {
        organisationId: scope.organisationId,
        engagementId: scope.engagementId,
        title: `${r.v.title}${r.v.date ? ` (${r.v.date})` : ""}`.slice(0, 200),
        evidenceType: EVIDENCE_TYPE[r.v.doctype!] ?? "other",
        documentType: r.v.doctype === "Policy" || r.v.doctype === "Procedure" ? "policy" : r.v.doctype === "Report" ? "report" : r.v.doctype === "Certificate" ? "certificate" : r.v.doctype === "Agreement" ? "contract" : r.v.doctype === "Screenshot" ? "screenshot" : "other",
        linkTo: { type: "assessment_response", assessmentResponseId: resp!.id },
        file: { buffer, filename: f.filename, mimeType: f.mimeType },
      });
      n++;
      out.created++;
    }
    if (n > 0) await markProcessed(db, f.id, null);
  }
  for (const r of rows) {
    const has = files.some((f) => f.filename.toLowerCase() === r.v.file!.trim().toLowerCase());
    if (!has) out.issues.push({ row: r.row, text: `Index row ${r.row} lists "${r.v.file}" but no file with that name has been uploaded yet.` });
  }
  if (out.created) out.lines.push(`Created ${out.created} evidence record${out.created === 1 ? "" : "s"} linked to controls.`);
  if (out.created) await emit(db, { engagementId: scope.engagementId, kind: "evidence_loaded", summary: `${out.created} evidence file${out.created === 1 ? " was" : "s were"} linked to controls from the Evidence Index`, subjectType: "intake_file", clientVisible: true });
  return out;
}
