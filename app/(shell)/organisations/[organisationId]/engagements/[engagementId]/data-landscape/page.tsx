import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listProcessingActivities } from "@/lib/domain/processing-activities";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";

/**
 * Data Landscape (Slice D2, PRODUCT_UX_BLUEPRINT.md §5 row 9 / §14's
 * `/data-landscape` route): every Processing Activity in this
 * engagement, the connective hub of the whole model. "ROPA" is the same
 * data, resolved further — see the `/ropa` sub-route.
 */
export default async function DataLandscapePage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const data = await withRequestDb(user.id, async (db) => {
    try {
      const engagement = await getEngagementDetail(db, user.id, params.engagementId);
      if (engagement.organisationId !== params.organisationId) return null;
      const activities = await listProcessingActivities(db, user.id, {
        engagementId: params.engagementId,
        organisationId: params.organisationId,
      });
      return { engagement, activities };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!data) notFound();
  const { engagement, activities } = data;

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}`} className="hover:underline">
          {engagement.name}
        </Link>
      </p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Data Landscape</h1>
        <div className="flex items-center gap-4">
          <Link
            href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/data-landscape/ropa`}
            className="text-sm font-medium text-slate-900 underline"
          >
            View ROPA
          </Link>
          <Link
            href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/data-landscape/new`}
            className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            Create Processing Activity
          </Link>
        </div>
      </div>

      {searchParams.saved === "1" ? (
        <p role="status" className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Saved.
        </p>
      ) : null}
      {searchParams.error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {searchParams.error}
        </p>
      ) : null}

      {activities.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          No processing activities yet for this engagement.{" "}
          <Link
            href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/data-landscape/new`}
            className="font-medium text-slate-900 underline"
          >
            Create the first one
          </Link>
          .
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {activities.map((pa) => (
            <li key={pa.id}>
              <Link
                href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/data-landscape/${pa.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{pa.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {pa.businessUnitName ?? "no business unit"}
                    {pa.carriedForwardFromId ? " · carried forward" : ""}
                  </p>
                </div>
                <Badge tone={statusTone(pa.lifecycleStatus)}>{pa.lifecycleStatus}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
