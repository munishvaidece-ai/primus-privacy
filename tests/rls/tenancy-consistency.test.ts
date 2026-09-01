// RLS Test 3 and Test 5 (Milestone 1 instructions §10):
//   3. An Organisation belonging to Tenant A cannot be associated with
//      Tenant B.
//   5. An Engagement cannot be created with inconsistent
//      Organisation/Tenant relationships.
//
// Both are checked at TWO independent layers, deliberately: the
// database-level trigger/composite-FK (which applies to EVERYONE,
// including a superuser/service_role bypassing RLS) and, where relevant,
// RLS's own WITH CHECK. This is the concrete proof that "historical data
// cannot be silently rewritten by current-state changes" and "do not
// allow inconsistent tenant relationships" hold structurally, not just
// by RLS convention.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  grantOrganisationMembership,
  grantTenantMembership,
  pool,
} from "./helpers";

describe("tenancy consistency (reparenting guards + composite FK)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string;
  let tenantAUser: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — consistency test");
      tenantB = await createTenant(client, "Tenant B — consistency test");
      orgA = await createOrganisation(client, tenantA, "ABC Financial Services");
      // give orgA at least one engagement, so a successful reparent would
      // orphan/inconsistency-break real dependent data, not just an
      // empty row
      await createEngagement(client, tenantA, orgA, "DPDP Readiness — FY2026");

      tenantAUser = await createUser(client, { tenantId: tenantA });
      await grantTenantMembership(client, tenantAUser, tenantA, "Platform Administrator");
      await grantOrganisationMembership(client, tenantAUser, orgA, "Client Administrator");
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Test 3a — even a superuser (bypassing RLS entirely) cannot re-parent an organisation to a different tenant", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(
        client.query("UPDATE organisations SET tenant_id = $1 WHERE id = $2", [tenantB, orgA]),
      ).rejects.toThrow(/tenant_id is immutable/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("Test 3b — an authenticated Tenant A user with real access to the organisation still cannot re-parent it", async () => {
    await expect(
      asUser(tenantAUser, (c) =>
        c.query("UPDATE organisations SET tenant_id = $1 WHERE id = $2", [tenantB, orgA]),
      ),
    ).rejects.toThrow(/tenant_id is immutable/i);
  });

  it("Test 3c — an ordinary update (not touching tenant_id) by an authorized user still succeeds", async () => {
    const result = await asUser(tenantAUser, (c) =>
      c.query("UPDATE organisations SET name = $1 WHERE id = $2 RETURNING name", [
        "ABC Financial Services (renamed)",
        orgA,
      ]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe("ABC Financial Services (renamed)");
  });

  it("Test 5a — the composite FK rejects an engagement whose (organisation_id, tenant_id) pair doesn't match any real organisation, even for a superuser", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // orgA really belongs to tenantA — claiming tenantB here is exactly
      // the inconsistent-relationship case Milestone 1 §4 prohibits.
      await expect(
        client.query(
          `INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type)
           VALUES ($1, $2, 'Mismatched Engagement', 'readiness')`,
          [tenantB, orgA],
        ),
      ).rejects.toMatchObject({ code: "23503" }); // foreign_key_violation
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("Test 5b — the same inconsistent insert is rejected for an authenticated user even though RLS's own WITH CHECK would otherwise have allowed it", async () => {
    // tenantAUser has OrganisationMembership on orgA, so
    // is_active_organisation_member(orgA) is true and the
    // engagements_insert policy's WITH CHECK would pass on that basis
    // alone — proving the composite FK is a REAL second layer, not
    // redundant with RLS.
    await expect(
      asUser(tenantAUser, (c) =>
        c.query(
          `INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type)
           VALUES ($1, $2, 'Mismatched Engagement', 'readiness')`,
          [tenantB, orgA],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("Test 5c — a correctly-consistent engagement insert by an authorized user succeeds", async () => {
    const result = await asUser(tenantAUser, (c) =>
      c.query(
        `INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type)
         VALUES ($1, $2, 'Annual DPDP Assessment — FY2027', 'annual_assessment') RETURNING id`,
        [tenantA, orgA],
      ),
    );
    expect(result.rows).toHaveLength(1);
  });
});
