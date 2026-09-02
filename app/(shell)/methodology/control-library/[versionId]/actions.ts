"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import {
  publishControlLibraryVersion,
  cloneControlLibraryVersion,
  createControl,
  ControlLibraryVersionNotDraftError,
  ControlLibraryVersionNotPublishedError,
  DuplicateVersionLabelError,
  DuplicateControlCodeError,
  InvalidControlLibraryInputError,
} from "@/lib/domain/control-library";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

const publishSchema = z.object({ versionId: z.string().uuid() });

/**
 * Slice D1 (instructions §6): Browser → Server Action → authenticate →
 * authorize/re-verify draft/validate/publish transactionally, all
 * inside `publishControlLibraryVersion` itself → redirect back to the
 * now-published version's own detail page.
 */
export async function publishControlLibraryVersionAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();
  const parsed = publishSchema.safeParse({ versionId: formData.get("versionId") });
  if (!parsed.success) redirect("/methodology/control-library");

  const versionPath = `/methodology/control-library/${parsed.data.versionId}`;
  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) => publishControlLibraryVersion(db, user.id, { versionId: parsed.data.versionId }));
  } catch (err) {
    if (err instanceof ControlLibraryVersionNotDraftError || err instanceof InvalidControlLibraryInputError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to publish this control library version.";
    } else {
      console.error("publishControlLibraryVersionAction failed", err);
      errorMessage = "Something went wrong publishing this version. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${versionPath}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath("/methodology/control-library");
  revalidatePath(versionPath);
  redirect(`${versionPath}?saved=1`);
}

const cloneSchema = z.object({
  sourceVersionId: z.string().uuid(),
  newVersionLabel: z.string().trim().min(1, "Version label is required.").max(200, "Version label must be 200 characters or fewer."),
});

/**
 * Slice D1 (instructions §4): "Create a new version from an existing
 * published version" — Browser → Server Action → authenticate →
 * `cloneControlLibraryVersion` (its own authorization/validation/copy)
 * → redirect to the new draft's own detail page.
 */
export async function cloneControlLibraryVersionAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = { sourceVersionId: formData.get("sourceVersionId"), newVersionLabel: formData.get("newVersionLabel") };
  const sourcePath = typeof raw.sourceVersionId === "string" ? `/methodology/control-library/${raw.sourceVersionId}` : "/methodology/control-library";

  const parsed = cloneSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`${sourcePath}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let newVersionId: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) =>
      cloneControlLibraryVersion(db, user.id, { sourceVersionId: parsed.data.sourceVersionId, newVersionLabel: parsed.data.newVersionLabel }),
    );
    newVersionId = result.id;
  } catch (err) {
    if (
      err instanceof ControlLibraryVersionNotPublishedError ||
      err instanceof DuplicateVersionLabelError ||
      err instanceof InvalidControlLibraryInputError
    ) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to create a new control library version.";
    } else {
      console.error("cloneControlLibraryVersionAction failed", err);
      errorMessage = "Something went wrong creating the new version. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${sourcePath}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath("/methodology/control-library");
  redirect(`/methodology/control-library/${newVersionId}`);
}

const createControlSchema = z.object({
  controlLibraryVersionId: z.string().uuid(),
  code: z.string().trim().min(1, "Control code is required.").max(50, "Control code must be 50 characters or fewer."),
  title: z.string().trim().min(1, "Control title is required.").max(300, "Control title must be 300 characters or fewer."),
  description: z.string().trim().max(4000, "Description must be 4000 characters or fewer.").optional(),
  controlType: z.enum(["preventive", "detective", "corrective"]),
});

export async function createControlAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    controlLibraryVersionId: formData.get("controlLibraryVersionId"),
    code: formData.get("code"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    controlType: formData.get("controlType"),
  };
  const newPath =
    typeof raw.controlLibraryVersionId === "string"
      ? `/methodology/control-library/${raw.controlLibraryVersionId}/controls/new`
      : "/methodology/control-library";

  const parsed = createControlSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`${newPath}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      createControl(db, user.id, {
        controlLibraryVersionId: parsed.data.controlLibraryVersionId,
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
      errorMessage = "You do not have access to add controls to this version.";
    } else {
      console.error("createControlAction failed", err);
      errorMessage = "Something went wrong creating this control. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${newPath}?error=${encodeURIComponent(errorMessage)}`);
  }

  const versionPath = `/methodology/control-library/${parsed.data.controlLibraryVersionId}`;
  revalidatePath(versionPath);
  redirect(`${versionPath}?saved=1`);
}
