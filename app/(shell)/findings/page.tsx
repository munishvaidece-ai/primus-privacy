import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { listAllFindings } from "@/lib/workspace/portfolio";
import { hasEngagementPermission } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Empty, FilterBar, FilterSelect, FilterText, Flash, PageHeader, Severity, Table, TD, fmtDate, includesCI, titleCase } from "@/components/ui/kit";
import { releaseFindingsAction } from "../workspace-actions";

export default async function FindingsPage({ searchParams }: { searchParams: { saved?: string; error?: string; q?: string; severity?: string; status?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, user, viewer }) => {
    if (viewer.isClient) return null;
    const all = await listAllFindings(db);
    const draftEngagements = Array.from(new Set(all.filter((f) => !f.releasedAt).map((f) => f.engagementId)));
    const canRelease = new Set<string>();
    for (const id of draftEngagements) if (await hasEngagementPermission(db, user.id, id, "finding.release")) canRelease.add(id);
    return { all, canRelease };
  });
  if (viewer.isClient || !data) redirect("/portal/findings");
  const drafts = data.all.filter((f) => !f.releasedAt);
  const byEng = new Map<string, typeof drafts>();
  for (const d of drafts) byEng.set(d.engagementId, [...(byEng.get(d.engagementId) ?? []), d]);
  const released = data.all.filter((f) => f.releasedAt && includesCI(`${f.title} ${f.organisationName}`, searchParams.q) && (!searchParams.severity || f.severity === searchParams.severity) && (!searchParams.status || f.status === searchParams.status));

  return (
    <div>
      <PageHeader title="Findings" subtitle="New findings stay private to the Primus team until someone with the release permission releases them to the client. A release cannot be undone." />
      <Flash saved={searchParams.saved} error={searchParams.error} />

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Draft — not yet visible to clients ({drafts.length})</h2>
      {drafts.length === 0 ? <Empty>No draft findings.</Empty> : (
        <div className="space-y-4">
          {Array.from(byEng.entries()).map(([engId, list]) => {
            const first = list[0]!;
            const can = data.canRelease.has(engId);
            return (
              <form key={engId} action={releaseFindingsAction} className={CARD}>
                <input type="hidden" name="engagementId" value={engId} />
                <input type="hidden" name="back" value="/findings" />
                <p className="text-sm font-semibold text-slate-900">{first.organisationName} <span className="font-normal text-slate-500">· {first.engagementName}</span></p>
                <ul className="mt-2 divide-y divide-slate-100">
                  {list.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                      {can ? <input type="checkbox" name="findingIds" value={f.id} defaultChecked aria-label={`Release ${f.title}`} /> : null}
                      <Severity value={f.severity} />
                      <Link href={`/organisations/${f.organisationId}/engagements/${f.engagementId}/findings/${f.id}`} className="font-medium text-slate-900 hover:underline">{f.title}</Link>
                    </li>
                  ))}
                </ul>
                {can ? <div className="mt-3"><Button type="submit" size="sm">Release ticked findings to the client</Button></div> : <p className="mt-3 text-xs text-slate-500">You do not have the release permission on this engagement. An Engagement Manager can release these.</p>}
              </form>
            );
          })}
        </div>
      )}

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wide text-slate-500">Released findings</h2>
      <FilterBar reset="/findings">
        <FilterText name="q" label="Search" value={searchParams.q} />
        <FilterSelect name="severity" label="Severity" value={searchParams.severity} options={["critical", "high", "medium", "low"].map((v) => ({ value: v, label: titleCase(v) }))} />
        <FilterSelect name="status" label="Status" value={searchParams.status} options={["open", "in_progress", "resolved", "accepted"].map((v) => ({ value: v, label: titleCase(v) }))} />
      </FilterBar>
      {released.length === 0 ? <Empty>No released findings match.</Empty> : (
        <Table label="Released findings" head={["Finding", "Client", "Severity", "Status", "Owner", "Released"]}>
          {released.map((f) => (
            <tr key={f.id}>
              <td className={TD}><Link href={`/organisations/${f.organisationId}/engagements/${f.engagementId}/findings/${f.id}`} className="font-medium text-slate-900 hover:underline">{f.title}</Link></td>
              <td className={TD}>{f.organisationName}</td>
              <td className={TD}><Severity value={f.severity} /></td>
              <td className={TD}><Badge tone={statusTone(f.status)}>{titleCase(f.status)}</Badge></td>
              <td className={TD}>{f.ownerEmail ?? <span className="text-slate-400">—</span>}</td>
              <td className={TD}>{fmtDate(f.releasedAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
