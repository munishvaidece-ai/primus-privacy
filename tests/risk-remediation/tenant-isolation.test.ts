// Milestone 7 instructions §12/§14: Tenant/Organisation/Engagement
// boundary enforcement for Risk/Finding/RemediationAction/
// ValidationRecord, plus the required RLS test list: (1) tenant
// isolation, (2) organisation isolation, (3) engagement isolation, (4)
// unauthorized reads, (5) unauthorized writes, (6)-(8) cross-tenant/
// cross-organisation/cross-engagement FK rejection (covered at the
// database level in consistency.test.ts; re-asserted here from the RLS
// angle where relevant).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asFixtureSetup,
  asUser,
  createEngagement,
  createFinding,
  createOrganisation,
  createRemediationAction,
  createRisk,
  createRiskScoringModel,
  createTenant,
  createUser,
  createValidationRecord,
  grantEngagementMembership,
  grantOrganisationMembership,
  pool,
} from "./helpers";

describe("Risk, Findings & Remediation tenant/organisation/engagement isolation and write protection", () => {
  let tenantA: string, tenantB: string;
  let orgA1: string, orgA2: string, orgB: string;
  let engagementA1: string, engagementA2: string, engagementB: string;
  let scoringModelA: string, scoringModelB: string;
  let riskA1: string, findingA1: string, remediationA1: string, validationA1: string;

  let orgWideUserA1: string;
  let userB: string;
  let outsiderUser: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — R&F isolation");
      tenantB = await createTenant(client, "Tenant B — R&F isolation");
      orgA1 = await createOrganisation(client, tenantA, "ABC Financial Services");
      orgA2 = await createOrganisation(client, tenantA, "Another Client Under Tenant A");
      orgB = await createOrganisation(client, tenantB, "Unrelated Client Co");

      engagementA1 = await createEngagement(client, tenantA, orgA1, "Tenant A Engagement 1");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Tenant A Engagement 2");
      engagementB = await createEngagement(client, tenantB, orgB, "Tenant B Engagement");

      scoringModelA = await createRiskScoringModel(client, { tenantId: tenantA, name: "Tenant A Matrix", version: "v1.0" });
      scoringModelB = await createRiskScoringModel(client, { tenantId: tenantB, name: "Tenant B Matrix", version: "v1.0" });

      riskA1 = await createRisk(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, riskScoringModelId: scoringModelA, title: "Tenant A risk", likelihood: 4, impact: 4, inherentRating: "high" });
      findingA1 = await createFinding(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, title: "Tenant A finding" });
      remediationA1 = await createRemediationAction(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, title: "Tenant A remediation" });
      validationA1 = await createValidationRecord(client, { remediationActionId: remediationA1, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, outcome: "accepted" });

      orgWideUserA1 = await createUser(client, { tenantId: tenantA, clientOrgId: orgA1 });
      await grantOrganisationMembership(client, orgWideUserA1, orgA1);

      userB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantOrganisationMembership(client, userB, orgB);

      outsiderUser = await createUser(client, { tenantId: tenantA });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // (1) Tenant isolation.
  it("a Tenant A user can read their own tenant's Risk/Finding/RemediationAction/ValidationRecord", async () => {
    const risk = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM risks WHERE id = $1", [riskA1]));
    expect(risk.rows).toHaveLength(1);
    const finding = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM findings WHERE id = $1", [findingA1]));
    expect(finding.rows).toHaveLength(1);
    const remediation = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM remediation_actions WHERE id = $1", [remediationA1]));
    expect(remediation.rows).toHaveLength(1);
    const validation = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM validation_records WHERE id = $1", [validationA1]));
    expect(validation.rows).toHaveLength(1);
  });

  it("Tenant A cannot read Tenant B's Risk/Finding/RemediationAction/ValidationRecord", async () => {
    const riskB = await asFixtureSetup((c) =>
      createRisk(c, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, riskScoringModelId: scoringModelB, title: "Tenant B risk", likelihood: 1, impact: 1, inherentRating: "low" }),
    );
    const rows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM risks WHERE id = $1", [riskB]));
    expect(rows.rows).toHaveLength(0);
  });

  // (2) Organisation isolation.
  it("Organisation A1's member cannot access Organisation A2's Finding, even under the same tenant", async () => {
    const findingA2 = await asFixtureSetup((c) => createFinding(c, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, title: "Org A2 finding" }));
    const rows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM findings WHERE id = $1", [findingA2]));
    expect(rows.rows).toHaveLength(0);
  });

  // (3) Engagement isolation.
  it("an engagement-scoped Tenant A user can access exactly the RemediationActions their EngagementMembership permits — no more", async () => {
    const engagementScopedUser = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA1 }));
    await asFixtureSetup((c) => grantEngagementMembership(c, engagementScopedUser, engagementA1));

    const own = await asUser(engagementScopedUser, (c) => c.query("SELECT id FROM remediation_actions WHERE id = $1", [remediationA1]));
    expect(own.rows).toHaveLength(1);

    const remediationA2 = await asFixtureSetup((c) => createRemediationAction(c, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, title: "Org A2 remediation for engagement isolation" }));
    const other = await asUser(engagementScopedUser, (c) => c.query("SELECT id FROM remediation_actions WHERE id = $1", [remediationA2]));
    expect(other.rows).toHaveLength(0);
  });

  // (4) Unauthorized reads.
  it("an unaffiliated user cannot read any Tenant A Risk/Finding/RemediationAction/ValidationRecord", async () => {
    const risk = await asUser(outsiderUser, (c) => c.query("SELECT id FROM risks WHERE id = $1", [riskA1]));
    expect(risk.rows).toHaveLength(0);
    const validation = await asUser(outsiderUser, (c) => c.query("SELECT id FROM validation_records WHERE id = $1", [validationA1]));
    expect(validation.rows).toHaveLength(0);
  });

  it("an anonymous request is denied at the grant level for every Milestone 7 table", async () => {
    await expect(asAnon((c) => c.query("SELECT id FROM risks WHERE id = $1", [riskA1]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM findings WHERE id = $1", [findingA1]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM remediation_actions WHERE id = $1", [remediationA1]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM validation_records WHERE id = $1", [validationA1]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM risk_scoring_models WHERE id = $1", [scoringModelA]))).rejects.toThrow(/permission denied/i);
  });

  // (5) Unauthorized writes.
  it("Tenant B cannot UPDATE Tenant A's Risk (0 rows affected — not visible to them at all)", async () => {
    const result = await asUser(userB, (c) => c.query("UPDATE risks SET title = 'tampered' WHERE id = $1", [riskA1]));
    expect(result.rowCount).toBe(0);
    const check = await asUser(orgWideUserA1, (c) => c.query("SELECT title FROM risks WHERE id = $1", [riskA1]));
    expect(check.rows[0]!.title).toBe("Tenant A risk");
  });

  it("Tenant B cannot INSERT a Finding into Tenant A's engagement", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(`INSERT INTO findings (engagement_id, organisation_id, tenant_id, title, severity) VALUES ($1, $2, $3, 'Forged', 'high')`, [engagementA1, orgA1, tenantA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("Tenant B cannot INSERT a RiskScoringModel under Tenant A's tenant", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(`INSERT INTO risk_scoring_models (tenant_id, name, version, matrix_definition) VALUES ($1, 'Forged', 'v1', '{}'::jsonb)`, [tenantA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("Tenant B cannot INSERT a ValidationRecord attached to Tenant A's RemediationAction", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(
          `INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome) VALUES ($1, $2, $3, $4, 'accepted')`,
          [remediationA1, tenantA, orgA1, engagementA1],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("an authorized user CAN write (INSERT/UPDATE) their own Risk/Finding/RemediationAction — proving the blocks above are real access control, not a broken pipe", async () => {
    const insertResult = await asUser(orgWideUserA1, (c) =>
      c.query(
        `INSERT INTO risks (engagement_id, organisation_id, tenant_id, risk_scoring_model_id, title, likelihood, impact, inherent_rating) VALUES ($1, $2, $3, $4, 'New Risk', 2, 2, 'low') RETURNING id`,
        [engagementA1, orgA1, tenantA, scoringModelA],
      ),
    );
    expect(insertResult.rows).toHaveLength(1);

    const updateResult = await asUser(orgWideUserA1, (c) =>
      c.query("UPDATE findings SET status = 'in_progress' WHERE id = $1 RETURNING status", [findingA1]),
    );
    expect(updateResult.rows[0]!.status).toBe("in_progress");
  });

  // RiskScoringModel read/write asymmetry (mirrors ControlLibraryVersion, R-47).
  it("an organisation-scoped Tenant A user (no TenantMembership) CAN read RiskScoringModel but CANNOT write it", async () => {
    const rows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM risk_scoring_models WHERE id = $1", [scoringModelA]));
    expect(rows.rows).toHaveLength(1);

    await expect(
      asUser(orgWideUserA1, (c) =>
        c.query(`INSERT INTO risk_scoring_models (tenant_id, name, version, matrix_definition) VALUES ($1, 'Attempted', 'v9', '{}'::jsonb)`, [tenantA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
