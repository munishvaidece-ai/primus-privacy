import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementReportData, NoAssessmentForEngagementError } from "@/lib/domain/reports";
import { renderEngagementReportPdf } from "@/lib/reports/engagement-report-pdf";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { auditLog } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Slice R1 (PHASE R1 instructions §17/§18/§22): Authenticated user →
 * server authorization (the same Engagement-access check every other
 * screen uses — `getEngagementReportData` calls `requireEngagementAccess`
 * internally) → one coherent read of live governance-loop data → PDF
 * rendering → audited binary response. A plain GET, exactly like the
 * Evidence download route (`.../evidence/[evidenceId]/download/
 * route.ts`, Slice C2) so the Engagement page's "Generate Engagement
 * Report" entry point can be a compact `<a>` link with no client-side
 * JavaScript.
 *
 * Never trusts the `organisationId`/`engagementId` route params as
 * authority by themselves (instructions §18): `getEngagementReportData`
 * re-derives the Engagement's own authoritative `organisationId` from
 * its database row and cross-checks it against the param before
 * returning anything, the same posture `finalizeAssessment` (Slice
 * C7.3) and `EngagementDetailPage` already established.
 *
 * Audit (PRODUCT_UX_BLUEPRINT.md §7 Reports section: "report generation
 * itself should be an audited event... who generated/downloaded which
 * report, when"): written directly to `audit_log` here, in this Route
 * Handler, using the exact precedent `getEvidenceDownloadUrl` (Slice C2)
 * established for the identical situation — an action that is not
 * itself a row mutation any trigger could observe, so no trigger can do
 * this write for us. No new `generated_reports` table: PRODUCT_UX_
 * BLUEPRINT.md §7 itself frames that table as "a candidate small
 * addition, not yet designed," not a requirement — the actual
 * requirement is the audited *event*, which `audit_log` alone already
 * satisfies (instructions §25/§32). `fieldChanges` records only which
 * Assessment was reported on, never any Risk/Finding/Remediation/
 * Evidence content — the report's own substance is never logged
 * (instructions §31).
 */
export async function GET(
  _request: Request,
  { params }: { params: { organisationId: string; engagementId: string } },
) {
  const user = await requireAuthenticatedUser();

  try {
    const pdfBuffer = await withRequestDb(user.id, async (db) => {
      const data = await getEngagementReportData(db, user.id, {
        organisationId: params.organisationId,
        engagementId: params.engagementId,
      });

      const pdf = await renderEngagementReportPdf(data, { generatedByEmail: user.email });

      await db.insert(auditLog).values({
        tenantId: data.engagement.tenantId,
        actorUserId: user.id,
        entityType: "engagement",
        entityId: params.engagementId,
        action: "insert",
        reason: "engagement_report_generated",
        fieldChanges: {
          selectedAssessmentId: data.selectedAssessment.id,
          selectedAssessmentPeriodLabel: data.selectedAssessment.periodLabel,
          selectedAssessmentType: data.selectedAssessment.assessmentType,
          generatedAt: data.generatedAt.toISOString(),
        },
      });

      return pdf;
    });

    const fileNameSafe = params.engagementId;
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="engagement-report-${fileNameSafe}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (err instanceof NoAssessmentForEngagementError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // instructions §33: never expose database internals to users — full
    // detail goes to the server log only. instructions §31: this log
    // line itself carries no report content, only the failure.
    console.error("Engagement report generation failed", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
