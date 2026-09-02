"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import * as applicability from "@/lib/domain/applicability";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

// Mirrors the Data Landscape / Master Data actions.ts shape (Slices D2/
// D3): Browser → Server Action → authenticate → authorize (inside the
// domain function) → validate → write → redirect back with `?saved=1`
// or `?error=...`.

function errorMessageFor(err: unknown): string {
  if (
    err instanceof applicability.InvalidApplicabilityInputError ||
    err instanceof applicability.EngagementScopeNotDraftError ||
    err instanceof applicability.PreviousScopeNotLockedError ||
    err instanceof applicability.MissingRationaleError
  ) {
    return err.message;
  }
  if (err instanceof NotFoundOrForbiddenError) return "You do not have access to manage this engagement's scope.";
  console.error("applicability-scope action failed", err);
  return "Something went wrong. Please try again.";
}

function indexPath(organisationId: string, engagementId: string) {
  return `/organisations/${organisationId}/engagements/${engagementId}/scope`;
}
function detailPath(organisationId: string, engagementId: string, scopeId: string) {
  return `${indexPath(organisationId, engagementId)}/${scopeId}`;
}

export async function createEngagementScopeAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const engagementId = String(formData.get("engagementId"));
  const user = await requireAuthenticatedUser();
  let newId: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) => applicability.createEngagementScope(db, user.id, { engagementId }));
    newId = result.id;
  } catch (err) {
    redirect(`${indexPath(organisationId, engagementId)}?error=${encodeURIComponent(errorMessageFor(err))}`);
  }
  revalidatePath(indexPath(organisationId, engagementId));
  redirect(`${detailPath(organisationId, engagementId, newId!)}?saved=1`);
}

export async function reviseEngagementScopeAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const engagementId = String(formData.get("engagementId"));
  const previousScopeId = String(formData.get("previousScopeId"));
  const user = await requireAuthenticatedUser();
  let newId: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) => applicability.reviseEngagementScope(db, user.id, { previousScopeId }));
    newId = result.id;
  } catch (err) {
    redirect(`${detailPath(organisationId, engagementId, previousScopeId)}?error=${encodeURIComponent(errorMessageFor(err))}`);
  }
  revalidatePath(indexPath(organisationId, engagementId));
  redirect(`${detailPath(organisationId, engagementId, newId!)}?saved=1`);
}

export async function lockEngagementScopeAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const engagementId = String(formData.get("engagementId"));
  const engagementScopeId = String(formData.get("engagementScopeId"));
  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => applicability.lockEngagementScope(db, user.id, { engagementScopeId }));
  } catch (err) {
    redirect(`${detailPath(organisationId, engagementId, engagementScopeId)}?error=${encodeURIComponent(errorMessageFor(err))}`);
  }
  revalidatePath(detailPath(organisationId, engagementId, engagementScopeId));
  redirect(`${detailPath(organisationId, engagementId, engagementScopeId)}?saved=1`);
}

const decisionSchema = z.enum(["undecided", "applicable", "not_applicable"]);

export async function updateControlApplicabilityAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const engagementId = String(formData.get("engagementId"));
  const engagementScopeId = String(formData.get("engagementScopeId"));
  const engagementScopeControlId = String(formData.get("engagementScopeControlId"));
  const parsedDecision = decisionSchema.safeParse(formData.get("decision"));
  if (!parsedDecision.success) {
    redirect(`${detailPath(organisationId, engagementId, engagementScopeId)}?error=${encodeURIComponent("Invalid decision.")}`);
  }
  const rationale = (formData.get("rationale") as string) || null;

  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => applicability.updateControlApplicability(db, user.id, { engagementScopeControlId, decision: parsedDecision.data, rationale }));
  } catch (err) {
    redirect(`${detailPath(organisationId, engagementId, engagementScopeId)}?error=${encodeURIComponent(errorMessageFor(err))}`);
  }
  revalidatePath(detailPath(organisationId, engagementId, engagementScopeId));
  redirect(`${detailPath(organisationId, engagementId, engagementScopeId)}?saved=1`);
}

const determinationSchema = z.object({
  scopeDescription: z.string().trim().min(1),
  decisionValue: z.enum(["applicable", "not_applicable"]),
  decisionRationale: z.string().trim().nullable(),
});

export async function createApplicabilityDeterminationAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const engagementId = String(formData.get("engagementId"));
  const engagementScopeId = String(formData.get("engagementScopeId"));
  const parsed = determinationSchema.safeParse({
    scopeDescription: formData.get("scopeDescription"),
    decisionValue: formData.get("decisionValue"),
    decisionRationale: (formData.get("decisionRationale") as string) || null,
  });
  if (!parsed.success) {
    redirect(`${detailPath(organisationId, engagementId, engagementScopeId)}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }
  const regulatoryReferenceIds = formData.getAll("regulatoryReferenceIds").map(String).filter(Boolean);

  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) =>
      applicability.createApplicabilityDetermination(db, user.id, { engagementScopeId, regulatoryReferenceIds, ...parsed.data }),
    );
  } catch (err) {
    redirect(`${detailPath(organisationId, engagementId, engagementScopeId)}?error=${encodeURIComponent(errorMessageFor(err))}`);
  }
  revalidatePath(detailPath(organisationId, engagementId, engagementScopeId));
  redirect(`${detailPath(organisationId, engagementId, engagementScopeId)}?saved=1`);
}
