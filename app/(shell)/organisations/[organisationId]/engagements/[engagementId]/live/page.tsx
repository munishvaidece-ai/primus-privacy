import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { hasEngagementPermission, NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { isDemoAuthActive } from "@/lib/auth/demo-auth";
import { getViewer } from "@/lib/workspace/common";
import { getAiSettings } from "@/lib/ai/settings";
import { LEVEL_NAMES, type AutopilotLevel } from "@/lib/ai/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveLog } from "@/components/live/live-log";
import { PhaseCard, type LiveCtx } from "@/components/live/phase-card";
import { PHASES } from "@/lib/live/config";
import { loadLiveStatus, type PhaseState } from "@/lib/live/status";
import { levelAction } from "./actions";

const DOT: Record<PhaseState, string> = { waiting: "bg-slate-300", ready: "bg-slate-500", working: "bg-amber-500", needs_person: "bg-amber-500", done: "bg-emerald-600" };
const LEVEL_HELP: Record<AutopilotLevel, string> = {
  1: "The AI prepares everything. Nothing is applied until a person approves it.",
  2: "The AI applies routine, low-stakes work it is very sure about. People decide the rest.",
  3: "The AI applies everything it is reasonably sure about. People get the exceptions and the sign-off gates.",
};

export const dynamic = "force-dynamic";

export default async function LiveRunPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { ok?: string; problem?: string; details?: string };
}) {
  const user = await requireAuthenticatedUser();
  const data = await withRequestDb(user.id, async (db) => {
    try {
      const eng = await getEngagementDetail(db, user.id, params.engagementId);
      if (eng.organisationId !== params.organisationId) notFound();
      const [canRun, canRelease, canConfigure, viewer] = await Promise.all([
        hasEngagementPermission(db, user.id, params.engagementId, "ai.supervise"),
        hasEngagementPermission(db, user.id, params.engagementId, "ai.release"),
        hasEngagementPermission(db, user.id, params.engagementId, "ai.configure"),
        getViewer(db, user.id),
      ]);
      const live = await loadLiveStatus(db, user.id, params, canRun);
      const settings = canRun ? await getAiSettings(db, params.engagementId, params.organisationId) : null;
      return { eng, canRun, canRelease, canConfigure, viewer, live, settings };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });
  const { eng, canRun, canRelease, canConfigure, viewer, live, settings } = data;
  const base = `/organisations/${params.organisationId}/engagements/${params.engagementId}`;
  const ctx: LiveCtx = {
    organisationId: params.organisationId,
    engagementId: params.engagementId,
    canRun,
    canRelease,
    isDemo: isDemoAuthActive(),
    viewerName: viewer.displayName ?? viewer.email ?? "you",
    viewerSide: viewer.side,
  };
  const done = live.phases.filter((p) => p.state === "done").length;

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}`} className="hover:underline">{eng.organisationName}</Link>
        {" / "}
        <Link href={base} className="hover:underline">{eng.name}</Link>
      </p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Live Run</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            The whole engagement, in seven phases, on real files. At each phase a document goes in, the platform checks it, the AI reads it and does its work, and the result becomes the next phase&apos;s starting point. Where a person must decide, the AI stops and waits.
          </p>
        </div>
        <Link href={`${base}/ai/cases`} className="inline-flex h-9 shrink-0 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-copper hover:text-copper">After the assessment: incidents and cases</Link>
        {ctx.isDemo ? (
          <a href="/demo/Orchid_Hill_Demo_Pack.zip" className="inline-flex h-9 shrink-0 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">Download the whole demo pack (ZIP)</a>
        ) : null}
      </div>

      {searchParams.ok ? <p role="status" className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.ok}</p> : null}
      {searchParams.problem ? (
        <div role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <p>{searchParams.problem}</p>
          {searchParams.details ? <ul className="mt-1 list-disc pl-5 text-xs">{searchParams.details.split("\n").map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
        </div>
      ) : null}
      {searchParams.ok && searchParams.details ? <ul className="mt-2 list-disc rounded-md bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-900">{searchParams.details.split("\n").map((d, i) => <li key={i}>{d}</li>)}</ul> : null}

      <nav aria-label="Phases" className="mt-5 flex flex-wrap gap-2">
        {live.phases.map((p) => {
          const cfg = PHASES.find((x) => x.n === p.n)!;
          return (
            <a key={p.n} href={`#phase-${p.n}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:border-copper">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${DOT[p.state]}`} />
              {p.n}. {cfg.name}
              <span className="sr-only">: {p.stateText}</span>
            </a>
          );
        })}
        <span className="ml-1 self-center text-xs text-slate-500">{done} of 7 done</span>
      </nav>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          {PHASES.map((cfg) => (
            <PhaseCard key={cfg.n} cfg={cfg} st={live.phases.find((p) => p.n === cfg.n)!} ctx={ctx} live={live} />
          ))}
        </div>
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
          {canRun ? <LiveLog statusUrl={`${base}/live/status`} initial={{ jobs: live.jobs, events: live.events }} /> : (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Activity</h2>
              <ol className="mt-3 space-y-1.5 text-xs">{live.events.slice(0, 20).map((e) => <li key={e.id} className="text-slate-800">{e.message}</li>)}</ol>
            </section>
          )}
          {settings ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card" aria-labelledby="autopilot">
              <h2 id="autopilot" className="text-sm font-semibold uppercase tracking-wide text-slate-500">How much the AI does alone</h2>
              <p className="mt-2 flex items-center gap-2 text-sm"><Badge tone="positive">{LEVEL_NAMES[settings.level]}</Badge></p>
              <p className="mt-1 text-xs text-slate-600">{LEVEL_HELP[settings.level]}</p>
              {canConfigure ? (
                <form action={levelAction} className="mt-3 space-y-1.5">
                  <input type="hidden" name="organisationId" value={params.organisationId} />
                  <input type="hidden" name="engagementId" value={params.engagementId} />
                  <input type="hidden" name="phase" value="1" />
                  {([1, 2, 3] as const).map((l) => (
                    <label key={l} className="flex items-start gap-2 text-xs text-slate-800">
                      <input type="radio" name="level" value={l} defaultChecked={settings.level === l} className="mt-0.5" />
                      <span><strong>{LEVEL_NAMES[l]}.</strong> {LEVEL_HELP[l]}</span>
                    </label>
                  ))}
                  <Button type="submit" size="sm" variant="secondary">Change level</Button>
                  <p className="text-xs text-slate-500">Takes effect on the next thing the AI does. Sign-off gates stay on at every level.</p>
                </form>
              ) : null}
              <p className="mt-3 text-xs text-slate-600">Engine: the platform&apos;s own rules engine. Nothing leaves this computer.</p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
