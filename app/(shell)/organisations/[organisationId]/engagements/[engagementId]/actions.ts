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
