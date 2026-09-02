import "server-only";
import { desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { assessments, engagements } from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";
import { getEngagementDetail, type EngagementDetail } from "@/lib/domain/engagements";
import { getAssessmentDetail, type AssessmentDetail } from "@/lib/domain/assessments";
import { listRisksForEngagement, type RiskListRow } from "@/lib/domain/risks";
import { listFindingsForEngagement, type FindingListRow } from "@/lib/domain/findings";
import { listRemediationActionsForEngagement, type RemediationListRow } from "@/lib/domain/remediation";
import { listValidationRecordsForEngagement, type EngagementValidationRecordRow } from "@/lib/domain/validation";
import { getEvidenceSummaryForEngagement, type EngagementEvidenceRow } from "@/lib/domain/evidence";
import { getMaturityAssessmentForAssessment, type MaturityAssessmentDetail } from "@/lib/domain/maturity";

// Slice R1 — Basic Engagement Report. This module is the report's ONE
// data-aggregation point: it reuses the exact read models every other
// screen in this application already uses (getEngagementDetail,
// getAssessmentDetail, listRisksForEngagement, listFindingsForEngagement,
// listRemediationActionsForEngagement, listValidationRecordsForEngagement,
// getEvidenceSummaryForEngagement) rather than hand-maintaining a
// separate "what goes in the report" query set that could drift out of
// sync with the screens themselves (PRODUCT_UX_BLUEPRINT.md §7's own
// "one source of truth" framing, applied here). No new table, no
// snapshot/denormalized report row — every call below reads the live,
// current-as-of-now state of the Engagement.

export class NoAssessmentForEngagementError extends Error {
  constructor(message = "This engagement has no assessments yet, so an engagement report cannot be generated.") {
    super(message);
    this.name = "NoAssessmentForEngagementError";
  }
}

export interface EngagementReportEngagementSummary {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  engagementType: string;
  periodStart: string | null;
  periodEnd: string | null;
  organisationId: string;
  organisationName: string;
  controlLibraryVersionLabel: string | null;
}

export interface EngagementReportData {
  engagement: EngagementReportEngagementSummary;
  selectedAssessment: AssessmentDetail;
  risks: RiskListRow[];
  findings: FindingListRow[];
  remediationActions: RemediationListRow[];
  validationRecords: EngagementValidationRecordRow[];
  evidenceItems: EngagementEvidenceRow[];
  // M2 (Maturity Implementation, approval §26): null whenever no
  // MaturityAssessment exists yet for the selected Assessment — never
  // fabricated. The renderer distinguishes "not computed" from "computed"
  // by this null check alone, exactly as `getMaturityAssessmentForAssessment`
  // itself already does for every other caller.
  maturity: MaturityAssessmentDetail | null;
  generatedAt: Date;
}

/**
 * Selects which Assessment an Engagement Report reports on, when the
 * Engagement has more than one (PHASE R1 instructions §21 — resolved by
 * the user, not invented here: "Most recent Assessment," deterministic
 * ordering `created_at DESC, id DESC`). `created_at` alone is not
 * guaranteed unique (two Assessments could in principle be created in
 * the same instant); `id` (a UUID) as the tie-breaker makes the
 * ordering total and reproducible across repeated calls, matching the
 * user's own explicit instruction rather than the single-column
 * `desc(assessments.createdAt)` ordering `getEngagementDetail`'s own
 * (display-only) assessment list already uses.
 */
async function selectMostRecentAssessmentId(db: RequestDb, engagementId: string): Promise<string> {
  const [row] = await db
    .select({ id: assessments.id })
    .from(assessments)
    .where(eq(assessments.engagementId, engagementId))
    .orderBy(desc(assessments.createdAt), desc(assessments.id))
    .limit(1);
  if (!row) throw new NoAssessmentForEngagementError();
  return row.id;
}

/**
 * The Engagement Report's single coherent data read (PHASE R1
 * instructions §20/§2): one aggregation function, called once by the
 * Route Handler that renders the PDF, so every section of the generated
 * document reflects the same moment-in-time snapshot of the database
 * rather than several independently-timed reads that could each observe
 * a different state if a write happened mid-request. Every sub-read
 * below independently re-authorizes via its own existing
 * `requireEngagementAccess` call (the same defense-in-depth posture
 * this codebase has used since Slice C3 — no read model in this project
 * trusts a caller who already passed a check somewhere earlier in the
 * same request) — this function itself performs one more, explicit,
 * up-front check purely to fail fast with a clean error before any
 * sub-read runs, and, crucially, to catch the one thing none of those
 * sub-reads check: that the `organisationId` the caller supplied
 * actually matches this Engagement's own authoritative organisation
 * (instructions §18 — never trust a browser-supplied tenant/
 * organisation id; mirrors `EngagementDetailPage`'s own
 * `engagement.organisationId !== params.organisationId` check and
 * `finalizeAssessment`'s identical cross-check pattern).
 */
export async function getEngagementReportData(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string },
): Promise<EngagementReportData> {
  const engagement: EngagementDetail = await getEngagementDetail(db, userId, input.engagementId);
  if (engagement.organisationId !== input.organisationId) {
    throw new NotFoundOrForbiddenError();
  }
  // Belt-and-braces, matching every other multi-read domain function in
  // this codebase — `getEngagementDetail` above already performed the
  // real check.
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  // `tenantId` is not part of `EngagementDetail`'s own return shape (no
  // existing screen needs it) — read directly here, scoped to the exact
  // Engagement row already confirmed accessible above, purely so the
  // audit-log write below (Route Handler) has a real `tenant_id` to
  // record against, the same column every other direct `audit_log`
  // insert in this codebase (e.g. `getEvidenceDownloadUrl`) requires.
  const [engagementRow] = await db.select({ tenantId: engagements.tenantId }).from(engagements).where(eq(engagements.id, input.engagementId)).limit(1);
  if (!engagementRow) throw new NotFoundOrForbiddenError();

  const assessmentId = await selectMostRecentAssessmentId(db, input.engagementId);
  const selectedAssessment = await getAssessmentDetail(db, userId, assessmentId);

  // Sequential, not `Promise.all` — `db` is one `PoolClient` shared for
  // this whole request-scoped transaction (lib/db/request-client.ts),
  // and every other multi-read domain function in this codebase awaits
  // its queries one at a time on that same shared client; kept
  // consistent with that established style here rather than
  // introducing this project's first concurrent-query call site.
  const risks = await listRisksForEngagement(db, userId, input);
  const findings = await listFindingsForEngagement(db, userId, input);
  const remediationActions = await listRemediationActionsForEngagement(db, userId, input);
  const validationRecords = await listValidationRecordsForEngagement(db, userId, input);
  const evidenceItems = await getEvidenceSummaryForEngagement(db, userId, input);
  const maturity = await getMaturityAssessmentForAssessment(db, userId, {
    assessmentId,
    organisationId: input.organisationId,
    engagementId: input.engagementId,
  });

  return {
    engagement: {
      id: engagement.id,
      tenantId: engagementRow.tenantId,
      name: engagement.name,
      status: engagement.status,
      engagementType: engagement.engagementType,
      periodStart: engagement.periodStart,
      periodEnd: engagement.periodEnd,
      organisationId: engagement.organisationId,
      organisationName: engagement.organisationName,
      controlLibraryVersionLabel: engagement.controlLibraryVersionLabel,
    },
    selectedAssessment,
    risks,
    findings,
    remediationActions,
    validationRecords,
    evidenceItems,
    maturity,
    generatedAt: new Date(),
  };
}
