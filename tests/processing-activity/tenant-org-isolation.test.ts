// Milestone 3 §8's required RLS tests (items 9-10 of §5's list too):
//   - Tenant A can access its own Processing Activities.
//   - Tenant A cannot access Tenant B.
//   - Organisation A cannot access Organisation B.
//   - An engagement user can access the Processing Activities permitted
//     by the existing membership model.
//   - Unauthenticated/unauthorised users cannot access protected records.
//   - Write protection (not only SELECT).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asFixtureSetup,
  asUser,
  createEngagement,
  createOrganisation,
  createProcessingActivity,
  createSystem,
  createTenant,
  createUser,
  grantEngagementMembership,
  grantOrganisationMembership,
  insertSystemVersion,
  linkSystem,
  pool,
} from "./helpers";

describe("Processing Activity tenant/organisation isolation and write protection", () => {
  let tenantA: string, tenantB: string;
  let orgA1: string, orgA2: string, orgB: string;
  let engagementA1: string, engagementA2: string, engagementB: string;
  let paA1: string, paA2: string, paB: string;

  let orgWideUserA: string; // OrganisationMembership on orgA1 only
  let engagementScopedUserA: string; // EngagementMembership on engagementA1 only
  let userB: string; // member of tenant B only
  let outsiderUser: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — PA isolation");
      tenantB = await createTenant(client, "Tenant B — PA isolation");
      orgA1 = await createOrganisation(client, tenantA, "ABC Financial Services");
      orgA2 = await createOrganisation(client, tenantA, "Another Client Under Tenant A");
      orgB = await createOrganisation(client, tenantB, "Unrelated Client Co");

      engagementA1 = await createEngagement(client, tenantA, orgA1, "DPDP Readiness — FY2026");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Some Other Engagement");
      engagementB = await createEngagement(client, tenantB, orgB, "Tenant B Engagement");

      paA1 = await createProcessingActivity(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, name: "Customer Onboarding" });
      paA2 = await createProcessingActivity(client, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, name: "Payroll" });
      paB = await createProcessingActivity(client, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, name: "Marketing" });

      orgWideUserA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA1 });
      await grantOrganisationMembership(client, orgWideUserA, orgA1);

      engagementScopedUserA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA1 });
      await grantEngagementMembership(client, engagementScopedUserA, engagementA1);

      userB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantOrganisationMembership(client, userB, orgB);

      outsiderUser = await createUser(client, { tenantId: tenantA });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a Tenant A user can read their own tenant's Processing Activity", async () => {
    const rows = await asUser(orgWideUserA, (c) => c.query("SELECT id FROM processing_activities WHERE id = $1", [paA1]));
    expect(rows.rows).toHaveLength(1);
  });

  it("Tenant A cannot access Tenant B's Processing Activity", async () => {
    const rows = await asUser(orgWideUserA, (c) => c.query("SELECT id FROM processing_activities WHERE id = $1", [paB]));
    expect(rows.rows).toHaveLength(0);

    const listing = await asUser(orgWideUserA, (c) => c.query("SELECT id FROM processing_activities"));
    expect(listing.rows.map((r) => r.id)).not.toContain(paB);
  });

  it("Organisation A1's member cannot access Organisation A2's Processing Activity, even under the same tenant", async () => {
    const rows = await asUser(orgWideUserA, (c) => c.query("SELECT id FROM processing_activities WHERE id = $1", [paA2]));
    expect(rows.rows).toHaveLength(0);
  });

  it("an engagement-scoped user can access exactly the Processing Activities their EngagementMembership permits — no more", async () => {
    const own = await asUser(engagementScopedUserA, (c) => c.query("SELECT id FROM processing_activities WHERE id = $1", [paA1]));
    expect(own.rows).toHaveLength(1);

    // Same tenant, same... no, different org entirely — definitely blocked.
    const other = await asUser(engagementScopedUserA, (c) => c.query("SELECT id FROM processing_activities WHERE id = $1", [paA2]));
    expect(other.rows).toHaveLength(0);
  });

  it("an unaffiliated user cannot access any Processing Activity", async () => {
    const rows = await asUser(outsiderUser, (c) => c.query("SELECT id FROM processing_activities WHERE id = $1", [paA1]));
    expect(rows.rows).toHaveLength(0);
  });

  it("an anonymous request is denied at the grant level", async () => {
    await expect(asAnon((c) => c.query("SELECT id FROM processing_activities WHERE id = $1", [paA1]))).rejects.toThrow(
      /permission denied/i,
    );
  });

  // --- Write protection (Milestone 3 §8: "Also test write protection, not only SELECT protection.") ---

  it("a Tenant B user cannot INSERT a Processing Activity into Tenant A's engagement", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(
          `INSERT INTO processing_activities (engagement_id, organisation_id, tenant_id, name) VALUES ($1, $2, $3, 'Forged PA')`,
          [engagementA1, orgA1, tenantA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a Tenant B user cannot UPDATE Tenant A's Processing Activity (0 rows affected, not visible to them at all)", async () => {
    const result = await asUser(userB, (c) =>
      c.query("UPDATE processing_activities SET name = 'tampered' WHERE id = $1", [paA1]),
    );
    expect(result.rowCount).toBe(0);

    // Confirm it genuinely wasn't touched.
    const check = await asUser(orgWideUserA, (c) => c.query("SELECT name FROM processing_activities WHERE id = $1", [paA1]));
    expect(check.rows[0]!.name).toBe("Customer Onboarding");
  });

  it("a Tenant B user cannot INSERT a junction row linking Tenant A's Processing Activity to anything", async () => {
    const foreignSystem = await asFixtureSetup((client) => createSystem(client, orgB));
    const foreignSystemVersion = await asFixtureSetup((client) =>
      insertSystemVersion(client, { systemId: foreignSystem, organisationId: orgB, name: "Some System" }),
    );

    await expect(
      asUser(userB, (c) =>
        c.query(
          `INSERT INTO processing_activity_systems (processing_activity_id, engagement_id, organisation_id, system_id, system_version_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [paA1, engagementA1, orgA1, foreignSystem, foreignSystemVersion],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("an authorized user CAN write (INSERT/UPDATE) their own Processing Activity — proving the block above is real access control, not a broken pipe", async () => {
    const insertResult = await asUser(orgWideUserA, (c) =>
      c.query(
        `INSERT INTO processing_activities (engagement_id, organisation_id, tenant_id, name) VALUES ($1, $2, $3, 'New Activity') RETURNING id`,
        [engagementA1, orgA1, tenantA],
      ),
    );
    expect(insertResult.rows).toHaveLength(1);

    const updateResult = await asUser(orgWideUserA, (c) =>
      c.query("UPDATE processing_activities SET lifecycle_status = 'active' WHERE id = $1 RETURNING lifecycle_status", [paA1]),
    );
    expect(updateResult.rows[0]!.lifecycle_status).toBe("active");
  });
});
