import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listEngagementScopes } from "@/lib/domain/applicability";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createEngagementScopeAction } from "./actions";

/**
 * Applicability & Scope (Slice D3, approved design §11): version
 * history for an Engagement's Scope. Most engagements will only ever
 * have one version; a revision (D3 §4/§17) opens a new one.
 */
export default async function ScopeIndexPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const data = await withRequestDb(user.id, async (db) => {
    try {
      const engagement = await getEngagementDetail(db, user.id, params.engagementId);
      if (engagement.organisationId !== params.organisationId) return null;
      const scopes = await listEngagementScopes(db, user.id, { engagementId: params.engagementId, organisationId: params.organisationId });
      return { engagement, scopes };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!data) notFound();
  const { engagement, scopes } = data;

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}`} className="hover:underline">
          {engagement.name}
        </Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Applicability &amp; Scope</h1>
      <p className="mt-1 text-sm text-slate-600">
        Which of this engagement&rsquo;s controls apply, and why — the record a consultant can point to when asked
        &ldquo;why is this control not applicable?&rdquo;
      </p>

      {searchParams.error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {searchParams.error}
        </p>
      ) : null}

      {scopes.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          <p>No scope has been determined for this engagement yet.</p>
          <form action={createEngagementScopeAction} className="mt-3">
            <input type="hidden" name="organisationId" value={params.organisationId} />
            <input type="hidden" name="engagementId" value={params.engagementId} />
            <Button type="submit" size="sm">
              Start Scope
            </Button>
          </form>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {scopes.map((s, i) => (
            <li key={s.id}>
              <Link
                href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/scope/${s.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Version {scopes.length - i} {i === 0 ? <span className="ml-1 text-xs font-normal text-slate-500">(current)</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">Created {s.createdAt.toISOString().slice(0, 10)}</p>
                </div>
                <Badge tone={statusTone(s.status)}>{s.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
