import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { engagementMetrics, organisationOverviews, portfolioInsights, recentActivity, summarise } from "@/lib/workspace/portfolio";
import { Empty, PhaseBadge, fmtDateTime } from "@/components/ui/kit";
import { Donut, DashHero, Feed, HeroStat, Needs, Panel, PALETTE, Ring, StackBar, BarList } from "@/components/dashboard/widgets";
import { RULE_PHASES, SECTORS } from "@/lib/regulation";

const DAY = 86400000;

export default async function DashboardPage() {
  const { viewer, data } = await loadPage(async ({ db, viewer }) => {
    if (viewer.isClient) return null;
    const orgs = await organisationOverviews(db);
    const metrics = await engagementMetrics(db);
    const activity = (await recentActivity(db, { limit: 60 })).filter((a) => !/was uploaded for phase|^Evidence .* uploaded/.test(a.summary)).slice(0, 8);
    const insights = await portfolioInsights(db);
    return { orgs, metrics, activity, insights, summary: summarise(orgs.length, metrics) };
  });
  if (viewer.isClient || !data) redirect("/portal");
  const { summary: s, metrics, activity, insights: ins } = data;
  const days = Math.ceil((new Date(RULE_PHASES["18m"].date).getTime() - Date.now()) / DAY);
  const attention = [
    { n: s.awaitingReview.discovery, label: "Discovery questionnaires to review", href: "/discovery" },
    { n: s.awaitingReview.assessments, label: "Submitted assessments to validate", href: "/assessments" },
    { n: s.awaitingReview.evidence, label: "Evidence items to review", href: "/evidence-review" },
    { n: s.draftFindings, label: "Draft findings to release", href: "/findings" },
    { n: s.awaitingReview.clarifications, label: "Open clarifications", href: "/clarifications" },
    { n: s.overdueTasks, label: "Overdue tasks", href: "/tasks" },
  ].filter((a) => a.n > 0);
  const f = ins.findingsBySeverity;
  const r = ins.ratings;
  const rated = r.implemented + r.partial + r.notImplemented;
  const sectorRows = ins.sectors.map((x) => ({ label: SECTORS.find((y) => y.key === x.key)?.label ?? x.key, value: x.engagements }));
  const live = metrics.filter((m) => m.status !== "closed");

  return (
    <div className="space-y-6">
      <DashHero eyebrow="Primus Partners · Privacy workspace" title="Your portfolio, at a glance" sub="Every number here is worked out from the live records of your client engagements." daysToDuties={days} dutiesDate="13 May 2027">
        <HeroStat n={s.organisations} label="Clients" />
        <HeroStat n={s.activeEngagements} label="Active engagements" />
        <HeroStat n={s.criticalHigh} label="Critical and high findings" tone={s.criticalHigh ? "text-[#ffb4a8]" : undefined} />
        <HeroStat n={s.overdueTasks} label="Overdue tasks" tone={s.overdueTasks ? "text-[#ffd98a]" : undefined} />
      </DashHero>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Needs your attention" hint="Waiting on a Primus person">
          <Needs items={attention.map((a) => ({ label: a.label, n: a.n, href: a.href }))} empty="Nothing is waiting for you." />
        </Panel>
        <Panel title="Open findings by severity" hint="Across every engagement you can see">
          <Donut caption="open" slices={[{ label: "Critical", value: f.critical, color: PALETTE.bad }, { label: "High", value: f.high, color: "#d8662a" }, { label: "Medium", value: f.medium, color: PALETTE.warn }, { label: "Low", value: f.low, color: PALETTE.mute }]} />
        </Panel>
        <Panel title="Control ratings" hint="Where the assessed controls stand">
          <StackBar empty="No controls rated yet." slices={[{ label: "In place", value: r.implemented, color: PALETTE.good }, { label: "Partly", value: r.partial, color: PALETTE.warn }, { label: "Not in place", value: r.notImplemented, color: PALETTE.bad }]} />
          {rated ? <p className="mt-4 text-sm text-slate-600"><b className="font-display text-2xl text-slate-900">{Math.round((r.implemented / rated) * 100)}%</b> of rated controls are fully in place.</p> : null}
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-600">Evidence: <b className="text-slate-900">{ins.evidence.accepted}</b> accepted · <b className="text-slate-900">{ins.evidence.pending}</b> to review · <b className="text-slate-900">{ins.evidence.rejected}</b> rejected</div>
        </Panel>
      </div>

      <Panel title="Engagements" hint={`${live.length} in progress`} action={<Link href="/engagements" className="text-sm font-medium text-copper hover:underline">All engagements →</Link>}>
        {metrics.length === 0 ? <Empty>No engagements yet. Create an organisation, then open an engagement for it.</Empty> : (
          <ul className="grid gap-3 md:grid-cols-2">
            {metrics.map((m) => (
              <li key={m.id}>
                <Link href={`/organisations/${m.organisationId}/engagements/${m.id}`} className="flex items-center gap-4 rounded-xl border border-slate-200 p-4 transition hover:-translate-y-0.5 hover:border-copper hover:shadow-lift">
                  <Ring value={m.progress} size={60} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[15px] font-semibold text-slate-900">{m.organisationName}</span>
                    <span className="block truncate text-xs text-slate-500">{m.name}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-600"><PhaseBadge phase={m.phase} /><span>{m.findingsCriticalHigh} critical/high</span><span>{m.tasksOpen} open tasks</span></span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Where your clients operate" hint="Engagements by sector, from the regulation mapping">
          <BarList rows={sectorRows} empty="No sectors have been mapped yet. Open an engagement's Regulations page to choose them." />
        </Panel>
        <Panel title="Recent activity">
          <Feed items={activity.map((a) => ({ id: a.id, text: a.summary, sub: a.organisationName, at: fmtDateTime(a.occurredAt) }))} />
        </Panel>
      </div>
    </div>
  );
}
