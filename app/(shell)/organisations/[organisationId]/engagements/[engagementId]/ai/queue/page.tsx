import { loadAiContext } from "../load";
import { AiShell, CARD, Flash, INPUT, LABEL } from "@/components/ai/shell";
import { Badge, riskRatingTone, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getQueueCounts, listSuggestions, type SuggestionRow } from "@/lib/ai/suggestions";
import { OVERRIDABLE } from "@/lib/ai/apply";
import { GATE_LABELS, KIND_LABELS, type GateKey, type SuggestionKind } from "@/lib/ai/types";
import { SOURCE_WORDS, TIER_WORDS, confidenceWord, describeProposal, humanise, percent } from "@/lib/ai/present";
import { EvidenceTrail } from "@/components/ai/evidence-trail";
import { approveSelectedAction, decideSuggestionAction } from "./actions";

const CHOICES: Record<string, string[]> = {
  severity: ["low", "medium", "high", "critical"],
  rating: ["implemented", "partially_implemented", "not_implemented"],
};
const decisionChoices = (kind: string) => (kind === "applicability" ? ["applicable", "not_applicable"] : ["accepted", "rejected"]);
const LONG = new Set(["rationale", "reviewRationale", "description", "narrative", "draftResponse", "boardNoticeDraft", "principalNoticeDraft"]);

export default async function QueuePage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const { ctx, data } = await loadAiContext(params, async (db) => {
    const [pending, recent, counts] = await Promise.all([
      listSuggestions(db, params.engagementId, { status: ["pending_review"], limit: 200 }),
      listSuggestions(db, params.engagementId, { status: ["auto_applied", "approved", "overridden", "rejected", "failed"], limit: 25 }),
      getQueueCounts(db, params.engagementId),
    ]);
    return { pending, recent, counts };
  });
  const pending = [...data.pending].sort((a, b) => Number(!!b.gate) - Number(!!a.gate) || a.createdAt.getTime() - b.createdAt.getTime());
  const bulkable = pending.filter((s) => !s.gate);
  const hidden = (
    <>
      <input type="hidden" name="organisationId" value={params.organisationId} />
      <input type="hidden" name="engagementId" value={params.engagementId} />
    </>
  );

  return (
    <AiShell {...ctx} active="/queue" badge={{ queue: data.counts.pending }}>
      <Flash saved={searchParams.saved} error={searchParams.error} />
      <p className="max-w-3xl text-sm text-slate-600">
        These are the things the AI was not allowed or not sure enough to do by itself. Each shows what it proposes and why. You can <strong>approve</strong> it, <strong>change</strong> it, or <strong>reject</strong> it — your decision is recorded in the audit trail. Items marked <Badge tone="critical">Sign-off gate</Badge> can only be decided by an Engagement Manager.
      </p>

      {pending.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">Nothing is waiting for you. 🎉</div>
      ) : (
        <>
          {bulkable.length > 1 ? (
            <form id="bulk" action={approveSelectedAction} className="mt-6 flex flex-wrap items-center gap-3">
              {hidden}
              <Button type="submit" variant="secondary" size="sm">Approve all ticked</Button>
              <span className="text-xs text-slate-500">Tick the routine items you have glanced at, then approve them together. Gated items are always decided one by one.</span>
            </form>
          ) : null}
          <ul className="mt-4 space-y-4">
            {pending.map((s) => <SuggestionCard key={s.id} s={s} base={`/organisations/${params.organisationId}/engagements/${params.engagementId}`} canRelease={ctx.canRelease} hidden={hidden} bulk={bulkable.length > 1 && !s.gate} />)}
          </ul>
        </>
      )}

      <section className="mt-10" aria-labelledby="done">
        <h2 id="done" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recently handled</h2>
        {data.recent.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nothing handled yet.</p> : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead><tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500"><th scope="col" className="px-3 py-2">What</th><th scope="col" className="px-3 py-2">Outcome</th><th scope="col" className="px-3 py-2">Sure</th><th scope="col" className="px-3 py-2">When</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2"><span className="text-xs text-slate-500">{KIND_LABELS[s.kind as SuggestionKind]}</span><br />{s.title}</td>
                    <td className="px-3 py-2"><Badge tone={statusTone(s.status === "auto_applied" || s.status === "approved" || s.status === "overridden" ? "accepted" : s.status === "rejected" || s.status === "failed" ? "rejected" : "draft")}>{SOURCE_WORDS[s.status] ?? s.status}</Badge>{s.decisionNote ? <p className="mt-1 text-xs text-slate-500">{s.decisionNote}</p> : null}{s.applyError ? <p className="mt-1 text-xs text-red-700">{s.applyError}</p> : null}</td>
                    <td className="px-3 py-2">{percent(s.confidence)}</td>
                    <td className="px-3 py-2 text-slate-500">{s.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AiShell>
  );
}

function SuggestionCard({ s, base, canRelease, hidden, bulk }: { s: SuggestionRow; base: string; canRelease: boolean; hidden: React.ReactNode; bulk: boolean }) {
  const kind = s.kind as SuggestionKind;
  const lines = describeProposal(kind, (s.proposed ?? {}) as Record<string, unknown>, [s.rationale, s.summary].filter(Boolean) as string[]);
  const overridable = OVERRIDABLE[kind] ?? [];
  const proposed = (s.proposed ?? {}) as Record<string, unknown>;
  const canDecide = !s.gate || canRelease;
  return (
    <li className={`${CARD} ${s.gate ? "border-l-4 border-l-red-400" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{KIND_LABELS[kind]}</p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">{s.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{s.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s.gate ? <Badge tone="critical">Sign-off gate: {GATE_LABELS[s.gate as GateKey]}</Badge> : null}
          <Badge tone={riskRatingTone(s.riskTier)}>{TIER_WORDS[s.riskTier as keyof typeof TIER_WORDS]}</Badge>
          <Badge tone={Number(s.confidence) >= 0.75 ? "positive" : "warning"}>{percent(s.confidence)} sure ({confidenceWord(s.confidence)})</Badge>
          {bulk ? <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" name="ids" value={s.id} form="bulk" aria-label={`Select ${s.title}`} /> select</label> : null}
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500"><strong>Why it is here:</strong> {s.routingReason}</p>

      <dl className="mt-3 space-y-2 text-sm">
        {lines.map((l) => (
          <div key={l.key} className={l.long ? "" : "sm:flex sm:gap-3"}>
            <dt className="shrink-0 font-medium text-slate-700 sm:w-48">{l.label}</dt>
            <dd className="min-w-0 whitespace-pre-line break-words text-slate-800">{l.value}</dd>
          </div>
        ))}
      </dl>

      <EvidenceTrail s={s} base={base} open />

      {canDecide ? (
        <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-slate-100 pt-4">
          <form action={decideSuggestionAction}>{hidden}<input type="hidden" name="suggestionId" value={s.id} /><input type="hidden" name="action" value="approve" /><Button type="submit" size="sm">Approve</Button></form>

          {overridable.length ? (
            <details className="min-w-[16rem] flex-1">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Change it…</summary>
              <form action={decideSuggestionAction} className="mt-3 space-y-3">
                {hidden}<input type="hidden" name="suggestionId" value={s.id} /><input type="hidden" name="action" value="override" />
                {overridable.map((f) => {
                  const cur = typeof proposed[f] === "string" ? (proposed[f] as string) : "";
                  const choices = f === "decision" ? decisionChoices(kind) : CHOICES[f];
                  return (
                    <div key={f}>
                      <label className={LABEL} htmlFor={`${s.id}-${f}`}>{humanise(f)}</label>
                      {choices ? (
                        <select id={`${s.id}-${f}`} name={`f_${f}`} defaultValue={cur} className={INPUT}>{choices.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
                      ) : LONG.has(f) ? (
                        <textarea id={`${s.id}-${f}`} name={`f_${f}`} defaultValue={cur} rows={4} className={INPUT} />
                      ) : (
                        <input id={`${s.id}-${f}`} name={`f_${f}`} defaultValue={cur} className={INPUT} />
                      )}
                    </div>
                  );
                })}
                <div><label className={LABEL} htmlFor={`${s.id}-onote`}>Why are you changing it? (required)</label><input id={`${s.id}-onote`} name="note" required className={INPUT} /></div>
                <Button type="submit" size="sm" variant="secondary">Apply my version</Button>
              </form>
            </details>
          ) : null}

          <details className="min-w-[14rem]">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Reject…</summary>
            <form action={decideSuggestionAction} className="mt-3 space-y-3">
              {hidden}<input type="hidden" name="suggestionId" value={s.id} /><input type="hidden" name="action" value="reject" />
              <div><label className={LABEL} htmlFor={`${s.id}-rnote`}>Reason (required)</label><input id={`${s.id}-rnote`} name="note" required className={INPUT} /></div>
              <Button type="submit" size="sm" variant="destructive">Reject</Button>
            </form>
          </details>
        </div>
      ) : (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">This is a sign-off gate. It is waiting for an Engagement Manager to decide.</p>
      )}
      {s.applyError ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">Last attempt failed: {s.applyError}</p> : null}
    </li>
  );
}
