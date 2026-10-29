import { SECTIONS, describeAnswer, type ObligationPreview } from "@/lib/workspace/discovery-sections";
import type { DiscoveryState, SectorQuestionsState } from "@/lib/workspace/discovery";
import { Badge } from "@/components/ui/badge";
import { CARD } from "@/components/ui/kit";

export function DiscoveryAnswers({ state }: { state: DiscoveryState }) {
  return (
    <div className="space-y-4">
      {SECTIONS.map((s) => (
        <section key={s.key} className={CARD} aria-labelledby={`s-${s.key}`}>
          <div className="flex items-center justify-between gap-2">
            <h3 id={`s-${s.key}`} className="text-sm font-semibold text-slate-900">{s.step}. {s.title}</h3>
            <Badge tone={state.completed[s.key] ? "positive" : "neutral"}>{state.completed[s.key] ? "Complete" : "Not complete"}</Badge>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-2">
            {s.fields.map((f) => {
              const text = describeAnswer(f, state.answers[s.key] ?? {});
              return (
                <div key={f.key} className="min-w-0">
                  <dt className="text-xs font-medium text-slate-500">{f.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-900">{text || <span className="text-slate-400">Not answered</span>}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** The client's answers to their question sets (common set plus their sector), for the Primus reviewer. */
export function SectorAnswers({ state }: { state: SectorQuestionsState }) {
  return (
    <div className="space-y-4">
      {state.sets.map((set) => (
        <section key={set.key} className={CARD} aria-labelledby={`q-${set.key}`}>
          <div className="flex items-center justify-between gap-2">
            <h3 id={`q-${set.key}`} className="text-sm font-semibold text-slate-900">{set.section.title}</h3>
            <Badge tone={set.complete ? "positive" : "neutral"}>{set.complete ? "Complete" : `${set.answered} of ${set.section.fields.length} answered`}</Badge>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-2">
            {set.section.fields.map((f) => {
              const text = describeAnswer(f, set.answers);
              return (
                <div key={f.key} className="min-w-0">
                  <dt className="text-xs font-medium text-slate-500">{f.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-900">{text || <span className="text-slate-400">Not answered</span>}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** One place shows what applies: the Regulations view. This is just the doorway to it. */
export function ObligationsPreview({ href, count }: { href: string; count?: number }) {
  return (
    <a href={href} className="group flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card hover:border-copper">
      <span>
        <span className="block text-sm font-semibold text-slate-900">See which DPDP rules apply{count ? ` (${count} provisions)` : ""}</span>
        <span className="block text-sm text-slate-600">Worked out from these answers, the data map and the sector, with the section, the Rule, the date and the penalty ceiling for each.</span>
      </span>
      <span aria-hidden="true" className="text-copper transition-transform group-hover:translate-x-1">→</span>
    </a>
  );
}
