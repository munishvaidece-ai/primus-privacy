// Milestone 8 instructions §12 (finalized-maturity immutability) and the
// underlying reparenting/append-only mechanisms that support it. Covers
// MaturityDomain's reparenting guard, MaturityDomainWeight's append-only
// close-out, MaturityAssessment's two-trigger reparenting + finalization
// lock, and MaturityScore's total immutability (no grant at all) plus its
// insert-gate once the parent MaturityAssessment is finalized.
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
  createMaturityDomain,
  createMaturityDomainWeight,
  createMaturityScore,
  createMaturityScoringMethodology,
  createOrganisation,
  createTenant,
  createUser,
  finalizeAssessment,
  finalizeMaturityAssessment,
  grantOrganisationMembership,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("MaturityDomain reparenting guard", () => {
  let tenant: string, tenantB: string, org: string, engagement: string;
  let domain: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Domain Reparenting Tenant A");
      tenantB = await createTenant(client, "Domain Reparenting Tenant B");
      org = await createOrganisation(client, tenant, "Domain Reparenting Client");
      engagement = await createEngagement(client, tenant, org, "Domain Reparenting Engagement");
      domain = await createMaturityDomain(client, { tenantId: tenant, name: "Reparent test domain", code: "REPARENT_TEST" });
      void engagement;
    });
  });

  it("tenant_id cannot be changed after creation", async () => {
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE maturity_domains SET tenant_id = $1 WHERE id = $2`, [tenantB, domain])),
    ).rejects.toThrow(/maturity_domains\.tenant_id is immutable/i);
  });

  it("ordinary fields (name, description, is_active) remain freely editable", async () => {
    await asFixtureSetup((c) => c.query(`UPDATE maturity_domains SET name = 'Renamed domain', description = 'updated', is_active = false WHERE id = $1`, [domain]));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT name, description, is_active FROM maturity_domains WHERE id = $1", [domain]));
    expect(rows[0]).toMatchObject({ name: "Renamed domain", description: "updated", is_active: false });
  });
});

describe("MaturityDomainWeight append-only close-out", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let domain: string, weightV1: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Weight Append-Only Tenant");
      org = await createOrganisation(client, tenant, "Weight Append-Only Client");
      engagement = await createEngagement(client, tenant, org, "Weight Append-Only Engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
      domain = await createMaturityDomain(client, { tenantId: tenant, name: "Weight test domain", code: "WEIGHT_TEST" });
      weightV1 = await createMaturityDomainWeight(client, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 0.5 });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  it("no UPDATE/DELETE grant exists — weight content cannot be edited or removed through any ordinary path", async () => {
    await expect(
      asUser(user, (c) => c.query(`UPDATE maturity_domain_weights SET weight = 0.9 WHERE id = $1`, [weightV1])),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(user, (c) => c.query("DELETE FROM maturity_domain_weights WHERE id = $1", [weightV1])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("inserting a new active weight for the same (engagement, domain) automatically closes out the previous one", async () => {
    const before = await asFixtureSetup((c) => c.query("SELECT is_active, weight FROM maturity_domain_weights WHERE id = $1", [weightV1]));
    expect(before.rows[0]).toMatchObject({ is_active: true, weight: "0.50" });

    const weightV2 = await asFixtureSetup((c) => createMaturityDomainWeight(c, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 0.75 }));

    const afterV1 = await asFixtureSetup((c) => c.query("SELECT is_active, weight FROM maturity_domain_weights WHERE id = $1", [weightV1]));
    expect(afterV1.rows[0]).toMatchObject({ is_active: false, weight: "0.50" });

    const v2 = await asFixtureSetup((c) => c.query("SELECT is_active FROM maturity_domain_weights WHERE id = $1", [weightV2]));
    expect(v2.rows[0]!.is_active).toBe(true);
  });

  it("a positive weight is required — zero or negative rejected", async () => {
    await expect(
      asFixtureSetup((c) => createMaturityDomainWeight(c, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 0 })),
    ).rejects.toThrow(/violates check constraint|weight_positive/i);
  });
});

describe("MaturityAssessment reparenting + finalization lock", () => {
  let tenant: string, tenantB: string, org: string, orgB: string, engagement: string;
  let library: string, control: string;
  let methodology: string, methodologyOther: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "MaturityAssessment Lock Tenant A");
      tenantB = await createTenant(client, "MaturityAssessment Lock Tenant B");
      org = await createOrganisation(client, tenant, "MaturityAssessment Lock Client A");
      orgB = await createOrganisation(client, tenantB, "MaturityAssessment Lock Client B");
      engagement = await createEngagement(client, tenant, org, "MaturityAssessment Lock Engagement");

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "MaturityAssessment Lock Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Lock test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      // Each `it()` below creates its own distinct, freshly finalized
      // Assessment via `freshFinalizedAssessment` (M2, approval §4's new
      // UNIQUE(assessment_id) constraint) — no shared Assessment fixture
      // is created here.
      methodology = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Lock test methodology", version: "v1.0" });
      methodologyOther = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Lock test methodology (other)", version: "v2.0" });
      void orgB;
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  // M2 (Maturity Implementation, approval §4) added a UNIQUE(assessment_id)
  // constraint on `maturity_assessments` — each `it()` below that creates
  // its own MaturityAssessment now needs its own distinct, freshly
  // finalized Assessment rather than reusing the shared `assessment`
  // fixture (whose sole other use, "cannot create... not finalized",
  // never itself creates a MaturityAssessment against it). This preserves
  // each test's own actual intent (the mechanic under test, not
  // multiplicity) while respecting the new constraint.
  async function freshFinalizedAssessment(periodLabel: string): Promise<string> {
    return asFixtureSetup(async (c) => {
      const a = await createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel });
      const ac = await addAssessmentControl(c, { assessmentId: a, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(c, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(c, a);
      return a;
    });
  }

  it("cannot create a MaturityAssessment from an Assessment that is not finalized", async () => {
    const draftAssessment = await asFixtureSetup((c) =>
      createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2027 (still draft)" }),
    );
    await expect(
      asFixtureSetup((c) => createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: draftAssessment, maturityScoringMethodologyId: methodology })),
    ).rejects.toThrow(/can only be computed from a finalized assessment/i);
  });

  it("engagement_id/organisation_id/tenant_id/assessment_id/maturity_scoring_methodology_id cannot be changed after creation", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2026 (reparenting test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology }),
    );
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE maturity_assessments SET maturity_scoring_methodology_id = $1 WHERE id = $2`, [methodologyOther, maturityAssessmentId])),
    ).rejects.toThrow(/maturity_assessments\.\{engagement_id,organisation_id,tenant_id,assessment_id,maturity_scoring_methodology_id\} are immutable/i);
  });

  it("draft -> finalized is allowed and auto-stamps finalized_at; ordinary fields remain editable while draft", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2026 (draft->finalized test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology }),
    );
    await asFixtureSetup((c) => c.query(`UPDATE maturity_assessments SET computed_from_risk_ids = ARRAY[gen_random_uuid()] WHERE id = $1`, [maturityAssessmentId]));

    const before = await asFixtureSetup((c) => c.query("SELECT finalized_at FROM maturity_assessments WHERE id = $1", [maturityAssessmentId]));
    expect(before.rows[0]!.finalized_at).toBeNull();

    await asFixtureSetup((c) => finalizeMaturityAssessment(c, maturityAssessmentId));

    const after = await asFixtureSetup((c) => c.query("SELECT status, finalized_at FROM maturity_assessments WHERE id = $1", [maturityAssessmentId]));
    expect(after.rows[0]!.status).toBe("finalized");
    expect(after.rows[0]!.finalized_at).not.toBeNull();
  });

  it("finalized_at cannot be set directly by an ordinary UPDATE (only the trigger sets it)", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2026 (finalized_at direct-set test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology }),
    );
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE maturity_assessments SET finalized_at = now() WHERE id = $1`, [maturityAssessmentId])),
    ).rejects.toThrow(/finalized_at cannot be set directly/i);
  });

  it("a finalized MaturityAssessment is immutable — no further UPDATE succeeds, not even a no-op or an unfinalize attempt", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2026 (finalized immutability test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology }),
    );
    await asFixtureSetup((c) => finalizeMaturityAssessment(c, maturityAssessmentId));

    await expect(
      asFixtureSetup((c) => c.query(`UPDATE maturity_assessments SET computed_by = gen_random_uuid() WHERE id = $1`, [maturityAssessmentId])),
    ).rejects.toThrow(/a finalized maturity assessment is immutable/i);
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE maturity_assessments SET status = 'draft' WHERE id = $1`, [maturityAssessmentId])),
    ).rejects.toThrow(/a finalized maturity assessment is immutable/i);
    // Even a genuine no-op UPDATE is rejected.
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE maturity_assessments SET status = 'finalized' WHERE id = $1`, [maturityAssessmentId])),
    ).rejects.toThrow(/a finalized maturity assessment is immutable/i);
  });
});

describe("MaturityScore total immutability + insert-gate (afterAll ends the shared pool for this file)", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let library: string, control: string, assessment: string, methodology: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "MaturityScore Immutability Tenant");
      org = await createOrganisation(client, tenant, "MaturityScore Immutability Client");
      engagement = await createEngagement(client, tenant, org, "MaturityScore Immutability Engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "MaturityScore Immutability Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Score test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      const ac = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(client, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(client, assessment);

      methodology = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Score test methodology", version: "v1.0" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // M2 (Maturity Implementation, approval §4)'s new UNIQUE(assessment_id)
  // constraint on `maturity_assessments` means each `it()` below that
  // creates its own MaturityAssessment needs its own distinct Assessment
  // — see the identical helper/rationale in the describe block above.
  async function freshFinalizedAssessment(periodLabel: string): Promise<string> {
    return asFixtureSetup(async (c) => {
      const a = await createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel });
      const ac = await addAssessmentControl(c, { assessmentId: a, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(c, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(c, a);
      return a;
    });
  }

  it("no UPDATE/DELETE grant exists on MaturityScore — a computed score can never be edited or removed", async () => {
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: assessment, maturityScoringMethodologyId: methodology }),
    );
    const scoreId = await asFixtureSetup((c) =>
      createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, score: 4 }),
    );
    await expect(asUser(user, (c) => c.query(`UPDATE maturity_scores SET score = 5 WHERE id = $1`, [scoreId]))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asUser(user, (c) => c.query("DELETE FROM maturity_scores WHERE id = $1", [scoreId]))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("cannot insert a MaturityScore for a MaturityAssessment that is already finalized", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2026 (insert-gate test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology }),
    );
    await asFixtureSetup((c) => finalizeMaturityAssessment(c, maturityAssessmentId));

    await expect(
      asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, score: 3 })),
    ).rejects.toThrow(/cannot insert a MaturityScore for a finalized MaturityAssessment/i);
  });

  it("score must be within the 1-5 scale", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2026 (score range test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology }),
    );
    await expect(
      asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, score: 6 })),
    ).rejects.toThrow(/violates check constraint|score_range/i);
  });
});
