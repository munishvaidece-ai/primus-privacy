import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  engagements,
  engagementScopes,
  engagementScopeControls,
  applicabilityDeterminations,
  applicabilityDeterminationRegulatoryReferences,
  controls,
  regulatoryReferences,
  users,
} from "@/db/schema";
import {
  NotFoundOrForbiddenError,
  requireEngagementAccess,
  requireEngagementMembershipAccess,
  requireScopeLockAccess,
} from "@/lib/authorization/service";
import { NoControlLibraryPinnedError } from "@/lib/domain/assessments";

// Slice D3 — Applicability & Scope (approved design). Builds on the
// EXACT existing Engagement/ControlLibraryVersion/Control model — no
// redesign of the RegulatoryReference/Requirement/Control graph. Two
// entities, matching the approved architecture's own split:
//
// - `ApplicabilityDetermination` (DATA_MODEL.md §4, unchanged shape):
//   RegulatoryReference-level, narrative/report-facing. NEVER drives
//   AssessmentControl membership — the M:N Requirement<->Control graph
//   makes that cascade structurally unreliable (D3 design §D, confirmed
//   independently by `createAssessment`'s own docstring, R-113).
// - `EngagementScopeControl` (new, operational): Control-level — the
//   ONE mechanism that actually integrates with Assessment, via a
//   snapshot `createAssessment` takes at creation time (see
//   lib/domain/assessments.ts). AssessmentControl membership is NEVER
//   filtered by this — every Control in the pinned library still
//   becomes an AssessmentControl, exactly as before this slice.
//
// Both live inside a versioned `EngagementScope` envelope: draft (freely
// editable) -> locked (permanently immutable; a revision opens a NEW
// EngagementScope via `previous_scope_version_id`, never edits a locked
// one — no "reopen" action exists). Locking requires the DEDICATED
// `scope.lock` permission (D3 approval, Change 3) — deliberately not
// `assessment.finalize`, even though both resolve to Engagement Manager
// today.

export class InvalidApplicabilityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidApplicabilityInputError";
  }
}

export class EngagementScopeNotDraftError extends Error {
  constructor(message = "This scope version is locked and can no longer be edited.") {
    super(message);
    this.name = "EngagementScopeNotDraftError";
  }
}

export class PreviousScopeNotLockedError extends Error {
  constructor(message = "Only a locked scope version can be revised.") {
    super(message);
    this.name = "PreviousScopeNotLockedError";
  }
}

export class MissingRationaleError extends Error {
  constructor(message = "A rationale is required when marking a control not applicable.") {
    super(message);
    this.name = "MissingRationaleError";
  }
}

type ScopeStatus = "draft" | "locked";
type ControlDecision = "undecided" | "applicable" | "not_applicable";
type DeterminationDecision = "applicable" | "not_applicable";

// --- Reads ------------------------------------------------------------

export interface RegulatoryReferenceOption {
  id: string;
  title: string;
  citation: string;
}

/** For the "add determination" form's RegulatoryReference picker.
 * Deliberately gated by `requireEngagementAccess` (engagement-scoped),
 * NOT `requireTenantAccess` — `lib/domain/control-library.ts`'s own
 * reads are gated by the narrower, literal-TenantMembership-only
 * `requireTenantAccess` (DECISIONS.md R-131's own documented, deliberate
 * scope limit for Slice D1, which only needed to serve Platform
 * Administrator/Practice Partner). An engagement-scoped Consultant
 * proposing Scope determinations typically holds no `TenantMembership`
 * at all, so reusing that narrower check here would make this screen
 * unusable for exactly the role D3 §9 names as the one who should
 * propose Scope — this function resolves the engagement's own tenant
 * and checks engagement access instead. */
export async function listRegulatoryReferencesForEngagement(
  db: RequestDb,
  userId: string,
  input: { engagementId: string; organisationId: string },
): Promise<RegulatoryReferenceOption[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [engagement] = await db.select({ tenantId: engagements.tenantId }).from(engagements).where(eq(engagements.id, input.engagementId)).limit(1);
  if (!engagement) return [];

  return db
    .select({ id: regulatoryReferences.id, title: regulatoryReferences.title, citation: regulatoryReferences.citation })
    .from(regulatoryReferences)
    .where(eq(regulatoryReferences.tenantId, engagement.tenantId))
    .orderBy(asc(regulatoryReferences.title));
}

export interface EngagementScopeSummary {
  id: string;
  status: ScopeStatus;
  previousScopeVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Every Scope version for an Engagement, most recent first — the
 * "version/history" list (D3 §11). */
export async function listEngagementScopes(db: RequestDb, userId: string, input: { engagementId: string; organisationId: string }): Promise<EngagementScopeSummary[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);
  return db
    .select({
      id: engagementScopes.id,
      status: engagementScopes.status,
      previousScopeVersionId: engagementScopes.previousScopeVersionId,
      createdAt: engagementScopes.createdAt,
      updatedAt: engagementScopes.updatedAt,
    })
    .from(engagementScopes)
    .where(and(eq(engagementScopes.engagementId, input.engagementId), eq(engagementScopes.organisationId, input.organisationId)))
    .orderBy(desc(engagementScopes.createdAt));
}

/** The most recent LOCKED Scope for an Engagement, if any — what a new
 * Assessment will snapshot (lib/domain/assessments.ts) and what the
 * "Lock Scope" screen shows as the last settled determination. Internal
 * helper, also exported for the Assessment-creation integration and for
 * tests. */
export async function getLatestLockedEngagementScope(
  db: RequestDb,
  engagementId: string,
): Promise<{ id: string; controlLibraryVersionId: string } | null> {
  const [row] = await db
    .select({ id: engagementScopes.id, controlLibraryVersionId: engagementScopes.controlLibraryVersionId })
    .from(engagementScopes)
    .where(and(eq(engagementScopes.engagementId, engagementId), eq(engagementScopes.status, "locked")))
    .orderBy(desc(engagementScopes.createdAt))
    .limit(1);
  return row ?? null;
}

export interface EngagementScopeControlRow {
  id: string;
  controlId: string;
  controlCode: string;
  controlTitle: string;
  decision: ControlDecision;
  rationale: string | null;
  decidedByEmail: string | null;
  decidedAt: Date | null;
}

export interface ApplicabilityDeterminationRow {
  id: string;
  scopeDescription: string;
  decisionValue: DeterminationDecision;
  decisionRationale: string | null;
  decidedByEmail: string | null;
  decidedAt: Date;
  regulatoryReferences: Array<{ id: string; title: string; citation: string }>;
}

export interface EngagementScopeDetail extends EngagementScopeSummary {
  engagementId: string;
  organisationId: string;
  controlLibraryVersionId: string;
  controlRows: EngagementScopeControlRow[];
  determinations: ApplicabilityDeterminationRow[];
}

export async function getEngagementScopeDetail(db: RequestDb, userId: string, engagementScopeId: string): Promise<EngagementScopeDetail> {
  const [scope] = await db
    .select({
      id: engagementScopes.id,
      status: engagementScopes.status,
      previousScopeVersionId: engagementScopes.previousScopeVersionId,
      engagementId: engagementScopes.engagementId,
      organisationId: engagementScopes.organisationId,
      controlLibraryVersionId: engagementScopes.controlLibraryVersionId,
      createdAt: engagementScopes.createdAt,
      updatedAt: engagementScopes.updatedAt,
    })
    .from(engagementScopes)
    .where(eq(engagementScopes.id, engagementScopeId))
    .limit(1);
  if (!scope) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, scope.engagementId, scope.organisationId);

  const controlRows = await db
    .select({
      id: engagementScopeControls.id,
      controlId: engagementScopeControls.controlId,
      controlCode: controls.code,
      controlTitle: controls.title,
      decision: engagementScopeControls.decision,
      rationale: engagementScopeControls.rationale,
      decidedByEmail: users.email,
      decidedAt: engagementScopeControls.decidedAt,
    })
    .from(engagementScopeControls)
    .innerJoin(controls, eq(controls.id, engagementScopeControls.controlId))
    .leftJoin(users, eq(users.id, engagementScopeControls.decidedBy))
    .where(eq(engagementScopeControls.engagementScopeId, engagementScopeId))
    .orderBy(asc(controls.code));

  const determinationRows = await db
    .select({
      id: applicabilityDeterminations.id,
      scopeDescription: applicabilityDeterminations.scopeDescription,
      decisionValue: applicabilityDeterminations.decisionValue,
      decisionRationale: applicabilityDeterminations.decisionRationale,
      decidedByEmail: users.email,
      decidedAt: applicabilityDeterminations.decidedAt,
    })
    .from(applicabilityDeterminations)
    .leftJoin(users, eq(users.id, applicabilityDeterminations.decidedBy))
    .where(eq(applicabilityDeterminations.engagementScopeId, engagementScopeId))
    .orderBy(desc(applicabilityDeterminations.createdAt));

  const refRows = determinationRows.length
    ? await db
        .select({
          determinationId: applicabilityDeterminationRegulatoryReferences.applicabilityDeterminationId,
          id: regulatoryReferences.id,
          title: regulatoryReferences.title,
          citation: regulatoryReferences.citation,
        })
        .from(applicabilityDeterminationRegulatoryReferences)
        .innerJoin(regulatoryReferences, eq(regulatoryReferences.id, applicabilityDeterminationRegulatoryReferences.regulatoryReferenceId))
        .where(
          inArray(
            applicabilityDeterminationRegulatoryReferences.applicabilityDeterminationId,
            determinationRows.map((d) => d.id),
          ),
        )
    : [];
  const refsByDetermination = new Map<string, Array<{ id: string; title: string; citation: string }>>();
  for (const r of refRows) {
    const list = refsByDetermination.get(r.determinationId) ?? [];
    list.push({ id: r.id, title: r.title, citation: r.citation });
    refsByDetermination.set(r.determinationId, list);
  }

  return {
    ...scope,
    determinations: determinationRows.map((d) => ({ ...d, regulatoryReferences: refsByDetermination.get(d.id) ?? [] })),
    controlRows,
  };
}

// --- Writes: EngagementScope lifecycle ----------------------------------

/**
 * Creates the FIRST EngagementScope for an Engagement — draft, pinned to
 * the Engagement's own current ControlLibraryVersion, with one
 * EngagementScopeControl row per Control in that version, each
 * `decision = 'undecided'` (mirrors `createAssessment`'s own "every
 * Control becomes a row" population, lib/domain/assessments.ts, so
 * "nobody has reviewed this yet" is always a real row, never an absent
 * one — the CRITICAL semantic requirement this slice exists to satisfy).
 */
export async function createEngagementScope(db: RequestDb, userId: string, input: { engagementId: string }): Promise<{ id: string }> {
  const [engagement] = await db
    .select({ id: engagements.id, organisationId: engagements.organisationId, tenantId: engagements.tenantId, controlLibraryVersionId: engagements.controlLibraryVersionId })
    .from(engagements)
    .where(eq(engagements.id, input.engagementId))
    .limit(1);
  if (!engagement) throw new NotFoundOrForbiddenError();

  await requireEngagementMembershipAccess(db, userId, engagement.id);

  if (!engagement.controlLibraryVersionId) {
    throw new NoControlLibraryPinnedError(
      "This engagement has no control library version pinned yet. Pin a control library version to the engagement before creating a scope.",
    );
  }
  const controlLibraryVersionId = engagement.controlLibraryVersionId;

  const scopeId = randomUUID();
  await db.insert(engagementScopes).values({
    id: scopeId,
    engagementId: engagement.id,
    organisationId: engagement.organisationId,
    tenantId: engagement.tenantId,
    controlLibraryVersionId,
    createdBy: userId,
    updatedBy: userId,
  });

  const libraryControls = await db.select({ id: controls.id }).from(controls).where(eq(controls.controlLibraryVersionId, controlLibraryVersionId));

  if (libraryControls.length > 0) {
    await db.insert(engagementScopeControls).values(
      libraryControls.map((c) => ({
        engagementScopeId: scopeId,
        controlId: c.id,
        tenantId: engagement.tenantId,
        organisationId: engagement.organisationId,
        engagementId: engagement.id,
        controlLibraryVersionId,
        createdBy: userId,
        updatedBy: userId,
      })),
    );
  }

  return { id: scopeId };
}

/**
 * Revises a LOCKED EngagementScope into a new draft version
 * (`previous_scope_version_id` set, D3 §4/§17 — the old version is
 * never touched). Carries forward each Control's existing decision/
 * rationale as the new draft's starting point (rather than resetting
 * every Control back to 'undecided'), and copies each existing
 * ApplicabilityDetermination the same way — a genuine, considered
 * extension beyond the letter of the brief, justified because starting
 * a "revision" from a blank slate would silently discard a
 * consultant's prior work and invite exactly the kind of confusion this
 * slice's own auditability requirement (D3 §12) exists to prevent. See
 * DECISIONS.md.
 */
export async function reviseEngagementScope(db: RequestDb, userId: string, input: { previousScopeId: string }): Promise<{ id: string }> {
  const [previous] = await db
    .select({
      id: engagementScopes.id,
      status: engagementScopes.status,
      engagementId: engagementScopes.engagementId,
      organisationId: engagementScopes.organisationId,
      tenantId: engagementScopes.tenantId,
      controlLibraryVersionId: engagementScopes.controlLibraryVersionId,
    })
    .from(engagementScopes)
    .where(eq(engagementScopes.id, input.previousScopeId))
    .limit(1);
  if (!previous) throw new NotFoundOrForbiddenError();

  await requireEngagementMembershipAccess(db, userId, previous.engagementId);

  if (previous.status !== "locked") {
    throw new PreviousScopeNotLockedError();
  }

  const newScopeId = randomUUID();
  await db.insert(engagementScopes).values({
    id: newScopeId,
    engagementId: previous.engagementId,
    organisationId: previous.organisationId,
    tenantId: previous.tenantId,
    controlLibraryVersionId: previous.controlLibraryVersionId,
    previousScopeVersionId: previous.id,
    createdBy: userId,
    updatedBy: userId,
  });

  const previousControlRows = await db
    .select({
      controlId: engagementScopeControls.controlId,
      decision: engagementScopeControls.decision,
      rationale: engagementScopeControls.rationale,
      decidedBy: engagementScopeControls.decidedBy,
      decidedAt: engagementScopeControls.decidedAt,
    })
    .from(engagementScopeControls)
    .where(eq(engagementScopeControls.engagementScopeId, previous.id));

  if (previousControlRows.length > 0) {
    await db.insert(engagementScopeControls).values(
      previousControlRows.map((c) => ({
        engagementScopeId: newScopeId,
        controlId: c.controlId,
        tenantId: previous.tenantId,
        organisationId: previous.organisationId,
        engagementId: previous.engagementId,
        controlLibraryVersionId: previous.controlLibraryVersionId,
        decision: c.decision,
        rationale: c.rationale,
        decidedBy: c.decidedBy,
        decidedAt: c.decidedAt,
        createdBy: userId,
        updatedBy: userId,
      })),
    );
  }

  const previousDeterminations = await db
    .select({
      id: applicabilityDeterminations.id,
      scopeDescription: applicabilityDeterminations.scopeDescription,
      decisionValue: applicabilityDeterminations.decisionValue,
      decisionRationale: applicabilityDeterminations.decisionRationale,
      systemSuggestedValue: applicabilityDeterminations.systemSuggestedValue,
      decidedBy: applicabilityDeterminations.decidedBy,
      decidedAt: applicabilityDeterminations.decidedAt,
    })
    .from(applicabilityDeterminations)
    .where(eq(applicabilityDeterminations.engagementScopeId, previous.id));

  for (const d of previousDeterminations) {
    const newDeterminationId = randomUUID();
    await db.insert(applicabilityDeterminations).values({
      id: newDeterminationId,
      engagementScopeId: newScopeId,
      tenantId: previous.tenantId,
      organisationId: previous.organisationId,
      engagementId: previous.engagementId,
      scopeDescription: d.scopeDescription,
      decisionValue: d.decisionValue,
      decisionRationale: d.decisionRationale,
      systemSuggestedValue: d.systemSuggestedValue,
      decidedBy: d.decidedBy!,
      decidedAt: d.decidedAt,
      createdBy: userId,
      updatedBy: userId,
    });

    const refs = await db
      .select({ regulatoryReferenceId: applicabilityDeterminationRegulatoryReferences.regulatoryReferenceId })
      .from(applicabilityDeterminationRegulatoryReferences)
      .where(eq(applicabilityDeterminationRegulatoryReferences.applicabilityDeterminationId, d.id));
    if (refs.length > 0) {
      await db.insert(applicabilityDeterminationRegulatoryReferences).values(
        refs.map((r) => ({
          applicabilityDeterminationId: newDeterminationId,
          regulatoryReferenceId: r.regulatoryReferenceId,
          tenantId: previous.tenantId,
          organisationId: previous.organisationId,
          engagementId: previous.engagementId,
          createdBy: userId,
        })),
      );
    }
  }

  return { id: newScopeId };
}

/** The one permanent `draft -> locked` transition (D3 §4/§9). Requires
 * the DEDICATED `scope.lock` permission — never `assessment.finalize`. */
export async function lockEngagementScope(db: RequestDb, userId: string, input: { engagementScopeId: string }): Promise<void> {
  const [scope] = await db
    .select({ id: engagementScopes.id, status: engagementScopes.status, engagementId: engagementScopes.engagementId, organisationId: engagementScopes.organisationId })
    .from(engagementScopes)
    .where(eq(engagementScopes.id, input.engagementScopeId))
    .limit(1);
  if (!scope) throw new NotFoundOrForbiddenError();

  await requireScopeLockAccess(db, userId, scope.engagementId, scope.organisationId);

  if (scope.status !== "draft") {
    throw new EngagementScopeNotDraftError();
  }

  await db.update(engagementScopes).set({ status: "locked", updatedBy: userId, updatedAt: new Date() }).where(eq(engagementScopes.id, scope.id));
}

// --- Writes: Control-level applicability ---------------------------------

export interface UpdateControlApplicabilityInput {
  engagementScopeControlId: string;
  decision: ControlDecision;
  rationale: string | null;
}

/** Sets one Control's applicability decision (D3 §5/§6). `rationale` is
 * mandatory for `not_applicable` (pre-checked here for a clean error;
 * the `engagement_scope_controls_rationale_required_check` DB
 * constraint, migration 0027, is the real, unconditional backstop) and
 * is always cleared when reverting to `undecided` — a rationale should
 * never survive under a decision it no longer explains. */
export async function updateControlApplicability(db: RequestDb, userId: string, input: UpdateControlApplicabilityInput): Promise<void> {
  const [row] = await db
    .select({
      id: engagementScopeControls.id,
      engagementId: engagementScopeControls.engagementId,
      organisationId: engagementScopeControls.organisationId,
      scopeStatus: engagementScopes.status,
    })
    .from(engagementScopeControls)
    .innerJoin(engagementScopes, eq(engagementScopes.id, engagementScopeControls.engagementScopeId))
    .where(eq(engagementScopeControls.id, input.engagementScopeControlId))
    .limit(1);
  if (!row) throw new NotFoundOrForbiddenError();

  await requireEngagementMembershipAccess(db, userId, row.engagementId);

  if (row.scopeStatus !== "draft") {
    throw new EngagementScopeNotDraftError();
  }

  // 'undecided' always clears any prior rationale — it should never
  // survive under a decision it no longer explains. 'not_applicable'
  // requires one. 'applicable' may optionally carry one (D3 §5: "rationale
  // may be optional" — not forbidden), preserved as provided.
  const rationale = input.decision === "undecided" ? null : input.rationale?.trim() || null;
  if (input.decision === "not_applicable" && !rationale) {
    throw new MissingRationaleError();
  }

  await db
    .update(engagementScopeControls)
    .set({
      decision: input.decision,
      rationale,
      decidedBy: input.decision === "undecided" ? null : userId,
      decidedAt: input.decision === "undecided" ? null : new Date(),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(engagementScopeControls.id, input.engagementScopeControlId));
}

// --- Writes: RegulatoryReference-level applicability ---------------------

export interface CreateApplicabilityDeterminationInput {
  engagementScopeId: string;
  scopeDescription: string;
  decisionValue: DeterminationDecision;
  decisionRationale: string | null;
  regulatoryReferenceIds: string[];
}

/** Records a RegulatoryReference-level determination (DATA_MODEL.md §4,
 * D3 §8) — narrative/report-facing only, never consulted by
 * `createAssessment`. The row's own existence already represents a
 * decision (D3's own binary `applicability_determination_decision`
 * enum, enums.ts) — there is no "undecided" ApplicabilityDetermination
 * to represent. */
export async function createApplicabilityDetermination(
  db: RequestDb,
  userId: string,
  input: CreateApplicabilityDeterminationInput,
): Promise<{ id: string }> {
  if (!input.scopeDescription.trim()) {
    throw new InvalidApplicabilityInputError("A scope description is required.");
  }
  const rationale = input.decisionRationale?.trim() || null;
  if (input.decisionValue === "not_applicable" && !rationale) {
    throw new MissingRationaleError();
  }

  const [scope] = await db
    .select({
      id: engagementScopes.id,
      status: engagementScopes.status,
      engagementId: engagementScopes.engagementId,
      organisationId: engagementScopes.organisationId,
      tenantId: engagementScopes.tenantId,
    })
    .from(engagementScopes)
    .where(eq(engagementScopes.id, input.engagementScopeId))
    .limit(1);
  if (!scope) throw new NotFoundOrForbiddenError();

  await requireEngagementMembershipAccess(db, userId, scope.engagementId);

  if (scope.status !== "draft") {
    throw new EngagementScopeNotDraftError();
  }

  if (input.regulatoryReferenceIds.length > 0) {
    const refRows = await db
      .select({ id: regulatoryReferences.id })
      .from(regulatoryReferences)
      .where(and(eq(regulatoryReferences.tenantId, scope.tenantId)));
    const validIds = new Set(refRows.map((r) => r.id));
    for (const id of input.regulatoryReferenceIds) {
      if (!validIds.has(id)) throw new NotFoundOrForbiddenError();
    }
  }

  const determinationId = randomUUID();
  await db.insert(applicabilityDeterminations).values({
    id: determinationId,
    engagementScopeId: scope.id,
    tenantId: scope.tenantId,
    organisationId: scope.organisationId,
    engagementId: scope.engagementId,
    scopeDescription: input.scopeDescription.trim(),
    decisionValue: input.decisionValue,
    decisionRationale: rationale,
    decidedBy: userId,
    decidedAt: new Date(),
    createdBy: userId,
    updatedBy: userId,
  });

  if (input.regulatoryReferenceIds.length > 0) {
    await db.insert(applicabilityDeterminationRegulatoryReferences).values(
      input.regulatoryReferenceIds.map((regulatoryReferenceId) => ({
        applicabilityDeterminationId: determinationId,
        regulatoryReferenceId,
        tenantId: scope.tenantId,
        organisationId: scope.organisationId,
        engagementId: scope.engagementId,
        createdBy: userId,
      })),
    );
  }

  return { id: determinationId };
}
