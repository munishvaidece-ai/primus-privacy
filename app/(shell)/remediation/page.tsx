import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { listAllRemediation } from "@/lib/workspace/portfolio";
import { Badge, statusTone } from "@/components/ui/badge";
import { Empty, FilterBar, FilterSelect, FilterText, PageHeader, Severity, Table, TD, fmtDate, includesCI, titleCase } from "@/components/ui/kit";

export default async function RemediationPage({ searchParams }: { searchParams: { q?: string; status?: string; overdue?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => (viewer.isClient ? [] : listAllRemediation(db)));
  if (viewer.isClient) redirect("/portal/remediation");
  const rows = data.filter((r) => includesCI(`${r.title} ${r.organisationName}`, searchParams.q) && (!searchParams.status || r.status === searchParams.status) && (!searchParams.overdue || r.overdue));
  return (
    <div>
      <PageHeader title="Remediation" subtitle="Every remediation action across your clients. Open one to follow the evidence and validation." />
      <FilterBar reset="/remediation">
        <FilterText name="q" label="Search" value={searchParams.q} />
        <FilterSelect name="status" label="Status" value={searchParams.status} options={["open", "in_progress", "evidence_submitted", "validated", "closed"].map((v) => ({ value: v, label: titleCase(v) }))} />
        <FilterSelect name="overdue" label="Timing" value={searchParams.overdue} options={[{ value: "1", label: "Overdue only" }]} />
      </FilterBar>
      {data.length === 0 ? <Empty>No remediation actions yet.</Empty> : rows.length === 0 ? <Empty>No action matches those filters.</Empty> : (
        <Table label="Remediation actions" head={["Action", "Client", "Priority", "Status", "Owner", "Due"]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={TD}><Link href={`/organisations/${r.organisationId}/engagements/${r.engagementId}/remediation/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.title}</Link></td>
              <td className={TD}>{r.organisationName}</td>
              <td className={TD}>{r.priority ? <Severity value={r.priority} /> : <span className="text-slate-400">—</span>}</td>
              <td className={TD}><Badge tone={statusTone(r.status)}>{titleCase(r.status)}</Badge></td>
              <td className={TD}>{r.ownerEmail ?? <span className="text-slate-400">—</span>}</td>
              <td className={TD}>{fmtDate(r.dueDate)} {r.overdue ? <Badge tone="critical">overdue</Badge> : null}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
