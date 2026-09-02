// Milestone 8 instructions §9: "maturity calculations must be
// historically reproducible... a maturity assessment calculated using v1
// must continue to resolve to v1" after v2 is introduced. Mirrors
// Milestone 7's `risk-scoring-versioning.test.ts` exactly — the same
// append-only/`is_active`-close-out mechanism, applied to
// `MaturityScoringMethodology` instead of `RiskScoringModel`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  asUser,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createMaturityAssessment,
  createMaturityScoringMethodology,
  createOrganisation,
  createTenant,
  createUser,
  finalizeAssessment,
  grantOrganisationMembership,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("MaturityScoringMethodology versioning / historical reproducibility", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let library: string, control: string, assessment: string;
  let methodologyV1: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Methodology Versioning Tenant");
      org = await createOrganisation(client, tenant, "Methodology Versioning Client");
      engagement = await createEngagement(client, tenant, org, "Methodology Versioning Engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Methodology Versioning Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Versioning test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      const ac = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(client, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(client, assessment);

      methodologyV1 = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Versioning Test Methodology", version: "v1.0" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // M2 (Maturity Implementation, approval §4)'s new UNIQUE(assessment_id)
  // constraint on `maturity_assessments` means each `it()` below that
  // creates its own MaturityAssessment needs its own distinct Assessment.
  async function freshFinalizedAssessment(periodLabel: string): Promise<string> {
    return asFixtureSetup(async (c) => {
      const a = await createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel });
      const ac = await addAssessmentControl(c, { assessmentId: a, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(c, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(c, a);
      return a;
    });
  }

  it("a MaturityAssessment pins the active methodology at the time it was created", async () => {
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: assessment, maturityScoringMethodologyId: methodologyV1 }),
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT maturity_scoring_methodology_id FROM maturity_assessments WHERE id = $1", [maturityAssessmentId]),
    );
    expect(rows[0]!.maturity_scoring_methodology_id).toBe(methodologyV1);
  });

  it("introducing v2 automatically closes out v1 (is_active flips false), but v1's own content is untouched", async () => {
    const before = await asFixtureSetup((c) => c.query("SELECT is_active, definition FROM maturity_scoring_methodologies WHERE id = $1", [methodologyV1]));
    expect(before.rows[0]!.is_active).toBe(true);

    const methodologyV2 = await asFixtureSetup((c) =>
      createMaturityScoringMethodology(c, { tenantId: tenant, name: "Versioning Test Methodology", version: "v2.0" }),
    );

    const afterV1 = await asFixtureSetup((c) => c.query("SELECT is_active, definition FROM maturity_scoring_methodologies WHERE id = $1", [methodologyV1]));
    expect(afterV1.rows[0]!.is_active).toBe(false);
    expect(afterV1.rows[0]!.definition).toEqual(before.rows[0]!.definition);

    const v2 = await asFixtureSetup((c) => c.query("SELECT is_active FROM maturity_scoring_methodologies WHERE id = $1", [methodologyV2]));
    expect(v2.rows[0]!.is_active).toBe(true);
  });

  it("a MaturityAssessment created under v1 continues to resolve to v1 after v2 exists and is active", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2027 (v1 resolution test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodologyV1 }),
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT ma.maturity_scoring_methodology_id, m.version
         FROM maturity_assessments ma JOIN maturity_scoring_methodologies m ON m.id = ma.maturity_scoring_methodology_id
         WHERE ma.id = $1`,
        [maturityAssessmentId],
      ),
    );
    expect(rows[0]).toMatchObject({ maturity_scoring_methodology_id: methodologyV1, version: "v1.0" });
  });

  it("v1 itself cannot be edited or deleted through any ordinary path, even after being superseded", async () => {
    await expect(
      asUser(user, (c) => c.query(`UPDATE maturity_scoring_methodologies SET name = 'tampered' WHERE id = $1`, [methodologyV1])),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(user, (c) => c.query("DELETE FROM maturity_scoring_methodologies WHERE id = $1", [methodologyV1])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a MaturityAssessment's methodology pin is itself frozen — cannot be repointed to a different version later", async () => {
    const methodologyV3 = await asFixtureSetup((c) =>
      createMaturityScoringMethodology(c, { tenantId: tenant, name: "Versioning Test Methodology", version: "v3.0" }),
    );
    const localAssessment = await freshFinalizedAssessment("FY2028 (pin-frozen test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodologyV1 }),
    );
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE maturity_assessments SET maturity_scoring_methodology_id = $1 WHERE id = $2`, [methodologyV3, maturityAssessmentId])),
    ).rejects.toThrow(/immutable after creation/i);
  });
});
