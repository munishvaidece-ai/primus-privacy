import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Empty, INPUT, LABEL, SideBadge, Table, TD, fmtDate, titleCase } from "@/components/ui/kit";
import { daysUntil } from "@/lib/workspace/common";
import type { TaskRow } from "@/lib/workspace/tasks";
import { cancelTaskAction, completeTaskAction, createTaskAction } from "@/app/(shell)/workspace-actions";

export interface EngagementOption { id: string; label: string }

/** Tasks and milestones, used by both the Primus workspace and the client portal. */
export function TasksView({ tasks, engagements, isClient, back, fixedEngagementId }: { tasks: TaskRow[]; engagements: EngagementOption[]; isClient: boolean; back: string; fixedEngagementId?: string }) {
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");
  const milestones = open.filter((t) => t.kind === "milestone");
  const work = open.filter((t) => t.kind !== "milestone");
  return (
    <div className="space-y-8">
      {milestones.length > 0 ? (
        <section aria-labelledby="ms">
          <h2 id="ms" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Milestones</h2>
          <ol className="space-y-2">
            {milestones.map((m) => {
              const d = daysUntil(m.dueDate);
              return (
                <li key={m.id} className={`${CARD} flex flex-wrap items-center justify-between gap-2`}>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{m.title}</p>
                    <p className="text-xs text-slate-500">{m.organisationName} · {m.engagementName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-700">{fmtDate(m.dueDate)}</span>
                    {d !== null ? <Badge tone={d < 0 ? "critical" : d <= 7 ? "warning" : "neutral"}>{d < 0 ? `${-d} days late` : d === 0 ? "today" : `in ${d} days`}</Badge> : null}
                    {!isClient ? (
                      <form action={completeTaskAction}><input type="hidden" name="taskId" value={m.id} /><input type="hidden" name="back" value={back} /><Button size="sm" variant="secondary" type="submit">Reached</Button></form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="open">
        <h2 id="open" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Open tasks</h2>
        {work.length === 0 ? <Empty>No open tasks.</Empty> : (
          <Table label="Open tasks" head={["Task", isClient ? "Engagement" : "Client", "For", "Due", ""]}>
            {work.map((t) => {
              const d = daysUntil(t.dueDate);
              return (
                <tr key={t.id}>
                  <td className={TD}><p className="font-medium text-slate-900">{t.title}</p>{t.description ? <p className="text-xs text-slate-500">{t.description}</p> : null}</td>
                  <td className={TD}>{isClient ? t.engagementName : `${t.organisationName} · ${t.engagementName}`}</td>
                  <td className={TD}><SideBadge side={t.assigneeSide} /></td>
                  <td className={TD}>{fmtDate(t.dueDate)} {d !== null && d < 0 ? <Badge tone="critical">overdue</Badge> : null}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <form action={completeTaskAction} className="inline"><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="back" value={back} /><Button size="sm" variant="secondary" type="submit">Done</Button></form>{" "}
                    {!isClient || t.assigneeSide === "client" ? <form action={cancelTaskAction} className="inline"><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="back" value={back} /><Button size="sm" variant="ghost" type="submit">Remove</Button></form> : null}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </section>

      {done.length > 0 ? (
        <section aria-labelledby="done">
          <h2 id="done" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Done</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-card text-sm">
            {done.slice(0, 20).map((t) => <li key={t.id} className="flex justify-between px-4 py-2"><span className="text-slate-700">{t.title}</span><span className="text-xs text-slate-500">{titleCase(t.kind)} · {fmtDate(t.completedAt)}</span></li>)}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="new" className={CARD}>
        <h2 id="new" className="text-sm font-semibold text-slate-900">{isClient ? "Add a task for your team" : "Add a task or milestone"}</h2>
        <form action={createTaskAction} className="mt-3 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="back" value={back} />
          {fixedEngagementId ? <input type="hidden" name="engagementId" value={fixedEngagementId} /> : (
            <label className={LABEL}>Engagement
              <select name="engagementId" required className={INPUT}>{engagements.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
            </label>
          )}
          <label className={LABEL}>Title<input name="title" required maxLength={200} className={INPUT} /></label>
          <label className={`${LABEL} md:col-span-2`}>Details (optional)<textarea name="description" rows={2} maxLength={2000} className={INPUT} /></label>
          {isClient ? <input type="hidden" name="assigneeSide" value="client" /> : (
            <label className={LABEL}>For
              <select name="assigneeSide" className={INPUT}><option value="client">The client</option><option value="primus">The Primus team</option></select>
            </label>
          )}
          <label className={LABEL}>Due date<input name="dueDate" type="date" className={INPUT} /></label>
          {!isClient ? (
            <label className={LABEL}>Type
              <select name="kind" className={INPUT}><option value="task">Task</option><option value="milestone">Milestone (needs a date; the client sees it)</option></select>
            </label>
          ) : null}
          <div className="md:col-span-2"><Button type="submit">Add</Button></div>
        </form>
      </section>
    </div>
  );
}
