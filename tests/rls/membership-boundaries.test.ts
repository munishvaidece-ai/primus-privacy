// RLS Test 7 (Milestone 1 instructions §10):
//   Membership boundaries behave according to the documented
//   authorization model (SECURITY.md §2-§3, DATA_MODEL.md §2):
//     a) OrganisationMembership grants access to every engagement under
//        that organisation (org-wide roles, e.g. Client Administrator).
//     b) EngagementMembership grants access ONLY to that specific
//        engagement, not sibling engagements of the same organisation.
//     c) TenantMembership ALONE does not grant access to organisation or
//        engagement content ("no implicit cross-client access" —
//        SECURITY.md §3) — but does grant visibility of the Tenant row
//        itself.
//     d) A revoked membership no longer grants access.
//     e) Duplicate ACTIVE memberships for the same (user, scope) are
//        rejected by the partial unique index (Milestone 1 §2: "prevent
//        duplicate active memberships").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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

describe("membership boundary semantics", () => {
  let tenant: string;
  let org: string;
  let engagement1: string, engagement2: string;
  let orgWideUser: string; // OrganisationMembership only
  let engagementScopedUser: string; // EngagementMembership on engagement1 only
  let tenantOnlyUser: string; // TenantMembership only, nothing else

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Tenant — membership boundary test");
      org = await createOrganisation(client, tenant, "ABC Financial Services");
      engagement1 = await createEngagement(client, tenant, org, "DPDP Readiness — FY2026");
      engagement2 = await createEngagement(client, tenant, org, "Annual DPDP Assessment — FY2027");

      orgWideUser = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, orgWideUser, org, "Client Administrator");

      engagementScopedUser = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantEngagementMembership(client, engagementScopedUser, engagement1, "Consultant");

      tenantOnlyUser = await createUser(client, { tenantId: tenant });
      await grantTenantMembership(client, tenantOnlyUser, tenant, "Practice Partner");
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("(a) OrganisationMembership grants access to every engagement under that organisation", async () => {
    const rows = await asUser(orgWideUser, (c) =>
      c.query("SELECT id FROM engagements WHERE id = ANY($1) ORDER BY id", [[engagement1, engagement2]]),
    );
    expect(rows.rows.map((r) => r.id).sort()).toEqual([engagement1, engagement2].sort());
  });

  it("(b) EngagementMembership grants access only to that specific engagement, not its sibling", async () => {
    const own = await asUser(engagementScopedUser, (c) =>
      c.query("SELECT id FROM engagements WHERE id = $1", [engagement1]),
    );
    expect(own.rows).toHaveLength(1);

    const sibling = await asUser(engagementScopedUser, (c) =>
      c.query("SELECT id FROM engagements WHERE id = $1", [engagement2]),
    );
    expect(sibling.rows).toHaveLength(0);
  });

  it("(c) TenantMembership alone does not grant access to the organisation or its engagements", async () => {
    const orgRows = await asUser(tenantOnlyUser, (c) => c.query("SELECT id FROM organisations WHERE id = $1", [org]));
    expect(orgRows.rows).toHaveLength(0);

    const engagementRows = await asUser(tenantOnlyUser, (c) =>
      c.query("SELECT id FROM engagements WHERE id = $1", [engagement1]),
    );
    expect(engagementRows.rows).toHaveLength(0);
  });

  it("(c continued) TenantMembership alone DOES grant visibility of the Tenant row itself", async () => {
    const tenantRows = await asUser(tenantOnlyUser, (c) => c.query("SELECT id FROM tenants WHERE id = $1", [tenant]));
    expect(tenantRows.rows).toHaveLength(1);
  });

  it("(d) a revoked membership no longer grants access", async () => {
    const revokedUser = await asFixtureSetup(async (client) => {
      const userId = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantEngagementMembership(client, userId, engagement1, "Consultant");
      // revoke it
      await client.query(
        `UPDATE engagement_memberships SET status = 'revoked' WHERE user_id = $1 AND engagement_id = $2`,
        [userId, engagement1],
      );
      return userId;
    });

    const rows = await asUser(revokedUser, (c) => c.query("SELECT id FROM engagements WHERE id = $1", [engagement1]));
    expect(rows.rows).toHaveLength(0);
  });

  it("(e) a duplicate ACTIVE membership for the same (user, tenant) is rejected", async () => {
    await expect(
      asFixtureSetup(async (client) => {
        const userId = await createUser(client, { tenantId: tenant });
        await grantTenantMembership(client, userId, tenant, "Practice Partner");
        // second active grant for the same user+tenant — must violate
        // the partial unique index (Milestone 1 §2).
        await grantTenantMembership(client, userId, tenant, "Platform Administrator");
      }),
    ).rejects.toMatchObject({ code: "23505" }); // unique_violation
  });

  it("(e continued) re-granting AFTER a revocation is allowed (history preserved, not overwritten)", async () => {
    await asFixtureSetup(async (client) => {
      const userId = await createUser(client, { tenantId: tenant });
      await grantTenantMembership(client, userId, tenant, "Practice Partner");
      await client.query(`UPDATE tenant_memberships SET status = 'revoked' WHERE user_id = $1`, [userId]);
      // now a fresh active grant should succeed — a new row, not an
      // overwrite of the revoked one.
      await grantTenantMembership(client, userId, tenant, "Platform Administrator");

      const { rows } = await client.query(
        `SELECT status, role_id FROM tenant_memberships WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]!.status).toBe("revoked");
      expect(rows[1]!.status).toBe("active");
    });
  });
});
