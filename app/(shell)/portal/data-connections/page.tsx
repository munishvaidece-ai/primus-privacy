import { loadPortal } from "@/lib/workspace/page";
import { hasPermission } from "@/lib/workspace/common";
import { PortalHeader } from "@/components/portal/header";
import { Flash } from "@/components/ui/kit";
import { DataConnectionsView } from "@/components/workspace/data-connections-view";

export const metadata = { title: "Documents and connections — PRIMUS PRIVACY" };

/** Where you upload documents and how Primus connects to your systems. */
export default async function PortalDataConnections({ searchParams }: { searchParams: { e?: string; saved?: string; error?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, user, current }) => ({ canRequest: await hasPermission(db, user.id, current, "client.contribute") }));
  const m = portal.current;
  return (
    <div>
      <PortalHeader title="Documents and connections" subtitle="Upload your documents, and, if you choose, let Primus look at a database, folder or website directly. You decide what is shared." engagements={portal.engagements} current={m} />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <DataConnectionsView
        audience="client"
        engagement={{ id: m.id, organisationId: m.organisationId, name: m.name }}
        backPath={`/portal/data-connections${portal.q}`}
        journeyHref={`/portal/journey${portal.q}`}
        evidenceHref={`/portal/evidence${portal.q}`}
        clarificationsHref={`/portal/clarifications${portal.q}`}
        canRequest={data.canRequest}
      />
    </div>
  );
}
