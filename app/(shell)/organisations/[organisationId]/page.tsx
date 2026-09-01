import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getOrganisationDetail } from "@/lib/domain/organisations";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";

export default async function OrganisationDetailPage({
  params,
}: {
  params: { organisationId: string };
}) {
  const user = await requireAuthenticatedUser();

  const organisation = await withRequestDb(user.id, async (db) => {
    try {
      return await getOrganisationDetail(db, user.id, params.organisationId);
    } catch (err) {
      // SECURITY.md §13: a caller with no access sees the identical
      // "not found" response whether the row exists or not — never a
      // distinguishable "exists but forbidden" message.
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{organisation.name}</h1>
        <Badge tone={statusTone(organisation.status)}>{organisation.status}</Badge>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Engagements</h2>
        {organisation.engagements.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">
            No engagements yet for this organisation.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {organisation.engagements.map((engagement) => (
              <li key={engagement.id}>
                <Link
                  href={`/organisations/${organisation.id}/engagements/${engagement.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
                >
                  <div>
                    <span className="text-sm font-medium text-slate-900">{engagement.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{engagement.engagementType}</span>
                  </div>
                  <Badge tone={statusTone(engagement.status)}>{engagement.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
