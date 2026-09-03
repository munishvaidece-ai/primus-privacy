"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { createInvitation, InvalidInvitationRoleError, DuplicatePendingInvitationError } from "@/lib/domain/invitations";
import { getDevInvitationUrl } from "@/lib/domain/invitation-delivery";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

// P2B.5.1 (Internal Pilot — Invitation Creation UI). Mirrors
// `.../engagements/[engagementId]/actions.ts`'s own established shape
// exactly (Zod validation, `requireAuthenticatedUser`, `withRequestDb`,
// known-error-to-message mapping, `revalidatePath` + query-flag
// redirect) — the same pattern this codebase has used for every
// mutating Server Action since Slice C7.2, applied here for the first
// time to organisation-scoped invitation creation. This action does
// NOT decide authorization, tenant/organisation scope, or the allowed
// role — `createInvitation` (lib/domain/invitations.ts, P2B.3) remains
// exclusively authoritative for all three; this action only parses the
// form, calls it, and translates its own typed errors into a safe,
// pre-written message (never a raw database/exception string).

function organisationDetailPath(organisationId: string): string {
  return `/organisations/${organisationId}`;
}

function withQueryFlag(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

const createOrganisationInvitationSchema = z.object({
  organisationId: z.string().uuid(),
  invitedEmail: z.string().trim().email("Enter a valid email address."),
  roleId: z.string().uuid(),
});

/**
 * Organisation Detail → Members → Invite a client user → email + Client
 * role (Client Administrator / Privacy Officer / CXO / Executive
 * Viewer — `lib/domain/invitations.ts`'s own `listInvitationRoleOptions`
 * is what populates the form's role options in the first place, so an
 * out-of-allowlist `roleId` can only reach here via a hand-crafted
 * request, which `createInvitation` itself still independently rejects
 * regardless — see its own `InvalidInvitationRoleError` handling below).
 *
 * The development-only invitation link (P2B.5.1 §4): `getDevInvitationUrl`
 * (lib/domain/invitation-delivery.ts) returns `null` outright once
 * `NODE_ENV === "production"` — checked INSIDE that function itself, not
 * merely trusted here — so this redirect's own `devInviteUrl` query
 * parameter is never populated, and therefore never appears anywhere
 * (not the `Location` header, not the browser's next request, not its
 * address bar), in a production build. See DECISIONS.md for the
 * accepted, documented token-in-URL residual risk this shares with
 * `/invite/[token]` itself (R-180) — dev/pilot mode only, never
 * production.
 */
export async function createOrganisationInvitationAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    invitedEmail: formData.get("invitedEmail"),
    roleId: formData.get("roleId"),
  };
  const detailPath = typeof raw.organisationId === "string" ? organisationDetailPath(raw.organisationId) : "/organisations";

  const parsed = createOrganisationInvitationSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "inviteError", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  let createdId: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) =>
      createInvitation(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: null,
        invitedEmail: parsed.data.invitedEmail,
        roleId: parsed.data.roleId,
      }),
    );
    createdId = result.id;
  } catch (err) {
    if (err instanceof InvalidInvitationRoleError || err instanceof DuplicatePendingInvitationError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to invite members to this organisation.";
    } else {
      // Never expose database internals to users — full detail goes to
      // the server log only.
      console.error("createOrganisationInvitationAction failed", err);
      errorMessage = "Something went wrong creating this invitation. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(detailPath, "inviteError", errorMessage));
  }

  revalidatePath(detailPath);

  let successPath = withQueryFlag(detailPath, "invited", "1");
  successPath = withQueryFlag(successPath, "invitedEmail", parsed.data.invitedEmail.trim().toLowerCase());
  const devUrl = createdId ? getDevInvitationUrl(createdId) : null;
  if (devUrl) successPath = withQueryFlag(successPath, "devInviteUrl", devUrl);

  redirect(successPath);
}
