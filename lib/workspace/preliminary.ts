import "server-only";
import type { RequestDb } from "@/lib/db/request-client";
import { getEngagementReportData } from "@/lib/domain/reports";
import { renderPreliminaryReportPdf } from "@/lib/reports/preliminary-report-pdf";
import { WorkspaceInputError, loadEngagement } from "./common";
import { clientSafeReportData, listReleasedReports, loadIssuedSummary } from "./reports";

/** Has Primus released a final report to this engagement? The preliminary report is offered after that. */
export async function finalReportReleased(db: RequestDb, engagementId: string): Promise<boolean> {
  return (await listReleasedReports(db, { engagementId })).length > 0;
}

/** Builds the preliminary report on request from the records the client may see. Nothing is stored. */
export async function buildPreliminaryReport(db: RequestDb, userId: string, engagementId: string): Promise<{ fileName: string; content: Buffer }> {
  const eng = await loadEngagement(db, userId, engagementId);
  if (!(await finalReportReleased(db, eng.id))) throw new WorkspaceInputError("The preliminary report is available once Primus has released your final report.");
  const full = await getEngagementReportData(db, userId, { organisationId: eng.organisationId, engagementId: eng.id });
  const data = await clientSafeReportData(db, full);
  const issued = await loadIssuedSummary(db, data.selectedAssessment.id);
  const content = await renderPreliminaryReportPdf(data, issued ? { headline: issued.headline, narrative: issued.narrative } : null);
  return { fileName: "preliminary-report.pdf", content };
}
