import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { listClarifications } from "@/lib/workspace/clarifications";
import { engagementMetrics } from "@/lib/workspace/portfolio";
import { FilterBar, FilterSelect, Flash, PageHeader } from "@/components/ui/kit";
import { ClarificationList, RaiseClarification } from "@/components/workspace/clarifications-view";

export default async function ClarificationsPage({ searchParams }: { searchParams: { saved?: string; error?: string; status?: string } }) {
  const status = (["open", "answered", "closed"] as const).find((s) => s === searchParams.status);
  const { viewer, data } = await loadPage(async ({ db, viewer }) => (viewer.isClient ? null : { items: await listClarifications(db, { status }), engagements: await engagementMetrics(db) }));
  if (viewer.isClient || !data) redirect("/portal/clarifications");
  return (
    <div>
      <PageHeader title="Clarifications" subtitle="Questions between you and the client, kept as numbered threads so nothing is lost in email." />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <FilterBar reset="/clarifications">
        <FilterSelect name="status" label="Status" value={searchParams.status} options={[{ value: "open", label: "Open" }, { value: "answered", label: "Answered" }, { value: "closed", label: "Closed" }]} />
      </FilterBar>
      <ClarificationList items={data.items} base="/clarifications" isClient={false} />
      <div className="mt-6"><RaiseClarification back="/clarifications" engagements={data.engagements.filter((e) => e.status !== "closed").map((e) => ({ id: e.id, label: `${e.organisationName} · ${e.name}` }))} /></div>
    </div>
  );
}
