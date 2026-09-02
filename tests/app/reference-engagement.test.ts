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
import { getControlLibraryVersionDetail, updateControl, ControlLibraryVersionNotDraftError } from "@/lib/domain/control-library";
import { listProcessingActivities, listRopaEntries } from "@/lib/domain/processing-activities";
import { getEngagementScopeDetail } from "@/lib/domain/applicability";

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

  // === STAGE 3 — Data Landscape / Processing Activities / ROPA: YES (Slice D2) ====
  it("STAGE 3 — Data Landscape / ROPA: YES (Slice D2 — real application/domain layer, no raw SQL/developer intervention)", async () => {
    // This reference engagement's own Data Landscape — master data
    // (Business Units, Systems, Data Stores, Processors, Purposes,
    // Personal Data Elements, Data Principal Categories) and all ten
    // Processing Activities — was built entirely through the real
    // domain layer (reference-engagement-fixture.ts, since Slice D2),
    // re-verified here via the same real READ functions a real
    // `/data-landscape` page and `/master-data/[category]` page would
    // call, not raw SQL.
    const activities = await withRequestDb(fx.leadUserId, (db) =>
      listProcessingActivities(db, fx.leadUserId, { engagementId: fx.engagementId, organisationId: fx.organisationId }),
    );
    expect(activities).toHaveLength(10);
    expect(activities.map((a) => a.name).sort()).toEqual(
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
    for (const a of activities) {
      expect(a.lifecycleStatus).toBe("active");
    }

    // ROPA: the connective read view over Processing Activities and
    // their relationships — every category resolves to a real, named
    // master-data entity, not merely an id.
    const ropa = await withRequestDb(fx.leadUserId, (db) =>
      listRopaEntries(db, fx.leadUserId, { engagementId: fx.engagementId, organisationId: fx.organisationId }),
    );
    expect(ropa).toHaveLength(10);
    const onboarding = ropa.find((e) => e.name === "Customer onboarding")!;
    expect(onboarding.lawfulBasis).toBe("Consent");
    expect(onboarding.purposes.map((p) => p.name)).toContain("Customer Onboarding");
    expect(onboarding.systems.map((s) => s.name)).toContain("Customer Onboarding Portal");
    expect(onboarding.personalDataElements.map((e) => e.name)).toContain("Full Name");
    expect(onboarding.dataPrincipalCategories.map((c) => c.name)).toContain("Customers");

    // VERSIONING / HISTORICAL INTEGRITY: master data has real version
    // history (identity + SCD2 version split) — proven directly, since
    // no domain read surfaces anything but the current version.
    const { rows: systemVersionRows } = await asFixtureSetup((c) =>
      c.query(`SELECT count(*)::int AS n FROM system_versions sv JOIN systems s ON s.id = sv.system_id WHERE s.organisation_id = $1`, [fx.organisationId]),
    );
    expect(systemVersionRows[0].n).toBeGreaterThanOrEqual(4); // one version per system created — none rewritten

    // The application layer this fixture actually used to build the
    // Data Landscape above genuinely exists — both domain modules and
    // the full UI route tree.
    expect(repoFileExists("lib/domain/master-data.ts")).toBe(true);
    expect(repoFileExists("lib/domain/processing-activities.ts")).toBe(true);
    expect(repoFileExists("app/(shell)/organisations/[organisationId]/master-data/[category]")).toBe(true);
    expect(
      repoFileExists("app/(shell)/organisations/[organisationId]/engagements/[engagementId]/data-landscape"),
    ).toBe(true);
    expect(
      repoFileExists("app/(shell)/organisations/[organisationId]/engagements/[engagementId]/data-landscape/ropa"),
    ).toBe(true);
  });

  // === STAGE 4 — Applicability / Scope: YES (Slice D3) =======================
  it("STAGE 4 — Applicability / Scope: YES (Slice D3 — real application/domain layer, no raw SQL/developer intervention)", async () => {
    // The Scope built for ABC Fintech (reference-engagement-fixture.ts,
    // since Slice D3) is locked and covers every one of the 25 demo
    // Controls — re-verified here via the same real READ function a
    // real `/scope/[scopeId]` page would call, not raw SQL.
    const scope = await withRequestDb(fx.leadUserId, (db) => getEngagementScopeDetail(db, fx.leadUserId, fx.engagementScopeId));
    expect(scope.status).toBe("locked");
    expect(scope.controlRows).toHaveLength(25);

    const byDecision = { applicable: 0, not_applicable: 0, undecided: 0 };
    for (const row of scope.controlRows) byDecision[row.decision as keyof typeof byDecision]++;
    // All three states genuinely present — Undecided is real, explicit
    // row state (CRITICAL semantic requirement), never conflated with a
    // defaulted-away "Applicable".
    expect(byDecision.applicable).toBe(21);
    expect(byDecision.not_applicable).toBe(2);
    expect(byDecision.undecided).toBe(2);

    const chi01 = scope.controlRows.find((r) => r.controlCode === "CHI-01")!;
    expect(chi01.decision).toBe("not_applicable");
    expect(chi01.rationale).toContain("children");
    expect(chi01.decidedByEmail).toBeTruthy();

    const undecidedRow = scope.controlRows.find((r) => r.decision === "undecided")!;
    expect(undecidedRow.rationale).toBeNull();
    expect(undecidedRow.decidedByEmail).toBeNull();

    // RegulatoryReference-level applicability (DATA_MODEL.md §4) —
    // narrative, genuinely distinct from the Control-level decisions
    // above.
    expect(scope.determinations).toHaveLength(1);
    expect(scope.determinations[0]!.decisionValue).toBe("applicable");
    expect(scope.determinations[0]!.regulatoryReferences.length).toBeGreaterThan(0);

    // ASSESSMENT INTEGRATION — the whole point of the Control-level
    // layer: the Assessment created after locking this Scope snapshotted
    // it, per-control, without filtering AssessmentControl membership at
    // all (still all 25, exactly as before Slice D3).
    const { rows: snapshotRows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT ac.applicability_decision, ac.applicability_rationale, c.code
           FROM assessment_controls ac JOIN controls c ON c.id = ac.control_id
          WHERE ac.assessment_id = $1 ORDER BY c.code`,
        [fx.assessmentId],
      ),
    );
    expect(snapshotRows).toHaveLength(25);
    const chi01Snapshot = snapshotRows.find((r) => r.code === "CHI-01")!;
    expect(chi01Snapshot.applicability_decision).toBe("not_applicable");
    expect(chi01Snapshot.applicability_rationale).toContain("children");

    // Locked-scope immutability, re-verified directly: attempting to
    // tamper with the locked Scope via raw SQL is rejected by the
    // database trigger, independent of the domain layer.
    await expect(asFixtureSetup((c) => c.query(`UPDATE engagement_scopes SET status = 'draft' WHERE id = $1`, [fx.engagementScopeId]))).rejects.toThrow(/immutable/i);

    // The application layer this fixture actually used to build the
    // Scope above genuinely exists — both the domain module and the
    // full UI route tree.
    expect(repoFileExists("lib/domain/applicability.ts")).toBe(true);
    expect(repoFileExists("app/(shell)/organisations/[organisationId]/engagements/[engagementId]/scope")).toBe(true);
    expect(repoFileExists("app/(shell)/organisations/[organisationId]/engagements/[engagementId]/scope/[scopeId]")).toBe(true);
  });

  // === STAGE 5 — DPDP Controls / Control Library: YES (Slice D1) ============
  it("STAGE 5 — DPDP Controls (Regulatory Content & Control Library): YES (Slice D1 — real application/domain layer authoring, no raw SQL/developer intervention)", async () => {
    // This reference engagement's own demo library was built entirely
    // through the real domain layer (reference-engagement-fixture.ts,
    // since Slice D1) — re-verified here via the real READ function a
    // real `/methodology/control-library/[versionId]` page would call,
    // not a raw SQL query.
    const detail = await withRequestDb(fx.leadUserId, (db) => getControlLibraryVersionDetail(db, fx.leadUserId, fx.controlLibraryVersionId));
    expect(detail.status).toBe("published");
    expect(detail.publishedAt).toBeTruthy(); // set by the real publish trigger, migration 0007 — not settable directly.
    expect(detail.controlRows).toHaveLength(25);
    expect(Object.keys(fx.controlIdByCode)).toHaveLength(25);
    expect(detail.controlRows.every((c) => c.requirements.length > 0)).toBe(true); // every demo control is associated

    // Publication immutability is real, not merely documented — attempt
    // both a domain-layer edit and a raw SQL edit of a published
    // Control, confirming both layers independently reject it, exactly
    // as they would for a real consultant attempting the same thing.
    const anyControlId = Object.values(fx.controlIdByCode)[0]!;
    await expect(
      withRequestDb(fx.leadUserId, (db) => updateControl(db, fx.leadUserId, { controlId: anyControlId, code: "TAMPERED", title: "tampered", description: null, controlType: "preventive" })),
    ).rejects.toThrow(ControlLibraryVersionNotDraftError);
    await expect(asFixtureSetup((c) => c.query(`UPDATE controls SET title = 'tampered' WHERE id = $1`, [anyControlId]))).rejects.toThrow();

    // The application layer this fixture actually used to build the
    // library above genuinely exists — both the domain module and the
    // UI route tree.
    expect(repoFileExists("lib/domain/control-library.ts")).toBe(true);
    expect(repoFileExists("app/(shell)/methodology/control-library")).toBe(true);
    expect(repoFileExists("app/(shell)/methodology/regulatory-content")).toBe(true);
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
