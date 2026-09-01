import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";

export default async function EngagementDetailPage({
  params,
}: {
  params: { organisationId: string; engagementId: string };
}) {
  const user = await requireAuthenticatedUser();

  const engagement = await withRequestDb(user.id, async (db) => {
    try {
      return await getEngagementDetail(db, user.id, params.engagementId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  // The engagement genuinely belongs to a different organisation than
  // the URL claims — treat exactly like "not found," never leak which
  // organisation it actually belongs to.
  if (engagement.organisationId !== params.organisationId) notFound();

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${engagement.organisationId}`} className="hover:underline">
          {engagement.organisationName}
        </Link>
      </p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{engagement.name}</h1>
        <Badge tone={statusTone(engagement.status)}>{engagement.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {engagement.engagementType} · Control library:{" "}
        {engagement.controlLibraryVersionLabel ?? "not yet pinned"}
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Assessments</h2>
        {engagement.assessments.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">
            No assessments yet for this engagement.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {engagement.assessments.map((assessment) => (
              <li key={assessment.id}>
                <Link
                  href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/assessments/${assessment.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
                >
                  <div>
                    <span className="text-sm font-medium text-slate-900">{assessment.periodLabel}</span>
                    <span className="ml-2 text-xs text-slate-500">{assessment.assessmentType}</span>
                  </div>
                  <Badge tone={statusTone(assessment.status)}>{assessment.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
