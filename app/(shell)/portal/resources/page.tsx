import { loadPortal } from "@/lib/workspace/page";
import { getSectorQuestions } from "@/lib/workspace/discovery";
import { pickSector } from "@/lib/workspace/resources";
import { PortalHeader } from "@/components/portal/header";
import { ResourcesView } from "@/components/resources/resources-view";

/** The reading list for the client: the DPDP Act, the Rules, and the laws of the sector they choose. */
export default async function PortalResources({ searchParams }: { searchParams: { e?: string; sector?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, user, current }) => ({ state: await getSectorQuestions(db, user.id, current.id) }));
  const m = portal.current;
  const own = [...new Set([...data.state.setByPrimus, ...(data.state.declared ? [data.state.declared] : [])])];
  const sector = pickSector(searchParams.sector, own);
  return (
    <div>
      <PortalHeader title="Resources" subtitle="Read the DPDP Act, the Rules and the laws and guidelines for your sector, all in one place. Pick your sector and the page changes with it." engagements={portal.engagements} current={m} />
      <ResourcesView basePath="/portal/resources" keep={portal.engagements.length > 1 ? `e=${m.id}` : undefined} sector={sector} own={own} audience="client" questionsHref={`/portal/questions?${portal.engagements.length > 1 ? `e=${m.id}&` : ""}set=${sector.key}`} />
    </div>
  );
}
