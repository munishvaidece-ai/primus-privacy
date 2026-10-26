import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SIDE_WORDS } from "@/lib/ai/provenance";
import { TIER_WORDS, confidenceWord, percent } from "@/lib/ai/present";
import type { Source } from "@/lib/ai/types";
import type { SuggestionRow } from "@/lib/ai/suggestions";

const TYPE_WORDS: Record<Source["type"], string> = {
  document: "Document",
  evidence: "Evidence",
  control: "Control standard",
  test: "Control test",
  response: "Assessment answer",
  record: "Record",
  questionnaire: "Questionnaire",
  case: "Case",
  summary: "Summary",
};

const SIDE_TONE = { primus: "neutral", client: "warning", system: "neutral" } as const;

export function SideBadge({ side, name }: { side: "primus" | "client" | "system"; name?: string | null }) {
  return (
    <Badge tone={SIDE_TONE[side]} className={side === "client" ? "" : side === "primus" ? "bg-brand-50 text-brand-800 ring-brand-200" : ""}>
      {SIDE_WORDS[side]}
      {name ? `: ${name}` : ""}
    </Badge>
  );
}

/** Where the record the AI changed lives, as a link a person can open. */
export function resultLink(s: Pick<SuggestionRow, "resultRef" | "kind">, base: string): { href: string; label: string } | null {
  const r = (s.resultRef ?? null) as Record<string, string> | null;
  if (!r) return null;
  switch (r.table) {
    case "evidence": return { href: "/evidence-review", label: "Open in Evidence review" };
    case "assessment_responses": return { href: `${base}/assessments`, label: "Open the assessment" };
    case "findings": return { href: `${base}/findings`, label: "Open the finding" };
    case "engagement_scope_controls": return { href: `${base}/scope`, label: "Open the scope" };
    case "ops_cases": return { href: `${base}/ai/cases`, label: "Open the case" };
    case "ai_report_issuances": return { href: `${base}/reports`, label: "Open the report" };
    default: return null;
  }
}

export function SourcesTable({ sources, base }: { sources: Source[]; base: string }) {
  if (sources.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">This output was made before the evidence trail existed, so its inputs were not recorded. New AI work always records them.</p>;
  }
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-3 py-2">What the AI read</th>
            <th scope="col" className="px-3 py-2">Who supplied it</th>
            <th scope="col" className="px-3 py-2">How it reached the AI</th>
            <th scope="col" className="px-3 py-2">Why it was chosen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 align-top">
          {sources.map((src, i) => (
            <tr key={i}>
              <td className="px-3 py-2">
                <span className="text-xs uppercase tracking-wide text-slate-500">{TYPE_WORDS[src.type] ?? src.type}</span>
                <p className="font-medium text-slate-900">{src.label}</p>
                {src.detail ? <p className="mt-1 text-xs text-slate-600">{src.detail}</p> : null}
                {src.excerpt ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-medium text-brand-700">Show the text the AI was given</summary>
                    <p className="mt-1 whitespace-pre-line rounded bg-slate-50 p-2 text-xs text-slate-700">{src.excerpt}</p>
                  </details>
                ) : null}
                {src.link ? <Link href={src.link.startsWith("/organisations") || src.link.startsWith("/evidence") ? src.link : `${base}${src.link}`} className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Open</Link> : null}
              </td>
              <td className="px-3 py-2">
                {src.providedBy ? <SideBadge side={src.providedBy.side} name={src.providedBy.name} /> : <span className="text-slate-500">—</span>}
                <p className="mt-1 text-xs text-slate-600">{src.origin}</p>
              </td>
              <td className="px-3 py-2 text-xs text-slate-700">
                {src.channel ?? "—"}
                {src.at ? <p className="mt-1 text-slate-500">{src.at.slice(0, 10)}</p> : null}
              </td>
              <td className="px-3 py-2 text-xs text-slate-700">{src.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Everything about how one AI output came to be: inputs, quotes, reasoning, model, confidence, and the rule that let it proceed. */
export function EvidenceTrail({ s, base, open = false }: { s: SuggestionRow; base: string; open?: boolean }) {
  const sources = (s.sources ?? []) as Source[];
  const cites = (s.citations ?? []) as Array<{ quote: string; verified: boolean }>;
  const link = resultLink(s, base);
  const clientN = sources.filter((x) => x.providedBy?.side === "client").length;
  const primusN = sources.filter((x) => x.providedBy?.side === "primus").length;
  return (
    <details open={open} className="mt-3 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-brand-800">
        Evidence trail: what the AI read ({sources.length} item{sources.length === 1 ? "" : "s"}
        {clientN || primusN ? ` · ${clientN} from the client, ${primusN} from Primus` : ""})
      </summary>
      <div className="mt-3 space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">1. Inputs: documents and data used</p>
          <SourcesTable sources={sources} base={base} />
        </div>

        {cites.length ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">2. Sentences it relied on</p>
            <ul className="mt-1 space-y-1 text-sm">
              {cites.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden>{c.verified ? "✓" : "⚠"}</span>
                  <span><q>{c.quote}</q>{c.verified ? <span className="ml-2 text-xs text-emerald-700">found word for word in the document</span> : <span className="ml-2 text-xs text-amber-700">not found in the document, check it</span>}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{cites.length ? "3" : "2"}. Its reasoning</p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{s.rationale}</p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{cites.length ? "4" : "3"}. How it was processed and why it was allowed</p>
          <dl className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-slate-500">Engine</dt>
            <dd>{s.provider === "offline" ? "Built-in rules engine, running inside this platform. Nothing was sent to an outside AI service." : `${s.provider} / ${s.model}. Personal identifiers (Aadhaar, PAN, phone, email, etc.) were masked before sending.`}</dd>
            <dt className="text-slate-500">Confidence</dt>
            <dd>{percent(s.confidence)} ({confidenceWord(s.confidence)}) · {TIER_WORDS[s.riskTier as keyof typeof TIER_WORDS]}</dd>
            <dt className="text-slate-500">Autopilot level</dt>
            <dd>{s.autopilotLevel === 1 ? "1 Assist" : s.autopilotLevel === 2 ? "2 Supervised" : "3 Full autopilot"}</dd>
            <dt className="text-slate-500">Rule that applied</dt>
            <dd>{s.routingReason}</dd>
            <dt className="text-slate-500">Outcome</dt>
            <dd>{s.decisionNote ?? "—"}{s.decidedAt ? ` (${s.decidedAt.toISOString().slice(0, 16).replace("T", " ")} UTC)` : ""}</dd>
          </dl>
        </div>

        {link ? <Link href={link.href} className="inline-block text-sm font-medium text-brand-700 hover:underline">{link.label} →</Link> : null}
      </div>
    </details>
  );
}
