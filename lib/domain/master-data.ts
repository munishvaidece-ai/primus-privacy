import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  businessUnits,
  dataPrincipalCategories,
  dataPrincipalCategoryVersions,
  personalDataElements,
  personalDataElementVersions,
  purposes,
  purposeVersions,
  systems,
  systemVersions,
  dataStores,
  dataStoreVersions,
  processors,
  processorVersions,
} from "@/db/schema";
import { NotFoundOrForbiddenError, requireOrganisationAccess } from "@/lib/authorization/service";

// Slice D2 — Data Landscape / Processing Activities / ROPA, master-data
// half. Builds the application layer on top of the EXACT existing
// Client-level master data model (Milestone 2, migrations 0002/0003;
// DATA_MODEL.md §5.1) — no new table, no new column, no second
// versioning mechanism. Ownership is confirmed ORGANISATION-level
// (every identity table carries `organisation_id` directly, not
// `engagement_id`) — master data is a fact about the *client*, reusable
// across every engagement for that client, exactly as DATA_MODEL.md §5.1
// states and as migration 0003's RLS already enforces
// (`can_access_organisation`, no engagement involved).
//
// Authorization: `requireOrganisationAccess` — the SAME broad check
// migration 0003's RLS policies already use for every read/write on
// these tables (`can_access_organisation`), and the same shape
// PRODUCT_UX_BLUEPRINT.md §8's Permission Matrix specifies for "Client
// Master Data" (Consultant: R,C,E via plain membership — no separate
// dedicated permission column, unlike Methodology's Tenant-scoped
// `methodology.manage`). A new dedicated permission was deliberately
// NOT introduced here — see DECISIONS.md.
//
// Six of the seven master-data entity types are versioned (Slowly-
// Changing-Dimension Type 2: an immutable identity row + an append-only
// history of version rows, `is_current` enforced to at most one per
// identity by a partial unique index). "Editing" a versioned entity
// always INSERTs a new version row — this module has NO function that
// UPDATEs a version row's descriptive fields, matching the database
// layer's own posture (version tables grant SELECT/INSERT only, no
// UPDATE — migration 0003). BusinessUnit is the one entity WITHOUT a
// version table (DATA_MODEL.md §5.1/§5.3: used structurally, not as a
// version-pinned compliance fact) — it is edited in place instead.

export class InvalidMasterDataInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMasterDataInputError";
  }
}

export class CrossOrganisationReferenceError extends Error {
  constructor(message = "That record does not belong to this organisation.") {
    super(message);
    this.name = "CrossOrganisationReferenceError";
  }
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new InvalidMasterDataInputError(`${field} is required.`);
  return trimmed;
}

// --- Business Units (no version table — DATA_MODEL.md §5.1's carve-out) ---

export interface BusinessUnitRow {
  id: string;
  name: string;
  parentBusinessUnitId: string | null;
  status: string;
}

export async function listBusinessUnits(db: RequestDb, userId: string, organisationId: string): Promise<BusinessUnitRow[]> {
  await requireOrganisationAccess(db, userId, organisationId);
  return db
    .select({
      id: businessUnits.id,
      name: businessUnits.name,
      parentBusinessUnitId: businessUnits.parentBusinessUnitId,
      status: businessUnits.status,
    })
    .from(businessUnits)
    .where(eq(businessUnits.organisationId, organisationId))
    .orderBy(asc(businessUnits.name));
}

export async function createBusinessUnit(
  db: RequestDb,
  userId: string,
  organisationId: string,
  input: { name: string; parentBusinessUnitId: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");
  await requireOrganisationAccess(db, userId, organisationId);

  if (input.parentBusinessUnitId) {
    const [parent] = await db
      .select({ id: businessUnits.id })
      .from(businessUnits)
      .where(and(eq(businessUnits.id, input.parentBusinessUnitId), eq(businessUnits.organisationId, organisationId)))
      .limit(1);
    if (!parent) throw new CrossOrganisationReferenceError();
  }

  const id = randomUUID();
  await db.insert(businessUnits).values({
    id,
    organisationId,
    name,
    parentBusinessUnitId: input.parentBusinessUnitId,
    createdBy: userId,
    updatedBy: userId,
  });
  return { id };
}

/** Direct in-place edit — correct for BusinessUnit specifically (it is
 * NOT version-pinned, unlike the six entities below); every other
 * "update" in this module instead creates a new version row. */
export async function updateBusinessUnit(
  db: RequestDb,
  userId: string,
  input: { businessUnitId: string; name: string; parentBusinessUnitId: string | null; status: "active" | "retired" },
): Promise<void> {
  const name = requireNonEmpty(input.name, "Name");

  const [row] = await db
    .select({ id: businessUnits.id, organisationId: businessUnits.organisationId })
    .from(businessUnits)
    .where(eq(businessUnits.id, input.businessUnitId))
    .limit(1);
  if (!row) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, row.organisationId);

  if (input.parentBusinessUnitId) {
    if (input.parentBusinessUnitId === input.businessUnitId) {
      throw new InvalidMasterDataInputError("A business unit cannot be its own parent.");
    }
    const [parent] = await db
      .select({ id: businessUnits.id })
      .from(businessUnits)
      .where(and(eq(businessUnits.id, input.parentBusinessUnitId), eq(businessUnits.organisationId, row.organisationId)))
      .limit(1);
    if (!parent) throw new CrossOrganisationReferenceError();
  }

  await db
    .update(businessUnits)
    .set({
      name,
      parentBusinessUnitId: input.parentBusinessUnitId,
      status: input.status,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(businessUnits.id, input.businessUnitId));
}

// --- Data Principal Categories ------------------------------------------

export interface DataPrincipalCategoryRow {
  id: string;
  status: string;
  currentVersionId: string;
  name: string;
  isChildrenFlag: boolean;
  description: string | null;
}

export async function listDataPrincipalCategories(
  db: RequestDb,
  userId: string,
  organisationId: string,
): Promise<DataPrincipalCategoryRow[]> {
  await requireOrganisationAccess(db, userId, organisationId);
  return db
    .select({
      id: dataPrincipalCategories.id,
      status: dataPrincipalCategories.status,
      currentVersionId: dataPrincipalCategoryVersions.id,
      name: dataPrincipalCategoryVersions.name,
      isChildrenFlag: dataPrincipalCategoryVersions.isChildrenFlag,
      description: dataPrincipalCategoryVersions.description,
    })
    .from(dataPrincipalCategories)
    .innerJoin(
      dataPrincipalCategoryVersions,
      and(
        eq(dataPrincipalCategoryVersions.dataPrincipalCategoryId, dataPrincipalCategories.id),
        eq(dataPrincipalCategoryVersions.isCurrent, true),
      ),
    )
    .where(eq(dataPrincipalCategories.organisationId, organisationId))
    .orderBy(asc(dataPrincipalCategoryVersions.name));
}

export async function createDataPrincipalCategory(
  db: RequestDb,
  userId: string,
  organisationId: string,
  input: { name: string; isChildrenFlag: boolean; description: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");
  await requireOrganisationAccess(db, userId, organisationId);

  const id = randomUUID();
  await db.insert(dataPrincipalCategories).values({ id, organisationId, createdBy: userId, updatedBy: userId });
  await db.insert(dataPrincipalCategoryVersions).values({
    id: randomUUID(),
    dataPrincipalCategoryId: id,
    organisationId,
    name,
    isChildrenFlag: input.isChildrenFlag,
    description: input.description,
    createdBy: userId,
  });
  return { id };
}

/** Inserts a new current version — the ONLY way to change what a Data
 * Principal Category "says" (migration 0003's `close_out_previous_data_
 * principal_category_version` trigger closes out the prior current row;
 * this function never touches it directly). */
export async function createDataPrincipalCategoryVersion(
  db: RequestDb,
  userId: string,
  input: { dataPrincipalCategoryId: string; name: string; isChildrenFlag: boolean; description: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");

  const [identity] = await db
    .select({ id: dataPrincipalCategories.id, organisationId: dataPrincipalCategories.organisationId })
    .from(dataPrincipalCategories)
    .where(eq(dataPrincipalCategories.id, input.dataPrincipalCategoryId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  const id = randomUUID();
  await db.insert(dataPrincipalCategoryVersions).values({
    id,
    dataPrincipalCategoryId: identity.id,
    organisationId: identity.organisationId,
    name,
    isChildrenFlag: input.isChildrenFlag,
    description: input.description,
    createdBy: userId,
  });
  return { id };
}

export async function retireDataPrincipalCategory(db: RequestDb, userId: string, input: { dataPrincipalCategoryId: string }): Promise<void> {
  const [identity] = await db
    .select({ id: dataPrincipalCategories.id, organisationId: dataPrincipalCategories.organisationId })
    .from(dataPrincipalCategories)
    .where(eq(dataPrincipalCategories.id, input.dataPrincipalCategoryId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  await db
    .update(dataPrincipalCategories)
    .set({ status: "retired", updatedBy: userId, updatedAt: new Date() })
    .where(eq(dataPrincipalCategories.id, identity.id));
}

// --- Personal Data Elements ----------------------------------------------

export interface PersonalDataElementRow {
  id: string;
  status: string;
  currentVersionId: string;
  name: string;
  sensitivityCategory: string;
}

export async function listPersonalDataElements(db: RequestDb, userId: string, organisationId: string): Promise<PersonalDataElementRow[]> {
  await requireOrganisationAccess(db, userId, organisationId);
  return db
    .select({
      id: personalDataElements.id,
      status: personalDataElements.status,
      currentVersionId: personalDataElementVersions.id,
      name: personalDataElementVersions.name,
      sensitivityCategory: personalDataElementVersions.sensitivityCategory,
    })
    .from(personalDataElements)
    .innerJoin(
      personalDataElementVersions,
      and(
        eq(personalDataElementVersions.personalDataElementId, personalDataElements.id),
        eq(personalDataElementVersions.isCurrent, true),
      ),
    )
    .where(eq(personalDataElements.organisationId, organisationId))
    .orderBy(asc(personalDataElementVersions.name));
}

export async function createPersonalDataElement(
  db: RequestDb,
  userId: string,
  organisationId: string,
  input: { name: string; sensitivityCategory: "general" | "sensitive" | "critical" },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");
  await requireOrganisationAccess(db, userId, organisationId);

  const id = randomUUID();
  await db.insert(personalDataElements).values({ id, organisationId, createdBy: userId, updatedBy: userId });
  await db.insert(personalDataElementVersions).values({
    id: randomUUID(),
    personalDataElementId: id,
    organisationId,
    name,
    sensitivityCategory: input.sensitivityCategory,
    createdBy: userId,
  });
  return { id };
}

export async function createPersonalDataElementVersion(
  db: RequestDb,
  userId: string,
  input: { personalDataElementId: string; name: string; sensitivityCategory: "general" | "sensitive" | "critical" },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");

  const [identity] = await db
    .select({ id: personalDataElements.id, organisationId: personalDataElements.organisationId })
    .from(personalDataElements)
    .where(eq(personalDataElements.id, input.personalDataElementId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  const id = randomUUID();
  await db.insert(personalDataElementVersions).values({
    id,
    personalDataElementId: identity.id,
    organisationId: identity.organisationId,
    name,
    sensitivityCategory: input.sensitivityCategory,
    createdBy: userId,
  });
  return { id };
}

export async function retirePersonalDataElement(db: RequestDb, userId: string, input: { personalDataElementId: string }): Promise<void> {
  const [identity] = await db
    .select({ id: personalDataElements.id, organisationId: personalDataElements.organisationId })
    .from(personalDataElements)
    .where(eq(personalDataElements.id, input.personalDataElementId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  await db
    .update(personalDataElements)
    .set({ status: "retired", updatedBy: userId, updatedAt: new Date() })
    .where(eq(personalDataElements.id, identity.id));
}

// --- Purposes --------------------------------------------------------------

export interface PurposeRow {
  id: string;
  status: string;
  currentVersionId: string;
  name: string;
  description: string | null;
}

export async function listPurposes(db: RequestDb, userId: string, organisationId: string): Promise<PurposeRow[]> {
  await requireOrganisationAccess(db, userId, organisationId);
  return db
    .select({
      id: purposes.id,
      status: purposes.status,
      currentVersionId: purposeVersions.id,
      name: purposeVersions.name,
      description: purposeVersions.description,
    })
    .from(purposes)
    .innerJoin(purposeVersions, and(eq(purposeVersions.purposeId, purposes.id), eq(purposeVersions.isCurrent, true)))
    .where(eq(purposes.organisationId, organisationId))
    .orderBy(asc(purposeVersions.name));
}

export async function createPurpose(
  db: RequestDb,
  userId: string,
  organisationId: string,
  input: { name: string; description: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");
  await requireOrganisationAccess(db, userId, organisationId);

  const id = randomUUID();
  await db.insert(purposes).values({ id, organisationId, createdBy: userId, updatedBy: userId });
  await db.insert(purposeVersions).values({
    id: randomUUID(),
    purposeId: id,
    organisationId,
    name,
    description: input.description,
    createdBy: userId,
  });
  return { id };
}

export async function createPurposeVersion(
  db: RequestDb,
  userId: string,
  input: { purposeId: string; name: string; description: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");

  const [identity] = await db
    .select({ id: purposes.id, organisationId: purposes.organisationId })
    .from(purposes)
    .where(eq(purposes.id, input.purposeId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  const id = randomUUID();
  await db.insert(purposeVersions).values({
    id,
    purposeId: identity.id,
    organisationId: identity.organisationId,
    name,
    description: input.description,
    createdBy: userId,
  });
  return { id };
}

export async function retirePurpose(db: RequestDb, userId: string, input: { purposeId: string }): Promise<void> {
  const [identity] = await db
    .select({ id: purposes.id, organisationId: purposes.organisationId })
    .from(purposes)
    .where(eq(purposes.id, input.purposeId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  await db.update(purposes).set({ status: "retired", updatedBy: userId, updatedAt: new Date() }).where(eq(purposes.id, identity.id));
}

// --- Systems -----------------------------------------------------------

export interface SystemRow {
  id: string;
  status: string;
  currentVersionId: string;
  name: string;
  owner: string | null;
  hostingEnvironment: string | null;
}

export async function listSystems(db: RequestDb, userId: string, organisationId: string): Promise<SystemRow[]> {
  await requireOrganisationAccess(db, userId, organisationId);
  return db
    .select({
      id: systems.id,
      status: systems.status,
      currentVersionId: systemVersions.id,
      name: systemVersions.name,
      owner: systemVersions.owner,
      hostingEnvironment: systemVersions.hostingEnvironment,
    })
    .from(systems)
    .innerJoin(systemVersions, and(eq(systemVersions.systemId, systems.id), eq(systemVersions.isCurrent, true)))
    .where(eq(systems.organisationId, organisationId))
    .orderBy(asc(systemVersions.name));
}

export async function createSystem(
  db: RequestDb,
  userId: string,
  organisationId: string,
  input: { name: string; owner: string | null; hostingEnvironment: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");
  await requireOrganisationAccess(db, userId, organisationId);

  const id = randomUUID();
  await db.insert(systems).values({ id, organisationId, createdBy: userId, updatedBy: userId });
  await db.insert(systemVersions).values({
    id: randomUUID(),
    systemId: id,
    organisationId,
    name,
    owner: input.owner,
    hostingEnvironment: input.hostingEnvironment,
    createdBy: userId,
  });
  return { id };
}

export async function createSystemVersion(
  db: RequestDb,
  userId: string,
  input: { systemId: string; name: string; owner: string | null; hostingEnvironment: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");

  const [identity] = await db
    .select({ id: systems.id, organisationId: systems.organisationId })
    .from(systems)
    .where(eq(systems.id, input.systemId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  const id = randomUUID();
  await db.insert(systemVersions).values({
    id,
    systemId: identity.id,
    organisationId: identity.organisationId,
    name,
    owner: input.owner,
    hostingEnvironment: input.hostingEnvironment,
    createdBy: userId,
  });
  return { id };
}

export async function retireSystem(db: RequestDb, userId: string, input: { systemId: string }): Promise<void> {
  const [identity] = await db
    .select({ id: systems.id, organisationId: systems.organisationId })
    .from(systems)
    .where(eq(systems.id, input.systemId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  await db.update(systems).set({ status: "retired", updatedBy: userId, updatedAt: new Date() }).where(eq(systems.id, identity.id));
}

// --- Data Stores -------------------------------------------------------

export interface DataStoreRow {
  id: string;
  status: string;
  currentVersionId: string;
  name: string;
  storageType: string | null;
  location: string | null;
  systemVersionId: string | null;
  systemName: string | null;
}

export async function listDataStores(db: RequestDb, userId: string, organisationId: string): Promise<DataStoreRow[]> {
  await requireOrganisationAccess(db, userId, organisationId);
  return db
    .select({
      id: dataStores.id,
      status: dataStores.status,
      currentVersionId: dataStoreVersions.id,
      name: dataStoreVersions.name,
      storageType: dataStoreVersions.storageType,
      location: dataStoreVersions.location,
      systemVersionId: dataStoreVersions.systemVersionId,
      systemName: systemVersions.name,
    })
    .from(dataStores)
    .innerJoin(dataStoreVersions, and(eq(dataStoreVersions.dataStoreId, dataStores.id), eq(dataStoreVersions.isCurrent, true)))
    .leftJoin(systemVersions, eq(systemVersions.id, dataStoreVersions.systemVersionId))
    .where(eq(dataStores.organisationId, organisationId))
    .orderBy(asc(dataStoreVersions.name));
}

/** Resolves `systemId` (an identity id, not a version id — matching
 * DATA_MODEL.md §5.3's "Service-layer rule": ordinary linking always
 * pins to whichever version is currently `is_current` at the moment)
 * to that System's current version, or throws if the System has no
 * current version or belongs to another organisation. */
async function resolveCurrentSystemVersion(db: RequestDb, systemId: string, organisationId: string): Promise<string> {
  const [row] = await db
    .select({ id: systemVersions.id })
    .from(systemVersions)
    .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.organisationId, organisationId), eq(systemVersions.isCurrent, true)))
    .limit(1);
  if (!row) throw new CrossOrganisationReferenceError();
  return row.id;
}

export async function createDataStore(
  db: RequestDb,
  userId: string,
  organisationId: string,
  input: { name: string; storageType: string | null; location: string | null; systemId: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");
  await requireOrganisationAccess(db, userId, organisationId);

  const systemVersionId = input.systemId ? await resolveCurrentSystemVersion(db, input.systemId, organisationId) : null;

  const id = randomUUID();
  await db.insert(dataStores).values({ id, organisationId, createdBy: userId, updatedBy: userId });
  await db.insert(dataStoreVersions).values({
    id: randomUUID(),
    dataStoreId: id,
    organisationId,
    name,
    storageType: input.storageType,
    location: input.location,
    systemVersionId,
    createdBy: userId,
  });
  return { id };
}

export async function createDataStoreVersion(
  db: RequestDb,
  userId: string,
  input: { dataStoreId: string; name: string; storageType: string | null; location: string | null; systemId: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");

  const [identity] = await db
    .select({ id: dataStores.id, organisationId: dataStores.organisationId })
    .from(dataStores)
    .where(eq(dataStores.id, input.dataStoreId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  const systemVersionId = input.systemId ? await resolveCurrentSystemVersion(db, input.systemId, identity.organisationId) : null;

  const id = randomUUID();
  await db.insert(dataStoreVersions).values({
    id,
    dataStoreId: identity.id,
    organisationId: identity.organisationId,
    name,
    storageType: input.storageType,
    location: input.location,
    systemVersionId,
    createdBy: userId,
  });
  return { id };
}

export async function retireDataStore(db: RequestDb, userId: string, input: { dataStoreId: string }): Promise<void> {
  const [identity] = await db
    .select({ id: dataStores.id, organisationId: dataStores.organisationId })
    .from(dataStores)
    .where(eq(dataStores.id, input.dataStoreId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  await db.update(dataStores).set({ status: "retired", updatedBy: userId, updatedAt: new Date() }).where(eq(dataStores.id, identity.id));
}

// --- Processors ----------------------------------------------------------

export interface ProcessorRow {
  id: string;
  status: string;
  parentProcessorId: string | null;
  currentVersionId: string;
  name: string;
  dpaVersionLabel: string | null;
  riskTier: string | null;
}

export async function listProcessors(db: RequestDb, userId: string, organisationId: string): Promise<ProcessorRow[]> {
  await requireOrganisationAccess(db, userId, organisationId);
  return db
    .select({
      id: processors.id,
      status: processors.status,
      parentProcessorId: processors.parentProcessorId,
      currentVersionId: processorVersions.id,
      name: processorVersions.name,
      dpaVersionLabel: processorVersions.dpaVersionLabel,
      riskTier: processorVersions.riskTier,
    })
    .from(processors)
    .innerJoin(processorVersions, and(eq(processorVersions.processorId, processors.id), eq(processorVersions.isCurrent, true)))
    .where(eq(processors.organisationId, organisationId))
    .orderBy(asc(processorVersions.name));
}

export async function createProcessor(
  db: RequestDb,
  userId: string,
  organisationId: string,
  input: { name: string; dpaVersionLabel: string | null; riskTier: string | null; parentProcessorId: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");
  await requireOrganisationAccess(db, userId, organisationId);

  if (input.parentProcessorId) {
    const [parent] = await db
      .select({ id: processors.id })
      .from(processors)
      .where(and(eq(processors.id, input.parentProcessorId), eq(processors.organisationId, organisationId)))
      .limit(1);
    if (!parent) throw new CrossOrganisationReferenceError();
  }

  const id = randomUUID();
  await db.insert(processors).values({
    id,
    organisationId,
    parentProcessorId: input.parentProcessorId,
    createdBy: userId,
    updatedBy: userId,
  });
  await db.insert(processorVersions).values({
    id: randomUUID(),
    processorId: id,
    organisationId,
    name,
    dpaVersionLabel: input.dpaVersionLabel,
    riskTier: input.riskTier,
    createdBy: userId,
  });
  return { id };
}

export async function createProcessorVersion(
  db: RequestDb,
  userId: string,
  input: { processorId: string; name: string; dpaVersionLabel: string | null; riskTier: string | null },
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");

  const [identity] = await db
    .select({ id: processors.id, organisationId: processors.organisationId })
    .from(processors)
    .where(eq(processors.id, input.processorId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  const id = randomUUID();
  await db.insert(processorVersions).values({
    id,
    processorId: identity.id,
    organisationId: identity.organisationId,
    name,
    dpaVersionLabel: input.dpaVersionLabel,
    riskTier: input.riskTier,
    createdBy: userId,
  });
  return { id };
}

export async function retireProcessor(db: RequestDb, userId: string, input: { processorId: string }): Promise<void> {
  const [identity] = await db
    .select({ id: processors.id, organisationId: processors.organisationId })
    .from(processors)
    .where(eq(processors.id, input.processorId))
    .limit(1);
  if (!identity) throw new NotFoundOrForbiddenError();
  await requireOrganisationAccess(db, userId, identity.organisationId);

  await db.update(processors).set({ status: "retired", updatedBy: userId, updatedAt: new Date() }).where(eq(processors.id, identity.id));
}
