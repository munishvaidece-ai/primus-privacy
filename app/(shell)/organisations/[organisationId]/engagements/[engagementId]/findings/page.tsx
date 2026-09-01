import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listFindingsForEngagement } from "@/lib/domain/findings";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, riskRatingTone, findingStatusTone } from "@/components/ui/badge";

// Slice C4 (PHASE C4 instructions §6): a basic Finding list for this
// Engagement — real data, no dashboard, no charts, no analytics. One
// batched query (lib/domain/findings.ts's listFindingsForEngagement),
// not one query per finding.
export default async function FindingListPage({
  params,
}: {
  params: { organisationId: string; engagementId: string };
}) {
  const user = await requireAuthenticatedUser();

  const findings = await withRequestDb(user.id, async (db) => {
    try {
      return await listFindingsForEngagement(db, user.id, {
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
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Findings</h1>
      <p className="mt-1 text-sm text-slate-600">
        Findings recorded for this engagement, traceable to the risk that identified them. Create a new finding from a
        Risk&rsquo;s own detail page.
      </p>

      {findings.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          No findings recorded yet for this engagement.
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
                  Source risk
                </th>
                <th scope="col" className="px-3 py-2">
                  Severity
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="px-3 py-2">
                  Owner
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {findings.map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/findings/${f.id}`}
                      className="font-medium text-slate-900 underline"
                    >
                      {f.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{f.sourceRiskTitle ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={riskRatingTone(f.severity)}>{f.severity}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={findingStatusTone(f.status)}>{f.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{f.ownerEmail ?? "unassigned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
