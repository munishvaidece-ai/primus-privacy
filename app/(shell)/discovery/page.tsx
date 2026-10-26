import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { engagementMetrics } from "@/lib/workspace/portfolio";
import { SECTIONS } from "@/lib/workspace/discovery-sections";
import { Badge } from "@/components/ui/badge";
import { Empty, PageHeader, Progress, Table, TD } from "@/components/ui/kit";

const label = { none: "Not started", in_progress: "In progress", submitted: "Submitted — needs review", approved: "Approved" } as const;
const tone = { none: "neutral", in_progress: "neutral", submitted: "warning", approved: "positive" } as const;

export default async function DiscoveryOverviewPage() {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => (viewer.isClient ? [] : engagementMetrics(db)));
  if (viewer.isClient) redirect("/portal/discovery");
  const rows = [...data].sort((a, b) => Number(b.discoveryStatus === "submitted") - Number(a.discoveryStatus === "submitted"));
  return (
    <div>
      <PageHeader title="Discovery" subtitle={`Where each client is with the ${SECTIONS.length}-step discovery questionnaire. Open a submitted one to read the answers, then approve the scope or send it back.`} />
      {rows.length === 0 ? <Empty>No engagements yet.</Empty> : (
        <Table label="Discovery status" head={["Client", "Engagement", "Status", "Steps complete", ""]}>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className={TD}>{m.organisationName}</td>
              <td className={TD}>{m.name}</td>
              <td className={TD}><Badge tone={tone[m.discoveryStatus]}>{label[m.discoveryStatus]}</Badge></td>
              <td className={TD}><Progress value={(m.discoveryStatus === "approved" ? SECTIONS.length : m.discoveryDone) / SECTIONS.length * 100} label="Steps complete" /></td>
              <td className={TD}><Link href={`/discovery/${m.id}`} className="font-medium text-slate-900 hover:underline">Open</Link></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
