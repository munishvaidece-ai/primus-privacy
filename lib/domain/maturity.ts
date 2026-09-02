import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  assessments,
  assessmentControls,
  assessmentResponses,
  controlTests,
  maturityScoringMethodologies,
  maturityDomains,
  maturityDomainControlMappings,
  maturityDomainWeights,
  maturityAssessments,
  maturityScores,
} from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess, requireMaturityComputeAccess } from "@/lib/authorization/service";

// M2 (Maturity Implementation). Builds the calculation engine and
// orchestration this repository's own M1/M1.1 design review (approved)
// specified — no new persistence: every table this module reads from or
// writes to already existed, fully built and tested, since Milestone
// 8/8A. See M1_MATURITY_DESIGN.md and M1.1_MATURITY_FORMULA_INTEGRITY.md
// for the full reasoning; this file implements exactly the MVP
// methodology those documents settled on, nothing more (approval §31's
// explicit "no speculative features" list).

// =============================================================================
// Errors — one named, distinguishable failure per M2 approval §24's list.
// Never converted to a fabricated score; every one of these means "no
// MaturityAssessment/MaturityScore row is written."
// =============================================================================

export class AssessmentNotFinalizedForMaturityError extends Error {
  constructor(message = "Maturity can only be computed from a finalized Assessment.") {
    super(message);
    this.name = "AssessmentNotFinalizedForMaturityError";
  }
}

export class MaturityAlreadyComputedError extends Error {
  constructor(message = "A MaturityAssessment already exists for this Assessment. Maturity is computed at most once per Assessment.") {
    super(message);
    this.name = "MaturityAlreadyComputedError";
  }
}

export class NoActiveMaturityMethodologyError extends Error {
  constructor(
    message = "No active maturity scoring methodology is configured for this tenant yet. Ask an administrator to configure one before computing maturity.",
  ) {
    super(message);
    this.name = "NoActiveMaturityMethodologyError";
  }
}

export class InvalidMaturityMethodologyDefinitionError extends Error {
  constructor(message = "The active maturity scoring methodology's definition is missing a valid rating_scores mapping.") {
    super(message);
    this.name = "InvalidMaturityMethodologyDefinitionError";
  }
}

export interface IncompleteDomainDetail {
  maturityDomainId: string;
  domainName: string;
  domainCode: string;
  eligibleCount: number;
  answeredCount: number;
  unansweredCount: number;
  unansweredControlIds: string[];
}

/**
 * The critical anti-gaming failure (M2 approval §6/§7): at least one
 * scorable domain has an eligible (`applicable` or `undecided`) control
 * with no usable numeric rating. No MaturityAssessment/MaturityScore row
 * — draft or otherwise — is ever written when this is thrown; the
 * computation fails before any INSERT is attempted (§24: "do not write
 * fake score rows").
 */
export class IncompleteMaturityDataError extends Error {
  readonly incompleteDomains: IncompleteDomainDetail[];
  constructor(incompleteDomains: IncompleteDomainDetail[]) {
    super(
      incompleteDomains
        .map(
          (d) =>
            `Domain "${d.domainName}": ${d.eligibleCount} eligible control(s), ${d.answeredCount} answered, ${d.unansweredCount} unanswered. Maturity not calculated for this domain.`,
        )
        .join(" "),
    );
    this.name = "IncompleteMaturityDataError";
    this.incompleteDomains = incompleteDomains;
  }
}

export class MissingMaturityDomainWeightError extends Error {
  constructor(domainName: string) {
    super(
      `No active MaturityDomainWeight is configured for domain "${domainName}" on this engagement. Configure a weight before computing maturity — a missing weight is never treated as 0 or 1.`,
    );
    this.name = "MissingMaturityDomainWeightError";
  }
}

export class NoScorableMaturityDataError extends Error {
  constructor(
    message = "No domain has any eligible, mapped control for this Assessment. Maturity cannot be calculated.",
  ) {
    super(message);
    this.name = "NoScorableMaturityDataError";
  }
}

// =============================================================================
// Pure calculation helpers (M2 approval §22: "prefer pure functions...
// keep persistence/orchestration separate from pure arithmetic"). No I/O,
// no authorization, fully deterministic and independently testable.
// =============================================================================

/**
 * Round half up — deterministic and explicit rather than relying on
 * `Math.round`'s documented (but easy to misremember) half-up behavior,
 * per M2 approval §14. The maturity scale (`maturity_scores.score`,
 * DB CHECK 1-5) is always positive, so the naive `floor(x + 0.5)` form is
 * safe here; it is NOT reused for any hypothetically negative input.
 */
export function roundHalfUp(value: number): number {
  if (value < 0) {
    throw new Error("roundHalfUp is only defined for non-negative values (the maturity scale is always positive).");
  }
  return Math.floor(value + 0.5);
}

export type ControlApplicability = "applicable" | "undecided" | "not_applicable";

export interface DomainMappedControl {
  controlId: string;
  applicabilityDecision: ControlApplicability;
  /** The AssessmentResponse's effectiveness_rating, or null if no
   * AssessmentResponse row exists at all for this AssessmentControl
   * (DECISIONS.md R-54: "not yet assessed" is the row's absence). */
  effectivenessRating: string | null;
}

export interface UnscoreableControl {
  controlId: string;
  /** `unanswered` = no response row, or an explicit `not_assessed` /
   * `not_applicable` response rating (none of these carry a usable
   * numeric maturity input — M2 approval §10/§11: response status and
   * rating are distinct from applicability, and none may be conflated
   * with `not_implemented`). `unconfigured_rating` = a real rating value
   * exists but the pinned methodology's own `rating_scores` has no
   * numeric entry for it (a methodology configuration problem, §9). */
  reason: "unanswered" | "unconfigured_rating";
  rating: string | null;
}

export type DomainScoreOutcome =
  | { kind: "not_scorable"; reason: "no_mapped_controls" | "all_not_applicable" }
  | { kind: "incomplete"; eligibleCount: number; answeredCount: number; unscoreable: UnscoreableControl[] }
  | { kind: "scored"; eligibleCount: number; controlScores: number[]; score: number };

const SCOREABLE_RATINGS = new Set(["not_implemented", "partially_implemented", "implemented"]);

/**
 * Classifies exactly one domain's scorability for one Assessment (M2
 * approval §5/§6/§8). `mappedControls` must already be narrowed to the
 * Controls that are BOTH mapped to this domain (MaturityDomainControlMapping)
 * AND present as an AssessmentControl on this specific Assessment — a
 * mapping to a Control this Assessment never included is not this
 * function's concern.
 *
 * Distinguishes, per approval §8, exactly the four states required:
 *   - no_mapped_controls: nothing maps to this domain in this Assessment at all.
 *   - all_not_applicable: mapped controls exist, but every one is D3 `not_applicable`.
 *   - incomplete: at least one eligible control has no usable rating.
 *   - scored: every eligible control has a real, configured numeric rating.
 *
 * `not_scorable` (the first two) is NOT the same as `incomplete` — a
 * domain with nothing to score is simply excluded (no row, never a
 * fabricated zero), and does NOT block the overall score (approval §7's
 * "required/scorable domains" only ever refers to domains that HAVE
 * eligible controls). Only `incomplete` blocks.
 */
export function classifyDomainScore(
  mappedControls: DomainMappedControl[],
  ratingScores: Record<string, unknown>,
): DomainScoreOutcome {
  if (mappedControls.length === 0) {
    return { kind: "not_scorable", reason: "no_mapped_controls" };
  }
  const eligible = mappedControls.filter((c) => c.applicabilityDecision !== "not_applicable");
  if (eligible.length === 0) {
    return { kind: "not_scorable", reason: "all_not_applicable" };
  }

  const unscoreable: UnscoreableControl[] = [];
  const controlScores: number[] = [];
  for (const control of eligible) {
    const rating = control.effectivenessRating;
    if (rating === null || !SCOREABLE_RATINGS.has(rating)) {
      // No response at all, or an explicit `not_assessed`/`not_applicable`
      // response rating — none carry a numeric maturity input. Never
      // conflated with `not_implemented` (approval §10).
      unscoreable.push({ controlId: control.controlId, reason: "unanswered", rating });
      continue;
    }
    const mapped = ratingScores[rating];
    if (typeof mapped !== "number" || !Number.isFinite(mapped)) {
      unscoreable.push({ controlId: control.controlId, reason: "unconfigured_rating", rating });
      continue;
    }
    controlScores.push(mapped);
  }

  if (unscoreable.length > 0) {
    return { kind: "incomplete", eligibleCount: eligible.length, answeredCount: controlScores.length, unscoreable };
  }

  const mean = controlScores.reduce((sum, s) => sum + s, 0) / controlScores.length;
  return { kind: "scored", eligibleCount: eligible.length, controlScores, score: roundHalfUp(mean) };
}

export interface WeightedDomainScore {
  maturityDomainId: string;
  score: number;
  weight: number;
}

export type OverallScoreOutcome = { kind: "no_scorable_domains" } | { kind: "scored"; score: number };

/**
 * The domain-weighted mean of every SCORED domain's own score (M2
 * approval §13). Domains that were `not_scorable` never appear in
 * `domainScores` at all (they contribute to neither numerator nor
 * denominator — approval §7's own "do not silently omit incomplete
 * domains from the overall denominator" is about `incomplete` domains,
 * which never reach this function in the first place because they abort
 * the whole computation before this point, per `computeAndFinalizeMaturityAssessment`).
 */
export function classifyOverallScore(domainScores: WeightedDomainScore[]): OverallScoreOutcome {
  if (domainScores.length === 0) return { kind: "no_scorable_domains" };
  const weightSum = domainScores.reduce((sum, d) => sum + d.weight, 0);
  const weighted = domainScores.reduce((sum, d) => sum + d.score * d.weight, 0);
  return { kind: "scored", score: roundHalfUp(weighted / weightSum) };
}

export interface MaturityLevelBand {
  min: number;
  max: number;
  label: string;
}

/**
 * Resolves a numeric score to its human-readable label via the pinned
 * methodology's own `definition.levels` (M2 approval §15) — never a
 * hard-coded label set. Returns null if `levels` is missing/malformed or
 * no band matches; a missing level label is a cosmetic gap, never a
 * reason to fail the whole computation (the numeric score is the
 * load-bearing value).
 */
export function classifyLevel(score: number, levels: unknown): string | null {
  if (!Array.isArray(levels)) return null;
  for (const entry of levels) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as MaturityLevelBand).min === "number" &&
      typeof (entry as MaturityLevelBand).max === "number" &&
      typeof (entry as MaturityLevelBand).label === "string" &&
      score >= (entry as MaturityLevelBand).min &&
      score <= (entry as MaturityLevelBand).max
    ) {
      return (entry as MaturityLevelBand).label;
    }
  }
  return null;
}

// =============================================================================
// Orchestration (M2 approval §23): the single authoritative operation.
// =============================================================================

export interface ComputeMaturityInput {
  assessmentId: string;
}

export interface DomainResult {
  maturityDomainId: string;
  domainName: string;
  domainCode: string;
  score: number;
  level: string | null;
}

export interface ComputeMaturityResult {
  maturityAssessmentId: string;
  overallScore: number;
  overallLevel: string | null;
  domains: DomainResult[];
}

/**
 * Computes and finalizes a MaturityAssessment for one finalized Assessment
 * — the single authoritative operation M2 approval §23 specifies, steps
 * 1-18. Fully atomic: every write happens inside the caller's own
 * `withRequestDb` transaction (this function never opens its own nested
 * transaction — `withRequestDb` already wraps the whole call in
 * BEGIN/COMMIT/ROLLBACK), and every read/validation that can fail runs
 * BEFORE the first write, so a thrown error never leaves a partial
 * MaturityAssessment/MaturityScore row behind (approval §3/§24: "no
 * partial persistence... do not write fake score rows").
 *
 * Lifecycle (M1.1's finding, reaffirmed by approval §3): no separate
 * human-review "draft" step for MVP — the MaturityAssessment header is
 * inserted as 'draft', every MaturityScore row is inserted, and the
 * header is flipped to 'finalized', all within this one call. No
 * `discardDraftMaturityAssessment` exists (M1.1 §1/§9: unsupported by
 * the schema's own grants) and none is needed, because a failure here
 * rolls back before any row is ever durably written.
 *
 * "One MaturityAssessment per Assessment" (approval §4): this function
 * pre-checks for an existing MaturityAssessment and throws a clean,
 * named error rather than relying solely on the database's own
 * UNIQUE(assessment_id) constraint (migration 0029) — the constraint
 * remains the backstop, not the primary signal.
 */
export async function computeAndFinalizeMaturityAssessment(
  db: RequestDb,
  userId: string,
  input: ComputeMaturityInput,
): Promise<ComputeMaturityResult> {
  // 2. Load the authoritative Assessment; 4. resolve tenant/engagement/organisation.
  const [assessment] = await db
    .select({
      id: assessments.id,
      status: assessments.status,
      engagementId: assessments.engagementId,
      organisationId: assessments.organisationId,
      tenantId: assessments.tenantId,
    })
    .from(assessments)
    .where(eq(assessments.id, input.assessmentId))
    .limit(1);
  if (!assessment) throw new NotFoundOrForbiddenError();

  // 1. Authenticate/authorize — the dedicated `maturity.compute`
  // permission (M2 approval §20), never `assessment.finalize`/`scope.lock`.
  await requireMaturityComputeAccess(db, userId, assessment.engagementId, assessment.organisationId);

  // 3. Verify Assessment is finalized (approval §2: no completeness
  // requirement is added to Assessment finalization itself — this is a
  // Maturity-side precondition only).
  if (assessment.status !== "finalized") {
    throw new AssessmentNotFinalizedForMaturityError();
  }

  // Pre-check "one per Assessment" (approval §4) before doing any of the
  // real calculation work.
  const [existing] = await db
    .select({ id: maturityAssessments.id })
    .from(maturityAssessments)
    .where(eq(maturityAssessments.assessmentId, assessment.id))
    .limit(1);
  if (existing) throw new MaturityAlreadyComputedError();

  // 5. Resolve the pinned methodology — the tenant's single currently-
  // `is_active` MaturityScoringMethodology (mirrors `createRisk`'s own
  // `RiskScoringModel` resolution exactly — no stored FK from Assessment
  // to a methodology exists anywhere in the schema; this IS the
  // established resolution mechanism, not one invented for M2).
  const [methodology] = await db
    .select({ id: maturityScoringMethodologies.id, definition: maturityScoringMethodologies.definition })
    .from(maturityScoringMethodologies)
    .where(and(eq(maturityScoringMethodologies.tenantId, assessment.tenantId), eq(maturityScoringMethodologies.isActive, true)))
    .limit(1);
  if (!methodology) throw new NoActiveMaturityMethodologyError();

  const definition = methodology.definition as { rating_scores?: unknown; levels?: unknown } | null;
  const ratingScores = definition?.rating_scores;
  if (!ratingScores || typeof ratingScores !== "object" || Array.isArray(ratingScores)) {
    throw new InvalidMaturityMethodologyDefinitionError();
  }
  const levels = definition?.levels;

  // 6/7/8. AssessmentControls + their AssessmentResponses (one LEFT JOIN
  // — D3's applicability snapshot lives directly on assessment_controls;
  // never re-read from the current EngagementScope, per approval §5/§19).
  const controlRows = await db
    .select({
      controlId: assessmentControls.controlId,
      applicabilityDecision: assessmentControls.applicabilityDecision,
      effectivenessRating: assessmentResponses.effectivenessRating,
    })
    .from(assessmentControls)
    .leftJoin(assessmentResponses, eq(assessmentResponses.assessmentControlId, assessmentControls.id))
    .where(eq(assessmentControls.assessmentId, assessment.id));

  const controlById = new Map(controlRows.map((r) => [r.controlId, r]));

  // 9. Resolve maturity domains and mappings — every active MaturityDomain
  // for this Tenant, and every MaturityDomainControlMapping row for those
  // domains (both Tenant-scoped practice content, mirrors how the
  // methodology itself is resolved).
  const domainRows = await db
    .select({ id: maturityDomains.id, name: maturityDomains.name, code: maturityDomains.code })
    .from(maturityDomains)
    .where(and(eq(maturityDomains.tenantId, assessment.tenantId), eq(maturityDomains.isActive, true)));

  const mappingRows = domainRows.length
    ? await db
        .select({ maturityDomainId: maturityDomainControlMappings.maturityDomainId, controlId: maturityDomainControlMappings.controlId })
        .from(maturityDomainControlMappings)
        .where(inArray(maturityDomainControlMappings.maturityDomainId, domainRows.map((d) => d.id)))
    : [];
  const controlIdsByDomain = new Map<string, string[]>();
  for (const row of mappingRows) {
    const list = controlIdsByDomain.get(row.maturityDomainId) ?? [];
    list.push(row.controlId);
    controlIdsByDomain.set(row.maturityDomainId, list);
  }

  // 11/12/13. Validate + calculate every domain's score — pure
  // `classifyDomainScore`, no I/O — before any write.
  const incompleteDomains: IncompleteDomainDetail[] = [];
  const scoredDomains: Array<{ domain: (typeof domainRows)[number]; outcome: Extract<DomainScoreOutcome, { kind: "scored" }> }> = [];

  for (const domain of domainRows) {
    const mappedControlIds = controlIdsByDomain.get(domain.id) ?? [];
    const mapped: DomainMappedControl[] = [];
    for (const controlId of mappedControlIds) {
      const row = controlById.get(controlId);
      if (!row) continue; // mapped to a Control this Assessment never included — irrelevant here.
      mapped.push({ controlId, applicabilityDecision: row.applicabilityDecision, effectivenessRating: row.effectivenessRating });
    }
    const outcome = classifyDomainScore(mapped, ratingScores as Record<string, unknown>);
    if (outcome.kind === "incomplete") {
      incompleteDomains.push({
        maturityDomainId: domain.id,
        domainName: domain.name,
        domainCode: domain.code,
        eligibleCount: outcome.eligibleCount,
        answeredCount: outcome.answeredCount,
        unansweredCount: outcome.unscoreable.length,
        unansweredControlIds: outcome.unscoreable.map((u) => u.controlId),
      });
    } else if (outcome.kind === "scored") {
      scoredDomains.push({ domain, outcome });
    }
    // "not_scorable" domains are simply excluded — no row, never blocks.
  }

  // §7: ANY incomplete required/scorable domain blocks the ENTIRE
  // computation, including the overall score — never computed from only
  // the complete domains.
  if (incompleteDomains.length > 0) {
    throw new IncompleteMaturityDataError(incompleteDomains);
  }
  if (scoredDomains.length === 0) {
    throw new NoScorableMaturityDataError();
  }

  // 10. Resolve domain weights — required for every scored domain;
  // missing/invalid weighting fails safely rather than defaulting to 0/1
  // (approval §13).
  const weightRows = await db
    .select({ id: maturityDomainWeights.id, maturityDomainId: maturityDomainWeights.maturityDomainId, weight: maturityDomainWeights.weight })
    .from(maturityDomainWeights)
    .where(
      and(
        eq(maturityDomainWeights.engagementId, assessment.engagementId),
        eq(maturityDomainWeights.isActive, true),
        inArray(
          maturityDomainWeights.maturityDomainId,
          scoredDomains.map((s) => s.domain.id),
        ),
      ),
    );
  const weightByDomainId = new Map(weightRows.map((w) => [w.maturityDomainId, w]));
  for (const { domain } of scoredDomains) {
    if (!weightByDomainId.has(domain.id)) {
      throw new MissingMaturityDomainWeightError(domain.name);
    }
  }

  // 14. Calculate the overall score — weighted mean over every scored domain.
  const overallOutcome = classifyOverallScore(
    scoredDomains.map(({ domain, outcome }) => ({
      maturityDomainId: domain.id,
      score: outcome.score,
      weight: Number(weightByDomainId.get(domain.id)!.weight),
    })),
  );
  if (overallOutcome.kind !== "scored") {
    // Unreachable given the scoredDomains.length check above, kept as an
    // explicit guard rather than a silent fallthrough (§24: never a
    // fabricated score).
    throw new NoScorableMaturityDataError();
  }
  const overallLevel = classifyLevel(overallOutcome.score, levels);

  // ControlTest traceability (approval §16 — additive, no mathematical
  // effect): every ControlTest tied to this Assessment, bucketed by
  // control id, so each domain's MaturityScore row can cite the specific
  // tests behind its eligible controls (mirrors historical-scenario.test.ts's
  // own usage). No selection algorithm for `computed_from_risk_ids`/
  // `computed_from_validation_record_ids` exists anywhere in this
  // repository (DECISIONS.md R-79 leaves it open) — inventing one here
  // would be new scoring/selection logic this milestone does not add
  // (approval §18: "do not invent new scoring logic"), so both stay
  // null on the MaturityAssessment header, exactly as `createAssessment`
  // and every other create* function in this codebase leaves fields null
  // when no established derivation exists.
  const testRows = await db
    .select({ id: controlTests.id, controlId: controlTests.controlId })
    .from(controlTests)
    .where(eq(controlTests.assessmentId, assessment.id));
  const testIdsByControlId = new Map<string, string[]>();
  for (const row of testRows) {
    const list = testIdsByControlId.get(row.controlId) ?? [];
    list.push(row.id);
    testIdsByControlId.set(row.controlId, list);
  }

  // 15-17. Persist — MaturityAssessment (draft) -> every MaturityScore ->
  // finalize, all inside the caller's own `withRequestDb` transaction.
  const maturityAssessmentId = randomUUID();
  await db.insert(maturityAssessments).values({
    id: maturityAssessmentId,
    engagementId: assessment.engagementId,
    organisationId: assessment.organisationId,
    tenantId: assessment.tenantId,
    assessmentId: assessment.id,
    maturityScoringMethodologyId: methodology.id,
    computedBy: userId,
    createdBy: userId,
    updatedBy: userId,
  });

  const domainResults: DomainResult[] = [];
  for (const { domain, outcome } of scoredDomains) {
    const level = classifyLevel(outcome.score, levels);
    const mappedControlIds = controlIdsByDomain.get(domain.id) ?? [];
    const computedFromControlTestIds = mappedControlIds.flatMap((controlId) => testIdsByControlId.get(controlId) ?? []);
    await db.insert(maturityScores).values({
      id: randomUUID(),
      maturityAssessmentId,
      tenantId: assessment.tenantId,
      organisationId: assessment.organisationId,
      engagementId: assessment.engagementId,
      maturityDomainId: domain.id,
      maturityDomainWeightId: weightByDomainId.get(domain.id)!.id,
      score: outcome.score,
      maturityLevel: level,
      computedFromControlTestIds: computedFromControlTestIds.length ? computedFromControlTestIds : null,
      createdBy: userId,
    });
    domainResults.push({ maturityDomainId: domain.id, domainName: domain.name, domainCode: domain.code, score: outcome.score, level });
  }

  // The one overall row (`maturity_domain_id IS NULL`).
  await db.insert(maturityScores).values({
    id: randomUUID(),
    maturityAssessmentId,
    tenantId: assessment.tenantId,
    organisationId: assessment.organisationId,
    engagementId: assessment.engagementId,
    score: overallOutcome.score,
    maturityLevel: overallLevel,
    createdBy: userId,
  });

  await db.update(maturityAssessments).set({ status: "finalized", updatedBy: userId }).where(eq(maturityAssessments.id, maturityAssessmentId));

  return { maturityAssessmentId, overallScore: overallOutcome.score, overallLevel, domains: domainResults };
}

// =============================================================================
// Reads
// =============================================================================

export interface MaturityAssessmentDetail {
  id: string;
  status: string;
  computedAt: Date;
  finalizedAt: Date | null;
  methodologyName: string;
  methodologyVersion: string;
  overallScore: number | null;
  overallLevel: string | null;
  domains: DomainResult[];
}

/**
 * The finalized MaturityAssessment for an Assessment, if one exists — a
 * plain read, gated by the same broad engagement access every other
 * Maturity SELECT policy already uses (M2 approval §21: "do not weaken
 * existing SELECT policies"; only the write path is narrowed to
 * `maturity.compute`). Returns null if none exists yet (never fabricates
 * a placeholder result) — the caller distinguishes "not yet computed"
 * from "computed" itself.
 */
export async function getMaturityAssessmentForAssessment(
  db: RequestDb,
  userId: string,
  input: { assessmentId: string; organisationId: string; engagementId: string },
): Promise<MaturityAssessmentDetail | null> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [ma] = await db
    .select({
      id: maturityAssessments.id,
      status: maturityAssessments.status,
      computedAt: maturityAssessments.computedAt,
      finalizedAt: maturityAssessments.finalizedAt,
      methodologyName: maturityScoringMethodologies.name,
      methodologyVersion: maturityScoringMethodologies.version,
    })
    .from(maturityAssessments)
    .innerJoin(maturityScoringMethodologies, eq(maturityScoringMethodologies.id, maturityAssessments.maturityScoringMethodologyId))
    .where(and(eq(maturityAssessments.assessmentId, input.assessmentId), eq(maturityAssessments.engagementId, input.engagementId)))
    .limit(1);
  if (!ma) return null;

  const scoreRows = await db
    .select({
      maturityDomainId: maturityScores.maturityDomainId,
      score: maturityScores.score,
      maturityLevel: maturityScores.maturityLevel,
      domainNameSnapshot: maturityScores.domainNameSnapshot,
      domainCodeSnapshot: maturityScores.domainCodeSnapshot,
    })
    .from(maturityScores)
    .where(eq(maturityScores.maturityAssessmentId, ma.id));

  const overall = scoreRows.find((r) => r.maturityDomainId === null);
  const domains = scoreRows
    .filter((r) => r.maturityDomainId !== null)
    .map((r) => ({
      maturityDomainId: r.maturityDomainId as string,
      domainName: r.domainNameSnapshot ?? "",
      domainCode: r.domainCodeSnapshot ?? "",
      score: r.score,
      level: r.maturityLevel,
    }));

  return {
    id: ma.id,
    status: ma.status,
    computedAt: ma.computedAt,
    finalizedAt: ma.finalizedAt,
    methodologyName: ma.methodologyName,
    methodologyVersion: ma.methodologyVersion,
    overallScore: overall?.score ?? null,
    overallLevel: overall?.maturityLevel ?? null,
    domains,
  };
}
