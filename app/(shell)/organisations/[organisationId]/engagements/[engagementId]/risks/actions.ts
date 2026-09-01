"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { updateRiskStatus } from "@/lib/domain/risks";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

function riskDetailPath(organisationId: string, engagementId: string, riskId: string): string {
  return `/organisations/${organisationId}/engagements/${engagementId}/risks/${riskId}`;
}

function withQueryFlag(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

const updateRiskStatusSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  riskId: z.string().uuid(),
  status: z.enum(["open", "mitigating", "accepted", "closed"]),
});

/**
 * Slice C3 (PHASE C3 instructions §12): the one supported post-creation
 * edit — Risk status, using the existing `risk_status` enum exactly, no
 * new states. See `updateRiskStatus` (lib/domain/risks.ts) for why no
 * other field is editable in this slice.
 */
export async function updateRiskStatusAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    riskId: formData.get("riskId"),
    status: formData.get("status"),
  };
  const detailPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.riskId === "string"
      ? riskDetailPath(raw.organisationId, raw.engagementId, raw.riskId)
      : "/organisations";

  const parsed = updateRiskStatusSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      updateRiskStatus(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        riskId: parsed.data.riskId,
        status: parsed.data.status,
      }),
    );
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to update this risk.";
    } else {
      console.error("updateRiskStatusAction failed", err);
      errorMessage = "Something went wrong updating this risk. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(detailPath, "error", errorMessage));
  }

  revalidatePath(detailPath);
  redirect(withQueryFlag(detailPath, "saved", "1"));
}
