import { loadPortal } from "@/lib/workspace/page";
import { listClarifications } from "@/lib/workspace/clarifications";
import { PortalHeader } from "@/components/portal/header";
import { Flash } from "@/components/ui/kit";
import { ClarificationList, RaiseClarification } from "@/components/workspace/clarifications-view";

export default async function PortalClarifications({ searchParams }: { searchParams: { e?: string; saved?: string; error?: string } }) {
  const { portal, data } = await loadPortal(searchParams, ({ db, current }) => listClarifications(db, { engagementId: current.id }));
  return (
    <div>
      <PortalHeader title="Clarifications" subtitle="Questions between your team and Primus. Each one is a short conversation that is closed when settled." engagements={portal.engagements} current={portal.current} />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <div className="mb-6"><RaiseClarification engagements={[]} fixedEngagementId={portal.current.id} back={`/portal/clarifications${portal.q}`} /></div>
      <ClarificationList items={data} base="/portal/clarifications" isClient q={portal.q} />
    </div>
  );
}
