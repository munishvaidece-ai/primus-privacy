import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { listAllFindings } from "@/lib/workspace/portfolio";
import { PortalHeader } from "@/components/portal/header";
import { Badge, statusTone } from "@/components/ui/badge";
import { Empty, FilterBar, FilterSelect, Severity, Table, TD, fmtDate, titleCase } from "@/components/ui/kit";

export default async function PortalFindings({ searchParams }: { searchParams: { e?: string; severity?: string; status?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, current }) => (await listAllFindings(db)).filter((f) => f.engagementId === current.id && f.releasedAt));
  const rows = data.filter((f) => (!searchParams.severity || f.severity === searchParams.severity) && (!searchParams.status || f.status === searchParams.status));
  return (
    <div>
      <PortalHeader title="Findings" subtitle="Issues Primus has found and released to you, most serious first." engagements={portal.engagements} current={portal.current} />
      {data.length === 0 ? <Empty>No findings have been released to you yet.</Empty> : (
        <>
          <FilterBar reset={`/portal/findings${portal.q}`}>
            {portal.engagements.length > 1 ? <input type="hidden" name="e" value={portal.current.id} /> : null}
            <FilterSelect name="severity" label="Severity" value={searchParams.severity} options={["critical", "high", "medium", "low"].map((v) => ({ value: v, label: titleCase(v) }))} />
            <FilterSelect name="status" label="Status" value={searchParams.status} options={["open", "in_remediation", "resolved", "accepted"].map((v) => ({ value: v, label: titleCase(v) }))} />
          </FilterBar>
          <Table label="Findings" head={["Finding", "Severity", "Status", "Released"]}>
            {rows.map((f) => (
              <tr key={f.id}>
                <td className={TD}><Link href={`/organisations/${f.organisationId}/engagements/${f.engagementId}/findings/${f.id}`} className="font-medium text-slate-900 hover:underline">{f.title}</Link></td>
                <td className={TD}><Severity value={f.severity} /></td>
                <td className={TD}><Badge tone={statusTone(f.status)}>{titleCase(f.status)}</Badge></td>
                <td className={TD}>{fmtDate(f.releasedAt)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
