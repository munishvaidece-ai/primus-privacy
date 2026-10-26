import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { engagementMetrics, organisationOverviews, recentActivity, summarise } from "@/lib/workspace/portfolio";
import { CARD, Empty, PageHeader, PhaseBadge, Progress, Stat, Table, TD, fmtDateTime } from "@/components/ui/kit";

export default async function DashboardPage() {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => {
    if (viewer.isClient) return null;
    const orgs = await organisationOverviews(db);
    const metrics = await engagementMetrics(db);
    const activity = await recentActivity(db, { limit: 12 });
    return { orgs, metrics, activity, summary: summarise(orgs.length, metrics) };
  });
  if (viewer.isClient || !data) redirect("/portal");
  const { summary: s, metrics, activity } = data;
  const attention = [
    { n: s.awaitingReview.discovery, label: "Discovery questionnaires to review", href: "/discovery" },
    { n: s.awaitingReview.assessments, label: "Submitted assessments to validate", href: "/assessments" },
    { n: s.awaitingReview.evidence, label: "Evidence items to review", href: "/evidence-review" },
    { n: s.draftFindings, label: "Draft findings to release", href: "/findings" },
    { n: s.awaitingReview.clarifications, label: "Open clarifications", href: "/clarifications" },
    { n: s.overdueTasks, label: "Overdue tasks", href: "/tasks" },
  ].filter((a) => a.n > 0);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Everything across your client organisations, worked out from the live records." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Client organisations" value={s.organisations} href="/organisations" />
        <Stat label="Active engagements" value={s.activeEngagements} href="/engagements" />
        <Stat label="Critical & high findings" value={s.criticalHigh} href="/findings" tone={s.criticalHigh ? "bad" : undefined} hint="open" />
        <Stat label="Overdue tasks" value={s.overdueTasks} href="/tasks" tone={s.overdueTasks ? "warn" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="attn" className={CARD}>
          <h2 id="attn" className="text-sm font-semibold text-slate-900">Needs your attention</h2>
          {attention.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nothing is waiting for you.</p> : (
            <ul className="mt-3 divide-y divide-slate-100">
              {attention.map((a) => (
                <li key={a.label}><Link href={a.href} className="flex items-center justify-between py-2 text-sm hover:bg-slate-50"><span>{a.label}</span><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{a.n}</span></Link></li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="phases" className={CARD}>
          <h2 id="phases" className="text-sm font-semibold text-slate-900">Engagements by phase</h2>
          <ul className="mt-3 space-y-2">
            {s.byPhase.map((p) => (
              <li key={p.phase} className="flex items-center justify-between text-sm"><PhaseBadge phase={p.phase} /><span className="tabular-nums text-slate-700">{p.count}</span></li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-8" aria-labelledby="eng">
        <h2 id="eng" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Engagements</h2>
        {metrics.length === 0 ? <Empty>No engagements yet. Create an organisation, then open an engagement for it.</Empty> : (
          <Table label="Engagements" head={["Client", "Engagement", "Phase", "Progress", "Critical/high", "Open tasks"]}>
            {metrics.map((m) => (
              <tr key={m.id}>
                <td className={TD}><Link href={`/organisations/${m.organisationId}`} className="hover:underline">{m.organisationName}</Link></td>
                <td className={TD}><Link href={`/organisations/${m.organisationId}/engagements/${m.id}`} className="font-medium text-slate-900 hover:underline">{m.name}</Link></td>
                <td className={TD}><PhaseBadge phase={m.phase} /></td>
                <td className={TD}><Progress value={m.progress} label={`${m.name} progress`} /></td>
                <td className={`${TD} tabular-nums`}>{m.findingsCriticalHigh}</td>
                <td className={`${TD} tabular-nums`}>{m.tasksOpen}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section className="mt-8" aria-labelledby="act">
        <h2 id="act" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent activity</h2>
        {activity.length === 0 ? <Empty>No activity yet.</Empty> : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                <span>{a.summary} <span className="text-slate-500">· {a.organisationName}</span></span>
                <span className="text-xs text-slate-500">{fmtDateTime(a.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
