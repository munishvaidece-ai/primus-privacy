import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { listConsultations } from "@/lib/workspace/consultation";
import { finalReportReleased } from "@/lib/workspace/preliminary";
import { PortalHeader } from "@/components/portal/header";
import { Badge } from "@/components/ui/badge";
import { CARD, fmtDate } from "@/components/ui/kit";

const STATUS: Record<string, { label: string; tone: "neutral" | "warning" | "positive" }> = {
  new: { label: "We have it", tone: "warning" },
  contacted: { label: "We have been in touch", tone: "warning" },
  scheduled: { label: "Booked", tone: "positive" },
  done: { label: "Done", tone: "positive" },
  closed: { label: "Closed", tone: "neutral" },
};

/** What a client can do once the final report is out: take the short report, and ask for a deeper conversation. */
export default async function DpoMate({ searchParams }: { searchParams: { e?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, current }) => ({
    released: await finalReportReleased(db, current.id),
    requests: await listConsultations(db, { engagementId: current.id }),
  }));
  const m = portal.current;
  const e = portal.engagements.length > 1 ? `e=${m.id}` : "";
  return (
    <div>
      <PortalHeader title="DPO Mate" subtitle="Your next steps after the report: a short version you can share inside your organisation, and a conversation with our experts when you want to go deeper." engagements={portal.engagements} current={m} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="pre-h">
          <h2 id="pre-h" className="font-display text-lg font-semibold text-slate-900">Your preliminary report</h2>
          <p className="mt-1 text-sm text-slate-600">A short read-out of where you stand, what needs your attention first and your first actions. It is built from the same records as your final report, so you can pass it around while you work through the full one.</p>
          {data.released ? (
            <a href={`/portal/dpo-mate/preliminary-report?e=${m.id}`} className="mt-4 inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90">Download the preliminary report (PDF)</a>
          ) : (
            <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">This unlocks once Primus has released your final report. You will see a notice when it is ready.</p>
          )}
        </section>

        <section className={CARD} aria-labelledby="deep-h">
          <h2 id="deep-h" className="font-display text-lg font-semibold text-slate-900">Deeper insights and DPDP alignment</h2>
          <p className="mt-1 text-sm text-slate-600">Want to know how your practices line up with the DPDP Act, or need help with your first actions? Tell us a little about your organisation and book a 30 minute consultation with our experts.</p>
          <Link href={`/portal/dpo-mate/connect${e ? `?${e}` : ""}`} className="mt-4 inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90">Connect with us</Link>
        </section>
      </div>

      <section className="mt-8" aria-labelledby="mine-h">
        <h2 id="mine-h" className="font-display text-lg font-semibold text-slate-900">Your requests</h2>
        {data.requests.length === 0 ? <p className="mt-2 text-sm text-slate-600">You have not asked for a consultation yet.</p> : (
          <ul className="mt-3 space-y-2">
            {data.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-card">
                <span>30 minute consultation · contact {r.contactName} · sent {fmtDate(r.createdAt)}</span>
                <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
