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
      {engagement.periodStart || engagement.periodEnd ? (
        <p className="mt-1 text-sm text-slate-600">
          Period: {engagement.periodStart ?? "?"} – {engagement.periodEnd ?? "?"}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-slate-500">
        {engagement.currentUserRoleName
          ? <>Your role on this engagement: {engagement.currentUserRoleName}</>
          : "You can view this engagement through your organisation-level access."}
      </p>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Assessments</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/assessments`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View all ({engagement.assessments.length})
          </Link>
        </div>
        {engagement.assessments.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">
            No assessments yet for this engagement.
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            Most recent: {engagement.assessments[0]!.periodLabel} —{" "}
            <Badge tone={statusTone(engagement.assessments[0]!.status)}>{engagement.assessments[0]!.status}</Badge>
          </p>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Risks</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/risks`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View risks
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Created from an Assessment control&rsquo;s Assessment Response, in the Assessment workspace.
        </p>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Findings</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/findings`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View findings
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">Created from a Risk&rsquo;s own detail page.</p>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Remediation</h2>
          <Link
            href={`/organisations/${engagement.organisationId}/engagements/${engagement.id}/remediation`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View remediation
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">Created from a Finding&rsquo;s own detail page.</p>
      </section>
    </div>
  );
}
