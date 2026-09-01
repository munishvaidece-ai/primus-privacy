// RLS Test 1, 2, 6 (Milestone 1 instructions §10):
//   1. User belonging to Tenant A can access Tenant A data.
//   2. User belonging to Tenant A cannot access Tenant B data.
//   6. A user with no relevant membership cannot access protected records.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asFixtureSetup,
  asUser,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  grantEngagementMembership,
  grantOrganisationMembership,
  grantTenantMembership,
  pool,
} from "./helpers";

describe("tenant isolation", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgB: string;
  let engagementA: string, engagementB: string;
  let userA: string; // member of tenant A (org + engagement membership)
  let userB: string; // member of tenant B only
  let outsiderUser: string; // exists, but has NO membership anywhere

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — RLS test");
      tenantB = await createTenant(client, "Tenant B — RLS test");
      orgA = await createOrganisation(client, tenantA, "ABC Financial Services");
      orgB = await createOrganisation(client, tenantB, "Unrelated Client Co");
      engagementA = await createEngagement(client, tenantA, orgA, "DPDP Readiness — FY2026");
      engagementB = await createEngagement(client, tenantB, orgB, "Some Other Engagement");

      userA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, userA, orgA);
      await grantEngagementMembership(client, userA, engagementA);

      userB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantOrganisationMembership(client, userB, orgB);
      await grantEngagementMembership(client, userB, engagementB);

      outsiderUser = await createUser(client, { tenantId: tenantA });
      // deliberately: no tenant/org/engagement membership granted at all
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Test 1 — a Tenant A user can read Tenant A's tenant, organisation, and engagement rows", async () => {
    const tenantRows = await asUser(userA, (c) => c.query("SELECT id FROM tenants WHERE id = $1", [tenantA]));
    expect(tenantRows.rows).toHaveLength(1);

    const orgRows = await asUser(userA, (c) => c.query("SELECT id FROM organisations WHERE id = $1", [orgA]));
    expect(orgRows.rows).toHaveLength(1);

    const engagementRows = await asUser(userA, (c) =>
      c.query("SELECT id FROM engagements WHERE id = $1", [engagementA]),
    );
    expect(engagementRows.rows).toHaveLength(1);
  });

  it("Test 2 — a Tenant A user cannot read Tenant B's tenant, organisation, or engagement rows", async () => {
    const tenantRows = await asUser(userA, (c) => c.query("SELECT id FROM tenants WHERE id = $1", [tenantB]));
    expect(tenantRows.rows).toHaveLength(0);

    const orgRows = await asUser(userA, (c) => c.query("SELECT id FROM organisations WHERE id = $1", [orgB]));
    expect(orgRows.rows).toHaveLength(0);

    const engagementRows = await asUser(userA, (c) =>
      c.query("SELECT id FROM engagements WHERE id = $1", [engagementB]),
    );
    expect(engagementRows.rows).toHaveLength(0);
  });

  it("Test 2b — a Tenant A user cannot see ANY Tenant B rows even via an unfiltered SELECT *", async () => {
    // Guards against a policy that only filters on `id =` lookups but
    // leaks rows on a broader scan.
    const rows = await asUser(userA, (c) => c.query("SELECT id FROM organisations"));
    expect(rows.rows.map((r) => r.id)).not.toContain(orgB);
    expect(rows.rows.map((r) => r.id)).toContain(orgA);
  });

  it("Test 6 — a user who exists but holds no membership anywhere cannot read protected rows", async () => {
    const tenantRows = await asUser(outsiderUser, (c) =>
      c.query("SELECT id FROM tenants WHERE id = $1", [tenantA]),
    );
    expect(tenantRows.rows).toHaveLength(0);

    const orgRows = await asUser(outsiderUser, (c) =>
      c.query("SELECT id FROM organisations WHERE id = $1", [orgA]),
    );
    expect(orgRows.rows).toHaveLength(0);

    const engagementRows = await asUser(outsiderUser, (c) =>
      c.query("SELECT id FROM engagements WHERE id = $1", [engagementA]),
    );
    expect(engagementRows.rows).toHaveLength(0);
  });

  it("Test 6b — an anonymous (unauthenticated) request cannot read protected rows at all", async () => {
    // No GRANT exists for `anon` on any of these tables (migration 0001
    // §7) — this should fail at the privilege-check level, before RLS is
    // even evaluated.
    await expect(asAnon((c) => c.query("SELECT id FROM organisations WHERE id = $1", [orgA]))).rejects.toThrow(
      /permission denied/i,
    );
  });
});
