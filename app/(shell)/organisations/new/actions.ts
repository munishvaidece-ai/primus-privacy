"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { createOrganisation, DuplicateOrganisationError } from "@/lib/domain/organisations";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

const createOrganisationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organisation name must be at least 2 characters.")
    .max(200, "Organisation name must be 200 characters or fewer."),
});

/**
 * Slice B1's write path (PHASE B instructions §6-§10) — the same shape
 * as Slice A1's updateAssessmentResponseAction: Browser → Server Action
 * → authentication → authorization → validation → database → audit →
 * redirect. The browser supplies only `name`; it never supplies (and
 * this action never reads) a tenant id from form data — the tenant is
 * always derived server-side, inside `createOrganisation`, from the
 * authenticated user's own session (instructions §8).
 */
export async function createOrganisationAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const parsed = createOrganisationSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    redirect(`/organisations/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let newOrganisationId: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) => createOrganisation(db, user.id, { name: parsed.data.name }));
    newOrganisationId = result.id;
  } catch (err) {
    if (err instanceof DuplicateOrganisationError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have permission to create an organisation.";
    } else {
      // PHASE B instructions §13: never expose raw SQL/implementation
      // details to users — full detail goes to the server log only.
      console.error("createOrganisationAction failed", err);
      errorMessage = "Something went wrong creating this organisation. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`/organisations/new?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath("/organisations");
  // `created=1` + the name the caller themselves just typed (not
  // sensitive — they already know it) let the detail page show an
  // honest confirmation instead of a bare not-found if this exact
  // consultant cannot yet read the row back — see
  // lib/domain/organisations.ts's createOrganisation and the detail
  // page for why a bare TenantMembership, sufficient to create an
  // organisation, is not sufficient to view one under the existing,
  // unchanged authorization model.
  redirect(`/organisations/${newOrganisationId}?created=1&name=${encodeURIComponent(parsed.data.name)}`);
}
