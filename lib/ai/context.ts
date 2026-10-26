// Builds the inputs for each AI task from the engagement's real records.
// Everything here runs as the AI agent user under row-level security.
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  aiDocumentExtracts,
  aiReportIssuances,
  assessmentControls,
  assessmentResponses,
  assessments,
  controlTests,
  controls,
  documentVersions,
  engagements,
  evidence,
  evidenceLinks,
  findings,
  opsCases,
  organisations,
  riskControls,
  risks,
  engagementScopeControls,
  engagementScopes,
} from "@/db/schema";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { getAssessmentDetail } from "@/lib/domain/assessments";
import { getMaturityAssessmentForAssessment } from "@/lib/domain/maturity";
import { extractText } from "./extract";
import { readEvidenceObject } from "./storage-reader";
import { controlTier } from "./tier";
import type { EvidenceReviewInput } from "./tasks/evidence-review";
import type { ApplicabilityInput, LandscapeProfile } from "./tasks/applicability";
import type { RatingInput } from "./tasks/rating";
import type { FindingInput } from "./tasks/finding";
import type { ReportInput } from "./tasks/report";

type Ctrl = { code: string; title: string; description: string | null };
const withTier = (c: Ctrl) => ({ ...c, tier: controlTier(c).tier });

// ---------------------------------------------------------------- evidence
export async function loadEvidenceReviewInput(db: RequestDb, evidenceId: string, maxChars: number): Promise<EvidenceReviewInput | null> {
  const [ev] = await db
    .select({
      id: evidence.id,
      title: evidence.title,
      type: evidence.evidenceType,
      validUntil: evidence.validUntil,
      reviewStatus: evidence.reviewStatus,
      tenantId: evidence.tenantId,
      organisationId: evidence.organisationId,
      engagementId: evidence.engagementId,
      versionId: evidence.documentVersionId,
      path: documentVersions.storagePath,
      mime: documentVersions.mimeType,
      filename: documentVersions.originalFilename,
    })
    .from(evidence)
    .innerJoin(documentVersions, eq(documentVersions.id, evidence.documentVersionId))
    .where(eq(evidence.id, evidenceId))
    .limit(1);
  if (!ev) throw new NotFoundOrForbiddenError();
  if (ev.reviewStatus !== "pending_review") return null;

  const [cached] = await db.select().from(aiDocumentExtracts).where(eq(aiDocumentExtracts.documentVersionId, ev.versionId)).limit(1);
  let extract: { textContent: string; method: string } | undefined = cached;
  if (!extract) {
    const buf = await readEvidenceObject(ev.path);
    const x = await extractText(buf, ev.mime, ev.filename);
    const [row] = await db
      .insert(aiDocumentExtracts)
      .values({
        tenantId: ev.tenantId,
        organisationId: ev.organisationId,
        engagementId: ev.engagementId,
        documentVersionId: ev.versionId,
        textContent: x.text,
        charCount: x.text.length,
        truncated: x.truncated,
        method: x.method,
      })
      .onConflictDoNothing()
      .returning();
    extract = row ?? { textContent: x.text, method: x.method };
  }

  const ctrlRows = await db.execute<Ctrl & { id: string }>(sql`
    SELECT DISTINCT c.id, c.code, c.title, c.description
    FROM evidence_links el
    LEFT JOIN assessment_responses ar ON ar.id = el.assessment_response_id
    LEFT JOIN assessment_controls ac ON ac.id = ar.assessment_control_id
    LEFT JOIN control_tests ct ON ct.id = el.control_test_id
    JOIN controls c ON c.id = COALESCE(ac.control_id, ct.control_id)
    WHERE el.evidence_id = ${evidenceId}`);

  return {
    evidenceId: ev.id,
    title: ev.title,
    evidenceType: ev.type,
    filename: ev.filename,
    validUntil: ev.validUntil ? ev.validUntil.toISOString() : null,
    now: new Date().toISOString(),
    text: extract!.textContent,
    textMethod: extract!.method,
    controls: ctrlRows.rows.map(withTier),
    maxChars,
  };
}

/** Assessment controls affected when this evidence is reviewed (for follow-up rating jobs). */
export async function assessmentControlsForEvidence(db: RequestDb, evidenceId: string): Promise<string[]> {
  const r = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT ac.id
    FROM evidence_links el
    LEFT JOIN assessment_responses ar ON ar.id = el.assessment_response_id
    LEFT JOIN control_tests ct ON ct.id = el.control_test_id
    JOIN assessment_controls ac ON ac.id = ar.assessment_control_id
      OR (ac.assessment_id = ct.assessment_id AND ac.control_id = ct.control_id)
    WHERE el.evidence_id = ${evidenceId}`);
  return r.rows.map((x) => x.id);
}

// ----------------------------------------------------------- applicability
export async function loadLandscapeProfile(db: RequestDb, engagementId: string): Promise<LandscapeProfile> {
  const act = await db.execute<{ n: string; names: string | null }>(sql`
    SELECT count(*)::text AS n, string_agg(lower(name || ' ' || coalesce(description,'')), ' ') AS names
    FROM processing_activities WHERE engagement_id = ${engagementId} AND lifecycle_status <> 'retired'`);
  const cats = await db.execute<{ name: string }>(sql`
    SELECT DISTINCT v.name FROM processing_activity_data_principal_categories l
    JOIN data_principal_category_versions v ON v.id = l.data_principal_category_version_id
    WHERE l.engagement_id = ${engagementId}`);
  const els = await db.execute<{ name: string }>(sql`
    SELECT DISTINCT v.name FROM processing_activity_personal_data_elements l
    JOIN personal_data_element_versions v ON v.id = l.personal_data_element_version_id
    WHERE l.engagement_id = ${engagementId}`);
  const procs = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM processing_activity_processors WHERE engagement_id = ${engagementId}`);
  const hay = `${act.rows[0]?.names ?? ""} ${cats.rows.map((c) => c.name.toLowerCase()).join(" ")}`;
  return {
    activities: Number(act.rows[0]?.n ?? 0),
    principalCategories: cats.rows.map((c) => c.name),
    dataElements: els.rows.map((e) => e.name),
    hasProcessors: Number(procs.rows[0]?.n ?? 0) > 0,
    crossBorderHints: /overseas|abroad|outside india|cross[- ]border|international|offshore|\bus\b|\busa\b|\beu\b|europe/.test(hay),
    childrenHints: /child|minor|student|school|under 18|kids|teen/.test(hay),
  };
}

export async function loadUndecidedScopeControls(db: RequestDb, engagementId: string, limit = 500): Promise<string[]> {
  const rows = await db
    .select({ id: engagementScopeControls.id })
    .from(engagementScopeControls)
    .innerJoin(engagementScopes, eq(engagementScopes.id, engagementScopeControls.engagementScopeId))
    .where(and(eq(engagementScopeControls.engagementId, engagementId), eq(engagementScopes.status, "draft"), eq(engagementScopeControls.decision, "undecided")))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function loadApplicabilityInput(db: RequestDb, scopeControlId: string, profile: LandscapeProfile): Promise<ApplicabilityInput | null> {
  const [r] = await db
    .select({ id: engagementScopeControls.id, decision: engagementScopeControls.decision, code: controls.code, title: controls.title, description: controls.description })
    .from(engagementScopeControls)
    .innerJoin(controls, eq(controls.id, engagementScopeControls.controlId))
    .where(eq(engagementScopeControls.id, scopeControlId))
    .limit(1);
  if (!r || r.decision !== "undecided") return null;
  return { engagementScopeControlId: r.id, control: withTier(r), profile };
}

// ------------------------------------------------------------------ rating
export async function loadRatingInput(db: RequestDb, assessmentControlId: string): Promise<RatingInput | null> {
  const [ac] = await db
    .select({
      id: assessmentControls.id,
      assessmentId: assessmentControls.assessmentId,
      controlId: assessmentControls.controlId,
      applicability: assessmentControls.applicabilityDecision,
      code: controls.code,
      title: controls.title,
      description: controls.description,
      status: assessments.status,
    })
    .from(assessmentControls)
    .innerJoin(controls, eq(controls.id, assessmentControls.controlId))
    .innerJoin(assessments, eq(assessments.id, assessmentControls.assessmentId))
    .where(eq(assessmentControls.id, assessmentControlId))
    .limit(1);
  if (!ac || ac.status !== "draft" || ac.applicability === "not_applicable") return null;

  const [resp] = await db.select({ id: assessmentResponses.id, rating: assessmentResponses.effectivenessRating }).from(assessmentResponses).where(eq(assessmentResponses.assessmentControlId, ac.id)).limit(1);
  const tests = await db
    .select({ id: controlTests.id, result: controlTests.result, methodology: controlTests.methodology })
    .from(controlTests)
    .where(and(eq(controlTests.assessmentId, ac.assessmentId), eq(controlTests.controlId, ac.controlId)));

  const ev = await db.execute<{ id: string; title: string; review_status: string; quality_rating: string | null; valid_until: Date | null; ai: string | null }>(sql`
    SELECT DISTINCT e.id, e.title, e.review_status, e.quality_rating, e.valid_until,
      (SELECT s.proposed ->> 'quality' FROM ai_suggestions s
        WHERE s.kind = 'evidence_review' AND s.subject_id = e.id AND s.status IN ('auto_applied','approved','overridden')
        ORDER BY s.created_at DESC LIMIT 1) AS ai
    FROM evidence_links el
    JOIN evidence e ON e.id = el.evidence_id
    WHERE ${resp ? sql`el.assessment_response_id = ${resp.id}` : sql`false`}
       OR ${tests.length ? sql`el.control_test_id IN (${sql.join(tests.map((t) => sql`${t.id}`), sql`, `)})` : sql`false`}`);

  if (ev.rows.length === 0 && tests.length === 0) return null; // nothing to base a rating on yet
  return {
    assessmentControlId: ac.id,
    control: withTier(ac),
    currentRating: resp?.rating ?? null,
    evidence: ev.rows.map((e) => ({
      id: e.id,
      title: e.title,
      reviewStatus: e.review_status,
      quality: e.quality_rating ?? e.ai,
      aiVerdict: null,
      validUntil: e.valid_until ? new Date(e.valid_until).toISOString() : null,
    })),
    tests: tests.map((t) => ({ result: t.result, methodology: t.methodology })),
    now: new Date().toISOString(),
  };
}

/** Assessment controls in draft assessments that have something to rate. */
export async function loadRatableAssessmentControls(db: RequestDb, engagementId: string): Promise<string[]> {
  const r = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT ac.id FROM assessment_controls ac
    JOIN assessments a ON a.id = ac.assessment_id
    WHERE ac.engagement_id = ${engagementId} AND a.status = 'draft' AND ac.applicability_decision <> 'not_applicable'
      AND (
        EXISTS (SELECT 1 FROM control_tests ct WHERE ct.assessment_id = ac.assessment_id AND ct.control_id = ac.control_id)
        OR EXISTS (SELECT 1 FROM assessment_responses ar JOIN evidence_links el ON el.assessment_response_id = ar.id WHERE ar.assessment_control_id = ac.id)
      )`);
  return r.rows.map((x) => x.id);
}

// ----------------------------------------------------------------- finding
export async function loadFindingInput(db: RequestDb, assessmentControlId: string, ratingConfidence: number): Promise<FindingInput | null> {
  const [r] = await db
    .select({
      id: assessmentControls.id,
      assessmentId: assessmentControls.assessmentId,
      controlId: assessmentControls.controlId,
      engagementId: assessmentControls.engagementId,
      code: controls.code,
      title: controls.title,
      description: controls.description,
      rating: assessmentResponses.effectivenessRating,
      rationale: assessmentResponses.decisionRationale,
      status: assessments.status,
    })
    .from(assessmentControls)
    .innerJoin(controls, eq(controls.id, assessmentControls.controlId))
    .innerJoin(assessments, eq(assessments.id, assessmentControls.assessmentId))
    .innerJoin(assessmentResponses, eq(assessmentResponses.assessmentControlId, assessmentControls.id))
    .where(eq(assessmentControls.id, assessmentControlId))
    .limit(1);
  if (!r || r.status !== "draft") return null;
  if (r.rating !== "not_implemented" && r.rating !== "partially_implemented") return null;

  // Already has a risk for this control in this engagement? Then a finding exists or is a person's call.
  const existing = await db
    .select({ id: risks.id })
    .from(riskControls)
    .innerJoin(risks, eq(risks.id, riskControls.riskId))
    .where(and(eq(riskControls.controlId, r.controlId), eq(risks.engagementId, r.engagementId)))
    .limit(1);
  if (existing.length) return null;

  return {
    assessmentId: r.assessmentId,
    assessmentControlId: r.id,
    controlId: r.controlId,
    control: withTier(r),
    rating: r.rating,
    ratingRationale: r.rationale,
    ratingConfidence,
  };
}

export async function loadWeakRatedAssessmentControls(db: RequestDb, engagementId: string): Promise<string[]> {
  const r = await db.execute<{ id: string }>(sql`
    SELECT ac.id FROM assessment_controls ac
    JOIN assessments a ON a.id = ac.assessment_id AND a.status = 'draft'
    JOIN assessment_responses ar ON ar.assessment_control_id = ac.id
    WHERE ac.engagement_id = ${engagementId} AND ar.effectiveness_rating IN ('not_implemented','partially_implemented')
      AND NOT EXISTS (SELECT 1 FROM risk_controls rc JOIN risks rk ON rk.id = rc.risk_id WHERE rc.control_id = ac.control_id AND rk.engagement_id = ac.engagement_id)`);
  return r.rows.map((x) => x.id);
}

// ------------------------------------------------------------------ report
export async function loadFinalizedAssessmentsWithoutIssuance(db: RequestDb, engagementId: string): Promise<string[]> {
  const r = await db.execute<{ id: string }>(sql`
    SELECT a.id FROM assessments a
    WHERE a.engagement_id = ${engagementId} AND a.status = 'finalized'
      AND NOT EXISTS (SELECT 1 FROM ai_report_issuances i WHERE i.assessment_id = a.id)`);
  return r.rows.map((x) => x.id);
}

export async function loadReportInput(db: RequestDb, agentUserId: string, assessmentId: string): Promise<ReportInput | null> {
  const detail = await getAssessmentDetail(db, agentUserId, assessmentId);
  if (detail.status !== "finalized") return null;
  const [eng] = await db
    .select({ name: engagements.name, orgName: organisations.name })
    .from(engagements)
    .innerJoin(organisations, eq(organisations.id, engagements.organisationId))
    .where(eq(engagements.id, detail.engagementId))
    .limit(1);
  const rate = (r: string) => detail.controlRows.filter((c) => (c.response?.effectivenessRating ?? "not_assessed") === r).length;
  const sev = await db.select({ severity: findings.severity, n: sql<number>`count(*)::int` }).from(findings).where(eq(findings.engagementId, detail.engagementId)).groupBy(findings.severity);
  const bySev = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const s of sev) bySev[s.severity] = Number(s.n);
  const rem = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM remediation_actions WHERE engagement_id = ${detail.engagementId} AND status NOT IN ('validated','closed')`);
  const mat = await getMaturityAssessmentForAssessment(db, agentUserId, { assessmentId, organisationId: detail.organisationId, engagementId: detail.engagementId });
  return {
    assessmentId,
    organisationName: eng?.orgName ?? "the client",
    engagementName: eng?.name ?? "the engagement",
    periodLabel: detail.periodLabel,
    controlsTotal: detail.controlRows.length,
    implemented: rate("implemented"),
    partial: rate("partially_implemented"),
    notImplemented: rate("not_implemented"),
    notApplicable: rate("not_applicable"),
    notAssessed: rate("not_assessed"),
    findingsBySeverity: bySev,
    openRemediation: Number(rem.rows[0]?.n ?? 0),
    maturityScore: mat && mat.overallScore !== null ? `${mat.overallScore} (${mat.overallLevel ?? "level n/a"})` : null,
  };
}

// --------------------------------------------------------------------- ops
export async function loadOpenCases(db: RequestDb, engagementId: string) {
  return db
    .select()
    .from(opsCases)
    .where(and(eq(opsCases.engagementId, engagementId), eq(opsCases.status, "new")))
    .orderBy(asc(opsCases.receivedAt));
}
export async function loadCase(db: RequestDb, caseId: string) {
  const [c] = await db.select().from(opsCases).where(eq(opsCases.id, caseId)).limit(1);
  return c ?? null;
}
export { inArray };
