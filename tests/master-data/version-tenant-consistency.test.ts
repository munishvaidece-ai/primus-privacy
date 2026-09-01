// Milestone 2 §4 item 6: "An engagement cannot reference a version
// belonging to another Organisation/Tenant."
//
// Processing Activity — the entity that will actually hold
// engagement-to-master-data-version pins (DATA_MODEL.md §5.3's
// ProcessingActivitySystem/ProcessingActivityProcessor/etc. junctions) —
// is explicitly out of scope for this milestone (§1/§12: "Do NOT build
// Processing Activities... do not prematurely create these future
// junction tables"). So this file proves the underlying mechanism that
// makes cross-organisation referencing structurally impossible — the
// same composite-FK technique Milestone 1 used for
// `engagements(organisation_id, tenant_id) -> organisations(id,
// tenant_id)`, now proven for master-data versions — using a scratch
// table, created and rolled back within a single test's own transaction
// and never part of any migration, that has exactly the shape a real
// future junction will need. This is a test artifact proving the
// mechanism, not a shipped schema object — see PROGRESS.md.
//
// It also exercises the composite FKs that DO already exist in the
// shipped schema (0002/0003) and touch this same property directly:
// DataStoreVersion.system_version_id and Processor.parent_processor_id
// both refuse to reference a version/processor from a different
// organisation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import {
  asFixtureSetup,
  createDataStore,
  createOrganisation,
  createProcessor,
  createTenant,
  createUser,
  grantOrganisationMembership,
  insertDataStoreVersion,
  insertProcessorVersion,
  insertSystemVersion,
  createSystem,
  pool,
} from "./helpers";

describe("master-data version-to-engagement tenant consistency", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgB: string;
  let engagementA: string;
  let systemVersionA: string, systemVersionB: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — version consistency");
      tenantB = await createTenant(client, "Tenant B — version consistency");
      orgA = await createOrganisation(client, tenantA, "ABC Financial Services");
      orgB = await createOrganisation(client, tenantB, "Unrelated Client Co");

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type)
         VALUES ($1, $2, 'DPDP Readiness — FY2026', 'readiness') RETURNING id`,
        [tenantA, orgA],
      );
      engagementA = rows[0]!.id;

      const systemA = await createSystem(client, orgA);
      systemVersionA = await insertSystemVersion(client, {
        systemId: systemA,
        organisationId: orgA,
        name: "Customer CRM",
      });

      const systemB = await createSystem(client, orgB);
      systemVersionB = await insertSystemVersion(client, {
        systemId: systemB,
        organisationId: orgB,
        name: "Some Other System",
      });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // A scratch table with exactly the shape DATA_MODEL.md §5.3's real
  // ProcessingActivitySystem junction will have — id, an organisation_id
  // column, and a composite FK to the version table requiring
  // (system_version_id, organisation_id) to be a real row.
  //
  // Deliberately NOT `CREATE TEMP TABLE`: Postgres refuses a foreign key
  // from a temporary table to a permanent one ("constraints on temporary
  // tables may reference only temporary tables") — a real, if
  // scoped-to-this-test, ordinary table is required to reference
  // `system_versions`. It never survives past the calling test: each
  // caller runs it inside its own transaction that always ends in
  // ROLLBACK, which undoes the CREATE TABLE along with everything else.
  //
  // Each test gets a fresh client/transaction (rather than sharing one
  // across an expected-failure and a follow-up success): once a
  // statement fails inside a Postgres transaction, that transaction is
  // aborted and refuses every further command until it ends — so a
  // "rejects" assertion and a subsequent "succeeds" assertion can never
  // safely share one transaction.
  async function withPinTable<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DROP TABLE IF EXISTS test_engagement_master_data_pin`);
      await client.query(`
        CREATE TABLE test_engagement_master_data_pin (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          engagement_id uuid NOT NULL,
          organisation_id uuid NOT NULL,
          system_version_id uuid NOT NULL,
          FOREIGN KEY (system_version_id, organisation_id)
            REFERENCES system_versions (id, organisation_id)
        )
      `);
      return await fn(client);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }

  it("the composite-FK mechanism rejects pinning Tenant A's engagement to Tenant B's system version", async () => {
    // engagementA's own organisation is orgA — pinning it to
    // systemVersionB (which really belongs to orgB) must fail: no row in
    // system_versions has (systemVersionB, orgA).
    await expect(
      withPinTable((client) =>
        client.query(
          `INSERT INTO test_engagement_master_data_pin (engagement_id, organisation_id, system_version_id)
           VALUES ($1, $2, $3)`,
          [engagementA, orgA, systemVersionB],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" }); // foreign_key_violation
  });

  it("the composite-FK mechanism allows pinning Tenant A's engagement to its own organisation's system version", async () => {
    const ok = await withPinTable((client) =>
      client.query(
        `INSERT INTO test_engagement_master_data_pin (engagement_id, organisation_id, system_version_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [engagementA, orgA, systemVersionA],
      ),
    );
    expect(ok.rows).toHaveLength(1);
  });

  it("DataStoreVersion.system_version_id (a real, shipped composite FK) refuses a system version from a different organisation", async () => {
    await expect(
      asFixtureSetup(async (client) => {
        const dataStore = await createDataStore(client, orgA);
        await insertDataStoreVersion(client, {
          dataStoreId: dataStore,
          organisationId: orgA,
          name: "Customer Database",
          systemVersionId: systemVersionB, // belongs to orgB, not orgA
        });
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("DataStoreVersion.system_version_id succeeds when the system version really belongs to the same organisation", async () => {
    const dataStoreVersionId = await asFixtureSetup(async (client) => {
      const dataStore = await createDataStore(client, orgA);
      return insertDataStoreVersion(client, {
        dataStoreId: dataStore,
        organisationId: orgA,
        name: "Customer Database",
        systemVersionId: systemVersionA,
      });
    });
    expect(dataStoreVersionId).toBeTruthy();
  });

  it("Processor.parent_processor_id (a real, shipped composite FK) refuses a parent processor from a different organisation", async () => {
    const foreignParentProcessor = await asFixtureSetup((client) => createProcessor(client, orgB));

    await expect(
      asFixtureSetup((client) => createProcessor(client, orgA, foreignParentProcessor)),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("Processor.parent_processor_id succeeds for a parent within the same organisation (subprocessor chain)", async () => {
    const result = await asFixtureSetup(async (client) => {
      const parent = await createProcessor(client, orgA);
      await insertProcessorVersion(client, { processorId: parent, organisationId: orgA, name: "Cloud Provider" });
      const sub = await createProcessor(client, orgA, parent);
      await insertProcessorVersion(client, { processorId: sub, organisationId: orgA, name: "Cloud Provider — Sub-processor" });
      return sub;
    });
    expect(result).toBeTruthy();
  });
});
