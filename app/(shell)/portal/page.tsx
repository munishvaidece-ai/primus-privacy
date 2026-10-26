import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { clientNextSteps, recentActivity } from "@/lib/workspace/portfolio";
import { listTasks } from "@/lib/workspace/tasks";
import { PortalHeader } from "@/components/portal/header";
import { CARD, Empty, Progress, Stat, fmtDate, fmtDateTime } from "@/components/ui/kit";
import { Badge } from "@/components/ui/badge";
import { daysUntil } from "@/lib/workspace/common";

export default async function PortalOverview({ searchParams }: { searchParams: { e?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, current }) => ({
    milestones: await listTasks(db, { engagementId: current.id, kind: "milestone", status: "open" }),
    activity: await recentActivity(db, { engagementId: current.id, limit: 10 }),
  }));
  const m = portal.current;
  const q = portal.q;
  const steps = clientNextSteps(m);
  return (
    <div>
      <PortalHeader title="Overview" subtitle="Where your privacy programme stands and what is waiting for you." engagements={portal.engagements} current={m} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Overall progress" value={`${m.progress}%`} hint={m.phase} />
        <Stat label="Open findings" value={m.findingsOpen} href={`/portal/findings${q}`} hint={`${m.findingsCriticalHigh} critical or high`} tone={m.findingsCriticalHigh ? "bad" : undefined} />
        <Stat label="Remediation done" value={`${m.remediationClosed}/${m.remediationTotal}`} href={`/portal/remediation${q}`} />
        <Stat label="Open clarifications" value={m.clarificationsOpen} href={`/portal/clarifications${q}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="next">
          <h2 id="next" className="text-sm font-semibold text-slate-900">What to do next</h2>
          {steps.length === 0 ? <p className="mt-3 text-sm text-slate-500">You are up to date. Primus will tell you when something needs you.</p> : (
            <ul className="mt-3 divide-y divide-slate-100">
              {steps.map((s) => (
                <li key={s.label}><Link href={`${s.href}${q}`} className="flex flex-col py-2 hover:bg-slate-50"><span className="text-sm font-medium text-slate-900">{s.label}</span><span className="text-xs text-slate-500">{s.detail}</span></Link></li>
              ))}
            </ul>
          )}
        </section>
        <section className={CARD} aria-labelledby="ms">
          <h2 id="ms" className="text-sm font-semibold text-slate-900">Milestones</h2>
          {data.milestones.length === 0 ? <p className="mt-3 text-sm text-slate-500">No upcoming milestones.</p> : (
            <ol className="mt-3 divide-y divide-slate-100">
              {data.milestones.map((t) => {
                const d = daysUntil(t.dueDate);
                return <li key={t.id} className="flex items-center justify-between py-2 text-sm"><span>{t.title}</span><span className="flex items-center gap-2 text-slate-600">{fmtDate(t.dueDate)}{d !== null && d < 0 ? <Badge tone="critical">late</Badge> : null}</span></li>;
              })}
            </ol>
          )}
        </section>
      </div>

      <section className={`${CARD} mt-6`} aria-labelledby="steps">
        <h2 id="steps" className="text-sm font-semibold text-slate-900">Programme steps</h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          <li><p className="text-xs text-slate-500">Discovery questionnaire</p><Progress value={m.discoveryStatus === "approved" ? 100 : (m.discoveryDone / 13) * 100} label="Discovery" /></li>
          <li><p className="text-xs text-slate-500">Assessment answers</p><Progress value={m.questionsTotal ? (m.questionsAnswered / m.questionsTotal) * 100 : 0} label="Assessment answered" /></li>
          <li><p className="text-xs text-slate-500">Validated by Primus</p><Progress value={m.questionsTotal ? (m.questionsValidated / m.questionsTotal) * 100 : 0} label="Assessment validated" /></li>
        </ul>
      </section>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent activity</h2>
      {data.activity.length === 0 ? <Empty>No activity yet.</Empty> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-card">
          {data.activity.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-sm"><span>{a.summary}</span><span className="text-xs text-slate-500">{fmtDateTime(a.occurredAt)}</span></li>)}
        </ul>
      )}
    </div>
  );
}
