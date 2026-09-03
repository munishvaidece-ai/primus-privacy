// P2B.5 — Client Onboarding & Acceptance UX. Pure-function tests for
// app/invite/[token]/invitation-acceptance-ux.ts — the safe error-code
// mapping and post-acceptance destination builder the invitation
// route's own Server Action uses.
import { describe, expect, it } from "vitest";
import {
  invitationAcceptanceErrorCode,
  buildPostAcceptanceDestination,
} from "@/app/invite/[token]/invitation-acceptance-ux";
import {
  InvitationInvalidError,
  InvitationExpiredError,
  InvitationRevokedError,
  InvitationAlreadyAcceptedError,
  InvitationEmailMismatchError,
  PracticeUserCannotAcceptInvitationError,
  InvitationTenantMismatchError,
  InvitationClientOrganisationMismatchError,
  InvalidInvitationRoleError,
  InvitationMembershipConflictError,
  InvitationAcceptanceProfileMissingError,
} from "@/lib/domain/invitations";

describe("invitationAcceptanceErrorCode", () => {
  it("maps each error category the GET page cannot re-detect on its own to a distinct safe code", () => {
    expect(invitationAcceptanceErrorCode(new PracticeUserCannotAcceptInvitationError())).toBe("practice-user");
    expect(invitationAcceptanceErrorCode(new InvitationTenantMismatchError())).toBe("tenant-mismatch");
    expect(invitationAcceptanceErrorCode(new InvitationClientOrganisationMismatchError())).toBe("client-org-mismatch");
    expect(invitationAcceptanceErrorCode(new InvalidInvitationRoleError())).toBe("invalid-role");
    expect(invitationAcceptanceErrorCode(new InvitationMembershipConflictError())).toBe("membership-conflict");
    expect(invitationAcceptanceErrorCode(new InvitationAcceptanceProfileMissingError())).toBe("profile-missing");
  });

  it("returns null for the categories the GET page's own fresh preview already re-detects — no query param is added for these", () => {
    expect(invitationAcceptanceErrorCode(new InvitationInvalidError())).toBeNull();
    expect(invitationAcceptanceErrorCode(new InvitationExpiredError())).toBeNull();
    expect(invitationAcceptanceErrorCode(new InvitationRevokedError())).toBeNull();
    expect(invitationAcceptanceErrorCode(new InvitationAlreadyAcceptedError())).toBeNull();
    expect(invitationAcceptanceErrorCode(new InvitationEmailMismatchError())).toBeNull();
  });

  it("maps an unrecognized error to the generic 'unknown' code, never leaking its own message", () => {
    expect(invitationAcceptanceErrorCode(new Error("some raw database detail that must never reach a URL"))).toBe("unknown");
  });
});

describe("buildPostAcceptanceDestination", () => {
  it("routes an organisation-scoped acceptance (engagementId null) to the organisation page", () => {
    expect(buildPostAcceptanceDestination({ organisationId: "org-1", engagementId: null })).toBe(
      "/organisations/org-1?joined=1",
    );
  });

  it("routes an engagement-scoped acceptance to the engagement page", () => {
    expect(buildPostAcceptanceDestination({ organisationId: "org-1", engagementId: "eng-1" })).toBe(
      "/organisations/org-1/engagements/eng-1?joined=1",
    );
  });
});
