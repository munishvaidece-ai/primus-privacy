"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Ev { id: string; at: string; type: string; actor: string; message: string }
interface Snapshot { jobs: { queued: number; running: number; failed: number; failedMessages: string[] }; events: Ev[] }

const ACTOR: Record<string, string> = { ai: "AI", human: "Person", system: "System" };
const TONE: Record<string, string> = { ai: "bg-blue-50 text-blue-800", human: "bg-amber-50 text-amber-800", system: "bg-slate-100 text-slate-700" };

/**
 * Follows the AI while it works. Polls quickly while a job is queued or running and slowly otherwise; when
 * anything new happens it asks the page to refresh, so the phase cards update without a manual reload.
 */
export function LiveLog({ statusUrl, initial }: { statusUrl: string; initial: Snapshot }) {
  const router = useRouter();
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(`${initial.events[0]?.id ?? ""}|${initial.jobs.queued}|${initial.jobs.running}|${initial.jobs.failed}`);
  const busy = snap.jobs.queued + snap.jobs.running > 0;

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(statusUrl, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as Snapshot;
        if (stop) return;
        setSnap({ jobs: d.jobs, events: d.events });
        setError(null);
        const sig = `${d.events[0]?.id ?? ""}|${d.jobs.queued}|${d.jobs.running}|${d.jobs.failed}`;
        if (sig !== last.current) {
          last.current = sig;
          router.refresh();
        }
      } catch {
        if (!stop) setError("Lost contact with the server. Retrying.");
      }
      if (!stop) timer = setTimeout(tick, document.hidden ? 8000 : busy ? 1200 : 4000);
    };
    timer = setTimeout(tick, busy ? 1200 : 4000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [statusUrl, router, busy]);

  return (
    <section aria-labelledby="live-log" className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 id="live-log" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Live log</h2>
        <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${busy ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-600"}`}>
          {busy ? <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-blue-600" /> : null}
          {busy ? `AI working (${snap.jobs.running} running, ${snap.jobs.queued} waiting)` : "AI idle"}
        </span>
      </div>
      {snap.jobs.failed ? (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
          {snap.jobs.failed} AI job{snap.jobs.failed === 1 ? "" : "s"} failed: {snap.jobs.failedMessages.join("; ")}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-amber-800">{error}</p> : null}
      <ol className="mt-3 max-h-[28rem] space-y-1.5 overflow-y-auto pr-1 text-xs" aria-live="polite">
        {snap.events.length === 0 ? <li className="text-slate-500">Nothing yet. Upload a file and press a Run button.</li> : null}
        {snap.events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <time className="w-14 shrink-0 tabular-nums text-slate-400" dateTime={e.at}>{new Date(e.at).toLocaleTimeString("en-IN", { hour12: false })}</time>
            <span className={`h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TONE[e.actor] ?? TONE.system}`}>{ACTOR[e.actor] ?? e.actor}</span>
            <span className="min-w-0 break-words text-slate-800">{e.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
