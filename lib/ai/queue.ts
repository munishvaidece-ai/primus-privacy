import "server-only";
import { Pool } from "pg";
import type { RequestDb } from "@/lib/db/request-client";
import { aiJobs } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export const JOB_KINDS = [
  "plan",
  "evidence_review",
  "applicability",
  "rating",
  "finding_create",
  "report_issue",
  "ops_case",
  "connector_test",
  "connector_scan",
  "intake_scope",
  "intake_landscape",
  "remediation_plan",
  "closure_check",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export interface EnqueueInput {
  tenantId: string;
  organisationId: string;
  engagementId: string;
  kind: JobKind;
  subjectType?: string;
  subjectId?: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string;
  requestedBy?: string | null;
}

/** Adds a job (as the calling user / agent, so RLS applies). Returns null if an identical job is already waiting. */
export async function enqueueJob(db: RequestDb, i: EnqueueInput): Promise<string | null> {
  const rows = await db
    .insert(aiJobs)
    .values({
      tenantId: i.tenantId,
      organisationId: i.organisationId,
      engagementId: i.engagementId,
      kind: i.kind,
      subjectType: i.subjectType ?? null,
      subjectId: i.subjectId ?? null,
      payload: i.payload ?? {},
      dedupeKey: i.dedupeKey ?? null,
      requestedBy: i.requestedBy ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: aiJobs.id });
  return rows[0]?.id ?? null;
}

export async function cancelQueuedJobs(db: RequestDb, engagementId: string): Promise<number> {
  const rows = await db
    .update(aiJobs)
    .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(aiJobs.engagementId, engagementId), inArray(aiJobs.status, ["queued"])))
    .returning({ id: aiJobs.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Worker-side (privileged connection). The worker only *claims* and
// *finishes* jobs here; everything a job actually does to engagement data
// runs as the AI agent user under row-level security.
// ---------------------------------------------------------------------------
let pool: Pool | undefined;
export function getQueuePool(): Pool {
  if (!pool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set.");
    pool = new Pool({ connectionString: cs, max: 4 });
  }
  return pool;
}

export interface ClaimedJob {
  id: string;
  tenantId: string;
  organisationId: string;
  engagementId: string;
  kind: JobKind;
  subjectType: string | null;
  subjectId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  requestedBy: string | null;
}

const STALE_MINUTES = 15;

/** Claims one runnable job. Jobs of engagements that are switched off or paused are never claimed. */
export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const p = getQueuePool();
  await p.query(
    `UPDATE ai_jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, updated_at = now()
     WHERE status = 'running' AND locked_at < now() - ($1 || ' minutes')::interval`,
    [String(STALE_MINUTES)],
  );
  const { rows } = await p.query(
    `UPDATE ai_jobs SET status = 'running', locked_at = now(), locked_by = $1, started_at = now(),
            attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT j.id FROM ai_jobs j
       JOIN ai_engagement_settings s ON s.engagement_id = j.engagement_id
       WHERE j.status = 'queued' AND j.run_after <= now() AND s.enabled AND NOT s.paused
       ORDER BY j.run_after, j.created_at
       FOR UPDATE OF j SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, tenant_id, organisation_id, engagement_id, kind, subject_type, subject_id, payload, attempts, max_attempts, requested_by`,
    [workerId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    tenantId: r.tenant_id,
    organisationId: r.organisation_id,
    engagementId: r.engagement_id,
    kind: r.kind,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    payload: r.payload ?? {},
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    requestedBy: r.requested_by,
  };
}

export async function finishJob(id: string, result: Record<string, unknown>): Promise<void> {
  await getQueuePool().query(
    `UPDATE ai_jobs SET status = 'succeeded', finished_at = now(), result = $2::jsonb, error = NULL, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(result)],
  );
}

export async function failJob(job: ClaimedJob, error: string): Promise<"retry" | "failed"> {
  const terminal = job.attempts >= job.maxAttempts;
  const backoffSeconds = Math.min(600, 15 * 2 ** (job.attempts - 1));
  await getQueuePool().query(
    terminal
      ? `UPDATE ai_jobs SET status = 'failed', finished_at = now(), error = $2, updated_at = now() WHERE id = $1`
      : `UPDATE ai_jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, error = $2,
                run_after = now() + ($3 || ' seconds')::interval, updated_at = now() WHERE id = $1`,
    terminal ? [job.id, error.slice(0, 1000)] : [job.id, error.slice(0, 1000), String(backoffSeconds)],
  );
  return terminal ? "failed" : "retry";
}

export async function closeQueuePool(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
}

