import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  assessments,
  assessmentControls,
  assessmentResponses,
  controls,
  controlLibraryVersions,
  controlRequirements,
  requirements,
  regulatoryReferences,
  controlTests,
  engagements,
  engagementScopes,
  engagementScopeControls,
  users,
} from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess, requireAssessmentFinalizeAccess } from "@/lib/authorization/service";

export class AssessmentFinalizedError extends Error {
  constructor(message = "This assessment is finalized and can no longer be edited.") {
    super(message);
    this.name = "AssessmentFinalizedError";
  }
}

export class InvalidAssessmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAssessmentInputError";
  }
}

/**
 * Slice C7.1 (instructions §5/§15): the exact same "store and pin the
 * configuration, don't build a calculator" shape as
 * `NoActiveRiskScoringModelError` (lib/domain/risks.ts) — a clean,
 * named failure for the one real precondition Assessment creation has
 * (its Engagement must already have a `control_library_version_id`
 * pinned), rather than a generic "invalid input" message or a silent
 * fallback. `engagements.control_library_version_id` is nullable by
 * design (an Engagement may legitimately exist before a methodology is
 * pinned — engagements.ts's own file comment) — this is the honest,
 * named error for that real, expected state, not a bug.
 */
export class NoControlLibraryPinnedError extends Error {
  constructor(
    message = "This engagement has no control library version pinned yet. Pin a control library version to the engagement before creating an assessment.",
  ) {
    super(message);
    this.name = "NoControlLibraryPinnedError";
  }
}

// --- Assessment creation (Slice C7.1) ---------------------------------------

const ASSESSMENT_TYPE_VALUES = ["control_readiness", "annual", "dpia", "sdf_screening", "third_party"] as const;
type AssessmentTypeValue = (typeof ASSESSMENT_TYPE_VALUES)[number];

export interface CreateAssessmentInput {
  engagementId: string;
  assessmentType: AssessmentTypeValue;
  periodLabel: string;
}

/**
 * Creates a new Assessment for an Engagement and immediately populates
 * its AssessmentControls from every Control in the Engagement's own
 * pinned ControlLibraryVersion (the C7 review's own P0 finding: no
 * function anywhere in this codebase created an Assessment before this
 * slice — the entire Risk→Finding→Remediation→Validation chain was
 * unreachable for real use as a result).
 *
 * **Population mechanism (instructions §2B, resolved from the repo,
 * not invented):** DATA_MODEL.md §6 names `AssessmentControl` as "the
 * specific controls in scope for this assessment instance" with no
 * applicability-exclusion mechanism named for it anywhere, and
 * PRODUCT_UX_BLUEPRINT.md §12 step 4 describes exactly this shape:
 * "Controls are assessed — `AssessmentControl` scoped from the pinned
 * library." `ApplicabilityDetermination` (DATA_MODEL.md §4) is a
 * distinct, engagement-level record about which *RegulatoryReferences*
 * apply — it has no relationship to `AssessmentControl`/`Control`
 * anywhere in the schema, and is itself `[NOT YET BUILT]` (no
 * migration exists for it at all, confirmed by direct inspection this
 * slice) — so there is no applicability mechanism to consult, and none
 * is invented here. There is likewise no manual-control-selection
 * mechanism named anywhere. The only behavior the repository actually
 * supports is therefore: **every Control belonging to the Engagement's
 * pinned ControlLibraryVersion becomes an AssessmentControl**, which is
 * exactly what this function does.
 *
 * **Scope derivation (instructions §3/§16):** `engagementId` identifies
 * the target only; `tenantId`/`organisationId`/`controlLibraryVersionId`
 * are always re-derived from the Engagement's own authoritative row,
 * never trusted from the caller — the same established pattern every
 * `create*` function in this codebase already uses (mirrors
 * `createRemediationAction`'s identical shape one hop up the chain).
 *
 * **Library-version integrity (instructions §7/§17):** no new
 * consistency mechanism is introduced. `assessments`' own
 * `assessments_engagement_control_library_version_fk` (migration 0008)
 * already makes it database-impossible for an Assessment's
 * `control_library_version_id` to disagree with its Engagement's pinned
 * one; `assessment_controls`' own `assessment_controls_assessment_
 * scope_fk` + `assessment_controls_control_library_version_fk`
 * (migration 0008) together already make it database-impossible for an
 * AssessmentControl to reference a Control from any library version
 * other than the Assessment's own pinned one — both existing composite
 * FKs, re-verified fresh this slice, not new ones added for it
 * (instructions §18: "prefer existing composite FK constraints... if
 * insufficient, STOP" — they are sufficient).
 *
 * **Historical/snapshot integrity (instructions §8):** this function
 * populates AssessmentControls exactly once, at creation, from the
 * pinned library version's Control set *as it exists at that moment*.
 * Nothing here or anywhere else in the codebase re-queries or re-joins
 * against `controls` for an existing Assessment's control set — every
 * read (`getAssessmentDetail` above) reads the already-materialized
 * `assessment_controls` rows, never a live join to `controls` filtered
 * by library version. A Control added to the same library version
 * later (impossible in practice anyway, since a `published` version's
 * Control set is itself frozen by migration 0007's own triggers — see
 * DECISIONS.md R-44/R-45) therefore cannot retroactively appear in an
 * already-created Assessment.
 *
 * **Duplicates (instructions §10):** no uniqueness constraint exists on
 * (engagement_id, assessment_type, period_label) anywhere in the schema,
 * and no product document requires one — duplicate Assessments for the
 * same Engagement/type/period are permitted, exactly as the existing
 * model already allows; this function does not add a check the schema
 * itself doesn't require.
 *
 * **Previous Assessment (instructions §20):** `assessments.previous_
 * assessment_id` exists but is never read or written by any application
 * code, anywhere in this codebase, before this slice — this function's
 * own input type carries no such field, and the creation form does not
 * expose one, per instruction not to invent carry-forward selection
 * semantics the repository doesn't already define. Every Assessment
 * this function creates has `previous_assessment_id = NULL`.
 *
 * **Authorization (instructions §5/§16):** `assessments_insert`'s own
 * RLS `WITH CHECK` (migration 0009) is exactly
 * `can_access_engagement(engagement_id, organisation_id)` — the same
 * coarse, already-established rule `requireEngagementAccess` already
 * implements and every other `create*` function in this codebase
 * already uses (createRisk/createFinding/createRemediationAction/
 * createValidationRecord). This is not an undefined permission model
 * requiring a product decision — it is the exact rule the schema
 * itself already encodes; using anything narrower would be inventing a
 * role the repository doesn't define.
 *
 * **Transactionality (instructions §6/§18):** both inserts below run
 * inside the SAME `withRequestDb` transaction the caller already
 * opened — the established pattern every multi-insert domain function
 * in this codebase uses (mirrors `createRemediationAction`'s own
 * two-insert shape, and `uploadEvidence`'s own four-insert shape). A
 * failure in either insert rolls back both; there is no code path that
 * can leave an Assessment row with a partially-populated (or entirely
 * unpopulated) AssessmentControl set behind.
 *
 * **Performance (instructions §21):** the Control set is read with one
 * query and inserted with one batched `INSERT ... VALUES (...), (...),
 * ...` — never one query per Control, regardless of how many Controls
 * the pinned library version has.
 */
export async function createAssessment(
  db: RequestDb,
  userId: string,
  input: CreateAssessmentInput,
): Promise<{ id: string }> {
  if (!ASSESSMENT_TYPE_VALUES.includes(input.assessmentType)) {
    throw new InvalidAssessmentInputError("Invalid assessment type.");
  }
  if (!input.periodLabel.trim()) {
    throw new InvalidAssessmentInputError("Period label is required.");
  }

  const [engagement] = await db
    .select({
      id: engagements.id,
      tenantId: engagements.tenantId,
      organisationId: engagements.organisationId,
      controlLibraryVersionId: engagements.controlLibraryVersionId,
    })
    .from(engagements)
    .where(eq(engagements.id, input.engagementId))
    .limit(1);
  if (!engagement) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, engagement.id, engagement.organisationId);

  if (!engagement.controlLibraryVersionId) {
    throw new NoControlLibraryPinnedError();
  }
  const controlLibraryVersionId = engagement.controlLibraryVersionId;

  const assessmentId = randomUUID();
  await db.insert(assessments).values({
    id: assessmentId,
    engagementId: engagement.id,
    organisationId: engagement.organisationId,
    tenantId: engagement.tenantId,
    controlLibraryVersionId,
    assessmentType: input.assessmentType,
    periodLabel: input.periodLabel.trim(),
    createdBy: userId,
    updatedBy: userId,
  });

  // One query for the pinned library's entire Control set — every
  // Control in it becomes an AssessmentControl (see this function's own
  // docstring for why: no applicability/manual-selection mechanism
  // exists in the repository to filter this set). Slice D3 does NOT
  // change this — AssessmentControl membership is never filtered by
  // Applicability & Scope (D3 approval §6: "Preserve this behaviour...
  // DO NOT remove AssessmentControl rows for N/A controls").
  const libraryControls = await db
    .select({ id: controls.id })
    .from(controls)
    .where(eq(controls.controlLibraryVersionId, controlLibraryVersionId));

  // Slice D3 (Applicability & Scope): snapshot the Engagement's
  // currently LOCKED EngagementScope, if one exists, onto each new
  // AssessmentControl row — never a live join re-evaluated later (the
  // same "pin now, never re-derive" discipline every version-pinned
  // relationship in this codebase already follows). If no locked Scope
  // exists, every row keeps the column defaults ('undecided', nulls) —
  // existing Assessment-creation behavior is otherwise completely
  // unaffected, and no explicit "applicable" decision is ever fabricated
  // (D3 approval §6).
  const [lockedScope] = await db
    .select({ id: engagementScopes.id })
    .from(engagementScopes)
    .where(and(eq(engagementScopes.engagementId, engagement.id), eq(engagementScopes.status, "locked")))
    .orderBy(desc(engagementScopes.createdAt))
    .limit(1);

  const scopeDecisionByControlId = new Map<
    string,
    { id: string; decision: "undecided" | "applicable" | "not_applicable"; rationale: string | null; decidedBy: string | null; decidedAt: Date | null }
  >();
  if (lockedScope) {
    const scopeControlRows = await db
      .select({
        id: engagementScopeControls.id,
        controlId: engagementScopeControls.controlId,
        decision: engagementScopeControls.decision,
        rationale: engagementScopeControls.rationale,
        decidedBy: engagementScopeControls.decidedBy,
        decidedAt: engagementScopeControls.decidedAt,
      })
      .from(engagementScopeControls)
      .where(eq(engagementScopeControls.engagementScopeId, lockedScope.id));
    for (const row of scopeControlRows) {
      scopeDecisionByControlId.set(row.controlId, row);
    }
  }

  // A library version with zero Controls is a real, valid state (an
  // Engagement Manager pinned a version before any Control was
  // authored into it) — not an error; the Assessment is created with
  // zero AssessmentControls, matching `getAssessmentDetail`'s already-
  // honest "0 of 0" progress rendering rather than inventing a
  // fallback behavior instructions §15 explicitly forbids.
  if (libraryControls.length > 0) {
    await db.insert(assessmentControls).values(
      libraryControls.map((c) => {
        const scoped = scopeDecisionByControlId.get(c.id);
        return {
          assessmentId,
          controlId: c.id,
          tenantId: engagement.tenantId,
          organisationId: engagement.organisationId,
          engagementId: engagement.id,
          controlLibraryVersionId,
          createdBy: userId,
          applicabilityDecision: scoped?.decision ?? "undecided",
          applicabilityRationale: scoped?.rationale ?? null,
          applicabilityDecidedBy: scoped?.decidedBy ?? null,
          applicabilityDecidedAt: scoped?.decidedAt ?? null,
          engagementScopeControlId: scoped?.id ?? null,
        };
      }),
    );
  }

  return { id: assessmentId };
}

// --- Assessment finalization (Slice C7.3) -----------------------------------

/**
 * The one, terminal `draft → finalized` transition (instructions §4):
 * Browser → Server Action → authenticate → load the authoritative
 * Assessment → derive its Engagement → authorize
 * (`requireAssessmentFinalizeAccess`) → pre-check current state → the
 * transition itself → audit (existing trigger) → return. No completeness
 * requirement is enforced — none is documented anywhere in
 * PRODUCT_SPEC.md/PRODUCT_UX_BLUEPRINT.md/DATA_MODEL.md (checked fresh
 * this slice; instructions §9 forbid inventing one where none exists),
 * so an Assessment with zero responses can be finalized exactly as
 * validly as a fully-answered one — the MVP permits finalization
 * according to the documented model, not a stricter one this slice
 * would otherwise be guessing at.
 *
 * **Authorization (instructions §2/§8):** `requireAssessmentFinalizeAccess`
 * (lib/authorization/service.ts) — the caller must hold the
 * `assessment.finalize` permission (DECISIONS.md R-117), resolved from
 * PRODUCT_UX_BLUEPRINT.md §8's own explicit "Engagement Manager
 * additionally gets finalize/membership-manage."
 *
 * **Immutability (instructions §6):** this function does not build any
 * new immutability mechanism — `assessments_prevent_finalized_
 * tampering`/`assessment_controls_enforce_draft_mutable`/
 * `assessment_responses_enforce_draft_mutable`/`control_tests_enforce_
 * draft_mutable`/`enforce_evidence_link_draft_mutable` (migrations
 * 0009/0011) already fully freeze Assessment, AssessmentControl,
 * AssessmentResponse, ControlTest (when tied to this Assessment), and
 * EvidenceLink (for an assessment_response/control_test subject) the
 * moment this transition commits — re-verified fresh this slice by
 * direct inspection, not re-built. Risk/Finding/RemediationAction/
 * ValidationRecord are deliberately NOT frozen — no trigger anywhere
 * references Assessment finalization for any of them (the same,
 * already-repeatedly-confirmed absence DECISIONS.md R-98/R-103/R-105
 * document) — the governance work downstream of a finalized Assessment
 * continues exactly as it already did.
 *
 * **Idempotency/state (instructions §12):** pre-checked here for a
 * clean, named `AssessmentFinalizedError` — the SAME error class this
 * module already uses for "you tried to edit a finalized assessment"
 * (finalizing an already-finalized Assessment is, structurally, exactly
 * that: an attempted mutation of an immutable row). The database's own
 * `assessments_prevent_finalized_tampering` trigger is the real,
 * unconditional enforcement against a concurrent-finalization race;
 * this function's `catch` only translates its raw exception into the
 * same clean error, the identical pattern `updateAssessmentResponse`/
 * `createControlTest` already established.
 *
 * **Reopening (instructions §13):** not implemented — DATA_MODEL.md §6
 * and PRODUCT_SPEC.md principle 6 both explicitly describe finalization
 * as one-way ("historical assessments are immutable once finalized;
 * corrections create a new assessment period rather than rewriting
 * history"), so building a reopen path would contradict the documented
 * model, not merely go beyond it.
 *
 * **Metadata (instructions §10):** no new `finalized_at`/`finalized_by`
 * columns were added — `updated_at`/`updated_by`, set on this exact
 * transition, already serve that purpose permanently and unambiguously,
 * because `assessments_prevent_finalized_tampering` guarantees this is
 * THE LAST update this row can ever receive; `audit_log` independently
 * records the same actor/timestamp/before-after a second way.
 */
export async function finalizeAssessment(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string; assessmentId: string },
): Promise<void> {
  const [assessment] = await db
    .select({
      id: assessments.id,
      status: assessments.status,
      engagementId: assessments.engagementId,
      organisationId: assessments.organisationId,
    })
    .from(assessments)
    .where(eq(assessments.id, input.assessmentId))
    .limit(1);
  if (!assessment || assessment.organisationId !== input.organisationId || assessment.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  await requireAssessmentFinalizeAccess(db, userId, assessment.engagementId, assessment.organisationId);

  if (assessment.status === "finalized") {
    throw new AssessmentFinalizedError("This assessment is already finalized.");
  }

  try {
    await db
      .update(assessments)
      .set({ status: "finalized", updatedBy: userId, updatedAt: new Date() })
      .where(eq(assessments.id, assessment.id));
  } catch (err) {
    if (err instanceof Error && /finalized/i.test(err.message)) {
      throw new AssessmentFinalizedError();
    }
    throw err;
  }
}

// --- Assessment list (Slice C1, PHASE C instructions §5) -------------------

export interface AssessmentProgress {
  completed: number;
  total: number;
}

export interface AssessmentSummary {
  id: string;
  periodLabel: string;
  assessmentType: string;
  status: string;
  controlLibraryVersionLabel: string | null;
  progress: AssessmentProgress;
  lastUpdatedAt: Date;
}

/**
 * The Assessment list for one Engagement (PHASE C instructions §5). One
 * batched, GROUP BY query — no per-assessment follow-up query
 * (instructions §20's "avoid N+1"). Progress is exactly the read model
 * PRODUCT_UX_BLUEPRINT.md §7 already specifies for this screen:
 * "`assessment_controls` LEFT JOIN `assessment_responses` — 'N of M
 * controls responded' is a COUNT/COALESCE over existing rows, not a
 * stored percentage column" — not a new interpretation invented here.
 * "Responded" means a response row exists at all (any rating, including
 * an explicitly-recorded `not_assessed`) — the blueprint's own words,
 * not this slice's own judgment call, so no DECISIONS.md entry is
 * needed for it (instructions §32: only if a genuinely new decision is
 * required).
 */
export async function listAssessmentsForEngagement(
  db: RequestDb,
  userId: string,
  engagementId: string,
  organisationId: string,
): Promise<AssessmentSummary[]> {
  await requireEngagementAccess(db, userId, engagementId, organisationId);

  const rows = await db
    .select({
      id: assessments.id,
      periodLabel: assessments.periodLabel,
      assessmentType: assessments.assessmentType,
      status: assessments.status,
      updatedAt: assessments.updatedAt,
      controlLibraryVersionLabel: controlLibraryVersions.versionLabel,
      totalControls: sql<number>`count(distinct ${assessmentControls.id})`.mapWith(Number),
      completedControls: sql<number>`count(distinct ${assessmentResponses.id})`.mapWith(Number),
      lastResponseUpdate: sql<Date | null>`max(${assessmentResponses.updatedAt})`,
    })
    .from(assessments)
    .leftJoin(controlLibraryVersions, eq(controlLibraryVersions.id, assessments.controlLibraryVersionId))
    .leftJoin(assessmentControls, eq(assessmentControls.assessmentId, assessments.id))
    .leftJoin(assessmentResponses, eq(assessmentResponses.assessmentControlId, assessmentControls.id))
    .where(eq(assessments.engagementId, engagementId))
    .groupBy(assessments.id, controlLibraryVersions.versionLabel)
    .orderBy(desc(assessments.createdAt));

  return rows.map((r) => ({
    id: r.id,
    periodLabel: r.periodLabel,
    assessmentType: r.assessmentType,
    status: r.status,
    controlLibraryVersionLabel: r.controlLibraryVersionLabel,
    progress: { completed: r.completedControls, total: r.totalControls },
    lastUpdatedAt: r.lastResponseUpdate ?? r.updatedAt,
  }));
}

// --- Assessment workspace (PHASE C instructions §6) -------------------------

export interface AssessmentControlRow {
  assessmentControlId: string;
  controlId: string;
  controlCode: string;
  controlTitle: string;
  controlDescription: string | null;
  controlType: string;
  response: {
    id: string;
    effectivenessRating: string;
    systemSuggestedRating: string | null;
    decisionRationale: string | null;
    respondentEmail: string | null;
    submittedAt: Date | null;
    updatedAt: Date;
  } | null;
}

export interface AssessmentDetail {
  id: string;
  periodLabel: string;
  assessmentType: string;
  status: string;
  engagementId: string;
  organisationId: string;
  controlLibraryVersionId: string;
  controlLibraryVersionLabel: string | null;
  progress: AssessmentProgress;
  lastUpdatedAt: Date;
  controlRows: AssessmentControlRow[];
}

/**
 * The workspace's own primary read (PHASE C instructions §6/§20): the
 * Assessment itself plus every AssessmentControl row needed for the
 * left-hand navigation/search list, each carrying enough of its own
 * Control's identity (code/title/description/type) and its current
 * AssessmentResponse (if any) that selecting a control in the UI needs
 * no further "fetch the control" round trip — only the control's own
 * Requirements/ControlTests/Evidence (below) are fetched lazily, once,
 * for whichever single control is actually selected. Two queries total
 * for this function (the assessment header, then the control rows) —
 * not one query per control.
 */
export async function getAssessmentDetail(
  db: RequestDb,
  userId: string,
  assessmentId: string,
): Promise<AssessmentDetail> {
  const [assessment] = await db
    .select({
      id: assessments.id,
      periodLabel: assessments.periodLabel,
      assessmentType: assessments.assessmentType,
      status: assessments.status,
      engagementId: assessments.engagementId,
      organisationId: assessments.organisationId,
      controlLibraryVersionId: assessments.controlLibraryVersionId,
      controlLibraryVersionLabel: controlLibraryVersions.versionLabel,
      updatedAt: assessments.updatedAt,
    })
    .from(assessments)
    .leftJoin(controlLibraryVersions, eq(controlLibraryVersions.id, assessments.controlLibraryVersionId))
    .where(eq(assessments.id, assessmentId))
    .limit(1);
  if (!assessment) throw new NotFoundOrForbiddenError();

  // See lib/domain/engagements.ts's getEngagementDetail for why this is
  // checked here, after RLS has already scoped the read above, rather
  // than before: the explicit check still runs — and must pass — before
  // any row is returned to the caller.
  await requireEngagementAccess(db, userId, assessment.engagementId, assessment.organisationId);

  const rows = await db
    .select({
      assessmentControlId: assessmentControls.id,
      controlId: controls.id,
      controlCode: controls.code,
      controlTitle: controls.title,
      controlDescription: controls.description,
      controlType: controls.controlType,
      responseId: assessmentResponses.id,
      effectivenessRating: assessmentResponses.effectivenessRating,
      systemSuggestedRating: assessmentResponses.systemSuggestedRating,
      decisionRationale: assessmentResponses.decisionRationale,
      respondentEmail: users.email,
      submittedAt: assessmentResponses.submittedAt,
      responseUpdatedAt: assessmentResponses.updatedAt,
    })
    .from(assessmentControls)
    .innerJoin(controls, eq(controls.id, assessmentControls.controlId))
    .leftJoin(assessmentResponses, eq(assessmentResponses.assessmentControlId, assessmentControls.id))
    .leftJoin(users, eq(users.id, assessmentResponses.respondentId))
    .where(eq(assessmentControls.assessmentId, assessmentId))
    .orderBy(asc(controls.code));

  const controlRows: AssessmentControlRow[] = rows.map((r) => ({
    assessmentControlId: r.assessmentControlId,
    controlId: r.controlId,
    controlCode: r.controlCode,
    controlTitle: r.controlTitle,
    controlDescription: r.controlDescription,
    controlType: r.controlType,
    response: r.responseId
      ? {
          id: r.responseId,
          effectivenessRating: r.effectivenessRating!,
          systemSuggestedRating: r.systemSuggestedRating,
          decisionRationale: r.decisionRationale,
          respondentEmail: r.respondentEmail,
          submittedAt: r.submittedAt,
          updatedAt: r.responseUpdatedAt!,
        }
      : null,
  }));

  const completed = controlRows.filter((r) => r.response !== null).length;
  const lastResponseUpdate = controlRows.reduce<Date | null>((latest, r) => {
    if (!r.response) return latest;
    return !latest || r.response.updatedAt > latest ? r.response.updatedAt : latest;
  }, null);

  return {
    id: assessment.id,
    periodLabel: assessment.periodLabel,
    assessmentType: assessment.assessmentType,
    status: assessment.status,
    engagementId: assessment.engagementId,
    organisationId: assessment.organisationId,
    controlLibraryVersionId: assessment.controlLibraryVersionId,
    controlLibraryVersionLabel: assessment.controlLibraryVersionLabel,
    progress: { completed, total: controlRows.length },
    lastUpdatedAt: lastResponseUpdate ?? assessment.updatedAt,
    controlRows,
  };
}

export interface RequirementRow {
  id: string;
  title: string;
  description: string | null;
  regulatoryReference: { citation: string; title: string; frameworkName: string } | null;
}

/**
 * The Requirements mapped to one Control, via the existing
 * ControlRequirement junction (PHASE C instructions §8) — no new
 * relationship table. Only the primary RegulatoryReference is shown
 * (`requirements.primary_regulatory_reference_id`) — secondary
 * citations exist (`requirement_regulatory_references`, Milestone 4)
 * but instructions §8 name only the `Requirement → RegulatoryReference`
 * path, and showing them too is not required for a usable workspace;
 * left for a future slice rather than added speculatively.
 *
 * No explicit authorization check here: `requirements`/
 * `regulatory_references`/`control_requirements` are all Tenant-owned
 * methodology content, readable under `can_access_tenant` (migration
 * 0007) — a caller who has already passed `requireEngagementAccess` on
 * this control's own Assessment structurally satisfies `can_access_
 * tenant` too (`can_access_tenant` falls back to "can access at least
 * one organisation under this tenant," which their engagement access
 * already proves) — RLS itself is the read boundary here, exactly as
 * intended for practice-owned reference content (unlike client
 * engagement data, which this module's other functions explicitly
 * re-check at the application layer).
 */
export async function getControlRequirements(db: RequestDb, controlId: string): Promise<RequirementRow[]> {
  const rows = await db
    .select({
      id: requirements.id,
      title: requirements.title,
      description: requirements.description,
      regCitation: regulatoryReferences.citation,
      regTitle: regulatoryReferences.title,
      regFramework: regulatoryReferences.frameworkName,
    })
    .from(controlRequirements)
    .innerJoin(requirements, eq(requirements.id, controlRequirements.requirementId))
    .leftJoin(regulatoryReferences, eq(regulatoryReferences.id, requirements.primaryRegulatoryReferenceId))
    .where(eq(controlRequirements.controlId, controlId))
    .orderBy(asc(requirements.title));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    regulatoryReference: r.regCitation ? { citation: r.regCitation, title: r.regTitle!, frameworkName: r.regFramework! } : null,
  }));
}

export interface ControlTestRow {
  id: string;
  methodology: string;
  sampleDescription: string | null;
  result: string;
  testerEmail: string | null;
  testedAt: Date | null;
  createdAt: Date;
}

/**
 * ControlTests for one Control within one Assessment (PHASE C
 * instructions §13) — `control_tests.assessment_id` + `control_id`
 * together identify exactly this scope; a standalone (assessment_id
 * IS NULL, continuous-monitoring) test is deliberately never returned
 * here, since it belongs to a different screen this slice doesn't build
 * (PRODUCT_UX_BLUEPRINT.md: "Control Test is not its own nav item — it
 * lives inside the Assessment workspace").
 */
export async function getControlTestsForControl(
  db: RequestDb,
  assessmentId: string,
  controlId: string,
): Promise<ControlTestRow[]> {
  const rows = await db
    .select({
      id: controlTests.id,
      methodology: controlTests.methodology,
      sampleDescription: controlTests.sampleDescription,
      result: controlTests.result,
      testerEmail: users.email,
      testedAt: controlTests.testedAt,
      createdAt: controlTests.createdAt,
    })
    .from(controlTests)
    .leftJoin(users, eq(users.id, controlTests.testerId))
    .where(and(eq(controlTests.assessmentId, assessmentId), eq(controlTests.controlId, controlId)))
    .orderBy(desc(controlTests.createdAt));

  return rows;
}

// getEvidenceSummaryForControl moved to lib/domain/evidence.ts in
// Slice C2 — the whole Evidence domain (upload, review, linking, the
// summary read) now lives in one module. Re-exported below for
// backward-compatible imports.

export interface UpdateAssessmentResponseInput {
  assessmentControlId: string;
  effectivenessRating: "not_assessed" | "not_applicable" | "not_implemented" | "partially_implemented" | "implemented";
  decisionRationale: string | null;
}

/**
 * The Slice A1 vertical-slice write path (PHASE A instructions §13/§14),
 * unchanged by Slice C1. Order of operations matches instructions §14
 * exactly:
 *   1. authenticate user      — done by the caller (the Server Action),
 *                                which only ever reaches here with a
 *                                real, session-resolved `userId`.
 *   2. resolve session        — likewise the caller's responsibility.
 *   3. authorize engagement access — step 2 below, derived from the
 *      AssessmentControl's own DB row, never from a browser-supplied
 *      engagement/organisation id (instructions §14: "do not trust a
 *      tenant_id/organisation_id/engagement_id supplied by the
 *      browser").
 *   4. validate input         — the caller's Zod schema, before this
 *                                function is ever invoked; this
 *                                function's own TypeScript input type is
 *                                the second, compile-time layer.
 *   5. perform the database mutation — step 4 below.
 *   6. rely on RLS as backstop — every query in this function runs
 *      through `db`, itself only reachable via `withRequestDb`'s
 *      `SET LOCAL ROLE authenticated` (lib/db/request-client.ts) — RLS
 *      independently re-checks every statement below.
 *   7/8. return result / display updated state — the caller's job.
 *
 * `system_suggested_rating` (PHASE C instructions §11) is deliberately
 * never written here — nothing in this project populates it (no
 * automated-suggestion engine exists), and this function's own input
 * type has no field for it; it is read-only, display-only data, exposed
 * accurately (via `getAssessmentDetail` above) rather than invented.
 */
export async function updateAssessmentResponse(
  db: RequestDb,
  userId: string,
  input: UpdateAssessmentResponseInput,
): Promise<void> {
  // 1-2. The AssessmentControl's own row is the authoritative source of
  // its tenant/organisation/engagement — never the browser's claim.
  const [ac] = await db
    .select({
      id: assessmentControls.id,
      assessmentId: assessmentControls.assessmentId,
      tenantId: assessmentControls.tenantId,
      organisationId: assessmentControls.organisationId,
      engagementId: assessmentControls.engagementId,
    })
    .from(assessmentControls)
    .where(eq(assessmentControls.id, input.assessmentControlId))
    .limit(1);
  if (!ac) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, ac.engagementId, ac.organisationId);

  // A clean, UI-friendly pre-check — the database's own finalization
  // trigger (Milestone 5, `enforce_assessment_response_draft_mutable`)
  // is the actual, unconditional enforcement (see the catch block below
  // for the case this check races against a concurrent finalization).
  const [assessment] = await db
    .select({ status: assessments.status })
    .from(assessments)
    .where(eq(assessments.id, ac.assessmentId))
    .limit(1);
  if (!assessment) throw new NotFoundOrForbiddenError();
  if (assessment.status === "finalized") {
    throw new AssessmentFinalizedError();
  }

  try {
    await db
      .insert(assessmentResponses)
      .values({
        assessmentControlId: ac.id,
        tenantId: ac.tenantId,
        organisationId: ac.organisationId,
        engagementId: ac.engagementId,
        effectivenessRating: input.effectivenessRating,
        decisionRationale: input.decisionRationale,
        respondentId: userId,
        submittedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: assessmentResponses.assessmentControlId,
        set: {
          effectivenessRating: input.effectivenessRating,
          decisionRationale: input.decisionRationale,
          respondentId: userId,
          submittedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    // The database's own finalization-immutability trigger is the real
    // security boundary here (instructions §16: "server-side
    // authorization must still prevent mutation even if a malicious
    // request is manually sent") — this catch only exists to translate
    // its raised exception into the same clean, generic error the
    // pre-check above throws, per instructions §17 ("do not expose
    // database internals... to users").
    if (err instanceof Error && /finalized/i.test(err.message)) {
      throw new AssessmentFinalizedError();
    }
    throw err;
  }
}

export interface CreateControlTestInput {
  assessmentId: string;
  controlId: string;
  methodology: string;
  sampleDescription: string | null;
  result: "pass" | "fail" | "exception_noted";
  testedAt: string | null;
}

/**
 * Slice C1 (PHASE C instructions §13/§17/§18): Browser → Server Action
 * → authenticate → authorize → validate → domain function → PostgreSQL
 * → RLS → audit — the same shape `updateAssessmentResponse` already
 * established. `assessmentId`/`controlId` are only ever used to look
 * up the authoritative Assessment row and to confirm the Control is
 * actually in scope for it — never trusted as proof of access by
 * themselves (instructions §17: never trust browser-supplied tenant/
 * organisation/engagement/control-library ids).
 *
 * Confirming an `assessment_controls` row exists for (assessmentId,
 * controlId) is also how this function satisfies instructions §18's
 * "Control belongs to Assessment's pinned library version" check —
 * `assessment_controls`' own composite FKs (assessment-controls.ts)
 * already make it structurally impossible for such a row to exist
 * unless the control truly belongs to the Assessment's pinned
 * ControlLibraryVersion, so confirming the row's existence proves the
 * invariant by construction, not by a second, redundant runtime check.
 */
export async function createControlTest(
  db: RequestDb,
  userId: string,
  input: CreateControlTestInput,
): Promise<{ id: string }> {
  const [assessment] = await db
    .select({
      id: assessments.id,
      status: assessments.status,
      tenantId: assessments.tenantId,
      organisationId: assessments.organisationId,
      engagementId: assessments.engagementId,
    })
    .from(assessments)
    .where(eq(assessments.id, input.assessmentId))
    .limit(1);
  if (!assessment) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, assessment.engagementId, assessment.organisationId);

  if (assessment.status === "finalized") {
    throw new AssessmentFinalizedError();
  }

  const [ac] = await db
    .select({ id: assessmentControls.id })
    .from(assessmentControls)
    .where(and(eq(assessmentControls.assessmentId, input.assessmentId), eq(assessmentControls.controlId, input.controlId)))
    .limit(1);
  if (!ac) throw new NotFoundOrForbiddenError();

  const id = randomUUID();
  try {
    await db.insert(controlTests).values({
      id,
      controlId: input.controlId,
      tenantId: assessment.tenantId,
      assessmentId: assessment.id,
      organisationId: assessment.organisationId,
      engagementId: assessment.engagementId,
      methodology: input.methodology,
      sampleDescription: input.sampleDescription,
      result: input.result,
      testerId: userId,
      testedAt: input.testedAt ? new Date(input.testedAt) : null,
    });
  } catch (err) {
    // Same pattern as updateAssessmentResponse's own catch — the
    // database's control_tests_enforce_draft_mutable trigger (migration
    // 0009) is the actual, unconditional enforcement against a
    // concurrent finalization race; this only translates its exception
    // into the same clean error the pre-check above throws.
    if (err instanceof Error && /finalized/i.test(err.message)) {
      throw new AssessmentFinalizedError();
    }
    throw err;
  }

  return { id };
}
