// Milestone 8's exact required scenario (instructions §8): ABC Financial
// FY2026 — Assessment A1 finalized, AssessmentResponses C1=Implemented,
// C2=Partially Implemented, C3=Not Implemented; Risk residual = High;
// one remediation validated. MaturityAssessment MA1 is computed from
// these FY2026 signals. FY2027: a new Assessment is performed, C3 is now
// Implemented, a new risk result exists; MaturityAssessment MA2 is
// created. The database must demonstrate all 8 items instructions §8
// lists.
//
// This milestone builds no scoring *engine* (instructions §16/§18 — no
// dashboards, no invented final methodology); the numeric scores below
// are computed in the test itself, the same way a future Maturity engine
// would, using the synthetic methodology's own `rating_scores`/`levels`
// definition (helpers.ts's default) — the database only stores and pins
// the result, exactly the posture Milestone 7 already established for
// `RiskScoringModel` ("this milestone stores and pins the configuration;
// it does not implement an automatic scoring calculator").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createControlTest,
  createEngagement,
  createMaturityAssessment,
  createMaturityDomain,
  createMaturityDomainWeight,
  createMaturityScore,
  createMaturityScoringMethodology,
  createOrganisation,
  createRisk,
  createRiskScoringModel,
  createRemediationAction,
  createTenant,
  createUser,
  createValidationRecord,
  finalizeAssessment,
  finalizeMaturityAssessment,
  linkMaturityDomainControl,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Historical scenario: ABC Financial FY2026/FY2027 — Maturity", () => {
  let tenant: string, org: string, consultant: string;
  let library: string, controlC1: string, controlC2: string, controlC3: string;
  let domain: string, methodology: string;
  let engagementFY2026: string, assessmentA1: string;
  let responseC1: string, responseC2: string, responseC3: string;
  let scoringModel: string, riskFY2026: string;
  let remediationId: string, validationId: string;
  let ma1: string, ma1DomainScore: string, ma1OverallScore: string;

  let engagementFY2027: string, assessmentA2: string, riskFY2027: string, ma2: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Maturity Historical Scenario Tenant");
      org = await createOrganisation(client, tenant, "ABC Financial Services");
      consultant = await createUser(client, { tenantId: tenant, clientOrgId: org });

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Maturity Scenario Library v1.0" });
      controlC1 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Control C1" });
      controlC2 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C2", title: "Control C2" });
      controlC3 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C3", title: "Control C3" });
      await publishControlLibraryVersion(client, library);

      methodology = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Maturity Scenario Methodology", version: "v1.0" });
      domain = await createMaturityDomain(client, { tenantId: tenant, name: "Test Domain — Governance", code: "SCENARIO_GOVERNANCE" });
      await linkMaturityDomainControl(client, { maturityDomainId: domain, controlId: controlC1, tenantId: tenant });
      await linkMaturityDomainControl(client, { maturityDomainId: domain, controlId: controlC2, tenantId: tenant });
      await linkMaturityDomainControl(client, { maturityDomainId: domain, controlId: controlC3, tenantId: tenant });

      scoringModel = await createRiskScoringModel(client, { tenantId: tenant, name: "Maturity Scenario Risk Matrix", version: "v1.0" });

      // --- FY2026 ---
      engagementFY2026 = await createEngagement(client, tenant, org, "ABC Financial — FY2026");
      await pinEngagementControlLibraryVersion(client, engagementFY2026, library);
      await createMaturityDomainWeight(client, { engagementId: engagementFY2026, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 1.0 });

      assessmentA1 = await createAssessment(client, { engagementId: engagementFY2026, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      const acC1 = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlC1, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, controlLibraryVersionId: library });
      const acC2 = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlC2, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, controlLibraryVersionId: library });
      const acC3 = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlC3, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, controlLibraryVersionId: library });
      responseC1 = await createAssessmentResponse(client, { assessmentControlId: acC1, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, effectivenessRating: "implemented" });
      responseC2 = await createAssessmentResponse(client, { assessmentControlId: acC2, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, effectivenessRating: "partially_implemented" });
      responseC3 = await createAssessmentResponse(client, { assessmentControlId: acC3, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, effectivenessRating: "not_implemented" });
      const ctC1 = await createControlTest(client, { controlId: controlC1, tenantId: tenant, assessmentId: assessmentA1, organisationId: org, engagementId: engagementFY2026, result: "pass" });
      const ctC2 = await createControlTest(client, { controlId: controlC2, tenantId: tenant, assessmentId: assessmentA1, organisationId: org, engagementId: engagementFY2026, result: "exception_noted" });
      const ctC3 = await createControlTest(client, { controlId: controlC3, tenantId: tenant, assessmentId: assessmentA1, organisationId: org, engagementId: engagementFY2026, result: "fail" });
      await finalizeAssessment(client, assessmentA1);

      // Risk: residual risk = High.
      riskFY2026 = await createRisk(client, {
        engagementId: engagementFY2026, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel,
        title: "FY2026 privacy programme risk", likelihood: 4, impact: 4, inherentRating: "high",
        residualLikelihood: 4, residualImpact: 4, residualRating: "high",
      });

      // Validation: one remediation validated.
      remediationId = await createRemediationAction(client, { engagementId: engagementFY2026, organisationId: org, tenantId: tenant, title: "FY2026 remediation", status: "closed" });
      validationId = await createValidationRecord(client, { remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, validatedBy: consultant, outcome: "accepted", rationale: "Confirmed complete." });

      // MaturityAssessment MA1, computed from the FY2026 signals above.
      // Domain score: (implemented=5, partially_implemented=3, not_implemented=1) / 3 = 3 -> "Defined".
      ma1 = await createMaturityAssessment(client, {
        engagementId: engagementFY2026, organisationId: org, tenantId: tenant, assessmentId: assessmentA1, maturityScoringMethodologyId: methodology,
        computedBy: consultant, computedFromRiskIds: [riskFY2026], computedFromValidationRecordIds: [validationId],
      });
      const weightFY2026 = await client.query<{ id: string }>("SELECT id FROM maturity_domain_weights WHERE engagement_id = $1 AND maturity_domain_id = $2", [engagementFY2026, domain]);
      ma1DomainScore = await createMaturityScore(client, {
        maturityAssessmentId: ma1, tenantId: tenant, organisationId: org, engagementId: engagementFY2026,
        maturityDomainId: domain, maturityDomainWeightId: weightFY2026.rows[0]!.id, score: 3, maturityLevel: "Defined",
        computedFromControlTestIds: [ctC1, ctC2, ctC3],
      });
      ma1OverallScore = await createMaturityScore(client, {
        maturityAssessmentId: ma1, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, score: 3, maturityLevel: "Defined",
        computedFromControlTestIds: [ctC1, ctC2, ctC3],
      });
      await finalizeMaturityAssessment(client, ma1);

      // --- FY2027: a new Assessment, C3 is now Implemented, a new risk result exists ---
      engagementFY2027 = await createEngagement(client, tenant, org, "ABC Financial — FY2027");
      await pinEngagementControlLibraryVersion(client, engagementFY2027, library);
      const weightFY2027 = await createMaturityDomainWeight(client, { engagementId: engagementFY2027, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 1.0 });

      assessmentA2 = await createAssessment(client, { engagementId: engagementFY2027, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2027" });
      const acC1b = await addAssessmentControl(client, { assessmentId: assessmentA2, controlId: controlC1, tenantId: tenant, organisationId: org, engagementId: engagementFY2027, controlLibraryVersionId: library });
      const acC2b = await addAssessmentControl(client, { assessmentId: assessmentA2, controlId: controlC2, tenantId: tenant, organisationId: org, engagementId: engagementFY2027, controlLibraryVersionId: library });
      const acC3b = await addAssessmentControl(client, { assessmentId: assessmentA2, controlId: controlC3, tenantId: tenant, organisationId: org, engagementId: engagementFY2027, controlLibraryVersionId: library });
      await createAssessmentResponse(client, { assessmentControlId: acC1b, tenantId: tenant, organisationId: org, engagementId: engagementFY2027, effectivenessRating: "implemented" });
      await createAssessmentResponse(client, { assessmentControlId: acC2b, tenantId: tenant, organisationId: org, engagementId: engagementFY2027, effectivenessRating: "partially_implemented" });
      const responseC3FY2027 = await createAssessmentResponse(client, { assessmentControlId: acC3b, tenantId: tenant, organisationId: org, engagementId: engagementFY2027, effectivenessRating: "implemented" });
      const ctC1b = await createControlTest(client, { controlId: controlC1, tenantId: tenant, assessmentId: assessmentA2, organisationId: org, engagementId: engagementFY2027, result: "pass" });
      const ctC2b = await createControlTest(client, { controlId: controlC2, tenantId: tenant, assessmentId: assessmentA2, organisationId: org, engagementId: engagementFY2027, result: "exception_noted" });
      const ctC3b = await createControlTest(client, { controlId: controlC3, tenantId: tenant, assessmentId: assessmentA2, organisationId: org, engagementId: engagementFY2027, result: "pass" });
      await finalizeAssessment(client, assessmentA2);
      void responseC3FY2027;

      // A new risk result — a new Risk row, explicitly superseding the
      // FY2026 one via previous_risk_id (the same supersession pattern
      // Milestone 7 established), never a mutation of the historical row.
      riskFY2027 = await createRisk(client, {
        engagementId: engagementFY2027, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel,
        title: "FY2027 privacy programme risk", likelihood: 2, impact: 3, inherentRating: "medium",
        residualLikelihood: 2, residualImpact: 2, residualRating: "medium", previousRiskId: riskFY2026,
      });

      // MaturityAssessment MA2 — a separate row, same methodology version
      // (methodology *versioning* itself is covered by
      // methodology-versioning.test.ts; this scenario only needs a
      // second, independent computation).
      // Domain score: (implemented=5, partially_implemented=3, implemented=5) / 3 = 4.33 -> "Managed".
      ma2 = await createMaturityAssessment(client, {
        engagementId: engagementFY2027, organisationId: org, tenantId: tenant, assessmentId: assessmentA2, maturityScoringMethodologyId: methodology,
        computedBy: consultant, computedFromRiskIds: [riskFY2027],
      });
      await createMaturityScore(client, {
        maturityAssessmentId: ma2, tenantId: tenant, organisationId: org, engagementId: engagementFY2027,
        maturityDomainId: domain, maturityDomainWeightId: weightFY2027, score: 4, maturityLevel: "Managed",
        computedFromControlTestIds: [ctC1b, ctC2b, ctC3b],
      });
      await createMaturityScore(client, {
        maturityAssessmentId: ma2, tenantId: tenant, organisationId: org, engagementId: engagementFY2027, score: 4, maturityLevel: "Managed",
        computedFromControlTestIds: [ctC1b, ctC2b, ctC3b],
      });
      await finalizeMaturityAssessment(client, ma2);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // 1. MA1 remains unchanged.
  it("1. MA1 remains unchanged after FY2027 activity", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status, assessment_id, maturity_scoring_methodology_id, engagement_id FROM maturity_assessments WHERE id = $1", [ma1]));
    expect(rows[0]).toMatchObject({ status: "finalized", assessment_id: assessmentA1, maturity_scoring_methodology_id: methodology, engagement_id: engagementFY2026 });
  });

  // 2. MA1 remains linked to its original assessment context.
  it("2. MA1 remains linked to its original assessment context (Assessment A1, FY2026)", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT a.period_label FROM maturity_assessments ma JOIN assessments a ON a.id = ma.assessment_id WHERE ma.id = $1`, [ma1]),
    );
    expect(rows[0]!.period_label).toBe("FY2026");
  });

  // 3. MA1's scores remain unchanged.
  it("3. MA1's scores remain unchanged (domain score 3/Defined, overall score 3/Defined) — the exact same rows, by id", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT id, maturity_domain_id, score, maturity_level FROM maturity_scores WHERE maturity_assessment_id = $1 ORDER BY maturity_domain_id NULLS LAST", [ma1]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: ma1DomainScore, maturity_domain_id: domain, score: 3, maturity_level: "Defined" });
    expect(rows[1]).toMatchObject({ id: ma1OverallScore, maturity_domain_id: null, score: 3, maturity_level: "Defined" });
  });

  // 4. MA2 is a separate maturity assessment.
  it("4. MA2 is a distinct MaturityAssessment row, linked to Assessment A2/FY2027", async () => {
    expect(ma2).not.toBe(ma1);
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT ma.id, a.period_label FROM maturity_assessments ma JOIN assessments a ON a.id = ma.assessment_id WHERE ma.id = $1`, [ma2]),
    );
    expect(rows[0]).toMatchObject({ id: ma2, period_label: "FY2027" });
  });

  // 5. MA2 may have different scores.
  it("5. MA2's scores differ from MA1's (domain/overall score 4/Managed vs 3/Defined)", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT maturity_domain_id, score, maturity_level FROM maturity_scores WHERE maturity_assessment_id = $1 ORDER BY maturity_domain_id NULLS LAST", [ma2]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ score: 4, maturity_level: "Managed" });
    expect(rows[1]).toMatchObject({ score: 4, maturity_level: "Managed" });
  });

  // 6. Current assessment/risk changes cannot silently rewrite MA1.
  it("6. MA1 cannot be rewritten — a direct attempt is rejected, and audit history shows nothing touched it after finalization", async () => {
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE maturity_assessments SET computed_from_risk_ids = ARRAY[$1]::uuid[] WHERE id = $2`, [riskFY2027, ma1])),
    ).rejects.toThrow(/a finalized maturity assessment is immutable/i);

    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT action FROM audit_log WHERE entity_type = 'maturity_assessments' AND entity_id = $1 ORDER BY occurred_at`, [ma1]),
    );
    // insert, then exactly one update (the draft -> finalized transition) — nothing from FY2027 activity appears here.
    expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
  });

  // 7. Historical FY2026 maturity can still be reconstructed.
  it("7. FY2026 maturity is fully reconstructable in one query: assessment context, methodology, and both scores", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT a.period_label, m.version AS methodology_version, ms.maturity_domain_id, ms.score, ms.maturity_level
         FROM maturity_assessments ma
         JOIN assessments a ON a.id = ma.assessment_id
         JOIN maturity_scoring_methodologies m ON m.id = ma.maturity_scoring_methodology_id
         JOIN maturity_scores ms ON ms.maturity_assessment_id = ma.id
         WHERE ma.id = $1
         ORDER BY ms.maturity_domain_id NULLS LAST`,
        [ma1],
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ period_label: "FY2026", methodology_version: "v1.0", maturity_domain_id: domain, score: 3, maturity_level: "Defined" });
    expect(rows[1]).toMatchObject({ period_label: "FY2026", methodology_version: "v1.0", maturity_domain_id: null, score: 3, maturity_level: "Defined" });
  });

  // 8. Scoring methodology/version used by MA1 remains identifiable.
  it("8. the scoring methodology/version MA1 used remains identifiable and unchanged", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT m.name, m.version, m.definition
         FROM maturity_assessments ma JOIN maturity_scoring_methodologies m ON m.id = ma.maturity_scoring_methodology_id
         WHERE ma.id = $1`,
        [ma1],
      ),
    );
    expect(rows[0]).toMatchObject({ name: "Maturity Scenario Methodology", version: "v1.0" });
    // Same methodology row MA2 also used — reused deliberately, not a
    // coincidence of separately-created rows.
    const ma2Methodology = await asFixtureSetup((c) => c.query("SELECT maturity_scoring_methodology_id FROM maturity_assessments WHERE id = $1", [ma2]));
    expect(ma2Methodology.rows[0]!.maturity_scoring_methodology_id).toBe(methodology);
  });
});
