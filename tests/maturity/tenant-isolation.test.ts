// Milestone 8 instructions §14: Tenant/Organisation/Engagement boundary
// enforcement for every Maturity table, plus the required test list:
// (1) Tenant A can access its own maturity data, (2) Tenant A cannot
// access Tenant B's, (3) Organisation A cannot access Organisation B's,
// (4) Engagement A cannot access Engagement B's, (5) unauthorized reads
// blocked, (6) unauthorized writes blocked, (7) cross-tenant source
// Assessment/Risk relationships rejected.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asAnon,
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
  createRisk,
  createRiskScoringModel,
  createTenant,
  createUser,
  finalizeAssessment,
  grantEngagementMembership,
  grantOrganisationMembership,
  grantTenantMembership,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Maturity tenant/organisation/engagement isolation and write protection", () => {
  let tenantA: string, tenantB: string;
  let orgA1: string, orgA2: string, orgB: string;
  let engagementA1: string, engagementA2: string, engagementB: string;
  let libraryA: string, controlA: string, assessmentA1: string;
  let methodologyA: string, methodologyB: string, domainA: string, weightA1: string;
  let maturityAssessmentA1: string, maturityScoreA1: string;
  let scoringModelA: string;

  let orgWideUserA1: string;
  let tenantMemberA: string;
  let userB: string;
  let outsiderUser: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — Maturity isolation");
      tenantB = await createTenant(client, "Tenant B — Maturity isolation");
      orgA1 = await createOrganisation(client, tenantA, "Maturity Isolation Client A1");
      orgA2 = await createOrganisation(client, tenantA, "Maturity Isolation Client A2");
      orgB = await createOrganisation(client, tenantB, "Maturity Isolation Client B");

      engagementA1 = await createEngagement(client, tenantA, orgA1, "Tenant A Engagement 1");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Tenant A Engagement 2");
      engagementB = await createEngagement(client, tenantB, orgB, "Tenant B Engagement");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Maturity Isolation Library A" });
      controlA = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Isolation test control" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA1, libraryA);

      assessmentA1 = await createAssessment(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026" });
      const ac = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlA, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, controlLibraryVersionId: libraryA });
      await createAssessmentResponse(client, { assessmentControlId: ac, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, effectivenessRating: "implemented" });
      await finalizeAssessment(client, assessmentA1);

      methodologyA = await createMaturityScoringMethodology(client, { tenantId: tenantA, name: "Tenant A Methodology", version: "v1.0" });
      methodologyB = await createMaturityScoringMethodology(client, { tenantId: tenantB, name: "Tenant B Methodology", version: "v1.0" });
      domainA = await createMaturityDomain(client, { tenantId: tenantA, name: "Tenant A Domain", code: "TENANT_A_DOMAIN" });
      weightA1 = await createMaturityDomainWeight(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, maturityDomainId: domainA, weight: 1 });

      maturityAssessmentA1 = await createMaturityAssessment(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, assessmentId: assessmentA1, maturityScoringMethodologyId: methodologyA });
      maturityScoreA1 = await createMaturityScore(client, { maturityAssessmentId: maturityAssessmentA1, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, maturityDomainId: domainA, maturityDomainWeightId: weightA1, score: 4 });

      scoringModelA = await createRiskScoringModel(client, { tenantId: tenantA, name: "Isolation risk matrix", version: "v1.0" });

      orgWideUserA1 = await createUser(client, { tenantId: tenantA, clientOrgId: orgA1 });
      await grantOrganisationMembership(client, orgWideUserA1, orgA1);

      // A genuine practice-side member (TenantMembership, not merely
      // client-side OrganisationMembership) — needed for the positive
      // write control on Tenant-scoped practice content (MaturityDomain/
      // MaturityScoringMethodology use `is_active_tenant_member` for
      // INSERT/UPDATE, per the same asymmetry as Control/RiskScoringModel).
      tenantMemberA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA1 });
      await grantTenantMembership(client, tenantMemberA, tenantA);

      userB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantOrganisationMembership(client, userB, orgB);

      outsiderUser = await createUser(client, { tenantId: tenantA });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // (1) Tenant A can access its own maturity data.
  it("a Tenant A user can read their own tenant's Maturity data", async () => {
    const methodology = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM maturity_scoring_methodologies WHERE id = $1", [methodologyA]));
    expect(methodology.rows).toHaveLength(1);
    const domain = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM maturity_domains WHERE id = $1", [domainA]));
    expect(domain.rows).toHaveLength(1);
    const weight = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM maturity_domain_weights WHERE id = $1", [weightA1]));
    expect(weight.rows).toHaveLength(1);
    const ma = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM maturity_assessments WHERE id = $1", [maturityAssessmentA1]));
    expect(ma.rows).toHaveLength(1);
    const score = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM maturity_scores WHERE id = $1", [maturityScoreA1]));
    expect(score.rows).toHaveLength(1);
  });

  // (2) Tenant A cannot access Tenant B's maturity data.
  it("Tenant A cannot read Tenant B's Maturity data", async () => {
    const methodology = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM maturity_scoring_methodologies WHERE id = $1", [methodologyB]));
    expect(methodology.rows).toHaveLength(0);

    const domainB = await asFixtureSetup((c) => createMaturityDomain(c, { tenantId: tenantB, name: "Tenant B Domain", code: "TENANT_B_DOMAIN" }));
    const domain = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM maturity_domains WHERE id = $1", [domainB]));
    expect(domain.rows).toHaveLength(0);
  });

  // (3) Organisation A cannot access Organisation B's (same-tenant) maturity data.
  it("Organisation A1's member cannot access Organisation A2's MaturityAssessment, even under the same tenant", async () => {
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, engagementA2, libraryA));
    const assessmentA2 = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (org A2)" }));
    const acA2 = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: assessmentA2, controlId: controlA, tenantId: tenantA, organisationId: orgA2, engagementId: engagementA2, controlLibraryVersionId: libraryA }));
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acA2, tenantId: tenantA, organisationId: orgA2, engagementId: engagementA2, effectivenessRating: "implemented" }));
    await asFixtureSetup((c) => finalizeAssessment(c, assessmentA2));
    const maA2 = await asFixtureSetup((c) => createMaturityAssessment(c, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, assessmentId: assessmentA2, maturityScoringMethodologyId: methodologyA }));

    const rows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM maturity_assessments WHERE id = $1", [maA2]));
    expect(rows.rows).toHaveLength(0);
  });

  // (4) Engagement isolation.
  it("an engagement-scoped Tenant A user can access exactly the MaturityScores their EngagementMembership permits — no more", async () => {
    const engagementScopedUser = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA1 }));
    await asFixtureSetup((c) => grantEngagementMembership(c, engagementScopedUser, engagementA1));

    const own = await asUser(engagementScopedUser, (c) => c.query("SELECT id FROM maturity_scores WHERE id = $1", [maturityScoreA1]));
    expect(own.rows).toHaveLength(1);

    const weightA2 = await asFixtureSetup((c) => createMaturityDomainWeight(c, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, maturityDomainId: domainA, weight: 1 }));
    const rows = await asUser(engagementScopedUser, (c) => c.query("SELECT id FROM maturity_domain_weights WHERE id = $1", [weightA2]));
    expect(rows.rows).toHaveLength(0);
  });

  // (5) Unauthorized reads.
  it("an unaffiliated user cannot read any Tenant A Maturity data", async () => {
    const methodology = await asUser(outsiderUser, (c) => c.query("SELECT id FROM maturity_scoring_methodologies WHERE id = $1", [methodologyA]));
    expect(methodology.rows).toHaveLength(0);
    const score = await asUser(outsiderUser, (c) => c.query("SELECT id FROM maturity_scores WHERE id = $1", [maturityScoreA1]));
    expect(score.rows).toHaveLength(0);
  });

  it("an anonymous request is denied at the grant level for every Milestone 8 table", async () => {
    await expect(asAnon((c) => c.query("SELECT id FROM maturity_scoring_methodologies WHERE id = $1", [methodologyA]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM maturity_domains WHERE id = $1", [domainA]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM maturity_domain_weights WHERE id = $1", [weightA1]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM maturity_assessments WHERE id = $1", [maturityAssessmentA1]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM maturity_scores WHERE id = $1", [maturityScoreA1]))).rejects.toThrow(/permission denied/i);
  });

  // (6) Unauthorized writes.
  it("Tenant B cannot UPDATE Tenant A's MaturityDomain (0 rows affected — not visible to them at all)", async () => {
    const result = await asUser(userB, (c) => c.query("UPDATE maturity_domains SET name = 'tampered' WHERE id = $1", [domainA]));
    expect(result.rowCount).toBe(0);
    const check = await asUser(orgWideUserA1, (c) => c.query("SELECT name FROM maturity_domains WHERE id = $1", [domainA]));
    expect(check.rows[0]!.name).toBe("Tenant A Domain");
  });

  it("Tenant B cannot INSERT a MaturityAssessment into Tenant A's engagement", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(
          `INSERT INTO maturity_assessments (engagement_id, organisation_id, tenant_id, assessment_id, maturity_scoring_methodology_id) VALUES ($1, $2, $3, $4, $5)`,
          [engagementA1, orgA1, tenantA, assessmentA1, methodologyA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("Tenant B cannot INSERT a MaturityScore attached to Tenant A's MaturityAssessment", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(`INSERT INTO maturity_scores (maturity_assessment_id, tenant_id, organisation_id, engagement_id, score) VALUES ($1, $2, $3, $4, 5)`, [
          maturityAssessmentA1, tenantA, orgA1, engagementA1,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  // (7) Cross-tenant source Assessment/Risk relationships are rejected.
  it("cross-tenant source Assessment relationship rejected — a real Assessment cannot be claimed under a forged (wrong-tenant) scope", async () => {
    // assessmentA1 genuinely belongs to (engagementA1, orgA1, tenantA);
    // claiming tenantB alongside it is exactly the "cross-tenant source
    // Assessment relationship" the composite FK must reject structurally.
    await expect(
      asFixtureSetup((c) =>
        createMaturityAssessment(c, {
          engagementId: engagementA1,
          organisationId: orgA1,
          tenantId: tenantB, // forged — assessmentA1 does not belong to Tenant B.
          assessmentId: assessmentA1,
          maturityScoringMethodologyId: methodologyA,
        }),
      ),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it("cross-tenant source methodology relationship rejected — a Tenant A MaturityAssessment cannot pin a Tenant B methodology", async () => {
    await expect(
      asFixtureSetup((c) =>
        createMaturityAssessment(c, {
          engagementId: engagementA1,
          organisationId: orgA1,
          tenantId: tenantA,
          assessmentId: assessmentA1,
          maturityScoringMethodologyId: methodologyB, // cross-tenant methodology.
        }),
      ),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it("cross-tenant Risk cannot be referenced from a MaturityAssessment's traceability in a way RLS would ever expose to Tenant B", async () => {
    // computed_from_risk_ids is a plain array (DECISIONS.md — not
    // FK-enforced, see consistency.test.ts), but RLS on `risks` itself
    // still means Tenant B can never resolve Tenant A's Risk id to real
    // row content, even if an id somehow appeared in an array they can see.
    const riskA = await asFixtureSetup((c) => createRisk(c, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, riskScoringModelId: scoringModelA, title: "Tenant A risk", likelihood: 3, impact: 3, inherentRating: "medium" }));
    const rows = await asUser(userB, (c) => c.query("SELECT id FROM risks WHERE id = $1", [riskA]));
    expect(rows.rows).toHaveLength(0);
  });

  it("an authorized tenant member CAN write (INSERT/UPDATE) MaturityDomain — proving the blocks above are real access control, not a broken pipe", async () => {
    const insertResult = await asUser(tenantMemberA, (c) =>
      c.query(`INSERT INTO maturity_domains (tenant_id, name, code) VALUES ($1, 'New Domain', 'NEW_DOMAIN') RETURNING id`, [tenantA]),
    );
    expect(insertResult.rows).toHaveLength(1);

    const updateResult = await asUser(tenantMemberA, (c) =>
      c.query("UPDATE maturity_domains SET description = 'updated by owner' WHERE id = $1 RETURNING description", [domainA]),
    );
    expect(updateResult.rows[0]!.description).toBe("updated by owner");
  });

  // MaturityScoringMethodology read/write asymmetry (mirrors RiskScoringModel/ControlLibraryVersion, R-47).
  it("an organisation-scoped Tenant A user (no TenantMembership) CAN read MaturityScoringMethodology but CANNOT write it", async () => {
    const rows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM maturity_scoring_methodologies WHERE id = $1", [methodologyA]));
    expect(rows.rows).toHaveLength(1);

    await expect(
      asUser(orgWideUserA1, (c) =>
        c.query(`INSERT INTO maturity_scoring_methodologies (tenant_id, name, version, definition) VALUES ($1, 'Attempted', 'v9', '{}'::jsonb)`, [tenantA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
