"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import * as masterData from "@/lib/domain/master-data";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

// Mirrors control-library's actions.ts shape exactly (Slice D1):
// Browser → Server Action → authenticate → authorize (inside the
// domain function) → validate → write → redirect. One action per
// domain operation, all redirecting back to the category list with a
// `?saved=1` or `?error=...` query param — no client-side JS needed.

function backTo(organisationId: string, category: string, extra?: Record<string, string>) {
  const params = new URLSearchParams(extra);
  const qs = params.toString();
  return `/organisations/${organisationId}/master-data/${category}${qs ? `?${qs}` : ""}`;
}

function errorMessageFor(err: unknown): string {
  if (err instanceof masterData.InvalidMasterDataInputError || err instanceof masterData.CrossOrganisationReferenceError) {
    return err.message;
  }
  if (err instanceof NotFoundOrForbiddenError) return "You do not have access to manage this organisation's master data.";
  console.error("master-data action failed", err);
  return "Something went wrong. Please try again.";
}

// --- Business Units --------------------------------------------------------

const businessUnitSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentBusinessUnitId: z.string().trim().nullable(),
});

export async function createBusinessUnitAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const parsed = businessUnitSchema.safeParse({
    name: formData.get("name"),
    parentBusinessUnitId: (formData.get("parentBusinessUnitId") as string) || null,
  });
  if (!parsed.success) redirect(backTo(organisationId, "business-units", { error: "Name is required." }));

  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => masterData.createBusinessUnit(db, user.id, organisationId, parsed.data));
  } catch (err) {
    redirect(backTo(organisationId, "business-units", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/business-units`);
  redirect(backTo(organisationId, "business-units", { saved: "1" }));
}

export async function updateBusinessUnitAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const parsed = businessUnitSchema.extend({ businessUnitId: z.string().trim().min(1), status: z.enum(["active", "retired"]) }).safeParse({
    businessUnitId: formData.get("businessUnitId"),
    name: formData.get("name"),
    parentBusinessUnitId: formData.get("parentBusinessUnitId") || null,
    status: formData.get("status"),
  });
  if (!parsed.success) redirect(backTo(organisationId, "business-units", { error: "Invalid input." }));

  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => masterData.updateBusinessUnit(db, user.id, parsed.data));
  } catch (err) {
    redirect(backTo(organisationId, "business-units", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/business-units`);
  redirect(backTo(organisationId, "business-units", { saved: "1" }));
}

// --- Data Principal Categories ----------------------------------------------

const dpcSchema = z.object({
  name: z.string().trim().min(1).max(200),
  isChildrenFlag: z.boolean(),
  description: z.string().trim().nullable(),
});

export async function createDataPrincipalCategoryAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = { name: String(formData.get("name") ?? ""), isChildrenFlag: formData.get("isChildrenFlag") === "on", description: (formData.get("description") as string) || null };
  try {
    await withRequestDb(user.id, (db) => masterData.createDataPrincipalCategory(db, user.id, organisationId, input));
  } catch (err) {
    redirect(backTo(organisationId, "data-principal-categories", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/data-principal-categories`);
  redirect(backTo(organisationId, "data-principal-categories", { saved: "1" }));
}

export async function createDataPrincipalCategoryVersionAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    dataPrincipalCategoryId: String(formData.get("dataPrincipalCategoryId")),
    name: String(formData.get("name") ?? ""),
    isChildrenFlag: formData.get("isChildrenFlag") === "on",
    description: (formData.get("description") as string) || null,
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createDataPrincipalCategoryVersion(db, user.id, input));
  } catch (err) {
    redirect(backTo(organisationId, "data-principal-categories", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/data-principal-categories`);
  redirect(backTo(organisationId, "data-principal-categories", { saved: "1" }));
}

export async function retireDataPrincipalCategoryAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) =>
      masterData.retireDataPrincipalCategory(db, user.id, { dataPrincipalCategoryId: String(formData.get("dataPrincipalCategoryId")) }),
    );
  } catch (err) {
    redirect(backTo(organisationId, "data-principal-categories", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/data-principal-categories`);
  redirect(backTo(organisationId, "data-principal-categories", { saved: "1" }));
}

// --- Personal Data Elements ---------------------------------------------

export async function createPersonalDataElementAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    name: String(formData.get("name") ?? ""),
    sensitivityCategory: (formData.get("sensitivityCategory") as "general" | "sensitive" | "critical") || "general",
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createPersonalDataElement(db, user.id, organisationId, input));
  } catch (err) {
    redirect(backTo(organisationId, "personal-data-elements", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/personal-data-elements`);
  redirect(backTo(organisationId, "personal-data-elements", { saved: "1" }));
}

export async function createPersonalDataElementVersionAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    personalDataElementId: String(formData.get("personalDataElementId")),
    name: String(formData.get("name") ?? ""),
    sensitivityCategory: (formData.get("sensitivityCategory") as "general" | "sensitive" | "critical") || "general",
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createPersonalDataElementVersion(db, user.id, input));
  } catch (err) {
    redirect(backTo(organisationId, "personal-data-elements", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/personal-data-elements`);
  redirect(backTo(organisationId, "personal-data-elements", { saved: "1" }));
}

export async function retirePersonalDataElementAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) =>
      masterData.retirePersonalDataElement(db, user.id, { personalDataElementId: String(formData.get("personalDataElementId")) }),
    );
  } catch (err) {
    redirect(backTo(organisationId, "personal-data-elements", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/personal-data-elements`);
  redirect(backTo(organisationId, "personal-data-elements", { saved: "1" }));
}

// --- Purposes ---------------------------------------------------------

export async function createPurposeAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = { name: String(formData.get("name") ?? ""), description: (formData.get("description") as string) || null };
  try {
    await withRequestDb(user.id, (db) => masterData.createPurpose(db, user.id, organisationId, input));
  } catch (err) {
    redirect(backTo(organisationId, "purposes", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/purposes`);
  redirect(backTo(organisationId, "purposes", { saved: "1" }));
}

export async function createPurposeVersionAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    purposeId: String(formData.get("purposeId")),
    name: String(formData.get("name") ?? ""),
    description: (formData.get("description") as string) || null,
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createPurposeVersion(db, user.id, input));
  } catch (err) {
    redirect(backTo(organisationId, "purposes", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/purposes`);
  redirect(backTo(organisationId, "purposes", { saved: "1" }));
}

export async function retirePurposeAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => masterData.retirePurpose(db, user.id, { purposeId: String(formData.get("purposeId")) }));
  } catch (err) {
    redirect(backTo(organisationId, "purposes", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/purposes`);
  redirect(backTo(organisationId, "purposes", { saved: "1" }));
}

// --- Systems ------------------------------------------------------------

export async function createSystemAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    name: String(formData.get("name") ?? ""),
    owner: (formData.get("owner") as string) || null,
    hostingEnvironment: (formData.get("hostingEnvironment") as string) || null,
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createSystem(db, user.id, organisationId, input));
  } catch (err) {
    redirect(backTo(organisationId, "systems", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/systems`);
  redirect(backTo(organisationId, "systems", { saved: "1" }));
}

export async function createSystemVersionAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    systemId: String(formData.get("systemId")),
    name: String(formData.get("name") ?? ""),
    owner: (formData.get("owner") as string) || null,
    hostingEnvironment: (formData.get("hostingEnvironment") as string) || null,
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createSystemVersion(db, user.id, input));
  } catch (err) {
    redirect(backTo(organisationId, "systems", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/systems`);
  redirect(backTo(organisationId, "systems", { saved: "1" }));
}

export async function retireSystemAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => masterData.retireSystem(db, user.id, { systemId: String(formData.get("systemId")) }));
  } catch (err) {
    redirect(backTo(organisationId, "systems", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/systems`);
  redirect(backTo(organisationId, "systems", { saved: "1" }));
}

// --- Data Stores --------------------------------------------------------

export async function createDataStoreAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    name: String(formData.get("name") ?? ""),
    storageType: (formData.get("storageType") as string) || null,
    location: (formData.get("location") as string) || null,
    systemId: (formData.get("systemId") as string) || null,
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createDataStore(db, user.id, organisationId, input));
  } catch (err) {
    redirect(backTo(organisationId, "data-stores", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/data-stores`);
  redirect(backTo(organisationId, "data-stores", { saved: "1" }));
}

export async function createDataStoreVersionAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    dataStoreId: String(formData.get("dataStoreId")),
    name: String(formData.get("name") ?? ""),
    storageType: (formData.get("storageType") as string) || null,
    location: (formData.get("location") as string) || null,
    systemId: (formData.get("systemId") as string) || null,
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createDataStoreVersion(db, user.id, input));
  } catch (err) {
    redirect(backTo(organisationId, "data-stores", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/data-stores`);
  redirect(backTo(organisationId, "data-stores", { saved: "1" }));
}

export async function retireDataStoreAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => masterData.retireDataStore(db, user.id, { dataStoreId: String(formData.get("dataStoreId")) }));
  } catch (err) {
    redirect(backTo(organisationId, "data-stores", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/data-stores`);
  redirect(backTo(organisationId, "data-stores", { saved: "1" }));
}

// --- Processors -----------------------------------------------------------

export async function createProcessorAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    name: String(formData.get("name") ?? ""),
    dpaVersionLabel: (formData.get("dpaVersionLabel") as string) || null,
    riskTier: (formData.get("riskTier") as string) || null,
    parentProcessorId: (formData.get("parentProcessorId") as string) || null,
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createProcessor(db, user.id, organisationId, input));
  } catch (err) {
    redirect(backTo(organisationId, "processors", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/processors`);
  redirect(backTo(organisationId, "processors", { saved: "1" }));
}

export async function createProcessorVersionAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  const input = {
    processorId: String(formData.get("processorId")),
    name: String(formData.get("name") ?? ""),
    dpaVersionLabel: (formData.get("dpaVersionLabel") as string) || null,
    riskTier: (formData.get("riskTier") as string) || null,
  };
  try {
    await withRequestDb(user.id, (db) => masterData.createProcessorVersion(db, user.id, input));
  } catch (err) {
    redirect(backTo(organisationId, "processors", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/processors`);
  redirect(backTo(organisationId, "processors", { saved: "1" }));
}

export async function retireProcessorAction(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId"));
  const user = await requireAuthenticatedUser();
  try {
    await withRequestDb(user.id, (db) => masterData.retireProcessor(db, user.id, { processorId: String(formData.get("processorId")) }));
  } catch (err) {
    redirect(backTo(organisationId, "processors", { error: errorMessageFor(err) }));
  }
  revalidatePath(`/organisations/${organisationId}/master-data/processors`);
  redirect(backTo(organisationId, "processors", { saved: "1" }));
}
