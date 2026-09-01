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
  users,
} from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";

export class AssessmentFinalizedError extends Error {
  constructor(message = "This assessment is finalized and can no longer be edited.") {
    super(message);
    this.name = "AssessmentFinalizedError";
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
