"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { updateRiskStatus } from "@/lib/domain/risks";
import { createFinding, InvalidFindingInputError } from "@/lib/domain/findings";
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

const createFindingSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  riskId: z.string().uuid(),
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(200, "Title must be 200 characters or fewer."),
  description: z.string().trim().max(4000).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  assignOwnerToSelf: z.enum(["on"]).optional(),
});

/**
 * Slice C4 (PHASE C4 instructions §4/§15): Browser → Server Action →
 * authenticate → authorize → validate → domain function → PostgreSQL →
 * RLS → audit. `riskId` identifies the source context only —
 * `createFinding` (lib/domain/findings.ts) re-derives tenant/
 * organisation/engagement scope server-side from the Risk's own row,
 * never trusting these form fields as proof of anything beyond "this is
 * what the consultant selected."
 */
export async function createFindingAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    riskId: formData.get("riskId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    severity: formData.get("severity"),
    assignOwnerToSelf: formData.get("assignOwnerToSelf") ?? undefined,
  };
  const detailPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.riskId === "string"
      ? riskDetailPath(raw.organisationId, raw.engagementId, raw.riskId)
      : "/organisations";

  const parsed = createFindingSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      createFinding(db, user.id, {
        riskId: parsed.data.riskId,
        title: parsed.data.title,
        description: parsed.data.description?.length ? parsed.data.description : null,
        severity: parsed.data.severity,
        assignOwnerToSelf: parsed.data.assignOwnerToSelf === "on",
      }),
    );
  } catch (err) {
    if (err instanceof InvalidFindingInputError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to create a finding for this risk.";
    } else {
      console.error("createFindingAction failed", err);
      errorMessage = "Something went wrong creating this finding. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(detailPath, "error", errorMessage));
  }

  revalidatePath(detailPath);
  redirect(withQueryFlag(detailPath, "saved", "1"));
}
