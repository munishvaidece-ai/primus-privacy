import { redirect } from "next/navigation";
import { loadPage, uuidOr } from "@/lib/workspace/page";
import { engagementMetrics } from "@/lib/workspace/portfolio";
import { engagementAuditTrail, entityLabel } from "@/lib/workspace/audit";
import { hasEngagementPermission } from "@/lib/authorization/service";
import { Button } from "@/components/ui/button";
import { Empty, INPUT, LABEL, PageHeader, Table, TD, fmtDateTime, titleCase } from "@/components/ui/kit";

export default async function AuditPage({ searchParams }: { searchParams: { e?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, user, viewer }) => {
    if (viewer.isClient) return null;
    const all = await engagementMetrics(db);
    const allowed = [];
    for (const m of all) if (await hasEngagementPermission(db, user.id, m.id, "audit.view")) allowed.push(m);
    const wanted = uuidOr(searchParams.e);
    const current = allowed.find((m) => m.id === wanted) ?? allowed[0] ?? null;
    return { allowed, current, rows: current ? await engagementAuditTrail(db, user.id, current.id, 300) : [] };
  });
  if (viewer.isClient || !data) redirect("/portal");
  return (
    <div>
      <PageHeader title="Audit trail" subtitle="Who changed what, and when, on an engagement. Written by the database itself, so it cannot be edited or skipped from the screens." />
      {data.allowed.length === 0 ? <Empty>You do not have the audit permission on any engagement. Engagement Managers, Consultants and Auditors do.</Empty> : (
        <>
          <form method="get" className="mb-4 flex items-end gap-3">
            <label className={LABEL}>Engagement
              <select name="e" defaultValue={data.current?.id} className={`${INPUT} min-w-72`}>{data.allowed.map((m) => <option key={m.id} value={m.id}>{m.organisationName} · {m.name}</option>)}</select>
            </label>
            <Button type="submit" size="sm">Show</Button>
          </form>
          {data.rows.length === 0 ? <Empty>No recorded changes yet.</Empty> : (
            <Table label="Audit trail" head={["When", "Who", "What", "Action", "Fields changed"]}>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${TD} whitespace-nowrap`}>{fmtDateTime(r.occurredAt)}</td>
                  <td className={TD}>{r.actorEmail ?? <span className="text-slate-400">system</span>}</td>
                  <td className={TD}>{entityLabel(r.entityType)}</td>
                  <td className={TD}>{titleCase(r.action)}</td>
                  <td className={`${TD} text-xs text-slate-600`}>{r.changedFields.length ? r.changedFields.map((f) => f.replace(/_/g, " ")).join(", ") : "—"}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </div>
  );
}
