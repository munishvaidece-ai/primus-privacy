// P2B.2 — Invitation Authorization & RLS. Tests migration 0037's own
// `invitations_select`/`invitations_insert`/`invitations_update`
// policies and the new `authenticated` GRANT, run under REAL RLS
// enforcement (`asUser`/`asAnon`, never mocked) — the exact discipline
// `tests/app/authorization.test.ts` test 6 and `tests/rls/membership-
// boundaries.test.ts` already establish for this codebase. Deliberately
// a separate file from `tests/rls/invitations-schema.test.ts` (which
// stays P2B.1's own scope, exercising `asFixtureSetup` only): this file
// is the first to exercise `invitations` as a real `authenticated`
// actor at all.
//
// No domain function (createInvitation/listInvitations/revokeInvitation)
// exists yet — per P2B.2's own explicit scope ("invitation creation
// service beyond what is strictly required to test authorization" is
// excluded) — so every test here issues direct SQL as a real
// authenticated user, proving the database's own RLS policies are
// correct on their own, independent of any future application-layer
// service built on top of them.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asFixtureSetup,
  asUser,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  getOrCreateRole,
  grantEngagementMembership,
  grantOrganisationMembership,
  pool,
} from "./helpers";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe("invitations — authorization & RLS (P2B.2)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string, engagementA2: string, engagementAOtherOrg: string, engagementB: string;

  let roleClientAdministrator: string;
  let rolePrivacyOfficer: string;
  let roleCXO: string;
  let roleBusinessOwner: string;
  let roleITCISO: string;
  let roleProcurement: string;
  let roleLegal: string;
  let roleConsultant: string; // engagement-scope role on NEITHER invitation allowlist

  let orgAdminA: string; // Client Administrator (membership.manage), orgA
  let orgAdminA2: string; // Client Administrator, orgA2 (sibling org, same tenant)
  let orgAdminB: string; // Client Administrator, orgB (tenant B)
  let engManagerA: string; // Engagement Manager (membership.manage), engagementA only
  let engManagerA2: string; // Engagement Manager, engagementA2 (sibling engagement, SAME org)
  let consultantA: string; // EngagementMembership on engagementA, no membership.manage
  let privacyOfficerA: string; // OrganisationMembership on orgA, no membership.manage
  let outsiderA: string; // no membership anywhere, tenantA

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "P2B.2 Tenant A");
      tenantB = await createTenant(client, "P2B.2 Tenant B");
      orgA = await createOrganisation(client, tenantA, "P2B.2 Org A");
      orgA2 = await createOrganisation(client, tenantA, "P2B.2 Org A2");
      orgB = await createOrganisation(client, tenantB, "P2B.2 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "P2B.2 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA, "P2B.2 Engagement A2 (sibling, same org)");
      engagementAOtherOrg = await createEngagement(client, tenantA, orgA2, "P2B.2 Engagement A (org A2)");
      engagementB = await createEngagement(client, tenantB, orgB, "P2B.2 Engagement B");

      roleClientAdministrator = await getOrCreateRole(client, "Client Administrator");
      rolePrivacyOfficer = await getOrCreateRole(client, "Privacy Officer");
      roleCXO = await getOrCreateRole(client, "CXO / Executive Viewer");
      roleBusinessOwner = await getOrCreateRole(client, "Business Owner");
      roleITCISO = await getOrCreateRole(client, "IT/CISO");
      roleProcurement = await getOrCreateRole(client, "Procurement");
      roleLegal = await getOrCreateRole(client, "Legal");
      roleConsultant = await getOrCreateRole(client, "Consultant");

      orgAdminA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, orgAdminA, orgA, "Client Administrator");

      orgAdminA2 = await createUser(client, { tenantId: tenantA, clientOrgId: orgA2 });
      await grantOrganisationMembership(client, orgAdminA2, orgA2, "Client Administrator");

      orgAdminB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantOrganisationMembership(client, orgAdminB, orgB, "Client Administrator");

      engManagerA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, engManagerA, engagementA, "Engagement Manager");

      engManagerA2 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, engManagerA2, engagementA2, "Engagement Manager");

      consultantA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantEngagementMembership(client, consultantA, engagementA, "Consultant");

      privacyOfficerA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, privacyOfficerA, orgA, "Privacy Officer");

      outsiderA = await createUser(client, { tenantId: tenantA });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  interface Overrides {
    id?: string;
    tenantId?: string;
    organisationId?: string;
    engagementId?: string | null;
    invitedEmail?: string;
    roleId?: string;
    tokenHash?: string;
    expiresAt?: Date;
    invitedBy?: string;
    status?: string;
    acceptedUserId?: string | null;
    acceptedAt?: Date | null;
    revokedAt?: Date | null;
  }

  function row(actorId: string, overrides: Overrides = {}) {
    return {
      id: overrides.id ?? randomUUID(),
      tenantId: overrides.tenantId ?? tenantA,
      organisationId: overrides.organisationId ?? orgA,
      engagementId: overrides.engagementId === undefined ? null : overrides.engagementId,
      invitedEmail: overrides.invitedEmail ?? `${randomUUID()}@example.test`,
      roleId: overrides.roleId ?? roleClientAdministrator,
      tokenHash: overrides.tokenHash ?? randomUUID().replace(/-/g, ""),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + SEVEN_DAYS_MS),
      invitedBy: overrides.invitedBy ?? actorId,
      status: overrides.status ?? "pending",
      acceptedUserId: overrides.acceptedUserId === undefined ? null : overrides.acceptedUserId,
      acceptedAt: overrides.acceptedAt === undefined ? null : overrides.acceptedAt,
      revokedAt: overrides.revokedAt === undefined ? null : overrides.revokedAt,
    };
  }

  /** Direct INSERT as a real authenticated actor — the exact write a
   * future createInvitation() would issue, run here without one. */
  function insertAsUser(actorId: string, overrides: Overrides = {}) {
    const r = row(actorId, overrides);
    return asUser(actorId, (c) =>
      c.query(
        `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by, status, accepted_user_id, accepted_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [r.id, r.tenantId, r.organisationId, r.engagementId, r.invitedEmail, r.roleId, r.tokenHash, r.expiresAt, r.invitedBy, r.status, r.acceptedUserId, r.acceptedAt, r.revokedAt],
      ),
    );
  }

  /** A pending invitation, inserted via the fixture superuser
   * connection (bypasses RLS entirely) — the row under test for
   * SELECT/UPDATE authorization checks below. */
  function insertFixtureRow(overrides: Overrides = {}) {
    const r = row(overrides.invitedBy ?? "00000000-0000-0000-0000-000000000000", overrides);
    return asFixtureSetup((c) =>
      c.query(
        `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by, status, accepted_user_id, accepted_at, revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [r.id, r.tenantId, r.organisationId, r.engagementId, r.invitedEmail, r.roleId, r.tokenHash, r.expiresAt, r.invitedBy, r.status, r.acceptedUserId, r.acceptedAt, r.revokedAt],
      ),
    );
  }

  // === A. Organisation invitations =======================================

  it("A1. an organisation admin (org-level membership.manage) can create an organisation-scoped invitation for their own organisation", async () => {
    const result = await insertAsUser(orgAdminA, { engagementId: null, roleId: roleClientAdministrator });
    expect(result.rows[0]).toMatchObject({ organisation_id: orgA, engagement_id: null, status: "pending" });
  });

  it("A2. an organisation admin cannot create an organisation-scoped invitation for a SIBLING organisation under the same tenant", async () => {
    await expect(
      insertAsUser(orgAdminA, { organisationId: orgA2, engagementId: null, roleId: roleClientAdministrator }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("A3. an Engagement Manager (engagement-level membership.manage only, no org-level grant) cannot create an organisation-scoped invitation for that organisation", async () => {
    // Deliberately proves canManageOrganisationInvitations' own "no
    // engagement-level fallback" rule at the RLS layer: staffing on one
    // engagement of an organisation must not grant authority to invite
    // an organisation-wide administrator for the whole client.
    await expect(
      insertAsUser(engManagerA, { organisationId: orgA, engagementId: null, roleId: roleClientAdministrator }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("A4. an organisation admin cannot SELECT another organisation's invitation, even under the same tenant", async () => {
    const { rows } = await insertFixtureRow({ organisationId: orgA2, engagementId: null, invitedBy: orgAdminA2 });
    const id = rows[0].id;
    const seen = await asUser(orgAdminA, (c) => c.query("SELECT id FROM invitations WHERE id = $1", [id]));
    expect(seen.rows).toHaveLength(0);
  });

  it("A5. an organisation admin CAN SELECT their own organisation's invitation", async () => {
    const { rows } = await insertFixtureRow({ organisationId: orgA, engagementId: null, invitedBy: orgAdminA });
    const id = rows[0].id;
    const seen = await asUser(orgAdminA, (c) => c.query("SELECT id FROM invitations WHERE id = $1", [id]));
    expect(seen.rows).toHaveLength(1);
  });

  // === B. Engagement invitations ==========================================

  it("B1. an Engagement Manager can create an engagement-scoped invitation for their own engagement", async () => {
    const result = await insertAsUser(engManagerA, { engagementId: engagementA, roleId: roleBusinessOwner, invitedEmail: `b1-${randomUUID()}@example.test` });
    expect(result.rows[0]).toMatchObject({ organisation_id: orgA, engagement_id: engagementA, status: "pending" });
  });

  it("B2. an Engagement Manager cannot create an engagement-scoped invitation for a SIBLING engagement of the same organisation", async () => {
    await expect(
      insertAsUser(engManagerA, { engagementId: engagementA2, roleId: roleBusinessOwner, invitedEmail: `b2-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("B3. an organisation admin (org-level membership.manage) CAN create an engagement-scoped invitation under their organisation — the existing engagement-membership fallback rule, reused", async () => {
    const result = await insertAsUser(orgAdminA, { engagementId: engagementA, roleId: roleBusinessOwner, invitedEmail: `b3-${randomUUID()}@example.test` });
    expect(result.rows[0]).toMatchObject({ engagement_id: engagementA });
  });

  it("B4. an ordinary engagement member with no membership.manage grant cannot create an engagement-scoped invitation", async () => {
    await expect(
      insertAsUser(consultantA, { engagementId: engagementA, roleId: roleBusinessOwner, invitedEmail: `b4-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("B4b. an organisation member with no membership.manage grant (Privacy Officer) cannot manipulate an engagement invitation through the parent organisation", async () => {
    await expect(
      insertAsUser(privacyOfficerA, { engagementId: engagementA, roleId: roleBusinessOwner, invitedEmail: `b4b-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("B5. an Engagement Manager cannot SELECT a sibling engagement's invitation", async () => {
    const { rows } = await insertFixtureRow({ engagementId: engagementA2, invitedBy: engManagerA2, roleId: roleBusinessOwner });
    const id = rows[0].id;
    const seen = await asUser(engManagerA, (c) => c.query("SELECT id FROM invitations WHERE id = $1", [id]));
    expect(seen.rows).toHaveLength(0);
  });

  it("B6. an Engagement Manager CAN SELECT their own engagement's invitation", async () => {
    const { rows } = await insertFixtureRow({ engagementId: engagementA, invitedBy: engManagerA, roleId: roleBusinessOwner });
    const id = rows[0].id;
    const seen = await asUser(engManagerA, (c) => c.query("SELECT id FROM invitations WHERE id = $1", [id]));
    expect(seen.rows).toHaveLength(1);
  });

  // === C. Role allowlist ==================================================

  it("C1. an organisation-scoped invitation cannot use an engagement-scope role (Business Owner)", async () => {
    await expect(
      insertAsUser(orgAdminA, { engagementId: null, roleId: roleBusinessOwner, invitedEmail: `c1-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("C2. an organisation-scoped invitation cannot use an arbitrary non-allowlisted role (Consultant)", async () => {
    await expect(
      insertAsUser(orgAdminA, { engagementId: null, roleId: roleConsultant, invitedEmail: `c2-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("C3. an engagement-scoped invitation cannot use an organisation-scope role (Client Administrator)", async () => {
    await expect(
      insertAsUser(engManagerA, { engagementId: engagementA, roleId: roleClientAdministrator, invitedEmail: `c3-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("C4. an engagement-scoped invitation cannot use an arbitrary non-allowlisted role (Consultant)", async () => {
    await expect(
      insertAsUser(engManagerA, { engagementId: engagementA, roleId: roleConsultant, invitedEmail: `c4-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("C5. every approved organisation-scope role succeeds", async () => {
    for (const roleId of [roleClientAdministrator, rolePrivacyOfficer, roleCXO]) {
      await expect(
        insertAsUser(orgAdminA, { engagementId: null, roleId, invitedEmail: `c5-${randomUUID()}@example.test` }),
      ).resolves.toBeTruthy();
    }
  });

  it("C6. every approved engagement-scope role succeeds", async () => {
    for (const roleId of [roleBusinessOwner, roleITCISO, roleProcurement, roleLegal]) {
      await expect(
        insertAsUser(engManagerA, { engagementId: engagementA, roleId, invitedEmail: `c6-${randomUUID()}@example.test` }),
      ).resolves.toBeTruthy();
    }
  });

  // === D. Scope integrity =================================================

  it("D1. an organisation admin cannot smuggle a DIFFERENT organisation's engagement into an invitation by mislabeling organisation_id — closed structurally by the composite FK, not merely RLS", async () => {
    await expect(
      insertAsUser(orgAdminA, { organisationId: orgA, engagementId: engagementAOtherOrg, roleId: roleBusinessOwner, invitedEmail: `d1-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/invitations_engagement_organisation_tenant_fk|foreign key/i);
  });

  // === E. Protected fields (defense-in-depth: even a now-RLS-authorized actor cannot forge them) ===

  it("E1. an authorized actor cannot change tenant_id via UPDATE", async () => {
    const { rows } = await insertFixtureRow({ engagementId: null, invitedBy: orgAdminA, invitedEmail: `e1-${randomUUID()}@example.test` });
    const id = rows[0].id;
    await expect(
      asUser(orgAdminA, (c) => c.query("UPDATE invitations SET tenant_id = $1 WHERE id = $2", [tenantB, id])),
    ).rejects.toThrow(/immutable after creation/i);
  });

  it("E2. an authorized actor cannot change invited_email via UPDATE", async () => {
    const { rows } = await insertFixtureRow({ engagementId: null, invitedBy: orgAdminA, invitedEmail: `e2-${randomUUID()}@example.test` });
    const id = rows[0].id;
    await expect(
      asUser(orgAdminA, (c) => c.query("UPDATE invitations SET invited_email = 'forged@example.test' WHERE id = $1", [id])),
    ).rejects.toThrow(/immutable after creation/i);
  });

  it("E3. an authorized actor cannot escalate role_id via UPDATE", async () => {
    const { rows } = await insertFixtureRow({ engagementId: null, invitedBy: orgAdminA, roleId: rolePrivacyOfficer, invitedEmail: `e3-${randomUUID()}@example.test` });
    const id = rows[0].id;
    await expect(
      asUser(orgAdminA, (c) => c.query("UPDATE invitations SET role_id = $1 WHERE id = $2", [roleClientAdministrator, id])),
    ).rejects.toThrow(/immutable after creation/i);
  });

  it("E4. an authorized actor cannot change token_hash via UPDATE", async () => {
    const { rows } = await insertFixtureRow({ engagementId: null, invitedBy: orgAdminA, invitedEmail: `e4-${randomUUID()}@example.test` });
    const id = rows[0].id;
    await expect(
      asUser(orgAdminA, (c) => c.query("UPDATE invitations SET token_hash = $1 WHERE id = $2", [randomUUID().replace(/-/g, ""), id])),
    ).rejects.toThrow(/immutable after creation/i);
  });

  it("E5. an authorized actor cannot forge invited_by via UPDATE", async () => {
    const { rows } = await insertFixtureRow({ engagementId: null, invitedBy: orgAdminA, invitedEmail: `e5-${randomUUID()}@example.test` });
    const id = rows[0].id;
    await expect(
      asUser(orgAdminA, (c) => c.query("UPDATE invitations SET invited_by = $1 WHERE id = $2", [engManagerA, id])),
    ).rejects.toThrow(/immutable after creation/i);
  });

  it("E6. an actor cannot forge invited_by at INSERT time — attributing a new invitation to someone else", async () => {
    await expect(
      insertAsUser(orgAdminA, { engagementId: null, invitedBy: engManagerA, invitedEmail: `e6-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("E7. an actor cannot fabricate an already-accepted invitation at INSERT time", async () => {
    await expect(
      insertAsUser(orgAdminA, {
        engagementId: null,
        invitedEmail: `e7-${randomUUID()}@example.test`,
        status: "accepted",
        acceptedUserId: consultantA,
        acceptedAt: new Date(),
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("E8. an actor cannot fabricate an already-revoked invitation at INSERT time", async () => {
    await expect(
      insertAsUser(orgAdminA, {
        engagementId: null,
        invitedEmail: `e8-${randomUUID()}@example.test`,
        status: "revoked",
        revokedAt: new Date(),
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  // === F. Status/lifecycle semantics — no acceptance introduced ==========

  it("F1. an authorized actor's plain UPDATE cannot move a pending invitation to accepted — that transition is reserved for the future SECURITY DEFINER acceptance function, not any membership.manage holder", async () => {
    const { rows } = await insertFixtureRow({ engagementId: null, invitedBy: orgAdminA, invitedEmail: `f1-${randomUUID()}@example.test` });
    const id = rows[0].id;
    await expect(
      asUser(orgAdminA, (c) =>
        c.query("UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_user_id = $1 WHERE id = $2", [consultantA, id]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("F2. an organisation admin CAN revoke a pending organisation-scoped invitation they manage", async () => {
    const { rows } = await insertFixtureRow({ engagementId: null, invitedBy: orgAdminA, invitedEmail: `f2-${randomUUID()}@example.test` });
    const id = rows[0].id;
    const result = await asUser(orgAdminA, (c) =>
      c.query("UPDATE invitations SET status = 'revoked', revoked_at = now() WHERE id = $1 RETURNING *", [id]),
    );
    expect(result.rows[0]).toMatchObject({ status: "revoked" });
  });

  it("F3. an Engagement Manager CAN revoke a pending engagement-scoped invitation they manage", async () => {
    const { rows } = await insertFixtureRow({ engagementId: engagementA, invitedBy: engManagerA, roleId: roleBusinessOwner, invitedEmail: `f3-${randomUUID()}@example.test` });
    const id = rows[0].id;
    const result = await asUser(engManagerA, (c) =>
      c.query("UPDATE invitations SET status = 'revoked', revoked_at = now() WHERE id = $1 RETURNING *", [id]),
    );
    expect(result.rows[0]).toMatchObject({ status: "revoked" });
  });

  it("F4. an Engagement Manager's plain UPDATE cannot move an engagement-scoped invitation to accepted either", async () => {
    const { rows } = await insertFixtureRow({ engagementId: engagementA, invitedBy: engManagerA, roleId: roleBusinessOwner, invitedEmail: `f4-${randomUUID()}@example.test` });
    const id = rows[0].id;
    await expect(
      asUser(engManagerA, (c) =>
        c.query("UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_user_id = $1 WHERE id = $2", [consultantA, id]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  // === G. Audit still excludes token_hash for real authenticated-role writes ===

  it("G1. an invitation created and revoked by a real authenticated actor is still audited without ever exposing token_hash", async () => {
    const hash = randomUUID().replace(/-/g, "");
    const { rows } = await insertFixtureRow({ engagementId: null, invitedBy: orgAdminA, tokenHash: hash, invitedEmail: `g1-${randomUUID()}@example.test` });
    const id = rows[0].id;

    // The revoke UPDATE and the audit-row check both run inside the
    // SAME asUser transaction — asUser always rolls back at the end of
    // its own callback (tests/rls/helpers.ts), so a later, separate
    // asUser/asFixtureSetup call would never see this UPDATE's own
    // effects (including the audit trigger's own INSERT it fires).
    const { rows: auditRows } = await asUser(orgAdminA, async (c) => {
      await c.query("UPDATE invitations SET status = 'revoked', revoked_at = now() WHERE id = $1", [id]);
      return c.query(`SELECT action, field_changes FROM audit_log WHERE entity_type = 'invitations' AND entity_id = $1 ORDER BY occurred_at`, [id]);
    });
    expect(auditRows.map((r: { action: string }) => r.action)).toEqual(["insert", "update"]);
    for (const r of auditRows) {
      const serialized = JSON.stringify(r.field_changes);
      expect(serialized).not.toContain(hash);
      expect(r.field_changes).not.toHaveProperty("token_hash");
    }
  });

  // === H. Cross-tenant isolation ==========================================

  it("H1. an organisation admin in tenant A cannot SELECT a tenant B invitation", async () => {
    const { rows } = await insertFixtureRow({ tenantId: tenantB, organisationId: orgB, engagementId: null, invitedBy: orgAdminB });
    const id = rows[0].id;
    const seen = await asUser(orgAdminA, (c) => c.query("SELECT id FROM invitations WHERE id = $1", [id]));
    expect(seen.rows).toHaveLength(0);
  });

  it("H2. an organisation admin in tenant A cannot revoke a tenant B invitation — the row is invisible, not merely rejected", async () => {
    const { rows } = await insertFixtureRow({ tenantId: tenantB, organisationId: orgB, engagementId: null, invitedBy: orgAdminB });
    const id = rows[0].id;
    const result = await asUser(orgAdminA, (c) =>
      c.query("UPDATE invitations SET status = 'revoked', revoked_at = now() WHERE id = $1", [id]),
    );
    expect(result.rowCount).toBe(0);
  });

  it("H3. an organisation admin in tenant B cannot SELECT a tenant A invitation (symmetric)", async () => {
    const { rows } = await insertFixtureRow({ tenantId: tenantA, organisationId: orgA, engagementId: null, invitedBy: orgAdminA });
    const id = rows[0].id;
    const seen = await asUser(orgAdminB, (c) => c.query("SELECT id FROM invitations WHERE id = $1", [id]));
    expect(seen.rows).toHaveLength(0);
  });

  it("H4. a user with no membership.manage grant anywhere cannot create any invitation", async () => {
    await expect(
      insertAsUser(outsiderA, { engagementId: null, invitedEmail: `h4-${randomUUID()}@example.test` }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("H5. a user with no membership.manage grant cannot SELECT an invitation, even one addressed within their own tenant", async () => {
    const { rows } = await insertFixtureRow({ organisationId: orgA, engagementId: null, invitedBy: orgAdminA });
    const id = rows[0].id;
    const seen = await asUser(outsiderA, (c) => c.query("SELECT id FROM invitations WHERE id = $1", [id]));
    expect(seen.rows).toHaveLength(0);
  });

  it("H6. an unauthenticated (anon) request cannot SELECT or INSERT any invitation at all — no GRANT exists for anon", async () => {
    await expect(asAnon((c) => c.query("SELECT id FROM invitations LIMIT 1"))).rejects.toThrow(/permission denied/i);
    const r = row("00000000-0000-0000-0000-000000000000");
    await expect(
      asAnon((c) =>
        c.query(
          `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [r.id, r.tenantId, r.organisationId, r.engagementId, r.invitedEmail, r.roleId, r.tokenHash, r.expiresAt, orgAdminA],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
