// Milestone 3 §5 items 11-12 (and §6/§7's referential-integrity
// requirements generally):
//   11. A Processing Activity cannot reference a master-data version
//       belonging to another organisation.
//   12. A Processing Activity cannot reference a master-data version
//       belonging to another tenant.
//
// This is what DECISIONS.md's Milestone 2 scratch-table proof
// (tests/master-data/version-tenant-consistency.test.ts) was standing in
// for — the real ProcessingActivitySystem/ProcessingActivityProcessor/
// etc. junctions now exist, so this file proves the property against the
// actual product tables, not a test-only stand-in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createDataStore,
  createEngagement,
  createOrganisation,
  createProcessingActivity,
  createProcessor,
  createSystem,
  createTenant,
  createUser,
  grantOrganisationMembership,
  insertDataStoreVersion,
  insertProcessorVersion,
  insertSystemVersion,
  linkDataStore,
  linkProcessor,
  linkSystem,
  pool,
} from "./helpers";

describe("Processing Activity cannot reference a master-data version from another organisation/tenant", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgB: string;
  let engagementA: string;
  let user: string;
  let paA: string;
  let systemVersionA: string, systemVersionB: string;
  let processorB: string, processorVersionB: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — PA version consistency");
      tenantB = await createTenant(client, "Tenant B — PA version consistency");
      orgA = await createOrganisation(client, tenantA, "ABC Financial Services");
      orgB = await createOrganisation(client, tenantB, "Unrelated Client Co");

      engagementA = await createEngagement(client, tenantA, orgA, "DPDP Readiness — FY2026");
      user = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, user, orgA);

      paA = await createProcessingActivity(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, name: "Customer Onboarding" });

      const systemA = await createSystem(client, orgA);
      systemVersionA = await insertSystemVersion(client, { systemId: systemA, organisationId: orgA, name: "Customer CRM" });

      const systemB = await createSystem(client, orgB);
      systemVersionB = await insertSystemVersion(client, { systemId: systemB, organisationId: orgB, name: "Unrelated System" });

      processorB = await createProcessor(client, orgB);
      processorVersionB = await insertProcessorVersion(client, { processorId: processorB, organisationId: orgB, name: "Unrelated Processor" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("(11) rejects a System link claiming orgA but pointing at a System version that really belongs to orgB — even for a superuser bypassing RLS", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(
        client.query(
          `INSERT INTO processing_activity_systems (processing_activity_id, engagement_id, organisation_id, system_id, system_version_id)
           VALUES ($1, $2, $3, gen_random_uuid(), $4)`,
          [paA, engagementA, orgA, systemVersionB],
        ),
      ).rejects.toMatchObject({ code: "23503" }); // foreign_key_violation
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("(11 continued) rejects the same cross-organisation reference for an authenticated user whose RLS WITH CHECK would otherwise have allowed it", async () => {
    // `user` has real OrganisationMembership on orgA, so the
    // pa_systems_insert policy's WITH CHECK (can_access_engagement)
    // would pass — proving the composite FK is doing real, independent
    // work, not merely duplicating RLS.
    await expect(
      asUser(user, (c) =>
        c.query(
          `INSERT INTO processing_activity_systems (processing_activity_id, engagement_id, organisation_id, system_id, system_version_id)
           VALUES ($1, $2, $3, gen_random_uuid(), $4)`,
          [paA, engagementA, orgA, systemVersionB],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("(12) the same guarantee holds across tenants, not just across sibling organisations (orgB belongs to an entirely different tenant)", async () => {
    // Confirm orgB really is under a different tenant, so this is
    // genuinely testing cross-TENANT reference safety, not merely
    // cross-organisation-within-one-tenant (already covered above).
    const check = await asFixtureSetup((client) => client.query("SELECT tenant_id FROM organisations WHERE id = $1", [orgB]));
    expect(check.rows[0]!.tenant_id).toBe(tenantB);
    expect(tenantB).not.toBe(tenantA);

    await expect(
      asUser(user, (c) =>
        c.query(
          `INSERT INTO processing_activity_processors (processing_activity_id, engagement_id, organisation_id, processor_id, processor_version_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [paA, engagementA, orgA, processorB, processorVersionB],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("a correctly-scoped reference (same organisation as the Processing Activity) succeeds", async () => {
    const ok = await asUser(user, (c) =>
      c.query(
        `INSERT INTO processing_activity_systems (processing_activity_id, engagement_id, organisation_id, system_id, system_version_id)
         SELECT $1, $2, $3, system_id, id FROM system_versions WHERE id = $4 RETURNING id`,
        [paA, engagementA, orgA, systemVersionA],
      ),
    );
    expect(ok.rows).toHaveLength(1);
  });

  it("Processing Activity itself cannot be created under an inconsistent (engagement, organisation, tenant) triple", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // engagementA really belongs to (orgA, tenantA) — claiming orgA but
      // tenantB here is exactly the inconsistent-relationship case
      // Milestone 3 §7 prohibits.
      await expect(
        client.query(
          `INSERT INTO processing_activities (engagement_id, organisation_id, tenant_id, name) VALUES ($1, $2, $3, 'Inconsistent PA')`,
          [engagementA, orgA, tenantB],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
