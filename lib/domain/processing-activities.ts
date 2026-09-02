import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  processingActivities,
  processingActivityDataPrincipalCategories,
  processingActivityPersonalDataElements,
  processingActivityPurposes,
  processingActivitySystems,
  processingActivityDataStores,
  processingActivityProcessors,
  engagements,
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
  users,
} from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";

// Slice D2 — Data Landscape / Processing Activities / ROPA, engagement
// half. Builds the application layer on the EXACT existing Processing
// Activity + version-pinned junction model (Milestone 3, migrations
// 0004/0005; DATA_MODEL.md §5.2-§5.4) — no new table, no second
// versioning mechanism. ProcessingActivity is ENGAGEMENT-scoped
// (confirmed: `engagement_id NOT NULL`, composite FK to `engagements`),
// unlike the master-data entities in lib/domain/master-data.ts —
// created fresh per engagement, never mutated by a later one;
// `carried_forward_from_id` is the explicit, non-destructive continuity
// mechanism across engagements (§5.4 below).
//
// Authorization: `requireEngagementAccess` — the SAME broad check
// migration 0005's RLS policies already use for every read/write on
// ProcessingActivity and its six junctions (`can_access_engagement`),
// matching PRODUCT_UX_BLUEPRINT.md §8's "Processing Activities / ROPA"
// row (Consultant: R,C,E via plain membership — no dedicated
// permission). See DECISIONS.md.
//
// ROPA (instructions §10) is deliberately NOT a separate persisted
// object here — `listRopaEntries` below is a read view assembling
// ProcessingActivity + its six junctions, resolved against master data,
// exactly as db/schema/processing-activities.ts's own header comment
// already says: "ROPA is a future view/workflow over this table and its
// junctions — not a separate dataset."

export class InvalidProcessingActivityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProcessingActivityInputError";
  }
}

export class CrossScopeReferenceError extends Error {
  constructor(message = "That record does not belong to this engagement's organisation, or has no current version.") {
    super(message);
    this.name = "CrossScopeReferenceError";
  }
}

export class DuplicateLinkError extends Error {
  constructor(message = "This item is already linked to the processing activity.") {
    super(message);
    this.name = "DuplicateLinkError";
  }
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new InvalidProcessingActivityInputError(`${field} is required.`);
  return trimmed;
}

type LifecycleStatus = "draft" | "active" | "under_review" | "retired";
type ProcessorRole = "processor" | "joint_controller";

// --- Reads -----------------------------------------------------------------

export interface ProcessingActivitySummary {
  id: string;
  name: string;
  lifecycleStatus: string;
  businessUnitName: string | null;
  carriedForwardFromId: string | null;
}

export async function listProcessingActivities(
  db: RequestDb,
  userId: string,
  scope: { engagementId: string; organisationId: string },
): Promise<ProcessingActivitySummary[]> {
  await requireEngagementAccess(db, userId, scope.engagementId, scope.organisationId);

  return db
    .select({
      id: processingActivities.id,
      name: processingActivities.name,
      lifecycleStatus: processingActivities.lifecycleStatus,
      businessUnitName: businessUnits.name,
      carriedForwardFromId: processingActivities.carriedForwardFromId,
    })
    .from(processingActivities)
    .leftJoin(businessUnits, eq(businessUnits.id, processingActivities.businessUnitId))
    .where(
      and(
        eq(processingActivities.engagementId, scope.engagementId),
        eq(processingActivities.organisationId, scope.organisationId),
      ),
    )
    .orderBy(asc(processingActivities.name));
}

export interface ProcessingActivityDetail {
  id: string;
  engagementId: string;
  organisationId: string;
  name: string;
  description: string | null;
  businessUnitId: string | null;
  businessUnitName: string | null;
  ownerUserId: string | null;
  ownerEmail: string | null;
  lifecycleStatus: string;
  lawfulBasis: string | null;
  carriedForwardFromId: string | null;
  purposes: Array<{ linkId: string; purposeId: string; name: string }>;
  dataPrincipalCategories: Array<{ linkId: string; dataPrincipalCategoryId: string; name: string }>;
  personalDataElements: Array<{ linkId: string; personalDataElementId: string; name: string; sensitivityNote: string | null }>;
  systems: Array<{ linkId: string; systemId: string; name: string }>;
  dataStores: Array<{ linkId: string; dataStoreId: string; name: string }>;
  processors: Array<{ linkId: string; processorId: string; name: string; role: string }>;
}

export async function getProcessingActivityDetail(
  db: RequestDb,
  userId: string,
  processingActivityId: string,
): Promise<ProcessingActivityDetail> {
  const [pa] = await db
    .select({
      id: processingActivities.id,
      engagementId: processingActivities.engagementId,
      organisationId: processingActivities.organisationId,
      name: processingActivities.name,
      description: processingActivities.description,
      businessUnitId: processingActivities.businessUnitId,
      businessUnitName: businessUnits.name,
      ownerUserId: processingActivities.ownerUserId,
      ownerEmail: users.email,
      lifecycleStatus: processingActivities.lifecycleStatus,
      lawfulBasis: processingActivities.lawfulBasis,
      carriedForwardFromId: processingActivities.carriedForwardFromId,
    })
    .from(processingActivities)
    .leftJoin(businessUnits, eq(businessUnits.id, processingActivities.businessUnitId))
    .leftJoin(users, eq(users.id, processingActivities.ownerUserId))
    .where(eq(processingActivities.id, processingActivityId))
    .limit(1);
  if (!pa) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, pa.engagementId, pa.organisationId);

  const [purposeLinks, dpcLinks, pdeLinks, systemLinks, dataStoreLinks, processorLinks] = await Promise.all([
    db
      .select({ linkId: processingActivityPurposes.id, purposeId: purposes.id, name: purposeVersions.name })
      .from(processingActivityPurposes)
      .innerJoin(purposes, eq(purposes.id, processingActivityPurposes.purposeId))
      .innerJoin(purposeVersions, eq(purposeVersions.id, processingActivityPurposes.purposeVersionId))
      .where(eq(processingActivityPurposes.processingActivityId, processingActivityId))
      .orderBy(asc(purposeVersions.name)),
    db
      .select({
        linkId: processingActivityDataPrincipalCategories.id,
        dataPrincipalCategoryId: dataPrincipalCategories.id,
        name: dataPrincipalCategoryVersions.name,
      })
      .from(processingActivityDataPrincipalCategories)
      .innerJoin(dataPrincipalCategories, eq(dataPrincipalCategories.id, processingActivityDataPrincipalCategories.dataPrincipalCategoryId))
      .innerJoin(
        dataPrincipalCategoryVersions,
        eq(dataPrincipalCategoryVersions.id, processingActivityDataPrincipalCategories.dataPrincipalCategoryVersionId),
      )
      .where(eq(processingActivityDataPrincipalCategories.processingActivityId, processingActivityId))
      .orderBy(asc(dataPrincipalCategoryVersions.name)),
    db
      .select({
        linkId: processingActivityPersonalDataElements.id,
        personalDataElementId: personalDataElements.id,
        name: personalDataElementVersions.name,
        sensitivityNote: processingActivityPersonalDataElements.sensitivityNote,
      })
      .from(processingActivityPersonalDataElements)
      .innerJoin(personalDataElements, eq(personalDataElements.id, processingActivityPersonalDataElements.personalDataElementId))
      .innerJoin(
        personalDataElementVersions,
        eq(personalDataElementVersions.id, processingActivityPersonalDataElements.personalDataElementVersionId),
      )
      .where(eq(processingActivityPersonalDataElements.processingActivityId, processingActivityId))
      .orderBy(asc(personalDataElementVersions.name)),
    db
      .select({ linkId: processingActivitySystems.id, systemId: systems.id, name: systemVersions.name })
      .from(processingActivitySystems)
      .innerJoin(systems, eq(systems.id, processingActivitySystems.systemId))
      .innerJoin(systemVersions, eq(systemVersions.id, processingActivitySystems.systemVersionId))
      .where(eq(processingActivitySystems.processingActivityId, processingActivityId))
      .orderBy(asc(systemVersions.name)),
    db
      .select({ linkId: processingActivityDataStores.id, dataStoreId: dataStores.id, name: dataStoreVersions.name })
      .from(processingActivityDataStores)
      .innerJoin(dataStores, eq(dataStores.id, processingActivityDataStores.dataStoreId))
      .innerJoin(dataStoreVersions, eq(dataStoreVersions.id, processingActivityDataStores.dataStoreVersionId))
      .where(eq(processingActivityDataStores.processingActivityId, processingActivityId))
      .orderBy(asc(dataStoreVersions.name)),
    db
      .select({
        linkId: processingActivityProcessors.id,
        processorId: processors.id,
        name: processorVersions.name,
        role: processingActivityProcessors.role,
      })
      .from(processingActivityProcessors)
      .innerJoin(processors, eq(processors.id, processingActivityProcessors.processorId))
      .innerJoin(processorVersions, eq(processorVersions.id, processingActivityProcessors.processorVersionId))
      .where(eq(processingActivityProcessors.processingActivityId, processingActivityId))
      .orderBy(asc(processorVersions.name)),
  ]);

  return {
    ...pa,
    purposes: purposeLinks,
    dataPrincipalCategories: dpcLinks,
    personalDataElements: pdeLinks,
    systems: systemLinks,
    dataStores: dataStoreLinks,
    processors: processorLinks,
  };
}

/** The ROPA representation (instructions §10/§19 step 12) — every
 * Processing Activity in the engagement, each with its full resolved
 * relationship set. Reuses `getProcessingActivityDetail` per row rather
 * than one giant denormalized query, matching this codebase's existing
 * preference for composing already-authorized, already-tested reads
 * over a bespoke report-only query path (Reports/R1 already owns actual
 * PDF export — this stays a plain in-app read model). */
export async function listRopaEntries(
  db: RequestDb,
  userId: string,
  scope: { engagementId: string; organisationId: string },
): Promise<ProcessingActivityDetail[]> {
  const summaries = await listProcessingActivities(db, userId, scope);
  const details: ProcessingActivityDetail[] = [];
  for (const s of summaries) {
    details.push(await getProcessingActivityDetail(db, userId, s.id));
  }
  return details;
}

// --- Writes: Processing Activity -------------------------------------------

export interface CreateProcessingActivityInput {
  engagementId: string;
  name: string;
  description: string | null;
  businessUnitId: string | null;
  ownerUserId: string | null;
  lawfulBasis: string | null;
}

/** `organisationId`/`tenantId` are NEVER accepted from the caller — both
 * are re-derived here from the Engagement's own authoritative row
 * (matching `createOrganisation`'s "never trust a browser-supplied
 * scope id" posture, lib/domain/organisations.ts), which is also what
 * the composite FK (`processing_activities_engagement_organisation_
 * tenant_fk`, migration 0004) requires to hold regardless. */
export async function createProcessingActivity(
  db: RequestDb,
  userId: string,
  input: CreateProcessingActivityInput,
): Promise<{ id: string }> {
  const name = requireNonEmpty(input.name, "Name");

  const [engagement] = await db
    .select({ id: engagements.id, organisationId: engagements.organisationId, tenantId: engagements.tenantId })
    .from(engagements)
    .where(eq(engagements.id, input.engagementId))
    .limit(1);
  if (!engagement) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, engagement.id, engagement.organisationId);

  if (input.businessUnitId) {
    const [bu] = await db
      .select({ id: businessUnits.id })
      .from(businessUnits)
      .where(and(eq(businessUnits.id, input.businessUnitId), eq(businessUnits.organisationId, engagement.organisationId)))
      .limit(1);
    if (!bu) throw new CrossScopeReferenceError();
  }

  const id = randomUUID();
  await db.insert(processingActivities).values({
    id,
    engagementId: engagement.id,
    organisationId: engagement.organisationId,
    tenantId: engagement.tenantId,
    name,
    description: input.description,
    businessUnitId: input.businessUnitId,
    ownerUserId: input.ownerUserId,
    lawfulBasis: input.lawfulBasis,
    createdBy: userId,
    updatedBy: userId,
  });
  return { id };
}

export interface UpdateProcessingActivityInput {
  processingActivityId: string;
  name: string;
  description: string | null;
  businessUnitId: string | null;
  ownerUserId: string | null;
  lifecycleStatus: LifecycleStatus;
  lawfulBasis: string | null;
}

export async function updateProcessingActivity(db: RequestDb, userId: string, input: UpdateProcessingActivityInput): Promise<void> {
  const name = requireNonEmpty(input.name, "Name");

  const [pa] = await db
    .select({ id: processingActivities.id, engagementId: processingActivities.engagementId, organisationId: processingActivities.organisationId })
    .from(processingActivities)
    .where(eq(processingActivities.id, input.processingActivityId))
    .limit(1);
  if (!pa) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, pa.engagementId, pa.organisationId);

  if (input.businessUnitId) {
    const [bu] = await db
      .select({ id: businessUnits.id })
      .from(businessUnits)
      .where(and(eq(businessUnits.id, input.businessUnitId), eq(businessUnits.organisationId, pa.organisationId)))
      .limit(1);
    if (!bu) throw new CrossScopeReferenceError();
  }

  await db
    .update(processingActivities)
    .set({
      name,
      description: input.description,
      businessUnitId: input.businessUnitId,
      ownerUserId: input.ownerUserId,
      lifecycleStatus: input.lifecycleStatus,
      lawfulBasis: input.lawfulBasis,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(processingActivities.id, input.processingActivityId));
}

/**
 * Carries a Processing Activity forward into a new engagement
 * (DATA_MODEL.md §5.4): creates a NEW `ProcessingActivity` row in
 * `targetEngagementId` with `carried_forward_from_id` pointing at the
 * source row, copies the descriptive fields as a starting point, and
 * re-creates each master-data junction RE-RESOLVED to each entity's
 * CURRENT version at the time of carry-forward — never the old pin. The
 * source engagement's row, and everything it pinned to, is never
 * touched (only new rows are ever inserted here).
 */
export async function carryForwardProcessingActivity(
  db: RequestDb,
  userId: string,
  input: { sourceProcessingActivityId: string; targetEngagementId: string },
): Promise<{ id: string }> {
  const source = await getProcessingActivityDetail(db, userId, input.sourceProcessingActivityId);

  const [targetEngagement] = await db
    .select({ id: engagements.id, organisationId: engagements.organisationId, tenantId: engagements.tenantId })
    .from(engagements)
    .where(eq(engagements.id, input.targetEngagementId))
    .limit(1);
  if (!targetEngagement) throw new NotFoundOrForbiddenError();
  await requireEngagementAccess(db, userId, targetEngagement.id, targetEngagement.organisationId);

  if (targetEngagement.organisationId !== source.organisationId) {
    // Carry-forward is "the same logical activity, a later engagement
    // for the same client" — DATA_MODEL.md §5.4 never contemplates
    // carrying a Processing Activity across organisations.
    throw new CrossScopeReferenceError();
  }

  const newId = randomUUID();
  await db.insert(processingActivities).values({
    id: newId,
    engagementId: targetEngagement.id,
    organisationId: targetEngagement.organisationId,
    tenantId: targetEngagement.tenantId,
    name: source.name,
    description: source.description,
    businessUnitId: source.businessUnitId,
    ownerUserId: source.ownerUserId,
    lawfulBasis: source.lawfulBasis,
    carriedForwardFromId: source.id,
    createdBy: userId,
    updatedBy: userId,
  });

  for (const p of source.purposes) {
    await linkPurpose(db, userId, { processingActivityId: newId, purposeId: p.purposeId }).catch(ignoreCrossScopeOnCarryForward);
  }
  for (const c of source.dataPrincipalCategories) {
    await linkDataPrincipalCategory(db, userId, { processingActivityId: newId, dataPrincipalCategoryId: c.dataPrincipalCategoryId }).catch(
      ignoreCrossScopeOnCarryForward,
    );
  }
  for (const e of source.personalDataElements) {
    await linkPersonalDataElement(db, userId, {
      processingActivityId: newId,
      personalDataElementId: e.personalDataElementId,
      sensitivityNote: e.sensitivityNote,
    }).catch(ignoreCrossScopeOnCarryForward);
  }
  for (const s of source.systems) {
    await linkSystem(db, userId, { processingActivityId: newId, systemId: s.systemId }).catch(ignoreCrossScopeOnCarryForward);
  }
  for (const d of source.dataStores) {
    await linkDataStore(db, userId, { processingActivityId: newId, dataStoreId: d.dataStoreId }).catch(ignoreCrossScopeOnCarryForward);
  }
  for (const pr of source.processors) {
    await linkProcessor(db, userId, {
      processingActivityId: newId,
      processorId: pr.processorId,
      role: pr.role as ProcessorRole,
    }).catch(ignoreCrossScopeOnCarryForward);
  }

  return { id: newId };
}

/** A master-data entity retired between the source engagement and the
 * carry-forward action has no current version to re-resolve to
 * (`resolveCurrent*Version` below throws `CrossScopeReferenceError` for
 * this exact case) — carry-forward skips that one link rather than
 * failing the whole action, leaving the consultant to review and
 * re-link manually, which is the expected discovery-work step
 * DATA_MODEL.md §5.4 itself describes ("the consultant then edits from
 * there"). Any other error still propagates. */
function ignoreCrossScopeOnCarryForward(err: unknown): void {
  if (err instanceof CrossScopeReferenceError) return;
  throw err;
}

// --- Writes: relationship junctions (instructions §5/§12; DATA_MODEL.md
// §5.3's "service-layer rule" — always resolve and pin to whichever
// version is currently `is_current` at the moment of linking) ------------

async function loadProcessingActivityForLink(
  db: RequestDb,
  userId: string,
  processingActivityId: string,
): Promise<{ id: string; engagementId: string; organisationId: string }> {
  const [pa] = await db
    .select({ id: processingActivities.id, engagementId: processingActivities.engagementId, organisationId: processingActivities.organisationId })
    .from(processingActivities)
    .where(eq(processingActivities.id, processingActivityId))
    .limit(1);
  if (!pa) throw new NotFoundOrForbiddenError();
  await requireEngagementAccess(db, userId, pa.engagementId, pa.organisationId);
  return pa;
}

export async function linkPurpose(db: RequestDb, userId: string, input: { processingActivityId: string; purposeId: string }): Promise<{ id: string }> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);

  const [version] = await db
    .select({ id: purposeVersions.id })
    .from(purposeVersions)
    .where(and(eq(purposeVersions.purposeId, input.purposeId), eq(purposeVersions.organisationId, pa.organisationId), eq(purposeVersions.isCurrent, true)))
    .limit(1);
  if (!version) throw new CrossScopeReferenceError();

  const [existing] = await db
    .select({ id: processingActivityPurposes.id })
    .from(processingActivityPurposes)
    .where(and(eq(processingActivityPurposes.processingActivityId, pa.id), eq(processingActivityPurposes.purposeId, input.purposeId)))
    .limit(1);
  if (existing) throw new DuplicateLinkError();

  const id = randomUUID();
  await db.insert(processingActivityPurposes).values({
    id,
    processingActivityId: pa.id,
    engagementId: pa.engagementId,
    organisationId: pa.organisationId,
    purposeId: input.purposeId,
    purposeVersionId: version.id,
    createdBy: userId,
  });
  return { id };
}

export async function unlinkPurpose(db: RequestDb, userId: string, input: { processingActivityId: string; purposeId: string }): Promise<void> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);
  await db
    .delete(processingActivityPurposes)
    .where(and(eq(processingActivityPurposes.processingActivityId, pa.id), eq(processingActivityPurposes.purposeId, input.purposeId)));
}

export async function linkDataPrincipalCategory(
  db: RequestDb,
  userId: string,
  input: { processingActivityId: string; dataPrincipalCategoryId: string },
): Promise<{ id: string }> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);

  const [version] = await db
    .select({ id: dataPrincipalCategoryVersions.id })
    .from(dataPrincipalCategoryVersions)
    .where(
      and(
        eq(dataPrincipalCategoryVersions.dataPrincipalCategoryId, input.dataPrincipalCategoryId),
        eq(dataPrincipalCategoryVersions.organisationId, pa.organisationId),
        eq(dataPrincipalCategoryVersions.isCurrent, true),
      ),
    )
    .limit(1);
  if (!version) throw new CrossScopeReferenceError();

  const [existing] = await db
    .select({ id: processingActivityDataPrincipalCategories.id })
    .from(processingActivityDataPrincipalCategories)
    .where(
      and(
        eq(processingActivityDataPrincipalCategories.processingActivityId, pa.id),
        eq(processingActivityDataPrincipalCategories.dataPrincipalCategoryId, input.dataPrincipalCategoryId),
      ),
    )
    .limit(1);
  if (existing) throw new DuplicateLinkError();

  const id = randomUUID();
  await db.insert(processingActivityDataPrincipalCategories).values({
    id,
    processingActivityId: pa.id,
    engagementId: pa.engagementId,
    organisationId: pa.organisationId,
    dataPrincipalCategoryId: input.dataPrincipalCategoryId,
    dataPrincipalCategoryVersionId: version.id,
    createdBy: userId,
  });
  return { id };
}

export async function unlinkDataPrincipalCategory(
  db: RequestDb,
  userId: string,
  input: { processingActivityId: string; dataPrincipalCategoryId: string },
): Promise<void> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);
  await db
    .delete(processingActivityDataPrincipalCategories)
    .where(
      and(
        eq(processingActivityDataPrincipalCategories.processingActivityId, pa.id),
        eq(processingActivityDataPrincipalCategories.dataPrincipalCategoryId, input.dataPrincipalCategoryId),
      ),
    );
}

export async function linkPersonalDataElement(
  db: RequestDb,
  userId: string,
  input: { processingActivityId: string; personalDataElementId: string; sensitivityNote: string | null },
): Promise<{ id: string }> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);

  const [version] = await db
    .select({ id: personalDataElementVersions.id })
    .from(personalDataElementVersions)
    .where(
      and(
        eq(personalDataElementVersions.personalDataElementId, input.personalDataElementId),
        eq(personalDataElementVersions.organisationId, pa.organisationId),
        eq(personalDataElementVersions.isCurrent, true),
      ),
    )
    .limit(1);
  if (!version) throw new CrossScopeReferenceError();

  const [existing] = await db
    .select({ id: processingActivityPersonalDataElements.id })
    .from(processingActivityPersonalDataElements)
    .where(
      and(
        eq(processingActivityPersonalDataElements.processingActivityId, pa.id),
        eq(processingActivityPersonalDataElements.personalDataElementId, input.personalDataElementId),
      ),
    )
    .limit(1);
  if (existing) throw new DuplicateLinkError();

  const id = randomUUID();
  await db.insert(processingActivityPersonalDataElements).values({
    id,
    processingActivityId: pa.id,
    engagementId: pa.engagementId,
    organisationId: pa.organisationId,
    personalDataElementId: input.personalDataElementId,
    personalDataElementVersionId: version.id,
    sensitivityNote: input.sensitivityNote,
    createdBy: userId,
  });
  return { id };
}

export async function unlinkPersonalDataElement(
  db: RequestDb,
  userId: string,
  input: { processingActivityId: string; personalDataElementId: string },
): Promise<void> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);
  await db
    .delete(processingActivityPersonalDataElements)
    .where(
      and(
        eq(processingActivityPersonalDataElements.processingActivityId, pa.id),
        eq(processingActivityPersonalDataElements.personalDataElementId, input.personalDataElementId),
      ),
    );
}

export async function linkSystem(db: RequestDb, userId: string, input: { processingActivityId: string; systemId: string }): Promise<{ id: string }> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);

  const [version] = await db
    .select({ id: systemVersions.id })
    .from(systemVersions)
    .where(and(eq(systemVersions.systemId, input.systemId), eq(systemVersions.organisationId, pa.organisationId), eq(systemVersions.isCurrent, true)))
    .limit(1);
  if (!version) throw new CrossScopeReferenceError();

  const [existing] = await db
    .select({ id: processingActivitySystems.id })
    .from(processingActivitySystems)
    .where(and(eq(processingActivitySystems.processingActivityId, pa.id), eq(processingActivitySystems.systemId, input.systemId)))
    .limit(1);
  if (existing) throw new DuplicateLinkError();

  const id = randomUUID();
  await db.insert(processingActivitySystems).values({
    id,
    processingActivityId: pa.id,
    engagementId: pa.engagementId,
    organisationId: pa.organisationId,
    systemId: input.systemId,
    systemVersionId: version.id,
    createdBy: userId,
  });
  return { id };
}

export async function unlinkSystem(db: RequestDb, userId: string, input: { processingActivityId: string; systemId: string }): Promise<void> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);
  await db
    .delete(processingActivitySystems)
    .where(and(eq(processingActivitySystems.processingActivityId, pa.id), eq(processingActivitySystems.systemId, input.systemId)));
}

export async function linkDataStore(db: RequestDb, userId: string, input: { processingActivityId: string; dataStoreId: string }): Promise<{ id: string }> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);

  const [version] = await db
    .select({ id: dataStoreVersions.id })
    .from(dataStoreVersions)
    .where(
      and(eq(dataStoreVersions.dataStoreId, input.dataStoreId), eq(dataStoreVersions.organisationId, pa.organisationId), eq(dataStoreVersions.isCurrent, true)),
    )
    .limit(1);
  if (!version) throw new CrossScopeReferenceError();

  const [existing] = await db
    .select({ id: processingActivityDataStores.id })
    .from(processingActivityDataStores)
    .where(and(eq(processingActivityDataStores.processingActivityId, pa.id), eq(processingActivityDataStores.dataStoreId, input.dataStoreId)))
    .limit(1);
  if (existing) throw new DuplicateLinkError();

  const id = randomUUID();
  await db.insert(processingActivityDataStores).values({
    id,
    processingActivityId: pa.id,
    engagementId: pa.engagementId,
    organisationId: pa.organisationId,
    dataStoreId: input.dataStoreId,
    dataStoreVersionId: version.id,
    createdBy: userId,
  });
  return { id };
}

export async function unlinkDataStore(db: RequestDb, userId: string, input: { processingActivityId: string; dataStoreId: string }): Promise<void> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);
  await db
    .delete(processingActivityDataStores)
    .where(and(eq(processingActivityDataStores.processingActivityId, pa.id), eq(processingActivityDataStores.dataStoreId, input.dataStoreId)));
}

export async function linkProcessor(
  db: RequestDb,
  userId: string,
  input: { processingActivityId: string; processorId: string; role: ProcessorRole },
): Promise<{ id: string }> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);

  const [version] = await db
    .select({ id: processorVersions.id })
    .from(processorVersions)
    .where(
      and(eq(processorVersions.processorId, input.processorId), eq(processorVersions.organisationId, pa.organisationId), eq(processorVersions.isCurrent, true)),
    )
    .limit(1);
  if (!version) throw new CrossScopeReferenceError();

  const [existing] = await db
    .select({ id: processingActivityProcessors.id })
    .from(processingActivityProcessors)
    .where(and(eq(processingActivityProcessors.processingActivityId, pa.id), eq(processingActivityProcessors.processorId, input.processorId)))
    .limit(1);
  if (existing) throw new DuplicateLinkError();

  const id = randomUUID();
  await db.insert(processingActivityProcessors).values({
    id,
    processingActivityId: pa.id,
    engagementId: pa.engagementId,
    organisationId: pa.organisationId,
    processorId: input.processorId,
    processorVersionId: version.id,
    role: input.role,
    createdBy: userId,
  });
  return { id };
}

export async function unlinkProcessor(db: RequestDb, userId: string, input: { processingActivityId: string; processorId: string }): Promise<void> {
  const pa = await loadProcessingActivityForLink(db, userId, input.processingActivityId);
  await db
    .delete(processingActivityProcessors)
    .where(and(eq(processingActivityProcessors.processingActivityId, pa.id), eq(processingActivityProcessors.processorId, input.processorId)));
}
