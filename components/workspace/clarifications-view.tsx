import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Empty, INPUT, LABEL, SideBadge, Table, TD, fmtDate, fmtDateTime } from "@/components/ui/kit";
import type { ClarificationMessageRow, ClarificationRow } from "@/lib/workspace/clarifications";
import { closeClarificationAction, raiseClarificationAction, replyClarificationAction } from "@/app/(shell)/workspace-actions";
import type { EngagementOption } from "./tasks-view";

const statusLabel = { open: "Open", answered: "Answered", closed: "Closed" } as const;
const tone = { open: "warning", answered: "positive", closed: "neutral" } as const;

export function ClarificationList({ items, base, isClient, q }: { items: ClarificationRow[]; base: string; isClient: boolean; q?: string }) {
  if (items.length === 0) return <Empty>No clarifications yet.</Empty>;
  return (
    <Table label="Clarifications" head={["Ref", "Subject", isClient ? "Engagement" : "Client", "Raised by", "Status", "Raised", "Due"]}>
      {items.map((c) => (
        <tr key={c.id}>
          <td className={TD}>{c.reference}</td>
          <td className={TD}><Link href={`${base}/${c.id}${q ?? ""}`} className="font-medium text-slate-900 hover:underline">{c.subject}</Link></td>
          <td className={TD}>{isClient ? c.engagementName : `${c.organisationName} · ${c.engagementName}`}</td>
          <td className={TD}><SideBadge side={c.raisedBySide} /></td>
          <td className={TD}><Badge tone={tone[c.status]}>{statusLabel[c.status]}</Badge></td>
          <td className={TD}>{fmtDate(c.raisedAt)}</td>
          <td className={TD}>{fmtDate(c.dueAt)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function RaiseClarification({ engagements, back, fixedEngagementId }: { engagements: EngagementOption[]; back: string; fixedEngagementId?: string }) {
  return (
    <section className={CARD} aria-labelledby="raise">
      <h2 id="raise" className="text-sm font-semibold text-slate-900">Raise a clarification</h2>
      <form action={raiseClarificationAction} className="mt-3 grid gap-3 md:grid-cols-2">
        <input type="hidden" name="back" value={back} />
        {fixedEngagementId ? <input type="hidden" name="engagementId" value={fixedEngagementId} /> : (
          <label className={LABEL}>Engagement
            <select name="engagementId" required className={INPUT}>{engagements.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
          </label>
        )}
        <label className={LABEL}>Subject<input name="subject" required maxLength={300} className={INPUT} /></label>
        <label className={`${LABEL} md:col-span-2`}>Your question<textarea name="question" required rows={3} maxLength={5000} className={INPUT} /></label>
        <label className={LABEL}>Reply wanted by (optional)<input name="dueDate" type="date" className={INPUT} /></label>
        <div className="md:col-span-2"><Button type="submit">Send</Button></div>
      </form>
    </section>
  );
}

export function Thread({ clarification: c, messages, back }: { clarification: ClarificationRow; messages: ClarificationMessageRow[]; back: string }) {
  return (
    <div>
      <ol className="space-y-3">
        {messages.map((m) => (
          <li key={m.id} className={`rounded-md border p-4 ${m.authorSide === "primus" ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/40"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-2"><SideBadge side={m.authorSide} /> {m.authorEmail ?? "Unknown"}</span>
              <span>{fmtDateTime(m.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-900">{m.body}</p>
          </li>
        ))}
      </ol>
      {c.status !== "closed" ? (
        <div className="mt-6 space-y-3">
          <form action={replyClarificationAction} className={CARD}>
            <input type="hidden" name="clarificationId" value={c.id} />
            <input type="hidden" name="back" value={back} />
            <label className={LABEL}>Your reply<textarea name="body" required rows={4} maxLength={5000} className={INPUT} /></label>
            <div className="mt-3"><Button type="submit">Send reply</Button></div>
          </form>
          <form action={closeClarificationAction}>
            <input type="hidden" name="clarificationId" value={c.id} />
            <input type="hidden" name="back" value={back} />
            <Button type="submit" variant="secondary" size="sm">Close this clarification</Button>
          </form>
        </div>
      ) : <p className="mt-6 text-sm text-slate-500">Closed {fmtDateTime(c.closedAt)}. It can no longer be replied to.</p>}
    </div>
  );
}
