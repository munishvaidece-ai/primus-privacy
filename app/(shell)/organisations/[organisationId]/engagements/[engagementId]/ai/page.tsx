import Link from "next/link";
import { loadAiContext } from "./load";
import { AiShell, CARD, Flash, INPUT, LABEL, aiBase } from "@/components/ai/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAiSettings } from "@/lib/ai/settings";
import { getQueueCounts, listEvents } from "@/lib/ai/suggestions";
import { jobCounts, listRecentJobs, listReportIssuances } from "@/lib/ai/control";
import { readAiConfig } from "@/lib/ai/config";
import { chooseProvider } from "@/lib/ai/providers";
import { GATE_LABELS, LEVEL_NAMES, type AutopilotLevel } from "@/lib/ai/types";
import { JOB_LABELS, percent } from "@/lib/ai/present";
import { pauseAiAction, resumeAiAction, retryJobAction, runNowAction, saveAiSettingsAction } from "./actions";

const LEVEL_TEXT: Record<AutopilotLevel, string> = {
  1: "Assist — the AI prepares everything, but nothing is applied until a person approves it.",
  2: "Supervised — the AI applies routine, low-stakes work it is very sure about. Everything else waits for a person.",
  3: "Full autopilot — the AI applies everything it is reasonably sure about. People review the exceptions and the sign-off gates.",
};

export default async function AiOverviewPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const { ctx, data } = await loadAiContext(params, async (db, c) => {
    const settings = await getAiSettings(db, params.engagementId, params.organisationId);
    const [counts, jobs, failedJobs, events, issuances] = await Promise.all([
      getQueueCounts(db, params.engagementId),
      jobCounts(db, params),
      listRecentJobs(db, c.userId, params, 60),
      listEvents(db, params.engagementId, 8),
      listReportIssuances(db, c.userId, params),
    ]);
    return { settings, counts, jobs, failed: failedJobs.filter((j) => j.status === "failed").slice(0, 5), events, issuances };
  });
  const { settings, counts, jobs, failed, events, issuances } = data;
  const cfg = readAiConfig();
  const choice = chooseProvider(settings.allowExternalAi, cfg);
  const externalPossible = cfg.provider !== "offline";
  const base = aiBase(params.organisationId, params.engagementId);
  const hidden = (
    <>
      <input type="hidden" name="organisationId" value={params.organisationId} />
      <input type="hidden" name="engagementId" value={params.engagementId} />
    </>
  );

  const state = !settings.enabled ? { tone: "neutral" as const, text: "AI is switched off" } : settings.paused ? { tone: "critical" as const, text: "AI is paused" } : { tone: "positive" as const, text: `AI is on — ${LEVEL_NAMES[settings.level]}` };

  return (
    <AiShell {...ctx} active="" badge={{ queue: counts.pending }}>
      <Flash saved={searchParams.saved} error={searchParams.error} />

      <section className={CARD} aria-labelledby="status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="status" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Status</h2>
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-slate-900"><Badge tone={state.tone}>{state.text}</Badge></p>
            {settings.enabled ? <p className="mt-2 max-w-2xl text-sm text-slate-600">{LEVEL_TEXT[settings.level]}</p> : <p className="mt-2 max-w-2xl text-sm text-slate-600">Nothing is being done automatically. Switch the AI on in the settings below when you are ready.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {settings.enabled && !settings.paused ? (
              <>
                <form action={runNowAction}>{hidden}<Button type="submit" variant="secondary">Run now</Button></form>
                <form action={pauseAiAction}>{hidden}<Button type="submit" variant="destructive">Pause everything</Button></form>
              </>
            ) : null}
            {settings.enabled && settings.paused && ctx.canConfigure ? (
              <form action={resumeAiAction}>{hidden}<Button type="submit">Resume</Button></form>
            ) : null}
          </div>
        </div>
        {settings.paused ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">While paused the AI cannot read or change anything on this engagement. Work already in progress stops at its next step.</p> : null}
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Counts">
        <Link href={`${base}/queue`} className={`${CARD} hover:bg-slate-50`}>
          <p className="text-3xl font-semibold text-slate-900">{counts.pending}</p>
          <p className="mt-1 text-sm text-slate-600">waiting for a person{counts.gated ? ` (${counts.gated} at a sign-off gate)` : ""}</p>
        </Link>
        <div className={CARD}>
          <p className="text-3xl font-semibold text-slate-900">{counts.autoApplied}</p>
          <p className="mt-1 text-sm text-slate-600">done automatically</p>
        </div>
        <div className={CARD}>
          <p className="text-3xl font-semibold text-slate-900">{counts.approved + counts.overridden + counts.rejected}</p>
          <p className="mt-1 text-sm text-slate-600">decided by people ({counts.approved} approved, {counts.overridden} changed, {counts.rejected} rejected)</p>
        </div>
        <div className={CARD}>
          <p className="text-3xl font-semibold text-slate-900">{jobs.queued + jobs.running}</p>
          <p className="mt-1 text-sm text-slate-600">AI jobs in progress or waiting{jobs.failed ? ` · ${jobs.failed} failed` : ""}</p>
        </div>
      </section>

      {failed.length ? (
        <section className="mt-6 rounded-md border border-red-200 bg-red-50 p-4" aria-label="Failed jobs">
          <h2 className="text-sm font-semibold text-red-900">Some AI jobs failed</h2>
          <ul className="mt-2 space-y-2">
            {failed.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-red-900">
                <span>{JOB_LABELS[j.kind] ?? j.kind}: {j.error ?? "unknown error"}</span>
                <form action={retryJobAction}>{hidden}<input type="hidden" name="jobId" value={j.id} /><Button type="submit" size="sm" variant="secondary">Try again</Button></form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`${CARD} mt-6`} aria-labelledby="guardrails">
        <h2 id="guardrails" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Where your data goes</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li><strong>AI engine in use:</strong> {choice.provider ? `${choice.label} (${choice.model})` : "built-in rules engine — nothing is sent to any outside service"}.</li>
          <li><strong>Hosting region:</strong> {cfg.dataRegion}.</li>
          <li><strong>Personal identifiers</strong> (Aadhaar, PAN, phone, email, card numbers…) are masked before any text reaches a language model.</li>
          <li><strong>Connectors</strong> keep only names, locations and the <em>types</em> of personal data found — never the data itself.</li>
          {choice.note ? <li className="text-amber-800"><strong>Note:</strong> {choice.note}</li> : null}
        </ul>
      </section>

      {ctx.canConfigure ? (
        <section className={`${CARD} mt-6`} aria-labelledby="settings">
          <h2 id="settings" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Settings</h2>
          <form action={saveAiSettingsAction} className="mt-4 space-y-6">
            {hidden}
            <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Switch the AI on for this engagement
            </label>

            <fieldset>
              <legend className="text-sm font-medium text-slate-900">How much the AI may do by itself</legend>
              <div className="mt-2 space-y-2">
                {([1, 2, 3] as AutopilotLevel[]).map((l) => (
                  <label key={l} className="flex items-start gap-2 text-sm text-slate-700">
                    <input type="radio" name="level" value={l} defaultChecked={settings.level === l} className="mt-1" />
                    <span>{LEVEL_TEXT[l]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ts" className={LABEL}>Supervised: apply automatically when at least this sure (%)</label>
                <input id="ts" name="thresholdSupervised" type="number" min={50} max={100} defaultValue={Math.round(settings.thresholdSupervised * 100)} className={INPUT} />
              </div>
              <div>
                <label htmlFor="tf" className={LABEL}>Full autopilot: apply automatically when at least this sure (%)</label>
                <input id="tf" name="thresholdFull" type="number" min={50} max={100} defaultValue={Math.round(settings.thresholdFull * 100)} className={INPUT} />
              </div>
            </div>
            <p className="-mt-3 text-xs text-slate-500">Critical controls always need at least 90% under full autopilot, whatever you set here.</p>

            <fieldset>
              <legend className="text-sm font-medium text-slate-900">Sign-off gates — a person must always approve these</legend>
              <p className="mt-1 text-xs text-slate-500">On by default. Switch one off only if this client has agreed the AI may do it alone. Only an Engagement Manager can approve a gated item.</p>
              <div className="mt-2 space-y-2 text-sm text-slate-700">
                <label className="flex items-center gap-2"><input type="checkbox" name="gateRejectCriticalEvidence" defaultChecked={settings.gates.rejectCriticalEvidence} /> {GATE_LABELS.reject_critical_evidence}</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="gateReleaseCriticalFindings" defaultChecked={settings.gates.releaseCriticalFindings} /> {GATE_LABELS.release_critical_findings}</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="gateIssueFinalReport" defaultChecked={settings.gates.issueFinalReport} /> {GATE_LABELS.issue_final_report}</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="gateSendBreachNotices" defaultChecked={settings.gates.sendBreachNotices} /> {GATE_LABELS.send_breach_notices}</label>
              </div>
            </fieldset>

            <div>
              <label className="flex items-center gap-2 text-sm text-slate-900">
                <input type="checkbox" name="allowExternalAi" defaultChecked={settings.allowExternalAi} disabled={!externalPossible} />
                Allow this engagement to use the outside language model configured for the deployment
              </label>
              <p className="mt-1 text-xs text-slate-500">
                {externalPossible ? `The deployment is set up for ${cfg.provider}. Text is masked before it is sent; model hosting: ${cfg.dataRegion}.` : "Not available: your administrator has not configured an outside model. The built-in rules engine is used and no data leaves the server."}
              </p>
            </div>

            <Button type="submit">Save settings</Button>
          </form>
        </section>
      ) : null}

      {issuances.length ? (
        <section className={`${CARD} mt-6`} aria-labelledby="reports">
          <h2 id="reports" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Issued report summaries</h2>
          <ul className="mt-3 space-y-3">
            {issuances.map((r) => (
              <li key={r.id} className="text-sm">
                <p className="font-medium text-slate-900">Version {r.version} — {r.headline}</p>
                <p className="mt-1 whitespace-pre-line text-slate-600">{r.narrative}</p>
                <p className="mt-1 text-xs text-slate-500">Issued {r.issuedAt.toISOString().slice(0, 10)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`${CARD} mt-6`} aria-labelledby="recent">
        <div className="flex items-center justify-between">
          <h2 id="recent" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Latest activity</h2>
          <Link href={`${base}/activity`} className="text-sm font-medium text-slate-900 underline">Full audit trail</Link>
        </div>
        {events.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nothing yet.</p> : (
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            {events.map((e) => <li key={e.id}><span className="text-xs text-slate-400">{e.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span> · {e.actorType === "ai" ? "AI" : e.actorType === "human" ? "Person" : "System"}: {e.message}</li>)}
          </ul>
        )}
      </section>
      <p className="mt-6 text-xs text-slate-400">Auto-apply confidence now: supervised {percent(settings.thresholdSupervised)}, full {percent(settings.thresholdFull)}.</p>
    </AiShell>
  );
}
