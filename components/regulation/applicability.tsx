import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SectorPart } from "@/components/regulation/parts";
import { RULE_PHASES, type Obligation } from "@/lib/regulation";
import type { EngagementApplicability } from "@/lib/workspace/applicability";

const STATUS: Record<Obligation["status"], { label: string; tone: "positive" | "warning" | "neutral"; bar: string }> = {
  applies: { label: "Applies", tone: "positive", bar: "bg-emerald-500" },
  may_apply: { label: "May apply", tone: "warning", bar: "bg-amber-500" },
  not_applicable: { label: "Does not apply", tone: "neutral", bar: "bg-slate-300" },
};
const GROUPS: Array<{ key: Obligation["group"]; title: string; blurb: string }> = [
  { key: "basis", title: "Why you may process data at all", blurb: "Lawful grounds, notice and consent." },
  { key: "duties", title: "What you must do with the data", blurb: "Accuracy, processors, security, breaches, erasure." },
  { key: "rights", title: "What people can ask of you", blurb: "Access, correction, erasure, nomination and grievances." },
  { key: "children", title: "Children and guardians", blurb: "Verifiable consent and the bans on tracking." },
  { key: "sdf", title: "If you are a Significant Data Fiduciary", blurb: "Extra duties for the biggest and riskiest processors." },
  { key: "transfers", title: "Data leaving India", blurb: "Allowed unless the Government restricts the destination." },
  { key: "exemptions", title: "Exemptions", blurb: "State bodies and small organisations." },
];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A shield of dots: the DPDP theme, drawn once, used behind the headline figures. */
function ShieldMark() {
  return (
    <svg viewBox="0 0 220 240" aria-hidden="true" className="pointer-events-none absolute -right-6 -top-8 h-64 w-56 text-white/10">
      <path d="M110 12 20 46v68c0 58 38 98 90 114 52-16 90-56 90-114V46z" fill="none" stroke="currentColor" strokeWidth="2" />
      {Array.from({ length: 9 }).flatMap((_, r) => Array.from({ length: 7 }).map((__, c) => <circle key={`${r}-${c}`} cx={36 + c * 25} cy={62 + r * 19} r="2" fill="currentColor" />))}
      <path d="M72 126l28 28 52-58" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Pill({ n, label, tone }: { n: number | string; label: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-inset ring-white/15 backdrop-blur-sm">
      <p className={`font-display text-2xl font-bold sm:text-3xl ${tone ?? "text-white"}`}>{n}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f0c9a0]">{label}</p>
    </div>
  );
}

/** The headline for one organisation: what applies, by when, and the worst a breach could cost. */
export function ApplicabilityHero({ a, orgName }: { a: EngagementApplicability; orgName?: string }) {
  const s = a.summary;
  const basis = a.basis;
  return (
    <section aria-labelledby="applies-h" className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-ink via-brand to-copper-deep p-6 text-white shadow-lift sm:p-8">
      <ShieldMark />
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#f0c9a0]">DPDP Act, 2023 and Rules, 2025</p>
      <h2 id="applies-h" className="mt-1 max-w-2xl font-display text-2xl font-bold sm:text-3xl">What applies to {orgName ?? "this organisation"}</h2>
      <p className="mt-2 max-w-2xl text-sm text-white/80">
        {basis.questionnaire === "none"
          ? "Nothing has been described yet, so only the duties that bind every organisation are shown. They sharpen as the questionnaire and data map are filled in."
          : `Worked out from ${basis.answered} of ${basis.total} questionnaire steps, ${basis.activities} processing activities and ${basis.vendors} vendors on the data map${a.sectors.length ? `, and the sector${a.sectors.length > 1 ? "s" : ""}: ${a.sectors.map((x) => x.label).join(", ")}` : ""}.`}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Pill n={s.applies} label="Apply" />
        <Pill n={s.mayApply} label="May apply" tone="text-[#f6d28b]" />
        <Pill n={s.rules.length} label="Rules bind you" />
        <Pill n={s.highestCeilingText ? s.highestCeilingText.replace("up to ", "") : "—"} label="Highest penalty ceiling" />
        <Pill n={s.daysToFirstDuty > 0 ? s.daysToFirstDuty : "In force"} label={s.daysToFirstDuty > 0 ? `Days to ${fmtDate(s.firstDuty)}` : "Main duties"} />
      </div>
    </section>
  );
}

function ObligationCard({ o }: { o: Obligation }) {
  const st = STATUS[o.status];
  const muted = o.status === "not_applicable";
  return (
    <li className={`relative overflow-hidden rounded-xl border bg-white p-4 shadow-card ${muted ? "border-slate-200 opacity-70" : "border-slate-200"}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${st.bar}`} />
      <div className="flex flex-wrap items-start justify-between gap-2 pl-2">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-copper">{o.sections.join(" · ")}{o.rules.length ? ` · Rule${o.rules.length > 1 ? "s" : ""} ${o.rules.join(", ")}` : ""}</p>
          <h4 className="mt-0.5 font-display text-[15px] font-semibold text-slate-900">{o.title}</h4>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="mt-1.5 pl-2 text-sm text-slate-700">{o.asks}</p>
      <p className="mt-1.5 pl-2 text-xs text-slate-600"><span className="font-semibold text-slate-800">Why:</span> {o.reasons.join(" ")}</p>
      {muted ? null : (
        <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 pl-2 text-xs text-slate-600">
          <div><dt className="inline font-semibold text-slate-800">Enforceable from </dt><dd className="inline">{fmtDate(o.inForce)}</dd></div>
          <div><dt className="inline font-semibold text-slate-800">Penalty ceiling </dt><dd className="inline">{o.penalty.text} <span className="text-slate-400">({o.penalty.section})</span></dd></div>
          {o.controls.length ? <div><dt className="inline font-semibold text-slate-800">Tested by </dt><dd className="inline font-mono">{o.controls.join(", ")}</dd></div> : null}
        </dl>
      )}
    </li>
  );
}

/** Part A, tailored: every provision, whether it applies, why, when it bites and what it can cost. */
export function ApplicabilityPartA({ a }: { a: EngagementApplicability }) {
  return (
    <div className="space-y-8">
      {GROUPS.map((g) => {
        const items = a.obligations.filter((o) => o.group === g.key);
        if (!items.length) return null;
        return (
          <section key={g.key} aria-labelledby={`g-${g.key}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
              <h3 id={`g-${g.key}`} className="font-display text-base font-semibold text-slate-900">{g.title}</h3>
              <p className="text-xs text-slate-500">{g.blurb}</p>
            </div>
            <ul className="grid gap-3 lg:grid-cols-2">{items.map((o) => <ObligationCard key={o.id} o={o} />)}</ul>
          </section>
        );
      })}
    </div>
  );
}

/** The Rules that bind this organisation, by the date they take effect. */
export function RulesTimeline({ a }: { a: EngagementApplicability }) {
  const today = new Date().toISOString().slice(0, 10);
  const phases = (["immediate", "12m", "18m"] as const).map((k) => ({ k, ...RULE_PHASES[k], rules: a.rules.filter((r) => r.phase === k) })).filter((p) => p.rules.length);
  return (
    <ol className="grid gap-3 lg:grid-cols-3">
      {phases.map((p) => (
        <li key={p.k} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold text-slate-900">{p.label}</p>
            <Badge tone={p.date <= today ? "positive" : "warning"}>{p.date <= today ? "In force" : "Not yet"}</Badge>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">{p.rules.map((r) => <li key={r.number}><span className="text-slate-500">Rule {r.number}.</span> {r.title}</li>)}</ul>
        </li>
      ))}
    </ol>
  );
}

/** Part B: the sector rules for the sectors this organisation operates in. */
export function ApplicabilityPartB({ a, referenceHref }: { a: EngagementApplicability; referenceHref?: string }) {
  if (!a.sectors.length) {
    return <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">No sector chosen yet, so no sector rules are shown. {referenceHref ? <>Browse every sector on the <Link href={referenceHref} className="font-medium text-brand-700 hover:underline">Regulations reference</Link>.</> : null}</p>;
  }
  return (
    <div className="space-y-10">
      {a.sectors.map((s) => (
        <section key={s.key} aria-labelledby={`b-${s.key}`}>
          <h3 id={`b-${s.key}`} className="font-display text-lg font-semibold text-slate-900">{s.label} <Badge>{s.controls.length} added controls</Badge></h3>
          <div className="mt-3"><SectorPart sector={s} /></div>
        </section>
      ))}
    </div>
  );
}
