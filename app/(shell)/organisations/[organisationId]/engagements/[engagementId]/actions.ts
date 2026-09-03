"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import {
  addEngagementMember,
  revokeEngagementMember,
  InvalidEngagementRoleError,
  IneligibleUserError,
  DuplicateMembershipError,
} from "@/lib/domain/engagement-memberships";
import { createInvitation, InvalidInvitationRoleError, DuplicatePendingInvitationError } from "@/lib/domain/invitations";
import { getDevInvitationUrl } from "@/lib/domain/invitation-delivery";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

function engagementDetailPath(organisationId: string, engagementId: string): string {
  return `/organisations/${organisationId}/engagements/${engagementId}`;
}

function withQueryFlag(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

const addEngagementMemberSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  roleId: z.string().uuid(),
});

/**
 * Slice C7.2 (the C7 review's own second P0 finding, instructions §14):
 * Engagement Detail → Members → Add Member → select eligible existing
 * user → select valid engagement Role → Add. See `addEngagementMember`
 * (lib/domain/engagement-memberships.ts) for the full reasoning behind
 * every design choice here — eligibility, role validation,
 * duplicate handling, and the `membership.manage`-based authorization
 * rule (`requireEngagementMembershipManageAccess`).
 */
export async function addEngagementMemberAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    targetUserId: formData.get("targetUserId"),
    roleId: formData.get("roleId"),
  };
  const detailPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string"
      ? engagementDetailPath(raw.organisationId, raw.engagementId)
      : "/organisations";

  const parsed = addEngagementMemberSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      addEngagementMember(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        targetUserId: parsed.data.targetUserId,
        roleId: parsed.data.roleId,
      }),
    );
  } catch (err) {
    if (err instanceof InvalidEngagementRoleError || err instanceof IneligibleUserError || err instanceof DuplicateMembershipError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to manage membership on this engagement.";
    } else {
      // Never expose database internals to users — full detail goes to
      // the server log only.
      console.error("addEngagementMemberAction failed", err);
      errorMessage = "Something went wrong adding this member. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(detailPath, "error", errorMessage));
  }

  revalidatePath(detailPath);
  redirect(withQueryFlag(detailPath, "saved", "1"));
}

const createEngagementInvitationSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  invitedEmail: z.string().trim().email("Enter a valid email address."),
  roleId: z.string().uuid(),
});

/**
 * P2B.5.1 (Internal Pilot — Invitation Creation UI): Engagement Detail →
 * Members → Invite a client user → email + Engagement role (Business
 * Owner / IT-CISO / Procurement / Legal — populated from
 * `listInvitationRoleOptions(db, engagementId)`, `lib/domain/
 * invitations.ts`). Mirrors `createOrganisationInvitationAction`
 * (`.../organisations/[organisationId]/actions.ts`) exactly, with a
 * non-null `engagementId` — `createInvitation` itself is what resolves
 * and enforces the engagement's own organisation/tenant scope and its
 * `membership.manage` authorization (via `requireInvitationManageAccess`,
 * engagement branch), not this action. See that sibling action's own
 * docstring for the full dev-invitation-link reasoning (§4/R-180),
 * identical here.
 */
export async function createEngagementInvitationAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    invitedEmail: formData.get("invitedEmail"),
    roleId: formData.get("roleId"),
  };
  const detailPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string"
      ? engagementDetailPath(raw.organisationId, raw.engagementId)
      : "/organisations";

  const parsed = createEngagementInvitationSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "inviteError", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  let createdId: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) =>
      createInvitation(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        invitedEmail: parsed.data.invitedEmail,
        roleId: parsed.data.roleId,
      }),
    );
    createdId = result.id;
  } catch (err) {
    if (err instanceof InvalidInvitationRoleError || err instanceof DuplicatePendingInvitationError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to invite members to this engagement.";
    } else {
      // Never expose database internals to users — full detail goes to
      // the server log only.
      console.error("createEngagementInvitationAction failed", err);
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

const revokeEngagementMemberSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  membershipId: z.string().uuid(),
});

/**
 * Slice C7.2 (instructions §15): Engagement Members → Revoke. A status
 * change (`active` → `revoked`), never a hard delete — see
 * `revokeEngagementMember`'s own docstring for the full self-protection
 * reasoning (no invariant found anywhere in the product documents; the
 * simplest existing model is preserved — anyone who can manage
 * membership may revoke any member, including themselves).
 */
export async function revokeEngagementMemberAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    membershipId: formData.get("membershipId"),
  };
  const detailPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string"
      ? engagementDetailPath(raw.organisationId, raw.engagementId)
      : "/organisations";

  const parsed = revokeEngagementMemberSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      revokeEngagementMember(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        membershipId: parsed.data.membershipId,
      }),
    );
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to manage membership on this engagement.";
    } else {
      console.error("revokeEngagementMemberAction failed", err);
      errorMessage = "Something went wrong revoking this member. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(detailPath, "error", errorMessage));
  }

  revalidatePath(detailPath);
  redirect(withQueryFlag(detailPath, "saved", "1"));
}
