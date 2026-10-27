import { loadPortal } from "@/lib/workspace/page";
import { hasPermission } from "@/lib/workspace/common";
import { isDemoAuthActive } from "@/lib/auth/demo-auth";
import { loadLiveStatus } from "@/lib/live/status";
import { PHASES } from "@/lib/live/config";
import { listReleasedReports } from "@/lib/workspace/reports";
import { PortalHeader } from "@/components/portal/header";
import { JourneyCard, journeyState, type JourneyCtx } from "@/components/live/journey-card";

export const dynamic = "force-dynamic";

/** The same seven phases as the Primus Live Run, seen from the organisation: what you send, what Primus does, what comes back. */
export default async function PortalJourney({ searchParams }: { searchParams: { e?: string; ok?: string; problem?: string; details?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, user, current }) => ({
    live: await loadLiveStatus(db, user.id, { engagementId: current.id, organisationId: current.organisationId }, false),
    canUpload: await hasPermission(db, user.id, current, "client.contribute"),
    me: user.email,
    reports: await listReleasedReports(db, { engagementId: current.id }),
  }));
  const m = portal.current;
  const { live } = data;
  const ctx: JourneyCtx = {
    organisationId: m.organisationId,
    engagementId: m.id,
    returnTo: `/portal/journey${portal.q}`,
    isDemo: isDemoAuthActive(),
    canUpload: data.canUpload,
    viewerName: data.me ?? "you",
    reports: data.reports.map((r) => ({ id: r.id, version: r.version })),
  };
  const done = live.phases.filter((p) => p.state === "done").length;
  const dot = { Done: "bg-emerald-600", "Waiting for you": "bg-copper", "Sent. With Primus": "bg-amber-500", "Primus is working on this": "bg-amber-500", "Not open yet": "bg-slate-300" } as Record<string, string>;

  return (
    <div>
      <PortalHeader title="Live journey" subtitle="The seven steps of your engagement. Four of them need a file from you. The rest Primus does, and shows you the result here as it happens." engagements={portal.engagements} current={m} />
      {searchParams.ok ? <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.ok}</p> : null}
      {searchParams.problem ? (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <p>{searchParams.problem}</p>
          {searchParams.details ? <ul className="mt-1 list-disc pl-5 text-xs">{searchParams.details.split("\n").map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
        </div>
      ) : null}

      <nav aria-label="Phases" className="flex flex-wrap items-center gap-2">
        {live.phases.map((p, i) => {
          const cfg = PHASES[i]!;
          const s = journeyState(cfg, p, i === 0 || live.phases[i - 1]!.state === "done");
          return (
            <a key={p.n} href={`#phase-${p.n}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:border-copper">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot[s.text] ?? "bg-slate-300"}`} />
              {p.n}. {cfg.name}<span className="sr-only">: {s.text}</span>
            </a>
          );
        })}
        <span className="text-xs text-slate-500">{done} of 7 done</span>
      </nav>

      <div className="mt-6 space-y-5">
        {PHASES.map((cfg, i) => (
          <JourneyCard key={cfg.n} cfg={cfg} st={live.phases[i]!} ctx={ctx} prevDone={i === 0 || live.phases[i - 1]!.state === "done"} />
        ))}
      </div>
    </div>
  );
}
