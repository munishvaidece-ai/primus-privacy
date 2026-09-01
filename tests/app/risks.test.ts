// Slice C3 — Risk Engine. Tests the real functions the real Assessment
// workspace/Server Actions call (lib/domain/risks.ts) against real
// PostgreSQL — no mocked authorization. Covers the required database
// (1-10ish, per PHASE C3 instructions §27) and application security
// scenarios, the scoring tests (§28), the historical scenario (§29),
// and Risk/Control/Assessment/Evidence traceability (§4/§17/§18/§19).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createRisk,
  updateRiskStatus,
  listRisksForEngagement,
  listRisksForControl,
  getRiskDetail,
  NoActiveRiskScoringModelError,
  InvalidRiskInputError,
} from "@/lib/domain/risks";
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

describe("Application layer — Risk Engine (Slice C3)", () => {
  let tenantA: string, tenantB: string, tenantC: string;
  let orgA: string, orgA2: string, orgB: string, orgC: string;
  let engagementA: string, engagementA2: string, engagementA3: string, engagementB: string, engagementC: string;
  let libraryA: string, controlA1: string, controlA2: string, controlB1: string;
  let riskScoringModelA: string, riskScoringModelB: string;
  let assessmentA: string, assessmentAFinalized: string, assessmentA2: string, assessmentA3: string, assessmentB: string, assessmentC: string;

  let userA: string; // engagement member of engagementA
  let outsiderA: string; // tenant A, no membership anywhere
  let userA2: string; // engagement member of engagementA2
  let userA3: string; // engagement member of engagementA3
  let userB: string; // engagement member of engagementB
  let userC: string; // engagement member of engagementC

  let responseA1: string; // AssessmentResponse for (assessmentA, controlA1)
  let responseAFinalized: string; // AssessmentResponse for (assessmentAFinalized, controlA1), created before finalizing

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice C3 Tenant A");
      tenantB = await createTenant(client, "Slice C3 Tenant B");
      tenantC = await createTenant(client, "Slice C3 Tenant C (no risk scoring model)");
      orgA = await createOrganisation(client, tenantA, "Slice C3 Org A");
      orgA2 = await createOrganisation(client, tenantA, "Slice C3 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice C3 Org B");
      orgC = await createOrganisation(client, tenantC, "Slice C3 Org C");

      engagementA = await createEngagement(client, tenantA, orgA, "Slice C3 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Slice C3 Engagement A2");
      engagementA3 = await createEngagement(client, tenantA, orgA, "Slice C3 Engagement A3 (same org as A)");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice C3 Engagement B");
      engagementC = await createEngagement(client, tenantC, orgC, "Slice C3 Engagement C");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C3 Library A" });
      controlA1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Slice C3 Control 1" });
      controlA2 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C2", title: "Slice C3 Control 2" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA2, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA3, libraryA);

      const libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Slice C3 Library B" });
      controlB1 = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "B1", title: "Slice C3 Control B1" });
      await publishControlLibraryVersion(client, libraryB);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      const libraryC = await createControlLibraryVersion(client, { tenantId: tenantC, versionLabel: "Slice C3 Library C" });
      const controlC1 = await createControl(client, { tenantId: tenantC, controlLibraryVersionId: libraryC, code: "C1", title: "Slice C3 Control C1" });
      await publishControlLibraryVersion(client, libraryC);
      await pinEngagementControlLibraryVersion(client, engagementC, libraryC);

      // Tenant C deliberately gets NO RiskScoringModel row — used by the
      // "no active scoring model configured" test below.
      riskScoringModelA = await createRiskScoringModel(client, {
        tenantId: tenantA,
        name: "Standard Matrix",
        version: "v1.0",
        matrixDefinition: { scale: "1-5", note: "illustrative only — no real production matrix exists yet" },
      });
      riskScoringModelB = await createRiskScoringModel(client, { tenantId: tenantB, name: "Standard Matrix", version: "v1.0" });

      assessmentA = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026" });
      assessmentAFinalized = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (finalized)" });
      assessmentA2 = await createAssessment(client, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Org A2)" });
      assessmentA3 = await createAssessment(client, { engagementId: engagementA3, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Engagement A3)" });
      assessmentB = await createAssessment(client, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, controlLibraryVersionId: libraryB, periodLabel: "FY2026 (Tenant B)" });
      assessmentC = await createAssessment(client, { engagementId: engagementC, organisationId: orgC, tenantId: tenantC, controlLibraryVersionId: libraryC, periodLabel: "FY2026 (Tenant C)" });

      const assessmentControlA1 = await addAssessmentControl(client, { assessmentId: assessmentA, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentA, controlId: controlA2, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      const assessmentControlAFinalized = await addAssessmentControl(client, { assessmentId: assessmentAFinalized, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentA2, controlId: controlA1, tenantId: tenantA, organisationId: orgA2, engagementId: engagementA2, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentA3, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA3, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentB, controlId: controlB1, tenantId: tenantB, organisationId: orgB, engagementId: engagementB, controlLibraryVersionId: libraryB });
      await addAssessmentControl(client, { assessmentId: assessmentC, controlId: controlC1, tenantId: tenantC, organisationId: orgC, engagementId: engagementC, controlLibraryVersionId: libraryC });

      userA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA, engagementA);
      outsiderA = await createUser(client, { tenantId: tenantA });
      userA2 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA2, engagementA2);
      userA3 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA3, engagementA3);
      userB = await createUser(client, { tenantId: tenantB });
      await grantEngagementMembership(client, userB, engagementB);
      userC = await createUser(client, { tenantId: tenantC });
      await grantEngagementMembership(client, userC, engagementC);

      responseA1 = await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlA1,
        tenantId: tenantA,
        organisationId: orgA,
        engagementId: engagementA,
        effectivenessRating: "partially_implemented",
        respondentId: userA,
      });

      // Created BEFORE finalizing — needed by the finalization tests.
      responseAFinalized = await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlAFinalized,
        tenantId: tenantA,
        organisationId: orgA,
        engagementId: engagementA,
        effectivenessRating: "not_implemented",
      });
      await finalizeAssessment(client, assessmentAFinalized);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Application-layer behavior --------------------------------------

  it("createRisk success: creates Risk + RiskControl pinned to the tenant's active scoring model, with assessment_response_id resolved from the control's existing response", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA1,
        title: "Weak access control on the client database",
        description: "No MFA enforced for privileged database access.",
        likelihood: 4,
        impact: 4,
        inherentRating: "high",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: true,
      }),
    );

    const { rows } = await asFixtureSetup((c) => c.query("SELECT * FROM risks WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({
      tenant_id: tenantA,
      organisation_id: orgA,
      engagement_id: engagementA,
      assessment_response_id: responseA1,
      risk_scoring_model_id: riskScoringModelA,
      inherent_rating: "high",
      status: "open",
      owner_id: userA,
    });

    const { rows: linkRows } = await asFixtureSetup((c) => c.query("SELECT * FROM risk_controls WHERE risk_id = $1", [id]));
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0]).toMatchObject({ control_id: controlA1, tenant_id: tenantA, organisation_id: orgA, engagement_id: engagementA });
  });

  it("createRisk without a recorded AssessmentResponse yet — assessment_response_id stays null", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA2,
        title: "Risk from an unassessed control",
        description: null,
        likelihood: 2,
        impact: 2,
        inherentRating: "low",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT assessment_response_id, owner_id FROM risks WHERE id = $1", [id]));
    expect(rows[0]!.assessment_response_id).toBeNull();
    expect(rows[0]!.owner_id).toBeNull();
  });

  it("createRisk with a full residual triad succeeds", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA1,
        title: "Residual-scored risk",
        description: null,
        likelihood: 4,
        impact: 4,
        inherentRating: "high",
        residualLikelihood: 2,
        residualImpact: 2,
        residualRating: "low",
        assignOwnerToSelf: false,
      }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT residual_likelihood, residual_impact, residual_rating FROM risks WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ residual_likelihood: 2, residual_impact: 2, residual_rating: "low" });
  });

  it("createRisk with a partial residual triad is rejected", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createRisk(db, userA, {
          assessmentId: assessmentA,
          controlId: controlA1,
          title: "Partial residual",
          description: null,
          likelihood: 3,
          impact: 3,
          inherentRating: "medium",
          residualLikelihood: 2,
          residualImpact: null,
          residualRating: null,
          assignOwnerToSelf: false,
        }),
      ),
    ).rejects.toThrow(InvalidRiskInputError);
  });

  it("createRisk with an out-of-range likelihood is rejected before any database write", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createRisk(db, userA, {
          assessmentId: assessmentA,
          controlId: controlA1,
          title: "Invalid likelihood",
          description: null,
          likelihood: 6,
          impact: 3,
          inherentRating: "medium",
          residualLikelihood: null,
          residualImpact: null,
          residualRating: null,
          assignOwnerToSelf: false,
        }),
      ),
    ).rejects.toThrow(InvalidRiskInputError);
  });

  it("createRisk against a Control not in scope for the Assessment is rejected", async () => {
    // controlA2 is genuinely a real, tenant-A control — just never added
    // to assessmentAFinalized's own scope (only controlA1 was).
    await expect(
      withRequestDb(userA, (db) =>
        createRisk(db, userA, {
          assessmentId: assessmentAFinalized,
          controlId: controlA2,
          title: "Should not be creatable",
          description: null,
          likelihood: 3,
          impact: 3,
          inherentRating: "medium",
          residualLikelihood: null,
          residualImpact: null,
          residualRating: null,
          assignOwnerToSelf: false,
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("createRisk is NOT blocked by a finalized Assessment (PHASE C3 instructions §24 — no database trigger locks Risk on Assessment finalization)", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentAFinalized,
        controlId: controlA1,
        title: "Risk identified from a finalized assessment's ineffective control",
        description: null,
        likelihood: 5,
        impact: 5,
        inherentRating: "critical",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT assessment_response_id FROM risks WHERE id = $1", [id]));
    expect(rows[0]!.assessment_response_id).toBe(responseAFinalized);
  });

  it("createRisk fails with NoActiveRiskScoringModelError when the tenant has no active RiskScoringModel", async () => {
    const controlCId = (await asFixtureSetup((c) => c.query("SELECT control_id FROM assessment_controls WHERE assessment_id = $1 LIMIT 1", [assessmentC]))).rows[0].control_id;
    await expect(
      withRequestDb(userC, (db) =>
        createRisk(db, userC, {
          assessmentId: assessmentC,
          controlId: controlCId,
          title: "Cannot be scored — no model configured",
          description: null,
          likelihood: 3,
          impact: 3,
          inherentRating: "medium",
          residualLikelihood: null,
          residualImpact: null,
          residualRating: null,
          assignOwnerToSelf: false,
        }),
      ),
    ).rejects.toThrow(NoActiveRiskScoringModelError);
  });

  it("updateRiskStatus: an authorized engagement member can change status", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA1,
        title: "Risk to mitigate",
        description: null,
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    await withRequestDb(userA, (db) => updateRiskStatus(db, userA, { organisationId: orgA, engagementId: engagementA, riskId: id, status: "mitigating" }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM risks WHERE id = $1", [id]));
    expect(rows[0]!.status).toBe("mitigating");
  });

  // --- Required database security scenarios (PHASE C3 instructions §27) --

  it("1. Tenant A cannot read Tenant B's Risk", async () => {
    const { id: riskB } = await withRequestDb(userB, (db) =>
      createRisk(db, userB, {
        assessmentId: assessmentB,
        controlId: controlB1,
        title: "Tenant B risk",
        description: null,
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    await expect(
      withRequestDb(userA, (db) => getRiskDetail(db, userA, { organisationId: orgB, engagementId: engagementB, riskId: riskB })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("2. Organisation A cannot read Organisation A2's Risk (same tenant, different organisation)", async () => {
    const { id: riskA2 } = await withRequestDb(userA2, (db) =>
      createRisk(db, userA2, {
        assessmentId: assessmentA2,
        controlId: controlA1,
        title: "Org A2 risk",
        description: null,
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    await expect(
      withRequestDb(userA, (db) => getRiskDetail(db, userA, { organisationId: orgA2, engagementId: engagementA2, riskId: riskA2 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("3. Engagement A cannot read Engagement A3's Risk (same organisation, different engagement)", async () => {
    const { id: riskA3 } = await withRequestDb(userA3, (db) =>
      createRisk(db, userA3, {
        assessmentId: assessmentA3,
        controlId: controlA1,
        title: "Engagement A3 risk",
        description: null,
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    await expect(
      withRequestDb(userA, (db) => getRiskDetail(db, userA, { organisationId: orgA, engagementId: engagementA3, riskId: riskA3 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4. A Risk stays correctly attached to the Assessment it actually came from, never conflated with a different Assessment sharing the same Control", async () => {
    const { id: riskFromDraft } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA1,
        title: "From the draft assessment",
        description: null,
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    const { id: riskFromFinalized } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentAFinalized,
        controlId: controlA1,
        title: "From the finalized assessment",
        description: null,
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );

    const detailDraft = await withRequestDb(userA, (db) => getRiskDetail(db, userA, { organisationId: orgA, engagementId: engagementA, riskId: riskFromDraft }));
    const detailFinalized = await withRequestDb(userA, (db) => getRiskDetail(db, userA, { organisationId: orgA, engagementId: engagementA, riskId: riskFromFinalized }));

    expect(detailDraft.sourceAssessment?.id).toBe(assessmentA);
    expect(detailFinalized.sourceAssessment?.id).toBe(assessmentAFinalized);
    expect(detailDraft.sourceAssessment?.id).not.toBe(detailFinalized.sourceAssessment?.id);
  });

  it("5. Unauthorized user (no membership at all) cannot create a Risk", async () => {
    await expect(
      withRequestDb(outsiderA, (db) =>
        createRisk(db, outsiderA, {
          assessmentId: assessmentA,
          controlId: controlA1,
          title: "Should be rejected",
          description: null,
          likelihood: 3,
          impact: 3,
          inherentRating: "medium",
          residualLikelihood: null,
          residualImpact: null,
          residualRating: null,
          assignOwnerToSelf: false,
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("6. Unauthorized user (no membership at all) cannot update a Risk's status", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA1,
        title: "Target risk",
        description: null,
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    await expect(
      withRequestDb(outsiderA, (db) => updateRiskStatus(db, outsiderA, { organisationId: orgA, engagementId: engagementA, riskId: id, status: "closed" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("7. A cross-tenant Control cannot be used to create a Risk (no matching assessment_controls row can exist)", async () => {
    const tenantBControlId = (await asFixtureSetup((c) => c.query("SELECT control_id FROM assessment_controls WHERE assessment_id = $1 LIMIT 1", [assessmentB]))).rows[0].control_id;
    await expect(
      withRequestDb(userA, (db) =>
        createRisk(db, userA, {
          assessmentId: assessmentA,
          controlId: tenantBControlId,
          title: "Should be rejected",
          description: null,
          likelihood: 3,
          impact: 3,
          inherentRating: "medium",
          residualLikelihood: null,
          residualImpact: null,
          residualRating: null,
          assignOwnerToSelf: false,
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("8. Cross-tenant Evidence cannot be surfaced through a Risk's traceability read path (RLS-filtered even when the id is known)", async () => {
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

    // Under Tenant A's own session, ask for the evidence summary using
    // Tenant B's real assessment_response_id — RLS filters it to empty,
    // never leaking Tenant B's evidence through this read path.
    const rows = await withRequestDb(userA, (db) => getEvidenceSummaryForControl(db, tenantBResponseId, []));
    expect(rows).toHaveLength(0);
  });

  it("9. Browser-supplied organisation/engagement ids cannot cross a boundary even with a real Risk id", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA1,
        title: "Real risk, forged scope on update",
        description: null,
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    await expect(
      withRequestDb(userA, (db) => updateRiskStatus(db, userA, { organisationId: orgB, engagementId: engagementB, riskId: id, status: "closed" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("10. A cross-tenant RiskScoringModel cannot be referenced by a Risk — createRisk never accepts a caller-supplied model id, and the database itself rejects a forged one", async () => {
    // Application layer: CreateRiskInput has no risk-scoring-model field
    // at all (compile-time fact — see lib/domain/risks.ts), so there is
    // no code path to even attempt passing one.
    // Database layer backstop: a raw INSERT referencing Tenant B's
    // active model from a Tenant A-scoped Risk row is rejected by
    // risks_risk_scoring_model_tenant_fk.
    await expect(
      asUser(userA, (c) =>
        c.query(
          `INSERT INTO risks (engagement_id, organisation_id, tenant_id, risk_scoring_model_id, title, likelihood, impact, inherent_rating)
           VALUES ($1, $2, $3, $4, 'Forged model', 3, 3, 'medium')`,
          [engagementA, orgA, tenantA, riskScoringModelB],
        ),
      ),
    ).rejects.toThrow();
  });

  it("11. Anonymous access to Risk is rejected", async () => {
    await expect(asAnon((c) => c.query("SELECT * FROM risks LIMIT 1"))).rejects.toThrow();
    await expect(
      asAnon((c) =>
        c.query(
          `INSERT INTO risks (engagement_id, organisation_id, tenant_id, risk_scoring_model_id, title, likelihood, impact, inherent_rating)
           VALUES ($1, $2, $3, $4, 'Anon attempt', 3, 3, 'medium')`,
          [engagementA, orgA, tenantA, riskScoringModelA],
        ),
      ),
    ).rejects.toThrow();
  });

  it("12. A direct, malicious raw INSERT with forged tenant/organisation/engagement is rejected by RLS", async () => {
    await expect(
      asUser(userA, (c) =>
        c.query(
          `INSERT INTO risks (engagement_id, organisation_id, tenant_id, risk_scoring_model_id, title, likelihood, impact, inherent_rating)
           VALUES ($1, $2, $3, $4, 'Forged scope', 3, 3, 'medium')`,
          [engagementB, orgB, tenantB, riskScoringModelB],
        ),
      ),
    ).rejects.toThrow();
  });

  it("13. [DOCUMENTED GAP] the database does not independently prevent assigning a cross-tenant user as owner_id — only the application layer's design (self-assignment only) prevents it in practice", async () => {
    // createRisk (lib/domain/risks.ts) only ever sets owner_id to the
    // calling user's own id — there is no code path in this application
    // that accepts an arbitrary owner. This test proves that guarantee
    // is an APPLICATION-layer discipline, not an independent database
    // backstop: risks.owner_id references users(id) only, with no
    // composite FK tying the owner's tenant to the risk's own tenant, so
    // a raw INSERT naming a real, cross-tenant user as owner is NOT
    // rejected by RLS or any FK. Recorded here and in DECISIONS.md/
    // PROGRESS.md as an honest, known limitation (PHASE C3 instructions
    // §32 forbids adding a new table/column to close this without
    // explicit approval — a composite (id, tenant_id) FK on `users`
    // would be the fix, out of this slice's own scope).
    await expect(
      asUser(userA, (c) =>
        c.query(
          `INSERT INTO risks (engagement_id, organisation_id, tenant_id, risk_scoring_model_id, title, likelihood, impact, inherent_rating, owner_id)
           VALUES ($1, $2, $3, $4, 'Cross-tenant owner (gap)', 3, 3, 'medium', $5)`,
          [engagementA, orgA, tenantA, riskScoringModelA, userB],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("14. Historical scoring configuration cannot be silently replaced — a new RiskScoringModel version does not alter an existing Risk's pin", async () => {
    const { id: riskUnderV1 } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA1,
        title: "Scored under v1.0",
        description: null,
        likelihood: 4,
        impact: 4,
        inherentRating: "high",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );

    const modelV2 = await asFixtureSetup((c) => createRiskScoringModel(c, { tenantId: tenantA, name: "Standard Matrix", version: "v2.0", matrixDefinition: { scale: "1-5", note: "v2" } }));

    const { id: riskUnderV2 } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA2,
        title: "Scored under v2.0",
        description: null,
        likelihood: 2,
        impact: 2,
        inherentRating: "low",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );

    const { rows: v1Row } = await asFixtureSetup((c) => c.query("SELECT risk_scoring_model_id FROM risks WHERE id = $1", [riskUnderV1]));
    const { rows: v2Row } = await asFixtureSetup((c) => c.query("SELECT risk_scoring_model_id FROM risks WHERE id = $1", [riskUnderV2]));
    expect(v1Row[0]!.risk_scoring_model_id).toBe(riskScoringModelA);
    expect(v2Row[0]!.risk_scoring_model_id).toBe(modelV2);
    expect(v1Row[0]!.risk_scoring_model_id).not.toBe(v2Row[0]!.risk_scoring_model_id);

    await expect(
      asFixtureSetup((c) => c.query("UPDATE risks SET risk_scoring_model_id = $1 WHERE id = $2", [modelV2, riskUnderV1])),
    ).rejects.toThrow(/risks\.\{engagement_id,organisation_id,tenant_id,risk_scoring_model_id\} are immutable/i);
  });

  it("15. Finalized-assessment behavior matches the approved database rules — no trigger on risks/risk_controls references Assessment finalization", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT trigger_name FROM information_schema.triggers WHERE event_object_table IN ('risks', 'risk_controls')`,
      ),
    );
    for (const row of rows) {
      expect(row.trigger_name).not.toMatch(/finaliz/i);
    }
  });

  // --- Read functions / traceability -----------------------------------

  it("listRisksForEngagement returns risks scoped to the engagement, most recent first, with source control identity", async () => {
    const rows = await withRequestDb(userA, (db) => listRisksForEngagement(db, userA, { organisationId: orgA, engagementId: engagementA }));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.sourceControlCode).toBeTruthy();
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[i]!.createdAt.getTime());
    }
  });

  it("listRisksForControl is scoped to exactly (engagementId, controlId)", async () => {
    const rowsForA1 = await withRequestDb(userA, (db) => listRisksForControl(db, { engagementId: engagementA, controlId: controlA1 }));
    const rowsForA2 = await withRequestDb(userA, (db) => listRisksForControl(db, { engagementId: engagementA, controlId: controlA2 }));
    expect(rowsForA1.length).toBeGreaterThan(0);
    const a1Ids = new Set(rowsForA1.map((r) => r.id));
    for (const r of rowsForA2) {
      expect(a1Ids.has(r.id)).toBe(false);
    }
  });

  it("getRiskDetail resolves scoring model, source control(s), source assessment, and source assessment response together", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA1,
        title: "Full detail check",
        description: "Description text",
        likelihood: 3,
        impact: 4,
        inherentRating: "high",
        residualLikelihood: 1,
        residualImpact: 1,
        residualRating: "low",
        assignOwnerToSelf: true,
      }),
    );
    const detail = await withRequestDb(userA, (db) => getRiskDetail(db, userA, { organisationId: orgA, engagementId: engagementA, riskId: id }));
    expect(detail.title).toBe("Full detail check");
    // Whichever RiskScoringModel is currently active for tenantA at this
    // point in the file (an earlier test, "14. Historical scoring
    // configuration...", may have already made a v2 active) — this test
    // is about getRiskDetail correctly resolving/joining the scoring
    // model relationship, not about which specific version is active.
    const { rows: activeModelRows } = await asFixtureSetup((c) => c.query("SELECT id FROM risk_scoring_models WHERE tenant_id = $1 AND is_active = true", [tenantA]));
    expect(detail.scoringModel.id).toBe(activeModelRows[0]!.id);
    expect(detail.sourceControls).toHaveLength(1);
    expect(detail.sourceControls[0]!.id).toBe(controlA1);
    expect(detail.sourceAssessment?.id).toBe(assessmentA);
    expect(detail.sourceAssessmentResponse?.effectivenessRating).toBe("partially_implemented");
    expect(detail.ownerEmail).toBeTruthy();
  });

  it("Risk Detail's evidence traceability surfaces the SAME authoritative Evidence the Assessment workspace shows — via the existing getEvidenceSummaryForControl, never a copy", async () => {
    const { id: riskId } = await withRequestDb(userA, (db) =>
      createRisk(db, userA, {
        assessmentId: assessmentA,
        controlId: controlA1,
        title: "Risk with linked evidence",
        description: null,
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      }),
    );
    await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Supporting evidence for the risk's source response",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: textFile(),
      }),
    );

    const detail = await withRequestDb(userA, (db) => getRiskDetail(db, userA, { organisationId: orgA, engagementId: engagementA, riskId }));
    expect(detail.sourceAssessmentResponse?.id).toBe(responseA1);

    const primaryControl = detail.sourceControls[0]!;
    const [tests, evidence] = await withRequestDb(userA, async (db) => {
      const t = await getControlTestsForControl(db, detail.sourceAssessment!.id, primaryControl.id);
      const e = await getEvidenceSummaryForControl(db, detail.sourceAssessmentResponse!.id, t.map((x) => x.id));
      return [t, e] as const;
    });
    void tests;
    expect(evidence.some((e) => e.title === "Supporting evidence for the risk's source response")).toBe(true);
  });
});
