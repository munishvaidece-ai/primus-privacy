// P2B.5 (Client Onboarding & Acceptance UX). Split out of ./actions.ts:
// a `"use server"` file may export ONLY async Server Actions — Next.js
// enforces this at build time (confirmed directly: this slice's own
// first build attempt failed with "Server actions must be async
// functions" against these exact, synchronous exports), so these plain,
// independently testable helpers live in their own module instead.
import type { AcceptInvitationResult } from "@/lib/domain/invitations";
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

/**
 * The safe query-string codes `app/invite/[token]/page.tsx` recognizes
 * and maps to one fixed, pre-written explanatory message each — never
 * the raw error text itself (brief §17/§18: no database identifiers, no
 * internal error text, ever reflected into a URL or rendered page).
 * Deliberately covers ONLY the error categories that page's own GET-time
 * state detection (a fresh `previewInvitation` call, independent of
 * `./actions.ts`) cannot already distinguish on its own — invalid/
 * expired/revoked/already-accepted/email-mismatch are all independently
 * re-detected on every page load from the invitation's OWN current
 * status/expiry/email, so no query param is added for those at all;
 * redirecting back to the bare `/invite/[token]` URL is enough for the
 * page to show the correct explanation itself, from fresher data than
 * this one request's own error could carry anyway (e.g. two concurrent
 * accept attempts — P2B.4's own tested race — would otherwise show a
 * stale "email mismatch" label on what actually became "already
 * accepted").
 */
export type InvitationAcceptanceErrorCode =
  | "practice-user"
  | "tenant-mismatch"
  | "client-org-mismatch"
  | "invalid-role"
  | "membership-conflict"
  | "profile-missing"
  | "unknown";

/** Maps each of `acceptInvitation`'s own typed errors
 * (lib/domain/invitations.ts) to the safe code above, or `null` for the
 * categories the GET page re-detects itself. */
export function invitationAcceptanceErrorCode(err: unknown): InvitationAcceptanceErrorCode | null {
  if (err instanceof PracticeUserCannotAcceptInvitationError) return "practice-user";
  if (err instanceof InvitationTenantMismatchError) return "tenant-mismatch";
  if (err instanceof InvitationClientOrganisationMismatchError) return "client-org-mismatch";
  if (err instanceof InvalidInvitationRoleError) return "invalid-role";
  if (err instanceof InvitationMembershipConflictError) return "membership-conflict";
  if (err instanceof InvitationAcceptanceProfileMissingError) return "profile-missing";
  if (
    err instanceof InvitationInvalidError ||
    err instanceof InvitationExpiredError ||
    err instanceof InvitationRevokedError ||
    err instanceof InvitationAlreadyAcceptedError ||
    err instanceof InvitationEmailMismatchError
  ) {
    return null;
  }
  return "unknown";
}

/**
 * Where a successful acceptance lands the user (brief §4) — derived
 * ENTIRELY from `acceptInvitation`'s own return value, itself derived
 * server-side from the invitation row's own authoritative scope
 * (lib/domain/invitations.ts's own `acceptInvitation` docstring) —
 * never from any caller-supplied URL parameter; this route has no
 * `organisationId`/`engagementId` input of its own at all. `?joined=1`
 * mirrors the existing `?created=1` convention
 * (app/(shell)/organisations/[organisationId]/page.tsx) for a one-time,
 * purely informational welcome banner.
 */
export function buildPostAcceptanceDestination(result: Pick<AcceptInvitationResult, "organisationId" | "engagementId">): string {
  return result.engagementId
    ? `/organisations/${result.organisationId}/engagements/${result.engagementId}?joined=1`
    : `/organisations/${result.organisationId}?joined=1`;
}
