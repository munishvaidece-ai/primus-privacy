import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PhaseConfig } from "@/lib/live/config";
import type { PhaseStatus } from "@/lib/live/status";
import { uploadAction } from "@/app/(shell)/organisations/[organisationId]/engagements/[engagementId]/live/actions";
import { FilesTable } from "./phase-card";

export interface JourneyCtx {
  organisationId: string;
  engagementId: string;
  /** Where the upload forms send the person back to. */
  returnTo: string;
  isDemo: boolean;
  canUpload: boolean;
  viewerName: string;
  /** Final reports Primus has released to this organisation, newest first. */
  reports?: { id: string; version: number }[];
}

/** What the person at the organisation sees for each phase: what they do, what Primus does, and where the result shows up. */
export const JOURNEY_COPY: Record<number, { youDo: string | null; primusDoes: string; links: Array<{ label: string; href: string }> }> = {
  1: { youDo: "Fill in the Scope Intake Form and send your registration certificates and organisation chart.", primusDoes: "Primus reads the form, applies the sector rules your registrations point to, and sets up your business units.", links: [{ label: "Your business units", href: "/portal/business-units" }] },
  2: { youDo: "Fill in the Data Inventory and send your vendor list. If you agree, Primus can also scan a copy of your database, read-only, to check the inventory against what is really there.", primusDoes: "Primus builds your data map and pre-fills the discovery questionnaire from it. You confirm it.", links: [{ label: "Your data map", href: "/portal/processing" }, { label: "Discovery questionnaire", href: "/portal/discovery" }] },
  3: { youDo: null, primusDoes: "Primus decides, control by control, which of the DPDP controls and sector controls apply to you, and records why.", links: [{ label: "See which DPDP rules apply to you", href: "/portal/regulations" }] },
  4: { youDo: null, primusDoes: "A Primus consultant tests each control and records the result. The AI rates each control from the tests.", links: [{ label: "Your assessment", href: "/portal/assessment" }] },
  5: { youDo: "Fill in the Evidence Index and upload the files it lists: policies, registers, reports, certificates.", primusDoes: "Primus reads every file against the control it was sent for, accepts what supports it, and asks you about the rest.", links: [{ label: "Your evidence centre", href: "/portal/evidence" }, { label: "Clarifications", href: "/portal/clarifications" }] },
  6: { youDo: null, primusDoes: "Primus drafts a finding for each control that is not fully in place. A senior person reviews and releases them to you.", links: [{ label: "Your findings", href: "/portal/findings" }] },
  7: { youDo: "Fill in the Closure Log and upload a proof file for each action you have completed.", primusDoes: "Primus checks each proof, closes the action or asks for more, and issues the final report.", links: [{ label: "Remediation actions", href: "/portal/remediation" }, { label: "Reports", href: "/portal/reports" }, { label: "DPO Mate", href: "/portal/dpo-mate" }] },
};

/** One line per phase, written to the person at the organisation. */
export const JOURNEY_HEADLINE: Record<number, string> = {
  1: "You say who you are. We work out which laws apply to you.",
  2: "You describe your data. We build your data map and pre-fill the questionnaire for you to confirm.",
  3: "We decide, control by control, what applies to you, and tell you why.",
  4: "Your consultant tests each control. We rate each one from the tests.",
  5: "You send proof. We read every file and tell you whether it supports the control.",
  6: "We draft findings for the controls that are not fully in place. A senior person checks them and releases them to you.",
  7: "Findings become actions. You prove each fix. We check the proof and issue your final report.",
};

export function journeyState(cfg: PhaseConfig, st: PhaseStatus, prevDone: boolean): { text: string; tone: "neutral" | "positive" | "warning" } {
  if (st.state === "done") return { text: "Done", tone: "positive" };
  const mine = cfg.from.side === "client";
  if (mine) {
    if (!prevDone && cfg.n > 1) return { text: "Not open yet", tone: "neutral" };
    return st.files.length ? { text: "Sent. With Primus", tone: "warning" } : { text: "Waiting for you", tone: "warning" };
  }
  if (!prevDone && cfg.n > 1) return { text: "Not open yet", tone: "neutral" };
  return { text: "Primus is working on this", tone: "warning" };
}

function Hidden({ ctx, phase }: { ctx: JourneyCtx; phase: number }) {
  return (
    <>
      <input type="hidden" name="organisationId" value={ctx.organisationId} />
      <input type="hidden" name="engagementId" value={ctx.engagementId} />
      <input type="hidden" name="phase" value={phase} />
      <input type="hidden" name="returnTo" value={ctx.returnTo} />
    </>
  );
}

export function JourneyCard({ cfg, st, ctx, prevDone }: { cfg: PhaseConfig; st: PhaseStatus; ctx: JourneyCtx; prevDone: boolean }) {
  const copy = JOURNEY_COPY[cfg.n]!;
  const state = journeyState(cfg, st, prevDone);
  const base = `/organisations/${ctx.organisationId}/engagements/${ctx.engagementId}`;
  const tpl = (kind: "blank" | "sample") => `${base}/live/template?phase=${cfg.n}&kind=${kind}`;
  const yours = copy.youDo !== null;
  return (
    <section id={`phase-${cfg.n}`} aria-labelledby={`j-${cfg.n}`} className={`scroll-mt-24 overflow-hidden rounded-2xl border bg-white shadow-card ${yours ? "border-copper/40" : "border-slate-200"}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${st.state === "done" ? "bg-emerald-600 text-white" : yours ? "bg-brand text-white" : "bg-slate-100 text-slate-700"}`}>{st.state === "done" ? "✓" : cfg.n}</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{yours ? "Your step" : "Primus step"} · Phase {cfg.n} of 7</p>
            <h3 id={`j-${cfg.n}`} className="font-display text-lg font-semibold text-slate-900">{cfg.name}</h3>
            <p className="mt-0.5 text-sm text-slate-600">{JOURNEY_HEADLINE[cfg.n]}</p>
          </div>
        </div>
        <Badge tone={state.tone}>{state.text}</Badge>
      </header>

      <div className="space-y-4 px-5 py-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`rounded-lg p-3 ${yours ? "bg-amber-50/70" : "bg-slate-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What you do</p>
            <p className="mt-1 text-slate-800">{copy.youDo ?? "Nothing. This step is done by Primus using what you have already sent."}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What Primus does</p>
            <p className="mt-1 text-slate-800">{copy.primusDoes}</p>
          </div>
        </div>

        {yours && cfg.template ? (
          <div className="rounded-xl border border-slate-200 p-4">
            <h4 className="font-semibold text-slate-900">1. Get the template</h4>
            <p className="mt-1 text-slate-600">The file has a fixed layout. It is checked before anything is read.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={tpl("blank")} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-copper hover:text-copper">Download the blank template</a>
              {ctx.isDemo ? <a href={tpl("sample")} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-copper hover:text-copper">Download the filled Orchid Hill sample</a> : null}
            </div>

            <h4 className="mt-4 font-semibold text-slate-900">2. Send the files</h4>
            {!ctx.canUpload ? <p className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">Your role can see this step but cannot upload. Ask a colleague with contributor access.</p> : (
              <div className="mt-2 space-y-3">
                <form action={uploadAction} className="flex flex-wrap items-end gap-3 rounded-xl border-2 border-dashed border-[#e4c3bb] bg-white/70 p-3 transition hover:border-copper">
                  <Hidden ctx={ctx} phase={cfg.n} />
                  <input type="hidden" name="kind" value="template" />
                  <div className="min-w-0 flex-1 basis-64">
                    <label htmlFor={`jt-${cfg.n}`} className="block text-xs font-medium text-slate-700">Filled template (.xlsx)</label>
                    <input id={`jt-${cfg.n}`} name="files" type="file" accept=".xlsx" required className="mt-1 block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-copper-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-copper-deep hover:file:bg-[#f1dcc3]" />
                  </div>
                  <Button type="submit">Check and send</Button>
                </form>
                {cfg.support ? (
                  <form action={uploadAction} className="flex flex-wrap items-end gap-3 rounded-xl border-2 border-dashed border-[#e4c3bb] bg-white/70 p-3 transition hover:border-copper">
                    <Hidden ctx={ctx} phase={cfg.n} />
                    <input type="hidden" name="kind" value="support" />
                    <div className="min-w-0 flex-1 basis-64">
                      <label htmlFor={`js-${cfg.n}`} className="block text-xs font-medium text-slate-700">{cfg.support.label} (several files allowed)</label>
                      <input id={`js-${cfg.n}`} name="files" type="file" multiple required className="mt-1 block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-copper-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-copper-deep hover:file:bg-[#f1dcc3]" />
                    </div>
                    <Button type="submit" variant="secondary">Send files</Button>
                    <p className="w-full text-xs text-slate-500">{cfg.support.hint}</p>
                  </form>
                ) : null}
              </div>
            )}
            <div className="mt-3"><FilesTable st={st} /></div>
          </div>
        ) : null}

        {st.facts.length ? (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {st.facts.map((f) => (
              <div key={f.label} className="rounded-lg border border-slate-200 p-2.5">
                <dt className="text-xs text-slate-500">{f.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-slate-900">{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {cfg.n === 7 ? (
          ctx.reports?.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-copper/40 bg-amber-50/70 p-3">
              <p className="text-slate-800"><span className="font-semibold">Your final report is ready.</span> It has the summary, your findings and the remediation roadmap in 30, 60 and 90 day steps.</p>
              <a href={`/portal/reports/${ctx.reports[0]!.id}/download`} className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90">Download the report (PDF)</a>
            </div>
          ) : <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">When Primus releases the final report, a download button appears here.</p>
        ) : null}

        {cfg.n === 7 && ctx.reports?.length ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-slate-800"><span className="font-semibold">What next?</span> Take a short preliminary report to share inside your organisation, or book a 30 minute consultation with our experts to go deeper on your DPDP alignment.</p>
            <Link href="/portal/dpo-mate" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-copper hover:text-copper">Open DPO Mate</Link>
          </div>
        ) : null}

        <p className="flex flex-wrap gap-x-5 gap-y-1">
          {copy.links.map((l) => <Link key={l.href} href={l.href} className="font-medium text-brand-700 hover:underline">{l.label} →</Link>)}
        </p>
      </div>
    </section>
  );
}
