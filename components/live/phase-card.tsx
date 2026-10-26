import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/components/ui/kit";
import { KIND_LABELS } from "@/lib/ai/types";
import { percent } from "@/lib/ai/present";
import type { PhaseConfig } from "@/lib/live/config";
import type { LiveStatus, PhaseState, PhaseStatus } from "@/lib/live/status";
import { approveAllAction, connectorAction, decideAction, finaliseAction, loadAction, releaseAction, runAction, scopeAction, uploadAction } from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/live/actions";

export interface LiveCtx {
  organisationId: string;
  engagementId: string;
  canRun: boolean;
  canRelease: boolean;
  isDemo: boolean;
  viewerName: string;
  viewerSide: "primus" | "client";
}

const STATE_TONE: Record<PhaseState, "neutral" | "positive" | "warning" | "critical"> = { waiting: "neutral", ready: "neutral", working: "warning", needs_person: "warning", done: "positive" };
const FILE_TONE = { accepted: "positive", processed: "positive", received: "neutral", rejected: "critical" } as const;
const FILE_WORD = { accepted: "Passed the check", processed: "Read by the AI", received: "Received", rejected: "Refused" } as const;

function Hidden({ ctx, phase }: { ctx: LiveCtx; phase: number }) {
  return (
    <>
      <input type="hidden" name="organisationId" value={ctx.organisationId} />
      <input type="hidden" name="engagementId" value={ctx.engagementId} />
      <input type="hidden" name="phase" value={phase} />
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{n}</span>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <div className="mt-1.5 space-y-2 text-sm text-slate-700">{children}</div>
      </div>
    </li>
  );
}

function RunButton({ ctx, phase, step, label, primary = true, hint }: { ctx: LiveCtx; phase: number; step: string; label: string; primary?: boolean; hint?: string }) {
  return (
    <form action={runAction} className="inline-flex flex-col gap-1">
      <Hidden ctx={ctx} phase={phase} />
      <input type="hidden" name="step" value={step} />
      <Button type="submit" variant={primary ? "primary" : "secondary"} disabled={!ctx.canRun} title={ctx.canRun ? undefined : "Only the Primus team can start the AI"}>{label}</Button>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </form>
  );
}

function PlainButton({ ctx, phase, action, label, extra, disabled, primary = false }: { ctx: LiveCtx; phase: number; action: (f: FormData) => Promise<void>; label: string; extra?: Record<string, string>; disabled?: boolean; primary?: boolean }) {
  return (
    <form action={action} className="inline-block">
      <Hidden ctx={ctx} phase={phase} />
      {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Button type="submit" variant={primary ? "primary" : "secondary"} disabled={disabled}>{label}</Button>
    </form>
  );
}

function FilesTable({ st }: { st: PhaseStatus }) {
  const templates = st.files.filter((f) => f.role === "template");
  const others = st.files.filter((f) => f.role !== "template");
  if (!st.files.length) return <p className="text-sm text-slate-500">Nothing has been uploaded for this phase yet.</p>;
  return (
    <div className="space-y-3">
      {templates.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {templates.map((f) => (
            <li key={f.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-all font-medium text-slate-900">{f.filename}</span>
                <Badge tone={FILE_TONE[f.status]}>{FILE_WORD[f.status]}</Badge>
                <span className="text-xs text-slate-500">{f.uploadedByName} ({f.uploadedBySide === "primus" ? "Primus" : "client"}) · {fmtDateTime(f.uploadedAt)}</span>
              </div>
              {f.summary ? <p className="mt-1 text-xs text-slate-600">{f.summary}</p> : null}
              {f.status === "rejected" && f.issues.length ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-800">
                  {f.issues.slice(0, 6).map((i, k) => <li key={k}>{[i.sheet, i.row ? `row ${i.row}` : null, i.column].filter(Boolean).join(", ")}{i.sheet || i.row || i.column ? ": " : ""}{i.message}</li>)}
                  {f.issues.length > 6 ? <li>and {f.issues.length - 6} more</li> : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {others.length ? (
        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-900">{others.length} supporting file{others.length === 1 ? "" : "s"} received</summary>
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 text-xs">
            {others.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
                <span className="min-w-0 break-all font-medium text-slate-900">{f.filename}</span>
                <span className="text-slate-500">{(f.sizeBytes / 1024).toFixed(0)} KB · {f.uploadedByName} · {fmtDateTime(f.uploadedAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Waiting({ ctx, st, phase, base }: { ctx: LiveCtx; st: PhaseStatus; phase: number; base: string }) {
  if (!st.waiting.length) return null;
  const ordinary = st.waiting.filter((w) => !w.gate);
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-amber-900">Waiting for a person ({st.waiting.length})</h4>
        {ordinary.length > 1 && ctx.canRun ? (
          <form action={approveAllAction}>
            <Hidden ctx={ctx} phase={phase} />
            {ordinary.map((w) => <input key={w.id} type="hidden" name="suggestionId" value={w.id} />)}
            <Button type="submit" size="sm" variant="secondary">Approve all {ordinary.length} ordinary items</Button>
          </form>
        ) : null}
      </div>
      <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto">
        {st.waiting.slice(0, 25).map((w) => (
          <li key={w.id} className="rounded-md border border-amber-200 bg-white p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{w.title}</span>
              {w.gate ? <Badge tone="critical">Sign-off gate</Badge> : null}
              <Badge>{KIND_LABELS[w.kind as keyof typeof KIND_LABELS] ?? w.kind}</Badge>
              <span className="text-xs text-slate-500">AI confidence {percent(w.confidence)}</span>
            </div>
            {w.summary ? <p className="mt-1 text-xs text-slate-600">{w.summary.slice(0, 280)}</p> : null}
            {w.routingReason ? <p className="mt-1 text-xs font-medium text-amber-900">Why it stopped: {w.routingReason}</p> : null}
            {ctx.canRun && (!w.gate || ctx.canRelease) ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <form action={decideAction}>
                  <Hidden ctx={ctx} phase={phase} />
                  <input type="hidden" name="suggestionId" value={w.id} />
                  <input type="hidden" name="action" value="approve" />
                  <Button type="submit" size="sm">Approve</Button>
                </form>
                <form action={decideAction} className="flex items-end gap-1.5">
                  <Hidden ctx={ctx} phase={phase} />
                  <input type="hidden" name="suggestionId" value={w.id} />
                  <input type="hidden" name="action" value="reject" />
                  <label className="sr-only" htmlFor={`note-${w.id}`}>Reason for rejecting</label>
                  <input id={`note-${w.id}`} name="note" placeholder="Reason, if rejecting" className="h-8 w-44 rounded-lg border border-slate-300 px-2 text-xs" />
                  <Button type="submit" size="sm" variant="secondary">Reject</Button>
                </form>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">{w.gate ? "Needs someone with release rights." : "Needs a Primus team member."}</p>
            )}
          </li>
        ))}
        {st.waiting.length > 25 ? <li className="text-xs text-slate-600">and {st.waiting.length - 25} more in the <Link className="underline" href={`${base}/ai/queue`}>full review queue</Link>.</li> : null}
      </ul>
    </div>
  );
}

export function PhaseCard({ cfg, st, ctx, live }: { cfg: PhaseConfig; st: PhaseStatus; ctx: LiveCtx; live: LiveStatus }) {
  const base = `/organisations/${ctx.organisationId}/engagements/${ctx.engagementId}`;
  const tpl = (kind: "blank" | "sample") => `${base}/live/template?phase=${cfg.n}&kind=${kind}`;
  const n = cfg.n;
  const expectedSide = cfg.from.side;
  const wrongPerson = expectedSide !== "none" && expectedSide !== ctx.viewerSide;
  let step = 0;

  return (
    <section id={`phase-${n}`} aria-labelledby={`phase-${n}-title`} className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phase {n} of 7</p>
          <h3 id={`phase-${n}-title`} className="mt-0.5 text-lg font-semibold text-slate-900">{cfg.name}</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-700">{cfg.headline}</p>
        </div>
        <Badge tone={STATE_TONE[st.state]}>{st.stateText}</Badge>
      </header>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where the documents come from</dt>
          <dd className="mt-1 text-slate-800"><strong>{cfg.from.who}.</strong> {cfg.from.how}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">What the AI reads</dt>
          <dd className="mt-1 text-slate-800">{cfg.reads}</dd>
        </div>
      </dl>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-900">What the AI will do, and what it hands to the next phase</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">{cfg.does.map((d) => <li key={d}>{d}</li>)}</ul>
        <p className="mt-2 text-slate-700"><strong>Hands on:</strong> {cfg.handsOn}</p>
      </details>

      <ol className="mt-5 space-y-5">
        {cfg.template ? (
          <Step n={++step} title="Get the template">
            <p>Every file for this phase is in a fixed template. The platform checks it before the AI reads a word.</p>
            <div className="flex flex-wrap gap-2">
              <a href={tpl("blank")} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-copper hover:text-copper">Download the blank template</a>
              {ctx.isDemo ? <a href={tpl("sample")} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-copper hover:text-copper">Download the filled Orchid Hill sample</a> : null}
            </div>
          </Step>
        ) : null}

        {n === 3 ? (
          <Step n={++step} title="Create the scope">
            <p>A person opens the scope. Every control starts as undecided.</p>
            <PlainButton ctx={ctx} phase={3} action={scopeAction} extra={{ step: "create" }} label="Create the scope" disabled={live.scopeId !== null} />
          </Step>
        ) : null}

        {cfg.template || cfg.support ? (
          <Step n={++step} title="Send the files">
            {wrongPerson ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">This step is normally done by {cfg.from.who}. You are signed in as {ctx.viewerName} ({ctx.viewerSide === "primus" ? "Primus" : "client"}). Uploads are recorded under your name. To show the real hand-off, sign in as the right person.</p>
            ) : (
              <p className="text-xs text-slate-500">Uploads are recorded under your name: {ctx.viewerName}.</p>
            )}
            {cfg.template ? (
              <form action={uploadAction} className="flex flex-wrap items-end gap-2">
                <Hidden ctx={ctx} phase={n} />
                <input type="hidden" name="kind" value="template" />
                <div>
                  <label htmlFor={`tpl-${n}`} className="block text-xs font-medium text-slate-700">Filled template (.xlsx)</label>
                  <input id={`tpl-${n}`} name="files" type="file" accept=".xlsx" required className="mt-1 block w-72 max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
                </div>
                <Button type="submit">Check and upload</Button>
              </form>
            ) : null}
            {cfg.support ? (
              <form action={uploadAction} className="flex flex-wrap items-end gap-2">
                <Hidden ctx={ctx} phase={n} />
                <input type="hidden" name="kind" value="support" />
                <div>
                  <label htmlFor={`sup-${n}`} className="block text-xs font-medium text-slate-700">{cfg.support.label} (several files allowed)</label>
                  <input id={`sup-${n}`} name="files" type="file" multiple required className="mt-1 block w-72 max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm" />
                </div>
                <Button type="submit" variant="secondary">Upload files</Button>
                <p className="w-full text-xs text-slate-500">{cfg.support.hint}</p>
              </form>
            ) : null}
            {n === 5 ? (
              <p className="text-xs text-slate-600">Or connect a system instead of uploading: <Link className="font-medium underline" href={`${base}/ai/connectors`}>set up a connector</Link> (database, document share or cloud storage).</p>
            ) : null}
            <FilesTable st={st} />
          </Step>
        ) : null}

        {n === 2 ? (
          <Step n={++step} title="Or connect the client's database">
            <p>Instead of trusting only what the client wrote down, the platform can look at the database itself. It connects read-only, reads table and column names, samples a few rows in memory to recognise things like PAN, Aadhaar and mobile numbers, and keeps no values. The AI then compares what it found with the Data Inventory. <strong>Scan first, then run the AI on the inventory</strong>, so the comparison is included.</p>
            {live.connectors.length === 0 && !ctx.canRun ? (
              <p className="text-xs text-slate-500">If the client agrees, the Primus team connects the database here and scans it. Nothing is stored except table and column names and the kinds of personal data found.</p>
            ) : live.connectors.length === 0 ? (
              <p className="text-xs text-slate-500">No system is connected for this engagement. <Link className="font-medium underline" href={`${base}/ai/connectors`}>Set up a connector</Link>{ctx.canRun ? "." : " (Primus team only)."}</p>
            ) : (
              live.connectors.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{c.name}</span>
                    <Badge tone={c.status === "connected" ? "positive" : c.status === "error" ? "critical" : "neutral"}>{c.status === "connected" ? "Connected" : c.status === "error" ? "Problem" : c.status === "disabled" ? "Off" : "Not tested yet"}</Badge>
                    <span className="text-xs text-slate-500">PostgreSQL · read-only{c.lastRunAt ? ` · last scan ${fmtDateTime(c.lastRunAt)}` : ""}</span>
                  </div>
                  {c.lastMessage ? <p className="mt-1 text-xs text-slate-600">{c.lastMessage}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <PlainButton ctx={ctx} phase={2} action={connectorAction} extra={{ connectorId: c.id, kind: "test" }} label="Test the connection" disabled={!ctx.canRun} />
                    <PlainButton ctx={ctx} phase={2} action={connectorAction} extra={{ connectorId: c.id, kind: "scan" }} label="Scan the database now" primary disabled={!ctx.canRun} />
                  </div>
                  {c.tables.length ? (
                    <div className="mt-3 overflow-x-auto">
                      <p className="text-xs font-medium text-slate-700">{c.tables.length} tables found, {c.tables.filter((t) => t.categories.length).length} hold personal data. Only names and categories are kept.</p>
                      <table className="mt-1 w-full min-w-[32rem] text-left text-xs">
                        <thead><tr className="text-slate-500"><th className="py-1 pr-3 font-medium">Table</th><th className="py-1 pr-3 font-medium">Rows (approx.)</th><th className="py-1 font-medium">Personal data found</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {c.tables.map((t) => (
                            <tr key={t.location}>
                              <td className="py-1 pr-3 font-mono text-slate-900">{t.location}</td>
                              <td className="py-1 pr-3 text-slate-700">{t.rows ? t.rows.toLocaleString("en-IN") : "—"}</td>
                              <td className="py-1">{t.categories.length ? <><Badge tone={t.sensitivity === "sensitive" ? "critical" : "warning"}>{t.sensitivity}</Badge> <span className="text-slate-700">{t.categories.join(", ")}</span></> : <span className="text-slate-500">none</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              ))
            )}
            {!ctx.canRun && live.connectors.length > 0 ? <p className="text-xs text-amber-900">Only the Primus team can run a scan.</p> : null}
          </Step>
        ) : null}

        {n === 4 ? (
          <Step n={++step} title="Load the tests">
            <p>The tests are recorded against their controls, as the person who uploaded the log. This happens automatically when the upload passes. Press this if you uploaded before the scope was locked.</p>
            <PlainButton ctx={ctx} phase={4} action={loadAction} label="Load the tests" />
          </Step>
        ) : null}
        {n === 5 ? (
          <Step n={++step} title="Link the files to controls">
            <p>Each file listed in the Evidence Index is attached to the control it names. Files that are not listed, or listed but missing, are reported here instead of being guessed.</p>
            <PlainButton ctx={ctx} phase={5} action={loadAction} label="Link the files to controls" />
          </Step>
        ) : null}

        <Step n={++step} title="Run the AI">
          <div className="flex flex-wrap items-start gap-3">
            {n === 1 ? <RunButton ctx={ctx} phase={1} step="1" label="Read the scope form" /> : null}
            {n === 2 ? <RunButton ctx={ctx} phase={2} step="2" label="Read the data inventory" /> : null}
            {n === 3 ? <RunButton ctx={ctx} phase={3} step="3" label="Decide applicability" hint={live.scopeId ? undefined : "Create the scope first."} /> : null}
            {n === 4 ? <RunButton ctx={ctx} phase={4} step="4" label="Rate the controls from the tests" /> : null}
            {n === 5 ? <RunButton ctx={ctx} phase={5} step="5" label="Review the evidence and re-rate" /> : null}
            {n === 6 ? <RunButton ctx={ctx} phase={6} step="6" label="Draft the findings" /> : null}
            {n === 7 ? (
              <>
                <RunButton ctx={ctx} phase={7} step="7a" label="Plan the remediation actions" />
                <RunButton ctx={ctx} phase={7} step="7b" label="Check the proof files" primary={false} hint="After the Closure Log and proofs are uploaded." />
              </>
            ) : null}
          </div>
          {!ctx.canRun ? <p className="text-xs text-amber-900">Only the Primus team can start the AI. Your upload is saved and waits for them.</p> : null}
        </Step>

        <Step n={++step} title="What the AI produced">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {st.facts.map((f) => (
              <div key={f.label} className="rounded-lg border border-slate-200 p-2.5">
                <dt className="text-xs text-slate-500">{f.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-slate-900">{f.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-600">{st.autoApplied} applied by the AI on its own · {st.decided} decided by people · {st.waiting.length} waiting. <Link className="underline" href={`${base}/ai/decisions`}>See how each decision was made and what it was based on</Link>.</p>
          <Waiting ctx={ctx} st={st} phase={n} base={base} />
        </Step>

        {n === 3 ? (
          <Step n={++step} title="Lock the scope and open the assessment">
            <p>When every control is decided, a person locks the scope. The assessment is created from it, and Phase 4 can start.</p>
            <PlainButton ctx={ctx} phase={3} action={scopeAction} extra={{ step: "lock" }} label="Lock the scope" primary disabled={!live.scopeId || live.scopeStatus === "locked"} />
          </Step>
        ) : null}
        {n === 6 ? (
          <Step n={++step} title="Release the findings to the client">
            <p>Only a person with release rights can do this. Until then the client sees nothing.</p>
            <PlainButton ctx={ctx} phase={6} action={releaseAction} label={`Release ${live.unreleasedFindings} finding${live.unreleasedFindings === 1 ? "" : "s"}`} primary disabled={!live.unreleasedFindings || !ctx.canRelease} />
          </Step>
        ) : null}
        {n === 7 ? (
          <>
            <Step n={++step} title="Finalise the assessment, then draft the report">
              <p>Finalising is one-way. Then the AI drafts the final report. The report is held for a person to issue.</p>
              <div className="flex flex-wrap items-start gap-3">
                <PlainButton ctx={ctx} phase={7} action={finaliseAction} label="Finalise the assessment" disabled={!live.assessmentId || live.assessmentStatus === "finalized"} />
                <RunButton ctx={ctx} phase={7} step="7c" label="Draft the final report" primary={false} hint="After the assessment is finalised." />
              </div>
            </Step>
          </>
        ) : null}
      </ol>
    </section>
  );
}
