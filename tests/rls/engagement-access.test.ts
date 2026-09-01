// RLS Test 4 (Milestone 1 instructions §10):
//   An Engagement belonging to Tenant A cannot be accessed by a Tenant B
//   user — including a Tenant B user who legitimately holds membership
//   on their OWN engagement, proving isolation isn't just "no membership
//   anywhere" (that's Test 6) but specifically "your legitimate access
//   elsewhere doesn't leak into someone else's tenant."
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
  pool,
} from "./helpers";

describe("cross-tenant engagement access", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgB: string;
  let engagementA: string, engagementB: string;
  let userBWithRealAccessElsewhere: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — engagement access test");
      tenantB = await createTenant(client, "Tenant B — engagement access test");
      orgA = await createOrganisation(client, tenantA, "ABC Financial Services");
      orgB = await createOrganisation(client, tenantB, "XYZ Holdings");
      engagementA = await createEngagement(client, tenantA, orgA, "DPDP Readiness — FY2026");
      engagementB = await createEngagement(client, tenantB, orgB, "DPDP Readiness — FY2026 (Tenant B)");

      userBWithRealAccessElsewhere = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantOrganisationMembership(client, userBWithRealAccessElsewhere, orgB);
      await grantEngagementMembership(client, userBWithRealAccessElsewhere, engagementB);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a Tenant B user with real, active membership on their own engagement still cannot read Tenant A's engagement by id", async () => {
    const rows = await asUser(userBWithRealAccessElsewhere, (c) =>
      c.query("SELECT id, name FROM engagements WHERE id = $1", [engagementA]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("the same user's unfiltered engagement listing contains only their own tenant's engagement", async () => {
    const rows = await asUser(userBWithRealAccessElsewhere, (c) => c.query("SELECT id FROM engagements"));
    const ids = rows.rows.map((r) => r.id);
    expect(ids).toContain(engagementB);
    expect(ids).not.toContain(engagementA);
  });

  it("the same user cannot UPDATE Tenant A's engagement (0 rows affected, not an error, because RLS filters it out of scope entirely)", async () => {
    const result = await asUser(userBWithRealAccessElsewhere, (c) =>
      c.query("UPDATE engagements SET name = 'tampered' WHERE id = $1", [engagementA]),
    );
    expect(result.rowCount).toBe(0);
  });
});
