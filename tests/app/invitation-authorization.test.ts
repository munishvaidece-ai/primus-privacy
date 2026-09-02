// P2B.2 — Invitation Authorization & RLS: the application-layer half of
// the security contract, tested directly against the real functions
// (never mocked) — the same "call the function, assert the boolean,
// then assert the require* pair throws" discipline
// `tests/app/authorization.test.ts` already establishes for
// `canAccessOrganisation`/`canAccessEngagement`. No domain function
// (createInvitation/etc.) exists yet, so these functions are exercised
// directly, standing on their own; `tests/rls/invitations-authorization.
// test.ts` independently proves the database-layer half agrees
// (SECURITY.md §2).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withRequestDb } from "@/lib/db/request-client";
import {
  canManageOrganisationInvitations,
  requireOrganisationInvitationManageAccess,
  canManageInvitation,
  requireInvitationManageAccess,
  isInvitationRoleAllowedForScope,
  canAssignInvitationRole,
  NotFoundOrForbiddenError,
} from "@/lib/authorization/service";
import {
  asFixtureSetup,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  getOrCreateRole,
  grantEngagementMembership,
  grantOrganisationMembership,
  pool,
} from "./helpers";

describe("Application-layer invitation authorization (P2B.2)", () => {
  let orgA: string, orgA2: string;
  let engagementA: string, engagementA2: string;

  let roleClientAdministrator: string;
  let roleBusinessOwner: string;
  let roleConsultant: string;

  let orgAdminA: string; // Client Administrator (membership.manage), orgA
  let engManagerA: string; // Engagement Manager (membership.manage), engagementA only

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      const tenantA = await createTenant(client, "P2B.2 App-Layer Tenant A");
      orgA = await createOrganisation(client, tenantA, "P2B.2 App-Layer Org A");
      orgA2 = await createOrganisation(client, tenantA, "P2B.2 App-Layer Org A2");

      engagementA = await createEngagement(client, tenantA, orgA, "P2B.2 App-Layer Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA, "P2B.2 App-Layer Engagement A2 (sibling)");

      roleClientAdministrator = await getOrCreateRole(client, "Client Administrator");
      roleBusinessOwner = await getOrCreateRole(client, "Business Owner");
      roleConsultant = await getOrCreateRole(client, "Consultant");

      orgAdminA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, orgAdminA, orgA, "Client Administrator");

      engManagerA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, engManagerA, engagementA, "Engagement Manager");
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- canManageOrganisationInvitations ----------------------------------

  it("1. an organisation admin can manage their own organisation's invitations", async () => {
    await withRequestDb(orgAdminA, async (db) => {
      expect(await canManageOrganisationInvitations(db, orgAdminA, orgA)).toBe(true);
    });
  });

  it("2. an organisation admin cannot manage a sibling organisation's invitations", async () => {
    await withRequestDb(orgAdminA, async (db) => {
      expect(await canManageOrganisationInvitations(db, orgAdminA, orgA2)).toBe(false);
    });
    await expect(
      withRequestDb(orgAdminA, (db) => requireOrganisationInvitationManageAccess(db, orgAdminA, orgA2)),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("3. an Engagement Manager (engagement-level membership.manage only) cannot manage organisation-scoped invitations — no engagement-level fallback", async () => {
    await withRequestDb(engManagerA, async (db) => {
      expect(await canManageOrganisationInvitations(db, engManagerA, orgA)).toBe(false);
    });
  });

  // --- canManageInvitation dispatcher -------------------------------------

  it("4. the dispatcher routes a null engagementId to the organisation-scoped rule", async () => {
    await withRequestDb(orgAdminA, async (db) => {
      expect(await canManageInvitation(db, orgAdminA, orgA, null)).toBe(true);
    });
  });

  it("5. the dispatcher routes a non-null engagementId to canManageEngagementMembership — an Engagement Manager can manage their own engagement's invitations", async () => {
    await withRequestDb(engManagerA, async (db) => {
      expect(await canManageInvitation(db, engManagerA, orgA, engagementA)).toBe(true);
    });
  });

  it("6. an Engagement Manager cannot manage a sibling engagement's invitations", async () => {
    await withRequestDb(engManagerA, async (db) => {
      expect(await canManageInvitation(db, engManagerA, orgA, engagementA2)).toBe(false);
    });
    await expect(
      withRequestDb(engManagerA, (db) => requireInvitationManageAccess(db, engManagerA, orgA, engagementA2)),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("7. an organisation admin's org-level membership.manage also covers engagement-scoped invitations under their organisation — the same fallback canManageEngagementMembership already grants", async () => {
    await withRequestDb(orgAdminA, async (db) => {
      expect(await canManageInvitation(db, orgAdminA, orgA, engagementA)).toBe(true);
    });
  });

  // --- role allowlist (pure function) ------------------------------------

  it("8. Client Administrator is allowed for organisation scope", () => {
    expect(isInvitationRoleAllowedForScope("Client Administrator", null)).toBe(true);
  });

  it("9. Business Owner is NOT allowed for organisation scope (an engagement-scope role)", () => {
    expect(isInvitationRoleAllowedForScope("Business Owner", null)).toBe(false);
  });

  it("10. Business Owner IS allowed for engagement scope", () => {
    expect(isInvitationRoleAllowedForScope("Business Owner", engagementA)).toBe(true);
  });

  it("11. Client Administrator is NOT allowed for engagement scope (an organisation-scope role)", () => {
    expect(isInvitationRoleAllowedForScope("Client Administrator", engagementA)).toBe(false);
  });

  it("12. an arbitrary, non-allowlisted role (Consultant) is rejected for either scope", () => {
    expect(isInvitationRoleAllowedForScope("Consultant", null)).toBe(false);
    expect(isInvitationRoleAllowedForScope("Consultant", engagementA)).toBe(false);
  });

  // --- canAssignInvitationRole (DB-aware) ---------------------------------

  it("13. canAssignInvitationRole resolves a role id to its name and checks it against the scope's allowlist", async () => {
    await withRequestDb(orgAdminA, async (db) => {
      expect(await canAssignInvitationRole(db, roleClientAdministrator, null)).toBe(true);
      expect(await canAssignInvitationRole(db, roleBusinessOwner, null)).toBe(false);
      expect(await canAssignInvitationRole(db, roleBusinessOwner, engagementA)).toBe(true);
      expect(await canAssignInvitationRole(db, roleConsultant, engagementA)).toBe(false);
    });
  });

  it("14. canAssignInvitationRole returns false (never throws) for an unknown role id", async () => {
    await withRequestDb(orgAdminA, async (db) => {
      expect(await canAssignInvitationRole(db, randomUUID(), null)).toBe(false);
    });
  });
});
