// Slice B2 — Organisation Membership + Engagement Creation. Tests the
// real functions the real pages/Server Actions call
// (lib/domain/organisations.ts, lib/domain/engagements.ts,
// lib/authorization/service.ts) against real PostgreSQL — no mocked
// permission functions. Covers the 14 required security scenarios
// (PHASE B2 instructions §18) plus the application-level onboarding
// behaviors §26 asks for.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { createOrganisation, getOrganisationDetail } from "@/lib/domain/organisations";
import {
  createEngagement,
  getEngagementDetail,
  listSelectableControlLibraryVersions,
  DuplicateEngagementError,
  InvalidMethodologyError,
} from "@/lib/domain/engagements";
import { NotFoundOrForbiddenError, canCreateEngagement } from "@/lib/authorization/service";
import {
  asAnon,
  asFixtureSetup,
  createControlLibraryVersion,
  createTenant,
  createUser,
  grantOrganisationMembership,
  grantTenantMembership,
  publishControlLibraryVersion,
  retireControlLibraryVersion,
  pool,
} from "./helpers";

describe("Application layer — Organisation Membership + Engagement Creation (Slice B2)", () => {
  let tenantA: string, tenantB: string;
  let userA: string; // tenant member of Tenant A — the primary onboarding consultant
  let userAOrgOnly: string; // OrganisationMembership on a DIFFERENT Tenant A org only
  let userAOutsider: string; // Tenant A, no membership anywhere
  let userB: string; // tenant member of Tenant B

  let orgA: string; // created (and auto-membership-granted) by userA
  let orgA2: string; // a second Tenant A org, whose membership userAOrgOnly holds
  let orgB: string; // created (and auto-membership-granted) by userB

  let libraryAPublished: string;
  let libraryADraft: string;
  let libraryARetired: string;
  let libraryBPublished: string; // Tenant B's own library — must never be selectable for a Tenant A engagement

  let engagementA: string; // created (and auto-membership-granted) by userA, under orgA
  let engagementB: string; // created (and auto-membership-granted) by userB, under orgB

  beforeAll(async () => {
    tenantA = await asFixtureSetup((c) => createTenant(c, "Slice B2 Tenant A"));
    tenantB = await asFixtureSetup((c) => createTenant(c, "Slice B2 Tenant B"));

    userA = await asFixtureSetup(async (c) => {
      const id = await createUser(c, { tenantId: tenantA });
      await grantTenantMembership(c, id, tenantA);
      return id;
    });
    userB = await asFixtureSetup(async (c) => {
      const id = await createUser(c, { tenantId: tenantB });
      await grantTenantMembership(c, id, tenantB);
      return id;
    });
    userAOutsider = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA }));

    // orgA / orgB are created through the real domain function, under
    // real RLS, exactly as the application does — this exercises the
    // auto-membership-grant this slice adds, not a shortcut fixture.
    orgA = (await withRequestDb(userA, (db) => createOrganisation(db, userA, { name: "Slice B2 Org A" }))).id;
    orgB = (await withRequestDb(userB, (db) => createOrganisation(db, userB, { name: "Slice B2 Org B" }))).id;

    orgA2 = await asFixtureSetup((c) =>
      // A second Tenant A organisation created directly as a fixture
      // (not through createOrganisation) specifically so userAOrgOnly's
      // ONLY access is a plain OrganisationMembership grant, isolated
      // from any tenant-level membership.
      c.query(`INSERT INTO organisations (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantA, "Slice B2 Org A2"]).then((r) => r.rows[0].id),
    );
    userAOrgOnly = await asFixtureSetup(async (c) => {
      const id = await createUser(c, { tenantId: tenantA });
      await grantOrganisationMembership(c, id, orgA2);
      return id;
    });

    libraryAPublished = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenantA, versionLabel: "B2 Library A Published" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, libraryAPublished));
    libraryADraft = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenantA, versionLabel: "B2 Library A Draft" }));
    libraryARetired = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenantA, versionLabel: "B2 Library A Retired" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, libraryARetired));
    await asFixtureSetup((c) => retireControlLibraryVersion(c, libraryARetired));
    libraryBPublished = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenantB, versionLabel: "B2 Library B Published" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, libraryBPublished));

    engagementA = (
      await withRequestDb(userA, (db) =>
        createEngagement(db, userA, {
          organisationId: orgA,
          name: "Slice B2 Engagement A",
          engagementType: "readiness",
          periodStart: null,
          periodEnd: null,
          controlLibraryVersionId: libraryAPublished,
        }),
      )
    ).id;
    engagementB = (
      await withRequestDb(userB, (db) =>
        createEngagement(db, userB, {
          organisationId: orgB,
          name: "Slice B2 Engagement B",
          engagementType: "readiness",
          periodStart: null,
          periodEnd: null,
          controlLibraryVersionId: null,
        }),
      )
    ).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Application-level behavior -----------------------------------

  it("Organisation membership: creating an organisation grants the creator an active OrganisationMembership with the onboarding role", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT om.status, r.name as role_name FROM organisation_memberships om
         JOIN roles r ON r.id = om.role_id
         WHERE om.organisation_id = $1 AND om.user_id = $2`,
        [orgA, userA],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", role_name: "Client Administrator" });
  });

  it("Organisation detail: the creator can immediately view the organisation they just created, listed as its own member", async () => {
    const detail = await withRequestDb(userA, (db) => getOrganisationDetail(db, userA, orgA));
    expect(detail).toMatchObject({ id: orgA, name: "Slice B2 Org A" });
    expect(detail.members.some((m) => m.userId === userA && m.roleName === "Client Administrator")).toBe(true);
  });

  it("Engagement creation success: engagement + creator EngagementMembership are both created, and the creator can read the engagement back", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createEngagement(db, userA, {
        organisationId: orgA,
        name: "Slice B2 New Engagement",
        engagementType: "annual_assessment",
        periodStart: "2026-04-01",
        periodEnd: "2027-03-31",
        controlLibraryVersionId: null,
      }),
    );

    const detail = await withRequestDb(userA, (db) => getEngagementDetail(db, userA, id));
    expect(detail).toMatchObject({
      id,
      name: "Slice B2 New Engagement",
      engagementType: "annual_assessment",
      periodStart: "2026-04-01",
      periodEnd: "2027-03-31",
      currentUserRoleName: "Engagement Manager",
    });

    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT status FROM engagement_memberships WHERE engagement_id = $1 AND user_id = $2`, [id, userA]),
    );
    expect(rows).toMatchObject([{ status: "active" }]);
  });

  it("10. Engagement creator can access the newly-created Engagement", async () => {
    const detail = await withRequestDb(userA, (db) => getEngagementDetail(db, userA, engagementA));
    expect(detail.id).toBe(engagementA);
  });

  it("Methodology selection: a published control library version is accepted", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createEngagement(db, userA, {
        organisationId: orgA,
        name: "Slice B2 Published Methodology Engagement",
        engagementType: "readiness",
        periodStart: null,
        periodEnd: null,
        controlLibraryVersionId: libraryAPublished,
      }),
    );
    const detail = await withRequestDb(userA, (db) => getEngagementDetail(db, userA, id));
    expect(detail.controlLibraryVersionId).toBe(libraryAPublished);
  });

  it("Methodology selection: a retired control library version is accepted", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createEngagement(db, userA, {
        organisationId: orgA,
        name: "Slice B2 Retired Methodology Engagement",
        engagementType: "readiness",
        periodStart: null,
        periodEnd: null,
        controlLibraryVersionId: libraryARetired,
      }),
    );
    const detail = await withRequestDb(userA, (db) => getEngagementDetail(db, userA, id));
    expect(detail.controlLibraryVersionId).toBe(libraryARetired);
  });

  it("Methodology selection: a draft control library version is rejected", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createEngagement(db, userA, {
          organisationId: orgA,
          name: "Slice B2 Draft Methodology Engagement",
          engagementType: "readiness",
          periodStart: null,
          periodEnd: null,
          controlLibraryVersionId: libraryADraft,
        }),
      ),
    ).rejects.toThrow(InvalidMethodologyError);
  });

  it("Methodology selection: a different tenant's control library version is rejected, even if published", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createEngagement(db, userA, {
          organisationId: orgA,
          name: "Slice B2 Cross-Tenant Methodology Engagement",
          engagementType: "readiness",
          periodStart: null,
          periodEnd: null,
          controlLibraryVersionId: libraryBPublished,
        }),
      ),
    ).rejects.toThrow(InvalidMethodologyError);
  });

  it("listSelectableControlLibraryVersions returns only published/retired versions for the given tenant, never draft or another tenant's", async () => {
    const list = await withRequestDb(userA, (db) => listSelectableControlLibraryVersions(db, tenantA));
    const ids = list.map((v) => v.id);
    expect(ids).toContain(libraryAPublished);
    expect(ids).toContain(libraryARetired);
    expect(ids).not.toContain(libraryADraft);
    expect(ids).not.toContain(libraryBPublished);
  });

  it("Duplicate engagement name (within the same organisation) is rejected, and nothing extra is created", async () => {
    await withRequestDb(userA, (db) =>
      createEngagement(db, userA, {
        organisationId: orgA,
        name: "Slice B2 Duplicate Engagement",
        engagementType: "readiness",
        periodStart: null,
        periodEnd: null,
        controlLibraryVersionId: null,
      }),
    );
    await expect(
      withRequestDb(userA, (db) =>
        createEngagement(db, userA, {
          organisationId: orgA,
          name: "slice b2 duplicate engagement",
          engagementType: "readiness",
          periodStart: null,
          periodEnd: null,
          controlLibraryVersionId: null,
        }),
      ),
    ).rejects.toThrow(DuplicateEngagementError);

    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT id FROM engagements WHERE organisation_id = $1 AND lower(name) = lower($2)`, [orgA, "Slice B2 Duplicate Engagement"]),
    );
    expect(rows).toHaveLength(1);
  });

  it("No orphaned onboarding records: a rejected engagement creation (invalid methodology) leaves no engagement or membership row behind", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createEngagement(db, userA, {
          organisationId: orgA,
          name: "Slice B2 Should Not Exist",
          engagementType: "readiness",
          periodStart: null,
          periodEnd: null,
          controlLibraryVersionId: libraryADraft,
        }),
      ),
    ).rejects.toThrow(InvalidMethodologyError);

    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT id FROM engagements WHERE name = 'Slice B2 Should Not Exist'`),
    );
    expect(rows).toHaveLength(0);
  });

  it("Audit attribution: organisation membership, engagement, and engagement membership creation are all recorded in audit_log, attributed to the acting user", async () => {
    const orgMemberAudit = await asFixtureSetup((c) =>
      c.query(
        `SELECT actor_user_id, action, tenant_id FROM audit_log
         WHERE entity_type = 'organisation_memberships'
           AND entity_id = (SELECT id FROM organisation_memberships WHERE organisation_id = $1 AND user_id = $2)`,
        [orgA, userA],
      ),
    );
    expect(orgMemberAudit.rows).toMatchObject([{ actor_user_id: userA, action: "insert", tenant_id: tenantA }]);

    const engagementAudit = await asFixtureSetup((c) =>
      c.query(`SELECT actor_user_id, action, tenant_id FROM audit_log WHERE entity_type = 'engagements' AND entity_id = $1`, [engagementA]),
    );
    expect(engagementAudit.rows).toMatchObject([{ actor_user_id: userA, action: "insert", tenant_id: tenantA }]);

    const engMemberAudit = await asFixtureSetup((c) =>
      c.query(
        `SELECT actor_user_id, action, tenant_id FROM audit_log
         WHERE entity_type = 'engagement_memberships'
           AND entity_id = (SELECT id FROM engagement_memberships WHERE engagement_id = $1 AND user_id = $2)`,
        [engagementA, userA],
      ),
    );
    expect(engMemberAudit.rows).toMatchObject([{ actor_user_id: userA, action: "insert", tenant_id: tenantA }]);
  });

  // --- Required security scenarios (PHASE B2 instructions §18) -------

  it("1. Tenant A cannot create an engagement under Tenant B organisation", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createEngagement(db, userA, {
          organisationId: orgB,
          name: "Cross-tenant attempt",
          engagementType: "readiness",
          periodStart: null,
          periodEnd: null,
          controlLibraryVersionId: null,
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("2. Tenant A cannot create OrganisationMembership in Tenant B", async () => {
    await expect(
      withRequestDb(userA, (db, client) =>
        client.query(`INSERT INTO organisation_memberships (user_id, organisation_id, role_id, created_by) VALUES ($1,$2,(SELECT id FROM roles WHERE name = 'Client Administrator'),$1)`, [userA, orgB]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("3. Tenant A cannot create EngagementMembership in Tenant B", async () => {
    await expect(
      withRequestDb(userA, (db, client) =>
        client.query(`INSERT INTO engagement_memberships (user_id, engagement_id, role_id, created_by) VALUES ($1,$2,(SELECT id FROM roles WHERE name = 'Engagement Manager'),$1)`, [userA, engagementB]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("4. Tenant A cannot read Tenant B engagement", async () => {
    await expect(withRequestDb(userA, (db) => getEngagementDetail(db, userA, engagementB))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("5. Organisation A2 member cannot administer a different Tenant A organisation (Org A)", async () => {
    await expect(
      withRequestDb(userAOrgOnly, (db, client) =>
        client.query(`INSERT INTO organisation_memberships (user_id, organisation_id, role_id, created_by) VALUES ($1,$2,(SELECT id FROM roles WHERE name = 'Client Administrator'),$1)`, [userAOrgOnly, orgA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("6. Organisation A2 member cannot create an engagement under Organisation B", async () => {
    await expect(
      withRequestDb(userAOrgOnly, (db) =>
        createEngagement(db, userAOrgOnly, {
          organisationId: orgB,
          name: "Org isolation attempt",
          engagementType: "readiness",
          periodStart: null,
          periodEnd: null,
          controlLibraryVersionId: null,
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("7. A Tenant A user cannot be granted membership on a Tenant B organisation, even by a legitimate Tenant B administrator", async () => {
    await expect(
      withRequestDb(userB, (db, client) =>
        client.query(`INSERT INTO organisation_memberships (user_id, organisation_id, role_id, created_by) VALUES ($1,$2,(SELECT id FROM roles WHERE name = 'Client Administrator'),$3)`, [userA, orgB, userB]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("8. Browser-supplied user_id cannot cross the tenant boundary, even on the actor's own legitimate organisation", async () => {
    await expect(
      withRequestDb(userA, (db, client) =>
        client.query(`INSERT INTO organisation_memberships (user_id, organisation_id, role_id, created_by) VALUES ($1,$2,(SELECT id FROM roles WHERE name = 'Client Administrator'),$1)`, [userB, orgA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("9. Engagement A member cannot access Engagement B", async () => {
    await expect(withRequestDb(userA, (db) => getEngagementDetail(db, userA, engagementB))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("11. Unauthorized role (no membership at all) cannot create an engagement", async () => {
    await expect(
      withRequestDb(userAOutsider, (db) =>
        createEngagement(db, userAOutsider, {
          organisationId: orgA,
          name: "Outsider attempt",
          engagementType: "readiness",
          periodStart: null,
          periodEnd: null,
          controlLibraryVersionId: null,
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("12. Anonymous user cannot create an engagement", async () => {
    await expect(
      asAnon((client) =>
        client.query(`INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type) VALUES ($1,$2,$3,'readiness')`, [tenantA, orgA, "Anon engagement"]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it("13. Unauthorized role (no membership at all) cannot administer organisation membership", async () => {
    await expect(
      withRequestDb(userAOutsider, (db, client) =>
        client.query(`INSERT INTO organisation_memberships (user_id, organisation_id, role_id, created_by) VALUES ($1,$2,(SELECT id FROM roles WHERE name = 'Client Administrator'),$1)`, [userAOutsider, orgA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("14. A direct request that skips the application authorization layer entirely (a raw engagements INSERT under a different tenant's organisation) is still rejected by RLS", async () => {
    await expect(
      withRequestDb(userA, (db, client) =>
        client.query(`INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type) VALUES ($1,$2,$3,'readiness')`, [tenantB, orgB, "Bypass attempt"]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("canCreateEngagement matches what engagements_insert actually allows: true for a tenant member, true for an org member, false otherwise", async () => {
    await withRequestDb(userA, async (db) => {
      expect(await canCreateEngagement(db, userA, orgA, tenantA)).toBe(true);
    });
    await withRequestDb(userAOrgOnly, async (db) => {
      expect(await canCreateEngagement(db, userAOrgOnly, orgA2, tenantA)).toBe(true);
      expect(await canCreateEngagement(db, userAOrgOnly, orgA, tenantA)).toBe(false);
    });
    await withRequestDb(userAOutsider, async (db) => {
      expect(await canCreateEngagement(db, userAOutsider, orgA, tenantA)).toBe(false);
    });
  });
});
