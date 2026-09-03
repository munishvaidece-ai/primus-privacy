// P2B.5 — Client Onboarding & Acceptance UX. End-to-end tests closing
// the loop this slice's own brief §18 D/E asks for: an invited client
// user previews, accepts, reaches their own organisation/engagement
// (the pages app/(shell)/organisations/[organisationId]/page.tsx and
// .../engagements/[engagementId]/page.tsx actually call), is blocked
// from an unrelated organisation/engagement and from cross-tenant
// access, and cannot perform a representative consultant-only action —
// while the inviting consultant's own ability is unaffected. The
// underlying authorization mechanisms are already exhaustively tested
// elsewhere (tests/app/authorization*.test.ts, tests/app/engagement-
// membership.test.ts, tests/app/invitation-acceptance.test.ts); this
// file exercises them specifically through THIS slice's own new
// preview -> accept -> reach-workspace path, real PostgreSQL
// throughout, no mocks.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { createInvitation, acceptInvitation, previewInvitation } from "@/lib/domain/invitations";
import { getOrganisationDetail } from "@/lib/domain/organisations";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { listEngagementMembers } from "@/lib/domain/engagement-memberships";
import {
  NotFoundOrForbiddenError,
  getUserClientOrgId,
  canFinalizeAssessment,
  canManageRisk,
  canReviewEvidence,
} from "@/lib/authorization/service";
import { getDevInvitationDeliveryAdapter } from "@/lib/domain/invitation-delivery";
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

describe("Client onboarding — end to end (P2B.5)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string, engagementA2: string, engagementOtherOrg: string;
  let roleClientAdministrator: string;
  let roleBusinessOwner: string;
  let orgAdminA: string; // Client Administrator, orgA — invitation creator + the ongoing consultant-side actor
  let engManagerA: string; // Engagement Manager, engagementA — invitation creator

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "P2B.5 E2E Tenant A");
      tenantB = await createTenant(client, "P2B.5 E2E Tenant B");
      orgA = await createOrganisation(client, tenantA, "P2B.5 E2E Org A");
      orgA2 = await createOrganisation(client, tenantA, "P2B.5 E2E Org A2");
      orgB = await createOrganisation(client, tenantB, "P2B.5 E2E Org B");
      engagementA = await createEngagement(client, tenantA, orgA, "P2B.5 E2E Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA, "P2B.5 E2E Engagement A2 (sibling, same org)");
      engagementOtherOrg = await createEngagement(client, tenantA, orgA2, "P2B.5 E2E Engagement (org A2)");

      roleClientAdministrator = await getOrCreateRole(client, "Client Administrator");
      roleBusinessOwner = await getOrCreateRole(client, "Business Owner");

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

  it("full pilot loop: invite -> preview -> accept -> reach own workspace -> blocked from everything else -> no consultant privilege gained -> consultant unaffected", async () => {
    // --- PRACTICE SIDE: create an organisation-scoped invitation ---
    const invitedEmail = email("pilot");
    const { id: invitationId } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    const deliveries = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = deliveries[deliveries.length - 1]!.invitationUrl.split("/invite/")[1]!;

    // --- CLIENT SIDE: the invitee authenticates and previews ---
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: invitedEmail }));
    const preview = await withRequestDb(invitee, (db) => previewInvitation(db, invitee, rawToken));
    expect(preview).toMatchObject({ organisationName: "P2B.5 E2E Org A", engagementName: null, status: "pending" });

    // --- CLIENT SIDE: accept ---
    const result = await withRequestDb(invitee, (db) => acceptInvitation(db, invitee, rawToken));
    expect(result.organisationId).toBe(orgA);

    // The shell's own nav-differentiation signal is now genuinely "client".
    expect(await withRequestDb(invitee, (db) => getUserClientOrgId(db, invitee))).toBe(orgA);

    // --- CLIENT SIDE: reaches their own organisation workspace (the
    // exact function app/(shell)/organisations/[organisationId]/page.tsx
    // calls) ---
    const detail = await withRequestDb(invitee, (db) => getOrganisationDetail(db, invitee, orgA));
    expect(detail.id).toBe(orgA);

    // --- blocked from an unrelated organisation, same tenant ---
    await expect(withRequestDb(invitee, (db) => getOrganisationDetail(db, invitee, orgA2))).rejects.toThrow(NotFoundOrForbiddenError);

    // --- blocked from cross-tenant organisation ---
    await expect(withRequestDb(invitee, (db) => getOrganisationDetail(db, invitee, orgB))).rejects.toThrow(NotFoundOrForbiddenError);

    // --- reaches an engagement under their OWN organisation, via the
    // existing OrganisationMembership -> any-engagement-under-it
    // fallback (canAccessOrganisation/canAccessEngagement,
    // tests/rls/membership-boundaries.test.ts's own (a)) — the org-scope
    // invitation this test accepted grants exactly this, unchanged ---
    const engagementDetail = await withRequestDb(invitee, (db) => getEngagementDetail(db, invitee, engagementA));
    expect(engagementDetail.id).toBe(engagementA);

    // --- blocked from an engagement under a DIFFERENT organisation,
    // same tenant ---
    await expect(withRequestDb(invitee, (db) => getEngagementDetail(db, invitee, engagementOtherOrg))).rejects.toThrow(
      NotFoundOrForbiddenError,
    );

    // --- a representative CONSULTANT-only action remains unavailable to
    // the client, even though this particular invitation's own role
    // (Client Administrator) DOES legitimately grant membership.manage
    // on their own organisation — that is by design (a Client
    // Administrator manages their own org's invitations/memberships,
    // db/seed/roles.ts), NOT a gap this test should assert against.
    // `assessment.finalize`/`maturity.compute`/`evidence.review`/
    // `risk.manage`/`finding.manage`/`validation.perform` are granted
    // ONLY to Engagement Manager/Consultant (db/seed/roles.ts's own
    // ROLE_PERMISSIONS map) — never to ANY client-side role, Client
    // Administrator included. ---
    expect(await withRequestDb(invitee, (db) => canFinalizeAssessment(db, invitee, engagementA, orgA))).toBe(false);
    expect(await withRequestDb(invitee, (db) => canManageRisk(db, invitee, engagementA, orgA))).toBe(false);
    expect(await withRequestDb(invitee, (db) => canReviewEvidence(db, invitee, engagementA, orgA))).toBe(false);

    // --- CONSULTANT SIDE: the inviting Client Administrator's own
    // membership-management ability is completely unaffected, and the
    // engagement roster now correctly reflects the client (if later
    // added to the engagement too — here we confirm the ORGANISATION
    // roster instead, which getOrganisationDetail itself already
    // returned above) ---
    expect(detail.members.some((m) => m.userId === invitee || m.email === invitedEmail)).toBe(true);

    // orgAdminA can still manage engagement membership on engagementA —
    // proving acceptance did not consume/alter the consultant's own
    // standing.
    const members = await withRequestDb(orgAdminA, (db) =>
      listEngagementMembers(db, orgAdminA, { organisationId: orgA, engagementId: engagementA }),
    );
    expect(Array.isArray(members)).toBe(true);

    void invitationId; // used only for readability of the fixture above
  });

  it("an engagement-scoped acceptance reaches the engagement but is blocked from a sibling engagement of the same organisation", async () => {
    const invitedEmail = email("eng-pilot");
    const { id: invitationId } = await withRequestDb(engManagerA, (db) =>
      createInvitation(db, engManagerA, { organisationId: orgA, engagementId: engagementA, invitedEmail, roleId: roleBusinessOwner }),
    );
    const deliveries = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = deliveries[deliveries.length - 1]!.invitationUrl.split("/invite/")[1]!;

    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: invitedEmail }));
    await withRequestDb(invitee, (db) => acceptInvitation(db, invitee, rawToken));

    const engagementDetail = await withRequestDb(invitee, (db) => getEngagementDetail(db, invitee, engagementA));
    expect(engagementDetail.id).toBe(engagementA);

    await expect(withRequestDb(invitee, (db) => getEngagementDetail(db, invitee, engagementA2))).rejects.toThrow(NotFoundOrForbiddenError);

    void invitationId;
  });
});
