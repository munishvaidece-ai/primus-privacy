"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb, type RequestDb } from "@/lib/db/request-client";
import * as pa from "@/lib/domain/processing-activities";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

// Mirrors the master-data actions.ts shape (Slice D2): Browser →
// Server Action → authenticate → authorize (inside the domain
// function) → validate → write → redirect back to the calling page
// with `?saved=1` or `?error=...`.

function errorMessageFor(err: unknown): string {
  if (
    err instanceof pa.InvalidProcessingActivityInputError ||
    err instanceof pa.CrossScopeReferenceError ||
    err instanceof pa.DuplicateLinkError
  ) {
    return err.message;
  }
  if (err instanceof NotFoundOrForbiddenError) return "You do not have access to manage this engagement's Data Landscape.";
  console.error("data-landscape action failed", err);
  return "Something went wrong. Please try again.";
}

function listPath(organisationId: string, engagementId: string) {
  return `/organisations/${organisationId}/engagements/${engagementId}/data-landscape`;
}

function detailPath(organisationId: string, engagementId: string, processingActivityId: string) {
  return `${listPath(organisationId, engagementId)}/${processingActivityId}`;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().nullable(),
  businessUnitId: z.string().trim().nullable(),
  ownerUserId: z.string().trim().nullable(),
  lawfulBasis: z.string().trim().nullable(),
});

export async function createProcessingActivityAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const engagementId = String(formData.get("engagementId"));
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    description: (formData.get("description") as string) || null,
    businessUnitId: (formData.get("businessUnitId") as string) || null,
    ownerUserId: (formData.get("ownerUserId") as string) || null,
    lawfulBasis: (formData.get("lawfulBasis") as string) || null,
  });
  if (!parsed.success) {
    redirect(`${listPath(organisationId, engagementId)}/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  const user = await requireAuthenticatedUser();
  let newId: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) => pa.createProcessingActivity(db, user.id, { engagementId, ...parsed.data }));
    newId = result.id;
  } catch (err) {
    redirect(`${listPath(organisationId, engagementId)}/new?error=${encodeURIComponent(errorMessageFor(err))}`);
  }
  revalidatePath(listPath(organisationId, engagementId));
  redirect(`${detailPath(organisationId, engagementId, newId!)}?saved=1`);
}

const updateSchema = createSchema.extend({
  processingActivityId: z.string().trim().min(1),
  lifecycleStatus: z.enum(["draft", "active", "under_review", "retired"]),
});

export async function updateProcessingActivityAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const engagementId = String(formData.get("engagementId"));
  const processingActivityId = String(formData.get("processingActivityId"));
  const parsed = updateSchema.safeParse({
    processingActivityId,
    name: formData.get("name"),
    description: (formData.get("description") as string) || null,
    businessUnitId: (formData.get("businessUnitId") as string) || null,
    ownerUserId: (formData.get("ownerUserId") as string) || null,
    lawfulBasis: (formData.get("lawfulBasis") as string) || null,
    lifecycleStatus: formData.get("lifecycleStatus"),
  });
  if (!parsed.success) {
    redirect(`${detailPath(organisationId, engagementId, processingActivityId)}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => pa.updateProcessingActivity(db, user.id, parsed.data));
  } catch (err) {
    redirect(`${detailPath(organisationId, engagementId, processingActivityId)}?error=${encodeURIComponent(errorMessageFor(err))}`);
  }
  revalidatePath(detailPath(organisationId, engagementId, processingActivityId));
  redirect(`${detailPath(organisationId, engagementId, processingActivityId)}?saved=1`);
}

export async function carryForwardProcessingActivityAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const engagementId = String(formData.get("engagementId"));
  const processingActivityId = String(formData.get("processingActivityId"));
  const targetEngagementId = String(formData.get("targetEngagementId"));

  const user = await requireAuthenticatedUser();
  let newId: string | null = null;
  try {
    const result = await withRequestDb(user.id, (db) =>
      pa.carryForwardProcessingActivity(db, user.id, { sourceProcessingActivityId: processingActivityId, targetEngagementId }),
    );
    newId = result.id;
  } catch (err) {
    redirect(`${detailPath(organisationId, engagementId, processingActivityId)}?error=${encodeURIComponent(errorMessageFor(err))}`);
  }
  redirect(`/organisations/${organisationId}/engagements/${targetEngagementId}/data-landscape/${newId}?saved=1`);
}

// --- Relationship links (six categories, plus their unlink counterparts) ---

async function runLink(
  organisationId: string,
  engagementId: string,
  processingActivityId: string,
  fn: (db: RequestDb, userId: string) => Promise<unknown>,
): Promise<void> {
  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => fn(db, user.id));
  } catch (err) {
    redirect(`${detailPath(organisationId, engagementId, processingActivityId)}?error=${encodeURIComponent(errorMessageFor(err))}`);
  }
  revalidatePath(detailPath(organisationId, engagementId, processingActivityId));
  redirect(`${detailPath(organisationId, engagementId, processingActivityId)}?saved=1`);
}

function readLinkForm(formData: FormData) {
  return {
    organisationId: String(formData.get("organisationId")),
    engagementId: String(formData.get("engagementId")),
    processingActivityId: String(formData.get("processingActivityId")),
  };
}

export async function linkPurposeAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const purposeId = String(formData.get("purposeId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.linkPurpose(db, userId, { processingActivityId, purposeId }),
  );
}

export async function unlinkPurposeAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const purposeId = String(formData.get("purposeId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.unlinkPurpose(db, userId, { processingActivityId, purposeId }),
  );
}

export async function linkDataPrincipalCategoryAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const dataPrincipalCategoryId = String(formData.get("dataPrincipalCategoryId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.linkDataPrincipalCategory(db, userId, { processingActivityId, dataPrincipalCategoryId }),
  );
}

export async function unlinkDataPrincipalCategoryAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const dataPrincipalCategoryId = String(formData.get("dataPrincipalCategoryId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.unlinkDataPrincipalCategory(db, userId, { processingActivityId, dataPrincipalCategoryId }),
  );
}

export async function linkPersonalDataElementAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const personalDataElementId = String(formData.get("personalDataElementId"));
  const sensitivityNote = (formData.get("sensitivityNote") as string) || null;
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.linkPersonalDataElement(db, userId, { processingActivityId, personalDataElementId, sensitivityNote }),
  );
}

export async function unlinkPersonalDataElementAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const personalDataElementId = String(formData.get("personalDataElementId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.unlinkPersonalDataElement(db, userId, { processingActivityId, personalDataElementId }),
  );
}

export async function linkSystemAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const systemId = String(formData.get("systemId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.linkSystem(db, userId, { processingActivityId, systemId }),
  );
}

export async function unlinkSystemAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const systemId = String(formData.get("systemId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.unlinkSystem(db, userId, { processingActivityId, systemId }),
  );
}

export async function linkDataStoreAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const dataStoreId = String(formData.get("dataStoreId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.linkDataStore(db, userId, { processingActivityId, dataStoreId }),
  );
}

export async function unlinkDataStoreAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const dataStoreId = String(formData.get("dataStoreId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.unlinkDataStore(db, userId, { processingActivityId, dataStoreId }),
  );
}

export async function linkProcessorAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const processorId = String(formData.get("processorId"));
  const role = (formData.get("role") as "processor" | "joint_controller") || "processor";
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.linkProcessor(db, userId, { processingActivityId, processorId, role }),
  );
}

export async function unlinkProcessorAction(formData: FormData): Promise<void> {
  const { organisationId, engagementId, processingActivityId } = readLinkForm(formData);
  const processorId = String(formData.get("processorId"));
  await runLink(organisationId, engagementId, processingActivityId, (db, userId) =>
    pa.unlinkProcessor(db, userId, { processingActivityId, processorId }),
  );
}
