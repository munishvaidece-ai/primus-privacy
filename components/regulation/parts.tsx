import { Badge } from "@/components/ui/badge";
import {
  CONTROL_MAP,
  DPDP_RULES,
  DPDP_SECTIONS,
  DPDP_VERIFIED_ON,
  PENALTY_SCHEDULE,
  RULE_PHASES,
  penaltyFor,
  type Sector,
} from "@/lib/regulation";
import { STARTER_CONTROLS } from "@/db/seed/starter-library";
import { OverlapList } from "@/components/regulation/overlap-list";
import { overlapsForSector } from "@/lib/regulation";

const CARD = "rounded-xl border border-slate-200 bg-white p-4 shadow-card";
const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500";

export function Disclaimer() {
  return (
    <p className="max-w-3xl rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
      Indicative reference content, not legal advice. Last checked {DPDP_VERIFIED_ON}. Items marked &ldquo;check before use&rdquo; have not been confirmed against a published source. Penalty figures are ceilings set by the Schedule to the Act; the Data Protection Board decides the actual amount after weighing the factors in section 33(2), so they do not predict what any firm would pay.
    </p>
  );
}

function phaseStatus(date: string): { label: string; tone: "positive" | "warning" } {
  const today = new Date().toISOString().slice(0, 10);
  return date <= today ? { label: "In force", tone: "positive" } : { label: "Not yet in force", tone: "warning" };
}

export function PenaltyTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50"><tr><th scope="col" className={TH}>What goes wrong</th><th scope="col" className={TH}>Section</th><th scope="col" className={TH}>Penalty ceiling</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {PENALTY_SCHEDULE.map((p) => (
            <tr key={p.key}><td className="px-3 py-2 text-slate-800">{p.breach}</td><td className="whitespace-nowrap px-3 py-2 text-slate-600">{p.section}</td><td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{p.maxText}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Part A: the DPDP Act and Rules. Same for every organisation. */
export function PartA() {
  const byPhase = (["immediate", "12m", "18m"] as const).map((k) => ({ k, rules: DPDP_RULES.filter((r) => r.phase === k) }));
  return (
    <div className="space-y-8">
      <section aria-labelledby="a-sections">
        <h3 id="a-sections" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sections of the Act that the controls point to</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {DPDP_SECTIONS.map((s) => {
            const n = Object.values(CONTROL_MAP).filter((m) => m.sections.some((x) => x === s.ref || x.startsWith(`${s.ref}(`))).length;
            return (
              <div key={s.ref} className={CARD}>
                <div className="flex items-center justify-between gap-2"><p className="font-medium text-slate-900">{s.ref} · {s.title}</p>{n > 0 ? <Badge>{n} control{n === 1 ? "" : "s"}</Badge> : null}</div>
                <p className="mt-1 text-sm text-slate-600">{s.summary}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="a-rules">
        <h3 id="a-rules" className="text-sm font-semibold uppercase tracking-wide text-slate-500">DPDP Rules, 2025 and when each part comes into force</h3>
        <div className="mt-2 grid gap-3 lg:grid-cols-3">
          {byPhase.map(({ k, rules }) => {
            const st = phaseStatus(RULE_PHASES[k].date);
            return (
              <div key={k} className={CARD}>
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-slate-900">{RULE_PHASES[k].label}</p><Badge tone={st.tone}>{st.label}</Badge></div>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">{rules.map((r) => <li key={r.number}><span className="text-slate-500">Rule {r.number}.</span> {r.title}</li>)}</ul>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="a-pen">
        <h3 id="a-pen" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Penalties (Schedule to the Act, s.33)</h3>
        <div className="mt-2"><PenaltyTable /></div>
      </section>

      <section aria-labelledby="a-map">
        <h3 id="a-map" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Control map: each DPDP control, its sections, Rules and penalty ceiling</h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50"><tr><th scope="col" className={TH}>Control</th><th scope="col" className={TH}>Sections</th><th scope="col" className={TH}>Rules</th><th scope="col" className={TH}>Penalty ceiling</th></tr></thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {STARTER_CONTROLS.map((c) => {
                const m = CONTROL_MAP[c.code];
                return (
                  <tr key={c.code}>
                    <td className="px-3 py-2"><span className="font-mono text-xs text-slate-500">{c.code}</span> <span className="text-slate-900">{c.title}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{m?.sections.join(", ") ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{m?.rules.length ? m.rules.map((r) => `R${r}`).join(", ") : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{m ? penaltyFor(m.penalty).maxText : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Part B: one sector's rules, controls and how they sit with DPDP. */
export function SectorPart({ sector }: { sector: Sector }) {
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-slate-600">{sector.blurb}</p>
      <p className="text-xs text-slate-500">Regulators: {sector.regulators.join(", ")}</p>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Laws, circulars and guidelines ({sector.instruments.length})</h3>
        <div className="mt-2 space-y-3">
          {sector.instruments.map((i) => (
            <div key={i.id} className={CARD}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{i.name}</p>
                <Badge tone={i.confirmed ? "positive" : "warning"}>{i.confirmed ? "Checked against a source" : "Check before use"}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{i.regulator} · {i.kind}</p>
              <p className="mt-1 text-sm text-slate-700">{i.summary}</p>
              {i.source ? <a href={i.source} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Source</a> : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Controls this sector adds ({sector.controls.length})</h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50"><tr><th scope="col" className={TH}>Control</th><th scope="col" className={TH}>Comes from</th><th scope="col" className={TH}>Sits alongside</th></tr></thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {sector.controls.map((c) => (
                <tr key={c.code}>
                  <td className="px-3 py-2"><p><span className="font-mono text-xs text-slate-500">{c.code}</span> <span className="font-medium text-slate-900">{c.title}</span></p><p className="mt-0.5 text-xs text-slate-600">{c.description}</p></td>
                  <td className="px-3 py-2 text-xs text-slate-700">{sector.instruments.find((i) => i.id === c.instrument)?.name ?? c.instrument}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{(c.related ?? []).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">How this sits with DPDP</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{sector.dpdpInterplay.map((t, k) => <li key={k}>{t}</li>)}</ul>
      </section>

      <OverlapList overlaps={overlapsForSector(sector.key)} title={`Where DPDP and ${sector.label} rules overlap`} />

      <section className={CARD}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Documents the AI would expect to see</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{sector.typicalEvidence.map((t, k) => <li key={k}>{t}</li>)}</ul>
      </section>
    </div>
  );
}
