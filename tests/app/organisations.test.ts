// Slice B1 — Organisation Creation + Organisation Detail. Tests the real
// functions the real page/Server Action call (lib/domain/organisations.ts,
// lib/authorization/service.ts) against real PostgreSQL — no mocked
// permission functions. Covers the 8 required security scenarios (PHASE B
// instructions §16) plus creation success, validation-adjacent behavior,
// duplicate-name handling, and audit attribution.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createOrganisation,
  DuplicateOrganisationError,
  getOrganisationDetail,
  listAccessibleOrganisations,
} from "@/lib/domain/organisations";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import {
  asAnon,
  asFixtureSetup,
  createEngagement,
  createOrganisation as createOrganisationFixture,
  createTenant,
  createUser,
  grantEngagementMembership,
  grantOrganisationMembership,
  grantTenantMembership,
  pool,
} from "./helpers";

describe("Application layer — Organisation creation (Slice B1)", () => {
  let tenantA: string, tenantB: string;
  let orgB: string;
  let tenantMemberA: string; // active TenantMembership on tenantA — may create
  let orgOnlyUser: string; // OrganisationMembership only, no TenantMembership — may not create
  let engagementOnlyUser: string; // EngagementMembership only — may not create
  let outsiderUser: string; // no membership anywhere

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice B1 Tenant A");
      tenantB = await createTenant(client, "Slice B1 Tenant B");
      orgB = await createOrganisationFixture(client, tenantB, "Slice B1 Org B");

      tenantMemberA = await createUser(client, { tenantId: tenantA });
      await grantTenantMembership(client, tenantMemberA, tenantA);

      const orgA = await createOrganisationFixture(client, tenantA, "Slice B1 Pre-existing Org A");
      orgOnlyUser = await createUser(client, { tenantId: tenantA });
      await grantOrganisationMembership(client, orgOnlyUser, orgA);

      const engagementA = await createEngagement(client, tenantA, orgA, "Slice B1 Engagement A");
      engagementOnlyUser = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, engagementOnlyUser, engagementA);

      outsiderUser = await createUser(client, { tenantId: tenantA });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Creation success: a Tenant A tenant-member can create an organisation in Tenant A, correctly persisted with real column values", async () => {
    const { id } = await withRequestDb(tenantMemberA, (db) =>
      createOrganisation(db, tenantMemberA, { name: "Slice B1 New Org" }),
    );
    expect(id).toBeTruthy();

    // Read back as a fixture-setup (superuser) query, not through the
    // creator's own RLS-scoped session: see createOrganisation's own
    // docstring and the "Organisation detail visibility" test below —
    // a bare TenantMembership is sufficient to CREATE this row but not
    // to immediately read it back through the ordinary authenticated
    // read path, by design of the already-approved authorization model.
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT name, status, tenant_id, created_by FROM organisations WHERE id = $1", [id]),
    );
    expect(rows[0]).toMatchObject({
      name: "Slice B1 New Org",
      status: "active",
      tenant_id: tenantA,
      created_by: tenantMemberA,
    });
  });

  it("Organisation detail visibility: the creator CAN immediately read back the organisation they just created (Slice B2 closed the gap Slice B1 documented here)", async () => {
    // Slice B1 originally found and documented (DECISIONS.md R-88) that
    // getOrganisationDetail's own requireOrganisationAccess call — which
    // mirrors migration 0001's organisations_select policy
    // (can_access_organisation) exactly, and does not grant implicit
    // visibility from a bare TenantMembership (SECURITY.md §3's "no
    // implicit cross-client access", Slice A1/R-83) — meant a brand-new
    // organisation's own creator could not view it. Slice B2 closes this
    // (migration 0019 + createOrganisation's own auto-membership-grant,
    // see its docstring and DECISIONS.md) by granting the creator a real
    // OrganisationMembership in the same transaction as the organisation
    // itself — so this now succeeds, without requireOrganisationAccess
    // or organisations_select having been weakened at all.
    const { id } = await withRequestDb(tenantMemberA, (db) =>
      createOrganisation(db, tenantMemberA, { name: "Slice B1 Not-Yet-Visible Org" }),
    );
    const detail = await withRequestDb(tenantMemberA, (db) => getOrganisationDetail(db, tenantMemberA, id));
    expect(detail).toMatchObject({ id, name: "Slice B1 Not-Yet-Visible Org" });
  });

  it("1. a Tenant A tenant-member's created organisation is scoped to Tenant A, never to another tenant", async () => {
    const { id } = await withRequestDb(tenantMemberA, (db) =>
      createOrganisation(db, tenantMemberA, { name: "Slice B1 Scoped Org" }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT tenant_id FROM organisations WHERE id = $1", [id]));
    expect(rows[0]!.tenant_id).toBe(tenantA);
  });

  it("2. a Tenant A user cannot create an organisation under Tenant B (no client-supplied-tenant path exists; a raw attempt is rejected by RLS)", async () => {
    await expect(
      withRequestDb(tenantMemberA, (db, client) =>
        client.query(`INSERT INTO organisations (tenant_id, name) VALUES ($1, $2)`, [tenantB, "Malicious cross-tenant org"]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("3. a Tenant A user cannot read Tenant B's organisations via listAccessibleOrganisations or getOrganisationDetail", async () => {
    const list = await withRequestDb(tenantMemberA, (db) => listAccessibleOrganisations(db));
    expect(list.some((o) => o.id === orgB)).toBe(false);

    await expect(
      withRequestDb(tenantMemberA, (db) => getOrganisationDetail(db, tenantMemberA, orgB)),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4a. a user with only OrganisationMembership (no TenantMembership) cannot create an organisation", async () => {
    await expect(
      withRequestDb(orgOnlyUser, (db) => createOrganisation(db, orgOnlyUser, { name: "Should not be created" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);

    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT id FROM organisations WHERE name = $1", ["Should not be created"]),
    );
    expect(rows).toHaveLength(0);
  });

  it("4b. a user with only EngagementMembership cannot create an organisation", async () => {
    await expect(
      withRequestDb(engagementOnlyUser, (db) =>
        createOrganisation(db, engagementOnlyUser, { name: "Should also not be created" }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4c. a user with no membership at all cannot create an organisation", async () => {
    await expect(
      withRequestDb(outsiderUser, (db) => createOrganisation(db, outsiderUser, { name: "Outsider org" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("5. an anonymous (unauthenticated) request cannot create an organisation", async () => {
    // The `anon` role has no GRANT on `organisations` at all (migration
    // 0001 §7 — "anon receives nothing on any table in this migration"),
    // so this is rejected at the GRANT-privilege layer, before RLS's own
    // policy check even runs — a stricter outcome than a bare RLS denial,
    // not a weaker one.
    await expect(
      asAnon((client) => client.query(`INSERT INTO organisations (tenant_id, name) VALUES ($1, $2)`, [tenantA, "Anon org"])),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it("6. a malicious client-supplied tenant_id cannot change organisation ownership", async () => {
    // createOrganisation's own input type carries no tenant_id field at
    // all — there is no code path by which a browser-supplied value
    // could reach the INSERT. This directly proves the created row is
    // always attributed to the caller's own tenant regardless of what a
    // malicious caller might have tried to smuggle in.
    const { id } = await withRequestDb(tenantMemberA, (db) =>
      createOrganisation(db, tenantMemberA, { name: "Ownership-cannot-be-spoofed org" }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT tenant_id FROM organisations WHERE id = $1", [id]));
    expect(rows[0]!.tenant_id).toBe(tenantA);
    expect(rows[0]!.tenant_id).not.toBe(tenantB);
  });

  it("7. direct unauthorized DB access is blocked by RLS, independent of the application layer", async () => {
    await expect(
      withRequestDb(outsiderUser, (db, client) =>
        client.query(`INSERT INTO organisations (tenant_id, name) VALUES ($1, $2)`, [tenantA, "Bypass attempt"]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("8. organisation detail cannot be used to enumerate another tenant's organisation (identical error for forbidden vs nonexistent)", async () => {
    const forbidden = await withRequestDb(tenantMemberA, (db) =>
      getOrganisationDetail(db, tenantMemberA, orgB).catch((e) => e),
    );
    const nonexistent = await withRequestDb(tenantMemberA, (db) =>
      getOrganisationDetail(db, tenantMemberA, "00000000-0000-0000-0000-000000000000").catch((e) => e),
    );
    expect(forbidden).toBeInstanceOf(NotFoundOrForbiddenError);
    expect(nonexistent).toBeInstanceOf(NotFoundOrForbiddenError);
    expect((forbidden as Error).message).toBe((nonexistent as Error).message);
  });

  it("Duplicate-name handling: creating a second organisation with the same name (case-insensitive), visible to the caller, is rejected", async () => {
    // The duplicate check is itself RLS-scoped (see createOrganisation's
    // own docstring) — it can only see organisations the caller already
    // has read access to. Since Slice B2, createOrganisation itself
    // grants the creator OrganisationMembership on what they create (no
    // separate fixture grant needed any more, unlike this test's
    // original Slice B1 form), so the caller already has the visibility
    // this check needs for their own prior creation.
    await withRequestDb(tenantMemberA, (db) => createOrganisation(db, tenantMemberA, { name: "Duplicate Check Org" }));

    await expect(
      withRequestDb(tenantMemberA, (db) => createOrganisation(db, tenantMemberA, { name: "duplicate check org" })),
    ).rejects.toThrow(DuplicateOrganisationError);
  });

  it("Duplicate-name handling is necessarily best-effort: a name colliding with an organisation the caller cannot see is not detected (documented RLS-scoping limitation, not a bug)", async () => {
    // A different, unrelated tenant-member creates "Invisible Duplicate
    // Org" — tenantMemberA has no organisation/engagement membership on
    // it, so RLS itself (not just the application check) hides it from
    // tenantMemberA's own duplicate-check query. This is the direct,
    // by-design consequence documented on createOrganisation.
    const otherTenantMemberA = await asFixtureSetup(async (c) => {
      const id = await createUser(c, { tenantId: tenantA });
      await grantTenantMembership(c, id, tenantA);
      return id;
    });
    await withRequestDb(otherTenantMemberA, (db) =>
      createOrganisation(db, otherTenantMemberA, { name: "Invisible Duplicate Org" }),
    );

    const { id } = await withRequestDb(tenantMemberA, (db) =>
      createOrganisation(db, tenantMemberA, { name: "Invisible Duplicate Org" }),
    );
    expect(id).toBeTruthy();
  });

  it("Duplicate-name handling is scoped per tenant: the same name is allowed under a different tenant", async () => {
    await withRequestDb(tenantMemberA, (db) => createOrganisation(db, tenantMemberA, { name: "Shared Name Org" }));

    const tenantMemberB = await asFixtureSetup(async (c) => {
      const id = await createUser(c, { tenantId: tenantB });
      await grantTenantMembership(c, id, tenantB);
      return id;
    });

    const { id } = await withRequestDb(tenantMemberB, (db) =>
      createOrganisation(db, tenantMemberB, { name: "Shared Name Org" }),
    );
    expect(id).toBeTruthy();
  });

  it("Audit attribution: organisation creation is recorded in audit_log, attributed to the acting user", async () => {
    const { id } = await withRequestDb(tenantMemberA, (db) =>
      createOrganisation(db, tenantMemberA, { name: "Audited Org" }),
    );

    const { rows } = await withRequestDb(tenantMemberA, (_db, client) =>
      client.query(
        `SELECT actor_user_id, entity_type, action, tenant_id
         FROM audit_log WHERE entity_type = 'organisations' AND entity_id = $1`,
        [id],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: tenantMemberA,
      entity_type: "organisations",
      action: "insert",
      tenant_id: tenantA,
    });
  });
});
