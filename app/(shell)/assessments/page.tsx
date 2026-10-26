import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { listAllAssessments } from "@/lib/workspace/portfolio";
import { Badge } from "@/components/ui/badge";
import { Empty, FilterBar, FilterSelect, PageHeader, Progress, Table, TD, fmtDateTime, titleCase } from "@/components/ui/kit";

type State = "awaiting" | "client" | "finalized";
const stateOf = (a: { status: string; submittedAt: Date | null }): State => (a.status === "finalized" ? "finalized" : a.submittedAt ? "awaiting" : "client");

export default async function AssessmentsPage({ searchParams }: { searchParams: { state?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => (viewer.isClient ? [] : listAllAssessments(db)));
  if (viewer.isClient) redirect("/portal/assessment");
  const rows = data.filter((a) => !searchParams.state || stateOf(a) === searchParams.state);
  const label: Record<State, string> = { awaiting: "Submitted — validate", client: "With the client", finalized: "Finalized" };
  return (
    <div>
      <PageHeader title="Assessments" subtitle="Assessments across your clients. Submitted ones come first: open one to validate the answers or send it back." />
      <FilterBar reset="/assessments">
        <FilterSelect name="state" label="State" value={searchParams.state} options={[{ value: "awaiting", label: "Submitted — validate" }, { value: "client", label: "With the client" }, { value: "finalized", label: "Finalized" }]} />
      </FilterBar>
      {data.length === 0 ? <Empty>No assessments yet.</Empty> : rows.length === 0 ? <Empty>No assessment matches that filter.</Empty> : (
        <Table label="Assessments" head={["Client", "Assessment", "State", "Answered", "Validated", "Submitted", ""]}>
          {rows.map((a) => {
            const s = stateOf(a);
            return (
              <tr key={a.id}>
                <td className={TD}>{a.organisationName}</td>
                <td className={TD}>{titleCase(a.assessmentType)} · {a.periodLabel}<br /><span className="text-xs text-slate-500">{a.engagementName}</span></td>
                <td className={TD}><Badge tone={s === "awaiting" ? "warning" : s === "finalized" ? "positive" : "neutral"}>{label[s]}</Badge></td>
                <td className={TD}><Progress value={a.total ? (a.answered / a.total) * 100 : 0} label="Answered" /></td>
                <td className={TD}><Progress value={a.total ? (a.validated / a.total) * 100 : 0} label="Validated" /></td>
                <td className={`${TD} whitespace-nowrap`}>{fmtDateTime(a.submittedAt)}</td>
                <td className={TD}><Link href={`/organisations/${a.organisationId}/engagements/${a.engagementId}/assessments/${a.id}`} className="font-medium text-slate-900 hover:underline">Open</Link></td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
