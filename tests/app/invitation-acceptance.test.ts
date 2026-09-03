// P2B.4 — Secure Invitation Acceptance & User Provisioning. Tests the
// real acceptance transaction (lib/domain/invitations.ts's
// `acceptInvitation`, wrapping migration 0038's `public.accept_
// invitation()` SECURITY DEFINER function) against real PostgreSQL — no
// mocked authorization, no mocked hashing, no simulated concurrency.
//
// Fixture invitations are built two ways:
//   - via the real `createInvitation` (P2B.3) for every scenario that
//     CAN arise through the normal, already-tested creation path — the
//     same "exercise the real function, not a shortcut" discipline
//     every other test file in this codebase already follows.
//   - via a raw, superuser fixture INSERT (mirroring tests/rls/
//     invitations-schema.test.ts's own `insertInvitation` helper) ONLY
//     for states `createInvitation` structurally cannot produce at all
//     (an already-expired `expires_at`, a role invalid for its own
//     scope) — never to fabricate anything the real create path could
//     have produced.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createInvitation,
  revokeInvitation,
  acceptInvitation,
  generateInvitationToken,
  hashInvitationToken,
  InvalidInvitationRoleError,
  InvitationInvalidError,
  InvitationExpiredError,
  InvitationRevokedError,
  InvitationAlreadyAcceptedError,
  InvitationEmailMismatchError,
  PracticeUserCannotAcceptInvitationError,
  InvitationTenantMismatchError,
  InvitationClientOrganisationMismatchError,
  InvitationMembershipConflictError,
} from "@/lib/domain/invitations";
import { getDevInvitationDeliveryAdapter } from "@/lib/domain/invitation-delivery";
import {
  asAnon,
  asFixtureSetup,
  beginAsUser,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  getOrCreateRole,
  grantOrganisationMembership,
  grantEngagementMembership,
  pool,
} from "./helpers";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe("Application layer — Secure Invitation Acceptance (P2B.4)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string;

  let roleClientAdministrator: string;
  let rolePrivacyOfficer: string;
  let roleCXO: string;
  let roleBusinessOwner: string;
  let roleITCISO: string;
  let roleProcurement: string;
  let roleLegal: string;
  let roleConsultant: string; // valid role, invalid for either invitation scope

  let orgAdminA: string; // Client Administrator (membership.manage), orgA — invitation creator
  let engManagerA: string; // Engagement Manager (membership.manage), engagementA — invitation creator

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "P2B.4 Tenant A");
      tenantB = await createTenant(client, "P2B.4 Tenant B");
      orgA = await createOrganisation(client, tenantA, "P2B.4 Org A");
      orgA2 = await createOrganisation(client, tenantA, "P2B.4 Org A2");
      orgB = await createOrganisation(client, tenantB, "P2B.4 Org B");
      engagementA = await createEngagement(client, tenantA, orgA, "P2B.4 Engagement A");

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

      engManagerA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, engManagerA, engagementA, "Engagement Manager");
    });
  });

  afterEach(() => {
    getDevInvitationDeliveryAdapter().clear();
  });

  afterAll(async () => {
    await pool.end();
  });

  function email(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2)}@example.test`;
  }

  async function invitationRow(id: string) {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT * FROM invitations WHERE id = $1", [id]));
    return rows[0];
  }

  async function userRow(id: string) {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT * FROM users WHERE id = $1", [id]));
    return rows[0];
  }

  /** Creates a real invitation via the real `createInvitation` (P2B.3)
   * and returns its id plus the raw token captured by the Dev delivery
   * adapter — the same pattern tests/app/invitations.test.ts already
   * uses. */
  async function createOrgInvitation(invitedEmail: string, roleId = roleClientAdministrator) {
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId }),
    );
    const deliveries = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = deliveries[deliveries.length - 1]!.invitationUrl.split("/invite/")[1]!;
    return { id, rawToken };
  }

  async function createEngagementInvitation(invitedEmail: string, roleId = roleBusinessOwner) {
    const { id } = await withRequestDb(engManagerA, (db) =>
      createInvitation(db, engManagerA, { organisationId: orgA, engagementId: engagementA, invitedEmail, roleId }),
    );
    const deliveries = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = deliveries[deliveries.length - 1]!.invitationUrl.split("/invite/")[1]!;
    return { id, rawToken };
  }

  /** Raw superuser fixture insert — ONLY for states `createInvitation`
   * structurally cannot produce (an already-expired `expires_at`, a
   * role invalid for its own scope). Never used for anything the real
   * create path could have produced instead. */
  async function insertFixtureInvitation(overrides: {
    organisationId?: string;
    engagementId?: string | null;
    invitedEmail: string;
    roleId: string;
    expiresAt?: Date;
  }) {
    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const id = randomUUID();
    const row = {
      id,
      tenantId: tenantA,
      organisationId: overrides.organisationId ?? orgA,
      engagementId: overrides.engagementId === undefined ? null : overrides.engagementId,
      invitedEmail: overrides.invitedEmail,
      roleId: overrides.roleId,
      tokenHash,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + SEVEN_DAYS_MS),
      invitedBy: orgAdminA,
    };
    await asFixtureSetup((c) =>
      c.query(
        `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, row.tenantId, row.organisationId, row.engagementId, row.invitedEmail, row.roleId, row.tokenHash, row.expiresAt, row.invitedBy],
      ),
    );
    return { id, rawToken };
  }

  function accept(userId: string, rawToken: string) {
    return withRequestDb(userId, (db) => acceptInvitation(db, userId, rawToken));
  }

  // === A. Valid acceptance =================================================

  it("A1. an authenticated user with matching Auth email accepts an organisation invitation", async () => {
    const targetEmail = email("a1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await createOrgInvitation(targetEmail);

    const result = await accept(invitee, rawToken);
    expect(result).toMatchObject({ invitationId: id, organisationId: orgA, engagementId: null, tenantId: tenantA, roleId: roleClientAdministrator });

    const row = await invitationRow(id);
    expect(row).toMatchObject({ status: "accepted", accepted_user_id: invitee });
    expect(row.accepted_at).not.toBeNull();

    const { rows: memberships } = await asFixtureSetup((c) =>
      c.query("SELECT role_id, status FROM organisation_memberships WHERE user_id = $1 AND organisation_id = $2", [invitee, orgA]),
    );
    expect(memberships).toEqual([{ role_id: roleClientAdministrator, status: "active" }]);
  });

  it("A2. an authenticated user with matching Auth email accepts an engagement invitation, gaining ONLY an EngagementMembership (no OrganisationMembership)", async () => {
    const targetEmail = email("a2");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await createEngagementInvitation(targetEmail);

    const result = await accept(invitee, rawToken);
    expect(result).toMatchObject({ invitationId: id, organisationId: orgA, engagementId: engagementA, tenantId: tenantA, roleId: roleBusinessOwner });

    const { rows: engMemberships } = await asFixtureSetup((c) =>
      c.query("SELECT role_id, status FROM engagement_memberships WHERE user_id = $1 AND engagement_id = $2", [invitee, engagementA]),
    );
    expect(engMemberships).toEqual([{ role_id: roleBusinessOwner, status: "active" }]);

    const { rows: orgMemberships } = await asFixtureSetup((c) =>
      c.query("SELECT id FROM organisation_memberships WHERE user_id = $1 AND organisation_id = $2", [invitee, orgA]),
    );
    expect(orgMemberships).toHaveLength(0);
  });

  // === B. Email ==============================================================

  it("B1. an exact-match email succeeds", async () => {
    const targetEmail = email("b1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).resolves.toBeTruthy();
  });

  it("B2. a case-normalized email succeeds — the Auth email is mixed-case, the invitation was normalized to lowercase at creation", async () => {
    const local = `b2-${Math.random().toString(36).slice(2)}`;
    const mixedCaseAuthEmail = `${local.toUpperCase()}@Example.Test`;
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: mixedCaseAuthEmail }));
    const { rawToken } = await createOrgInvitation(`${local}@example.test`);
    await expect(accept(invitee, rawToken)).resolves.toBeTruthy();
  });

  it("B3. a whitespace-padded Auth email succeeds once trimmed", async () => {
    const local = `b3-${Math.random().toString(36).slice(2)}`;
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: `  ${local}@example.test  ` }));
    const { rawToken } = await createOrgInvitation(`${local}@example.test`);
    await expect(accept(invitee, rawToken)).resolves.toBeTruthy();
  });

  it("B4. a different email fails", async () => {
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: email("b4-invitee") }));
    const { rawToken } = await createOrgInvitation(email("b4-invited"));
    await expect(accept(invitee, rawToken)).rejects.toThrow(InvitationEmailMismatchError);
  });

  // === C. Authentication ===================================================

  it("C1. an unauthenticated (anon) request cannot call accept_invitation at all", async () => {
    const targetEmail = email("c1");
    await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(
      asAnon((c) => c.query("SELECT * FROM accept_invitation($1)", [hashInvitationToken(rawToken)])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("C2. mere possession of the token is insufficient — an authenticated user whose own email does not match still cannot accept", async () => {
    const otherUser = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: email("c2-other") }));
    const { rawToken } = await createOrgInvitation(email("c2-invited"));
    await expect(accept(otherUser, rawToken)).rejects.toThrow(InvitationEmailMismatchError);
  });

  // === D. Token ==============================================================

  it("D1. a valid token succeeds", async () => {
    const targetEmail = email("d1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).resolves.toBeTruthy();
  });

  it("D2. a modified token fails", async () => {
    const targetEmail = email("d2");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    const modified = rawToken.slice(0, -1) + (rawToken.at(-1) === "A" ? "B" : "A");
    await expect(accept(invitee, modified)).rejects.toThrow(InvitationInvalidError);
  });

  it("D3. a nonexistent token fails", async () => {
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: email("d3") }));
    await expect(accept(invitee, generateInvitationToken())).rejects.toThrow(InvitationInvalidError);
  });

  it("D4. the raw token is never persisted anywhere in the accepted row", async () => {
    const targetEmail = email("d4");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await createOrgInvitation(targetEmail);
    await accept(invitee, rawToken);
    const row = await invitationRow(id);
    for (const value of Object.values(row)) {
      if (typeof value === "string") expect(value).not.toBe(rawToken);
    }
  });

  it("D5. only token_hash is persisted, and it is unchanged by acceptance", async () => {
    const targetEmail = email("d5");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await createOrgInvitation(targetEmail);
    const before = await invitationRow(id);
    await accept(invitee, rawToken);
    const after = await invitationRow(id);
    expect(after.token_hash).toBe(before.token_hash);
    expect(after.token_hash).toBe(hashInvitationToken(rawToken));
  });

  it("D6. token_hash is not present in the acceptance audit entry", async () => {
    const targetEmail = email("d6");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await createOrgInvitation(targetEmail);
    await accept(invitee, rawToken);
    const { rows: auditRows } = await asFixtureSetup((c) =>
      c.query(`SELECT field_changes FROM audit_log WHERE entity_type = 'invitations' AND entity_id = $1 ORDER BY occurred_at`, [id]),
    );
    expect(auditRows).toHaveLength(2); // insert (creation), update (acceptance)
    const acceptRow = auditRows[1];
    expect(acceptRow.field_changes).not.toHaveProperty("token_hash");
    if (acceptRow.field_changes.old) expect(acceptRow.field_changes.old).not.toHaveProperty("token_hash");
    if (acceptRow.field_changes.new) expect(acceptRow.field_changes.new).not.toHaveProperty("token_hash");
    expect(JSON.stringify(acceptRow.field_changes)).not.toContain(rawToken);
  });

  // === E. Expiry (controlled timestamps, never sleep) =====================

  it("E1. an invitation within its 7-day TTL succeeds", async () => {
    const targetEmail = email("e1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).resolves.toBeTruthy();
  });

  it("E2. an expired (but still status='pending') invitation fails", async () => {
    const targetEmail = email("e2");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await insertFixtureInvitation({
      invitedEmail: targetEmail,
      roleId: roleClientAdministrator,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour in the past
    });
    await expect(accept(invitee, rawToken)).rejects.toThrow(InvitationExpiredError);
    expect((await invitationRow(id)).status).toBe("pending"); // never gains a persisted 'expired' status
  });

  // === F. Status ============================================================

  it("F1. pending succeeds (covered by A1/D1) — status transitions correctly", async () => {
    const targetEmail = email("f1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await createOrgInvitation(targetEmail);
    expect((await invitationRow(id)).status).toBe("pending");
    await accept(invitee, rawToken);
    expect((await invitationRow(id)).status).toBe("accepted");
  });

  it("F2. a revoked invitation fails", async () => {
    const targetEmail = email("f2");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await createOrgInvitation(targetEmail);
    await withRequestDb(orgAdminA, (db) => revokeInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitationId: id }));
    await expect(accept(invitee, rawToken)).rejects.toThrow(InvitationRevokedError);
  });

  it("F3. an already-accepted invitation fails on a second attempt by the SAME user", async () => {
    const targetEmail = email("f3");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await accept(invitee, rawToken);
    await expect(accept(invitee, rawToken)).rejects.toThrow(InvitationAlreadyAcceptedError);
  });

  it("F4. an already-accepted invitation fails when a SECOND (different) user attempts it", async () => {
    const targetEmail = email("f4");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const secondUser = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await accept(invitee, rawToken);
    await expect(accept(secondUser, rawToken)).rejects.toThrow(InvitationAlreadyAcceptedError);
  });

  // === G. Practice-side user ===============================================

  it("G1. a practice-side user (client_org_id IS NULL) cannot accept a client invitation", async () => {
    const targetEmail = email("g1");
    const practiceUser = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, email: targetEmail }));
    const { id, rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(practiceUser, rawToken)).rejects.toThrow(PracticeUserCannotAcceptInvitationError);
    expect((await invitationRow(id)).status).toBe("pending");
  });

  // === H. Client organisation integrity ====================================

  it("H1. an existing user with a matching client_org succeeds (covered by A1)", async () => {
    const targetEmail = email("h1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).resolves.toBeTruthy();
  });

  it("H2. an existing user with a DIFFERENT client_org fails", async () => {
    const targetEmail = email("h2");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA2, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).rejects.toThrow(InvitationClientOrganisationMismatchError);
  });

  it("H3. an existing user with a NULL client_org fails (practice-side, same as G1)", async () => {
    const targetEmail = email("h3");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).rejects.toThrow(PracticeUserCannotAcceptInvitationError);
  });

  it("H4. acceptance never reparents an existing user's client_org — a rejected mismatch leaves it untouched", async () => {
    const targetEmail = email("h4");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA2, email: targetEmail }));
    const before = await userRow(invitee);
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).rejects.toThrow(InvitationClientOrganisationMismatchError);
    const after = await userRow(invitee);
    expect(after.client_org_id).toBe(before.client_org_id);
    expect(after.client_org_id).toBe(orgA2);
  });

  // === I. Tenant integrity ==================================================

  it("I1. a matching tenant succeeds (covered by A1)", async () => {
    const targetEmail = email("i1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).resolves.toBeTruthy();
  });

  it("I2. a mismatched tenant fails, even if client_org_id happens to equal the invitation's own organisation_id", async () => {
    const targetEmail = email("i2");
    // Deliberately inconsistent fixture (tenantB user, but client_org_id
    // = orgA, which actually belongs to tenantA) — proves tenant_id is
    // checked independently and decisively, not merely inferred from
    // client_org_id matching.
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantB, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).rejects.toThrow(InvitationTenantMismatchError);
  });

  it("I3. acceptance never reparents an existing user's tenant — a rejected mismatch leaves it untouched", async () => {
    const targetEmail = email("i3");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantB, clientOrgId: orgA, email: targetEmail }));
    const before = await userRow(invitee);
    const { rawToken } = await createOrgInvitation(targetEmail);
    await expect(accept(invitee, rawToken)).rejects.toThrow(InvitationTenantMismatchError);
    const after = await userRow(invitee);
    expect(after.tenant_id).toBe(before.tenant_id);
    expect(after.tenant_id).toBe(tenantB);
  });

  // === J. Role ===============================================================

  it("J1. every approved organisation role can be accepted", async () => {
    for (const roleId of [roleClientAdministrator, rolePrivacyOfficer, roleCXO]) {
      const targetEmail = email("j1");
      const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
      const { rawToken } = await createOrgInvitation(targetEmail, roleId);
      const result = await accept(invitee, rawToken);
      expect(result.roleId).toBe(roleId);
    }
  });

  it("J2. every approved engagement role can be accepted", async () => {
    for (const roleId of [roleBusinessOwner, roleITCISO, roleProcurement, roleLegal]) {
      const targetEmail = email("j2");
      const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
      const { rawToken } = await createEngagementInvitation(targetEmail, roleId);
      const result = await accept(invitee, rawToken);
      expect(result.roleId).toBe(roleId);
    }
  });

  it("J3. an invalid/cross-scope role (only reachable via a row bypassing the creation-time allowlist) is rejected by the SAME defense-in-depth check inside accept_invitation()", async () => {
    const targetEmail = email("j3");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await insertFixtureInvitation({ invitedEmail: targetEmail, roleId: roleConsultant, engagementId: null });
    await expect(accept(invitee, rawToken)).rejects.toThrow(InvalidInvitationRoleError);
    expect((await invitationRow(id)).status).toBe("pending");
  });

  // === K. Membership =========================================================

  it("K1/K2. the required membership is created with the correct role (covered by A1/A2/J1/J2)", async () => {
    const targetEmail = email("k1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail, rolePrivacyOfficer);
    await accept(invitee, rawToken);
    const { rows } = await asFixtureSetup((c) => c.query("SELECT role_id FROM organisation_memberships WHERE user_id = $1 AND organisation_id = $2", [invitee, orgA]));
    expect(rows).toEqual([{ role_id: rolePrivacyOfficer }]);
  });

  it("K3. no duplicate membership is created when the user already holds the exact intended (active, same-role) membership", async () => {
    const targetEmail = email("k3");
    const invitee = await asFixtureSetup(async (c) => {
      const id = await createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail });
      await grantOrganisationMembership(c, id, orgA, "Client Administrator");
      return id;
    });
    const { id, rawToken } = await createOrgInvitation(targetEmail, roleClientAdministrator);

    await expect(accept(invitee, rawToken)).resolves.toBeTruthy();
    expect((await invitationRow(id)).status).toBe("accepted");

    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM organisation_memberships WHERE user_id = $1 AND organisation_id = $2 AND status = 'active'", [invitee, orgA]));
    expect(rows).toHaveLength(1); // still exactly one — no duplicate
  });

  it("K4/N1. an existing membership with a DIFFERENT role is never silently escalated — acceptance is rejected and rolls back entirely", async () => {
    const targetEmail = email("k4");
    const invitee = await asFixtureSetup(async (c) => {
      const id = await createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail });
      await grantOrganisationMembership(c, id, orgA, "Privacy Officer"); // different role than the invitation below
      return id;
    });
    const { id, rawToken } = await createOrgInvitation(targetEmail, roleClientAdministrator);

    await expect(accept(invitee, rawToken)).rejects.toThrow(InvitationMembershipConflictError);

    // Rollback proof: the invitation is untouched, and the existing
    // membership's role is exactly what it was before the attempt — no
    // partial write of either.
    expect((await invitationRow(id)).status).toBe("pending");
    const { rows } = await asFixtureSetup((c) => c.query("SELECT role_id FROM organisation_memberships WHERE user_id = $1 AND organisation_id = $2 AND status = 'active'", [invitee, orgA]));
    expect(rows).toEqual([{ role_id: rolePrivacyOfficer }]);
  });

  // === L. Scope ==============================================================

  it("L1. an organisation invitation creates the correct OrganisationMembership (covered by A1)", async () => {
    const targetEmail = email("l1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createOrgInvitation(targetEmail);
    await accept(invitee, rawToken);
    const { rows } = await asFixtureSetup((c) => c.query("SELECT organisation_id FROM organisation_memberships WHERE user_id = $1", [invitee]));
    expect(rows).toEqual([{ organisation_id: orgA }]);
  });

  it("L2. an engagement invitation creates the required EngagementMembership, with the organisation relationship carried by the user's own client_org_id, not a new OrganisationMembership row (covered by A2)", async () => {
    const targetEmail = email("l2");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { rawToken } = await createEngagementInvitation(targetEmail);
    await accept(invitee, rawToken);
    const { rows: eng } = await asFixtureSetup((c) => c.query("SELECT engagement_id FROM engagement_memberships WHERE user_id = $1", [invitee]));
    expect(eng).toEqual([{ engagement_id: engagementA }]);
    const { rows: org } = await asFixtureSetup((c) => c.query("SELECT id FROM organisation_memberships WHERE user_id = $1", [invitee]));
    expect(org).toHaveLength(0);
  });

  // === M. Concurrency (mandatory — real PostgreSQL, real concurrent connections) ===

  it("M1. two different authenticated identities racing to accept the SAME invitation — only one succeeds", async () => {
    const sharedEmail = email("m1");
    // Two distinct accounts sharing one email — the only way to
    // construct a genuine "two different UIDs, same token, same
    // authoritative email" race in this harness (a real Supabase
    // project enforces email uniqueness at the Auth layer; this test's
    // own point is the ROW-LOCKING mechanism inside accept_invitation()
    // itself, which is identity-agnostic).
    const uid1 = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: sharedEmail }));
    const uid2 = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: sharedEmail }));
    const { id, rawToken } = await createOrgInvitation(sharedEmail);
    const tokenHash = hashInvitationToken(rawToken);

    const client1 = await beginAsUser(uid1);
    const client2 = await beginAsUser(uid2);

    // Each attempt commits/rolls back ITSELF, chained directly onto its
    // own query promise — never waiting for the other side first. The
    // whole point under test is that the loser's `accept_invitation()`
    // call stays BLOCKED (server-side, on the winner's row lock) until
    // the winner's transaction actually ends; waiting for both raw
    // query promises to settle before issuing either COMMIT would
    // deadlock this test itself (the loser can never settle until the
    // winner commits, and the winner would never get committed while
    // still waiting on the loser) — this per-attempt chaining is what
    // avoids that.
    const attempt1 = client1
      .query("SELECT * FROM accept_invitation($1)", [tokenHash])
      .then(async (result) => {
        await client1.query("COMMIT");
        return result;
      })
      .catch(async (err) => {
        await client1.query("ROLLBACK").catch(() => {});
        throw err;
      })
      .finally(() => client1.release());

    const attempt2 = client2
      .query("SELECT * FROM accept_invitation($1)", [tokenHash])
      .then(async (result) => {
        await client2.query("COMMIT");
        return result;
      })
      .catch(async (err) => {
        await client2.query("ROLLBACK").catch(() => {});
        throw err;
      })
      .finally(() => client2.release());

    const [result1, result2] = await Promise.allSettled([attempt1, attempt2]);

    const outcomes = [result1, result2];
    const succeeded = outcomes.filter((r) => r.status === "fulfilled");
    const failed = outcomes.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(String((failed[0]!.reason as Error).message)).toMatch(/invitation_already_accepted/);

    const row = await invitationRow(id);
    expect(row.status).toBe("accepted");
    expect([uid1, uid2]).toContain(row.accepted_user_id);
    expect(row.accepted_at).not.toBeNull();

    const { rows: memberships } = await asFixtureSetup((c) =>
      c.query("SELECT user_id FROM organisation_memberships WHERE organisation_id = $1 AND user_id = ANY($2)", [orgA, [uid1, uid2]]),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.user_id).toBe(row.accepted_user_id);
  });

  // === O. Audit ==============================================================

  it("O1. acceptance produces exactly one additional audit_log entry (insert at creation, update at acceptance)", async () => {
    const targetEmail = email("o1");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const { id, rawToken } = await createOrgInvitation(targetEmail);
    await accept(invitee, rawToken);
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT action FROM audit_log WHERE entity_type = 'invitations' AND entity_id = $1 ORDER BY occurred_at`, [id]),
    );
    expect(rows.map((r: { action: string }) => r.action)).toEqual(["insert", "update"]);
  });

  // (raw-token/token_hash absence from the acceptance audit entry: D6 above)

  // === §21 RLS backstop — SECURITY DEFINER cannot be turned into a privilege escalation path ===

  it("21a. accept_invitation() accepts NO identity/scope/role parameter of any kind — the only argument is p_token_hash", async () => {
    // Proves structurally, not merely by convention, that there is no
    // user_id/tenant_id/organisation_id/engagement_id/role_id/
    // accepted_user_id parameter to forge: PostgreSQL itself rejects a
    // call with the wrong argument count/signature before the function
    // body ever runs.
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: email("21a") }));
    await expect(
      withRequestDb(invitee, (_db, client) =>
        client.query("SELECT * FROM accept_invitation($1, $2)", [hashInvitationToken(generateInvitationToken()), invitee]),
      ),
    ).rejects.toThrow(/function accept_invitation\(.*\) does not exist/i);
  });

  it("21b. acceptance is always attributed to the ACTUAL caller's own auth.uid() — never to any other identity, even when that other identity is the one named by the invitation's own metadata", async () => {
    const targetEmail = email("21b");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: targetEmail }));
    const outsider = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: email("21b-outsider") }));
    const { id, rawToken } = await createOrgInvitation(targetEmail);

    // The outsider's own email does not match — rejected — and, win or
    // lose, accepted_user_id can only ever become the CALLER's own uid,
    // never a caller-chosen value (there is no field to choose one).
    await expect(accept(outsider, rawToken)).rejects.toThrow(InvitationEmailMismatchError);
    expect((await invitationRow(id)).accepted_user_id).toBeNull();

    await accept(invitee, rawToken);
    expect((await invitationRow(id)).accepted_user_id).toBe(invitee);
  });
});
