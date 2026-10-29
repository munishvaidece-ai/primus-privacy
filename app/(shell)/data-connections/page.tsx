import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage, uuidOr } from "@/lib/workspace/page";
import { engagementMetrics } from "@/lib/workspace/portfolio";
import { listConnectors } from "@/lib/connectors/service";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { PageHeader } from "@/components/ui/kit";
import { DataConnectionsView, type ConnectorRow } from "@/components/workspace/data-connections-view";

export const metadata = { title: "Documents and connections — PRIMUS PRIVACY" };

/** The same page the client sees, plus the connections already set up for the engagement you choose. */
export default async function DataConnectionsPage({ searchParams }: { searchParams: { e?: string; saved?: string; error?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, user }) => {
    const engagements = await engagementMetrics(db);
    const wanted = uuidOr(searchParams.e);
    const current = engagements.find((e) => e.id === wanted) ?? engagements.find((e) => e.status === "active") ?? engagements[0] ?? null;
    let connectors: ConnectorRow[] = [];
    if (current) {
      try {
        connectors = (await listConnectors(db, user.id, { engagementId: current.id, organisationId: current.organisationId })).map((c) => ({ id: c.id, name: c.name, connectorType: c.connectorType, status: c.status, lastTestOk: c.lastTestOk, lastTestMessage: c.lastTestMessage, lastRunAt: c.lastRunAt }));
      } catch (e) {
        if (!(e instanceof NotFoundOrForbiddenError)) throw e;
      }
    }
    return { engagements, current, connectors };
  });
  if (viewer.isClient) redirect("/portal/data-connections");
  const { engagements, current, connectors } = data;
  return (
    <div>
      <PageHeader title="Documents and connections" subtitle="Where clients upload documents and how you connect to their systems. Choose an engagement to see its connections." />
      {engagements.length === 0 || !current ? <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">There are no engagements yet.</p> : (
        <>
          <nav aria-label="Engagement" className="mb-6 flex flex-wrap gap-2">
            {engagements.map((e) => (
              <Link key={e.id} href={`/data-connections?e=${e.id}`} aria-current={e.id === current.id ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm ring-1 ring-inset ${e.id === current.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}>{e.organisationName}: {e.name}</Link>
            ))}
          </nav>
          <DataConnectionsView
            audience="primus"
            engagement={{ id: current.id, organisationId: current.organisationId, name: current.name }}
            backPath={`/data-connections?e=${current.id}`}
            journeyHref={`/organisations/${current.organisationId}/engagements/${current.id}/live`}
            clarificationsHref="/clarifications"
            canRequest={false}
            connectors={connectors}
            connectorsHref={`/organisations/${current.organisationId}/engagements/${current.id}/ai/connectors`}
          />
        </>
      )}
    </div>
  );
}
