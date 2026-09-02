import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  regulatoryReferences,
  requirements,
  controlLibraryVersions,
  controls,
  controlRequirements,
} from "@/db/schema";
import {
  NotFoundOrForbiddenError,
  getUserTenantId,
  requireTenantAccess,
  requireMethodologyManageAccess,
} from "@/lib/authorization/service";

// Slice D1 — Control Library Authoring. Builds the application layer on
// top of the EXACT existing Regulatory Content & Control Library model
// (Milestone 4, migrations 0006/0007) — no new table, no new column, no
// second versioning mechanism. Ownership is Tenant/practice-owned
// (verified by direct inspection: every table here carries `tenant_id`
// directly, not `organisation_id`) — preserved unchanged, per
// instruction. The draft → published → retired lifecycle, publish-
// immutability, draft-mutable guards, reparenting guards, and audit
// logging are ALL already fully built and enforced at the database
// layer (migration 0007) — this module's own domain functions are
// mostly a thin, authorized front door onto writes the database itself
// already knows how to accept or reject; see each function's own
// docstring for exactly which validation is genuinely new here versus
// already guaranteed by construction.
//
// Requirements are deliberately NOT re-created per library version
// (DECISIONS.md R-43): a Requirement is shared, tenant-wide reference
// content a Control from ANY library version may map to over time.
// `cloneControlLibraryVersion` below therefore only ever creates new
// Control rows (with fresh ids, in the new draft version) and new
// ControlRequirement mappings pointing at the SAME existing Requirement
// rows — never duplicate Requirements/RegulatoryReferences.

export class InvalidControlLibraryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidControlLibraryInputError";
  }
}

export class ControlLibraryVersionNotDraftError extends Error {
  constructor(message = "This control library version is no longer a draft and can no longer be edited.") {
    super(message);
    this.name = "ControlLibraryVersionNotDraftError";
  }
}

export class ControlLibraryVersionNotPublishedError extends Error {
  constructor(message = "Only a published control library version can be used as the source for a new version.") {
    super(message);
    this.name = "ControlLibraryVersionNotPublishedError";
  }
}

export class DuplicateVersionLabelError extends Error {
  constructor(message = "A control library version with this label already exists.") {
    super(message);
    this.name = "DuplicateVersionLabelError";
  }
}

export class DuplicateControlCodeError extends Error {
  constructor(message = "A control with this code already exists in this library version.") {
    super(message);
    this.name = "DuplicateControlCodeError";
  }
}

export class CrossTenantAssociationError extends Error {
  constructor(message = "This requirement does not belong to the same practice as this control.") {
    super(message);
    this.name = "CrossTenantAssociationError";
  }
}

const CONTROL_TYPES = ["preventive", "detective", "corrective"] as const;
type ControlType = (typeof CONTROL_TYPES)[number];

// --- Reads ------------------------------------------------------------

export interface ControlLibraryVersionSummary {
  id: string;
  versionLabel: string;
  status: string;
  createdAt: Date;
  publishedAt: Date | null;
  controlCount: number;
}

/**
 * The Control Library list (instructions §4): every version belonging
 * to the caller's own tenant, most recent first, with a plain control
 * count (a real, cheap COUNT — not an invented metric). Read access is
 * gated by `requireTenantAccess` — the existing, narrower-than-RLS
 * application-layer check (only literal `TenantMembership` holders
 * today; RLS's own `can_access_tenant` is broader). This is a
 * deliberate, documented scope boundary for this slice — see
 * DECISIONS.md — not an oversight: this task's actual ask is the
 * AUTHORING capability (Platform Administrator/Practice Partner, both
 * of which hold `TenantMembership`), not broadening read access for
 * every engagement-scoped role, which PRODUCT_UX_BLUEPRINT.md §8 does
 * envision but is out of this slice's scope.
 */
export async function listControlLibraryVersions(db: RequestDb, userId: string): Promise<ControlLibraryVersionSummary[]> {
  const tenantId = await getUserTenantId(db, userId);
  if (!tenantId) return [];
  await requireTenantAccess(db, userId, tenantId);

  const versions = await db
    .select({
      id: controlLibraryVersions.id,
      versionLabel: controlLibraryVersions.versionLabel,
      status: controlLibraryVersions.status,
      createdAt: controlLibraryVersions.createdAt,
      publishedAt: controlLibraryVersions.publishedAt,
    })
    .from(controlLibraryVersions)
    .where(eq(controlLibraryVersions.tenantId, tenantId))
    .orderBy(desc(controlLibraryVersions.createdAt));

  if (versions.length === 0) return [];

  const controlRows = await db
    .select({ id: controls.id, controlLibraryVersionId: controls.controlLibraryVersionId })
    .from(controls)
    .where(
      inArray(
        controls.controlLibraryVersionId,
        versions.map((v) => v.id),
      ),
    );
  const countByVersion = new Map<string, number>();
  for (const c of controlRows) {
    countByVersion.set(c.controlLibraryVersionId, (countByVersion.get(c.controlLibraryVersionId) ?? 0) + 1);
  }

  return versions.map((v) => ({ ...v, controlCount: countByVersion.get(v.id) ?? 0 }));
}

export interface ControlLibraryVersionControlRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  controlType: string;
  requirements: Array<{ id: string; title: string }>;
}

export interface ControlLibraryVersionDetail {
  id: string;
  tenantId: string;
  versionLabel: string;
  status: string;
  createdAt: Date;
  publishedAt: Date | null;
  controlRows: ControlLibraryVersionControlRow[];
}

/** The version detail view (instructions §4): metadata, every Control
 * in this version (code order — matches the Assessment workspace's own
 * `getAssessmentDetail` control ordering), and each Control's
 * associated Requirements. */
export async function getControlLibraryVersionDetail(
  db: RequestDb,
  userId: string,
  versionId: string,
): Promise<ControlLibraryVersionDetail> {
  const [version] = await db
    .select({
      id: controlLibraryVersions.id,
      tenantId: controlLibraryVersions.tenantId,
      versionLabel: controlLibraryVersions.versionLabel,
      status: controlLibraryVersions.status,
      createdAt: controlLibraryVersions.createdAt,
      publishedAt: controlLibraryVersions.publishedAt,
    })
    .from(controlLibraryVersions)
    .where(eq(controlLibraryVersions.id, versionId))
    .limit(1);
  if (!version) throw new NotFoundOrForbiddenError();

  await requireTenantAccess(db, userId, version.tenantId);

  const controlRows = await db
    .select({
      id: controls.id,
      code: controls.code,
      title: controls.title,
      description: controls.description,
      controlType: controls.controlType,
    })
    .from(controls)
    .where(eq(controls.controlLibraryVersionId, versionId))
    .orderBy(asc(controls.code));

  const requirementRows = controlRows.length
    ? await db
        .select({ controlId: controlRequirements.controlId, requirementId: requirements.id, requirementTitle: requirements.title })
        .from(controlRequirements)
        .innerJoin(requirements, eq(requirements.id, controlRequirements.requirementId))
        .where(
          inArray(
            controlRequirements.controlId,
            controlRows.map((c) => c.id),
          ),
        )
    : [];

  const reqByControl = new Map<string, Array<{ id: string; title: string }>>();
  for (const r of requirementRows) {
    const list = reqByControl.get(r.controlId) ?? [];
    list.push({ id: r.requirementId, title: r.requirementTitle });
    reqByControl.set(r.controlId, list);
  }

  return {
    ...version,
    controlRows: controlRows.map((c) => ({ ...c, requirements: reqByControl.get(c.id) ?? [] })),
  };
}

export interface ControlDetail {
  id: string;
  tenantId: string;
  controlLibraryVersionId: string;
  versionLabel: string;
  versionStatus: string;
  code: string;
  title: string;
  description: string | null;
  controlType: string;
  requirements: Array<{ id: string; title: string }>;
}

/** The single-Control edit view (instructions §5): the Control's own
 * fields, its parent version's status (so the UI can tell whether it's
 * still editable without a second round trip), and its current
 * Requirement associations. */
export async function getControlDetail(db: RequestDb, userId: string, controlId: string): Promise<ControlDetail> {
  const [row] = await db
    .select({
      id: controls.id,
      tenantId: controls.tenantId,
      controlLibraryVersionId: controls.controlLibraryVersionId,
      versionLabel: controlLibraryVersions.versionLabel,
      versionStatus: controlLibraryVersions.status,
      code: controls.code,
      title: controls.title,
      description: controls.description,
      controlType: controls.controlType,
    })
    .from(controls)
    .innerJoin(controlLibraryVersions, eq(controlLibraryVersions.id, controls.controlLibraryVersionId))
    .where(eq(controls.id, controlId))
    .limit(1);
  if (!row) throw new NotFoundOrForbiddenError();

  await requireTenantAccess(db, userId, row.tenantId);

  const reqRows = await db
    .select({ id: requirements.id, title: requirements.title })
    .from(controlRequirements)
    .innerJoin(requirements, eq(requirements.id, controlRequirements.requirementId))
    .where(eq(controlRequirements.controlId, controlId))
    .orderBy(asc(requirements.title));

  return { ...row, requirements: reqRows };
}

export interface RequirementOption {
  id: string;
  title: string;
  regulatoryReferenceTitle: string;
  status: string;
}

/** For the "associate with requirement" picker and any requirement
 * cross-reference in the UI — every Requirement belonging to the
 * caller's own tenant, regardless of which (if any) library version's
 * Controls currently map to it (Requirements are tenant-wide reference
 * content, DECISIONS.md R-43, never library-version-scoped). */
export async function listRequirements(db: RequestDb, userId: string): Promise<RequirementOption[]> {
  const tenantId = await getUserTenantId(db, userId);
  if (!tenantId) return [];
  await requireTenantAccess(db, userId, tenantId);

  return db
    .select({
      id: requirements.id,
      title: requirements.title,
      regulatoryReferenceTitle: regulatoryReferences.title,
      status: requirements.status,
    })
    .from(requirements)
    .innerJoin(regulatoryReferences, eq(regulatoryReferences.id, requirements.primaryRegulatoryReferenceId))
    .where(eq(requirements.tenantId, tenantId))
    .orderBy(asc(requirements.title));
}

export interface RegulatoryReferenceOption {
  id: string;
  title: string;
  frameworkName: string;
  status: string;
}

/** For the "create requirement" form's own RegulatoryReference picker. */
export async function listRegulatoryReferences(db: RequestDb, userId: string): Promise<RegulatoryReferenceOption[]> {
  const tenantId = await getUserTenantId(db, userId);
  if (!tenantId) return [];
  await requireTenantAccess(db, userId, tenantId);

  return db
    .select({
      id: regulatoryReferences.id,
      title: regulatoryReferences.title,
      frameworkName: regulatoryReferences.frameworkName,
      status: regulatoryReferences.status,
    })
    .from(regulatoryReferences)
    .where(eq(regulatoryReferences.tenantId, tenantId))
    .orderBy(asc(regulatoryReferences.title));
}

// --- Writes: Regulatory content (instructions §1, always editable —
// DECISIONS.md R-44: RegulatoryReference/Requirement carry a simple
// active/retired status, never gated by the draft/published/retired
// ControlLibraryVersion lifecycle) --------------------------------------

export interface CreateRegulatoryReferenceInput {
  frameworkName: string;
  citation: string;
  title: string;
  version: string | null;
}

/** `tenantId` is always the CALLER's own home tenant
 * (`getUserTenantId`, read via the caller's own `users` row — never a
 * value the caller supplies), matching every other creation-of-a-new-
 * root-object function in this codebase (`createOrganisation`,
 * `lib/domain/organisations.ts`). */
export async function createRegulatoryReference(
  db: RequestDb,
  userId: string,
  input: CreateRegulatoryReferenceInput,
): Promise<{ id: string }> {
  if (!input.frameworkName.trim()) throw new InvalidControlLibraryInputError("Framework name is required.");
  if (!input.citation.trim()) throw new InvalidControlLibraryInputError("Citation is required.");
  if (!input.title.trim()) throw new InvalidControlLibraryInputError("Title is required.");

  const tenantId = await getUserTenantId(db, userId);
  if (!tenantId) throw new NotFoundOrForbiddenError();
  await requireMethodologyManageAccess(db, userId, tenantId);

  const id = randomUUID();
  await db.insert(regulatoryReferences).values({
    id,
    tenantId,
    frameworkName: input.frameworkName.trim(),
    citation: input.citation.trim(),
    title: input.title.trim(),
    version: input.version?.trim() ? input.version.trim() : null,
    createdBy: userId,
    updatedBy: userId,
  });
  return { id };
}

export interface CreateRequirementInput {
  primaryRegulatoryReferenceId: string;
  title: string;
  description: string | null;
}

export async function createRequirement(db: RequestDb, userId: string, input: CreateRequirementInput): Promise<{ id: string }> {
  if (!input.title.trim()) throw new InvalidControlLibraryInputError("Title is required.");

  const [ref] = await db
    .select({ id: regulatoryReferences.id, tenantId: regulatoryReferences.tenantId })
    .from(regulatoryReferences)
    .where(eq(regulatoryReferences.id, input.primaryRegulatoryReferenceId))
    .limit(1);
  if (!ref) throw new NotFoundOrForbiddenError();

  await requireMethodologyManageAccess(db, userId, ref.tenantId);

  const id = randomUUID();
  await db.insert(requirements).values({
    id,
    tenantId: ref.tenantId,
    primaryRegulatoryReferenceId: input.primaryRegulatoryReferenceId,
    title: input.title.trim(),
    description: input.description,
    createdBy: userId,
    updatedBy: userId,
  });
  return { id };
}

// --- Writes: Control Library Version -----------------------------------

export async function createControlLibraryVersion(db: RequestDb, userId: string, input: { versionLabel: string }): Promise<{ id: string }> {
  if (!input.versionLabel.trim()) throw new InvalidControlLibraryInputError("Version label is required.");

  const tenantId = await getUserTenantId(db, userId);
  if (!tenantId) throw new NotFoundOrForbiddenError();
  await requireMethodologyManageAccess(db, userId, tenantId);

  // Pre-check for a clean error — `control_library_versions_tenant_id_
  // version_label_key` (migration 0006) is the real, database-level
  // enforcement regardless (the same "pre-check for a clean error, the
  // constraint is the real enforcement" pattern used throughout this
  // codebase since Slice A1).
  const [existing] = await db
    .select({ id: controlLibraryVersions.id })
    .from(controlLibraryVersions)
    .where(and(eq(controlLibraryVersions.tenantId, tenantId), ilike(controlLibraryVersions.versionLabel, input.versionLabel.trim())))
    .limit(1);
  if (existing) throw new DuplicateVersionLabelError();

  const id = randomUUID();
  await db.insert(controlLibraryVersions).values({
    id,
    tenantId,
    versionLabel: input.versionLabel.trim(),
    createdBy: userId,
    updatedBy: userId,
  });
  return { id };
}

/**
 * Creates a new DRAFT version by copying a PUBLISHED version's Controls
 * (fresh ids, same code/title/description/controlType) and their
 * Requirement associations (instructions §4: "if the current
 * versioning architecture expects cloning, implement cloning through
 * the existing domain model... do not clone unrelated tenant/client
 * data"). Deliberately does NOT copy or duplicate RegulatoryReferences
 * or Requirements themselves — those are shared, tenant-wide reference
 * content a Control from any version may map to (DECISIONS.md R-43);
 * the new Controls are linked to the exact SAME Requirement rows the
 * source version's Controls were linked to, not new copies. The source
 * version itself is never touched — this function only ever INSERTs
 * new rows.
 */
export async function cloneControlLibraryVersion(
  db: RequestDb,
  userId: string,
  input: { sourceVersionId: string; newVersionLabel: string },
): Promise<{ id: string }> {
  if (!input.newVersionLabel.trim()) throw new InvalidControlLibraryInputError("Version label is required.");

  const [source] = await db
    .select({ id: controlLibraryVersions.id, tenantId: controlLibraryVersions.tenantId, status: controlLibraryVersions.status })
    .from(controlLibraryVersions)
    .where(eq(controlLibraryVersions.id, input.sourceVersionId))
    .limit(1);
  if (!source) throw new NotFoundOrForbiddenError();

  await requireMethodologyManageAccess(db, userId, source.tenantId);

  if (source.status !== "published") {
    throw new ControlLibraryVersionNotPublishedError();
  }

  const [existingLabel] = await db
    .select({ id: controlLibraryVersions.id })
    .from(controlLibraryVersions)
    .where(and(eq(controlLibraryVersions.tenantId, source.tenantId), ilike(controlLibraryVersions.versionLabel, input.newVersionLabel.trim())))
    .limit(1);
  if (existingLabel) throw new DuplicateVersionLabelError();

  const newVersionId = randomUUID();
  await db.insert(controlLibraryVersions).values({
    id: newVersionId,
    tenantId: source.tenantId,
    versionLabel: input.newVersionLabel.trim(),
    createdBy: userId,
    updatedBy: userId,
  });

  const sourceControls = await db
    .select({
      id: controls.id,
      code: controls.code,
      title: controls.title,
      description: controls.description,
      controlType: controls.controlType,
    })
    .from(controls)
    .where(eq(controls.controlLibraryVersionId, input.sourceVersionId));

  const idMap = new Map<string, string>();
  for (const c of sourceControls) {
    const newControlId = randomUUID();
    idMap.set(c.id, newControlId);
    await db.insert(controls).values({
      id: newControlId,
      tenantId: source.tenantId,
      controlLibraryVersionId: newVersionId,
      code: c.code,
      title: c.title,
      description: c.description,
      controlType: c.controlType,
      createdBy: userId,
      updatedBy: userId,
    });
  }

  if (sourceControls.length > 0) {
    const mappings = await db
      .select({ controlId: controlRequirements.controlId, requirementId: controlRequirements.requirementId })
      .from(controlRequirements)
      .where(
        inArray(
          controlRequirements.controlId,
          sourceControls.map((c) => c.id),
        ),
      );

    for (const m of mappings) {
      const newControlId = idMap.get(m.controlId);
      if (!newControlId) continue;
      await db.insert(controlRequirements).values({
        id: randomUUID(),
        tenantId: source.tenantId,
        controlId: newControlId,
        requirementId: m.requirementId,
        createdBy: userId,
      });
    }
  }

  return { id: newVersionId };
}

/**
 * Publishes a draft version (instructions §6's 8-step checklist):
 *   1. re-load the authoritative version fresh from the database — done
 *      below, never trusts a caller-supplied status/tenant.
 *   2. authorize the current user — `requireMethodologyManageAccess`,
 *      against the version's OWN tenant (never a caller-claimed one).
 *   3. verify still draft — pre-checked below for a clean error; the
 *      real, unconditional enforcement is migration 0007's
 *      `prevent_control_library_version_tampering` trigger regardless.
 *   4. validate required metadata — `version_label` is `NOT NULL` and
 *      always trimmed at creation (`createControlLibraryVersion`
 *      above), so this can never actually be empty by the time a row
 *      reaches here; checked anyway, defensively.
 *   5-7. validate control integrity / requirement-control relationships
 *      / reject invalid or cross-tenant associations — already
 *      guaranteed BY CONSTRUCTION, not re-validated here: every Control
 *      row's required columns are `NOT NULL` at the database level, and
 *      `control_requirements`' own composite FKs
 *      (`control_requirements_control_tenant_fk`/`..._requirement_
 *      tenant_fk`, migration 0006) make a cross-tenant association
 *      structurally impossible to have ever been inserted — `create
 *      Control`/`associateControlRequirement` below both also pre-check
 *      this at write time for a clean error, so nothing invalid can
 *      reach this point to be caught here. A version with zero Controls
 *      is a real, valid state (matches `getAssessmentDetail`'s own
 *      identical, already-established posture,
 *      lib/domain/assessments.ts) — no invented "must have N controls"
 *      minimum.
 *   8. publish transactionally — the UPDATE below, inside the same
 *      `withRequestDb` transaction the caller already opened; `publish
 *      ed_at` is stamped automatically by the trigger, never set
 *      directly here.
 */
export async function publishControlLibraryVersion(db: RequestDb, userId: string, input: { versionId: string }): Promise<void> {
  const [version] = await db
    .select({
      id: controlLibraryVersions.id,
      tenantId: controlLibraryVersions.tenantId,
      status: controlLibraryVersions.status,
      versionLabel: controlLibraryVersions.versionLabel,
    })
    .from(controlLibraryVersions)
    .where(eq(controlLibraryVersions.id, input.versionId))
    .limit(1);
  if (!version) throw new NotFoundOrForbiddenError();

  await requireMethodologyManageAccess(db, userId, version.tenantId);

  if (version.status !== "draft") {
    throw new ControlLibraryVersionNotDraftError();
  }
  if (!version.versionLabel.trim()) {
    throw new InvalidControlLibraryInputError("Version label is required before publishing.");
  }

  await db
    .update(controlLibraryVersions)
    .set({ status: "published", updatedBy: userId, updatedAt: new Date() })
    .where(eq(controlLibraryVersions.id, input.versionId));
}

// --- Writes: Control (instructions §5 — only while the containing
// version is 'draft'; migration 0007's `enforce_control_draft_mutable`
// trigger is the real, unconditional backstop for every function below,
// independent of whatever this module itself pre-checks) ---------------

export interface CreateControlInput {
  controlLibraryVersionId: string;
  code: string;
  title: string;
  description: string | null;
  controlType: ControlType;
}

export async function createControl(db: RequestDb, userId: string, input: CreateControlInput): Promise<{ id: string }> {
  if (!input.code.trim()) throw new InvalidControlLibraryInputError("Control code is required.");
  if (!input.title.trim()) throw new InvalidControlLibraryInputError("Control title is required.");
  if (!CONTROL_TYPES.includes(input.controlType)) throw new InvalidControlLibraryInputError("Invalid control type.");

  const [version] = await db
    .select({ id: controlLibraryVersions.id, tenantId: controlLibraryVersions.tenantId, status: controlLibraryVersions.status })
    .from(controlLibraryVersions)
    .where(eq(controlLibraryVersions.id, input.controlLibraryVersionId))
    .limit(1);
  if (!version) throw new NotFoundOrForbiddenError();

  await requireMethodologyManageAccess(db, userId, version.tenantId);

  if (version.status !== "draft") {
    throw new ControlLibraryVersionNotDraftError();
  }

  const [existing] = await db
    .select({ id: controls.id })
    .from(controls)
    .where(and(eq(controls.controlLibraryVersionId, input.controlLibraryVersionId), ilike(controls.code, input.code.trim())))
    .limit(1);
  if (existing) throw new DuplicateControlCodeError();

  const id = randomUUID();
  await db.insert(controls).values({
    id,
    tenantId: version.tenantId,
    controlLibraryVersionId: input.controlLibraryVersionId,
    code: input.code.trim(),
    title: input.title.trim(),
    description: input.description,
    controlType: input.controlType,
    createdBy: userId,
    updatedBy: userId,
  });
  return { id };
}

export interface UpdateControlInput {
  controlId: string;
  code: string;
  title: string;
  description: string | null;
  controlType: ControlType;
}

export async function updateControl(db: RequestDb, userId: string, input: UpdateControlInput): Promise<void> {
  if (!input.code.trim()) throw new InvalidControlLibraryInputError("Control code is required.");
  if (!input.title.trim()) throw new InvalidControlLibraryInputError("Control title is required.");
  if (!CONTROL_TYPES.includes(input.controlType)) throw new InvalidControlLibraryInputError("Invalid control type.");

  const [row] = await db
    .select({
      id: controls.id,
      tenantId: controls.tenantId,
      controlLibraryVersionId: controls.controlLibraryVersionId,
      versionStatus: controlLibraryVersions.status,
    })
    .from(controls)
    .innerJoin(controlLibraryVersions, eq(controlLibraryVersions.id, controls.controlLibraryVersionId))
    .where(eq(controls.id, input.controlId))
    .limit(1);
  if (!row) throw new NotFoundOrForbiddenError();

  await requireMethodologyManageAccess(db, userId, row.tenantId);

  if (row.versionStatus !== "draft") {
    throw new ControlLibraryVersionNotDraftError();
  }

  const [existing] = await db
    .select({ id: controls.id })
    .from(controls)
    .where(and(eq(controls.controlLibraryVersionId, row.controlLibraryVersionId), ilike(controls.code, input.code.trim())))
    .limit(1);
  if (existing && existing.id !== input.controlId) throw new DuplicateControlCodeError();

  await db
    .update(controls)
    .set({
      code: input.code.trim(),
      title: input.title.trim(),
      description: input.description,
      controlType: input.controlType,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(controls.id, input.controlId));
}

/**
 * A real, hard DELETE — supported here (unlike most entities in this
 * codebase, which use status/retirement instead) because the schema
 * itself already grants it (migration 0007's `controls_delete` RLS
 * policy and `GRANT ... DELETE ON controls`) and it is provably safe:
 * a Control can only ever be deleted while its own ControlLibraryVersion
 * is still 'draft' (the `enforce_control_draft_mutable` trigger), and
 * an Assessment can only ever pin to a 'published' or 'retired' version
 * (`prevent_engagement_control_library_pin_change`, migration 0007) —
 * so a draft-version Control can never yet have any AssessmentControl/
 * Risk/downstream reference by construction. Instructions §5's own
 * "if controls have downstream references that make deletion unsafe, do
 * not implement destructive deletion" condition is checked here and
 * genuinely does not apply.
 */
export async function deleteControl(db: RequestDb, userId: string, input: { controlId: string }): Promise<void> {
  const [row] = await db
    .select({ id: controls.id, tenantId: controls.tenantId, versionStatus: controlLibraryVersions.status })
    .from(controls)
    .innerJoin(controlLibraryVersions, eq(controlLibraryVersions.id, controls.controlLibraryVersionId))
    .where(eq(controls.id, input.controlId))
    .limit(1);
  if (!row) throw new NotFoundOrForbiddenError();

  await requireMethodologyManageAccess(db, userId, row.tenantId);

  if (row.versionStatus !== "draft") {
    throw new ControlLibraryVersionNotDraftError();
  }

  await db.delete(controls).where(eq(controls.id, input.controlId));
}

// --- Writes: Control-Requirement association ----------------------------

/** Idempotent — associating an already-associated pair is a no-op
 * success, not an error (matches `linkControlRequirement`'s own
 * unique-mapping constraint, migration 0006, being the real backstop
 * either way). */
export async function associateControlRequirement(
  db: RequestDb,
  userId: string,
  input: { controlId: string; requirementId: string },
): Promise<{ id: string }> {
  const [control] = await db
    .select({ id: controls.id, tenantId: controls.tenantId, versionStatus: controlLibraryVersions.status })
    .from(controls)
    .innerJoin(controlLibraryVersions, eq(controlLibraryVersions.id, controls.controlLibraryVersionId))
    .where(eq(controls.id, input.controlId))
    .limit(1);
  if (!control) throw new NotFoundOrForbiddenError();

  await requireMethodologyManageAccess(db, userId, control.tenantId);

  if (control.versionStatus !== "draft") {
    throw new ControlLibraryVersionNotDraftError();
  }

  const [requirement] = await db
    .select({ id: requirements.id, tenantId: requirements.tenantId })
    .from(requirements)
    .where(eq(requirements.id, input.requirementId))
    .limit(1);
  if (!requirement || requirement.tenantId !== control.tenantId) {
    // instructions §5/§9: "prevent cross-library/cross-tenant
    // associations." The only genuine cross-boundary risk this schema
    // has is cross-TENANT — Requirements are deliberately NOT
    // ControlLibraryVersion-scoped (DECISIONS.md R-43: a Requirement
    // legitimately spans many library versions over time, so there is
    // no "cross-library" violation to reject for requirements
    // specifically) — checked explicitly here for a clean error rather
    // than relying solely on the composite FK
    // (`control_requirements_requirement_tenant_fk`) that already makes
    // this structurally impossible to persist regardless.
    throw new CrossTenantAssociationError();
  }

  const [existing] = await db
    .select({ id: controlRequirements.id })
    .from(controlRequirements)
    .where(and(eq(controlRequirements.controlId, input.controlId), eq(controlRequirements.requirementId, input.requirementId)))
    .limit(1);
  if (existing) return { id: existing.id };

  const id = randomUUID();
  await db.insert(controlRequirements).values({
    id,
    tenantId: control.tenantId,
    controlId: input.controlId,
    requirementId: input.requirementId,
    createdBy: userId,
  });
  return { id };
}

export async function dissociateControlRequirement(db: RequestDb, userId: string, input: { controlId: string; requirementId: string }): Promise<void> {
  const [control] = await db
    .select({ id: controls.id, tenantId: controls.tenantId, versionStatus: controlLibraryVersions.status })
    .from(controls)
    .innerJoin(controlLibraryVersions, eq(controlLibraryVersions.id, controls.controlLibraryVersionId))
    .where(eq(controls.id, input.controlId))
    .limit(1);
  if (!control) throw new NotFoundOrForbiddenError();

  await requireMethodologyManageAccess(db, userId, control.tenantId);

  if (control.versionStatus !== "draft") {
    throw new ControlLibraryVersionNotDraftError();
  }

  await db
    .delete(controlRequirements)
    .where(and(eq(controlRequirements.controlId, input.controlId), eq(controlRequirements.requirementId, input.requirementId)));
}
