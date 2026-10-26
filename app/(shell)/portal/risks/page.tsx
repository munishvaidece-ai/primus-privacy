import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { listAllRisks } from "@/lib/workspace/portfolio";
import { PortalHeader } from "@/components/portal/header";
import { Badge, statusTone } from "@/components/ui/badge";
import { Empty, Severity, Table, TD, titleCase } from "@/components/ui/kit";
import { HeatMap } from "@/components/workspace/heatmap";

export default async function PortalRisks({ searchParams }: { searchParams: { e?: string } }) {
  const { portal, data } = await loadPortal(searchParams, ({ db, current }) => listAllRisks(db, { engagementId: current.id }));
  return (
    <div>
      <PortalHeader title="Risks" subtitle="Your risk register, with likelihood against impact." engagements={portal.engagements} current={portal.current} />
      {data.length === 0 ? <Empty>No risks recorded yet.</Empty> : (
        <>
          <section className="mb-6 rounded-md border border-slate-200 bg-white p-4"><HeatMap risks={data} /></section>
          <Table label="Risks" head={["Risk", "Inherent", "Residual", "Status", "Owner"]}>
            {data.map((r) => (
              <tr key={r.id}>
                <td className={TD}><Link href={`/organisations/${r.organisationId}/engagements/${r.engagementId}/risks/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.title}</Link></td>
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
