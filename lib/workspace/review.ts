import "server-only";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { assessmentControls, assessmentResponses, assessments, findings } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission, hasOrganisationPermission } from "@/lib/authorization/service";
import { WorkspaceInputError, loadEngagement } from "./common";
import { actorName, emit } from "./emit";

// ---------------------------------------------------------------------------
// Findings: draft until released
// ---------------------------------------------------------------------------

/** A reviewer with the release permission makes a draft finding visible to the client. */
export async function releaseFindings(db: RequestDb, userId: string, input: { engagementId: string; findingIds: string[] }): Promise<{ released: number }> {
  const eng = await loadEngagement(db, userId, input.engagementId);
  if (!(await hasEngagementPermission(db, userId, eng.id, "finding.release"))) throw new NotFoundOrForbiddenError();
  if (input.findingIds.length === 0) throw new WorkspaceInputError("Choose at least one finding to release.");
  if (!input.findingIds.every((i) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i))) throw new WorkspaceInputError("Those findings could not be found.");
  const rows = await db
    .update(findings)
    .set({ releasedAt: new Date(), releasedBy: userId, updatedBy: userId, updatedAt: new Date() })
    .where(and(eq(findings.engagementId, eng.id), isNull(findings.releasedAt), inArray(findings.id, input.findingIds)))
    .returning({ id: findings.id, title: findings.title });
  if (rows.length === 0) throw new WorkspaceInputError("Those findings are already released or could not be found.");
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: eng.id,
    kind: "findings_released",
    summary: `${who} released ${rows.length} finding${rows.length === 1 ? "" : "s"} to the client`,
    subjectType: "finding",
    subjectId: rows[0]!.id,
    clientVisible: true,
    notify: { audience: "client", title: `${rows.length} new finding${rows.length === 1 ? "" : "s"} released`, body: rows.slice(0, 3).map((r) => r.title).join("; "), link: "/portal/findings" },
  });
  return { released: rows.length };
}

// ---------------------------------------------------------------------------
// Assessment: the client submits, a reviewer validates or returns
// ---------------------------------------------------------------------------
export interface ReviewState {
  total: number;
  answered: number;
  validated: number;
  submittedAt: Date | null;
  status: "draft" | "finalized";
}

export async function getReviewState(db: RequestDb, assessmentId: string): Promise<ReviewState> {
  const [a] = await db.select({ id: assessments.id, status: assessments.status, submittedAt: assessments.submittedAt }).from(assessments).where(eq(assessments.id, assessmentId)).limit(1);
  if (!a) throw new NotFoundOrForbiddenError();
  const rows = await db
    .select({ rating: assessmentResponses.effectivenessRating, validatedAt: assessmentResponses.validatedAt })
    .from(assessmentControls)
    .leftJoin(assessmentResponses, eq(assessmentResponses.assessmentControlId, assessmentControls.id))
    .where(eq(assessmentControls.assessmentId, assessmentId));
  const applicable = rows.filter((r) => r.rating !== "not_applicable");
  return {
    total: applicable.length,
    answered: applicable.filter((r) => r.rating && r.rating !== "not_assessed").length,
    validated: applicable.filter((r) => r.validatedAt).length,
    submittedAt: a.submittedAt,
    status: a.status,
  };
}

export async function submitAssessment(db: RequestDb, userId: string, assessmentId: string): Promise<void> {
  const [a] = await db.select({ id: assessments.id, engagementId: assessments.engagementId, organisationId: assessments.organisationId, status: assessments.status, submittedAt: assessments.submittedAt }).from(assessments).where(eq(assessments.id, assessmentId)).limit(1);
  if (!a) throw new NotFoundOrForbiddenError();
  const eng = await loadEngagement(db, userId, a.engagementId);
  const canSubmit = (await hasEngagementPermission(db, userId, a.engagementId, "client.submit")) || (await hasOrganisationPermission(db, userId, a.organisationId, "client.submit")) || (await hasEngagementPermission(db, userId, a.engagementId, "assessment.review"));
  if (!canSubmit) throw new NotFoundOrForbiddenError();
  if (a.status === "finalized") throw new WorkspaceInputError("This assessment is already finalized.");
  if (a.submittedAt) throw new WorkspaceInputError("This assessment was already submitted.");
  const state = await getReviewState(db, assessmentId);
  if (state.answered < state.total) throw new WorkspaceInputError(`${state.total - state.answered} question${state.total - state.answered === 1 ? " is" : "s are"} still unanswered. Answer every applicable question before submitting.`);
  await db.update(assessments).set({ submittedAt: new Date(), submittedBy: userId, updatedBy: userId, updatedAt: new Date() }).where(eq(assessments.id, assessmentId));
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: eng.id,
    kind: "assessment_submitted",
    summary: `${who} submitted the assessment for review`,
    subjectType: "assessment",
    subjectId: assessmentId,
    clientVisible: true,
    notify: { audience: "practice", title: `${eng.organisationName} submitted the assessment`, body: "It is ready for review.", link: `/organisations/${eng.organisationId}/engagements/${eng.id}/assessments/${assessmentId}` },
  });
}

export async function returnAssessment(db: RequestDb, userId: string, input: { assessmentId: string; note?: string }): Promise<void> {
  const [a] = await db.select({ id: assessments.id, engagementId: assessments.engagementId, status: assessments.status, submittedAt: assessments.submittedAt }).from(assessments).where(eq(assessments.id, input.assessmentId)).limit(1);
  if (!a) throw new NotFoundOrForbiddenError();
  const eng = await loadEngagement(db, userId, a.engagementId);
  if (!(await hasEngagementPermission(db, userId, eng.id, "assessment.review"))) throw new NotFoundOrForbiddenError();
  if (a.status === "finalized") throw new WorkspaceInputError("A finalized assessment cannot be returned.");
  if (!a.submittedAt) throw new WorkspaceInputError("This assessment has not been submitted.");
  await db.update(assessments).set({ submittedAt: null, submittedBy: null, updatedBy: userId, updatedAt: new Date() }).where(eq(assessments.id, input.assessmentId));
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: eng.id,
    kind: "assessment_returned",
    summary: `${who} returned the assessment to the client for changes`,
    subjectType: "assessment",
    subjectId: input.assessmentId,
    clientVisible: true,
    notify: { audience: "client", title: "Your assessment was returned for changes", body: input.note?.slice(0, 300), link: "/portal/assessment" },
  });
}

/** Validates every answered, not-yet-validated answer of an assessment ("Validate all answered"). */
export async function validateAnswers(db: RequestDb, userId: string, input: { assessmentId: string; assessmentControlIds?: string[] }): Promise<{ validated: number }> {
  const [a] = await db.select({ id: assessments.id, engagementId: assessments.engagementId, status: assessments.status }).from(assessments).where(eq(assessments.id, input.assessmentId)).limit(1);
  if (!a) throw new NotFoundOrForbiddenError();
  const eng = await loadEngagement(db, userId, a.engagementId);
  if (!(await hasEngagementPermission(db, userId, eng.id, "assessment.review"))) throw new NotFoundOrForbiddenError();
  if (a.status === "finalized") throw new WorkspaceInputError("A finalized assessment is frozen.");
  const targets = await db
    .select({ responseId: assessmentResponses.id, controlId: assessmentControls.id })
    .from(assessmentControls)
    .innerJoin(assessmentResponses, eq(assessmentResponses.assessmentControlId, assessmentControls.id))
    .where(and(eq(assessmentControls.assessmentId, a.id), ne(assessmentResponses.effectivenessRating, "not_assessed"), isNull(assessmentResponses.validatedAt)));
  const wanted = input.assessmentControlIds ? new Set(input.assessmentControlIds) : null;
  const ids = targets.filter((t) => !wanted || wanted.has(t.controlId)).map((t) => t.responseId);
  for (const id of ids) {
    await db.update(assessmentResponses).set({ validatedAt: new Date(), validatedBy: userId }).where(eq(assessmentResponses.id, id));
  }
  if (ids.length > 0) {
    const who = await actorName(db, userId);
    await emit(db, { engagementId: eng.id, kind: "answers_validated", summary: `${who} validated ${ids.length} answer${ids.length === 1 ? "" : "s"}`, subjectType: "assessment", subjectId: a.id, clientVisible: true });
  }
  return { validated: ids.length };
}


/** Ids of the answers a reviewer has validated, for one assessment. */
export async function getValidatedResponseIds(db: RequestDb, assessmentId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: assessmentResponses.id })
    .from(assessmentControls)
    .innerJoin(assessmentResponses, eq(assessmentResponses.assessmentControlId, assessmentControls.id))
    .where(and(eq(assessmentControls.assessmentId, assessmentId), isNotNull(assessmentResponses.validatedAt)));
  return new Set(rows.map((r) => r.id));
}
