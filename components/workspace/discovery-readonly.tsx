import { SECTIONS, describeAnswer, type ObligationPreview } from "@/lib/workspace/discovery-sections";
import type { DiscoveryState } from "@/lib/workspace/discovery";
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

const statusLabel: Record<ObligationPreview["status"], string> = { applicable: "Applies", potential: "May apply", not_applicable: "Does not apply" };
const statusTone: Record<ObligationPreview["status"], "positive" | "warning" | "neutral"> = { applicable: "positive", potential: "warning", not_applicable: "neutral" };

export function ObligationsPreview({ items }: { items: ObligationPreview[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm" aria-label="Indicative obligations">
        <thead className="bg-slate-50"><tr>{["Reference", "Obligation", "Source", "Indicative result", "Why"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((o) => (
            <tr key={o.ref}>
              <td className="px-3 py-2 whitespace-nowrap">{o.ref}</td>
              <td className="px-3 py-2">{o.title}</td>
              <td className="px-3 py-2">{o.source}</td>
              <td className="px-3 py-2"><Badge tone={statusTone[o.status]}>{statusLabel[o.status]}</Badge></td>
              <td className="px-3 py-2 text-slate-600">{o.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
