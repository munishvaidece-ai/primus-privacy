// PRIMUS PRIVACY — Reference/Demo Engagement Dataset: end-to-end
// walkthrough. Builds the one fictional "ABC Fintech Private Limited"
// engagement (reference-engagement-fixture.ts) through real application
// code wherever real application code exists, then actually exercises
// every stage of the requested workflow — Organisation → Engagement →
// Data Landscape → ROPA → Applicability/Scope → DPDP Controls →
// Assessment → Assessment Responses → Control Testing → Evidence →
// Risks → Findings → Remediation → Validation → Maturity → Engagement
// Report — recording WORKS / PARTIAL / MISSING for each, against real
// PostgreSQL, never inferred from "a table exists" alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withRequestDb } from "@/lib/db/request-client";
import { buildReferenceEngagement, pool, asFixtureSetup, type ReferenceEngagementFixture } from "./reference-engagement-fixture";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { getOrganisationDetail } from "@/lib/domain/organisations";
import { getAssessmentDetail } from "@/lib/domain/assessments";
import { listRisksForEngagement } from "@/lib/domain/risks";
import { listFindingsForEngagement } from "@/lib/domain/findings";
import { listRemediationActionsForEngagement } from "@/lib/domain/remediation";
import { listValidationRecordsForEngagement } from "@/lib/domain/validation";
import { getEvidenceSummaryForEngagement } from "@/lib/domain/evidence";
import { getEngagementReportData } from "@/lib/domain/reports";
import { renderEngagementReportPdf } from "@/lib/reports/engagement-report-pdf";

async function extractPdfText(buffer: Buffer): Promise<{ numPages: number; text: string; textByPage: string[] }> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  const textByPage: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    textByPage.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return { numPages: doc.numPages, text: textByPage.join("\n"), textByPage };
}

function repoFileExists(relativePath: string): boolean {
  return existsSync(path.join(process.cwd(), relativePath));
}

describe("Reference/Demo Engagement Dataset — end-to-end walkthrough", () => {
  let fx: ReferenceEngagementFixture;
  let pdfText: string;

  beforeAll(async () => {
    fx = await buildReferenceEngagement();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  // === STAGE 1 — Organisation: WORKS ========================================
  it("STAGE 1 — Organisation: WORKS (real createOrganisation domain function, Slice B1/B2)", async () => {
    const detail = await withRequestDb(fx.leadUserId, (db) => getOrganisationDetail(db, fx.leadUserId, fx.organisationId));
    expect(detail.name).toBe(fx.organisationName);
    expect(detail.name).toBe("ABC Fintech Private Limited");
  });

  // === STAGE 2 — Engagement: WORKS ==========================================
  it("STAGE 2 — Engagement: WORKS (real createEngagement domain function, Slice B2; pins the demo Control Library)", async () => {
    const detail = await withRequestDb(fx.leadUserId, (db) => getEngagementDetail(db, fx.leadUserId, fx.engagementId));
    expect(detail.name).toBe(fx.engagementName);
    expect(detail.organisationId).toBe(fx.organisationId);
    expect(detail.engagementType).toBe("annual_assessment");
    expect(detail.controlLibraryVersionId).toBe(fx.controlLibraryVersionId);
    // The creator (leadUserId) was auto-granted Engagement Manager —
    // real onboarding-grant behavior, not part of this fixture's own
    // raw SQL.
    expect(detail.currentUserRoleName).toBe("Engagement Manager");
  });

  it("Engagement Membership: WORKS (real addEngagementMember domain function, Slice C7.2 — the second consultant is a genuine, eligible member)", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT status, r.name AS role_name FROM engagement_memberships em JOIN roles r ON r.id = em.role_id WHERE em.engagement_id = $1 AND em.user_id = $2`, [
        fx.engagementId,
        fx.secondUserId,
      ]),
    );
    expect(rows[0]).toMatchObject({ status: "active", role_name: "Consultant" });
  });

  // === STAGE 3 — Data Landscape / Processing Activities / ROPA: PARTIAL ====
  it("STAGE 3 — Data Landscape / ROPA: PARTIAL (real, correct database schema — SCD2 master data, version-pinned junctions — but NO application-layer domain module or UI exists to create/read it as a real user would)", async () => {
    // The database layer genuinely works: real INSERTs, respecting every
    // real constraint and trigger (SCD2 identity/version split,
    // composite FKs proving organisation/engagement consistency),
    // succeeded for all ten Processing Activities the brief names.
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT name, lifecycle_status, lawful_basis FROM processing_activities WHERE engagement_id = $1 ORDER BY name`, [fx.engagementId]),
    );
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.name).sort()).toEqual(
      [
        "Customer onboarding",
        "KYC verification",
        "Customer account management",
        "Transaction processing",
        "Customer support",
        "Marketing communications",
        "Employee HR administration",
        "Recruitment",
        "Vendor management",
        "Grievance handling",
      ].sort(),
    );
    for (const r of rows) {
      expect(r.lifecycle_status).toBe("active");
      expect(r.lawful_basis).toBeTruthy();
    }

    // The application layer does not exist: no domain module, no route.
    expect(repoFileExists("lib/domain/processing-activities.ts")).toBe(false);
    expect(
      repoFileExists("app/(shell)/organisations/[organisationId]/engagements/[engagementId]/data-landscape"),
    ).toBe(false);
  });

  // === STAGE 4 — Applicability / Scope: MISSING =============================
  it("STAGE 4 — Applicability / Scope: MISSING (DATA_MODEL.md §4 documents ApplicabilityDetermination; no such table, or any application code for it, exists)", async () => {
    await expect(asFixtureSetup((c) => c.query(`SELECT 1 FROM applicability_determinations LIMIT 1`))).rejects.toThrow(/does not exist/i);
    expect(repoFileExists("lib/domain/applicability.ts")).toBe(false);
  });

  // === STAGE 5 — DPDP Controls / Control Library: PARTIAL ===================
  it("STAGE 5 — DPDP Controls (Regulatory Content & Control Library): PARTIAL (real database schema, real publish/versioning workflow, genuinely enforced — but NO application-layer domain module or UI exists to author this content as a real user would)", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT status, published_at FROM control_library_versions WHERE id = $1`, [fx.controlLibraryVersionId]),
    );
    expect(rows[0]).toMatchObject({ status: "published" });
    expect(rows[0]!.published_at).toBeTruthy(); // set by the real publish trigger, migration 0007 — not settable directly.

    const { rows: controlRows } = await asFixtureSetup((c) =>
      c.query(`SELECT count(*)::int AS n FROM controls WHERE control_library_version_id = $1`, [fx.controlLibraryVersionId]),
    );
    expect(controlRows[0]!.n).toBe(25);
    expect(Object.keys(fx.controlIdByCode)).toHaveLength(25);

    // Publication immutability is real, not merely documented — attempt
    // a raw edit to a published Control and confirm the pre-existing
    // trigger (migration 0007) rejects it, exactly as it would for a
    // real consultant attempting the same thing.
    const anyControlId = Object.values(fx.controlIdByCode)[0]!;
    await expect(asFixtureSetup((c) => c.query(`UPDATE controls SET title = 'tampered' WHERE id = $1`, [anyControlId]))).rejects.toThrow();

    expect(repoFileExists("lib/domain/control-library.ts")).toBe(false);
    expect(repoFileExists("app/(shell)/methodology")).toBe(false);
  });

  // === STAGE 6 — Assessment: WORKS ==========================================
  it("STAGE 6 — Assessment: WORKS (real createAssessment domain function, Slice C7.1 — auto-populated from the pinned, published Control Library)", async () => {
    const detail = await withRequestDb(fx.leadUserId, (db) => getAssessmentDetail(db, fx.leadUserId, fx.assessmentId));
    expect(detail.status).toBe("draft"); // kept draft per instruction
    expect(detail.assessmentType).toBe("annual");
    expect(detail.controlRows).toHaveLength(25);
    expect(detail.progress).toEqual({ completed: fx.respondedControlCodes.length, total: 25 });
  });

  // === STAGE 7 — Assessment Responses: WORKS ================================
  it("STAGE 7 — Assessment Responses: WORKS (real updateAssessmentResponse domain function — a realistic mixture, including deliberately unresponded controls)", async () => {
    const detail = await withRequestDb(fx.leadUserId, (db) => getAssessmentDetail(db, fx.leadUserId, fx.assessmentId));
    const ratings = new Set(detail.controlRows.filter((r) => r.response).map((r) => r.response!.effectivenessRating));
    expect(ratings.has("implemented")).toBe(true);
    expect(ratings.has("partially_implemented")).toBe(true);
    expect(ratings.has("not_implemented")).toBe(true);
    expect(ratings.has("not_applicable")).toBe(true);
    expect(fx.respondedControlCodes).toHaveLength(18);
    expect(fx.unrespondedControlCodes).toHaveLength(7);
    const unresponded = detail.controlRows.filter((r) => !r.response);
    expect(unresponded).toHaveLength(7);
  });

  // === STAGE 8 — Control Testing: WORKS ======================================
  it("STAGE 8 — Control Testing: WORKS (real createControlTest domain function — varied methodology and result, by two different testers)", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT result, methodology FROM control_tests WHERE assessment_id = $1`, [fx.assessmentId]),
    );
    expect(rows).toHaveLength(6);
    const results = new Set(rows.map((r) => r.result));
    expect(results).toEqual(new Set(["pass", "fail", "exception_noted"]));
    const methodologies = new Set(rows.map((r) => r.methodology));
    expect(methodologies.size).toBe(5); // Policy review, Configuration review (x2 controls), Evidence review, Interview, Sample testing
  });

  // === STAGE 9 — Evidence: WORKS =============================================
  it("STAGE 9 — Evidence: WORKS (real uploadEvidence domain function — metadata + real stored file, all four EvidenceLink subject types exercised)", async () => {
    const items = await withRequestDb(fx.leadUserId, (db) => getEvidenceSummaryForEngagement(db, fx.leadUserId, { organisationId: fx.organisationId, engagementId: fx.engagementId }));
    expect(items).toHaveLength(9);
    for (const item of items) {
      expect(item.title).toMatch(/\(SAMPLE\)$/);
    }
    const { rows: linkTypes } = await asFixtureSetup((c) =>
      c.query(
        `SELECT DISTINCT el.subject_type FROM evidence_links el JOIN evidence e ON e.id = el.evidence_id WHERE e.engagement_id = $1`,
        [fx.engagementId],
      ),
    );
    expect(new Set(linkTypes.map((r) => r.subject_type))).toEqual(
      new Set(["assessment_response", "control_test", "remediation_action", "validation_record"]),
    );
  });

  // === STAGE 10 — Risks: WORKS ================================================
  it("STAGE 10 — Risks: WORKS (real createRisk/updateRiskStatus domain functions — inherent/residual ratings, varied status)", async () => {
    const risks = await withRequestDb(fx.leadUserId, (db) => listRisksForEngagement(db, fx.leadUserId, { organisationId: fx.organisationId, engagementId: fx.engagementId }));
    expect(risks).toHaveLength(6);
    const statuses = new Set(risks.map((r) => r.status));
    expect(statuses).toEqual(new Set(["open", "mitigating", "accepted"]));
    expect(risks.some((r) => r.inherentRating === "critical")).toBe(true);
  });

  // === STAGE 11 — Findings: WORKS =============================================
  it("STAGE 11 — Findings: WORKS (real createFinding/updateFinding domain functions — traceable to source Risks, varied severity/status)", async () => {
    const findings = await withRequestDb(fx.leadUserId, (db) => listFindingsForEngagement(db, fx.leadUserId, { organisationId: fx.organisationId, engagementId: fx.engagementId }));
    expect(findings).toHaveLength(7);
    const statuses = new Set(findings.map((f) => f.status));
    expect(statuses).toEqual(new Set(["open", "in_progress", "accepted"]));
    const severities = new Set(findings.map((f) => f.severity));
    expect(severities).toEqual(new Set(["low", "medium", "high", "critical"]));
    expect(findings.every((f) => f.sourceRiskTitle)).toBe(true);
  });

  // === STAGE 12 — Remediation: WORKS ===========================================
  it("STAGE 12 — Remediation: WORKS (real createRemediationAction/updateRemediationAction domain functions — open, in_progress, and closed examples, two different owners)", async () => {
    const actions = await withRequestDb(fx.leadUserId, (db) => listRemediationActionsForEngagement(db, fx.leadUserId, { organisationId: fx.organisationId, engagementId: fx.engagementId }));
    expect(actions).toHaveLength(8);
    const statuses = new Set(actions.map((a) => a.status));
    expect(statuses.has("open")).toBe(true);
    expect(statuses.has("in_progress")).toBe(true);
    expect(statuses.has("closed")).toBe(true);
    const { rows: ownerRows } = await asFixtureSetup((c) =>
      c.query(`SELECT DISTINCT owner_id FROM remediation_actions WHERE engagement_id = $1`, [fx.engagementId]),
    );
    expect(ownerRows.length).toBeGreaterThanOrEqual(2); // both leadUserId and secondUserId own at least one each
  });

  // === STAGE 13 — Validation: WORKS =============================================
  it("STAGE 13 — Validation: WORKS (real createValidationRecord domain function — one accepted, one rejected, immutability and reopen-as-separate-action both real)", async () => {
    const records = await withRequestDb(fx.leadUserId, (db) => listValidationRecordsForEngagement(db, fx.leadUserId, { organisationId: fx.organisationId, engagementId: fx.engagementId }));
    expect(records).toHaveLength(2);
    const outcomes = new Set(records.map((v) => v.outcome));
    expect(outcomes).toEqual(new Set(["accepted", "rejected"]));

    // The rejected validation's own RemediationAction was manually
    // reopened afterward (a separate, explicit action) — confirms the
    // real remediation status reflects that.
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT status FROM remediation_actions WHERE id = $1`, [fx.remediationIds.deletionSweep]));
    expect(rows[0]).toMatchObject({ status: "in_progress" });
  });

  // === STAGE 14 — Maturity: MISSING ============================================
  it("STAGE 14 — Maturity: MISSING (database storage/RLS/immutability exist from Milestone 8, but NO calculation engine and NO application layer exist — this fixture deliberately writes no Maturity data)", async () => {
    // Confirmed by direct inspection, not assumption: the test suite's
    // OWN fixture helper for MaturityScore (tests/maturity/helpers.ts)
    // takes `score`/`maturityLevel` as direct caller-supplied inputs —
    // proof, from the repository's own code, that no computation logic
    // exists anywhere, even at the database trigger level. This
    // fixture therefore writes zero Maturity rows: any score would be
    // arbitrary, fabricated data, exactly what instructions §12 forbid
    // ("do not build a new maturity engine... do not invent a score").
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT count(*)::int AS n FROM maturity_assessments WHERE engagement_id = $1`, [fx.engagementId]));
    expect(rows[0]!.n).toBe(0);

    expect(repoFileExists("lib/domain/maturity.ts")).toBe(false);
    expect(repoFileExists("app/(shell)/organisations/[organisationId]/engagements/[engagementId]/maturity")).toBe(false);
  });

  // === STAGE 15 — Engagement Report: WORKS ======================================
  it("STAGE 15 — Engagement Report: WORKS (real getEngagementReportData + renderEngagementReportPdf, Slice R1 — a real PDF reflecting this exact reference engagement)", async () => {
    const data = await withRequestDb(fx.leadUserId, (db) => getEngagementReportData(db, fx.leadUserId, { organisationId: fx.organisationId, engagementId: fx.engagementId }));
    expect(data.engagement.name).toBe(fx.engagementName);
    expect(data.selectedAssessment.id).toBe(fx.assessmentId);
    expect(data.risks).toHaveLength(6);
    expect(data.findings).toHaveLength(7);
    expect(data.remediationActions).toHaveLength(8);
    expect(data.validationRecords).toHaveLength(2);
    expect(data.evidenceItems).toHaveLength(9);

    const pdf = await renderEngagementReportPdf(data, { generatedByEmail: "ananya.krishnan.demo@primusprivacy.example" });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const { text, numPages, textByPage } = await extractPdfText(pdf);
    // 10 sections, but unlike R1's own small-fixture test (exactly one
    // page per section), THIS fixture's larger row counts (25 controls,
    // 6 risks, 7 findings, 8 remediation actions, 9 evidence items)
    // legitimately overflow some sections onto a second page — real
    // pdfkit pagination, not the R1 footer bug (DECISIONS.md R-126;
    // that bug produced near-EMPTY extra pages, which this per-page
    // content check still guards against here).
    expect(numPages).toBeGreaterThanOrEqual(10);
    expect(numPages).toBeLessThanOrEqual(16);
    for (const page of textByPage) {
      expect(page.replace(/PRIMUS PRIVACY — Confidential — .*/, "").trim().length).toBeGreaterThan(20);
    }
    pdfText = text;

    expect(pdfText).toContain("ABC Fintech Private Limited");
    expect(pdfText).toContain(fx.assessmentId);
    // No Maturity or ROPA/Data Landscape SECTION exists in R1 — confirm
    // the report never fabricates one, even though this reference
    // engagement has real ROPA data sitting in the database. (The
    // demo Control Library's own ACC-01 control legitimately mentions
    // "processing activities" in its title/rationale — that is real
    // Assessment Results content, not a fabricated ROPA section, so it
    // is not asserted against here.)
    expect(pdfText).not.toMatch(/\bmaturity\b/i);
    expect(pdfText).not.toMatch(/data landscape/i);
    expect(pdfText).not.toMatch(/\bropa\b/i);

    const outPath = "/tmp/claude-0/-home-user-primus-privacy/23021838-42c1-5e6f-9940-0a46135f42a6/scratchpad/reference-engagement-report.pdf";
    writeFileSync(outPath, pdf);
  });
});
