import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { PHASES, engagementMetrics } from "@/lib/workspace/portfolio";
import { Badge, statusTone } from "@/components/ui/badge";
import { Empty, FilterBar, FilterSelect, FilterText, PageHeader, PhaseBadge, Progress, Table, TD, fmtDate, includesCI, titleCase } from "@/components/ui/kit";

export default async function EngagementsPage({ searchParams }: { searchParams: { q?: string; phase?: string; status?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => (viewer.isClient ? [] : engagementMetrics(db)));
  if (viewer.isClient) redirect("/portal");
  const rows = data.filter((m) => includesCI(`${m.name} ${m.organisationName}`, searchParams.q) && (!searchParams.phase || m.phase === searchParams.phase) && (!searchParams.status || m.status === searchParams.status));
  return (
    <div>
      <PageHeader title="Engagements" subtitle="Every engagement you can see. The phase and progress are worked out from the records, not typed in." />
      <FilterBar reset="/engagements">
        <FilterText name="q" label="Search" value={searchParams.q} />
        <FilterSelect name="phase" label="Phase" value={searchParams.phase} options={PHASES.map((p) => ({ value: p, label: p }))} />
        <FilterSelect name="status" label="Status" value={searchParams.status} options={[{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "closed", label: "Closed" }]} />
      </FilterBar>
      {data.length === 0 ? <Empty>No engagements yet.</Empty> : rows.length === 0 ? <Empty>No engagement matches those filters.</Empty> : (
        <Table label="Engagements" head={["Client", "Engagement", "Type", "Period", "Status", "Phase", "Progress", "Critical/high", "Open tasks"]}>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className={TD}><Link href={`/organisations/${m.organisationId}`} className="hover:underline">{m.organisationName}</Link></td>
              <td className={TD}><Link href={`/organisations/${m.organisationId}/engagements/${m.id}`} className="font-medium text-slate-900 hover:underline">{m.name}</Link></td>
              <td className={TD}>{titleCase(m.engagementType)}</td>
              <td className={`${TD} whitespace-nowrap`}>{fmtDate(m.periodStart)} – {fmtDate(m.periodEnd)}</td>
              <td className={TD}><Badge tone={statusTone(m.status)}>{m.status}</Badge></td>
              <td className={TD}><PhaseBadge phase={m.phase} /></td>
              <td className={TD}><Progress value={m.progress} label={`${m.name} progress`} /></td>
              <td className={`${TD} tabular-nums`}>{m.findingsCriticalHigh}</td>
              <td className={`${TD} tabular-nums`}>{m.tasksOpen}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
