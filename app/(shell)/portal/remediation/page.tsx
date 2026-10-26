import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { listAllRemediation } from "@/lib/workspace/portfolio";
import { PortalHeader } from "@/components/portal/header";
import { Badge, statusTone } from "@/components/ui/badge";
import { Empty, Severity, Table, TD, fmtDate, titleCase } from "@/components/ui/kit";

export default async function PortalRemediation({ searchParams }: { searchParams: { e?: string } }) {
  const { portal, data } = await loadPortal(searchParams, ({ db, current }) => listAllRemediation(db, { engagementId: current.id }));
  return (
    <div>
      <PortalHeader title="Remediation" subtitle="What needs fixing, who owns it, and by when." engagements={portal.engagements} current={portal.current} />
      {data.length === 0 ? <Empty>No remediation actions yet.</Empty> : (
        <Table label="Remediation actions" head={["Action", "Priority", "Status", "Owner", "Due"]}>
          {data.map((r) => (
            <tr key={r.id}>
              <td className={TD}><Link href={`/organisations/${r.organisationId}/engagements/${r.engagementId}/remediation/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.title}</Link></td>
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
