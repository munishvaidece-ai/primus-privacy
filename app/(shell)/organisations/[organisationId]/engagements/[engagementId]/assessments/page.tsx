import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listAssessmentsForEngagement } from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";

// The Assessment list (PHASE C instructions §5) — real PostgreSQL data
// only, no fake progress values. Progress is the exact read model
// PRODUCT_UX_BLUEPRINT.md §7 already specifies (see
// lib/domain/assessments.ts's listAssessmentsForEngagement).
//
// Slice C7.1: the "Create Assessment" link below is the fix for the C7
// review's own P0 finding — before this slice, this page's empty state
// ("No assessments yet") had no next action of any kind, and no
// function anywhere in the codebase could create one.
export default async function AssessmentsListPage({
  params,
}: {
  params: { organisationId: string; engagementId: string };
}) {
  const user = await requireAuthenticatedUser();

  const assessmentList = await withRequestDb(user.id, async (db) => {
    try {
      return await listAssessmentsForEngagement(db, user.id, params.engagementId, params.organisationId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!assessmentList) notFound();

  const newAssessmentPath = `/organisations/${params.organisationId}/engagements/${params.engagementId}/assessments/new`;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Assessments</h1>
        <Link
          href={newAssessmentPath}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Create Assessment
        </Link>
      </div>

      {assessmentList.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          <p>No assessments yet for this engagement.</p>
          <Link href={newAssessmentPath} className="mt-2 inline-block text-sm font-medium text-slate-900 underline">
            Create the first assessment
          </Link>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {assessmentList.map((a) => {
            const pct = a.progress.total > 0 ? Math.round((a.progress.completed / a.progress.total) * 100) : 0;
            return (
              <li key={a.id}>
                <Link
                  href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/assessments/${a.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{a.periodLabel}</span>
                      <span className="text-xs text-slate-500">{a.assessmentType}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {a.controlLibraryVersionLabel ?? "No methodology pinned"} · Updated{" "}
                      {new Date(a.lastUpdatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-slate-600" aria-label={`${a.progress.completed} of ${a.progress.total} controls responded`}>
                      {a.progress.completed}/{a.progress.total} ({pct}%)
                    </span>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
