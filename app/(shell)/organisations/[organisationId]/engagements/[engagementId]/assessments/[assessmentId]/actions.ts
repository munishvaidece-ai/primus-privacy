"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import {
  updateAssessmentResponse,
  createControlTest,
  AssessmentFinalizedError,
} from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

function basePathFor(organisationId: string, engagementId: string, assessmentId: string): string {
  return `/organisations/${organisationId}/engagements/${engagementId}/assessments/${assessmentId}`;
}

/**
 * `returnTo` is browser-supplied form data (the workspace page's own
 * currently-selected control + search/filter query string, so a save
 * lands back where the consultant was — instructions §3's "Save. Move
 * between Controls."), never trusted as an arbitrary redirect target:
 * it is only ever used if it is exactly this same assessment's own
 * workspace path (open-redirect hygiene). This is not itself a security
 * *boundary* — the destination page re-authorizes independently of how
 * it was reached, same as every other page in this application.
 */
function safeReturnTo(returnTo: FormDataEntryValue | null, fallback: string): string {
  return typeof returnTo === "string" && returnTo.startsWith(fallback) ? returnTo : fallback;
}

function withQueryFlag(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

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
 * §14), unchanged in its core authorization/validation shape by Slice
 * C1 — only the redirect target now preserves the workspace's currently
 * selected control and search/filter state (`returnTo`, see above)
 * instead of always bouncing back to the bare assessment URL. The
 * browser never writes to Postgres directly. Every field this action
 * reads from `formData` is used only to (a) find the workspace page to
 * redirect back to, and (b) identify *which* AssessmentControl is being
 * responded to; the actual authorization decision (which engagement/
 * organisation/tenant this write is allowed to touch) is re-derived
 * server-side from the AssessmentControl's own database row inside
 * `updateAssessmentResponse` (lib/domain/assessments.ts), never trusted
 * from these form fields — instructions §17: "Never trust browser-
 * supplied tenant_id/organisation_id/engagement_id."
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
  const basePath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.assessmentId === "string"
      ? basePathFor(raw.organisationId, raw.engagementId, raw.assessmentId)
      : "/organisations";
  const returnTo = safeReturnTo(formData.get("returnTo"), basePath);

  const parsed = updateResponseSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(basePath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
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
    redirect(withQueryFlag(returnTo, "error", errorMessage));
  }

  revalidatePath(basePath);
  redirect(withQueryFlag(returnTo, "saved", "1"));
}

const createControlTestSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  controlId: z.string().uuid(),
  methodology: z.string().trim().min(3, "Methodology must be at least 3 characters.").max(4000, "Methodology must be 4000 characters or fewer."),
  sampleDescription: z.string().trim().max(4000).optional(),
  result: z.enum(["pass", "fail", "exception_noted"]),
  testedAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD.")
    .optional()
    .or(z.literal("")),
});

/**
 * Slice C1 (PHASE C instructions §13/§17): the same Browser → Server
 * Action → authenticate → authorize → validate → domain function →
 * PostgreSQL → RLS → audit shape as `updateAssessmentResponseAction`
 * above. `controlId`/`assessmentId` identify what to test; the actual
 * scope (tenant/organisation/engagement, and whether this control is
 * genuinely in scope for this assessment) is re-derived server-side by
 * `createControlTest`, never trusted from these fields.
 */
export async function createControlTestAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    assessmentId: formData.get("assessmentId"),
    controlId: formData.get("controlId"),
    methodology: formData.get("methodology"),
    sampleDescription: formData.get("sampleDescription") ?? undefined,
    result: formData.get("result"),
    testedAt: formData.get("testedAt") ?? "",
  };
  const basePath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.assessmentId === "string"
      ? basePathFor(raw.organisationId, raw.engagementId, raw.assessmentId)
      : "/organisations";
  const returnTo = safeReturnTo(formData.get("returnTo"), basePath);

  const parsed = createControlTestSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(basePath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      createControlTest(db, user.id, {
        assessmentId: parsed.data.assessmentId,
        controlId: parsed.data.controlId,
        methodology: parsed.data.methodology,
        sampleDescription: parsed.data.sampleDescription?.length ? parsed.data.sampleDescription : null,
        result: parsed.data.result,
        testedAt: parsed.data.testedAt?.length ? parsed.data.testedAt : null,
      }),
    );
  } catch (err) {
    if (err instanceof AssessmentFinalizedError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to record a control test for this control.";
    } else {
      console.error("createControlTestAction failed", err);
      errorMessage = "Something went wrong recording this control test. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(returnTo, "error", errorMessage));
  }

  revalidatePath(basePath);
  redirect(withQueryFlag(returnTo, "saved", "1"));
}
