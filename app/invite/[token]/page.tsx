import type { ReactNode } from "react";
import Link from "next/link";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/actions";
import { withRequestDb } from "@/lib/db/request-client";
import { previewInvitation } from "@/lib/domain/invitations";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "./actions";
import type { InvitationAcceptanceErrorCode } from "./invitation-acceptance-ux";

// P2B.5 (Client Onboarding & Acceptance UX) — the invitation landing
// route. Deliberately OUTSIDE app/(shell): the shell layout's own
// `requireAuthenticatedUser()` would redirect an unauthenticated
// visitor straight to /login with no way back to the invitation, and
// this route's own first job is presenting something useful to exactly
// that visitor (brief's flow diagram: Invitation -> Authentication ->
// Acceptance). Depends on the caller's session and live invitation
// state — never statically prerendered.
export const dynamic = "force-dynamic";

// Fixed, pre-written messages only — never the raw error/exception text
// itself (brief §17/§18). Matches brief §17's own exact wording where
// given.
const ERROR_MESSAGES: Record<InvitationAcceptanceErrorCode, string> = {
  "practice-user": "This account cannot accept a client invitation. Please contact your PRIMUS administrator.",
  "tenant-mismatch": "This invitation belongs to a different practice than your account. Please contact your PRIMUS administrator.",
  "client-org-mismatch": "This invitation belongs to a different client organisation than your account. Please contact your PRIMUS administrator.",
  "invalid-role": "This invitation link is invalid or no longer available.",
  "membership-conflict": "You already have a different role on this organisation or engagement. Please contact your PRIMUS administrator.",
  "profile-missing": "Your account is not fully set up yet. Please contact your PRIMUS administrator.",
  unknown: "Something went wrong accepting this invitation. Please try again, or contact your PRIMUS administrator.",
};

function isKnownErrorCode(value: string | undefined): value is InvitationAcceptanceErrorCode {
  return value !== undefined && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);
}

/** Shared page chrome for every state below — deliberately a plain
 * local function, not a new shared component (this route has exactly
 * one caller); mirrors app/login/page.tsx's own inline card styling for
 * visual consistency with the one other unauthenticated-reachable page
 * in this app. */
function InviteCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { error?: string };
}) {
  // The raw token lives only in this request's own params/local
  // variables — never assigned anywhere that outlives this render,
  // never logged, never rendered as visible page text (it appears only
  // inside a hidden form field's `value` and inside `href`/redirect
  // URLs, the unavoidable, standard shape of a bearer-token link — see
  // DECISIONS.md for the full token-handling review this slice
  // performed).
  const token = params.token;

  const user = await getAuthenticatedUser();

  if (!user) {
    return (
      <InviteCard title="You've been invited to PRIMUS PRIVACY">
        <p className="mt-2 text-sm text-slate-600">
          You have been invited to join a PRIMUS engagement. Sign in with the invited email address to continue.
        </p>
        <Link
          href={`/login?returnTo=${encodeURIComponent(`/invite/${token}`)}`}
          className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          Sign in to continue
        </Link>
      </InviteCard>
    );
  }

  // Authenticated — resolve safe, read-only invitation metadata
  // (lib/domain/invitations.ts's previewInvitation, migration 0039).
  // Never the acceptance transaction itself (brief §2: "DO NOT
  // duplicate acceptance logic").
  const preview = await withRequestDb(user.id, (db) => previewInvitation(db, user.id, token));

  if (!preview) {
    return (
      <InviteCard title="Invitation not available">
        <p className="mt-2 text-sm text-slate-600">This invitation link is invalid or no longer available.</p>
      </InviteCard>
    );
  }

  if (preview.status === "revoked") {
    return (
      <InviteCard title="Invitation no longer active">
        <p className="mt-2 text-sm text-slate-600">This invitation is no longer active.</p>
      </InviteCard>
    );
  }

  if (preview.status === "accepted") {
    return (
      <InviteCard title="Invitation already used">
        <p className="mt-2 text-sm text-slate-600">This invitation has already been accepted.</p>
      </InviteCard>
    );
  }

  // status === "pending" from here on — `invitation_status` has exactly
  // three stored values, and the two above are already handled. No
  // persisted "expired" status ever exists (db/schema/enums.ts) —
  // expiry is a read-time computation, exactly like every other
  // expiry check in this codebase (lib/domain/invitations.ts).
  if (preview.expiresAt.getTime() <= Date.now()) {
    return (
      <InviteCard title="Invitation expired">
        <p className="mt-2 text-sm text-slate-600">
          This invitation has expired. Please ask your PRIMUS administrator for a new invitation.
        </p>
      </InviteCard>
    );
  }

  // Advisory only — a UI convenience deciding what to SHOW, never what
  // to ALLOW: `accept_invitation()` (migration 0038) independently
  // re-derives and re-checks the authoritative Auth email itself, from
  // `auth.users`, and is what actually enforces this match (brief §2's
  // own "the UI is NOT the security boundary"). Mirrors that function's
  // own trim+lowercase normalization exactly, for a display decision
  // that agrees with it in the common case — not a substitute for it.
  const authEmail = (user.email ?? "").trim().toLowerCase();
  const emailMatches = authEmail === preview.invitedEmail;

  if (!emailMatches) {
    return (
      <InviteCard title="Different email required">
        <p className="mt-2 text-sm text-slate-600">
          This invitation was issued to a different email address. Please sign in with the invited email.
        </p>
        <form action={signOut} className="mt-6">
          <input type="hidden" name="returnTo" value={`/invite/${token}`} />
          <Button type="submit" variant="secondary">
            Sign out and try a different account
          </Button>
        </form>
      </InviteCard>
    );
  }

  const knownError = isKnownErrorCode(searchParams.error) ? searchParams.error : undefined;

  return (
    <InviteCard title="You're invited to PRIMUS PRIVACY">
      {knownError ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {ERROR_MESSAGES[knownError]}
        </p>
      ) : null}

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Organisation</dt>
          <dd className="font-medium text-slate-900">{preview.organisationName}</dd>
        </div>
        {preview.engagementName ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Engagement</dt>
            <dd className="font-medium text-slate-900">{preview.engagementName}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Role</dt>
          <dd className="font-medium text-slate-900">{preview.roleName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Invited email</dt>
          <dd className="font-medium text-slate-900">{preview.invitedEmail}</dd>
        </div>
      </dl>

      <div className="mt-6 flex items-center gap-3">
        <form action={acceptInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit">Accept invitation</Button>
        </form>
        <Link href="/" className="text-sm font-medium text-slate-600 hover:underline">
          Cancel
        </Link>
      </div>
    </InviteCard>
  );
}
