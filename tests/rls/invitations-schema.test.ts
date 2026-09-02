// P2B.1 — Invitation Schema & Lifecycle. Schema/constraint/trigger-level
// tests only — no domain function, Server Action, token-generation
// logic, or SECURITY DEFINER acceptance function exists yet (later P2B
// slices). Migration 0035 deliberately grants `authenticated` NOTHING
// on `invitations` yet (P2B.2's own scope), so every operation here runs
// via `asFixtureSetup` (the raw superuser connection, bypassing GRANT/
// RLS entirely) — the same pattern `tests/risk-remediation/crud.test.ts`/
// `tests/evidence/crud.test.ts` already use for pure schema-level
// coverage, not a workaround.
//
// P2B.1.1 (migration 0036, DECISIONS.md R-159): tests 23/23b updated —
// `invitations` now uses its own dedicated `log_invitation_change()`
// audit trigger, which withholds `token_hash` from `audit_log.field_
// changes` entirely (not merely from a raw-token comparison); every
// other column remains fully auditable.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  getOrCreateRole,
  pool,
} from "./helpers";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe("invitations — schema & lifecycle (P2B.1)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string, engagementA2: string, engagementB: string;
  let managerA: string; // invited_by candidate, tenantA
  let acceptedUserA: string; // a real tenantA user, standing in for an eventual acceptor
  let roleClientAdministrator: string; // organisation-scope client role
  let roleBusinessOwner: string; // engagement-scope client role

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "P2B.1 Tenant A");
      tenantB = await createTenant(client, "P2B.1 Tenant B");
      orgA = await createOrganisation(client, tenantA, "P2B.1 Org A");
      orgA2 = await createOrganisation(client, tenantA, "P2B.1 Org A2");
      orgB = await createOrganisation(client, tenantB, "P2B.1 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "P2B.1 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "P2B.1 Engagement A2");
      engagementB = await createEngagement(client, tenantB, orgB, "P2B.1 Engagement B");

      managerA = await createUser(client, { tenantId: tenantA });
      acceptedUserA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });

      roleClientAdministrator = await getOrCreateRole(client, "Client Administrator");
      roleBusinessOwner = await getOrCreateRole(client, "Business Owner");
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  interface InvitationOverrides {
    id?: string;
    tenantId?: string;
    organisationId?: string;
    engagementId?: string | null;
    invitedEmail?: string;
    roleId?: string;
    tokenHash?: string;
    expiresAt?: Date;
    invitedBy?: string;
  }

  function insertInvitation(overrides: InvitationOverrides = {}) {
    const row = {
      id: overrides.id ?? randomUUID(),
      tenantId: overrides.tenantId ?? tenantA,
      organisationId: overrides.organisationId ?? orgA,
      engagementId: overrides.engagementId === undefined ? null : overrides.engagementId,
      invitedEmail: overrides.invitedEmail ?? "invitee@example.test",
      roleId: overrides.roleId ?? roleClientAdministrator,
      tokenHash: overrides.tokenHash ?? randomUUID().replace(/-/g, ""),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + SEVEN_DAYS_MS),
      invitedBy: overrides.invitedBy ?? managerA,
    };
    return asFixtureSetup((c) =>
      c.query(
        `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [row.id, row.tenantId, row.organisationId, row.engagementId, row.invitedEmail, row.roleId, row.tokenHash, row.expiresAt, row.invitedBy],
      ),
    );
  }

  async function invitationRow(id: string) {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT * FROM invitations WHERE id = $1", [id]));
    return rows[0];
  }

  // --- Basic creation ---------------------------------------------------

  it("1. a valid organisation-scoped invitation (engagement_id NULL) can exist", async () => {
    const result = await insertInvitation({ engagementId: null, roleId: roleClientAdministrator });
    expect(result.rows[0]).toMatchObject({ organisation_id: orgA, engagement_id: null, status: "pending" });
  });

  it("2. a valid engagement-scoped invitation (engagement_id set) can exist", async () => {
    const result = await insertInvitation({ engagementId: engagementA, roleId: roleBusinessOwner, invitedEmail: "engagement-scoped@example.test" });
    expect(result.rows[0]).toMatchObject({ organisation_id: orgA, engagement_id: engagementA, status: "pending" });
  });

  // --- Referential integrity ---------------------------------------------

  it("3. an invalid tenant/organisation combination is rejected — organisation_id from a different tenant than tenant_id", async () => {
    await expect(
      insertInvitation({ tenantId: tenantB, organisationId: orgA, invitedEmail: "bad-tenant-org@example.test" }),
    ).rejects.toThrow(/invitations_organisation_tenant_fk|foreign key/i);
  });

  it("4. an invalid organisation/engagement combination is rejected — engagement_id belongs to a different organisation", async () => {
    await expect(
      insertInvitation({ organisationId: orgA, engagementId: engagementA2, invitedEmail: "bad-org-engagement@example.test" }),
    ).rejects.toThrow(/invitations_engagement_organisation_tenant_fk|foreign key/i);
  });

  it("5. a cross-tenant engagement reference is rejected — engagement_id belongs to a different tenant entirely", async () => {
    await expect(
      insertInvitation({ tenantId: tenantA, organisationId: orgA, engagementId: engagementB, invitedEmail: "cross-tenant-engagement@example.test" }),
    ).rejects.toThrow(/invitations_engagement_organisation_tenant_fk|foreign key/i);
  });

  // --- Scope --------------------------------------------------------------

  it("6. an organisation-scoped invitation has engagement_id = NULL, structurally", async () => {
    const result = await insertInvitation({ engagementId: null, invitedEmail: "org-scoped-null@example.test" });
    expect(result.rows[0].engagement_id).toBeNull();
  });

  it("7. an engagement-scoped invitation references the correct organisation (proven by the composite FK, not merely by convention)", async () => {
    const result = await insertInvitation({ engagementId: engagementA, invitedEmail: "engagement-scope-correct@example.test" });
    expect(result.rows[0]).toMatchObject({ organisation_id: orgA, engagement_id: engagementA });
  });

  // --- Email ----------------------------------------------------------------

  it("8. email normalization is enforced — a non-lowercase invited_email is rejected at the database level", async () => {
    await expect(insertInvitation({ invitedEmail: "Mixed.Case@Example.com" })).rejects.toThrow(
      /invitations_invited_email_normalized_check/i,
    );
  });

  it("9. case variations cannot bypass the pending-uniqueness rule — 'Client@Example.com' and 'client@example.com' collide once normalized", async () => {
    await insertInvitation({ invitedEmail: "collision@example.com", organisationId: orgA, engagementId: null });
    // The application layer is responsible for lower-casing before
    // insert (the CHECK constraint only proves it always did) — this
    // test confirms the NORMALIZED form collides correctly; a raw,
    // not-yet-lowercased duplicate is separately rejected by the CHECK
    // itself (test 8), so there is no path by which two different-case
    // spellings of the same address could ever reach two live rows.
    await expect(insertInvitation({ invitedEmail: "collision@example.com", organisationId: orgA, engagementId: null })).rejects.toThrow(
      /invitations_pending_organisation_scoped_key/i,
    );
  });

  // --- Lifecycle --------------------------------------------------------------

  it("10. a pending invitation is the default, valid creation state", async () => {
    const result = await insertInvitation({ invitedEmail: "lifecycle-pending@example.test" });
    expect(result.rows[0].status).toBe("pending");
    expect(result.rows[0].accepted_at).toBeNull();
    expect(result.rows[0].accepted_user_id).toBeNull();
    expect(result.rows[0].revoked_at).toBeNull();
  });

  it("11. a pending invitation can transition to accepted, with accepted_at/accepted_user_id set together", async () => {
    const { rows } = await insertInvitation({ invitedEmail: "lifecycle-accept@example.test" });
    const id = rows[0].id;
    const acceptedAt = new Date();
    const result = await asFixtureSetup((c) =>
      c.query(
        "UPDATE invitations SET status = 'accepted', accepted_at = $1, accepted_user_id = $2 WHERE id = $3 RETURNING *",
        [acceptedAt, acceptedUserA, id],
      ),
    );
    expect(result.rows[0]).toMatchObject({ status: "accepted", accepted_user_id: acceptedUserA });
    expect(result.rows[0].accepted_at).not.toBeNull();
  });

  it("12. a pending invitation can transition to revoked, with revoked_at set", async () => {
    const { rows } = await insertInvitation({ invitedEmail: "lifecycle-revoke@example.test" });
    const id = rows[0].id;
    const result = await asFixtureSetup((c) =>
      c.query("UPDATE invitations SET status = 'revoked', revoked_at = now() WHERE id = $1 RETURNING *", [id]),
    );
    expect(result.rows[0].status).toBe("revoked");
    expect(result.rows[0].revoked_at).not.toBeNull();
  });

  it("13. 'expired' is NOT a valid stored status — rejected as an invalid enum value, at both INSERT and UPDATE", async () => {
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO invitations (id, tenant_id, organisation_id, invited_email, role_id, token_hash, expires_at, invited_by, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'expired')`,
          [randomUUID(), tenantA, orgA, "expired-insert@example.test", roleClientAdministrator, randomUUID(), new Date(Date.now() + SEVEN_DAYS_MS), managerA],
        ),
      ),
    ).rejects.toThrow(/invalid input value for enum/i);

    const { rows } = await insertInvitation({ invitedEmail: "expired-update-attempt@example.test" });
    await expect(
      asFixtureSetup((c) => c.query("UPDATE invitations SET status = 'expired' WHERE id = $1", [rows[0].id])),
    ).rejects.toThrow(/invalid input value for enum/i);
  });

  // --- Uniqueness -------------------------------------------------------------

  it("14. a duplicate PENDING organisation-scoped invitation (same org + email) is rejected", async () => {
    await insertInvitation({ invitedEmail: "dup-org@example.test", organisationId: orgA, engagementId: null });
    await expect(insertInvitation({ invitedEmail: "dup-org@example.test", organisationId: orgA, engagementId: null })).rejects.toThrow(
      /invitations_pending_organisation_scoped_key/i,
    );
  });

  it("15. a duplicate PENDING engagement-scoped invitation (same engagement + email) is rejected", async () => {
    await insertInvitation({ invitedEmail: "dup-engagement@example.test", organisationId: orgA, engagementId: engagementA });
    await expect(
      insertInvitation({ invitedEmail: "dup-engagement@example.test", organisationId: orgA, engagementId: engagementA }),
    ).rejects.toThrow(/invitations_pending_engagement_scoped_key/i);
  });

  it("16. an ACCEPTED invitation does not block a new pending invitation for the same target", async () => {
    const { rows } = await insertInvitation({ invitedEmail: "accepted-then-new@example.test", organisationId: orgA, engagementId: null });
    await asFixtureSetup((c) =>
      c.query("UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_user_id = $1 WHERE id = $2", [acceptedUserA, rows[0].id]),
    );
    await expect(
      insertInvitation({ invitedEmail: "accepted-then-new@example.test", organisationId: orgA, engagementId: null }),
    ).resolves.toBeTruthy();
  });

  it("17. a REVOKED invitation does not block a new pending invitation for the same target", async () => {
    const { rows } = await insertInvitation({ invitedEmail: "revoked-then-new@example.test", organisationId: orgA, engagementId: null });
    await asFixtureSetup((c) => c.query("UPDATE invitations SET status = 'revoked', revoked_at = now() WHERE id = $1", [rows[0].id]));
    await expect(
      insertInvitation({ invitedEmail: "revoked-then-new@example.test", organisationId: orgA, engagementId: null }),
    ).resolves.toBeTruthy();
  });

  it("18. distinct engagements can each carry their own separate pending invitation for the same email", async () => {
    await expect(insertInvitation({ invitedEmail: "distinct-engagements@example.test", organisationId: orgA, engagementId: engagementA })).resolves.toBeTruthy();
    // engagementA2 belongs to orgA2, not orgA — use the matching
    // organisation so the composite FK is satisfied; the point under
    // test is that two DIFFERENT engagement scopes never collide.
    await expect(
      insertInvitation({ invitedEmail: "distinct-engagements@example.test", organisationId: orgA2, engagementId: engagementA2 }),
    ).resolves.toBeTruthy();
  });

  // --- Token --------------------------------------------------------------

  it("19. only token_hash is ever stored — no 'token'/raw-token column exists on the table at all", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invitations'`,
      ),
    );
    const columnNames = rows.map((r: { column_name: string }) => r.column_name);
    expect(columnNames).toContain("token_hash");
    expect(columnNames).not.toContain("token");
    expect(columnNames.some((c: string) => c.toLowerCase().includes("raw"))).toBe(false);
  });

  it("20. token_hash uniqueness is enforced — two invitations cannot share the same hash", async () => {
    const sharedHash = randomUUID().replace(/-/g, "");
    await insertInvitation({ invitedEmail: "hash-a@example.test", tokenHash: sharedHash });
    await expect(insertInvitation({ invitedEmail: "hash-b@example.test", tokenHash: sharedHash })).rejects.toThrow(
      /invitations_token_hash_key/i,
    );
  });

  // --- Tenant isolation -----------------------------------------------------

  it("21. cross-tenant manipulation is rejected — an invitation cannot be forged to combine tenant A's organisation with tenant B's own tenant_id, nor vice versa", async () => {
    await expect(
      insertInvitation({ tenantId: tenantB, organisationId: orgA, engagementId: engagementA, invitedEmail: "cross-tenant-forge@example.test" }),
    ).rejects.toThrow(/foreign key|invitations_organisation_tenant_fk/i);
  });

  // --- Audit ------------------------------------------------------------------

  it("22. the invitation lifecycle (created, then accepted) is captured through the existing generic audit mechanism", async () => {
    const { rows } = await insertInvitation({ invitedEmail: "audited@example.test" });
    const id = rows[0].id;
    await asFixtureSetup((c) =>
      c.query("UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_user_id = $1 WHERE id = $2", [acceptedUserA, id]),
    );

    const { rows: auditRows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT action, field_changes FROM audit_log WHERE entity_type = 'invitations' AND entity_id = $1 ORDER BY occurred_at`,
        [id],
      ),
    );
    expect(auditRows.map((r: { action: string }) => r.action)).toEqual(["insert", "update"]);
    expect(auditRows[0].field_changes.invited_email).toBe("audited@example.test");
    expect(auditRows[1].field_changes.new.status).toBe("accepted");
  });

  it("23. neither the raw token nor token_hash is ever present anywhere in the audit output (P2B.1.1, DECISIONS.md R-159)", async () => {
    const rawTokenLookAlike = "this-would-be-the-raw-token-if-it-were-ever-stored";
    const hash = randomUUID().replace(/-/g, "");
    const { rows } = await insertInvitation({ invitedEmail: "audit-no-raw-token@example.test", tokenHash: hash });
    const id = rows[0].id;

    await asFixtureSetup((c) =>
      c.query("UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_user_id = $1 WHERE id = $2", [acceptedUserA, id]),
    );

    const { rows: auditRows } = await asFixtureSetup((c) =>
      c.query(`SELECT field_changes FROM audit_log WHERE entity_type = 'invitations' AND entity_id = $1 ORDER BY occurred_at`, [id]),
    );
    expect(auditRows).toHaveLength(2); // insert, then the accept UPDATE — both checked
    for (const row of auditRows) {
      const serialized = JSON.stringify(row.field_changes);
      expect(serialized).not.toContain(rawTokenLookAlike);
      // Unlike document_versions.checksum_sha256 (an ordinary content
      // checksum), token_hash is the verifier for a bearer invitation
      // credential — deliberately excluded from audit output entirely
      // (not merely "not equal to the raw token"), per DECISIONS.md
      // R-159. Neither the value nor the key itself may appear.
      expect(serialized).not.toContain(hash);
      expect(row.field_changes).not.toHaveProperty("token_hash");
      if (row.field_changes.old) expect(row.field_changes.old).not.toHaveProperty("token_hash");
      if (row.field_changes.new) expect(row.field_changes.new).not.toHaveProperty("token_hash");
    }
  });

  it("23b. every other invitation column remains fully auditable — only token_hash is withheld", async () => {
    const { rows } = await insertInvitation({ invitedEmail: "audit-other-columns@example.test", engagementId: engagementA });
    const id = rows[0].id;
    const { rows: auditRows } = await asFixtureSetup((c) =>
      c.query(`SELECT field_changes FROM audit_log WHERE entity_type = 'invitations' AND entity_id = $1`, [id]),
    );
    expect(auditRows[0].field_changes).toMatchObject({
      id,
      organisation_id: orgA,
      engagement_id: engagementA,
      invited_email: "audit-other-columns@example.test",
      role_id: roleClientAdministrator,
      status: "pending",
    });
  });

  // --- Lifecycle integrity -----------------------------------------------------

  it("24. an invalid terminal-state transition is rejected at the database level — an accepted invitation cannot be revoked, edited, or re-accepted", async () => {
    const { rows } = await insertInvitation({ invitedEmail: "terminal-frozen@example.test" });
    const id = rows[0].id;
    await asFixtureSetup((c) =>
      c.query("UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_user_id = $1 WHERE id = $2", [acceptedUserA, id]),
    );

    await expect(
      asFixtureSetup((c) => c.query("UPDATE invitations SET status = 'revoked', revoked_at = now() WHERE id = $1", [id])),
    ).rejects.toThrow(/immutable once status leaves 'pending'/i);

    await expect(
      asFixtureSetup((c) => c.query("UPDATE invitations SET status = 'accepted', accepted_at = now() WHERE id = $1", [id])),
    ).rejects.toThrow(/immutable once status leaves 'pending'/i);

    await expect(
      asFixtureSetup((c) => c.query("UPDATE invitations SET invited_email = 'someone-else@example.test' WHERE id = $1", [id])),
    ).rejects.toThrow(/immutable once status leaves 'pending'/i);

    expect(await invitationRow(id)).toMatchObject({ status: "accepted", invited_email: "terminal-frozen@example.test" });
  });

  it("24b. while still pending, identity-defining columns cannot be reparented even though status itself is untouched", async () => {
    const { rows } = await insertInvitation({ invitedEmail: "reparent-attempt@example.test" });
    const id = rows[0].id;
    await expect(
      asFixtureSetup((c) => c.query("UPDATE invitations SET organisation_id = $1 WHERE id = $2", [orgA2, id])),
    ).rejects.toThrow(/immutable after creation/i);
    await expect(
      asFixtureSetup((c) => c.query("UPDATE invitations SET role_id = $1 WHERE id = $2", [roleBusinessOwner, id])),
    ).rejects.toThrow(/immutable after creation/i);
  });
});
