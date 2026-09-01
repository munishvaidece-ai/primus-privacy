"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { updateFinding, InvalidFindingInputError } from "@/lib/domain/findings";
import { createRemediationAction, InvalidRemediationInputError } from "@/lib/domain/remediation";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

function findingDetailPath(organisationId: string, engagementId: string, findingId: string): string {
  return `/organisations/${organisationId}/engagements/${engagementId}/findings/${findingId}`;
}

function withQueryFlag(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

const updateFindingSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  findingId: z.string().uuid(),
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(200, "Title must be 200 characters or fewer."),
  description: z.string().trim().max(4000).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["open", "in_progress", "resolved", "accepted"]),
  ownerAction: z.enum(["keep", "assign_self", "unassign"]),
});

/**
 * Slice C4 (PHASE C4 instructions §20/§26): the Finding edit form —
 * title/description/severity/status/owner, the exact fields the
 * approved `findings` schema actually supports (see `updateFinding`,
 * lib/domain/findings.ts, for why this differs from Risk's own
 * status-only edit in Slice C3).
 */
export async function updateFindingAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    findingId: formData.get("findingId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    severity: formData.get("severity"),
    status: formData.get("status"),
    ownerAction: formData.get("ownerAction") ?? "keep",
  };
  const detailPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.findingId === "string"
      ? findingDetailPath(raw.organisationId, raw.engagementId, raw.findingId)
      : "/organisations";

  const parsed = updateFindingSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      updateFinding(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        findingId: parsed.data.findingId,
        title: parsed.data.title,
        description: parsed.data.description?.length ? parsed.data.description : null,
        severity: parsed.data.severity,
        status: parsed.data.status,
        ownerAction: parsed.data.ownerAction,
      }),
    );
  } catch (err) {
    if (err instanceof InvalidFindingInputError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to update this finding.";
    } else {
      console.error("updateFindingAction failed", err);
      errorMessage = "Something went wrong updating this finding. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(detailPath, "error", errorMessage));
  }

  revalidatePath(detailPath);
  redirect(withQueryFlag(detailPath, "saved", "1"));
}

const createRemediationActionSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  findingId: z.string().uuid(),
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(200, "Title must be 200 characters or fewer."),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().or(z.literal("")),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.")
    .optional()
    .or(z.literal("")),
  assignOwnerToSelf: z.enum(["on"]).optional(),
});

/**
 * Slice C5 (PHASE C5 instructions §4/§16): Browser → Server Action →
 * authenticate → authorize → validate → domain function → PostgreSQL →
 * RLS → audit. `findingId` identifies the source context only —
 * `createRemediationAction` (lib/domain/remediation.ts) re-derives
 * tenant/organisation/engagement scope server-side from the Finding's
 * own row, never trusting these form fields as proof of anything beyond
 * "this is what the consultant selected."
 */
export async function createRemediationActionAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    findingId: formData.get("findingId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    priority: formData.get("priority") ?? "",
    dueDate: formData.get("dueDate") ?? "",
    assignOwnerToSelf: formData.get("assignOwnerToSelf") ?? undefined,
  };
  const detailPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.findingId === "string"
      ? findingDetailPath(raw.organisationId, raw.engagementId, raw.findingId)
      : "/organisations";

  const parsed = createRemediationActionSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      createRemediationAction(db, user.id, {
        findingId: parsed.data.findingId,
        title: parsed.data.title,
        description: parsed.data.description?.length ? parsed.data.description : null,
        priority: parsed.data.priority === "" || parsed.data.priority === undefined ? null : parsed.data.priority,
        dueDate: parsed.data.dueDate === "" || parsed.data.dueDate === undefined ? null : parsed.data.dueDate,
        assignOwnerToSelf: parsed.data.assignOwnerToSelf === "on",
      }),
    );
  } catch (err) {
    if (err instanceof InvalidRemediationInputError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to create a remediation action for this finding.";
    } else {
      console.error("createRemediationActionAction failed", err);
      errorMessage = "Something went wrong creating this remediation action. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(detailPath, "error", errorMessage));
  }

  revalidatePath(detailPath);
  redirect(withQueryFlag(detailPath, "saved", "1"));
}
