import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  assessments,
  assessmentControls,
  assessmentResponses,
  controls,
  riskScoringModels,
  risks,
  riskControls,
  users,
} from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";

// Slice C3 (PHASE C — RISK) — the Risk Engine. Turns Assessment results
// into a structured, traceable Risk register entry, using the EXACT
// existing Risk/RiskScoringModel/RiskControl model built (database-only)
// in Milestone 7 (migrations 0012/0013) — no schema change, no new
// table, no invented scoring algorithm. See this module's own function
// docstrings for where each PHASE C3 instruction is satisfied; the
// architectural findings that shaped this module are recorded in
// DECISIONS.md (new entries this slice) rather than re-derived here.

export class NoActiveRiskScoringModelError extends Error {
  constructor(message = "No active risk scoring model is configured for this tenant yet. Ask an administrator to configure one before creating risks.") {
    super(message);
    this.name = "NoActiveRiskScoringModelError";
  }
}

export class InvalidRiskInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRiskInputError";
  }
}

const RATING_VALUES = ["low", "medium", "high", "critical"] as const;
type RatingValue = (typeof RATING_VALUES)[number];

function assertScale(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new InvalidRiskInputError(`${field} must be a whole number between 1 and 5.`);
  }
}

export interface CreateRiskInput {
  assessmentId: string;
  controlId: string;
  title: string;
  description: string | null;
  likelihood: number;
  impact: number;
  inherentRating: RatingValue;
  residualLikelihood: number | null;
  residualImpact: number | null;
  residualRating: RatingValue | null;
  assignOwnerToSelf: boolean;
}

/**
 * Creates a Risk from an assessment/control context (PHASE C3
 * instructions §3): Assessment/Control → validate → authorize →
 * persist → audit (via the existing `risks_audit_log`/
 * `risk_controls_audit_log` triggers, migration 0013 — no new audit
 * mechanism). Mirrors `createControlTest`'s (lib/domain/assessments.ts)
 * exact shape: `assessmentId`/`controlId` are only ever used to look up
 * the authoritative `Assessment`/`AssessmentControl` rows; tenant/
 * organisation/engagement scope is always re-derived server-side from
 * those rows, never trusted from the caller (instructions §15).
 *
 * Traceability (instructions §4/§18/§19): confirming an
 * `assessment_controls` row exists for (assessmentId, controlId) proves
 * the Control is genuinely in scope for this Assessment (the same
 * "proof by construction via composite FK" `createControlTest` already
 * relies on), and is also what this Risk is traceable back to — a
 * `risk_controls` row is always created linking the Risk to this exact
 * Control (`risks.ts`'s own "Risk N ←→ N Control" junction, DATA_MODEL.md
 * §11), and `risks.assessment_response_id` is set to this
 * AssessmentControl's own AssessmentResponse when one already exists
 * (nullable — a Risk may legitimately be created before a formal
 * response is recorded). Both writes happen inside the same
 * `withRequestDb` transaction the caller already opened — no
 * cross-system compensating cleanup is needed here (unlike Evidence's
 * Storage+Postgres split in Slice C2), since both are plain Postgres
 * inserts that roll back together on any failure.
 *
 * Risk scoring (instructions §5/§6): `risk_scoring_model_id` is always
 * the tenant's single currently-`is_active` `RiskScoringModel` row
 * (migration 0013's own close-out trigger guarantees at most one exists
 * per tenant) — never a caller-supplied model id (instructions §15: "do
 * not accept browser-supplied scoring-model identifiers without
 * validation" — here, not accepted from the caller at all). If no
 * active model exists for this tenant, `NoActiveRiskScoringModelError`
 * is thrown rather than silently creating a Risk with no scoring basis,
 * or inventing a default matrix. `inherentRating`/`residualRating` are
 * recorded exactly as the consultant enters them — nothing in this
 * project computes a rating from `likelihood`×`impact` automatically
 * (`risk_scoring_models.ts`'s own comment: "this milestone stores and
 * pins the configuration; it does not implement an automatic scoring
 * calculator" — PRODUCT_UX_BLUEPRINT.md §21 confirms this was
 * deliberate through Milestone 8, not an oversight). Building a lookup
 * algorithm over `matrix_definition` here would mean inventing both an
 * algorithm AND a JSON-shape convention neither DATA_MODEL.md nor any
 * existing code defines (instructions §5's own "do not invent a new
 * scoring algorithm") — see DECISIONS.md for the full reasoning.
 *
 * Ownership (instructions §13): the only assignable owner is the
 * caller's own user id — no arbitrary-user picker, no user-directory
 * lookup (instructions §13's own "do not build a user-directory or
 * invitation system"), so cross-tenant assignment is structurally
 * impossible rather than merely checked.
 *
 * Finalized-assessment behavior (instructions §24): deliberately NOT
 * blocked by the source Assessment's finalization status — no database
 * trigger on `risks`/`risk_controls` references Assessment finalization
 * at all (confirmed by direct inspection of migration 0013), and
 * DATA_MODEL.md §8 frames Risk as the next stage in the chain this
 * project's own brief names ("Assessment → ... → Risk → later
 * Finding..."), routinely created from an ALREADY-finalized assessment's
 * result, not blocked by it. See DECISIONS.md for the full reasoning.
 */
export async function createRisk(
  db: RequestDb,
  userId: string,
  input: CreateRiskInput,
): Promise<{ id: string }> {
  if (!input.title.trim()) {
    throw new InvalidRiskInputError("Title is required.");
  }
  assertScale(input.likelihood, "Likelihood");
  assertScale(input.impact, "Impact");
  const hasAnyResidual = input.residualLikelihood !== null || input.residualImpact !== null || input.residualRating !== null;
  const hasAllResidual = input.residualLikelihood !== null && input.residualImpact !== null && input.residualRating !== null;
  if (hasAnyResidual && !hasAllResidual) {
    throw new InvalidRiskInputError("Residual likelihood, impact, and rating must be recorded together, or not at all.");
  }
  if (input.residualLikelihood !== null) assertScale(input.residualLikelihood, "Residual likelihood");
  if (input.residualImpact !== null) assertScale(input.residualImpact, "Residual impact");

  const [assessment] = await db
    .select({
      id: assessments.id,
      tenantId: assessments.tenantId,
      organisationId: assessments.organisationId,
      engagementId: assessments.engagementId,
    })
    .from(assessments)
    .where(eq(assessments.id, input.assessmentId))
    .limit(1);
  if (!assessment) throw new NotFoundOrForbiddenError();

  await requireEngagementAccess(db, userId, assessment.engagementId, assessment.organisationId);

  // Proves the Control is genuinely in scope for this Assessment — see
  // this function's own docstring above.
  const [ac] = await db
    .select({ id: assessmentControls.id })
    .from(assessmentControls)
    .where(and(eq(assessmentControls.assessmentId, input.assessmentId), eq(assessmentControls.controlId, input.controlId)))
    .limit(1);
  if (!ac) throw new NotFoundOrForbiddenError();

  const [response] = await db
    .select({ id: assessmentResponses.id })
    .from(assessmentResponses)
    .where(eq(assessmentResponses.assessmentControlId, ac.id))
    .limit(1);

  const [activeModel] = await db
    .select({ id: riskScoringModels.id })
    .from(riskScoringModels)
    .where(and(eq(riskScoringModels.tenantId, assessment.tenantId), eq(riskScoringModels.isActive, true)))
    .limit(1);
  if (!activeModel) throw new NoActiveRiskScoringModelError();

  const id = randomUUID();
  await db.insert(risks).values({
    id,
    engagementId: assessment.engagementId,
    organisationId: assessment.organisationId,
    tenantId: assessment.tenantId,
    assessmentResponseId: response?.id ?? null,
    riskScoringModelId: activeModel.id,
    title: input.title.trim(),
    description: input.description,
    likelihood: input.likelihood,
    impact: input.impact,
    inherentRating: input.inherentRating,
    residualLikelihood: input.residualLikelihood,
    residualImpact: input.residualImpact,
    residualRating: input.residualRating,
    ownerId: input.assignOwnerToSelf ? userId : null,
    createdBy: userId,
    updatedBy: userId,
  });

  await db.insert(riskControls).values({
    riskId: id,
    controlId: input.controlId,
    tenantId: assessment.tenantId,
    organisationId: assessment.organisationId,
    engagementId: assessment.engagementId,
    createdBy: userId,
  });

  return { id };
}

export interface UpdateRiskStatusInput {
  organisationId: string;
  engagementId: string;
  riskId: string;
  status: "open" | "mitigating" | "accepted" | "closed";
}

/**
 * The one supported post-creation edit (PHASE C3 instructions §12: "use
 * the existing Risk status enum... do not build downstream workflows
 * yet"). Title/description/likelihood/impact/ratings/owner are not
 * editable after creation in this slice — a minimal, professional form
 * matching instructions §7's own "minimum... required by the actual
 * schema," not a full risk-register edit screen (deferred, see
 * PROGRESS.md's "Known limitations").
 */
export async function updateRiskStatus(db: RequestDb, userId: string, input: UpdateRiskStatusInput): Promise<void> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [risk] = await db
    .select({ id: risks.id, organisationId: risks.organisationId, engagementId: risks.engagementId })
    .from(risks)
    .where(eq(risks.id, input.riskId))
    .limit(1);
  if (!risk || risk.organisationId !== input.organisationId || risk.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  await db
    .update(risks)
    .set({ status: input.status, updatedBy: userId, updatedAt: new Date() })
    .where(eq(risks.id, input.riskId));
}

export interface RiskListRow {
  id: string;
  title: string;
  inherentRating: string;
  residualRating: string | null;
  status: string;
  ownerEmail: string | null;
  sourceControlCode: string | null;
  sourceControlTitle: string | null;
  createdAt: Date;
}

/**
 * The basic engagement-wide Risk list (PHASE C3 instructions §9) — real
 * data, no dashboard, no charts. One batched query (LEFT JOIN, not one
 * query per risk) — `risk_controls` is a genuine many-to-many junction,
 * but this slice only ever creates exactly one `risk_controls` row per
 * Risk (see `createRisk` above), so a plain LEFT JOIN is sufficient here
 * without needing an aggregate; a Risk with more source Controls than
 * this slice itself ever creates (e.g. one added by a future slice or
 * directly in the database) would simply show its first joined Control
 * row, not silently drop the Risk from the list.
 */
export async function listRisksForEngagement(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string },
): Promise<RiskListRow[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const rows = await db
    .select({
      id: risks.id,
      title: risks.title,
      inherentRating: risks.inherentRating,
      residualRating: risks.residualRating,
      status: risks.status,
      ownerEmail: users.email,
      sourceControlCode: controls.code,
      sourceControlTitle: controls.title,
      createdAt: risks.createdAt,
    })
    .from(risks)
    .leftJoin(users, eq(users.id, risks.ownerId))
    .leftJoin(riskControls, eq(riskControls.riskId, risks.id))
    .leftJoin(controls, eq(controls.id, riskControls.controlId))
    .where(and(eq(risks.engagementId, input.engagementId), eq(risks.organisationId, input.organisationId)))
    .orderBy(desc(risks.createdAt));

  return rows;
}

export interface RiskForControlRow {
  id: string;
  title: string;
  inherentRating: string;
  residualRating: string | null;
  status: string;
  ownerEmail: string | null;
  createdAt: Date;
}

/**
 * Risks linked to one specific Control within one Engagement (PHASE C3
 * instructions §10) — the compact list the Assessment workspace shows
 * under the currently-selected Control. Scoped by `risk_controls`'
 * actual (engagementId, controlId) columns — the honest boundary this
 * junction table actually stores (it does not carry `assessment_id`),
 * not an invented tighter scope.
 */
export async function listRisksForControl(
  db: RequestDb,
  input: { engagementId: string; controlId: string },
): Promise<RiskForControlRow[]> {
  const rows = await db
    .select({
      id: risks.id,
      title: risks.title,
      inherentRating: risks.inherentRating,
      residualRating: risks.residualRating,
      status: risks.status,
      ownerEmail: users.email,
      createdAt: risks.createdAt,
    })
    .from(riskControls)
    .innerJoin(risks, eq(risks.id, riskControls.riskId))
    .leftJoin(users, eq(users.id, risks.ownerId))
    .where(and(eq(riskControls.engagementId, input.engagementId), eq(riskControls.controlId, input.controlId)))
    .orderBy(desc(risks.createdAt));

  return rows;
}

export interface RiskDetail {
  id: string;
  title: string;
  description: string | null;
  likelihood: number;
  impact: number;
  inherentRating: string;
  residualLikelihood: number | null;
  residualImpact: number | null;
  residualRating: string | null;
  status: string;
  ownerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  organisationId: string;
  engagementId: string;
  scoringModel: { id: string; name: string; version: string; matrixDefinition: unknown };
  sourceControls: { id: string; code: string; title: string }[];
  sourceAssessment: { id: string; periodLabel: string; status: string } | null;
  sourceAssessmentResponse: { id: string; effectivenessRating: string } | null;
}

/**
 * Risk detail (PHASE C3 instructions §8): identity, scoring, status,
 * owner, and the full source traceability chain — resolved from the
 * EXISTING relationships only (`risk_controls` for Control(s),
 * `assessment_response_id` → `assessment_controls` → `assessments` for
 * the source Assessment, when one is set). Evidence/ControlTest
 * traceability (instructions §8/§17) is deliberately NOT duplicated
 * here — the caller (the Risk detail page) reuses the EXISTING
 * `getControlTestsForControl`/`getEvidenceSummaryForControl` functions
 * directly with this result's own `sourceAssessment`/
 * `sourceAssessmentResponse`/`sourceControls` ids, exactly the same
 * functions the Assessment workspace already calls — no duplicate read
 * path, no copied Evidence metadata (instructions §17: "Risk should
 * reference the authoritative Evidence records").
 */
export async function getRiskDetail(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string; riskId: string },
): Promise<RiskDetail> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const [row] = await db
    .select({
      id: risks.id,
      title: risks.title,
      description: risks.description,
      likelihood: risks.likelihood,
      impact: risks.impact,
      inherentRating: risks.inherentRating,
      residualLikelihood: risks.residualLikelihood,
      residualImpact: risks.residualImpact,
      residualRating: risks.residualRating,
      status: risks.status,
      ownerEmail: users.email,
      createdAt: risks.createdAt,
      updatedAt: risks.updatedAt,
      organisationId: risks.organisationId,
      engagementId: risks.engagementId,
      assessmentResponseId: risks.assessmentResponseId,
      scoringModelId: riskScoringModels.id,
      scoringModelName: riskScoringModels.name,
      scoringModelVersion: riskScoringModels.version,
      scoringModelMatrix: riskScoringModels.matrixDefinition,
    })
    .from(risks)
    .innerJoin(riskScoringModels, eq(riskScoringModels.id, risks.riskScoringModelId))
    .leftJoin(users, eq(users.id, risks.ownerId))
    .where(eq(risks.id, input.riskId))
    .limit(1);
  if (!row || row.organisationId !== input.organisationId || row.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  const sourceControlRows = await db
    .select({ id: controls.id, code: controls.code, title: controls.title })
    .from(riskControls)
    .innerJoin(controls, eq(controls.id, riskControls.controlId))
    .where(eq(riskControls.riskId, row.id));

  let sourceAssessment: RiskDetail["sourceAssessment"] = null;
  let sourceAssessmentResponse: RiskDetail["sourceAssessmentResponse"] = null;
  if (row.assessmentResponseId) {
    const [respRow] = await db
      .select({
        id: assessmentResponses.id,
        effectivenessRating: assessmentResponses.effectivenessRating,
        assessmentId: assessments.id,
        periodLabel: assessments.periodLabel,
        assessmentStatus: assessments.status,
      })
      .from(assessmentResponses)
      .innerJoin(assessmentControls, eq(assessmentControls.id, assessmentResponses.assessmentControlId))
      .innerJoin(assessments, eq(assessments.id, assessmentControls.assessmentId))
      .where(eq(assessmentResponses.id, row.assessmentResponseId))
      .limit(1);
    if (respRow) {
      sourceAssessment = { id: respRow.assessmentId, periodLabel: respRow.periodLabel, status: respRow.assessmentStatus };
      sourceAssessmentResponse = { id: respRow.id, effectivenessRating: respRow.effectivenessRating };
    }
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    likelihood: row.likelihood,
    impact: row.impact,
    inherentRating: row.inherentRating,
    residualLikelihood: row.residualLikelihood,
    residualImpact: row.residualImpact,
    residualRating: row.residualRating,
    status: row.status,
    ownerEmail: row.ownerEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    organisationId: row.organisationId,
    engagementId: row.engagementId,
    scoringModel: {
      id: row.scoringModelId,
      name: row.scoringModelName,
      version: row.scoringModelVersion,
      matrixDefinition: row.scoringModelMatrix,
    },
    sourceControls: sourceControlRows,
    sourceAssessment,
    sourceAssessmentResponse,
  };
}
