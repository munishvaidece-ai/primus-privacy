// P2B.3 — Invitation Creation & Secure Token Lifecycle. Tests the real
// functions the real invitation-creation path uses
// (lib/domain/invitations.ts, lib/domain/invitation-delivery.ts) against
// real PostgreSQL — no mocked authorization, no mocked hashing. Mirrors
// tests/app/engagement-membership.test.ts's own structure for a new
// domain module. tests/rls/invitations-authorization.test.ts (P2B.2)
// already exhaustively covers the RLS layer via direct SQL; category I
// below adds a small, representative confirmation that the backstop
// remains intact now that a real domain layer sits in front of it —
// not a full re-run of that suite.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  generateInvitationToken,
  hashInvitationToken,
  InvalidInvitationRoleError,
  DuplicatePendingInvitationError,
  InvitationNotPendingError,
} from "@/lib/domain/invitations";
import { getDevInvitationDeliveryAdapter } from "@/lib/domain/invitation-delivery";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import {
  asUser,
  asAnon,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  getOrCreateRole,
  grantOrganisationMembership,
  grantEngagementMembership,
  pool,
} from "./helpers";

async function invitationRow(id: string) {
  const { rows } = await asFixtureSetup((c) => c.query("SELECT * FROM invitations WHERE id = $1", [id]));
  return rows[0];
}

describe("Application layer — Invitation Creation & Secure Token Lifecycle (P2B.3)", () => {
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
  let roleConsultant: string; // valid role, wrong (neither) scope for invitations

  let orgAdminA: string; // Client Administrator (membership.manage), orgA
  let orgAdminA2: string; // Client Administrator, orgA2 (sibling org, same tenant)
  let orgAdminB: string; // Client Administrator, orgB (tenant B)
  let engManagerA: string; // Engagement Manager (membership.manage), engagementA only
  let consultantA: string; // EngagementMembership on engagementA, no membership.manage
  let privacyOfficerA: string; // OrganisationMembership on orgA, no membership.manage

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "P2B.3 Tenant A");
      tenantB = await createTenant(client, "P2B.3 Tenant B");
      orgA = await createOrganisation(client, tenantA, "P2B.3 Org A");
      orgA2 = await createOrganisation(client, tenantA, "P2B.3 Org A2");
      orgB = await createOrganisation(client, tenantB, "P2B.3 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "P2B.3 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA, "P2B.3 Engagement A2 (sibling, same org)");
      engagementAOtherOrg = await createEngagement(client, tenantA, orgA2, "P2B.3 Engagement (org A2)");
      engagementB = await createEngagement(client, tenantB, orgB, "P2B.3 Engagement B");

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

      consultantA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantEngagementMembership(client, consultantA, engagementA, "Consultant");

      privacyOfficerA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, privacyOfficerA, orgA, "Privacy Officer");
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

  // === A. Basic creation ===================================================

  it("A1. an authorized organisation administrator can create an organisation-scoped invitation", async () => {
    const invitedEmail = email("a1");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    const row = await invitationRow(id);
    expect(row).toMatchObject({
      organisation_id: orgA,
      engagement_id: null,
      invited_email: invitedEmail,
      status: "pending",
      invited_by: orgAdminA,
      accepted_user_id: null,
      accepted_at: null,
      revoked_at: null,
    });
    const msSinceCreate = new Date(row.expires_at).getTime() - new Date(row.created_at).getTime();
    expect(msSinceCreate).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(msSinceCreate).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
  });

  it("A2. an authorized engagement administrator can create an engagement-scoped invitation", async () => {
    const invitedEmail = email("a2");
    const { id } = await withRequestDb(engManagerA, (db) =>
      createInvitation(db, engManagerA, { organisationId: orgA, engagementId: engagementA, invitedEmail, roleId: roleBusinessOwner }),
    );
    const row = await invitationRow(id);
    expect(row).toMatchObject({
      organisation_id: orgA,
      engagement_id: engagementA,
      invited_email: invitedEmail,
      status: "pending",
      invited_by: engManagerA,
      accepted_user_id: null,
      accepted_at: null,
      revoked_at: null,
    });
  });

  // === B. Token security ===================================================

  it("B1. the token is cryptographically generated with real entropy — two calls never collide, and it is not a UUID/timestamp/predictable value", () => {
    const t1 = generateInvitationToken();
    const t2 = generateInvitationToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(40); // 32 bytes, base64url — ~43 chars
    // base64url alphabet only — never contains characters that would need
    // escaping in a URL path.
    expect(t1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("B2. the raw token is not equal to its own hash, the hash is what gets persisted, and the raw token is not present anywhere in the persisted row", async () => {
    const invitedEmail = email("b2");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    const row = await invitationRow(id);
    const [delivery] = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = delivery!.invitationUrl.split("/invite/")[1]!;

    expect(rawToken).not.toBe(row.token_hash);
    expect(row.token_hash).toBe(hashInvitationToken(rawToken));
    // Confirm the raw token does not appear as the value of ANY column
    // on the persisted row — not merely that token_hash specifically
    // differs from it.
    for (const value of Object.values(row)) {
      if (typeof value === "string") expect(value).not.toBe(rawToken);
    }
  });

  it("B3. the raw token and its hash are both absent from the audit log entry for this invitation", async () => {
    const invitedEmail = email("b3");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    const row = await invitationRow(id);
    const [delivery] = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = delivery!.invitationUrl.split("/invite/")[1]!;

    const { rows: auditRows } = await asFixtureSetup((c) =>
      c.query(`SELECT field_changes FROM audit_log WHERE entity_type = 'invitations' AND entity_id = $1`, [id]),
    );
    expect(auditRows).toHaveLength(1);
    const serialized = JSON.stringify(auditRows[0].field_changes);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain(row.token_hash);
    expect(auditRows[0].field_changes).not.toHaveProperty("token_hash");
  });

  it("B4. the application never logs the raw token — a createInvitation call produces no console output containing it", async () => {
    const seen: unknown[] = [];
    const methods = ["log", "info", "warn", "error", "debug"] as const satisfies readonly (keyof Console)[];
    type ConsoleMethod = (typeof methods)[number];
    const originals: Record<ConsoleMethod, Console[ConsoleMethod]> = {} as Record<ConsoleMethod, Console[ConsoleMethod]>;
    for (const m of methods) {
      originals[m] = console[m];
      console[m] = ((...args: unknown[]) => {
        seen.push(args);
      }) as Console[ConsoleMethod];
    }
    try {
      const invitedEmail = email("b4");
      await withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
      );
    } finally {
      for (const m of methods) console[m] = originals[m];
    }
    const [delivery] = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = delivery!.invitationUrl.split("/invite/")[1]!;
    const serialized = JSON.stringify(seen);
    expect(serialized).not.toContain(rawToken);
  });

  // === C. Token verification preparation (no acceptance implemented) =====

  it("C1. the persisted token_hash can be deterministically reproduced by hashing the raw token again", async () => {
    const invitedEmail = email("c1");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    const row = await invitationRow(id);
    const [delivery] = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = delivery!.invitationUrl.split("/invite/")[1]!;

    expect(hashInvitationToken(rawToken)).toBe(row.token_hash);
    expect(hashInvitationToken(rawToken)).toBe(row.token_hash); // deterministic — repeat hash matches again
  });

  it("C2. an altered token produces a different hash than the one persisted", async () => {
    const invitedEmail = email("c2");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    const row = await invitationRow(id);
    const [delivery] = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = delivery!.invitationUrl.split("/invite/")[1]!;
    const alteredToken = rawToken.slice(0, -1) + (rawToken.at(-1) === "A" ? "B" : "A");

    expect(hashInvitationToken(alteredToken)).not.toBe(row.token_hash);
  });

  // === D. Email normalization ==============================================

  it("D1. whitespace is trimmed from invited_email", async () => {
    const raw = `  ${email("d1")}  `;
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: raw, roleId: roleClientAdministrator }),
    );
    const row = await invitationRow(id);
    expect(row.invited_email).toBe(raw.trim());
  });

  it("D2. uppercase input is normalized to lowercase", async () => {
    const local = `d2-${Math.random().toString(36).slice(2)}`;
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: `${local.toUpperCase()}@EXAMPLE.TEST`, roleId: roleClientAdministrator }),
    );
    const row = await invitationRow(id);
    expect(row.invited_email).toBe(`${local}@example.test`);
  });

  it("D3. a duplicate pending invitation is recognized after normalization (different casing, same target)", async () => {
    const local = `d3-${Math.random().toString(36).slice(2)}`;
    await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: `${local}@example.test`, roleId: roleClientAdministrator }),
    );
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: `${local.toUpperCase()}@Example.Test`, roleId: roleClientAdministrator }),
      ),
    ).rejects.toThrow(DuplicatePendingInvitationError);
  });

  // === E. Role allowlist ====================================================

  it("E1. every approved organisation-scope role succeeds", async () => {
    for (const roleId of [roleClientAdministrator, rolePrivacyOfficer, roleCXO]) {
      await expect(
        withRequestDb(orgAdminA, (db) =>
          createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: email("e1"), roleId }),
        ),
      ).resolves.toBeTruthy();
    }
  });

  it("E2. every approved engagement-scope role succeeds", async () => {
    for (const roleId of [roleBusinessOwner, roleITCISO, roleProcurement, roleLegal]) {
      await expect(
        withRequestDb(engManagerA, (db) =>
          createInvitation(db, engManagerA, { organisationId: orgA, engagementId: engagementA, invitedEmail: email("e2"), roleId }),
        ),
      ).resolves.toBeTruthy();
    }
  });

  it("E3. an engagement-scope role is rejected for an organisation-scoped invitation", async () => {
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: email("e3"), roleId: roleBusinessOwner }),
      ),
    ).rejects.toThrow(InvalidInvitationRoleError);
  });

  it("E4. an organisation-scope role is rejected for an engagement-scoped invitation", async () => {
    await expect(
      withRequestDb(engManagerA, (db) =>
        createInvitation(db, engManagerA, { organisationId: orgA, engagementId: engagementA, invitedEmail: email("e4"), roleId: roleClientAdministrator }),
      ),
    ).rejects.toThrow(InvalidInvitationRoleError);
  });

  it("E5. an arbitrary, non-allowlisted role is rejected for either scope", async () => {
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: email("e5a"), roleId: roleConsultant }),
      ),
    ).rejects.toThrow(InvalidInvitationRoleError);
    await expect(
      withRequestDb(engManagerA, (db) =>
        createInvitation(db, engManagerA, { organisationId: orgA, engagementId: engagementA, invitedEmail: email("e5b"), roleId: roleConsultant }),
      ),
    ).rejects.toThrow(InvalidInvitationRoleError);
  });

  it("E6. a nonexistent role id is rejected", async () => {
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: email("e6"), roleId: "00000000-0000-0000-0000-000000000000" }),
      ),
    ).rejects.toThrow(InvalidInvitationRoleError);
  });

  // === F. Scope =============================================================

  it("F1. a mismatched organisation/engagement pair fails — the engagement does not belong to the claimed organisation", async () => {
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: engagementAOtherOrg, invitedEmail: email("f1"), roleId: roleBusinessOwner }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("F2. a cross-tenant engagement reference fails", async () => {
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: engagementB, invitedEmail: email("f2"), roleId: roleBusinessOwner }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("F3. a cross-tenant organisation reference fails — no tenantId input exists to spoof; the actor simply has no authority over a different tenant's organisation", async () => {
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgB, engagementId: null, invitedEmail: email("f3"), roleId: roleClientAdministrator }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // === G. Authorization ======================================================

  it("G1. an unauthorized same-organisation member (no membership.manage) cannot create an organisation-scoped invitation", async () => {
    await expect(
      withRequestDb(privacyOfficerA, (db) =>
        createInvitation(db, privacyOfficerA, { organisationId: orgA, engagementId: null, invitedEmail: email("g1"), roleId: roleClientAdministrator }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("G2. an unauthorized same-engagement member (no membership.manage) cannot create an engagement-scoped invitation", async () => {
    await expect(
      withRequestDb(consultantA, (db) =>
        createInvitation(db, consultantA, { organisationId: orgA, engagementId: engagementA, invitedEmail: email("g2"), roleId: roleBusinessOwner }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("G3. an admin of an unrelated organisation (same tenant) cannot create an invitation for a different organisation", async () => {
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA2, engagementId: null, invitedEmail: email("g3"), roleId: roleClientAdministrator }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("G4. a manager of an unrelated engagement (same organisation) cannot create an invitation for a different engagement", async () => {
    await expect(
      withRequestDb(engManagerA, (db) =>
        createInvitation(db, engManagerA, { organisationId: orgA, engagementId: engagementA2, invitedEmail: email("g4"), roleId: roleBusinessOwner }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("G5. a cross-tenant actor cannot create an invitation at all", async () => {
    await expect(
      withRequestDb(orgAdminB, (db) =>
        createInvitation(db, orgAdminB, { organisationId: orgA, engagementId: null, invitedEmail: email("g5"), roleId: roleClientAdministrator }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // === H. Duplicates ==========================================================

  it("H1. a second pending invitation for the same normalized email/scope is rejected", async () => {
    const invitedEmail = email("h1");
    await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: rolePrivacyOfficer }),
      ),
    ).rejects.toThrow(DuplicatePendingInvitationError);
  });

  it("H2. the underlying database unique constraint remains the real, race-safe backstop, independent of the application's own precheck", async () => {
    // Proves the constraint itself is still in force at the database
    // level (not merely that the application-level precheck catches the
    // common case) — a direct, raw insert bypassing createInvitation's
    // own precheck entirely still fails with the same constraint.
    const invitedEmail = email("h2");
    await asFixtureSetup((c) =>
      c.query(
        `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
         VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, now() + interval '7 days', $6)`,
        [tenantA, orgA, invitedEmail, roleClientAdministrator, `${Math.random()}`.repeat(2), orgAdminA],
      ),
    );
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, now() + interval '7 days', $6)`,
          [tenantA, orgA, invitedEmail, roleClientAdministrator, `${Math.random()}`.repeat(2), orgAdminA],
        ),
      ),
    ).rejects.toThrow(/invitations_pending_organisation_scoped_key/);
  });

  // === I. RLS backstop (representative — full coverage in tests/rls/invitations-authorization.test.ts) ===

  it("I1. a direct SQL insert forging invited_by is still rejected by RLS, even though the domain layer now exists", async () => {
    await expect(
      asUser(orgAdminA, (c) =>
        c.query(
          `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, now() + interval '7 days', $6)`,
          [tenantA, orgA, email("i1"), roleClientAdministrator, "x".repeat(43), engManagerA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("I2. a direct SQL insert with a wrong initial status is still rejected by RLS", async () => {
    await expect(
      asUser(orgAdminA, (c) =>
        c.query(
          `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by, status, accepted_at, accepted_user_id)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, now() + interval '7 days', $6, 'accepted', now(), $6)`,
          [tenantA, orgA, email("i2"), roleClientAdministrator, "x".repeat(43), orgAdminA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("I3. a direct SQL insert using a disallowed role is still rejected by RLS", async () => {
    await expect(
      asUser(orgAdminA, (c) =>
        c.query(
          `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, now() + interval '7 days', $6)`,
          [tenantA, orgA, email("i3"), roleBusinessOwner, "x".repeat(43), orgAdminA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("I4. a direct SQL insert claiming a different tenant's row is still rejected", async () => {
    await expect(
      asUser(orgAdminB, (c) =>
        c.query(
          `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, now() + interval '7 days', $6)`,
          [tenantA, orgA, email("i4"), roleClientAdministrator, "x".repeat(43), orgAdminB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("I5. an unauthenticated request cannot insert an invitation at all", async () => {
    await expect(
      asAnon((c) =>
        c.query(
          `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, now() + interval '7 days', $6)`,
          [tenantA, orgA, email("i5"), roleClientAdministrator, "x".repeat(43), orgAdminA],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  // === J. Audit ==============================================================

  it("J1. invitation creation produces exactly one audit_log entry, containing ordinary metadata but never token_hash or the raw token", async () => {
    const invitedEmail = email("j1");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    const { rows: auditRows } = await asFixtureSetup((c) =>
      c.query(`SELECT action, field_changes FROM audit_log WHERE entity_type = 'invitations' AND entity_id = $1`, [id]),
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("insert");
    expect(auditRows[0].field_changes).toMatchObject({
      id,
      organisation_id: orgA,
      engagement_id: null,
      invited_email: invitedEmail,
      status: "pending",
    });
    expect(auditRows[0].field_changes).not.toHaveProperty("token_hash");
  });

  // === K. No acceptance ======================================================

  it("K1. creating and revoking an invitation never creates a user, never creates any membership, and never marks the invitation accepted", async () => {
    const before = await asFixtureSetup((c) =>
      Promise.all([
        c.query("SELECT count(*)::int AS n FROM users"),
        c.query("SELECT count(*)::int AS n FROM organisation_memberships"),
        c.query("SELECT count(*)::int AS n FROM engagement_memberships"),
      ]),
    );

    const invitedEmail = email("k1");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    await withRequestDb(orgAdminA, (db) => revokeInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitationId: id }));

    const after = await asFixtureSetup((c) =>
      Promise.all([
        c.query("SELECT count(*)::int AS n FROM users"),
        c.query("SELECT count(*)::int AS n FROM organisation_memberships"),
        c.query("SELECT count(*)::int AS n FROM engagement_memberships"),
      ]),
    );

    expect(after[0].rows[0].n).toBe(before[0].rows[0].n);
    expect(after[1].rows[0].n).toBe(before[1].rows[0].n);
    expect(after[2].rows[0].n).toBe(before[2].rows[0].n);

    const row = await invitationRow(id);
    expect(row.status).toBe("revoked");
    expect(row.accepted_user_id).toBeNull();
    expect(row.accepted_at).toBeNull();
  });

  // === listInvitations / revokeInvitation — the minimal operational pair ===

  it("L1. listInvitations returns the scoped roster without ever selecting token_hash, and requires membership.manage", async () => {
    const invitedEmail = email("l1");
    await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );

    const rows = await withRequestDb(orgAdminA, (db) => listInvitations(db, orgAdminA, { organisationId: orgA, engagementId: null }));
    expect(rows.some((r) => r.invitedEmail === invitedEmail)).toBe(true);
    for (const r of rows) expect(r).not.toHaveProperty("tokenHash");

    await expect(
      withRequestDb(privacyOfficerA, (db) => listInvitations(db, privacyOfficerA, { organisationId: orgA, engagementId: null })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("R1. revokeInvitation moves a pending invitation to revoked, is idempotent, and rejects revoking an already-accepted invitation", async () => {
    const invitedEmail = email("r1");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );

    await withRequestDb(orgAdminA, (db) => revokeInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitationId: id }));
    expect((await invitationRow(id)).status).toBe("revoked");

    // idempotent — revoking again is a silent no-op, not an error
    await expect(
      withRequestDb(orgAdminA, (db) => revokeInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitationId: id })),
    ).resolves.toBeUndefined();

    // an accepted invitation (simulated only via direct fixture SQL —
    // this slice implements no acceptance path of its own) cannot be
    // revoked
    const acceptedEmail = email("r1b");
    const { id: acceptedId } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: acceptedEmail, roleId: roleClientAdministrator }),
    );
    const acceptor = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA }));
    await asFixtureSetup((c) =>
      c.query("UPDATE invitations SET status = 'accepted', accepted_at = now(), accepted_user_id = $1 WHERE id = $2", [acceptor, acceptedId]),
    );
    await expect(
      withRequestDb(orgAdminA, (db) => revokeInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitationId: acceptedId })),
    ).rejects.toThrow(InvitationNotPendingError);
  });
});
