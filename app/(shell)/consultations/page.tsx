import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { CONSULTATION_STATUSES, listConsultations } from "@/lib/workspace/consultation";
import { BANDS, TIMES, TOPICS } from "@/lib/workspace/consultation-notice";
import { SELECTABLE_SECTORS } from "@/lib/regulation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD, Empty, Flash, INPUT, LABEL, PageHeader, fmtDateTime } from "@/components/ui/kit";
import { deleteConsultationAction, updateConsultationAction } from "../workspace-actions";

const label = (list: ReadonlyArray<{ value: string; label: string }>, v: string | null) => list.find((x) => x.value === v)?.label ?? v ?? "Not given";

/** Where the Primus team reads and works the "Connect with us" requests. */
export default async function Consultations({ searchParams }: { searchParams: { status?: string; saved?: string; error?: string } }) {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => (viewer.isClient ? [] : listConsultations(db)));
  if (viewer.isClient) redirect("/portal/dpo-mate");
  const filter = (CONSULTATION_STATUSES as readonly string[]).includes(searchParams.status ?? "") ? searchParams.status! : "open";
  const rows = data.filter((r) => (filter === "open" ? r.status === "new" || r.status === "contacted" || r.status === "scheduled" : r.status === filter));
  const chip = (active: boolean) => `rounded-full px-3 py-1 text-sm ring-1 ring-inset ${active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`;
  return (
    <div>
      <PageHeader title="Consultation requests" subtitle="Clients who asked to book a 30 minute consultation. Each one also went to the Primus inbox if email is set up. Call the contact person within one working day and record what happened." />
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <nav aria-label="Status" className="mb-4 flex flex-wrap gap-2">
        <a href="/consultations" className={chip(filter === "open")}>Open ({data.filter((r) => ["new", "contacted", "scheduled"].includes(r.status)).length})</a>
        {CONSULTATION_STATUSES.map((s) => <a key={s} href={`/consultations?status=${s}`} className={chip(filter === s)}>{s[0]!.toUpperCase() + s.slice(1)} ({data.filter((r) => r.status === s).length})</a>)}
      </nav>
      {rows.length === 0 ? <Empty>Nothing here.</Empty> : (
        <div className="space-y-4">
          {rows.map((r) => (
            <article key={r.id} className={CARD} aria-labelledby={`c-${r.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 id={`c-${r.id}`} className="font-display text-lg font-semibold text-slate-900">{r.organisationName}</h2>
                  <p className="text-xs text-slate-500">{r.engagementName} · sent {fmtDateTime(r.createdAt)}</p>
                </div>
                <div className="flex gap-2"><Badge tone={r.status === "new" ? "warning" : r.status === "closed" || r.status === "done" ? "neutral" : "positive"}>{r.status}</Badge>{r.emailStatus !== "sent" ? <Badge tone="neutral">{r.emailStatus === "not_configured" ? "Email not set up" : `Email ${r.emailStatus}`}</Badge> : null}</div>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="inline text-slate-500">Contact: </dt><dd className="inline text-slate-900">{r.contactName}, {r.contactDesignation}</dd></div>
                <div><dt className="inline text-slate-500">Mobile: </dt><dd className="inline text-slate-900"><a href={`tel:${r.contactMobile}`} className="underline">{r.contactMobile}</a></dd></div>
                <div><dt className="inline text-slate-500">Email: </dt><dd className="inline text-slate-900"><a href={`mailto:${r.contactEmail}`} className="underline">{r.contactEmail}</a></dd></div>
                <div><dt className="inline text-slate-500">Best time: </dt><dd className="inline text-slate-900">{label(TIMES, r.preferredTime)}</dd></div>
                <div><dt className="inline text-slate-500">Sector: </dt><dd className="inline text-slate-900">{SELECTABLE_SECTORS.find((s) => s.key === r.sectorKey)?.label ?? "Not given"}</dd></div>
                <div><dt className="inline text-slate-500">Size: </dt><dd className="inline text-slate-900">{label(BANDS, r.employeeBand)}</dd></div>
                <div className="sm:col-span-2"><dt className="inline text-slate-500">Topics: </dt><dd className="inline text-slate-900">{r.topics.length ? r.topics.map((t) => label(TOPICS, t)).join(", ") : "Not given"}</dd></div>
                {r.website ? <div className="sm:col-span-2"><dt className="inline text-slate-500">Website: </dt><dd className="inline text-slate-900">{r.website}</dd></div> : null}
                {r.note ? <div className="sm:col-span-2"><dt className="inline text-slate-500">Note: </dt><dd className="inline text-slate-900">{r.note}</dd></div> : null}
              </dl>
              <p className="mt-3 text-xs text-slate-500">Agreed to notice {r.noticeVersion} on {fmtDateTime(r.consentedAt)}. {r.submitterIsContact ? "Sent by the contact person." : "Sent for a colleague who confirmed they agreed."}</p>
              <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">What they agreed to</summary><p className="mt-1 max-w-3xl">{r.consentText}</p></details>
              <form action={updateConsultationAction} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value="/consultations" />
                <label className={LABEL}>Status<select name="status" defaultValue={r.status} className={`${INPUT} w-auto`}>{CONSULTATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                <label className={`${LABEL} min-w-64 flex-1`}>Note for the team<input name="note" defaultValue={r.internalNote ?? ""} maxLength={2000} className={INPUT} /></label>
                <Button type="submit" size="sm" variant="secondary">Save</Button>
              </form>
              <form action={deleteConsultationAction} className="mt-2"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value="/consultations" /><Button type="submit" size="sm" variant="secondary">Delete this request</Button></form>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
