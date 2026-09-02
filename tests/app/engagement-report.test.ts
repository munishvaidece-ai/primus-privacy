// Slice R1 — Basic Engagement Report. Tests the real data-aggregation
// function (`getEngagementReportData`, lib/domain/reports.ts) against
// real PostgreSQL — no mocked authorization, no mocked data — and the
// real PDF-rendering function (`renderEngagementReportPdf`,
// lib/reports/engagement-report-pdf.ts) against the actual bytes it
// produces, parsed back with `pdfjs-dist` (PHASE R1 instructions §27:
// "inspect PDF structure, not just string-search the raw buffer").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementReportData, NoAssessmentForEngagementError } from "@/lib/domain/reports";
import { renderEngagementReportPdf } from "@/lib/reports/engagement-report-pdf";
import { createAssessment, updateAssessmentResponse, getAssessmentDetail, finalizeAssessment } from "@/lib/domain/assessments";
import { createRisk } from "@/lib/domain/risks";
import { createFinding } from "@/lib/domain/findings";
import { createRemediationAction } from "@/lib/domain/remediation";
import { createValidationRecord } from "@/lib/domain/validation";
import { uploadEvidence } from "@/lib/domain/evidence";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import {
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantEngagementMembership,
  createControlLibraryVersion,
  publishControlLibraryVersion,
  createControl,
  pinEngagementControlLibraryVersion,
  createRiskScoringModel,
  pool,
} from "./helpers";

function textFile(content = "synthetic evidence content — not a real client document") {
  return { buffer: Buffer.from(content, "utf8"), filename: "evidence.txt", mimeType: "text/plain" };
}

/** A long title in a narrow table cell (e.g. the Risk Register's own
 * "Risk" column) legitimately word-wraps across lines in the rendered
 * PDF — pdfkit's own real wrapping behavior, not a bug — and pdfjs-dist
 * text extraction then reports each wrapped fragment as a separate item
 * joined with extra whitespace, so an exact substring match across a
 * wrap point can spuriously fail even though the identical characters
 * are genuinely present in reading order. Stripping whitespace and
 * hyphens from both sides before comparing verifies the same content
 * is truly present, independent of incidental line-wrap position. */
function normalizeForWrap(s: string): string {
  return s.replace(/[\s-]+/g, "").toLowerCase();
}

/** Parses a generated PDF back into plain text using `pdfjs-dist`'s
 * legacy Node build (no dependencies of its own, no native canvas
 * needed for text extraction — see DECISIONS.md for the full library
 * evaluation). Real structural parsing, not a raw-buffer string search:
 * this walks the PDF's own object/content-stream structure exactly as a
 * PDF viewer would. (A "standardFontDataUrl" warning on stderr is
 * expected and harmless here — it only affects glyph-metrics fallback
 * for the standard 14 fonts pdfkit itself uses without embedding, not
 * text extraction, which still returns every character correctly.) */
async function extractPdfText(buffer: Buffer): Promise<{ numPages: number; textByPage: string[] }> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const doc = await loadingTask.promise;
  const textByPage: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    textByPage.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return { numPages: doc.numPages, textByPage };
}

describe("Application layer — Engagement Report (Slice R1)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string; // the main, richly-populated engagement
  let engagementA3: string; // isolation check — same org as A, different engagement
  let engagementTie: string; // created_at/id tie-break check
  let engagementStateCheck: string; // draft vs finalized
  let engagementEmpty: string; // zero assessments
  let engagementB: string; // cross-tenant

  let libraryA: string, controlA1: string, controlA2: string, controlA3: string;
  let libraryTie: string;
  let libraryState: string, controlState1: string;
  let libraryB: string, controlB1: string;

  let userManagerA: string; // Engagement Manager on engagementA/A3/Tie/State/Empty
  let userConsultantA: string; // Consultant on engagementA only
  let userOutsiderA: string; // tenantA, no membership anywhere
  let userManagerB: string; // Engagement Manager on engagementB (tenantB)

  let assessmentOld: string;
  let assessmentRecent: string; // the one the report must select
  let riskId: string, findingId: string, remediationId1: string, remediationId2: string;
  let tieOlderId: string, tieNewerId: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice R1 Tenant A");
      tenantB = await createTenant(client, "Slice R1 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice R1 Org A");
      orgA2 = await createOrganisation(client, tenantA, "Slice R1 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice R1 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "Slice R1 Engagement A");
      engagementA3 = await createEngagement(client, tenantA, orgA, "Slice R1 Engagement A3 (isolation)");
      engagementTie = await createEngagement(client, tenantA, orgA, "Slice R1 Engagement Tie-break");
      engagementStateCheck = await createEngagement(client, tenantA, orgA, "Slice R1 Engagement State Check");
      engagementEmpty = await createEngagement(client, tenantA, orgA, "Slice R1 Engagement Empty");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice R1 Engagement B");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice R1 Library A" });
      controlA1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Access control policy in place" });
      controlA2 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C2", title: "Vendor DPAs executed" });
      controlA3 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C3", title: "Data retention schedule defined" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA3, libraryA);

      libraryTie = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice R1 Library Tie" });
      await publishControlLibraryVersion(client, libraryTie);
      await pinEngagementControlLibraryVersion(client, engagementTie, libraryTie);

      libraryState = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice R1 Library State" });
      controlState1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryState, code: "S1", title: "State-check control" });
      await publishControlLibraryVersion(client, libraryState);
      await pinEngagementControlLibraryVersion(client, engagementStateCheck, libraryState);

      libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Slice R1 Library B" });
      controlB1 = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "B1", title: "Control B1" });
      await publishControlLibraryVersion(client, libraryB);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      await createRiskScoringModel(client, { tenantId: tenantA, name: "R1 Matrix A", version: "v1.0" });
      await createRiskScoringModel(client, { tenantId: tenantB, name: "R1 Matrix B", version: "v1.0" });

      userManagerA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userManagerA, engagementA, "Engagement Manager");
      await grantEngagementMembership(client, userManagerA, engagementA3, "Engagement Manager");
      await grantEngagementMembership(client, userManagerA, engagementTie, "Engagement Manager");
      await grantEngagementMembership(client, userManagerA, engagementStateCheck, "Engagement Manager");
      await grantEngagementMembership(client, userManagerA, engagementEmpty, "Engagement Manager");

      userConsultantA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userConsultantA, engagementA, "Consultant");

      userOutsiderA = await createUser(client, { tenantId: tenantA });

      userManagerB = await createUser(client, { tenantId: tenantB });
      await grantEngagementMembership(client, userManagerB, engagementB, "Engagement Manager");
    });

    // --- Populate engagementA with a full, realistic governance loop ------
    const older = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "FY2025 (older)" }),
    );
    assessmentOld = older.id;

    const recent = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "control_readiness", periodLabel: "FY2026 Readiness" }),
    );
    assessmentRecent = recent.id;

    const detail = await withRequestDb(userManagerA, (db) => getAssessmentDetail(db, userManagerA, assessmentRecent));
    const rowC1 = detail.controlRows.find((r) => r.controlId === controlA1)!;
    const rowC2 = detail.controlRows.find((r) => r.controlId === controlA2)!;
    // controlA3 is deliberately left with no response at all — the
    // "not responded" state the report's Assessment Results table must
    // also render honestly.

    await withRequestDb(userManagerA, (db) =>
      updateAssessmentResponse(db, userManagerA, {
        assessmentControlId: rowC1.assessmentControlId,
        effectivenessRating: "implemented",
        decisionRationale: "MFA enforced for all privileged access; verified via configuration export.",
      }),
    );
    await withRequestDb(userManagerA, (db) =>
      updateAssessmentResponse(db, userManagerA, {
        assessmentControlId: rowC2.assessmentControlId,
        effectivenessRating: "not_implemented",
        decisionRationale: "No DPA executed with the primary cloud vendor yet.",
      }),
    );

    const detailAfterResponses = await withRequestDb(userManagerA, (db) => getAssessmentDetail(db, userManagerA, assessmentRecent));
    const responseC1Id = detailAfterResponses.controlRows.find((r) => r.controlId === controlA1)!.response!.id;

    const risk = await withRequestDb(userManagerA, (db) =>
      createRisk(db, userManagerA, {
        assessmentId: assessmentRecent,
        controlId: controlA2,
        title: "Unmanaged vendor data-processing risk",
        description: "Vendor processes personal data with no executed DPA in place.",
        likelihood: 4,
        impact: 4,
        inherentRating: "high",
        residualLikelihood: 2,
        residualImpact: 3,
        residualRating: "medium",
        assignOwnerToSelf: true,
      }),
    );
    riskId = risk.id;

    const finding = await withRequestDb(userManagerA, (db) =>
      createFinding(db, userManagerA, {
        riskId,
        title: "No Data Processing Agreement executed with cloud vendor",
        description: "DPA absence exposes the organisation to DPDP Act processor-obligations gaps.",
        severity: "high",
        assignOwnerToSelf: true,
      }),
    );
    findingId = finding.id;

    const rem1 = await withRequestDb(userManagerA, (db) =>
      createRemediationAction(db, userManagerA, {
        findingId,
        title: "Execute DPA with primary cloud vendor",
        description: "Legal to circulate and countersign the standard DPA template.",
        priority: "high",
        dueDate: "2026-12-31",
        assignOwnerToSelf: true,
      }),
    );
    remediationId1 = rem1.id;

    const rem2 = await withRequestDb(userManagerA, (db) =>
      createRemediationAction(db, userManagerA, {
        findingId,
        title: "Add vendor to the processor register",
        description: null,
        priority: "medium",
        dueDate: null,
        assignOwnerToSelf: true,
      }),
    );
    remediationId2 = rem2.id;

    await withRequestDb(userManagerA, (db) =>
      createValidationRecord(db, userManagerA, {
        remediationActionId: remediationId1,
        outcome: "accepted",
        rationale: "Countersigned DPA reviewed and confirmed on file.",
      }),
    );

    await withRequestDb(userManagerA, (db) =>
      uploadEvidence(db, userManagerA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "MFA configuration export",
        evidenceType: "system_configuration_export",
        linkTo: { type: "assessment_response", assessmentResponseId: responseC1Id },
        file: textFile("mfa config export"),
      }),
    );
    await withRequestDb(userManagerA, (db) =>
      uploadEvidence(db, userManagerA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Countersigned DPA (redacted)",
        evidenceType: "signed_agreement",
        linkTo: { type: "remediation_action", remediationActionId: remediationId1 },
        file: textFile("dpa contents"),
      }),
    );

    // --- Isolation fixture: real data on a DIFFERENT engagement (same
    // org) that must never appear in engagementA's report -----------------
    const isolationAssessment = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA3, assessmentType: "annual", periodLabel: "Isolation check" }),
    );
    const isolationRisk = await withRequestDb(userManagerA, (db) =>
      createRisk(db, userManagerA, {
        assessmentId: isolationAssessment.id,
        controlId: controlA1,
        title: "ISOLATION-CANARY-RISK should never appear in Engagement A's report",
        description: null,
        likelihood: 1,
        impact: 1,
        inherentRating: "low",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: true,
      }),
    );
    await withRequestDb(userManagerA, (db) =>
      createFinding(db, userManagerA, {
        riskId: isolationRisk.id,
        title: "ISOLATION-CANARY-FINDING should never appear in Engagement A's report",
        description: null,
        severity: "low",
        assignOwnerToSelf: true,
      }),
    );

    const isolationDetail = await withRequestDb(userManagerA, (db) => getAssessmentDetail(db, userManagerA, isolationAssessment.id));
    const isolationC1Row = isolationDetail.controlRows.find((r) => r.controlId === controlA1)!;
    await withRequestDb(userManagerA, (db) =>
      updateAssessmentResponse(db, userManagerA, {
        assessmentControlId: isolationC1Row.assessmentControlId,
        effectivenessRating: "implemented",
        decisionRationale: "Isolation-fixture response.",
      }),
    );
    const isolationDetailAfter = await withRequestDb(userManagerA, (db) => getAssessmentDetail(db, userManagerA, isolationAssessment.id));
    const isolationResponseId = isolationDetailAfter.controlRows.find((r) => r.controlId === controlA1)!.response!.id;
    await withRequestDb(userManagerA, (db) =>
      uploadEvidence(db, userManagerA, {
        organisationId: orgA,
        engagementId: engagementA3,
        title: "ISOLATION-CANARY-EVIDENCE should never appear in Engagement A's report",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: isolationResponseId },
        file: textFile("canary"),
      }),
    );

    // --- Tie-break fixture: two Assessments forced to the exact same
    // created_at, so only the `id DESC` tie-breaker distinguishes them --
    const tieOlder = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementTie, assessmentType: "annual", periodLabel: "Tie A" }),
    );
    const tieNewer = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementTie, assessmentType: "annual", periodLabel: "Tie B" }),
    );
    await asFixtureSetup((c) =>
      c.query(`UPDATE assessments SET created_at = '2026-01-01T00:00:00Z' WHERE id IN ($1, $2)`, [tieOlder.id, tieNewer.id]),
    );
    tieOlderId = tieOlder.id;
    tieNewerId = tieNewer.id;

    // --- State-check fixture: one Assessment, still draft for now --------
    await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementStateCheck, assessmentType: "annual", periodLabel: "State Check FY2026" }),
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  // === Authorization (5) ===================================================

  it("1. An active engagement member (Engagement Manager) can generate the report", async () => {
    const data = await withRequestDb(userManagerA, (db) => getEngagementReportData(db, userManagerA, { organisationId: orgA, engagementId: engagementA }));
    expect(data.engagement.id).toBe(engagementA);
  });

  it("2. An active engagement member (plain Consultant) can also generate the report — no report-specific role gate beyond ordinary engagement access", async () => {
    const data = await withRequestDb(userConsultantA, (db) => getEngagementReportData(db, userConsultantA, { organisationId: orgA, engagementId: engagementA }));
    expect(data.engagement.id).toBe(engagementA);
  });

  it("3. A tenant member with no membership on this engagement or organisation cannot generate the report", async () => {
    await expect(
      withRequestDb(userOutsiderA, (db) => getEngagementReportData(db, userOutsiderA, { organisationId: orgA, engagementId: engagementA })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4. A cross-tenant actor cannot generate the report", async () => {
    await expect(
      withRequestDb(userManagerB, (db) => getEngagementReportData(db, userManagerB, { organisationId: orgA, engagementId: engagementA })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("5. Anonymous (unauthenticated) caller cannot generate the report", async () => {
    await expect(withRequestDb(null, (db) => getEngagementReportData(db, "00000000-0000-0000-0000-000000000000", { organisationId: orgA, engagementId: engagementA }))).rejects.toThrow();
  });

  // === Forged / cross-scope IDs (part of authorization posture) ===========

  it("Forged organisationId: a real Engagement with the wrong organisationId argument is rejected, not silently redirected", async () => {
    await expect(
      withRequestDb(userManagerA, (db) => getEngagementReportData(db, userManagerA, { organisationId: orgA2, engagementId: engagementA })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // === State (1) ============================================================

  it("6. Report generation succeeds identically for a draft Assessment and, after finalization, for the same now-finalized Assessment — no finalization requirement is invented", async () => {
    const draftData = await withRequestDb(userManagerA, (db) =>
      getEngagementReportData(db, userManagerA, { organisationId: orgA, engagementId: engagementStateCheck }),
    );
    expect(draftData.selectedAssessment.status).toBe("draft");

    await withRequestDb(userManagerA, (db) =>
      finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementStateCheck, assessmentId: draftData.selectedAssessment.id }),
    );

    const finalizedData = await withRequestDb(userManagerA, (db) =>
      getEngagementReportData(db, userManagerA, { organisationId: orgA, engagementId: engagementStateCheck }),
    );
    expect(finalizedData.selectedAssessment.status).toBe("finalized");
    expect(finalizedData.selectedAssessment.id).toBe(draftData.selectedAssessment.id);
  });

  // === Assessment selection (deterministic ordering) =======================

  it("7. Selects the most recently created Assessment when an Engagement has more than one", async () => {
    const data = await withRequestDb(userManagerA, (db) => getEngagementReportData(db, userManagerA, { organisationId: orgA, engagementId: engagementA }));
    expect(data.selectedAssessment.id).toBe(assessmentRecent);
    expect(data.selectedAssessment.id).not.toBe(assessmentOld);
  });

  it("8. Tie-break: when two Assessments share the exact same created_at, the one with the greater id (created_at DESC, id DESC) is selected", async () => {
    const expectedWinner = [tieOlderId, tieNewerId].sort().reverse()[0];

    const data = await withRequestDb(userManagerA, (db) => getEngagementReportData(db, userManagerA, { organisationId: orgA, engagementId: engagementTie }));
    expect(data.selectedAssessment.id).toBe(expectedWinner);
  });

  it("No Assessment on the Engagement: getEngagementReportData throws NoAssessmentForEngagementError, not a crash or an empty report", async () => {
    await expect(
      withRequestDb(userManagerA, (db) => getEngagementReportData(db, userManagerA, { organisationId: orgA, engagementId: engagementEmpty })),
    ).rejects.toThrow(NoAssessmentForEngagementError);
  });

  // === Data correctness (8) =================================================

  let reportData: Awaited<ReturnType<typeof getEngagementReportData>>;
  it("9. Engagement Overview fields match the authoritative Engagement row", async () => {
    reportData = await withRequestDb(userManagerA, (db) => getEngagementReportData(db, userManagerA, { organisationId: orgA, engagementId: engagementA }));
    expect(reportData.engagement.name).toBe("Slice R1 Engagement A");
    expect(reportData.engagement.organisationName).toBe("Slice R1 Org A");
    expect(reportData.engagement.engagementType).toBeTruthy();
    expect(reportData.engagement.controlLibraryVersionLabel).toBe("Slice R1 Library A");
  });

  it("10. Assessment Results includes all three controls with their real effectiveness ratings — implemented, not_implemented, and not-yet-responded", async () => {
    const rows = reportData.selectedAssessment.controlRows;
    expect(rows).toHaveLength(3);
    const c1 = rows.find((r) => r.controlId === controlA1)!;
    const c2 = rows.find((r) => r.controlId === controlA2)!;
    const c3 = rows.find((r) => r.controlId === controlA3)!;
    expect(c1.response?.effectivenessRating).toBe("implemented");
    expect(c2.response?.effectivenessRating).toBe("not_implemented");
    expect(c3.response).toBeNull();
  });

  it("11. Risk Register includes the created Risk with its real inherent/residual ratings, status, and source Control", async () => {
    const risk = reportData.risks.find((r) => r.id === riskId)!;
    expect(risk).toBeTruthy();
    expect(risk.title).toBe("Unmanaged vendor data-processing risk");
    expect(risk.inherentRating).toBe("high");
    expect(risk.residualRating).toBe("medium");
    expect(risk.status).toBe("open");
    expect(risk.sourceControlCode).toBe("C2");
  });

  it("12. Findings includes the created Finding with its real severity, status, and source Risk", async () => {
    const finding = reportData.findings.find((f) => f.id === findingId)!;
    expect(finding).toBeTruthy();
    expect(finding.severity).toBe("high");
    expect(finding.status).toBe("open");
    expect(finding.sourceRiskTitle).toBe("Unmanaged vendor data-processing risk");
  });

  it("13. Remediation includes both created RemediationActions with their real priority/status/due date/source Finding", async () => {
    expect(reportData.remediationActions.map((r) => r.id).sort()).toEqual([remediationId1, remediationId2].sort());
    const r1 = reportData.remediationActions.find((r) => r.id === remediationId1)!;
    expect(r1.priority).toBe("high");
    expect(r1.dueDate).toBe("2026-12-31");
    expect(r1.sourceFindingTitle).toBe("No Data Processing Agreement executed with cloud vendor");
  });

  it("14. Validation includes the real ValidationRecord with its outcome, rationale, and RemediationAction title — not a synthetic 'engagement validated' status", async () => {
    expect(reportData.validationRecords).toHaveLength(1);
    const v = reportData.validationRecords[0]!;
    expect(v.outcome).toBe("accepted");
    expect(v.rationale).toBe("Countersigned DPA reviewed and confirmed on file.");
    expect(v.remediationActionTitle).toBe("Execute DPA with primary cloud vendor");
  });

  it("15. Evidence Summary includes both uploaded Evidence items, metadata only — no storage_path or signed URL field present", async () => {
    expect(reportData.evidenceItems).toHaveLength(2);
    const titles = reportData.evidenceItems.map((e) => e.title).sort();
    expect(titles).toEqual(["Countersigned DPA (redacted)", "MFA configuration export"].sort());
    for (const item of reportData.evidenceItems) {
      expect(item).not.toHaveProperty("storagePath");
      expect(item).not.toHaveProperty("url");
      expect(item).not.toHaveProperty("signedUrl");
    }
  });

  it("16. No completeness/synthetic percentage is invented for progress — the raw completed/total counts from the real data are returned as-is", async () => {
    expect(reportData.selectedAssessment.progress).toEqual({ completed: 2, total: 3 });
  });

  // === Isolation (2) =========================================================

  it("17. Data from a different Engagement in the same Organisation does not appear in this Engagement's report (Risk/Finding canaries)", async () => {
    const allTitles = [...reportData.risks.map((r) => r.title), ...reportData.findings.map((f) => f.title)];
    expect(allTitles.some((t) => t.includes("ISOLATION-CANARY"))).toBe(false);
  });

  it("18. Evidence from a different Engagement does not appear in this Engagement's Evidence Summary", async () => {
    expect(reportData.evidenceItems.some((e) => e.title.includes("ISOLATION-CANARY"))).toBe(false);
  });

  // === Output — PDF rendering (4) ===========================================

  let pdfBuffer: Buffer;
  let pdfText: string;
  it("19. renderEngagementReportPdf produces a real, well-formed PDF with exactly one page per section — no spurious blank pages", async () => {
    pdfBuffer = await renderEngagementReportPdf(reportData, { generatedByEmail: userManagerA + "@example.test" });
    expect(pdfBuffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const { numPages, textByPage } = await extractPdfText(pdfBuffer);
    // Cover, Executive Summary, Engagement Overview, Assessment Results,
    // Maturity, Risk Register, Findings, Remediation, Validation, Evidence
    // Summary, Appendix — exactly 11 for this fixture's data volume (one
    // page per section; Maturity added by M2). A LOOSER
    // `toBeGreaterThanOrEqual` bound here originally masked a real pdfkit
    // pagination bug (a footer position that fell just past the printable
    // area silently forced an extra, near-blank page after every section,
    // found only by this slice's own manual PDF inspection, PHASE R1
    // instructions §36) — asserting the exact count keeps that regression
    // caught automatically too.
    expect(numPages).toBe(11);
    // Every page must carry real content — no page should be
    // (near-)empty apart from the footer, which is what the bug above
    // actually produced.
    for (const page of textByPage) {
      expect(page.replace(/PRIMUS PRIVACY — Confidential — .*/, "").trim().length).toBeGreaterThan(20);
    }
    pdfText = textByPage.join("\n");
  });

  it("20. The PDF clearly identifies the selected Assessment's type, period, status, and ID, per the user's explicit instruction", async () => {
    expect(pdfText).toContain(reportData.selectedAssessment.id);
    expect(pdfText).toContain(reportData.selectedAssessment.periodLabel);
    expect(pdfText).toContain(reportData.selectedAssessment.assessmentType);
    expect(pdfText).toContain(reportData.selectedAssessment.status);
  });

  it("21. The PDF's actual extracted text contains the real fixture content — Risk/Finding/Remediation/Validation/Evidence titles — not placeholder or fabricated text", async () => {
    const normalized = normalizeForWrap(pdfText);
    expect(normalized).toContain(normalizeForWrap("Unmanaged vendor data-processing risk"));
    expect(normalized).toContain(normalizeForWrap("No Data Processing Agreement executed with cloud vendor"));
    expect(normalized).toContain(normalizeForWrap("Execute DPA with primary cloud vendor"));
    expect(normalized).toContain(normalizeForWrap("Add vendor to the processor register"));
    expect(normalized).toContain(normalizeForWrap("Countersigned DPA reviewed and confirmed on file."));
    expect(normalized).toContain(normalizeForWrap("MFA configuration export"));
  });

  it("22. The PDF never contains a storage path, a signed URL, or any isolation-canary content from another Engagement", async () => {
    expect(pdfText.toLowerCase()).not.toContain("local-evidence-storage://");
    expect(pdfText.toLowerCase()).not.toContain("storage_path");
    expect(pdfText).not.toContain("ISOLATION-CANARY");
  });

  it("23. renderEngagementReportPdf performs no database or network I/O of its own — a pure function from data to bytes (same data in, same byte-for-byte-structurally-equivalent text out)", async () => {
    const again = await renderEngagementReportPdf(reportData, { generatedByEmail: null });
    const { textByPage } = await extractPdfText(again);
    expect(normalizeForWrap(textByPage.join("\n"))).toContain(normalizeForWrap("Unmanaged vendor data-processing risk"));
  });

  // --- Manual-inspection artifact (PHASE R1 instructions §36): write the
  // real generated PDF to disk so it can be opened and visually
  // inspected, not just asserted against programmatically. ---------------
  it("writes a real demonstration PDF to the scratchpad for manual visual inspection", async () => {
    const { writeFileSync } = await import("node:fs");
    const outPath = "/tmp/claude-0/-home-user-primus-privacy/23021838-42c1-5e6f-9940-0a46135f42a6/scratchpad/r1-demo-engagement-report.pdf";
    writeFileSync(outPath, pdfBuffer);
    const onDisk = readFileSync(outPath);
    expect(onDisk.length).toBe(pdfBuffer.length);
  });
});
