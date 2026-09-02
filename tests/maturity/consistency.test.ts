// Milestone 8 instructions §13 (referential integrity) plus the "source
// Assessment consistency"/"source Risk consistency" required test
// categories (§21). Composite FKs are exercised directly; the two
// additive traceability arrays (`computed_from_risk_ids`/`computed_
// from_validation_record_ids`) are, like DATA_MODEL.md's own literal
// `computed_from_control_test_ids` field, plain uuid arrays — Postgres
// cannot attach a foreign key to an individual array element, so their
// consistency is verified at the application/query level here, and the
// one real gap that leaves is demonstrated directly (not just asserted)
// — see DECISIONS.md.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createMaturityAssessment,
  createMaturityDomain,
  createMaturityDomainWeight,
  createMaturityScore,
  createMaturityScoringMethodology,
  createOrganisation,
  createRisk,
  createRiskScoringModel,
  createTenant,
  finalizeAssessment,
  linkMaturityDomainControl,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("MaturityAssessment source-consistency (composite FKs)", () => {
  let tenant: string, tenantB: string, org: string, orgB: string;
  let engagement: string, engagementOther: string;
  let library: string, control: string, assessment: string, assessmentOther: string;
  let methodology: string, methodologyTenantB: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Maturity Consistency Tenant A");
      tenantB = await createTenant(client, "Maturity Consistency Tenant B");
      org = await createOrganisation(client, tenant, "Maturity Consistency Client A");
      orgB = await createOrganisation(client, tenantB, "Maturity Consistency Client B");
      engagement = await createEngagement(client, tenant, org, "Maturity Consistency Engagement");
      engagementOther = await createEngagement(client, tenant, org, "Maturity Consistency Engagement (other)");

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Maturity Consistency Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Consistency test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);
      await pinEngagementControlLibraryVersion(client, engagementOther, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      const ac = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(client, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(client, assessment);

      // A second, finalized Assessment belonging to a DIFFERENT engagement
      // of the same tenant — used to prove a MaturityAssessment cannot
      // reference an Assessment outside its own engagement.
      assessmentOther = await createAssessment(client, { engagementId: engagementOther, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026 (other engagement)" });
      const acOther = await addAssessmentControl(client, { assessmentId: assessmentOther, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagementOther, controlLibraryVersionId: library });
      await createAssessmentResponse(client, { assessmentControlId: acOther, tenantId: tenant, organisationId: org, engagementId: engagementOther, effectivenessRating: "implemented" });
      await finalizeAssessment(client, assessmentOther);

      methodology = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Consistency test methodology", version: "v1.0" });
      methodologyTenantB = await createMaturityScoringMethodology(client, { tenantId: tenantB, name: "Consistency test methodology B", version: "v1.0" });
      void orgB;
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  it("a MaturityAssessment's assessment_id must belong to its own (engagement, organisation, tenant) — cross-engagement reference rejected", async () => {
    await expect(
      asFixtureSetup((c) =>
        createMaturityAssessment(c, {
          engagementId: engagement, // claims engagement A...
          organisationId: org,
          tenantId: tenant,
          assessmentId: assessmentOther, // ...but assessmentOther really belongs to engagementOther.
          maturityScoringMethodologyId: methodology,
        }),
      ),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it("a MaturityAssessment's maturity_scoring_methodology_id must belong to its own Tenant — cross-tenant methodology rejected", async () => {
    await expect(
      asFixtureSetup((c) =>
        createMaturityAssessment(c, {
          engagementId: engagement,
          organisationId: org,
          tenantId: tenant,
          assessmentId: assessment,
          maturityScoringMethodologyId: methodologyTenantB,
        }),
      ),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });
});

describe("MaturityScore referential integrity", () => {
  let tenant: string, tenantB: string, org: string, engagement: string, engagementOther: string;
  let library: string, control: string, assessment: string, methodology: string;
  let domain: string, domainTenantB: string, weight: string, weightOtherEngagement: string;
  let maturityAssessmentId: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "MaturityScore Consistency Tenant A");
      tenantB = await createTenant(client, "MaturityScore Consistency Tenant B");
      org = await createOrganisation(client, tenant, "MaturityScore Consistency Client");
      engagement = await createEngagement(client, tenant, org, "MaturityScore Consistency Engagement");
      engagementOther = await createEngagement(client, tenant, org, "MaturityScore Consistency Engagement (other)");

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "MaturityScore Consistency Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Consistency test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      const ac = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(client, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(client, assessment);

      methodology = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Score consistency methodology", version: "v1.0" });
      domain = await createMaturityDomain(client, { tenantId: tenant, name: "Score consistency domain", code: "SCORE_CONSISTENCY" });
      domainTenantB = await createMaturityDomain(client, { tenantId: tenantB, name: "Score consistency domain B", code: "SCORE_CONSISTENCY_B" });
      weight = await createMaturityDomainWeight(client, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 1 });
      weightOtherEngagement = await createMaturityDomainWeight(client, { engagementId: engagementOther, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 1 });

      maturityAssessmentId = await createMaturityAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: assessment, maturityScoringMethodologyId: methodology });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  it("maturity_domain_id must belong to the same Tenant — cross-tenant domain rejected", async () => {
    await expect(
      asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, maturityDomainId: domainTenantB, score: 3 })),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it("maturity_domain_weight_id must belong to the same Engagement as the score — cross-engagement weight rejected", async () => {
    await expect(
      asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, maturityDomainId: domain, maturityDomainWeightId: weightOtherEngagement, score: 3 })),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it("a pinned weight cannot be set on the overall row (maturity_domain_id NULL) — weight_requires_domain_check", async () => {
    await expect(
      asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, maturityDomainWeightId: weight, score: 3 })),
    ).rejects.toThrow(/violates check constraint|weight_requires_domain/i);
  });

  it("at most one row per domain per MaturityAssessment", async () => {
    await asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, maturityDomainId: domain, maturityDomainWeightId: weight, score: 3 }));
    await expect(
      asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, maturityDomainId: domain, maturityDomainWeightId: weight, score: 4 })),
    ).rejects.toThrow(/violates unique constraint|maturity_domain_id_key/i);
  });

  it("at most one overall (domain-null) row per MaturityAssessment", async () => {
    await asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, score: 4 }));
    await expect(
      asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, score: 5 })),
    ).rejects.toThrow(/violates unique constraint|one_overall_per_assessment/i);
  });
});

describe("MaturityDomainWeight / MaturityDomainControlMapping referential integrity", () => {
  let tenant: string, tenantB: string, org: string, engagement: string;
  let domain: string, controlTenantB: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Mapping Consistency Tenant A");
      tenantB = await createTenant(client, "Mapping Consistency Tenant B");
      org = await createOrganisation(client, tenant, "Mapping Consistency Client");
      engagement = await createEngagement(client, tenant, org, "Mapping Consistency Engagement");

      domain = await createMaturityDomain(client, { tenantId: tenant, name: "Mapping consistency domain", code: "MAPPING_CONSISTENCY" });

      const libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Mapping Consistency Library B" });
      controlTenantB = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "CB1", title: "Tenant B control" });
      void engagement;
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  it("MaturityDomainControlMapping rejects a Control belonging to a different Tenant", async () => {
    await expect(
      asFixtureSetup((c) => linkMaturityDomainControl(c, { maturityDomainId: domain, controlId: controlTenantB, tenantId: tenant })),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });
});

describe("Source Risk/Validation traceability — application-level, not FK-enforced (afterAll ends the shared pool for this file)", () => {
  let tenant: string, org: string, engagement: string;
  let library: string, control: string, assessment: string, methodology: string, scoringModel: string;
  let riskId: string, maturityAssessmentId: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Traceability Tenant");
      org = await createOrganisation(client, tenant, "Traceability Client");
      engagement = await createEngagement(client, tenant, org, "Traceability Engagement");

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Traceability Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Traceability control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      const ac = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(client, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(client, assessment);

      methodology = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Traceability methodology", version: "v1.0" });
      scoringModel = await createRiskScoringModel(client, { tenantId: tenant, name: "Traceability risk matrix", version: "v1.0" });
      riskId = await createRisk(client, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Traceability risk", likelihood: 4, impact: 4, inherentRating: "high" });

      maturityAssessmentId = await createMaturityAssessment(client, {
        engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: assessment, maturityScoringMethodologyId: methodology,
        computedFromRiskIds: [riskId],
      });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("computed_from_risk_ids resolves to a real, same-tenant Risk row", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT r.id, r.title, r.tenant_id
         FROM maturity_assessments ma, unnest(ma.computed_from_risk_ids) AS risk_id
         JOIN risks r ON r.id = risk_id
         WHERE ma.id = $1`,
        [maturityAssessmentId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: riskId, title: "Traceability risk", tenant_id: tenant });
  });

  it("known limitation: a uuid array element is NOT foreign-key-enforced — an id for a Risk that doesn't exist can currently be stored", async () => {
    // Demonstrated directly, not merely asserted: Postgres cannot attach
    // a FOREIGN KEY to an individual element of a uuid[] column (the same
    // limitation DATA_MODEL.md's own `computed_from_control_test_ids`
    // field already carries) — see DECISIONS.md.
    //
    // M2 (Maturity Implementation, approval §4)'s new UNIQUE(assessment_id)
    // constraint on `maturity_assessments` means this test needs its own
    // distinct Assessment — `assessment` already has a MaturityAssessment
    // from `beforeAll`.
    const localAssessment = await asFixtureSetup(async (c) => {
      const a = await createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2027 (bogus risk id test)" });
      const ac = await addAssessmentControl(c, { assessmentId: a, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(c, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(c, a);
      return a;
    });
    const bogusId = "00000000-0000-0000-0000-000000000000";
    const id = await asFixtureSetup((c) =>
      createMaturityAssessment(c, {
        engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology,
        computedFromRiskIds: [bogusId],
      }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT computed_from_risk_ids FROM maturity_assessments WHERE id = $1", [id]));
    expect(rows[0]!.computed_from_risk_ids).toEqual([bogusId]);
  });
});
