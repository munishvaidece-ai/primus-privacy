// Milestone 2 §13's required RLS tests, against master-data tables:
//   - Organisation A can access its own master data.
//   - Organisation A cannot access Organisation B's master data.
//   - Tenant A cannot access Tenant B's master data.
//   - A user without appropriate membership cannot access protected
//     records.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asFixtureSetup,
  asUser,
  createOrganisation,
  createTenant,
  createUser,
  grantOrganisationMembership,
  insertSystemVersion,
  createSystem,
  createProcessor,
  insertProcessorVersion,
  pool,
} from "./helpers";

describe("master-data tenant/organisation isolation", () => {
  let tenantA: string, tenantB: string;
  let orgA1: string, orgA2: string, orgB: string; // two orgs under tenant A, one under tenant B
  let userA1: string; // member of orgA1 only
  let userB: string; // member of orgB (tenant B) only
  let outsiderUser: string; // exists, no membership anywhere

  let systemA1: string, systemVersionA1: string;
  let systemA2: string; // belongs to orgA2 — same tenant as orgA1, different org
  let systemB: string; // belongs to tenant B entirely
  let processorA1: string, processorVersionA1: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — master data isolation");
      tenantB = await createTenant(client, "Tenant B — master data isolation");
      orgA1 = await createOrganisation(client, tenantA, "ABC Financial Services");
      orgA2 = await createOrganisation(client, tenantA, "Another Client Under Tenant A");
      orgB = await createOrganisation(client, tenantB, "Unrelated Client Co");

      userA1 = await createUser(client, { tenantId: tenantA, clientOrgId: orgA1 });
      await grantOrganisationMembership(client, userA1, orgA1);

      userB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantOrganisationMembership(client, userB, orgB);

      outsiderUser = await createUser(client, { tenantId: tenantA });

      systemA1 = await createSystem(client, orgA1);
      systemVersionA1 = await insertSystemVersion(client, {
        systemId: systemA1,
        organisationId: orgA1,
        name: "Customer CRM",
        owner: "Digital Banking",
        hostingEnvironment: "India",
      });

      systemA2 = await createSystem(client, orgA2);
      await insertSystemVersion(client, { systemId: systemA2, organisationId: orgA2, name: "HRMS" });

      systemB = await createSystem(client, orgB);
      await insertSystemVersion(client, { systemId: systemB, organisationId: orgB, name: "Core Banking" });

      processorA1 = await createProcessor(client, orgA1);
      processorVersionA1 = await insertProcessorVersion(client, {
        processorId: processorA1,
        organisationId: orgA1,
        name: "KYC Vendor",
        dpaVersionLabel: "v1",
      });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Organisation A's member can access its own organisation's master data (identity and version rows)", async () => {
    const systemRows = await asUser(userA1, (c) => c.query("SELECT id FROM systems WHERE id = $1", [systemA1]));
    expect(systemRows.rows).toHaveLength(1);

    const versionRows = await asUser(userA1, (c) =>
      c.query("SELECT id, owner FROM system_versions WHERE id = $1", [systemVersionA1]),
    );
    expect(versionRows.rows).toHaveLength(1);
    expect(versionRows.rows[0]!.owner).toBe("Digital Banking");

    const processorRows = await asUser(userA1, (c) =>
      c.query("SELECT id FROM processor_versions WHERE id = $1", [processorVersionA1]),
    );
    expect(processorRows.rows).toHaveLength(1);
  });

  it("Organisation A's member cannot access a sibling organisation's master data, even under the SAME tenant", async () => {
    const rows = await asUser(userA1, (c) => c.query("SELECT id FROM systems WHERE id = $1", [systemA2]));
    expect(rows.rows).toHaveLength(0);

    const listing = await asUser(userA1, (c) => c.query("SELECT id FROM systems"));
    expect(listing.rows.map((r) => r.id)).toContain(systemA1);
    expect(listing.rows.map((r) => r.id)).not.toContain(systemA2);
  });

  it("a Tenant B user cannot access Tenant A's master data at all", async () => {
    const systemRows = await asUser(userB, (c) => c.query("SELECT id FROM systems WHERE id = $1", [systemA1]));
    expect(systemRows.rows).toHaveLength(0);

    const versionRows = await asUser(userB, (c) =>
      c.query("SELECT id FROM system_versions WHERE id = $1", [systemVersionA1]),
    );
    expect(versionRows.rows).toHaveLength(0);

    const listing = await asUser(userB, (c) => c.query("SELECT id FROM systems"));
    const ids = listing.rows.map((r) => r.id);
    expect(ids).toContain(systemB);
    expect(ids).not.toContain(systemA1);
    expect(ids).not.toContain(systemA2);
  });

  it("a user with no membership anywhere cannot access any organisation's master data", async () => {
    const rows = await asUser(outsiderUser, (c) => c.query("SELECT id FROM systems WHERE id = $1", [systemA1]));
    expect(rows.rows).toHaveLength(0);
    const listing = await asUser(outsiderUser, (c) => c.query("SELECT id FROM systems"));
    expect(listing.rows).toHaveLength(0);
  });

  it("an anonymous request is denied at the grant level before RLS is even evaluated", async () => {
    await expect(asAnon((c) => c.query("SELECT id FROM systems WHERE id = $1", [systemA1]))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("Organisation A's member cannot INSERT master data under a different organisation", async () => {
    await expect(
      asUser(userA1, (c) => c.query("INSERT INTO systems (organisation_id) VALUES ($1)", [orgA2])),
    ).rejects.toThrow(/row-level security/i);

    await expect(
      asUser(userA1, (c) => c.query("INSERT INTO systems (organisation_id) VALUES ($1)", [orgB])),
    ).rejects.toThrow(/row-level security/i);
  });
});
