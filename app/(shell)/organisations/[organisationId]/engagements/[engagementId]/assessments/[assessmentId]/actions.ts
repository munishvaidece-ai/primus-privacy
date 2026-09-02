"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import {
  updateAssessmentResponse,
  createControlTest,
  finalizeAssessment,
  AssessmentFinalizedError,
} from "@/lib/domain/assessments";
import {
  uploadEvidence,
  reviewEvidence,
  unlinkEvidence,
  InvalidFileError,
  ReviewRationaleRequiredError,
} from "@/lib/domain/evidence";
import { createRisk, NoActiveRiskScoringModelError, InvalidRiskInputError } from "@/lib/domain/risks";
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

const uploadEvidenceSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(200, "Title must be 200 characters or fewer."),
  evidenceType: z.enum([
    "policy_document",
    "screenshot",
    "system_configuration_export",
    "signed_agreement",
    "certificate",
    "other",
  ]),
  documentType: z
    .enum(["policy", "contract", "screenshot", "certificate", "report", "system_configuration", "other"])
    .optional(),
  linkTarget: z.string().min(1, "Select what this evidence supports."),
});

/**
 * Slice C2 (PHASE C2 instructions §7/§17): Browser → Server Action →
 * authenticate → authorize → validate metadata → create Document/
 * DocumentVersion → upload private object → verify checksum → create
 * Evidence/EvidenceLink → audit → return a safe result. The actual file
 * bytes never touch this function's own validation logic beyond size/
 * presence — `uploadEvidence` (lib/domain/evidence.ts) does the real
 * MIME/extension validation and is the only place the file's content
 * type is trusted server-side, never the browser's own claim alone.
 * `linkTarget` is a compact `"assessment_response:<id>"` /
 * `"control_test:<id>"` encoding from the workspace form's own select —
 * still only an identifier the domain function re-validates against the
 * database, never trusted as proof of scope by itself.
 */
export async function uploadEvidenceAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    assessmentId: formData.get("assessmentId"),
    title: formData.get("title"),
    evidenceType: formData.get("evidenceType"),
    documentType: formData.get("documentType") || undefined,
    linkTarget: formData.get("linkTarget"),
  };
  const basePath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.assessmentId === "string"
      ? basePathFor(raw.organisationId, raw.engagementId, raw.assessmentId)
      : "/organisations";
  const returnTo = safeReturnTo(formData.get("returnTo"), basePath);

  const parsed = uploadEvidenceSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(returnTo, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(withQueryFlag(returnTo, "error", "A file is required."));
  }

  const [subjectType, subjectId] = parsed.data.linkTarget.split(":");
  let linkTo: { type: "assessment_response"; assessmentResponseId: string } | { type: "control_test"; controlTestId: string };
  if (subjectType === "assessment_response" && subjectId) {
    linkTo = { type: "assessment_response", assessmentResponseId: subjectId };
  } else if (subjectType === "control_test" && subjectId) {
    linkTo = { type: "control_test", controlTestId: subjectId };
  } else {
    redirect(withQueryFlag(returnTo, "error", "Select what this evidence supports."));
  }

  let errorMessage: string | null = null;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await withRequestDb(user.id, (db) =>
      uploadEvidence(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        title: parsed.data.title,
        evidenceType: parsed.data.evidenceType,
        documentType: parsed.data.documentType,
        linkTo,
        file: { buffer, filename: file.name, mimeType: file.type || "application/octet-stream" },
      }),
    );
  } catch (err) {
    if (err instanceof InvalidFileError || err instanceof AssessmentFinalizedError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to upload evidence here.";
    } else {
      console.error("uploadEvidenceAction failed", err);
      errorMessage = "Something went wrong uploading this evidence. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(returnTo, "error", errorMessage));
  }

  revalidatePath(basePath);
  redirect(withQueryFlag(returnTo, "saved", "1"));
}

const reviewEvidenceSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  evidenceId: z.string().uuid(),
  reviewStatus: z.enum(["accepted", "rejected"]),
  reviewRationale: z.string().trim().max(4000).optional(),
});

/**
 * Slice C2 (PHASE C2 instructions §14/§24): accept/reject an Evidence
 * item. Rejecting without a rationale is refused server-side by
 * `reviewEvidence` itself (never merely a `required` HTML attribute) —
 * `ReviewRationaleRequiredError` is caught here and surfaced as a clean
 * message, the same pattern every other domain error in this file
 * already uses.
 */
export async function reviewEvidenceAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    assessmentId: formData.get("assessmentId"),
    evidenceId: formData.get("evidenceId"),
    reviewStatus: formData.get("reviewStatus"),
    reviewRationale: formData.get("reviewRationale") ?? undefined,
  };
  const basePath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.assessmentId === "string"
      ? basePathFor(raw.organisationId, raw.engagementId, raw.assessmentId)
      : "/organisations";
  const returnTo = safeReturnTo(formData.get("returnTo"), basePath);

  const parsed = reviewEvidenceSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(returnTo, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      reviewEvidence(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        evidenceId: parsed.data.evidenceId,
        reviewStatus: parsed.data.reviewStatus,
        reviewRationale: parsed.data.reviewRationale?.length ? parsed.data.reviewRationale : null,
      }),
    );
  } catch (err) {
    if (err instanceof ReviewRationaleRequiredError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to review this evidence.";
    } else {
      console.error("reviewEvidenceAction failed", err);
      errorMessage = "Something went wrong saving this review. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(returnTo, "error", errorMessage));
  }

  revalidatePath(basePath);
  redirect(withQueryFlag(returnTo, "saved", "1"));
}

const unlinkEvidenceSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  evidenceLinkId: z.string().uuid(),
});

/**
 * Slice C2 (PHASE C2 instructions §22): remove one EvidenceLink. Never
 * deletes the underlying Evidence/DocumentVersion row (see
 * `unlinkEvidence`'s own docstring) — only the relationship to this one
 * subject.
 */
export async function unlinkEvidenceAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    assessmentId: formData.get("assessmentId"),
    evidenceLinkId: formData.get("evidenceLinkId"),
  };
  const basePath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.assessmentId === "string"
      ? basePathFor(raw.organisationId, raw.engagementId, raw.assessmentId)
      : "/organisations";
  const returnTo = safeReturnTo(formData.get("returnTo"), basePath);

  const parsed = unlinkEvidenceSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(returnTo, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      unlinkEvidence(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        evidenceLinkId: parsed.data.evidenceLinkId,
      }),
    );
  } catch (err) {
    if (err instanceof AssessmentFinalizedError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to unlink this evidence.";
    } else {
      console.error("unlinkEvidenceAction failed", err);
      errorMessage = "Something went wrong unlinking this evidence. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(returnTo, "error", errorMessage));
  }

  revalidatePath(basePath);
  redirect(withQueryFlag(returnTo, "saved", "1"));
}

const RATING_ENUM = z.enum(["low", "medium", "high", "critical"]);

const createRiskSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  controlId: z.string().uuid(),
  title: z.string().trim().min(2, "Title must be at least 2 characters.").max(200, "Title must be 200 characters or fewer."),
  description: z.string().trim().max(4000).optional(),
  likelihood: z.coerce.number().int().min(1).max(5),
  impact: z.coerce.number().int().min(1).max(5),
  inherentRating: RATING_ENUM,
  residualLikelihood: z.coerce.number().int().min(1).max(5).optional().or(z.literal("")),
  residualImpact: z.coerce.number().int().min(1).max(5).optional().or(z.literal("")),
  residualRating: RATING_ENUM.optional().or(z.literal("")),
  assignOwnerToSelf: z.enum(["on"]).optional(),
});

/**
 * Slice C3 (PHASE C3 instructions §3/§15): Browser → Server Action →
 * authenticate → authorize → validate → domain function → PostgreSQL →
 * RLS → audit. `assessmentId`/`controlId` identify the source context
 * only — `createRisk` (lib/domain/risks.ts) re-derives tenant/
 * organisation/engagement scope and the active scoring model server-side,
 * never trusting these form fields as proof of anything beyond "this is
 * what the consultant selected."
 */
export async function createRiskAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    assessmentId: formData.get("assessmentId"),
    controlId: formData.get("controlId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    likelihood: formData.get("likelihood"),
    impact: formData.get("impact"),
    inherentRating: formData.get("inherentRating"),
    residualLikelihood: formData.get("residualLikelihood") ?? "",
    residualImpact: formData.get("residualImpact") ?? "",
    residualRating: formData.get("residualRating") ?? "",
    assignOwnerToSelf: formData.get("assignOwnerToSelf") ?? undefined,
  };
  const basePath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.assessmentId === "string"
      ? basePathFor(raw.organisationId, raw.engagementId, raw.assessmentId)
      : "/organisations";
  const returnTo = safeReturnTo(formData.get("returnTo"), basePath);

  const parsed = createRiskSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(returnTo, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      createRisk(db, user.id, {
        assessmentId: parsed.data.assessmentId,
        controlId: parsed.data.controlId,
        title: parsed.data.title,
        description: parsed.data.description?.length ? parsed.data.description : null,
        likelihood: parsed.data.likelihood,
        impact: parsed.data.impact,
        inherentRating: parsed.data.inherentRating,
        residualLikelihood: parsed.data.residualLikelihood === "" || parsed.data.residualLikelihood === undefined ? null : parsed.data.residualLikelihood,
        residualImpact: parsed.data.residualImpact === "" || parsed.data.residualImpact === undefined ? null : parsed.data.residualImpact,
        residualRating: parsed.data.residualRating === "" || parsed.data.residualRating === undefined ? null : parsed.data.residualRating,
        assignOwnerToSelf: parsed.data.assignOwnerToSelf === "on",
      }),
    );
  } catch (err) {
    if (err instanceof InvalidRiskInputError || err instanceof NoActiveRiskScoringModelError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to create a risk for this control.";
    } else {
      console.error("createRiskAction failed", err);
      errorMessage = "Something went wrong creating this risk. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(returnTo, "error", errorMessage));
  }

  revalidatePath(basePath);
  redirect(withQueryFlag(returnTo, "saved", "1"));
}

const finalizeAssessmentSchema = z.object({
  organisationId: z.string().uuid(),
  engagementId: z.string().uuid(),
  assessmentId: z.string().uuid(),
});

/**
 * Slice C7.3: the one, terminal `draft → finalized` transition. Browser
 * → Server Action → authenticate → `finalizeAssessment` (lib/domain/
 * assessments.ts) re-derives the Assessment's own authoritative
 * Engagement/Organisation and authorizes against the caller's real
 * `assessment.finalize` permission there — never trusting this form's
 * own `organisationId`/`engagementId` fields as proof, the same
 * discipline every other action in this file already follows. A plain
 * `<form>` submit with a native browser confirm prompt (instructions
 * §16: "a minimal confirmation mechanism," not a multi-step approval
 * flow) is the only client-side gate; the server never trusts it.
 */
export async function finalizeAssessmentAction(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser();

  const raw = {
    organisationId: formData.get("organisationId"),
    engagementId: formData.get("engagementId"),
    assessmentId: formData.get("assessmentId"),
  };
  const basePath =
    typeof raw.organisationId === "string" && typeof raw.engagementId === "string" && typeof raw.assessmentId === "string"
      ? basePathFor(raw.organisationId, raw.engagementId, raw.assessmentId)
      : "/organisations";

  const parsed = finalizeAssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(withQueryFlag(basePath, "error", parsed.error.issues[0]?.message ?? "Invalid input."));
  }

  let errorMessage: string | null = null;
  try {
    await withRequestDb(user.id, (db) =>
      finalizeAssessment(db, user.id, {
        organisationId: parsed.data.organisationId,
        engagementId: parsed.data.engagementId,
        assessmentId: parsed.data.assessmentId,
      }),
    );
  } catch (err) {
    if (err instanceof AssessmentFinalizedError) {
      errorMessage = err.message;
    } else if (err instanceof NotFoundOrForbiddenError) {
      errorMessage = "You do not have access to finalize this assessment.";
    } else {
      console.error("finalizeAssessmentAction failed", err);
      errorMessage = "Something went wrong finalizing this assessment. Please try again.";
    }
  }

  if (errorMessage) {
    redirect(withQueryFlag(basePath, "error", errorMessage));
  }

  revalidatePath(basePath);
  redirect(withQueryFlag(basePath, "saved", "1"));
}
