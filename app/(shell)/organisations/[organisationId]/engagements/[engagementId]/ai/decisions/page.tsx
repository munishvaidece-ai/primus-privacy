import Link from "next/link";
import { loadAiContext } from "../load";
import { AiShell, CARD } from "@/components/ai/shell";
import { EvidenceTrail } from "@/components/ai/evidence-trail";
import { Badge, riskRatingTone } from "@/components/ui/badge";
import { getQueueCounts, listSuggestions, type SuggestionRow } from "@/lib/ai/suggestions";
import { KIND_LABELS, type SuggestionKind } from "@/lib/ai/types";
import { SOURCE_WORDS, describeProposal, percent } from "@/lib/ai/present";

const FILTERS: Array<{ key: string; label: string; statuses: SuggestionRow["status"][] }> = [
  { key: "all", label: "Everything", statuses: ["auto_applied", "approved", "overridden", "rejected", "pending_review", "failed"] },
  { key: "auto", label: "Done by the AI by itself", statuses: ["auto_applied"] },
  { key: "waiting", label: "Waiting for a person", statuses: ["pending_review"] },
  { key: "people", label: "Decided by a person", statuses: ["approved", "overridden", "rejected"] },
];

export default async function DecisionsPage({ params, searchParams }: { params: { organisationId: string; engagementId: string }; searchParams: { show?: string } }) {
  const filter = FILTERS.find((f) => f.key === searchParams.show) ?? FILTERS[0]!;
  const base = `/organisations/${params.organisationId}/engagements/${params.engagementId}`;
  const { ctx, data } = await loadAiContext(params, async (db) => {
    const [rows, counts, all] = await Promise.all([
      listSuggestions(db, params.engagementId, { status: filter.statuses, limit: 100 }),
      getQueueCounts(db, params.engagementId),
      listSuggestions(db, params.engagementId, { limit: 500 }),
    ]);
    return { rows, counts, all };
  });
  const auto = data.all.filter((s) => s.status === "auto_applied").length;
  return (
    <AiShell {...ctx} active="/decisions" badge={{ queue: data.counts.pending }}>
      <p className="max-w-3xl text-sm text-slate-600">
        Every piece of work the AI has done, including work it applied by itself under autopilot. Open the <strong>evidence trail</strong> on any row to see exactly which documents and data it read, whether the Primus team or the client organisation supplied each one, which screen put it in front of the AI, why it was chosen, the sentences it relied on, and the rule that let it proceed.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        The AI is only given what is already recorded in this engagement. It cannot browse files, other clients, or anything that nobody uploaded or entered here. See <Link href={`${base}/ai/data`} className="font-medium text-brand-700 hover:underline">Data it reads</Link> for the full list.
      </p>
      <nav aria-label="Filter" className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`${base}/ai/decisions${f.key === "all" ? "" : `?show=${f.key}`}`} aria-current={f.key === filter.key ? "page" : undefined}
            className={f.key === filter.key ? "rounded-full bg-brand-700 px-3 py-1 text-xs font-medium text-white" : "rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"}>
            {f.label}
          </Link>
        ))}
        <span className="ml-auto text-xs text-slate-500">{auto} done automatically · {data.all.length} in total</span>
      </nav>

      {data.rows.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">Nothing here yet. Turn the AI on in Overview and press &ldquo;Run now&rdquo;.</div>
      ) : (
        <ul className="mt-4 space-y-3">
          {data.rows.map((s) => {
            const lines = describeProposal(s.kind, (s.proposed ?? {}) as Record<string, unknown>, [s.rationale, s.summary].filter(Boolean) as string[]).slice(0, 3);
            return (
              <li key={s.id} className={CARD}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{KIND_LABELS[s.kind as SuggestionKind]} · {s.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
                    <h3 className="mt-1 text-base font-semibold text-slate-900">{s.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{s.summary}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={s.status === "auto_applied" ? "positive" : s.status === "pending_review" ? "warning" : s.status === "rejected" || s.status === "failed" ? "critical" : "neutral"}>{SOURCE_WORDS[s.status] ?? s.status}</Badge>
                    <Badge tone={riskRatingTone(s.riskTier)}>{percent(s.confidence)} sure</Badge>
                  </div>
                </div>
                {lines.length ? <p className="mt-2 text-sm text-slate-800">{lines.map((l) => `${l.label}: ${l.value}`).join(" · ")}</p> : null}
                <EvidenceTrail s={s} base={base} />
              </li>
            );
          })}
        </ul>
      )}
    </AiShell>
  );
}
