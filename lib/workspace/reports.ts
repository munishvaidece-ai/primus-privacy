import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { aiReportIssuances, findings, remediationFindings, reportReleases } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission } from "@/lib/authorization/service";
import { getEngagementReportData, type EngagementReportData } from "@/lib/domain/reports";
import { renderEngagementReportPdf } from "@/lib/reports/engagement-report-pdf";
import { loadEngagement } from "./common";
import { actorName, emit } from "./emit";

export interface ReleasedReportRow {
  id: string;
  title: string;
  version: number;
  fileName: string;
  sizeBytes: number;
  releasedAt: Date;
  engagementId: string;
  organisationId: string;
}

/**
 * The report as the client is allowed to see it: draft findings, and
 * remediation actions that exist only because of a draft finding, are left out.
 */
export async function clientSafeReportData(db: RequestDb, data: EngagementReportData): Promise<EngagementReportData> {
  const draft = await db
    .select({ id: findings.id })
    .from(findings)
    .where(and(eq(findings.engagementId, data.engagement.id), isNull(findings.releasedAt)));
  const draftIds = new Set(draft.map((d) => d.id));
  if (draftIds.size === 0) return data;
  const links = await db
    .select({ actionId: remediationFindings.remediationActionId, findingId: remediationFindings.findingId })
    .from(remediationFindings)
    .where(eq(remediationFindings.engagementId, data.engagement.id));
  const byAction = new Map<string, string[]>();
  for (const l of links) byAction.set(l.actionId, [...(byAction.get(l.actionId) ?? []), l.findingId]);
  const hidden = new Set<string>();
  for (const [action, fs] of byAction) if (fs.every((f) => draftIds.has(f))) hidden.add(action);
  return {
    ...data,
    findings: data.findings.filter((f) => !draftIds.has(f.id)),
    remediationActions: data.remediationActions.filter((r) => !hidden.has(r.id)),
  };
}

/** The headline and summary a person issued with the final report (latest version), or null if none was issued. */
export async function loadIssuedSummary(db: RequestDb, assessmentId: string): Promise<{ headline: string; narrative: string; version: number } | null> {
  const [row] = await db
    .select({ headline: aiReportIssuances.headline, narrative: aiReportIssuances.narrative, version: aiReportIssuances.version })
    .from(aiReportIssuances)
    .where(eq(aiReportIssuances.assessmentId, assessmentId))
    .orderBy(desc(aiReportIssuances.version))
    .limit(1);
  return row ? { headline: row.headline ?? "", narrative: row.narrative ?? "", version: row.version } : null;
}

/** Builds the engagement report from the current records and stores it, unchanged, for the client. */
export async function releaseReport(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string; userEmail: string | null; title?: string },
): Promise<{ id: string; version: number }> {
  const eng = await loadEngagement(db, userId, input.engagementId);
  if (eng.organisationId !== input.organisationId) throw new NotFoundOrForbiddenError();
  if (!(await hasEngagementPermission(db, userId, eng.id, "report.release"))) throw new NotFoundOrForbiddenError();
  const full = await getEngagementReportData(db, userId, { organisationId: eng.organisationId, engagementId: eng.id });
  const data = await clientSafeReportData(db, full);
  const pdf = await renderEngagementReportPdf(data, { generatedByEmail: input.userEmail, summary: await loadIssuedSummary(db, data.selectedAssessment.id) });
  const [maxRow] = await db
    .select({ v: sql<number>`coalesce(max(${reportReleases.version}), 0)::int` })
    .from(reportReleases)
    .where(and(eq(reportReleases.engagementId, eng.id), eq(reportReleases.reportType, "engagement_report")));
  const version = (maxRow?.v ?? 0) + 1;
  const title = (input.title?.trim() || `${eng.name} — engagement report`).slice(0, 200);
  const fileName = `engagement-report-v${version}.pdf`;
  const id = crypto.randomUUID();
  await db.insert(reportReleases).values({
    id,
    tenantId: eng.tenantId,
    organisationId: eng.organisationId,
    engagementId: eng.id,
    title,
    reportType: "engagement_report",
    version,
    fileName,
    contentType: "application/pdf",
    sizeBytes: pdf.length,
    content: pdf,
    releasedBy: userId,
  });
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: eng.id,
    kind: "report_released",
    summary: `${who} released report version ${version}`,
    subjectType: "report",
    subjectId: id,
    clientVisible: true,
    notify: { audience: "client", title: "A new report is available", body: title, link: "/portal/reports" },
  });
  return { id, version };
}

const listColumns = {
  id: reportReleases.id,
  title: reportReleases.title,
  version: reportReleases.version,
  fileName: reportReleases.fileName,
  sizeBytes: reportReleases.sizeBytes,
  releasedAt: reportReleases.releasedAt,
  engagementId: reportReleases.engagementId,
  organisationId: reportReleases.organisationId,
};

/** Released reports the caller can see (row security limits this to their own engagements). */
export async function listReleasedReports(db: RequestDb, input: { engagementId?: string } = {}): Promise<ReleasedReportRow[]> {
  const q = db.select(listColumns).from(reportReleases);
  const rows = input.engagementId ? await q.where(eq(reportReleases.engagementId, input.engagementId)).orderBy(desc(reportReleases.releasedAt)) : await q.orderBy(desc(reportReleases.releasedAt));
  return rows;
}

export async function getReleasedReportFile(db: RequestDb, reportId: string): Promise<{ fileName: string; contentType: string; content: Buffer }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) throw new NotFoundOrForbiddenError();
  const [r] = await db
    .select({ fileName: reportReleases.fileName, contentType: reportReleases.contentType, content: reportReleases.content })
    .from(reportReleases)
    .where(eq(reportReleases.id, reportId))
    .limit(1);
  if (!r) throw new NotFoundOrForbiddenError();
  return r;
}

