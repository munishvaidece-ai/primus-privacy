// Slice C4 — Findings Management. Tests the real functions the real
// Risk detail/Server Actions call (lib/domain/findings.ts) against real
// PostgreSQL — no mocked authorization. Covers the required database/
// application security scenarios (PHASE C4 instructions §24), the
// traceability scenario (§25), and update tests (§26).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createFinding,
  updateFinding,
  listFindingsForEngagement,
  listFindingsForRisk,
  getFindingDetail,
  InvalidFindingInputError,
} from "@/lib/domain/findings";
import { createRisk, getRiskDetail } from "@/lib/domain/risks";
import { getControlTestsForControl } from "@/lib/domain/assessments";
import { getEvidenceSummaryForControl, uploadEvidence } from "@/lib/domain/evidence";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import {
  asUser,
  asAnon,
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
  createAssessment,
  finalizeAssessment,
  addAssessmentControl,
  createAssessmentResponse,
  createRiskScoringModel,
  pool,
} from "./helpers";

function textFile(content = "synthetic evidence content — not a real client document") {
  return { buffer: Buffer.from(content, "utf8"), filename: "evidence.txt", mimeType: "text/plain" };
}

describe("Application layer — Findings Management (Slice C4)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string, engagementA2: string, engagementA3: string, engagementB: string;
  let controlA1: string, controlB1: string;
  let assessmentA: string, assessmentAFinalized: string, assessmentA2: string, assessmentA3: string, assessmentB: string;

  let userA: string; // engagement member of engagementA
  let outsiderA: string; // tenant A, no membership anywhere
  let userA2: string; // engagement member of engagementA2
  let userA3: string; // engagement member of engagementA3
  let userB: string; // engagement member of engagementB

  let responseA1: string;
  let riskA1: string; // Risk from (assessmentA, controlA1)
  let riskAFinalized: string; // Risk from a finalized assessment's control
  let riskA2: string; // Risk under orgA2/engagementA2
  let riskA3: string; // Risk under orgA/engagementA3
  let riskB: string; // Risk under tenantB

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice C4 Tenant A");
      tenantB = await createTenant(client, "Slice C4 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice C4 Org A");
      orgA2 = await createOrganisation(client, tenantA, "Slice C4 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice C4 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "Slice C4 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Slice C4 Engagement A2");
      engagementA3 = await createEngagement(client, tenantA, orgA, "Slice C4 Engagement A3 (same org as A)");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice C4 Engagement B");

      const libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C4 Library A" });
      controlA1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Slice C4 Control 1" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA2, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA3, libraryA);

      const libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Slice C4 Library B" });
      controlB1 = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "B1", title: "Slice C4 Control B1" });
      await publishControlLibraryVersion(client, libraryB);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      await createRiskScoringModel(client, { tenantId: tenantA, name: "C4 Matrix A", version: "v1.0" });
      await createRiskScoringModel(client, { tenantId: tenantB, name: "C4 Matrix B", version: "v1.0" });

      assessmentA = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026" });
      assessmentAFinalized = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (finalized)" });
      assessmentA2 = await createAssessment(client, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Org A2)" });
      assessmentA3 = await createAssessment(client, { engagementId: engagementA3, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Engagement A3)" });
      assessmentB = await createAssessment(client, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, controlLibraryVersionId: libraryB, periodLabel: "FY2026 (Tenant B)" });

      const assessmentControlA1 = await addAssessmentControl(client, { assessmentId: assessmentA, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      const assessmentControlAFinalized = await addAssessmentControl(client, { assessmentId: assessmentAFinalized, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentA2, controlId: controlA1, tenantId: tenantA, organisationId: orgA2, engagementId: engagementA2, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentA3, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA3, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentB, controlId: controlB1, tenantId: tenantB, organisationId: orgB, engagementId: engagementB, controlLibraryVersionId: libraryB });

      userA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA, engagementA);
      outsiderA = await createUser(client, { tenantId: tenantA });
      userA2 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA2, engagementA2);
      userA3 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA3, engagementA3);
      userB = await createUser(client, { tenantId: tenantB });
      await grantEngagementMembership(client, userB, engagementB);

      responseA1 = await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlA1,
        tenantId: tenantA,
        organisationId: orgA,
        engagementId: engagementA,
        effectivenessRating: "not_implemented",
        respondentId: userA,
      });

      await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlAFinalized,
        tenantId: tenantA,
        organisationId: orgA,
        engagementId: engagementA,
        effectivenessRating: "not_implemented",
      });
      await finalizeAssessment(client, assessmentAFinalized);
    });

    // Real Risks, created through the real domain function (Slice C3),
    // to attach Findings to — matching this project's own established
    // "build fixtures through real application code where practical"
    // convention for cross-slice test data.
    riskA1 = (await withRequestDb(userA, (db) => createRisk(db, userA, { assessmentId: assessmentA, controlId: controlA1, title: "Source risk A1", description: null, likelihood: 4, impact: 4, inherentRating: "high", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    riskAFinalized = (await withRequestDb(userA, (db) => createRisk(db, userA, { assessmentId: assessmentAFinalized, controlId: controlA1, title: "Source risk from finalized assessment", description: null, likelihood: 5, impact: 5, inherentRating: "critical", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    riskA2 = (await withRequestDb(userA2, (db) => createRisk(db, userA2, { assessmentId: assessmentA2, controlId: controlA1, title: "Source risk A2", description: null, likelihood: 3, impact: 3, inherentRating: "medium", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    riskA3 = (await withRequestDb(userA3, (db) => createRisk(db, userA3, { assessmentId: assessmentA3, controlId: controlA1, title: "Source risk A3", description: null, likelihood: 3, impact: 3, inherentRating: "medium", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    riskB = (await withRequestDb(userB, (db) => createRisk(db, userB, { assessmentId: assessmentB, controlId: controlB1, title: "Source risk B", description: null, likelihood: 3, impact: 3, inherentRating: "medium", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Application-layer behavior --------------------------------------

  it("createFinding success: creates Finding + FindingRisk, scoped from the source Risk's own authoritative row", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createFinding(db, userA, {
        riskId: riskA1,
        title: "Access control gap",
        description: "No MFA enforced.",
        severity: "high",
        assignOwnerToSelf: true,
      }),
    );

    const { rows } = await asFixtureSetup((c) => c.query("SELECT * FROM findings WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({
      tenant_id: tenantA,
      organisation_id: orgA,
      engagement_id: engagementA,
      severity: "high",
      status: "open",
      owner_id: userA,
    });

    const { rows: linkRows } = await asFixtureSetup((c) => c.query("SELECT * FROM finding_risks WHERE finding_id = $1", [id]));
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0]).toMatchObject({ risk_id: riskA1, tenant_id: tenantA, organisation_id: orgA, engagement_id: engagementA });
  });

  it("createFinding without self-assignment — owner_id stays null", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createFinding(db, userA, { riskId: riskA1, title: "Unassigned finding", description: null, severity: "low", assignOwnerToSelf: false }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT owner_id FROM findings WHERE id = $1", [id]));
    expect(rows[0]!.owner_id).toBeNull();
  });

  it("createFinding against a nonexistent Risk is rejected", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createFinding(db, userA, { riskId: "00000000-0000-0000-0000-000000000000", title: "Should fail", description: null, severity: "low", assignOwnerToSelf: false }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("createFinding with an empty title is rejected before any database write", async () => {
    await expect(
      withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskA1, title: "   ", description: null, severity: "low", assignOwnerToSelf: false })),
    ).rejects.toThrow(InvalidFindingInputError);
  });

  it("createFinding is NOT blocked by a finalized Assessment (mirrors DECISIONS.md R-98's identical Risk conclusion)", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createFinding(db, userA, { riskId: riskAFinalized, title: "Finding from a finalized assessment's risk", description: null, severity: "critical", assignOwnerToSelf: false }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM findings WHERE id = $1", [id]));
    expect(rows).toHaveLength(1);
  });

  it("updateFinding: title/description/severity/status/owner (assign_self, then unassign) all update correctly", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createFinding(db, userA, { riskId: riskA1, title: "Original title", description: "Original", severity: "low", assignOwnerToSelf: false }),
    );

    await withRequestDb(userA, (db) =>
      updateFinding(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        findingId: id,
        title: "Updated title",
        description: "Updated description",
        severity: "critical",
        status: "in_progress",
        ownerAction: "assign_self",
      }),
    );
    let row = (await asFixtureSetup((c) => c.query("SELECT * FROM findings WHERE id = $1", [id]))).rows[0];
    expect(row).toMatchObject({ title: "Updated title", description: "Updated description", severity: "critical", status: "in_progress", owner_id: userA });

    await withRequestDb(userA, (db) =>
      updateFinding(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        findingId: id,
        title: "Updated title",
        description: "Updated description",
        severity: "critical",
        status: "resolved",
        ownerAction: "unassign",
      }),
    );
    row = (await asFixtureSetup((c) => c.query("SELECT status, owner_id FROM findings WHERE id = $1", [id]))).rows[0];
    expect(row).toMatchObject({ status: "resolved", owner_id: null });
  });

  it("updateFinding with an empty title is rejected", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createFinding(db, userA, { riskId: riskA1, title: "Has a title", description: null, severity: "low", assignOwnerToSelf: false }),
    );
    await expect(
      withRequestDb(userA, (db) =>
        updateFinding(db, userA, { organisationId: orgA, engagementId: engagementA, findingId: id, title: "  ", description: null, severity: "low", status: "open", ownerAction: "keep" }),
      ),
    ).rejects.toThrow(InvalidFindingInputError);
  });

  // --- Required security scenarios (PHASE C4 instructions §24) ---------

  it("1. Tenant A cannot read Tenant B's Finding", async () => {
    const { id: findingB } = await withRequestDb(userB, (db) => createFinding(db, userB, { riskId: riskB, title: "Tenant B finding", description: null, severity: "medium", assignOwnerToSelf: false }));
    await expect(
      withRequestDb(userA, (db) => getFindingDetail(db, userA, { organisationId: orgB, engagementId: engagementB, findingId: findingB })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("2. Organisation A cannot read Organisation A2's Finding (same tenant)", async () => {
    const { id: findingA2 } = await withRequestDb(userA2, (db) => createFinding(db, userA2, { riskId: riskA2, title: "Org A2 finding", description: null, severity: "medium", assignOwnerToSelf: false }));
    await expect(
      withRequestDb(userA, (db) => getFindingDetail(db, userA, { organisationId: orgA2, engagementId: engagementA2, findingId: findingA2 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("3. Engagement A cannot read Engagement A3's Finding (same organisation)", async () => {
    const { id: findingA3 } = await withRequestDb(userA3, (db) => createFinding(db, userA3, { riskId: riskA3, title: "Engagement A3 finding", description: null, severity: "medium", assignOwnerToSelf: false }));
    await expect(
      withRequestDb(userA, (db) => getFindingDetail(db, userA, { organisationId: orgA, engagementId: engagementA3, findingId: findingA3 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4. A user authorized only for their own tenant cannot create a Finding against another tenant's Risk (Risk A context cannot reach Risk B)", async () => {
    await expect(
      withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskB, title: "Should be rejected", description: null, severity: "medium", assignOwnerToSelf: false })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("5. Unauthorized user (no membership at all) cannot create a Finding", async () => {
    await expect(
      withRequestDb(outsiderA, (db) => createFinding(db, outsiderA, { riskId: riskA1, title: "Should be rejected", description: null, severity: "medium", assignOwnerToSelf: false })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("6. Unauthorized user (no membership at all) cannot update a Finding", async () => {
    const { id } = await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskA1, title: "Target finding", description: null, severity: "medium", assignOwnerToSelf: false }));
    await expect(
      withRequestDb(outsiderA, (db) =>
        updateFinding(db, outsiderA, { organisationId: orgA, engagementId: engagementA, findingId: id, title: "Hijacked", description: null, severity: "critical", status: "resolved", ownerAction: "keep" }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("7. Anonymous access is rejected", async () => {
    await expect(asAnon((c) => c.query("SELECT * FROM findings LIMIT 1"))).rejects.toThrow();
    await expect(
      asAnon((c) =>
        c.query(
          `INSERT INTO findings (engagement_id, organisation_id, tenant_id, title, severity) VALUES ($1, $2, $3, 'Anon attempt', 'low')`,
          [engagementA, orgA, tenantA],
        ),
      ),
    ).rejects.toThrow();
  });

  it("8. Browser-supplied forged scope ids cannot cross a tenant boundary even with a real Finding id", async () => {
    const { id } = await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskA1, title: "Real finding, forged scope on update", description: null, severity: "medium", assignOwnerToSelf: false }));
    await expect(
      withRequestDb(userA, (db) =>
        updateFinding(db, userA, { organisationId: orgB, engagementId: engagementB, findingId: id, title: "Should be rejected", description: null, severity: "critical", status: "resolved", ownerAction: "keep" }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("9. Cross-tenant Finding owner is rejected by the database (mirrors migration 0020's identical fix for risks, migration 0021 for findings)", async () => {
    await expect(
      asUser(userA, (c) =>
        c.query(
          `INSERT INTO findings (engagement_id, organisation_id, tenant_id, title, severity, owner_id) VALUES ($1, $2, $3, 'Cross-tenant owner', 'low', $4)`,
          [engagementA, orgA, tenantA, userB],
        ),
      ),
    ).rejects.toThrow(/findings_owner_id_tenant_fk/);
  });

  it("10. A direct, malicious raw INSERT with forged tenant/organisation/engagement is rejected by RLS", async () => {
    await expect(
      asUser(userA, (c) =>
        c.query(`INSERT INTO findings (engagement_id, organisation_id, tenant_id, title, severity) VALUES ($1, $2, $3, 'Forged scope', 'low')`, [
          engagementB,
          orgB,
          tenantB,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("11. A Finding's source Risk relationship cannot cross a tenant boundary (finding_risks_risk_scope_fk)", async () => {
    const { id: findingId } = await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskA1, title: "Legit finding", description: null, severity: "medium", assignOwnerToSelf: false }));
    await expect(
      asFixtureSetup((c) =>
        c.query(`INSERT INTO finding_risks (finding_id, risk_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5)`, [
          findingId,
          riskB,
          tenantA,
          orgA,
          engagementA,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("12. Cross-tenant Evidence cannot be surfaced through a Finding's traceability read path (RLS-filtered even when the id is known)", async () => {
    const tenantBResponseId = (
      await asFixtureSetup((c) =>
        c.query(
          `INSERT INTO assessment_responses (assessment_control_id, tenant_id, organisation_id, engagement_id, effectiveness_rating)
           VALUES ((SELECT id FROM assessment_controls WHERE assessment_id = $1 LIMIT 1), $2, $3, $4, 'implemented') RETURNING id`,
          [assessmentB, tenantB, orgB, engagementB],
        ),
      )
    ).rows[0].id;
    await withRequestDb(userB, (db) =>
      uploadEvidence(db, userB, {
        organisationId: orgB,
        engagementId: engagementB,
        title: "Tenant B evidence",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: tenantBResponseId },
        file: textFile(),
      }),
    );
    const rows = await withRequestDb(userA, (db) => getEvidenceSummaryForControl(db, tenantBResponseId, [], true));
    expect(rows).toHaveLength(0);
  });

  it("13. Finalized-assessment behavior matches the approved database rules — no trigger on findings/finding_risks references Assessment finalization", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT trigger_name FROM information_schema.triggers WHERE event_object_table IN ('findings', 'finding_risks')`),
    );
    for (const row of rows) {
      expect(row.trigger_name).not.toMatch(/finaliz/i);
    }
  });

  it("14. Audit attribution identifies the acting user for both Finding creation and update", async () => {
    const { id } = await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskA1, title: "Audit check finding", description: null, severity: "medium", assignOwnerToSelf: false }));
    await withRequestDb(userA, (db) =>
      updateFinding(db, userA, { organisationId: orgA, engagementId: engagementA, findingId: id, title: "Audit check finding (updated)", description: null, severity: "high", status: "in_progress", ownerAction: "keep" }),
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT action, actor_user_id, field_changes FROM audit_log WHERE entity_type = 'findings' AND entity_id = $1 ORDER BY occurred_at ASC`, [id]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: "insert", actor_user_id: userA });
    expect(rows[1]).toMatchObject({ action: "update", actor_user_id: userA });
    expect(rows[1]!.field_changes.new.severity).toBe("high");
    expect(rows[1]!.field_changes.old.severity).toBe("medium");
  });

  // --- Traceability (PHASE C4 instructions §25) -------------------------

  it("Full chain: Assessment A → Control C1 → Response → Risk R1 → Finding F1 → Evidence E1 remains queryable end-to-end; Tenant B cannot traverse any part of it", async () => {
    const chainRisk = (
      await withRequestDb(userA, (db) =>
        createRisk(db, userA, { assessmentId: assessmentA, controlId: controlA1, title: "Chain risk", description: null, likelihood: 4, impact: 4, inherentRating: "high", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }),
      )
    ).id;
    const chainFinding = (
      await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: chainRisk, title: "Chain finding", description: null, severity: "high", assignOwnerToSelf: false }))
    ).id;
    await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Chain evidence",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: textFile(),
      }),
    );

    // Full chain, resolved exactly as the Finding detail page itself
    // composes it — no shortcuts, no direct SQL beyond what the page
    // and its domain functions actually do.
    const findingDetail = await withRequestDb(userA, (db) => getFindingDetail(db, userA, { organisationId: orgA, engagementId: engagementA, findingId: chainFinding }));
    expect(findingDetail.sourceRisks[0]!.id).toBe(chainRisk);

    const riskDetail = await withRequestDb(userA, (db) => getRiskDetail(db, userA, { organisationId: orgA, engagementId: engagementA, riskId: chainRisk }));
    expect(riskDetail.sourceAssessment?.id).toBe(assessmentA);
    expect(riskDetail.sourceControls[0]!.id).toBe(controlA1);
    expect(riskDetail.sourceAssessmentResponse?.id).toBe(responseA1);

    const [tests, evidence] = await withRequestDb(userA, async (db) => {
      const t = await getControlTestsForControl(db, riskDetail.sourceAssessment!.id, riskDetail.sourceControls[0]!.id);
      const e = await getEvidenceSummaryForControl(db, riskDetail.sourceAssessmentResponse!.id, t.map((x) => x.id), true);
      return [t, e] as const;
    });
    void tests;
    expect(evidence.some((e) => e.title === "Chain evidence")).toBe(true);

    // Tenant B cannot traverse any part of this chain, even with the
    // real ids (all already proven individually above by tests 1/12 —
    // re-confirmed here specifically against THIS chain's own ids).
    await expect(
      withRequestDb(userB, (db) => getFindingDetail(db, userB, { organisationId: orgA, engagementId: engagementA, findingId: chainFinding })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(
      withRequestDb(userB, (db) => getRiskDetail(db, userB, { organisationId: orgA, engagementId: engagementA, riskId: chainRisk })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // --- Read functions ----------------------------------------------------

  it("listFindingsForEngagement returns findings scoped to the engagement with source risk identity", async () => {
    const rows = await withRequestDb(userA, (db) => listFindingsForEngagement(db, userA, { organisationId: orgA, engagementId: engagementA }));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.sourceRiskTitle).toBeTruthy();
    }
  });

  it("listFindingsForRisk is scoped to exactly one Risk", async () => {
    const { id } = await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskA1, title: "Scoped-to-risk finding", description: null, severity: "medium", assignOwnerToSelf: false }));
    const rowsForA1 = await withRequestDb(userA, (db) => listFindingsForRisk(db, riskA1));
    const rowsForAFinalized = await withRequestDb(userA, (db) => listFindingsForRisk(db, riskAFinalized));
    expect(rowsForA1.some((r) => r.id === id)).toBe(true);
    expect(rowsForAFinalized.some((r) => r.id === id)).toBe(false);
  });
});
