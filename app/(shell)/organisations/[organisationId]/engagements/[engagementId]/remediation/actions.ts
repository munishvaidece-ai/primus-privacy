"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { updateRemediationAction, InvalidRemediationInputError } from "@/lib/domain/remediation";
import { uploadEvidence, InvalidFileError } from "@/lib/domain/evidence";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

function remediationDetailPath(organisationId: string, engagementId: string, remediationActionId: string): string {
  return `/organisations/${organisationId}/engagements/${engagementId}/remediation/${remediationActionId}`;
}

function withQueryFlag(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

const updateRemediationActionSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  remediationActionId: z.string().uuid(),
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(200, "Title must be 200 characters or fewer."),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().or(z.literal("")),
  status: z.enum(["open", "in_progress", "evidence_submitted", "validated", "closed"]),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.")
    .optional()
    .or(z.literal("")),
  ownerAction: z.enum(["keep", "assign_self", "unassign"]),
});

/**
 * Slice C5 (PHASE C5 instructions §24/§28): the RemediationAction edit
 * form — title/description/priority/status/due_date/owner, the exact
 * fields the approved `remediation_actions` schema actually supports.
 * `status` accepts any of the five existing values with no enforced
 * transition order (see `updateRemediationAction`, lib/domain/
 * remediation.ts, for why — DECISIONS.md R-71).
 */
export async function updateRemediationActionAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    remediationActionId: formData.get("remediationActionId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    priority: formData.get("priority") ?? "",
    status: formData.get("status"),
    dueDate: formData.get("dueDate") ?? "",
    ownerAction: formData.get("ownerAction") ?? "keep",
  };
  const detailPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.remediationActionId === "string"
      ? remediationDetailPath(raw.organisationId, raw.engagementId, raw.remediationActionId)
      : "/organisations";

  const parsed = updateRemediationActionSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      updateRemediationAction(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        remediationActionId: parsed.data.remediationActionId,
        title: parsed.data.title,
        description: parsed.data.description?.length ? parsed.data.description : null,
        priority: parsed.data.priority === "" || parsed.data.priority === undefined ? null : parsed.data.priority,
        status: parsed.data.status,
        dueDate: parsed.data.dueDate === "" || parsed.data.dueDate === undefined ? null : parsed.data.dueDate,
        ownerAction: parsed.data.ownerAction,
      }),
    );
  } catch (err) {
    if (err instanceof InvalidRemediationInputError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to update this remediation action.";
    } else {
      console.error("updateRemediationActionAction failed", err);
      errorMessage = "Something went wrong updating this remediation action. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(detailPath, "error", errorMessage));
  }

  revalidatePath(detailPath);
  redirect(withQueryFlag(detailPath, "saved", "1"));
}

const uploadRemediationEvidenceSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  remediationActionId: z.string().uuid(),
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(200, "Title must be 200 characters or fewer."),
});

/**
 * Slice C5 (PHASE C5 instructions §22): submits Evidence directly
 * against a RemediationAction, using the EXISTING Evidence/EvidenceLink
 * architecture (Slice C2's `uploadEvidence`, extended this slice to
 * accept a `remediation_action` link target — lib/domain/evidence.ts)
 * — never a second attachment system, never a duplicated storage
 * field. `evidenceType` is fixed to `"other"` here (this form doesn't
 * ask the consultant to classify remediation evidence into the same
 * taxonomy Assessment evidence uses — e.g. "policy_document" doesn't
 * fit "screenshot of the fix" well) rather than inventing a new,
 * remediation-specific evidence-type enum (instructions §22's own "do
 * not create another attachment system").
 */
export async function uploadRemediationEvidenceAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    remediationActionId: formData.get("remediationActionId"),
    title: formData.get("title"),
  };
  const detailPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.remediationActionId === "string"
      ? remediationDetailPath(raw.organisationId, raw.engagementId, raw.remediationActionId)
      : "/organisations";

  const parsed = uploadRemediationEvidenceSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(detailPath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(withQueryFlag(detailPath, "error", "A file is required."));
  }

  let errorMessage: string | null = null;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await withRequestDb(user.id, (db) =>
      uploadEvidence(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        title: parsed.data.title,
        evidenceType: "other",
        linkTo: { type: "remediation_action", remediationActionId: parsed.data.remediationActionId },
        file: { buffer, filename: file.name, mimeType: file.type || "application/octet-stream" },
      }),
    );
  } catch (err) {
    if (err instanceof InvalidFileError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to upload evidence here.";
    } else {
      console.error("uploadRemediationEvidenceAction failed", err);
      errorMessage = "Something went wrong uploading this evidence. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(detailPath, "error", errorMessage));
  }

  revalidatePath(detailPath);
  redirect(withQueryFlag(detailPath, "saved", "1"));
}
