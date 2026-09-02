"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import {
  updateControl,
  deleteControl,
  associateControlRequirement,
  dissociateControlRequirement,
  ControlLibraryVersionNotDraftError,
  DuplicateControlCodeError,
  CrossTenantAssociationError,
  InvalidControlLibraryInputError,
} from "@/lib/domain/control-library";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

const updateControlSchema = z.object({
  controlLibraryVersionId: z.string().uuid(),
  controlId: z.string().uuid(),
  code: z.string().trim().min(1, "Control code is required.").max(50, "Control code must be 50 characters or fewer."),
  title: z.string().trim().min(1, "Control title is required.").max(300, "Control title must be 300 characters or fewer."),
  description: z.string().trim().max(4000, "Description must be 4000 characters or fewer.").optional(),
  controlType: z.enum(["preventive", "detective", "corrective"]),
});

function controlPath(versionId: string, controlId: string): string {
  return `/methodology/control-library/${versionId}/controls/${controlId}`;
}

export async function updateControlAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    controlLibraryVersionId: formData.get("controlLibraryVersionId"),
    controlId: formData.get("controlId"),
    code: formData.get("code"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    controlType: formData.get("controlType"),
  };
  const editPath =
    typeof raw.controlLibraryVersionId === "string" && typeof raw.controlId === "string"
      ? controlPath(raw.controlLibraryVersionId, raw.controlId)
      : "/methodology/control-library";

  const parsed = updateControlSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`${editPath}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      updateControl(db, user.id, {
        controlId: parsed.data.controlId,
        code: parsed.data.code,
        title: parsed.data.title,
        description: parsed.data.description?.trim() ? parsed.data.description.trim() : null,
        controlType: parsed.data.controlType,
      }),
    );
  } catch (err) {
    if (err instanceof InvalidControlLibraryInputError || err instanceof DuplicateControlCodeError || err instanceof ControlLibraryVersionNotDraftError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to edit this control.";
    } else {
      console.error("updateControlAction failed", err);
      errorMessage = "Something went wrong saving this control. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${editPath}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath(`/methodology/control-library/${parsed.data.controlLibraryVersionId}`);
  revalidatePath(editPath);
  redirect(`${editPath}?saved=1`);
}

const deleteControlSchema = z.object({
  controlLibraryVersionId: z.string().uuid(),
  controlId: z.string().uuid(),
});

export async function deleteControlAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const parsed = deleteControlSchema.safeParse({
    controlLibraryVersionId: formData.get("controlLibraryVersionId"),
    controlId: formData.get("controlId"),
  });
  if (!parsed.success) redirect("/methodology/control-library");

  const versionPath = `/methodology/control-library/${parsed.data.controlLibraryVersionId}`;
  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) => deleteControl(db, user.id, { controlId: parsed.data.controlId }));
  } catch (err) {
    if (err instanceof ControlLibraryVersionNotDraftError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to delete this control.";
    } else {
      console.error("deleteControlAction failed", err);
      errorMessage = "Something went wrong deleting this control. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${controlPath(parsed.data.controlLibraryVersionId, parsed.data.controlId)}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath(versionPath);
  redirect(`${versionPath}?saved=1`);
}

const associateSchema = z.object({
  controlLibraryVersionId: z.string().uuid(),
  controlId: z.string().uuid(),
  requirementId: z.string().uuid(),
});

export async function associateRequirementAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    controlLibraryVersionId: formData.get("controlLibraryVersionId"),
    controlId: formData.get("controlId"),
    requirementId: formData.get("requirementId"),
  };
  const editPath =
    typeof raw.controlLibraryVersionId === "string" && typeof raw.controlId === "string"
      ? controlPath(raw.controlLibraryVersionId, raw.controlId)
      : "/methodology/control-library";

  const parsed = associateSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`${editPath}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Select a requirement.")}`);
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) => associateControlRequirement(db, user.id, { controlId: parsed.data.controlId, requirementId: parsed.data.requirementId }));
  } catch (err) {
    if (err instanceof ControlLibraryVersionNotDraftError || err instanceof CrossTenantAssociationError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to associate this control with a requirement.";
    } else {
      console.error("associateRequirementAction failed", err);
      errorMessage = "Something went wrong associating this requirement. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${editPath}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath(editPath);
  redirect(`${editPath}?saved=1`);
}

export async function dissociateRequirementAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const parsed = associateSchema.safeParse({
    controlLibraryVersionId: formData.get("controlLibraryVersionId"),
    controlId: formData.get("controlId"),
    requirementId: formData.get("requirementId"),
  });
  if (!parsed.success) redirect("/methodology/control-library");

  const editPath = controlPath(parsed.data.controlLibraryVersionId, parsed.data.controlId);
  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) => dissociateControlRequirement(db, user.id, { controlId: parsed.data.controlId, requirementId: parsed.data.requirementId }));
  } catch (err) {
    if (err instanceof ControlLibraryVersionNotDraftError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to remove this association.";
    } else {
      console.error("dissociateRequirementAction failed", err);
      errorMessage = "Something went wrong removing this association. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${editPath}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath(editPath);
  redirect(`${editPath}?saved=1`);
}
