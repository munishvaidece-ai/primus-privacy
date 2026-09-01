import "server-only";
import { asc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { assessments, assessmentControls, assessmentResponses, controls } from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";

export class AssessmentFinalizedError extends Error {
  constructor(message = "This assessment is finalized and can no longer be edited.") {
    super(message);
    this.name = "AssessmentFinalizedError";
  }
}

export interface AssessmentControlRow {
  assessmentControlId: string;
  controlId: string;
  controlCode: string;
  controlTitle: string;
  response: {
    id: string;
    effectivenessRating: string;
    decisionRationale: string | null;
  } | null;
}

export interface AssessmentDetail {
  id: string;
  periodLabel: string;
  assessmentType: string;
  status: string;
  engagementId: string;
  organisationId: string;
  controlRows: AssessmentControlRow[];
}

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
    })
    .from(assessments)
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
      responseId: assessmentResponses.id,
      effectivenessRating: assessmentResponses.effectivenessRating,
      decisionRationale: assessmentResponses.decisionRationale,
    })
    .from(assessmentControls)
    .innerJoin(controls, eq(controls.id, assessmentControls.controlId))
    .leftJoin(assessmentResponses, eq(assessmentResponses.assessmentControlId, assessmentControls.id))
    .where(eq(assessmentControls.assessmentId, assessmentId))
    .orderBy(asc(controls.code));

  const controlRows: AssessmentControlRow[] = rows.map((r) => ({
    assessmentControlId: r.assessmentControlId,
    controlId: r.controlId,
    controlCode: r.controlCode,
    controlTitle: r.controlTitle,
    response: r.responseId
      ? { id: r.responseId, effectivenessRating: r.effectivenessRating!, decisionRationale: r.decisionRationale }
      : null,
  }));

  return { ...assessment, controlRows };
}

export interface UpdateAssessmentResponseInput {
  assessmentControlId: string;
  effectivenessRating: "not_assessed" | "not_applicable" | "not_implemented" | "partially_implemented" | "implemented";
  decisionRationale: string | null;
}

/**
 * The Slice A1 vertical-slice write path (PHASE A instructions §13/§14).
 * Order of operations matches instructions §14 exactly:
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
