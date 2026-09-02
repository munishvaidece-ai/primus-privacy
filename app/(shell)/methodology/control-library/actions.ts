"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { createControlLibraryVersion, DuplicateVersionLabelError, InvalidControlLibraryInputError } from "@/lib/domain/control-library";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

const createVersionSchema = z.object({
  versionLabel: z.string().trim().min(1, "Version label is required.").max(200, "Version label must be 200 characters or fewer."),
});

/**
 * Slice D1 (instructions §4): Browser → Server Action → authenticate →
 * authorize (`methodology.manage`, inside `createControlLibraryVersion`
 * itself) → validate → create a new draft ControlLibraryVersion →
 * audit (existing migration 0007 trigger) → redirect to its detail
 * page. Mirrors `createAssessmentAction`'s exact shape.
 */
export async function createControlLibraryVersionAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const parsed = createVersionSchema.safeParse({ versionLabel: formData.get("versionLabel") });
  if (!parsed.success) {
    redirect(`/methodology/control-library/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let newVersionId: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) => createControlLibraryVersion(db, user.id, { versionLabel: parsed.data.versionLabel }));
    newVersionId = result.id;
  } catch (err) {
    if (err instanceof InvalidControlLibraryInputError || err instanceof DuplicateVersionLabelError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to author the control library.";
    } else {
      console.error("createControlLibraryVersionAction failed", err);
      errorMessage = "Something went wrong creating this control library version. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`/methodology/control-library/new?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath("/methodology/control-library");
  redirect(`/methodology/control-library/${newVersionId}`);
}
