import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listRisksForEngagement } from "@/lib/domain/risks";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, riskRatingTone, riskStatusTone } from "@/components/ui/badge";

// Slice C3 (PHASE C3 instructions §9): a basic Risk list for this
// Engagement — real data, no dashboard, no charts, no analytics. One
// batched query (lib/domain/risks.ts's listRisksForEngagement), not one
// query per risk.
export default async function RiskListPage({
  params,
}: {
  params: { organisationId: string; engagementId: string };
}) {
  const user = await requireAuthenticatedUser();

  const risks = await withRequestDb(user.id, async (db) => {
    try {
      return await listRisksForEngagement(db, user.id, {
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
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Risks</h1>
      <p className="mt-1 text-sm text-slate-600">
        Risks recorded for this engagement, traceable to the assessment control(s) that identified them. Create a new risk
        from a control&rsquo;s Assessment Response in the Assessment workspace.
      </p>

      {risks.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          No risks recorded yet for this engagement.
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
                  Source control
                </th>
                <th scope="col" className="px-3 py-2">
                  Inherent rating
                </th>
                <th scope="col" className="px-3 py-2">
                  Residual rating
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
              {risks.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/risks/${r.id}`}
                      className="font-medium text-slate-900 underline"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {r.sourceControlCode ? (
                      <>
                        <span className="font-mono text-xs">{r.sourceControlCode}</span> {r.sourceControlTitle}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={riskRatingTone(r.inherentRating)}>{r.inherentRating}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {r.residualRating ? <Badge tone={riskRatingTone(r.residualRating)}>{r.residualRating}</Badge> : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={riskStatusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.ownerEmail ?? "unassigned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
