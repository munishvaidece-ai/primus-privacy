"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { createAssessment, InvalidAssessmentInputError, NoControlLibraryPinnedError } from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

const createAssessmentSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  assessmentType: z.enum(["control_readiness", "annual", "dpia", "sdf_screening", "third_party"]),
  periodLabel: z.string().trim().min(1, "Period is required.").max(100, "Period must be 100 characters or fewer."),
});

/**
 * Slice C7.1 (the C7 review's own P0 finding, instructions §4): Browser
 * → Server Action → authenticate → authorize (Engagement access) →
 * validate → load the authoritative Engagement → derive tenant/
 * organisation/pinned-library server-side → create Assessment →
 * populate AssessmentControls → audit (existing triggers) → redirect to
 * the new Assessment workspace. This is the ONLY way an Assessment is
 * ever created in this application — see `createAssessment`
 * (lib/domain/assessments.ts) for the full reasoning behind every
 * design choice here (population mechanism, authorization rule,
 * transactionality, no previous-assessment field, no duplicate check).
 */
export async function createAssessmentAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    assessmentType: formData.get("assessmentType"),
    periodLabel: formData.get("periodLabel"),
  };
  const newPath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string"
      ? `/organisations/${raw.organisationId}/engagements/${raw.engagementId}/assessments/new`
      : "/organisations";

  const parsed = createAssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`${newPath}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  let newAssessmentId: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) =>
      createAssessment(db, user.id, {
        engagementId: parsed.data.engagementId,
        assessmentType: parsed.data.assessmentType,
        periodLabel: parsed.data.periodLabel,
      }),
    );
    newAssessmentId = result.id;
  } catch (err) {
    if (err instanceof InvalidAssessmentInputError || err instanceof NoControlLibraryPinnedError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to create an assessment for this engagement.";
    } else {
      // instructions §15/§20: never expose database internals to users —
      // full detail goes to the server log only.
      console.error("createAssessmentAction failed", err);
      errorMessage = "Something went wrong creating this assessment. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(`${newPath}?error=${encodeURIComponent(errorMessage)}`);
  }

  const engagementPath = `/organisations/${parsed.data.organisationId}/engagements/${parsed.data.engagementId}`;
  revalidatePath(`${engagementPath}/assessments`);
  revalidatePath(engagementPath);
  redirect(`${engagementPath}/assessments/${newAssessmentId}`);
}
