import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { aiJobs, aiReportIssuances } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission } from "@/lib/authorization/service";
import { enqueueJob } from "./queue";
import { loadEngagementIds } from "./settings";
import { recordEvent } from "./events";

type Scope = { engagementId: string; organisationId: string };

async function requireSupervise(db: RequestDb, userId: string, engagementId: string) {
  const ok = (await hasEngagementPermission(db, userId, engagementId, "ai.supervise")) || (await hasEngagementPermission(db, userId, engagementId, "ai.configure"));
  if (!ok) throw new NotFoundOrForbiddenError();
}

/** "Run now": a full pass over everything waiting. */
export async function runNow(db: RequestDb, userId: string, s: Scope): Promise<{ queued: boolean }> {
  await requireSupervise(db, userId, s.engagementId);
  const ids = await loadEngagementIds(db, s.engagementId, s.organisationId);
  const id = await enqueueJob(db, { ...ids, kind: "plan", payload: { full: true }, dedupeKey: "plan", requestedBy: userId });
  if (id) await recordEvent(db, { ...ids, eventType: "run_requested", actorType: "human", actorUserId: userId, message: "A full AI pass was requested." });
  return { queued: id !== null };
}

export async function listRecentJobs(db: RequestDb, userId: string, s: Scope, limit = 40) {
  await requireSupervise(db, userId, s.engagementId);
  return db
    .select({ id: aiJobs.id, kind: aiJobs.kind, status: aiJobs.status, attempts: aiJobs.attempts, maxAttempts: aiJobs.maxAttempts, error: aiJobs.error, createdAt: aiJobs.createdAt, finishedAt: aiJobs.finishedAt, result: aiJobs.result })
    .from(aiJobs)
    .where(eq(aiJobs.engagementId, s.engagementId))
    .orderBy(desc(aiJobs.createdAt))
    .limit(limit);
}

export async function jobCounts(db: RequestDb, s: Scope) {
  const rows = await db.select({ status: aiJobs.status, n: sql<number>`count(*)::int` }).from(aiJobs).where(eq(aiJobs.engagementId, s.engagementId)).groupBy(aiJobs.status);
  const out: { queued: number; running: number; succeeded: number; failed: number; cancelled: number } = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const r of rows) out[r.status as keyof typeof out] = Number(r.n);
  return out;
}

/** Puts a failed job back in the queue for another try. */
export async function retryJob(db: RequestDb, userId: string, s: Scope, jobId: string): Promise<void> {
  await requireSupervise(db, userId, s.engagementId);
  const ids = await loadEngagementIds(db, s.engagementId, s.organisationId);
  const res = await db
    .update(aiJobs)
    .set({ status: "queued", attempts: 0, error: null, runAfter: new Date(), lockedAt: null, lockedBy: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.engagementId, ids.engagementId), eq(aiJobs.status, "failed")))
    .returning({ id: aiJobs.id });
  if (!res.length) throw new NotFoundOrForbiddenError();
  await recordEvent(db, { ...ids, jobId, eventType: "job_retried", actorType: "human", actorUserId: userId, message: "A failed AI job was put back in the queue." });
}

export async function listReportIssuances(db: RequestDb, userId: string, s: Scope) {
  await requireSupervise(db, userId, s.engagementId);
  return db.select().from(aiReportIssuances).where(eq(aiReportIssuances.engagementId, s.engagementId)).orderBy(desc(aiReportIssuances.issuedAt)).limit(20);
}
