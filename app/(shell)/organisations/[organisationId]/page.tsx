import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getOrganisationDetail } from "@/lib/domain/organisations";
import { canCreateEngagement, NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";

export default async function OrganisationDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string };
  searchParams: { created?: string; name?: string };
}) {
  const user = await requireAuthenticatedUser();

  const data = await withRequestDb(user.id, async (db) => {
    let organisation;
    try {
      organisation = await getOrganisationDetail(db, user.id, params.organisationId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
    const canCreateEng = await canCreateEngagement(db, user.id, organisation.id, organisation.tenantId);
    return { organisation, canCreateEng };
  });

  if (!data) notFound();
  const { organisation, canCreateEng } = data;

  return (
    <div>
      {/* Slice B2 (PHASE B2 instructions §2/§9) closed Slice B1's own
          finding (DECISIONS.md R-88): organisation creation now grants
          the creator OrganisationMembership in the same transaction, so
          this page is genuinely reachable immediately after creation —
          no special "not yet visible" fallback is needed any more. This
          banner is a one-time, purely informational success message
          driven only by the create action's own redirect parameters. */}
      {searchParams.created === "1" ? (
        <p role="status" className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          {searchParams.name ? <>“{searchParams.name}” was</> : "The organisation was"} created successfully. You
          are now an organisation member.
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{organisation.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Created {new Date(organisation.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
          </p>
        </div>
        <Badge tone={statusTone(organisation.status)}>{organisation.status}</Badge>
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Engagements</h2>
          {canCreateEng ? (
            <Link
              href={`/organisations/${organisation.id}/engagements/new`}
              className="text-sm font-medium text-slate-900 underline"
            >
              Create Engagement
            </Link>
          ) : null}
        </div>
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

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Members</h2>
        {organisation.members.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500">
            No organisation members yet.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {organisation.members.map((member) => (
              <li key={member.userId} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-slate-900">{member.email}</span>
                <span className="text-xs text-slate-500">{member.roleName}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
