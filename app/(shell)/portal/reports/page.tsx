import { loadPortal } from "@/lib/workspace/page";
import { listReleasedReports } from "@/lib/workspace/reports";
import { PortalHeader } from "@/components/portal/header";
import { Empty, Table, TD, fmtDateTime } from "@/components/ui/kit";

export default async function PortalReports({ searchParams }: { searchParams: { e?: string } }) {
  const { portal, data } = await loadPortal(searchParams, ({ db, current }) => listReleasedReports(db, { engagementId: current.id }));
  return (
    <div>
      <PortalHeader title="Reports" subtitle="Reports Primus has released to you. Each release is kept as its own version." engagements={portal.engagements} current={portal.current} />
      {data.length === 0 ? <Empty>No report has been released yet. Primus will tell you when one is ready.</Empty> : (
        <Table label="Released reports" head={["Report", "Version", "Released", "Size", ""]}>
          {data.map((r) => (
            <tr key={r.id}>
              <td className={TD}>{r.title}</td>
              <td className={TD}>v{r.version}</td>
              <td className={TD}>{fmtDateTime(r.releasedAt)}</td>
              <td className={TD}>{Math.max(1, Math.round(r.sizeBytes / 1024))} KB</td>
              <td className={TD}><a href={`/portal/reports/${r.id}/download`} className="font-medium text-slate-900 underline">Download PDF</a></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
