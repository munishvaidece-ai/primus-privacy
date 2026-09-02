// P2B.0.2 — Users Identity Integrity Hardening. P2B.0.1's own live
// verification confirmed that `GRANT SELECT, UPDATE ON "users" TO
// authenticated` (migration 0001) plus `users_update_self`'s row-only
// RLS policy let any authenticated user change their OWN `tenant_id`/
// `client_org_id`/`email`/`status` via a plain UPDATE — a pre-existing
// gap, not introduced by P2B, but one P2B's own invitation-acceptance
// design depends on being closed. Migration 0033's `prevent_user_
// identity_tampering` trigger is the fix under test here — entirely a
// database/RLS/trigger-level boundary (no domain function anywhere
// touches `users` UPDATE — confirmed by exhaustive grep, see
// docs/P2B.0.1_SECURITY_CLARIFICATIONS.md), so this suite exercises it
// directly via `asUser`/`asFixtureSetup`, the same way every other
// pure-RLS test in this directory does — no domain-function mocking.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asFixtureSetup, asUser, createTenant, createOrganisation, createUser, pool } from "./helpers";

describe("users identity/tenancy integrity (P2B.0.2)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string;
  let userA: string; // practice-side, tenantA, client_org_id = null
  let clientUserA: string; // client-side, tenantA, client_org_id = orgA
  let otherUserA: string; // a second, unrelated tenantA user — the "another user's row" target

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "P2B.0.2 Tenant A");
      tenantB = await createTenant(client, "P2B.0.2 Tenant B");
      orgA = await createOrganisation(client, tenantA, "P2B.0.2 Org A");

      userA = await createUser(client, { tenantId: tenantA });
      clientUserA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      otherUserA = await createUser(client, { tenantId: tenantA });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function currentRow(userId: string) {
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT tenant_id, client_org_id, email, status, display_name, created_at FROM users WHERE id = $1", [userId]),
    );
    return rows[0];
  }

  it("1. an authenticated user cannot change their own tenant_id", async () => {
    const before = await currentRow(userA);
    await expect(asUser(userA, (c) => c.query("UPDATE users SET tenant_id = $1 WHERE id = $2", [tenantB, userA]))).rejects.toThrow(
      /immutable via ordinary self-update/i,
    );
    expect(await currentRow(userA)).toEqual(before);
  });

  it("2. an authenticated user cannot change their own client_org_id", async () => {
    const before = await currentRow(userA);
    await expect(asUser(userA, (c) => c.query("UPDATE users SET client_org_id = $1 WHERE id = $2", [orgA, userA]))).rejects.toThrow(
      /immutable via ordinary self-update/i,
    );
    expect(await currentRow(userA)).toEqual(before);
  });

  it("3. an authenticated user cannot change their own status", async () => {
    const before = await currentRow(userA);
    await expect(asUser(userA, (c) => c.query("UPDATE users SET status = 'suspended' WHERE id = $1", [userA]))).rejects.toThrow(
      /immutable via ordinary self-update/i,
    );
    expect(await currentRow(userA)).toEqual(before);
  });

  it("4. an authenticated user cannot change their own email", async () => {
    const before = await currentRow(userA);
    await expect(
      asUser(userA, (c) => c.query("UPDATE users SET email = 'impersonator@example.test' WHERE id = $1", [userA])),
    ).rejects.toThrow(/immutable via ordinary self-update/i);
    expect(await currentRow(userA)).toEqual(before);
  });

  it("4b. an authenticated user cannot change their own created_at (audit-integrity)", async () => {
    const before = await currentRow(userA);
    await expect(
      asUser(userA, (c) => c.query("UPDATE users SET created_at = now() - interval '10 years' WHERE id = $1", [userA])),
    ).rejects.toThrow(/immutable via ordinary self-update/i);
    expect(await currentRow(userA)).toEqual(before);
  });

  it("5. an authenticated user cannot change ANOTHER user's protected fields, even a fellow tenant member", async () => {
    const before = await currentRow(otherUserA);
    // RLS's own row-scoping (`id = auth.uid()`) already blocks this —
    // the UPDATE matches zero rows rather than throwing — reconfirmed
    // here as a regression guard, not a new mechanism.
    const result = await asUser(userA, (c) =>
      c.query("UPDATE users SET status = 'suspended' WHERE id = $1", [otherUserA]),
    );
    expect(result.rowCount).toBe(0);
    expect(await currentRow(otherUserA)).toEqual(before);
  });

  it("6. cross-tenant manipulation is blocked — a user cannot move themselves into another tenant, or attach themselves to another tenant's organisation", async () => {
    const before = await currentRow(userA);
    await expect(
      asUser(userA, (c) => c.query("UPDATE users SET tenant_id = $1, client_org_id = $2 WHERE id = $3", [tenantB, orgA, userA])),
    ).rejects.toThrow(/immutable via ordinary self-update/i);
    expect(await currentRow(userA)).toEqual(before);
  });

  it("7. legitimate self-editable fields (display_name, updated_at) still work for an ordinary authenticated user", async () => {
    // `asUser` always rolls back at the end (it's a permission probe,
    // not a real write) — so success/failure and the resulting value
    // must be observed INSIDE the same callback/transaction, via
    // RETURNING, exactly like every other UPDATE-permission test in
    // this file already does implicitly through rejection/acceptance.
    const newTimestamp = new Date();
    const result = await asUser(userA, (c) =>
      c.query("UPDATE users SET display_name = $1, updated_at = $2 WHERE id = $3 RETURNING display_name, updated_at", [
        "A New Display Name",
        newTimestamp,
        userA,
      ]),
    );
    expect(result.rows[0]).toMatchObject({ display_name: "A New Display Name" });
    expect(new Date(result.rows[0].updated_at).getTime()).toBe(newTimestamp.getTime());

    // And confirm it really was rolled back (asUser's own documented
    // behavior) rather than this test accidentally relying on a
    // lingering write from an earlier test.
    expect((await currentRow(userA)).display_name).toBeNull();
  });

  it("8. legitimate server-side provisioning (the on_auth_user_created trigger) still works unchanged — a fresh auth.users INSERT still produces a matching public.users row", async () => {
    const newUserId = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: "fresh-provision@example.test" }));
    const row = await currentRow(newUserId);
    expect(row).toMatchObject({ tenant_id: tenantA, client_org_id: orgA, email: "fresh-provision@example.test", status: "active" });
  });

  it("8b. the legitimate email-sync trigger (handle_auth_user_email_change) still works — an auth.users email UPDATE still propagates to public.users", async () => {
    const newUserId = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, email: "before-sync@example.test" }));
    expect((await currentRow(newUserId)).email).toBe("before-sync@example.test");

    // The real Supabase Auth email-change flow ultimately updates
    // auth.users itself, as a privileged/system role, never as
    // `authenticated` — simulated here the same way `handle_new_auth_
    // user`'s own INSERT path is simulated throughout this test suite
    // (a direct write to the shimmed `auth.users` table via the
    // fixture-setup superuser connection).
    await asFixtureSetup((c) => c.query("UPDATE auth.users SET email = $1 WHERE id = $2", ["after-sync@example.test", newUserId]));
    expect((await currentRow(newUserId)).email).toBe("after-sync@example.test");
  });

  it("9. invitation-relevant identity assumption holds: client_org_id cannot be forged to impersonate a different organisation's member, nor cleared to impersonate a practice-side user", async () => {
    // The two P2B-relevant tampering directions named in
    // docs/P2B.0.1_SECURITY_CLARIFICATIONS.md §2c: a client-side user
    // trying to move to a different org, and a client-side user trying
    // to erase their own client_org_id to impersonate practice-side.
    const before = await currentRow(clientUserA);
    expect(before.client_org_id).toBe(orgA);

    await expect(
      asUser(clientUserA, (c) => c.query("UPDATE users SET client_org_id = $1 WHERE id = $2", [null, clientUserA])),
    ).rejects.toThrow(/immutable via ordinary self-update/i);

    const otherOrg = await asFixtureSetup((c) => createOrganisation(c, tenantA, "P2B.0.2 Org A2"));
    await expect(
      asUser(clientUserA, (c) => c.query("UPDATE users SET client_org_id = $1 WHERE id = $2", [otherOrg, clientUserA])),
    ).rejects.toThrow(/immutable via ordinary self-update/i);

    expect(await currentRow(clientUserA)).toEqual(before);
  });
});
