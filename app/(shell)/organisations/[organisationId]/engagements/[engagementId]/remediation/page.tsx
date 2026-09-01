import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listRemediationActionsForEngagement } from "@/lib/domain/remediation";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, riskRatingTone, remediationStatusTone } from "@/components/ui/badge";

// Slice C5 (PHASE C5 instructions §14): a basic RemediationAction list
// for this Engagement — real data, no dashboard, no charts, no
// analytics. One batched query (lib/domain/remediation.ts's
// listRemediationActionsForEngagement), not one query per action.
export default async function RemediationListPage({
  params,
}: {
  params: { organisationId: string; engagementId: string };
}) {
  const user = await requireAuthenticatedUser();

  const actions = await withRequestDb(user.id, async (db) => {
    try {
      return await listRemediationActionsForEngagement(db, user.id, {
        organisationId: params.organisationId,
        engagementId: params.engagementId,
      });
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}`} className="hover:underline">
          Back to engagement
        </Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Remediation</h1>
      <p className="mt-1 text-sm text-slate-600">
        Remediation actions recorded for this engagement, traceable to the finding that identified the need for them.
        Create a new remediation action from a Finding&rsquo;s own detail page.
      </p>

      {actions.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          No remediation actions recorded yet for this engagement.
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-3 py-2">
                  Title
                </th>
                <th scope="col" className="px-3 py-2">
                  Source finding
                </th>
                <th scope="col" className="px-3 py-2">
                  Priority
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="px-3 py-2">
                  Owner
                </th>
                <th scope="col" className="px-3 py-2">
                  Due date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {actions.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/remediation/${r.id}`}
                      className="font-medium text-slate-900 underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.sourceFindingTitle ?? "—"}</td>
                  <td className="px-3 py-2">{r.priority ? <Badge tone={riskRatingTone(r.priority)}>{r.priority}</Badge> : "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={remediationStatusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.ownerEmail ?? "unassigned"}</td>
                  <td className="px-3 py-2 text-slate-600">{r.dueDate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
