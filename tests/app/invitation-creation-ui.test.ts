// P2B.5.1 — Invitation Creation UI. This slice adds no new domain
// authorization/validation/scope logic of its own — the invite forms and
// their two new Server Actions
// (app/(shell)/organisations/[organisationId]/actions.ts,
// .../engagements/[engagementId]/actions.ts) call the SAME
// `createInvitation` (lib/domain/invitations.ts, P2B.3) already
// exhaustively covered by tests/app/invitations.test.ts — authorization
// (categories F/G there), role allowlists (E), scope integrity (F),
// duplicate handling (H), and raw-token/audit/log safety (B/J) are not
// re-tested here to avoid duplicating that suite; per this repository's
// own established convention (confirmed by grep: no `*Action`
// Server-Action-with-redirect() function anywhere is unit-tested
// directly — only the domain functions it calls are), the two Server
// Actions themselves are not invoked here either.
//
// What IS new in this slice, and is what this file actually tests
// against real PostgreSQL:
//   - `listInvitationRoleOptions` (lib/domain/invitations.ts) — the
//     invite form's own role-dropdown source.
//   - `getDevInvitationUrl` (lib/domain/invitation-delivery.ts) — the
//     dev-only mechanism the Server Actions use to surface a just-
//     created invitation's URL, and its production guard.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { createInvitation, listInvitationRoleOptions } from "@/lib/domain/invitations";
import { getDevInvitationUrl, getDevInvitationDeliveryAdapter } from "@/lib/domain/invitation-delivery";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import {
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

describe("Application layer — Invitation Creation UI support functions (P2B.5.1)", () => {
  let tenantA: string;
  let orgA: string;
  let engagementA: string;

  let roleClientAdministrator: string;
  let rolePrivacyOfficer: string;
  let roleCXO: string;
  let roleBusinessOwner: string;
  let roleITCISO: string;
  let roleProcurement: string;
  let roleLegal: string;
  let roleConsultant: string; // engagement-scope taxonomy, but never client-invitable
  let roleEngagementManager: string; // ditto

  let orgAdminA: string; // Client Administrator (membership.manage), orgA
  let engManagerA: string; // Engagement Manager (membership.manage), engagementA
  let privacyOfficerA: string; // OrganisationMembership on orgA, no membership.manage

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "P2B.5.1 Tenant A");
      orgA = await createOrganisation(client, tenantA, "P2B.5.1 Org A");
      engagementA = await createEngagement(client, tenantA, orgA, "P2B.5.1 Engagement A");

      roleClientAdministrator = await getOrCreateRole(client, "Client Administrator");
      rolePrivacyOfficer = await getOrCreateRole(client, "Privacy Officer");
      roleCXO = await getOrCreateRole(client, "CXO / Executive Viewer");
      roleBusinessOwner = await getOrCreateRole(client, "Business Owner");
      roleITCISO = await getOrCreateRole(client, "IT/CISO");
      roleProcurement = await getOrCreateRole(client, "Procurement");
      roleLegal = await getOrCreateRole(client, "Legal");
      roleConsultant = await getOrCreateRole(client, "Consultant");
      roleEngagementManager = await getOrCreateRole(client, "Engagement Manager");

      orgAdminA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, orgAdminA, orgA, "Client Administrator");

      engManagerA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, engManagerA, engagementA, "Engagement Manager");

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

  // === A. listInvitationRoleOptions — role dropdown source =================

  it("A1. organisation scope returns exactly the three approved client roles, sorted by name, and excludes engagement-only/practice-only roles", async () => {
    const rows = await withRequestDb(orgAdminA, (db) => listInvitationRoleOptions(db, null));
    const names = rows.map((r) => r.name);
    expect(new Set(names)).toEqual(new Set(["Client Administrator", "Privacy Officer", "CXO / Executive Viewer"]));
    expect(names).toEqual([...names].sort());
    expect(names).not.toContain("Business Owner");
    expect(names).not.toContain("Consultant");
    expect(names).not.toContain("Engagement Manager");
  });

  it("A2. engagement scope returns exactly the four approved engagement roles, sorted by name, and excludes practice-side engagement roles (Engagement Manager/Consultant/Auditor) and organisation roles", async () => {
    const rows = await withRequestDb(engManagerA, (db) => listInvitationRoleOptions(db, engagementA));
    const names = rows.map((r) => r.name);
    expect(new Set(names)).toEqual(new Set(["Business Owner", "IT/CISO", "Procurement", "Legal"]));
    expect(names).toEqual([...names].sort());
    expect(names).not.toContain("Client Administrator");
    expect(names).not.toContain("Consultant");
    expect(names).not.toContain("Engagement Manager");
  });

  it("A3. listInvitationRoleOptions is global reference-data reading (like listEngagementRoles), so it does not itself throw for a user without membership.manage — the invite FORM's own visibility is what membership.manage gates, not this read", async () => {
    await expect(withRequestDb(privacyOfficerA, (db) => listInvitationRoleOptions(db, null))).resolves.toBeTruthy();
  });

  it("A4. ids returned are real, currently-valid role ids that createInvitation itself accepts for the same scope", async () => {
    const rows = await withRequestDb(orgAdminA, (db) => listInvitationRoleOptions(db, null));
    const clientAdminRow = rows.find((r) => r.name === "Client Administrator");
    expect(clientAdminRow?.id).toBe(roleClientAdministrator);
    const invitedEmail = email("a4");
    await expect(
      withRequestDb(orgAdminA, (db) =>
        createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: clientAdminRow!.id }),
      ),
    ).resolves.toBeTruthy();
  });

  // === B. getDevInvitationUrl — dev-only invitation link retrieval =========

  it("B1. after a successful creation, getDevInvitationUrl returns a URL whose embedded raw token hashes to the persisted token_hash", async () => {
    const invitedEmail = email("b1");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    const url = getDevInvitationUrl(id);
    expect(url).toBeTruthy();
    expect(url).toContain("/invite/");

    const { rows } = await asFixtureSetup((c) => c.query("SELECT token_hash FROM invitations WHERE id = $1", [id]));
    const rawToken = url!.split("/invite/")[1]!;
    const { hashInvitationToken } = await import("@/lib/domain/invitations");
    expect(hashInvitationToken(rawToken)).toBe(rows[0].token_hash);
  });

  it("B2. getDevInvitationUrl matches by the exact invitationId requested, not 'the most recent delivery' — a second, unrelated invitation created afterward does not change the first invitation's own URL", async () => {
    const { id: firstId } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: email("b2a"), roleId: roleClientAdministrator }),
    );
    const firstUrl = getDevInvitationUrl(firstId);

    const { id: secondId } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail: email("b2b"), roleId: rolePrivacyOfficer }),
    );
    const secondUrl = getDevInvitationUrl(secondId);

    expect(firstUrl).not.toBe(secondUrl);
    expect(getDevInvitationUrl(firstId)).toBe(firstUrl);
  });

  it("B3. getDevInvitationUrl returns null (not a throw) for an id with no captured delivery", () => {
    expect(getDevInvitationUrl("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("B4. getDevInvitationUrl never returns a URL once NODE_ENV is production — the production guard is enforced inside the function itself", async () => {
    const invitedEmail = email("b4");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    expect(getDevInvitationUrl(id)).toBeTruthy(); // sanity: available under the real test NODE_ENV

    const original = process.env.NODE_ENV;
    // `NODE_ENV` is declared `readonly` on the global `NodeJS.ProcessEnv`
    // by some `next` versions' own type shim (node_modules/next/types/
    // global.d.ts) and not by others — rather than a `@ts-expect-error`
    // whose necessity depends on exactly which one resolved, cast
    // `process.env` to a plain mutable-string-indexed type first; the
    // assignment is then unconditionally valid TypeScript regardless of
    // whether the ambient declaration happens to mark the property
    // read-only in a given install.
    const mutableEnv = process.env as Record<string, string | undefined>;
    mutableEnv.NODE_ENV = "production";
    try {
      expect(getDevInvitationUrl(id)).toBeNull();
    } finally {
      mutableEnv.NODE_ENV = original;
    }
  });

  // === C. End-to-end shape the Server Actions themselves rely on ===========

  it("C1. the full pipeline the invite Server Actions use — createInvitation then getDevInvitationUrl — succeeds for an authorized organisation inviter and produces a usable dev link", async () => {
    const invitedEmail = email("c1");
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    expect(getDevInvitationUrl(id)).toContain("/invite/");
  });

  it("C2. the same pipeline succeeds for an authorized engagement inviter, scoped to that engagement", async () => {
    const invitedEmail = email("c2");
    const { id } = await withRequestDb(engManagerA, (db) =>
      createInvitation(db, engManagerA, { organisationId: orgA, engagementId: engagementA, invitedEmail, roleId: roleBusinessOwner }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT engagement_id, organisation_id FROM invitations WHERE id = $1", [id]));
    expect(rows[0].engagement_id).toBe(engagementA);
    expect(rows[0].organisation_id).toBe(orgA);
    expect(getDevInvitationUrl(id)).toContain("/invite/");
  });

  it("C3. an unauthorized organisation member cannot create an invitation even when calling createInvitation directly (the same function the Server Action calls) — there is no weaker UI-only authorization path", async () => {
    await expect(
      withRequestDb(privacyOfficerA, (db) =>
        createInvitation(db, privacyOfficerA, { organisationId: orgA, engagementId: null, invitedEmail: email("c3"), roleId: roleClientAdministrator }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });
});
