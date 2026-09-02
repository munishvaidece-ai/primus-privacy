// Slice C7.2 — Engagement Membership Management. Tests the real
// functions the real Engagement detail page/Server Actions call
// (lib/domain/engagement-memberships.ts, and the new
// lib/authorization/service.ts permission functions) against real
// PostgreSQL — no mocked authorization. This is the fix for the C7
// review's own second P0 finding: before this slice, no function
// anywhere in the codebase could add a second user to an Engagement or
// Organisation without a database script.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  addEngagementMember,
  revokeEngagementMember,
  listEngagementMembers,
  listEligibleUsersForEngagement,
  InvalidEngagementRoleError,
  IneligibleUserError,
  DuplicateMembershipError,
} from "@/lib/domain/engagement-memberships";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { NotFoundOrForbiddenError, canManageEngagementMembership } from "@/lib/authorization/service";
import {
  asUser,
  asAnon,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantEngagementMembership,
  grantOrganisationMembership,
  pool,
} from "./helpers";

async function roleIdByName(name: string): Promise<string> {
  const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM roles WHERE name = $1", [name]));
  return rows[0]!.id;
}

describe("Application layer — Engagement Membership Management (Slice C7.2)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string; // tenantA/orgA
  let engagementA3: string; // tenantA/orgA — second engagement, same org
  let engagementB: string; // tenantB/orgB

  let userManagerA: string; // Engagement Manager on engagementA
  let userConsultantA: string; // plain Consultant on engagementA — no membership.manage
  let userOutsiderA: string; // tenantA, no membership anywhere
  let userClientAdminA: string; // OrganisationMembership on orgA as Client Administrator, no engagement_memberships row at all
  let userManagerB: string; // Engagement Manager on engagementB (tenantB)

  let targetConsultantA: string; // tenantA, client_org_id NULL — eligible for any tenantA engagement
  let targetClientUserA: string; // tenantA, client_org_id = orgA — eligible for orgA's engagements
  let targetClientUserA2: string; // tenantA, client_org_id = orgA2 — NOT eligible for orgA's engagements
  let targetUserB: string; // tenantB — NOT eligible for any tenantA engagement
  let targetSuspendedUserA: string; // tenantA, status = 'suspended'

  let engagementRoleId: string; // "Consultant" — a valid engagement-scope role
  let organisationScopeRoleId: string; // "Client Administrator" — invalid at engagement scope
  let tenantScopeRoleId: string; // "Platform Administrator" — invalid at engagement scope

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice C7.2 Tenant A");
      tenantB = await createTenant(client, "Slice C7.2 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice C7.2 Org A");
      orgA2 = await createOrganisation(client, tenantA, "Slice C7.2 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice C7.2 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "Slice C7.2 Engagement A");
      engagementA3 = await createEngagement(client, tenantA, orgA, "Slice C7.2 Engagement A3 (same org)");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice C7.2 Engagement B");

      userManagerA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userManagerA, engagementA, "Engagement Manager");
      userConsultantA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userConsultantA, engagementA, "Consultant");
      userOutsiderA = await createUser(client, { tenantId: tenantA });
      userClientAdminA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, userClientAdminA, orgA, "Client Administrator");
      userManagerB = await createUser(client, { tenantId: tenantB });
      await grantEngagementMembership(client, userManagerB, engagementB, "Engagement Manager");

      targetConsultantA = await createUser(client, { tenantId: tenantA });
      targetClientUserA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      targetClientUserA2 = await createUser(client, { tenantId: tenantA, clientOrgId: orgA2 });
      targetUserB = await createUser(client, { tenantId: tenantB });
      targetSuspendedUserA = await createUser(client, { tenantId: tenantA });
      await client.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [targetSuspendedUserA]);
    });

    engagementRoleId = await roleIdByName("Consultant");
    organisationScopeRoleId = await roleIdByName("Client Administrator");
    tenantScopeRoleId = await roleIdByName("Platform Administrator");
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Authorization (instructions §23 "Authorization" 1-4) ----------------

  it("1. Authorized manager (Engagement Manager, via EngagementMembership) adds a member", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: targetConsultantA, roleId: engagementRoleId }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT user_id, engagement_id, role_id, status FROM engagement_memberships WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ user_id: targetConsultantA, engagement_id: engagementA, role_id: engagementRoleId, status: "active" });
  });

  it("Authorized manager (Client Administrator, via OrganisationMembership) also succeeds — the organisation-scope membership.manage path", async () => {
    const { id } = await withRequestDb(userClientAdminA, (db) =>
      addEngagementMember(db, userClientAdminA, { organisationId: orgA, engagementId: engagementA3, targetUserId: targetClientUserA, roleId: engagementRoleId }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM engagement_memberships WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ status: "active" });
  });

  it("2. Unauthorized engagement member (plain Consultant, no membership.manage) cannot add a member", async () => {
    await expect(
      withRequestDb(userConsultantA, (db) =>
        addEngagementMember(db, userConsultantA, { organisationId: orgA, engagementId: engagementA, targetUserId: targetClientUserA, roleId: engagementRoleId }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("3. Unauthorized user (no membership at all) cannot add a member", async () => {
    await expect(
      withRequestDb(userOutsiderA, (db) =>
        addEngagementMember(db, userOutsiderA, { organisationId: orgA, engagementId: engagementA, targetUserId: targetClientUserA, roleId: engagementRoleId }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4. Anonymous user cannot add a member", async () => {
    await expect(asAnon((c) => c.query("SELECT * FROM engagement_memberships LIMIT 1"))).rejects.toThrow();
    await expect(
      asAnon((c) => c.query(`INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1, $2, $3)`, [targetClientUserA, engagementA, engagementRoleId])),
    ).rejects.toThrow();
  });

  // --- Tenant isolation (instructions §23 "Tenant isolation" 5-7) ----------

  it("5. Tenant A manager cannot add a Tenant B user", async () => {
    await expect(
      withRequestDb(userManagerA, (db) =>
        addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: targetUserB, roleId: engagementRoleId }),
      ),
    ).rejects.toThrow(IneligibleUserError);
  });

  it("6. Tenant A manager cannot manipulate Tenant B's EngagementMembership (revoke)", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM engagement_memberships WHERE engagement_id = $1 AND user_id = $2", [engagementB, userManagerB]));
    await expect(
      withRequestDb(userManagerA, (db) =>
        revokeEngagementMember(db, userManagerA, { organisationId: orgB, engagementId: engagementB, membershipId: rows[0]!.id }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("7. Forged tenant/org/engagement IDs fail: a direct, malicious raw INSERT with a Tenant-B-scoped target user into Tenant A's engagement is rejected by RLS", async () => {
    await expect(
      asUser(userManagerA, (c) =>
        c.query(`INSERT INTO engagement_memberships (user_id, engagement_id, role_id, created_by) VALUES ($1, $2, $3, $4)`, [targetUserB, engagementA, engagementRoleId, userManagerA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  // --- Organisation / eligibility (instructions §23 "Organisation / eligibility" 8-9) ---

  it("8. An invalid/nonexistent target user is rejected", async () => {
    await expect(
      withRequestDb(userManagerA, (db) =>
        addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: "00000000-0000-0000-0000-000000000000", roleId: engagementRoleId }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("9. A user outside the allowed organisation/tenant scope is rejected: a client-side user from Org A2 cannot join Org A's engagement", async () => {
    await expect(
      withRequestDb(userManagerA, (db) =>
        addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: targetClientUserA2, roleId: engagementRoleId }),
      ),
    ).rejects.toThrow(IneligibleUserError);
  });

  it("A suspended user's account is rejected", async () => {
    await expect(
      withRequestDb(userManagerA, (db) =>
        addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: targetSuspendedUserA, roleId: engagementRoleId }),
      ),
    ).rejects.toThrow(IneligibleUserError);
  });

  it("A tenant-wide (PRIMUS-side, client_org_id NULL) consultant IS eligible across organisations under the same tenant — the existing, intended cross-org consultant-staffing architecture is preserved", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM engagement_memberships WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ status: "active" });
  });

  it("listEligibleUsersForEngagement excludes users who are already active members and users outside the eligible scope", async () => {
    const eligible = await withRequestDb(userManagerA, (db) => listEligibleUsersForEngagement(db, userManagerA, { organisationId: orgA, engagementId: engagementA }));
    const ids = eligible.map((u) => u.id);
    expect(ids).not.toContain(userManagerA); // already an active member
    expect(ids).not.toContain(targetUserB); // wrong tenant
    expect(ids).not.toContain(targetClientUserA2); // wrong client organisation
    expect(ids).not.toContain(targetSuspendedUserA); // suspended
  });

  // --- Roles (instructions §23 "Roles" 10-11) -------------------------------

  it("10. A valid engagement-scope role succeeds", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    expect(id).toBeTruthy();
  });

  it("11. An organisation-scope role (Client Administrator) is rejected when assigning an EngagementMembership", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    await expect(
      withRequestDb(userManagerA, (db) =>
        addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: organisationScopeRoleId }),
      ),
    ).rejects.toThrow(InvalidEngagementRoleError);
  });

  it("11b. A tenant-scope role (Platform Administrator) is rejected when assigning an EngagementMembership", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    await expect(
      withRequestDb(userManagerA, (db) =>
        addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: tenantScopeRoleId }),
      ),
    ).rejects.toThrow(InvalidEngagementRoleError);
  });

  // --- Duplicate (instructions §23 "Duplicate" 12) --------------------------

  it("12. A duplicate active membership is rejected with a clean error, matching the existing partial-unique-index constraint", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    await expect(
      withRequestDb(userManagerA, (db) =>
        addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
      ),
    ).rejects.toThrow(DuplicateMembershipError);
  });

  it("A revoked-then-re-added membership succeeds as a new row, never blocked by the earlier revoked row", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id: firstId } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    await withRequestDb(userManagerA, (db) => revokeEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, membershipId: firstId }));

    const { id: secondId } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    expect(secondId).not.toBe(firstId);

    const { rows } = await asFixtureSetup((c) => c.query("SELECT id, status FROM engagement_memberships WHERE user_id = $1 AND engagement_id = $2 ORDER BY created_at", [target, engagementA]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: firstId, status: "revoked" });
    expect(rows[1]).toMatchObject({ id: secondId, status: "active" });
  });

  // --- Revoke (instructions §23 "Revoke" 13-15) -----------------------------

  it("13. Authorized manager can revoke an eligible member", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    await withRequestDb(userManagerA, (db) => revokeEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, membershipId: id }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM engagement_memberships WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ status: "revoked" });
  });

  it("Revoke is idempotent: revoking an already-revoked membership is a silent no-op, not an error", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    await withRequestDb(userManagerA, (db) => revokeEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, membershipId: id }));
    await expect(
      withRequestDb(userManagerA, (db) => revokeEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, membershipId: id })),
    ).resolves.not.toThrow();
  });

  it("Self-protection: a manager may revoke themselves — no invariant forbids it anywhere in the product documents (DECISIONS.md R-114)", async () => {
    const soloEngagement = await asFixtureSetup((client) => createEngagement(client, tenantA, orgA, "Slice C7.2 Self-revoke Engagement"));
    const soloManager = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    await asFixtureSetup((client) => grantEngagementMembership(client, soloManager, soloEngagement, "Engagement Manager"));
    const membershipId = (
      await asFixtureSetup((c) => c.query("SELECT id FROM engagement_memberships WHERE engagement_id = $1 AND user_id = $2", [soloEngagement, soloManager]))
    ).rows[0]!.id;

    await withRequestDb(soloManager, (db) =>
      revokeEngagementMember(db, soloManager, { organisationId: orgA, engagementId: soloEngagement, membershipId }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM engagement_memberships WHERE id = $1", [membershipId]));
    expect(rows[0]).toMatchObject({ status: "revoked" });

    // The now-self-revoked manager genuinely loses access — matches
    // "preserve the simplest existing model," not a special-cased
    // protection.
    await expect(withRequestDb(soloManager, (db) => getEngagementDetail(db, soloManager, soloEngagement))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("14. Unauthorized user cannot revoke a member", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    await expect(
      withRequestDb(userConsultantA, (db) => revokeEngagementMember(db, userConsultantA, { organisationId: orgA, engagementId: engagementA, membershipId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("15. Cross-tenant revoke is rejected", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM engagement_memberships WHERE engagement_id = $1 AND user_id = $2", [engagementB, userManagerB]));
    await expect(
      withRequestDb(userManagerA, (db) => revokeEngagementMember(db, userManagerA, { organisationId: orgB, engagementId: engagementB, membershipId: rows[0]!.id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("Reparenting guard: a direct SQL attempt to change a membership row's user_id/engagement_id/role_id via UPDATE is rejected even for an authorized manager", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    await expect(
      asUser(userManagerA, (c) => c.query(`UPDATE engagement_memberships SET role_id = $1 WHERE id = $2`, [tenantScopeRoleId, id])),
    ).rejects.toThrow(/immutable/i);
  });

  // --- Access (instructions §23 "Access" 16-17) -----------------------------

  it("16. A newly-added user can actually access the Engagement — membership genuinely reaches the existing authorization/RLS layer", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    await expect(withRequestDb(target, (db) => getEngagementDetail(db, target, engagementA))).rejects.toThrow(NotFoundOrForbiddenError);

    await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );

    const detail = await withRequestDb(target, (db) => getEngagementDetail(db, target, engagementA));
    expect(detail.id).toBe(engagementA);
  });

  it("17. A revoked user loses Engagement access", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    await withRequestDb(target, (db) => getEngagementDetail(db, target, engagementA)); // sanity: has access before revoke

    await withRequestDb(userManagerA, (db) => revokeEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, membershipId: id }));

    await expect(withRequestDb(target, (db) => getEngagementDetail(db, target, engagementA))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // --- Audit (instructions §23 "Audit" 18-19) -------------------------------

  it("18. Add-member audit is attributed to the acting manager", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT action, actor_user_id FROM audit_log WHERE entity_type = 'engagement_memberships' AND entity_id = $1 ORDER BY occurred_at`, [id]),
    );
    expect(rows[0]).toMatchObject({ action: "insert", actor_user_id: userManagerA });
  });

  it("19. Revoke-member audit is attributed to the acting manager", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    await withRequestDb(userManagerA, (db) => revokeEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, membershipId: id }));

    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT action, actor_user_id FROM audit_log WHERE entity_type = 'engagement_memberships' AND entity_id = $1 ORDER BY occurred_at`, [id]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ action: "update", actor_user_id: userManagerA });
  });

  // --- Read functions / listing ---------------------------------------------

  it("listEngagementMembers shows the full roster, including revoked history, to any engagement member (not only a manager)", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id } = await withRequestDb(userManagerA, (db) =>
      addEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, targetUserId: target, roleId: engagementRoleId }),
    );
    await withRequestDb(userManagerA, (db) => revokeEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, membershipId: id }));

    const rows = await withRequestDb(userConsultantA, (db) => listEngagementMembers(db, userConsultantA, { organisationId: orgA, engagementId: engagementA }));
    const row = rows.find((r) => r.id === id);
    expect(row).toMatchObject({ status: "revoked" });
  });

  it("canManageEngagementMembership is false for a plain Consultant and true for the Engagement Manager", async () => {
    const managerCan = await withRequestDb(userManagerA, (db) => canManageEngagementMembership(db, userManagerA, engagementA, orgA));
    const consultantCan = await withRequestDb(userConsultantA, (db) => canManageEngagementMembership(db, userConsultantA, engagementA, orgA));
    expect(managerCan).toBe(true);
    expect(consultantCan).toBe(false);
  });
});
