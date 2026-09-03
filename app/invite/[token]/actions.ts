"use server";

import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { acceptInvitation, type AcceptInvitationResult } from "@/lib/domain/invitations";
import { invitationAcceptanceErrorCode, buildPostAcceptanceDestination } from "./invitation-acceptance-ux";

// P2B.5 (Client Onboarding & Acceptance UX). This Server Action is
// deliberately thin: it authenticates the caller, calls the ALREADY
// IMPLEMENTED backend acceptance transaction (`acceptInvitation` —
// P2B.4), and redirects. It does not create memberships, does not
// update `users`/`invitations` directly, and does not decide the
// tenant/organisation/engagement/role — every one of those decisions
// remains `accept_invitation()`'s own, exclusively (brief §2's own
// explicit "the UI must not... The existing P2B.4 backend remains
// authoritative"). The pure helpers this action uses
// (`invitationAcceptanceErrorCode`/`buildPostAcceptanceDestination`)
// live in ./invitation-acceptance-ux.ts, not here — a `"use server"`
// file may export ONLY async Server Actions (Next.js build-time
// enforcement, confirmed directly this slice).
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = formData.get("token");
  if (typeof token !== "string" || token.length === 0) {
    redirect("/");
  }

  const user = await requireAuthenticatedUser();

  let result: AcceptInvitationResult;
  try {
    result = await withRequestDb(user.id, (db) => acceptInvitation(db, user.id, token));
  } catch (err) {
    const code = invitationAcceptanceErrorCode(err);
    const path = `/invite/${encodeURIComponent(token)}`;
    redirect(code === null ? path : `${path}?error=${code}`);
  }

  redirect(buildPostAcceptanceDestination(result));
}
