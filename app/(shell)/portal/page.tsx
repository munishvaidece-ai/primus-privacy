import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { clientNextSteps, portfolioInsights, recentActivity } from "@/lib/workspace/portfolio";
import { listTasks } from "@/lib/workspace/tasks";
import { loadLiveStatus } from "@/lib/live/status";
import { loadEngagementApplicability } from "@/lib/workspace/applicability";
import { PHASES } from "@/lib/live/config";
import { PortalHeader } from "@/components/portal/header";
import { fmtDate, fmtDateTime } from "@/components/ui/kit";
import { Badge } from "@/components/ui/badge";
import { daysUntil } from "@/lib/workspace/common";
import { DashHero, Donut, Feed, HeroStat, Needs, PALETTE, Panel, Ring, StackBar, Stepper, type Step } from "@/components/dashboard/widgets";

export const dynamic = "force-dynamic";

export default async function PortalOverview({ searchParams }: { searchParams: { e?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, user, current }) => {
    const scope = { engagementId: current.id, organisationId: current.organisationId };
    return {
      milestones: await listTasks(db, { engagementId: current.id, kind: "milestone", status: "open" }),
      activity: (await recentActivity(db, { engagementId: current.id, limit: 60 })).filter((a) => !/was uploaded for phase/.test(a.summary)).slice(0, 8),
      live: await loadLiveStatus(db, user.id, scope, false),
      applies: await loadEngagementApplicability(db, user.id, scope),
      ins: await portfolioInsights(db, { engagementId: current.id }),
    };
  });
  const m = portal.current;
  const q = portal.q;
  const steps = clientNextSteps(m);
  const { live, applies, ins } = data;
  const firstOpen = live.phases.findIndex((p) => p.state !== "done");
  const stepper: Step[] = PHASES.map((cfg, i) => ({ n: cfg.n, name: cfg.name, state: live.phases[i]!.state === "done" ? "done" : i === firstOpen ? "now" : "todo", who: cfg.from.side === "client" ? "you" : "primus" }));
  const days = applies.summary.daysToFirstDuty;
  const f = ins.findingsBySeverity;
  const r = ins.ratings;
  const rated = r.implemented + r.partial + r.notImplemented;

  return (
    <div className="space-y-6">
      <PortalHeader title="Overview" subtitle="Where your privacy programme stands and what is waiting for you." engagements={portal.engagements} current={m} />
      <DashHero eyebrow={`${m.organisationName} · ${m.phase}`} title={rated ? `${Math.round((r.implemented / rated) * 100)}% of your assessed controls are in place` : "Your DPDP readiness programme"} sub={`${applies.summary.applies} DPDP obligations apply to you today, bound by ${applies.summary.rules.length} Rules, with a penalty ceiling of up to ${applies.summary.highestCeilingText?.replace("up to ", "") ?? "n/a"}.`} daysToDuties={days} dutiesDate="13 May 2027">
        <HeroStat n={`${m.progress}%`} label="Programme progress" />
        <HeroStat n={m.findingsOpen} label="Open findings" tone={m.findingsCriticalHigh ? "text-[#ffb4a8]" : undefined} />
        <HeroStat n={`${m.remediationClosed}/${m.remediationTotal}`} label="Actions closed" />
        <HeroStat n={m.clarificationsOpen} label="Clarifications" />
      </DashHero>

      <Panel title="Your journey" hint="Seven phases. Four need a file from you." action={<Link href={`/portal/journey${q}`} className="text-sm font-medium text-copper hover:underline">Open the live journey →</Link>}>
        <Stepper steps={stepper} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="What to do next">
          <Needs items={steps.map((s) => ({ label: s.label, detail: s.detail, href: `${s.href}${q}` }))} empty="You are up to date. Primus will tell you when something needs you." />
        </Panel>
        <Panel title="Open findings" hint="By severity, released to you">
          <Donut caption="open" slices={[{ label: "Critical", value: f.critical, color: PALETTE.bad }, { label: "High", value: f.high, color: "#d8662a" }, { label: "Medium", value: f.medium, color: PALETTE.warn }, { label: "Low", value: f.low, color: PALETTE.mute }]} />
        </Panel>
        <Panel title="What applies to you" hint="From your answers, data map and sector" action={<Link href={`/portal/regulations${q}`} className="text-sm font-medium text-copper hover:underline">See all →</Link>}>
          <StackBar slices={[{ label: "Apply", value: applies.summary.applies, color: PALETTE.brand }, { label: "May apply", value: applies.summary.mayApply, color: PALETTE.copperLight }, { label: "Do not apply", value: applies.summary.notApplicable, color: PALETTE.mute }]} />
          <p className="mt-4 text-sm text-slate-600">Sectors: <b className="text-slate-900">{applies.sectors.length ? applies.sectors.map((s) => s.label).join(", ") : "not set yet"}</b></p>
        </Panel>
      </div>

      <Panel title="Learn, answer and ask">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: `/portal/questions${q}`, t: "Your question sets", d: "Common questions for everyone, then questions for your sector. You answer them in your own time." },
            { href: `/portal/data-connections${q}`, t: "Documents and connections", d: "Where to upload your documents, and how Primus can look at your database or folders if you agree." },
            { href: `/portal/resources${q}`, t: "Resources", d: "Read the DPDP Act, the Rules and the laws for your sector." },
            { href: `/portal/dpo-mate${q}`, t: "DPO Mate", d: "Take your preliminary report, or book 30 minutes with our experts." },
          ].map((x) => (
            <li key={x.href}><Link href={x.href} className="block h-full rounded-xl border border-slate-200 bg-white p-4 hover:border-copper"><p className="font-medium text-slate-900">{x.t} →</p><p className="mt-1 text-sm text-slate-600">{x.d}</p></Link></li>
          ))}
        </ul>
      </Panel>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title="Milestones">
          {data.milestones.length === 0 ? <p className="text-sm text-slate-500">No upcoming milestones.</p> : (
            <ol className="divide-y divide-slate-100">
              {data.milestones.map((t) => {
                const d = daysUntil(t.dueDate);
                return <li key={t.id} className="flex items-center justify-between py-2.5 text-sm"><span>{t.title}</span><span className="flex items-center gap-2 text-slate-600">{fmtDate(t.dueDate)}{d !== null && d < 0 ? <Badge tone="critical">late</Badge> : null}</span></li>;
              })}
            </ol>
          )}
          <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
            <Ring value={m.discoveryStatus === "approved" ? 100 : (m.discoveryDone / 13) * 100} /><span>Discovery questionnaire</span>
            <Ring value={m.questionsTotal ? (m.questionsValidated / m.questionsTotal) * 100 : 0} /><span>Validated by Primus</span>
          </div>
        </Panel>
        <Panel title="Recent activity">
          <Feed items={data.activity.map((a) => ({ id: a.id, text: a.summary, at: fmtDateTime(a.occurredAt) }))} />
        </Panel>
      </div>
    </div>
  );
}
