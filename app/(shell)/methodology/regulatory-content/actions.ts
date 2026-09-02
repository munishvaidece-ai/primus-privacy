"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { createRegulatoryReference, createRequirement, InvalidControlLibraryInputError } from "@/lib/domain/control-library";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

const PAGE_PATH = "/methodology/regulatory-content";

const createReferenceSchema = z.object({
  frameworkName: z.string().trim().min(1, "Framework name is required.").max(300, "Framework name must be 300 characters or fewer."),
  citation: z.string().trim().min(1, "Citation is required.").max(300, "Citation must be 300 characters or fewer."),
  title: z.string().trim().min(1, "Title is required.").max(500, "Title must be 500 characters or fewer."),
  version: z.string().trim().max(100, "Version must be 100 characters or fewer.").optional(),
});

export async function createRegulatoryReferenceAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const parsed = createReferenceSchema.safeParse({
    frameworkName: formData.get("frameworkName"),
    citation: formData.get("citation"),
    title: formData.get("title"),
    version: formData.get("version") || undefined,
  });
  if (!parsed.success) {
    redirect(`${PAGE_PATH}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      createRegulatoryReference(db, user.id, {
        frameworkName: parsed.data.frameworkName,
        citation: parsed.data.citation,
        title: parsed.data.title,
        version: parsed.data.version?.trim() ? parsed.data.version.trim() : null,
      }),
    );
  } catch (err) {
    if (err instanceof InvalidControlLibraryInputError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to author regulatory content.";
    } else {
      console.error("createRegulatoryReferenceAction failed", err);
      errorMessage = "Something went wrong creating this regulatory reference. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${PAGE_PATH}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?saved=1`);
}

const createRequirementSchema = z.object({
  primaryRegulatoryReferenceId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required.").max(500, "Title must be 500 characters or fewer."),
  description: z.string().trim().max(4000, "Description must be 4000 characters or fewer.").optional(),
});

export async function createRequirementAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const parsed = createRequirementSchema.safeParse({
    primaryRegulatoryReferenceId: formData.get("primaryRegulatoryReferenceId"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    redirect(`${PAGE_PATH}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      createRequirement(db, user.id, {
        primaryRegulatoryReferenceId: parsed.data.primaryRegulatoryReferenceId,
        title: parsed.data.title,
        description: parsed.data.description?.trim() ? parsed.data.description.trim() : null,
      }),
    );
  } catch (err) {
    if (err instanceof InvalidControlLibraryInputError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to author regulatory content, or the selected reference is invalid.";
    } else {
      console.error("createRequirementAction failed", err);
      errorMessage = "Something went wrong creating this requirement. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${PAGE_PATH}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath(PAGE_PATH);
  redirect(`${PAGE_PATH}?saved=1`);
}
