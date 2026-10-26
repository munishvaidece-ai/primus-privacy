import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { listAllRisks } from "@/lib/workspace/portfolio";
import { Badge, statusTone } from "@/components/ui/badge";
import { Empty, FilterBar, FilterSelect, FilterText, PageHeader, Severity, Table, TD, includesCI, titleCase } from "@/components/ui/kit";
import { HeatMap } from "@/components/workspace/heatmap";

export default async function RisksPage({ searchParams }: { searchParams: { q?: string; rating?: string; status?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => (viewer.isClient ? [] : listAllRisks(db)));
  if (viewer.isClient) redirect("/portal/risks");
  const rows = data.filter((r) => includesCI(`${r.title} ${r.organisationName}`, searchParams.q) && (!searchParams.rating || r.inherent === searchParams.rating) && (!searchParams.status || r.status === searchParams.status));
  return (
    <div>
      <PageHeader title="Risks" subtitle="The risk register across your clients, with a heat map of likelihood against impact." />
      {data.length === 0 ? <Empty>No risks recorded yet.</Empty> : (
        <>
          <section className="mb-6 rounded-md border border-slate-200 bg-white p-4"><HeatMap risks={rows} /></section>
          <FilterBar reset="/risks">
            <FilterText name="q" label="Search" value={searchParams.q} />
            <FilterSelect name="rating" label="Inherent rating" value={searchParams.rating} options={["critical", "high", "medium", "low"].map((v) => ({ value: v, label: titleCase(v) }))} />
            <FilterSelect name="status" label="Status" value={searchParams.status} options={["open", "mitigating", "accepted", "closed"].map((v) => ({ value: v, label: titleCase(v) }))} />
          </FilterBar>
          <Table label="Risks" head={["Risk", "Client", "Inherent", "Residual", "Status", "Owner"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={TD}><Link href={`/organisations/${r.organisationId}/engagements/${r.engagementId}/risks/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.title}</Link></td>
                <td className={TD}>{r.organisationName}</td>
                <td className={TD}><Severity value={r.inherent} /></td>
                <td className={TD}>{r.residual ? <Severity value={r.residual} /> : <span className="text-slate-400">—</span>}</td>
                <td className={TD}><Badge tone={statusTone(r.status)}>{titleCase(r.status)}</Badge></td>
                <td className={TD}>{r.ownerEmail ?? <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
