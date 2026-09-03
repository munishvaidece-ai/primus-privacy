// P2B.5 — Client Onboarding & Acceptance UX. Tests `previewInvitation`
// (lib/domain/invitations.ts), the thin wrapper around
// `public.preview_invitation()` (migration 0039) the invitation landing
// page uses to show safe metadata before an invitee accepts. Real
// PostgreSQL throughout — no mocks.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createInvitation,
  revokeInvitation,
  acceptInvitation,
  previewInvitation,
  generateInvitationToken,
  hashInvitationToken,
} from "@/lib/domain/invitations";
import { getUserClientOrgId } from "@/lib/authorization/service";
import { getDevInvitationDeliveryAdapter } from "@/lib/domain/invitation-delivery";
import {
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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe("Application layer — Invitation preview (P2B.5)", () => {
  let tenantA: string;
  let orgA: string;
  let engagementA: string;
  let roleClientAdministrator: string;
  let roleBusinessOwner: string;
  let orgAdminA: string; // Client Administrator (membership.manage), orgA — invitation creator
  let engManagerA: string; // Engagement Manager (membership.manage), engagementA — invitation creator
  let anyAuthenticatedUser: string; // no relation to the invitation at all — previewing only requires SOME session

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "P2B.5 Preview Tenant A");
      orgA = await createOrganisation(client, tenantA, "P2B.5 Preview Org A");
      engagementA = await createEngagement(client, tenantA, orgA, "P2B.5 Preview Engagement A");

      roleClientAdministrator = await getOrCreateRole(client, "Client Administrator");
      roleBusinessOwner = await getOrCreateRole(client, "Business Owner");

      orgAdminA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, orgAdminA, orgA, "Client Administrator");

      engManagerA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, engManagerA, engagementA, "Engagement Manager");

      anyAuthenticatedUser = await createUser(client, { tenantId: tenantA });
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

  async function createOrgInvitation(invitedEmail: string) {
    const { id } = await withRequestDb(orgAdminA, (db) =>
      createInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitedEmail, roleId: roleClientAdministrator }),
    );
    const deliveries = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = deliveries[deliveries.length - 1]!.invitationUrl.split("/invite/")[1]!;
    return { id, rawToken };
  }

  async function createEngagementInvitation(invitedEmail: string) {
    const { id } = await withRequestDb(engManagerA, (db) =>
      createInvitation(db, engManagerA, { organisationId: orgA, engagementId: engagementA, invitedEmail, roleId: roleBusinessOwner }),
    );
    const deliveries = getDevInvitationDeliveryAdapter().getCapturedDeliveries();
    const rawToken = deliveries[deliveries.length - 1]!.invitationUrl.split("/invite/")[1]!;
    return { id, rawToken };
  }

  it("1. a pending organisation-scoped invitation previews safely — organisation name, no engagement, invited email, role, status", async () => {
    const invitedEmail = email("p1");
    const { rawToken } = await createOrgInvitation(invitedEmail);
    const preview = await withRequestDb(anyAuthenticatedUser, (db) => previewInvitation(db, anyAuthenticatedUser, rawToken));
    expect(preview).toMatchObject({
      invitedEmail,
      organisationName: "P2B.5 Preview Org A",
      engagementName: null,
      roleName: "Client Administrator",
      status: "pending",
    });
    expect(preview!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("2. a pending engagement-scoped invitation previews safely — includes the engagement name", async () => {
    const invitedEmail = email("p2");
    const { rawToken } = await createEngagementInvitation(invitedEmail);
    const preview = await withRequestDb(anyAuthenticatedUser, (db) => previewInvitation(db, anyAuthenticatedUser, rawToken));
    expect(preview).toMatchObject({
      invitedEmail,
      organisationName: "P2B.5 Preview Org A",
      engagementName: "P2B.5 Preview Engagement A",
      roleName: "Business Owner",
      status: "pending",
    });
  });

  it("3. an accepted invitation still previews, reporting its real status — the confirmation page uses this to explain 'already accepted'", async () => {
    const invitedEmail = email("p3");
    const invitee = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA, email: invitedEmail }));
    const { rawToken } = await createOrgInvitation(invitedEmail);
    await withRequestDb(invitee, (db) => acceptInvitation(db, invitee, rawToken));

    const preview = await withRequestDb(anyAuthenticatedUser, (db) => previewInvitation(db, anyAuthenticatedUser, rawToken));
    expect(preview?.status).toBe("accepted");
  });

  it("4. a revoked invitation still previews, reporting its real status", async () => {
    const invitedEmail = email("p4");
    const { id, rawToken } = await createOrgInvitation(invitedEmail);
    await withRequestDb(orgAdminA, (db) => revokeInvitation(db, orgAdminA, { organisationId: orgA, engagementId: null, invitationId: id }));

    const preview = await withRequestDb(anyAuthenticatedUser, (db) => previewInvitation(db, anyAuthenticatedUser, rawToken));
    expect(preview?.status).toBe("revoked");
  });

  it("5. an expired-but-still-pending invitation previews with its real expiry — the page computes 'expired' itself, nothing is pre-filtered", async () => {
    const invitedEmail = email("p5");
    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    await asFixtureSetup((c) =>
      c.query(
        `INSERT INTO invitations (id, tenant_id, organisation_id, engagement_id, invited_email, role_id, token_hash, expires_at, invited_by)
         VALUES ($1,$2,$3,NULL,$4,$5,$6, now() - interval '1 hour', $7)`,
        [randomUUID(), tenantA, orgA, invitedEmail, roleClientAdministrator, tokenHash, orgAdminA],
      ),
    );
    const preview = await withRequestDb(anyAuthenticatedUser, (db) => previewInvitation(db, anyAuthenticatedUser, rawToken));
    expect(preview?.status).toBe("pending");
    expect(preview!.expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it("6. a nonexistent token previews as null (the generic 'invalid' state)", async () => {
    const preview = await withRequestDb(anyAuthenticatedUser, (db) => previewInvitation(db, anyAuthenticatedUser, generateInvitationToken()));
    expect(preview).toBeNull();
  });

  it("7. a modified token previews as null", async () => {
    const invitedEmail = email("p7");
    const { rawToken } = await createOrgInvitation(invitedEmail);
    const modified = rawToken.slice(0, -1) + (rawToken.at(-1) === "A" ? "B" : "A");
    const preview = await withRequestDb(anyAuthenticatedUser, (db) => previewInvitation(db, anyAuthenticatedUser, modified));
    expect(preview).toBeNull();
  });

  it("8. previewing does not require any relationship to the invitation — any authenticated identity may preview a token they present, exactly like acceptance itself is gated by token possession, not prior membership", async () => {
    const invitedEmail = email("p8");
    const { rawToken } = await createOrgInvitation(invitedEmail);
    // anyAuthenticatedUser has no membership, no relation to orgA/tenantA
    // beyond being seeded in the same tenant — preview still succeeds;
    // it is a read of the invitation's own safe fields, not an
    // authorization decision about the previewer.
    const preview = await withRequestDb(anyAuthenticatedUser, (db) => previewInvitation(db, anyAuthenticatedUser, rawToken));
    expect(preview).not.toBeNull();
  });

  it("9. the preview never returns token_hash or any internal identifier — only the five safe fields exist on the result", async () => {
    const invitedEmail = email("p9");
    const { rawToken } = await createOrgInvitation(invitedEmail);
    const preview = await withRequestDb(anyAuthenticatedUser, (db) => previewInvitation(db, anyAuthenticatedUser, rawToken));
    expect(Object.keys(preview!).sort()).toEqual(["engagementName", "expiresAt", "invitedEmail", "organisationName", "roleName", "status"].sort());
  });

  it("10. an unauthenticated (anon) request cannot call preview_invitation at all", async () => {
    const invitedEmail = email("p10");
    const { rawToken } = await createOrgInvitation(invitedEmail);
    await expect(
      asAnon((c) => c.query("SELECT * FROM preview_invitation($1)", [hashInvitationToken(rawToken)])),
    ).rejects.toThrow(/permission denied/i);
  });

  // === getUserClientOrgId (lib/authorization/service.ts) ===================

  it("11. getUserClientOrgId returns null for a practice-side user (no client_org_id)", async () => {
    const practiceUser = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA }));
    const result = await withRequestDb(practiceUser, (db) => getUserClientOrgId(db, practiceUser));
    expect(result).toBeNull();
  });

  it("12. getUserClientOrgId returns the organisation id for a client-side user", async () => {
    const clientUser = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA }));
    const result = await withRequestDb(clientUser, (db) => getUserClientOrgId(db, clientUser));
    expect(result).toBe(orgA);
  });
});
