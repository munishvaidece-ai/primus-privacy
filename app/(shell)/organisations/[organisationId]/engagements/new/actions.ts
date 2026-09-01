"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { createEngagement, DuplicateEngagementError, InvalidMethodologyError } from "@/lib/domain/engagements";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.");

const createEngagementSchema = z
  .object({
    organisationId: z.string().uuid(),
    name: z.string().trim().min(2, "Engagement name must be at least 2 characters.").max(200, "Engagement name must be 200 characters or fewer."),
    engagementType: z.enum([
      "readiness",
      "annual_assessment",
      "dpia_programme",
      "third_party_assessment",
      "continuous_compliance",
    ]),
    periodStart: dateString.optional().or(z.literal("")),
    periodEnd: dateString.optional().or(z.literal("")),
    controlLibraryVersionId: z.string().uuid().optional().or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    if (val.periodStart && val.periodEnd && val.periodEnd < val.periodStart) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Period end cannot be before period start.", path: ["periodEnd"] });
    }
  });

/**
 * Slice B2 (PHASE B2 instructions §7/§11): Browser → Server Action →
 * authenticate → authorize → validate → database transaction → audit →
 * redirect. `organisationId` comes from the route (a hidden form field
 * mirroring it, not a free-text browser input) — `createEngagement`
 * still independently re-derives the organisation's own `tenant_id`
 * from its own database row and re-checks access, never trusting this
 * value's mere presence as proof of authorization (see that function's
 * own docstring).
 */
export async function createEngagementAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    name: formData.get("name"),
    engagementType: formData.get("engagementType"),
    periodStart: formData.get("periodStart") ?? "",
    periodEnd: formData.get("periodEnd") ?? "",
    controlLibraryVersionId: formData.get("controlLibraryVersionId") ?? "",
  };
  const organisationIdForRedirect = typeof raw.organisationId === "string" ? raw.organisationId : "";
  const newPath = `/organisations/${organisationIdForRedirect}/engagements/new`;

  const parsed = createEngagementSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`${newPath}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let newEngagementId: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) =>
      createEngagement(db, user.id, {
        organisationId: parsed.data.organisationId,
        name: parsed.data.name,
        engagementType: parsed.data.engagementType,
        periodStart: parsed.data.periodStart || null,
        periodEnd: parsed.data.periodEnd || null,
        controlLibraryVersionId: parsed.data.controlLibraryVersionId || null,
      }),
    );
    newEngagementId = result.id;
  } catch (err) {
    if (err instanceof DuplicateEngagementError || err instanceof InvalidMethodologyError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have permission to create an engagement for this organisation.";
    } else {
      // instructions §20: never expose database internals to users —
      // full detail goes to the server log only.
      console.error("createEngagementAction failed", err);
      errorMessage = "Something went wrong creating this engagement. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${newPath}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath(`/organisations/${parsed.data.organisationId}`);
  redirect(`/organisations/${parsed.data.organisationId}/engagements/${newEngagementId}`);
}
