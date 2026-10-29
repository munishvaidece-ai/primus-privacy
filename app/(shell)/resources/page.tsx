import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { pickSector } from "@/lib/workspace/resources";
import { PageHeader } from "@/components/ui/kit";
import { ResourcesView } from "@/components/resources/resources-view";

/** The same reading list the clients see, so the team reads what their clients read. */
export default async function ResourcesPage({ searchParams }: { searchParams: { sector?: string } }) {
  const { viewer } = await loadPage(async () => null);
  if (viewer.isClient) redirect("/portal/resources");
  const sector = pickSector(searchParams.sector, []);
  return (
    <div>
      <PageHeader title="Resources" subtitle="The reading list your clients see: the DPDP Act, the Rules, and the laws of each sector. It is the same text, so you and the client are looking at the same thing." />
      <ResourcesView basePath="/resources" sector={sector} audience="primus" questionsHref={`/question-bank?sector=${sector.key}`} />
    </div>
  );
}
