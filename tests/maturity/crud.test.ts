// Basic creation/read coverage for the six Maturity tables (Milestone 8):
// MaturityScoringMethodology, MaturityDomain, MaturityDomainWeight,
// MaturityDomainControlMapping, MaturityAssessment, MaturityScore.
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
  createTenant,
  createUser,
  finalizeAssessment,
  finalizeMaturityAssessment,
  linkMaturityDomainControl,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Maturity CRUD", () => {
  let tenant: string, org: string, engagement: string, consultant: string;
  let library: string, controlC1: string;
  let methodology: string, domain: string, weight: string;
  let assessment: string, assessmentControl: string, response: string, controlTest: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Maturity CRUD Tenant");
      org = await createOrganisation(client, tenant, "Maturity CRUD Client");
      engagement = await createEngagement(client, tenant, org, "Maturity CRUD Engagement");
      consultant = await createUser(client, { tenantId: tenant, clientOrgId: org });

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Maturity CRUD Library" });
      controlC1 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      assessmentControl = await addAssessmentControl(client, { assessmentId: assessment, controlId: controlC1, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      response = await createAssessmentResponse(client, { assessmentControlId: assessmentControl, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      // ControlTest insertion is only allowed while the parent Assessment
      // is still 'draft' (Milestone 5's finalization-immutability guard)
      // — created here, before finalizing.
      controlTest = await createControlTest(client, { controlId: controlC1, tenantId: tenant, assessmentId: assessment, organisationId: org, engagementId: engagement, result: "pass" });
      await finalizeAssessment(client, assessment);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a MaturityScoringMethodology with a jsonb definition", async () => {
    methodology = await asFixtureSetup((c) =>
      createMaturityScoringMethodology(c, { tenantId: tenant, name: "Synthetic Test Methodology", version: "v1.0" }),
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT name, version, is_active FROM maturity_scoring_methodologies WHERE id = $1", [methodology]),
    );
    expect(rows[0]).toMatchObject({ name: "Synthetic Test Methodology", version: "v1.0", is_active: true });
  });

  it("creates a MaturityDomain (clearly synthetic, not a proprietary PRIMUS taxonomy)", async () => {
    domain = await asFixtureSetup((c) =>
      createMaturityDomain(c, { tenantId: tenant, name: "Test Domain — Governance", code: "TEST_GOVERNANCE" }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT name, code FROM maturity_domains WHERE id = $1", [domain]));
    expect(rows[0]).toMatchObject({ name: "Test Domain — Governance", code: "TEST_GOVERNANCE" });
  });

  it("creates a MaturityDomainWeight for this Engagement/domain", async () => {
    weight = await asFixtureSetup((c) =>
      createMaturityDomainWeight(c, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 1.0 }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT weight, is_active FROM maturity_domain_weights WHERE id = $1", [weight]));
    expect(Number(rows[0]!.weight)).toBe(1);
    expect(rows[0]!.is_active).toBe(true);
  });

  it("maps a Control into a MaturityDomain via MaturityDomainControlMapping", async () => {
    const mappingId = await asFixtureSetup((c) => linkMaturityDomainControl(c, { maturityDomainId: domain, controlId: controlC1, tenantId: tenant }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT maturity_domain_id, control_id FROM maturity_domain_control_mappings WHERE id = $1", [mappingId]));
    expect(rows[0]).toMatchObject({ maturity_domain_id: domain, control_id: controlC1 });
  });

  it("creates a MaturityAssessment anchored to the finalized Assessment, in draft status", async () => {
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, {
        engagementId: engagement,
        organisationId: org,
        tenantId: tenant,
        assessmentId: assessment,
        maturityScoringMethodologyId: methodology,
        computedBy: consultant,
      }),
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT status, assessment_id, maturity_scoring_methodology_id, finalized_at FROM maturity_assessments WHERE id = $1", [maturityAssessmentId]),
    );
    expect(rows[0]).toMatchObject({ status: "draft", assessment_id: assessment, maturity_scoring_methodology_id: methodology, finalized_at: null });
  });

  it("creates per-domain and overall MaturityScore rows, then finalizes the MaturityAssessment", async () => {
    // M2 (Maturity Implementation, approval §4)'s new UNIQUE(assessment_id)
    // constraint on `maturity_assessments` means this test needs its own
    // distinct Assessment — the previous test already created one
    // MaturityAssessment for the shared `assessment` fixture.
    const localAssessment = await asFixtureSetup(async (c) => {
      const a = await createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2027" });
      const ac = await addAssessmentControl(c, { assessmentId: a, controlId: controlC1, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(c, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(c, a);
      return a;
    });
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology }),
    );
    const domainScoreId = await asFixtureSetup((c) =>
      createMaturityScore(c, {
        maturityAssessmentId,
        tenantId: tenant,
        organisationId: org,
        engagementId: engagement,
        maturityDomainId: domain,
        maturityDomainWeightId: weight,
        score: 5,
        maturityLevel: "Optimized",
        computedFromControlTestIds: [controlTest],
      }),
    );
    const overallScoreId = await asFixtureSetup((c) =>
      createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, score: 5, maturityLevel: "Optimized" }),
    );
    await asFixtureSetup((c) => finalizeMaturityAssessment(c, maturityAssessmentId));

    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT maturity_domain_id, score, maturity_level FROM maturity_scores WHERE maturity_assessment_id = $1 ORDER BY maturity_domain_id NULLS LAST", [maturityAssessmentId]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ maturity_domain_id: domain, score: 5, maturity_level: "Optimized" });
    expect(rows[1]).toMatchObject({ maturity_domain_id: null, score: 5, maturity_level: "Optimized" });

    const { rows: statusRows } = await asFixtureSetup((c) => c.query("SELECT status, finalized_at FROM maturity_assessments WHERE id = $1", [maturityAssessmentId]));
    expect(statusRows[0]!.status).toBe("finalized");
    expect(statusRows[0]!.finalized_at).not.toBeNull();

    expect(domainScoreId).not.toBe(overallScoreId);
  });
});
