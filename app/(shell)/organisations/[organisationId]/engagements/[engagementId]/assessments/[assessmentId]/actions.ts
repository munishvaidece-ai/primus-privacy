"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { updateAssessmentResponse, AssessmentFinalizedError } from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

const updateResponseSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  assessmentControlId: z.string().uuid(),
  effectivenessRating: z.enum([
    "not_assessed",
    "not_applicable",
    "not_implemented",
    "partially_implemented",
    "implemented",
  ]),
  decisionRationale: z.string().trim().max(4000).optional(),
});

/**
 * The Slice A1 vertical-slice Server Action (PHASE A instructions §13/
 * §14) — the browser never writes to Postgres directly. Every field
 * this action reads from `formData` is used only to (a) find the
 * assessment page to redirect back to, and (b) identify *which*
 * AssessmentControl is being responded to; the actual authorization
 * decision (which engagement/organisation/tenant this write is allowed
 * to touch) is re-derived server-side from the AssessmentControl's own
 * database row inside `updateAssessmentResponse`
 * (lib/domain/assessments.ts), never trusted from these form fields —
 * instructions §14: "Do not trust a tenant_id/organisation_id/
 * engagement_id supplied by the browser."
 */
export async function updateAssessmentResponseAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    assessmentId: formData.get("assessmentId"),
    assessmentControlId: formData.get("assessmentControlId"),
    effectivenessRating: formData.get("effectivenessRating"),
    decisionRationale: formData.get("decisionRationale") ?? undefined,
  };
  const basePath = `/organisations/${raw.organisationId}/engagements/${raw.engagementId}/assessments/${raw.assessmentId}`;

  const parsed = updateResponseSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`${basePath}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      updateAssessmentResponse(db, user.id, {
        assessmentControlId: parsed.data.assessmentControlId,
        effectivenessRating: parsed.data.effectivenessRating,
        decisionRationale: parsed.data.decisionRationale?.length ? parsed.data.decisionRationale : null,
      }),
    );
  } catch (err) {
    if (err instanceof AssessmentFinalizedError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to update this response.";
    } else {
      // instructions §17: never expose database internals to users —
      // full detail goes to the server log only.
      console.error("updateAssessmentResponseAction failed", err);
      errorMessage = "Something went wrong saving your response. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${basePath}?error=${encodeURIComponent(errorMessage)}`);
  }

  revalidatePath(basePath);
  redirect(basePath);
}
