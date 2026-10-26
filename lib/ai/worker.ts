import "server-only";
import http from "node:http";
import { readAiConfig } from "./config";
import { runJob } from "./jobs";
import { claimJob, closeQueuePool, failJob, finishJob, getQueuePool } from "./queue";

const agentCache = new Map<string, string>();

export async function resolveAgentUserId(tenantId: string): Promise<string> {
  const hit = agentCache.get(tenantId);
  if (hit) return hit;
  const { rows } = await getQueuePool().query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 AND email = 'ai-agent@' || $1::text || '.agent.primus.invalid' AND status = 'active'`,
    [tenantId],
  );
  if (!rows[0]) throw new Error(`No AI agent user for tenant ${tenantId}. Run: npm run ai:provision-agent`);
  agentCache.set(tenantId, rows[0].id);
  return rows[0].id;
}

/** Runs at most one job. Returns true if a job was processed. */
export async function runOnce(workerId: string, log: (m: string) => void = console.log): Promise<boolean> {
  const job = await claimJob(workerId);
  if (!job) return false;
  const started = Date.now();
  try {
    const agent = await resolveAgentUserId(job.tenantId);
    const result = await runJob(job, agent);
    await finishJob(job.id, result);
    log(`job ${job.id} ${job.kind} ok in ${Date.now() - started}ms`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const outcome = await failJob(job, msg);
    log(`job ${job.id} ${job.kind} ${outcome}: ${msg}`);
  }
  return true;
}

/** Enqueues a (light) planning job for every engagement where the AI is on and not paused. */
export async function schedulePlans(): Promise<number> {
  const { rowCount } = await getQueuePool().query(
    `INSERT INTO ai_jobs (tenant_id, organisation_id, engagement_id, kind, payload, dedupe_key)
     SELECT s.tenant_id, s.organisation_id, s.engagement_id, 'plan', '{"full":false}'::jsonb, 'plan'
     FROM ai_engagement_settings s WHERE s.enabled AND NOT s.paused
     ON CONFLICT DO NOTHING`,
  );
  return rowCount ?? 0;
}

export async function startWorker(opts: { workerId?: string; planIntervalMs?: number; healthPort?: number } = {}): Promise<() => Promise<void>> {
  const cfg = readAiConfig();
  const workerId = opts.workerId ?? `worker-${process.pid}`;
  const planEvery = opts.planIntervalMs ?? Number(process.env.AI_PLAN_INTERVAL_MS ?? 15 * 60_000);
  let stopping = false;
  let lastBeat = Date.now();
  let lastPlan = 0;

  let server: http.Server | undefined;
  const port = opts.healthPort ?? Number(process.env.WORKER_HEALTH_PORT ?? 0);
  if (port) {
    server = http.createServer((_req, res) => {
      const ok = Date.now() - lastBeat < 300_000;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok, workerId, lastBeatAgoMs: Date.now() - lastBeat }));
    });
    server.listen(port);
  }

  console.log(`[ai-worker] ${workerId} started; provider=${cfg.provider} external=${cfg.externalEnabled} region=${cfg.dataRegion}`);
  const loop = (async () => {
    while (!stopping) {
      try {
        lastBeat = Date.now();
        if (Date.now() - lastPlan > planEvery) {
          lastPlan = Date.now();
          await schedulePlans();
        }
        const worked = await runOnce(workerId);
        if (!worked) await new Promise((r) => setTimeout(r, cfg.workerPollMs));
      } catch (e) {
        console.error("[ai-worker] loop error:", e instanceof Error ? e.message : e);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();

  return async () => {
    stopping = true;
    await loop;
    server?.close();
    await closeQueuePool();
  };
}
