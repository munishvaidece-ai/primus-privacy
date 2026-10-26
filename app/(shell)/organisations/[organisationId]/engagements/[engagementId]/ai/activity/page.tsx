import { loadAiContext } from "../load";
import { AiShell, CARD } from "@/components/ai/shell";
import { Badge } from "@/components/ui/badge";
import { getQueueCounts, listEvents } from "@/lib/ai/suggestions";
import { listRecentJobs } from "@/lib/ai/control";
import { JOB_LABELS } from "@/lib/ai/present";

const WHO = { ai: "AI", human: "Person", system: "System" } as const;

export default async function ActivityPage({ params }: { params: { organisationId: string; engagementId: string } }) {
  const { ctx, data } = await loadAiContext(params, async (db, c) => {
    const [events, jobs, counts] = await Promise.all([
      listEvents(db, params.engagementId, 300),
      listRecentJobs(db, c.userId, params, 25),
      getQueueCounts(db, params.engagementId),
    ]);
    return { events, jobs, counts };
  });
  return (
    <AiShell {...ctx} active="/activity" badge={{ queue: data.counts.pending }}>
      <p className="max-w-3xl text-sm text-slate-600">
        Everything the AI and your team did on this engagement, newest first. Entries cannot be edited or deleted. Each AI change to a record is also written to the platform&rsquo;s main audit log under the AI agent&rsquo;s own identity, so it is always clear what a person did and what the AI did.
      </p>

      <section className={`${CARD} mt-6`} aria-labelledby="trail">
        <h2 id="trail" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Audit trail</h2>
        {data.events.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nothing recorded yet.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead><tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500"><th scope="col" className="py-2 pr-3">When (UTC)</th><th scope="col" className="py-2 pr-3">Who</th><th scope="col" className="py-2">What happened</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{e.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                    <td className="py-2 pr-3"><Badge tone={e.actorType === "human" ? "positive" : e.actorType === "ai" ? "neutral" : "warning"}>{WHO[e.actorType as keyof typeof WHO] ?? e.actorType}</Badge></td>
                    <td className="py-2 text-slate-800">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${CARD} mt-6`} aria-labelledby="jobs">
        <h2 id="jobs" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent AI jobs</h2>
        {data.jobs.length === 0 ? <p className="mt-3 text-sm text-slate-500">No jobs yet.</p> : (
          <ul className="mt-3 space-y-1 text-sm">
            {data.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap gap-x-3">
                <span className="text-xs text-slate-400">{j.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                <span>{JOB_LABELS[j.kind] ?? j.kind}</span>
                <Badge tone={j.status === "succeeded" ? "positive" : j.status === "failed" ? "critical" : "neutral"}>{j.status}</Badge>
                {j.error ? <span className="text-xs text-red-700">{j.error}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AiShell>
  );
}
