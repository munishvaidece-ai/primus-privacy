import { loadPortal } from "@/lib/workspace/page";
import { REQUEST_TYPES, listRightsRequests } from "@/lib/workspace/rights";
import { hasPermission } from "@/lib/workspace/common";
import { PortalHeader } from "@/components/portal/header";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Empty, Flash, INPUT, LABEL, Table, TD, fmtDate, titleCase } from "@/components/ui/kit";
import { logRightsAction, setRightsStatusAction } from "../../workspace-actions";

const CHANNELS = [["email", "Email"], ["web_form", "Web form"], ["phone", "Phone"], ["in_person", "In person"], ["post", "Post"], ["other", "Other"]];

export default async function PortalRights({ searchParams }: { searchParams: { e?: string; saved?: string; error?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, user, current }) => {
    const canView = await hasPermission(db, user.id, current, "rights.view");
    const canManage = await hasPermission(db, user.id, current, "rights.manage");
    return { canView, canManage, rows: canView || canManage ? await listRightsRequests(db, current.id) : [] };
  });
  const m = portal.current;
  const back = `/portal/rights${portal.q}`;
  const typeLabel = (v: string | null) => REQUEST_TYPES.find((t) => t.value === v)?.label ?? (v ? titleCase(v) : "—");
  return (
    <div>
      <PortalHeader title="Data Principal requests" subtitle="A log of requests from individuals about their personal data, with the date each is due." engagements={portal.engagements} current={m} />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      {!data.canView && !data.canManage ? <Empty>Your role does not include access to this log.</Empty> : (
        <>
          {data.canManage ? (
            <section className={`${CARD} mb-6`} aria-labelledby="log">
              <h2 id="log" className="text-sm font-semibold text-slate-900">Log a request</h2>
              <form action={logRightsAction} className="mt-3 grid gap-3 md:grid-cols-3">
                <input type="hidden" name="engagementId" value={m.id} /><input type="hidden" name="back" value={back} />
                <label className={`${LABEL} md:col-span-3`}>Summary (do not include the person&rsquo;s identity details)<input name="title" required maxLength={200} className={INPUT} /></label>
                <label className={LABEL}>Type<select name="requestType" required className={INPUT}>{REQUEST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
                <label className={LABEL}>Received through<select name="channel" required className={INPUT}>{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label className={LABEL}>Received on<input name="receivedOn" type="date" className={INPUT} /></label>
                <label className={LABEL}>Respond by<input name="dueOn" type="date" className={INPUT} /></label>
                <div className="md:col-span-3"><Button type="submit">Add to log</Button></div>
              </form>
            </section>
          ) : null}
          {data.rows.length === 0 ? <Empty>No requests logged yet.</Empty> : (
            <Table label="Data Principal requests" head={["Ref", "Summary", "Type", "Received", "Due", "Status", ""]}>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className={TD}>{r.reference}</td>
                  <td className={TD}>{r.title}</td>
                  <td className={TD}>{typeLabel(r.requestType)}</td>
                  <td className={TD}>{fmtDate(r.receivedAt)}</td>
                  <td className={TD}>{fmtDate(r.dueAt)}{r.dueAt && r.status !== "closed" && r.dueAt.getTime() < Date.now() ? <> <Badge tone="critical">overdue</Badge></> : null}</td>
                  <td className={TD}><Badge tone={statusTone(r.status)}>{titleCase(r.status)}</Badge></td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {data.canManage && r.status !== "closed" ? (
                      <form action={setRightsStatusAction} className="inline-flex gap-2">
                        <input type="hidden" name="caseId" value={r.id} /><input type="hidden" name="engagementId" value={m.id} /><input type="hidden" name="back" value={back} />
                        {r.status !== "in_progress" ? <Button size="sm" variant="secondary" type="submit" name="status" value="in_progress">Start</Button> : null}
                        <Button size="sm" variant="secondary" type="submit" name="status" value="closed">Close</Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </div>
  );
}
