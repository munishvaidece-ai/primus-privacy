// Milestone 2 §4's worked scenario, tested against real PostgreSQL:
//
//   ABC Financial Services — System: Customer CRM
//   Version 1: Hosting = India,     Owner = Digital Banking  (FY2026)
//   Version 2: Hosting = Singapore, Owner = Technology       (FY2027)
//
// Required demonstrations (§4):
//   1. Both versions remain queryable.
//   2. FY2026 still resolves to Version 1.
//   3. FY2027 resolves to Version 2.
//   4. Reading the current CRM state returns Version 2.
//   5. Changing Version 2 does not rewrite Version 1.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createOrganisation,
  createTenant,
  createUser,
  grantOrganisationMembership,
  insertSystemVersion,
  createSystem,
  pool,
} from "./helpers";

describe("System master-data versioning — the ABC Financial CRM scenario", () => {
  let tenant: string;
  let org: string;
  let user: string;
  let systemId: string;
  let v1Id: string;
  let v2Id: string;
  // Independent "as of" markers (real `SELECT now()` calls with a real
  // wall-clock gap around each version's creation), NOT the version
  // rows' own valid_from/created_at values. Two reasons: (1) it's the
  // realistic case — a real "what did this look like during FY2026"
  // query picks an arbitrary moment during FY2026, not the exact
  // instant a row happened to be inserted; (2) `pg` returns `timestamptz`
  // as a JS `Date`, which only has millisecond precision, while Postgres
  // stores microseconds — round-tripping a version row's own boundary
  // timestamp through JS and back can lose enough precision to flip a
  // `<=`/`<` comparison at the exact boundary. A marker with a real
  // 50ms+ margin on both sides makes that irrelevant.
  let asOfFY2026: Date;
  let asOfFY2027: Date;

  beforeAll(async () => {
    // Deliberately separate asFixtureSetup calls (separate transactions)
    // for setup, v1, and v2 — Postgres's now()/valid_from default is
    // *transaction*-timestamp, frozen for the whole transaction, so
    // creating v1 and v2 inside a single transaction would give them the
    // exact same timestamp regardless of any delay in between. Separate
    // transactions also simply match reality: v1 and v2 are created by
    // separate real-world actions, likely far apart in time.
    ({ tenant, org, user, systemId } = await asFixtureSetup(async (client) => {
      const tenant = await createTenant(client, "ABC Financial Services — Tenant");
      const org = await createOrganisation(client, tenant, "ABC Financial Services");
      const user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
      const systemId = await createSystem(client, org);
      return { tenant, org, user, systemId };
    }));

    v1Id = await asFixtureSetup((client) =>
      insertSystemVersion(client, {
        systemId,
        organisationId: org,
        name: "Customer CRM",
        owner: "Digital Banking",
        hostingEnvironment: "India",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    asOfFY2026 = await asFixtureSetup(async (client) => {
      const { rows } = await client.query<{ now: Date }>("SELECT now()");
      return rows[0]!.now;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    v2Id = await asFixtureSetup((client) =>
      insertSystemVersion(client, {
        systemId,
        organisationId: org,
        name: "Customer CRM",
        owner: "Technology",
        hostingEnvironment: "Singapore",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    asOfFY2027 = await asFixtureSetup(async (client) => {
      const { rows } = await client.query<{ now: Date }>("SELECT now()");
      return rows[0]!.now;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("(1) both versions remain queryable, with their original fields intact", async () => {
    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT id, owner, hosting_environment, is_current, valid_to FROM system_versions
         WHERE system_id = $1 ORDER BY created_at`,
        [systemId],
      ),
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ id: v1Id, owner: "Digital Banking", hosting_environment: "India", is_current: false });
    expect(rows.rows[0]!.valid_to).not.toBeNull();
    expect(rows.rows[1]).toMatchObject({ id: v2Id, owner: "Technology", hosting_environment: "Singapore", is_current: true });
    expect(rows.rows[1]!.valid_to).toBeNull();
  });

  it("(2) a point-in-time query 'as of FY2026' resolves to Version 1", async () => {
    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT id, owner, hosting_environment FROM system_versions
         WHERE system_id = $1 AND valid_from <= $2 AND ($2 < valid_to OR valid_to IS NULL)`,
        [systemId, asOfFY2026],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ id: v1Id, owner: "Digital Banking", hosting_environment: "India" });
  });

  it("(3) a point-in-time query 'as of FY2027' resolves to Version 2", async () => {
    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT id, owner, hosting_environment FROM system_versions
         WHERE system_id = $1 AND valid_from <= $2 AND ($2 < valid_to OR valid_to IS NULL)`,
        [systemId, asOfFY2027],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ id: v2Id, owner: "Technology", hosting_environment: "Singapore" });
  });

  it("(4) reading the current CRM state (identity JOIN version WHERE is_current) returns Version 2", async () => {
    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT sv.id, sv.owner, sv.hosting_environment
         FROM systems s
         JOIN system_versions sv ON sv.system_id = s.id AND sv.is_current = true
         WHERE s.id = $1`,
        [systemId],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ id: v2Id, owner: "Technology", hosting_environment: "Singapore" });
  });

  it("(5) creating Version 3 does not rewrite Version 1 or Version 2's own fields — only Version 2's lifecycle columns change", async () => {
    const v3Id = await asFixtureSetup((client) =>
      insertSystemVersion(client, {
        systemId,
        organisationId: org,
        name: "Customer CRM",
        owner: "Technology & Security",
        hostingEnvironment: "Singapore (DR: Mumbai)",
      }),
    );

    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT id, owner, hosting_environment, is_current, valid_to FROM system_versions
         WHERE system_id = $1 ORDER BY created_at`,
        [systemId],
      ),
    );
    expect(rows.rows).toHaveLength(3);
    // Version 1 — completely untouched.
    expect(rows.rows[0]).toMatchObject({ id: v1Id, owner: "Digital Banking", hosting_environment: "India", is_current: false });
    // Version 2 — descriptive fields untouched; only is_current/valid_to
    // (the lifecycle bookkeeping columns) changed, and only because it
    // was superseded, not rewritten.
    expect(rows.rows[1]).toMatchObject({ id: v2Id, owner: "Technology", hosting_environment: "Singapore", is_current: false });
    expect(rows.rows[1]!.valid_to).not.toBeNull();
    // Version 3 — the new current version.
    expect(rows.rows[2]).toMatchObject({ id: v3Id, owner: "Technology & Security", is_current: true });
  });

  it("(5 continued) a direct UPDATE attempt against a version row's descriptive fields is rejected outright (no UPDATE grant exists for authenticated)", async () => {
    await expect(
      asUser(user, (c) => c.query("UPDATE system_versions SET owner = 'tampered' WHERE id = $1", [v1Id])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("exactly one current version exists at any time (SCD2's core invariant, DB-enforced)", async () => {
    const rows = await asUser(user, (c) =>
      c.query("SELECT count(*) AS n FROM system_versions WHERE system_id = $1 AND is_current = true", [systemId]),
    );
    expect(Number(rows.rows[0]!.n)).toBe(1);
  });
});
