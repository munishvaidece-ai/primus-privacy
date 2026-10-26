import "server-only";
import { and, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { aiEvents, aiSuggestions } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission } from "@/lib/authorization/service";
import { applySuggestion, mergeOverride } from "./apply";
import { recordEvent } from "./events";
import { route } from "./routing";
import type { EngagementAiSettings, GateKey, SuggestionDraft, SuggestionKind } from "./types";
import { GATE_LABELS, KIND_LABELS } from "./types";

export async function withSavepoint<T>(db: RequestDb, name: string, fn: () => Promise<T>): Promise<T> {
  await db.execute(sql.raw(`SAVEPOINT ${name}`));
  try {
    const r = await fn();
    await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
    return r;
  } catch (e) {
    await db.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`));
    await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
    throw e;
  }
}

export interface RecordContext {
  actorUserId: string; // the AI agent
  jobId: string | null;
  settings: EngagementAiSettings;
  provider: { label: string; model: string };
}

export type RecordOutcome = { id: string | null; outcome: "applied" | "queued" | "duplicate" | "failed"; gate: GateKey | null; reason: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 500) : "unknown error";
}

/**
 * Stores one AI output as a suggestion, routes it under the engagement's
 * autopilot policy, and — if the policy allows — applies it right away
 * through the normal domain functions as the AI agent user.
 */
export async function recordSuggestion(db: RequestDb, ctx: RecordContext, draft: SuggestionDraft): Promise<RecordOutcome> {
  const s = ctx.settings;
  const ids = { tenantId: s.tenantId, organisationId: s.organisationId, engagementId: s.engagementId };

  const [dup] = await db
    .select({ id: aiSuggestions.id })
    .from(aiSuggestions)
    .where(
      and(
        eq(aiSuggestions.engagementId, s.engagementId),
        eq(aiSuggestions.kind, draft.kind),
        eq(aiSuggestions.inputHash, draft.inputHash),
        notInArray(aiSuggestions.status, ["failed", "superseded"]),
      ),
    )
    .limit(1);
  if (dup) return { id: dup.id, outcome: "duplicate", gate: null, reason: "Already suggested for these inputs." };

  // Anything still waiting for a person about the same subject is now stale.
  if (draft.subjectId) {
    const stale = await db
      .update(aiSuggestions)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(
        and(
          eq(aiSuggestions.engagementId, s.engagementId),
          eq(aiSuggestions.kind, draft.kind),
          eq(aiSuggestions.subjectId, draft.subjectId),
          eq(aiSuggestions.status, "pending_review"),
        ),
      )
      .returning({ id: aiSuggestions.id });
    for (const st of stale) {
      await recordEvent(db, { ...ids, suggestionId: st.id, eventType: "superseded", actorType: "ai", actorUserId: ctx.actorUserId, message: "Superseded by a newer suggestion because the underlying facts changed." });
    }
  }

  const decision = route({
    kind: draft.kind,
    proposed: draft.proposed,
    confidence: draft.confidence,
    tier: draft.tier,
    needsHuman: draft.needsHuman,
    level: s.level,
    thresholdSupervised: s.thresholdSupervised,
    thresholdFull: s.thresholdFull,
    gates: s.gates,
  });

  const [row] = await db
    .insert(aiSuggestions)
    .values({
      ...ids,
      jobId: ctx.jobId,
      kind: draft.kind,
      subjectType: draft.subjectType,
      subjectId: draft.subjectId,
      title: draft.title.slice(0, 300),
      summary: draft.summary.slice(0, 2000),
      proposed: draft.proposed,
      rationale: draft.rationale.slice(0, 3000),
      citations: draft.citations,
      confidence: draft.confidence.toFixed(3),
      riskTier: draft.tier,
      gate: decision.gate,
      routingReason: decision.reason,
      status: "pending_review",
      provider: ctx.provider.label,
      model: ctx.provider.model,
      autopilotLevel: s.level,
      inputHash: draft.inputHash,
    })
    .returning({ id: aiSuggestions.id });
  const id = row!.id;

  await recordEvent(db, {
    ...ids,
    suggestionId: id,
    jobId: ctx.jobId,
    subjectType: draft.subjectType,
    subjectId: draft.subjectId,
    eventType: "suggested",
    actorType: "ai",
    actorUserId: ctx.actorUserId,
    message: `${KIND_LABELS[draft.kind]}: ${draft.title} (confidence ${Math.round(draft.confidence * 100)}%, ${draft.tier} risk)`,
    detail: { provider: ctx.provider.label, model: ctx.provider.model },
  });

  if (decision.mode === "queue") {
    await recordEvent(db, {
      ...ids,
      suggestionId: id,
      eventType: decision.gate ? "held_at_gate" : "queued",
      actorType: "system",
      message: decision.gate ? `Held at gate “${GATE_LABELS[decision.gate]}”. ${decision.reason}` : `Sent to a person. ${decision.reason}`,
    });
    return { id, outcome: "queued", gate: decision.gate, reason: decision.reason };
  }

  try {
    const ref = await withSavepoint(db, "ai_apply", () =>
      applySuggestion(
        db,
        {
          actorUserId: ctx.actorUserId,
          actorType: "ai",
          suggestion: { id, kind: draft.kind, subjectId: draft.subjectId, ...ids, proposed: draft.proposed, provider: ctx.provider.label },
        },
        draft.proposed,
      ),
    );
    await db.update(aiSuggestions).set({ status: "auto_applied", appliedAt: new Date(), resultRef: ref, updatedAt: new Date() }).where(eq(aiSuggestions.id, id));
    await recordEvent(db, { ...ids, suggestionId: id, eventType: "auto_applied", actorType: "ai", actorUserId: ctx.actorUserId, message: `Applied automatically. ${decision.reason}`, detail: { result: ref } });
    return { id, outcome: "applied", gate: null, reason: decision.reason };
  } catch (e) {
    const msg = errMsg(e);
    await db.update(aiSuggestions).set({ status: "failed", applyError: msg, updatedAt: new Date() }).where(eq(aiSuggestions.id, id));
    await recordEvent(db, { ...ids, suggestionId: id, eventType: "apply_failed", actorType: "system", message: `Could not apply automatically: ${msg}` });
    return { id, outcome: "failed", gate: null, reason: msg };
  }
}

export class SuggestionNotPendingError extends Error {
  constructor() {
    super("This suggestion has already been decided.");
    this.name = "SuggestionNotPendingError";
  }
}
export class SuggestionApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuggestionApplyError";
  }
}
export class DecisionNoteRequiredError extends Error {
  constructor() {
    super("A reason is required to reject or override a suggestion.");
    this.name = "DecisionNoteRequiredError";
  }
}

export interface DecideInput {
  suggestionId: string;
  action: "approve" | "override" | "reject";
  finalValue?: Record<string, unknown> | null;
  note?: string | null;
}

/** A person decides a queued suggestion. Applied as THAT person, so their own permissions apply. */
export async function decideSuggestion(db: RequestDb, userId: string, input: DecideInput): Promise<void> {
  const [s] = await db.select().from(aiSuggestions).where(eq(aiSuggestions.id, input.suggestionId)).limit(1);
  if (!s) throw new NotFoundOrForbiddenError();
  if (!(await hasEngagementPermission(db, userId, s.engagementId, "ai.supervise"))) throw new NotFoundOrForbiddenError();
  if (s.gate && !(await hasEngagementPermission(db, userId, s.engagementId, "ai.release"))) throw new NotFoundOrForbiddenError();
  if (s.status !== "pending_review") throw new SuggestionNotPendingError();

  const ids = { tenantId: s.tenantId, organisationId: s.organisationId, engagementId: s.engagementId };
  const note = input.note?.trim() || null;

  if (input.action === "reject") {
    if (!note) throw new DecisionNoteRequiredError();
    await db
      .update(aiSuggestions)
      .set({ status: "rejected", decidedBy: userId, decidedAt: new Date(), decisionNote: note, updatedAt: new Date() })
      .where(eq(aiSuggestions.id, s.id));
    await recordEvent(db, { ...ids, suggestionId: s.id, subjectType: s.subjectType, subjectId: s.subjectId, eventType: "rejected", actorType: "human", actorUserId: userId, message: `Rejected: ${note}` });
    return;
  }

  const overriding = input.action === "override";
  if (overriding && !note) throw new DecisionNoteRequiredError();
  const proposed = overriding ? mergeOverride(s.kind as SuggestionKind, s.proposed as Record<string, unknown>, input.finalValue ?? null) : (s.proposed as Record<string, unknown>);

  let ref: Record<string, unknown>;
  try {
    ref = await withSavepoint(db, "ai_decide", () =>
      applySuggestion(
        db,
        {
          actorUserId: userId,
          actorType: "human",
          suggestion: { id: s.id, kind: s.kind as SuggestionKind, subjectId: s.subjectId, ...ids, proposed: s.proposed as Record<string, unknown>, provider: s.provider },
        },
        proposed,
      ),
    );
  } catch (e) {
    const msg = errMsg(e);
    await db.update(aiSuggestions).set({ applyError: msg, updatedAt: new Date() }).where(eq(aiSuggestions.id, s.id));
    throw new SuggestionApplyError(msg);
  }

  await db
    .update(aiSuggestions)
    .set({
      status: overriding ? "overridden" : "approved",
      decidedBy: userId,
      decidedAt: new Date(),
      decisionNote: note,
      finalValue: overriding ? proposed : null,
      appliedAt: new Date(),
      applyError: null,
      resultRef: ref,
      updatedAt: new Date(),
    })
    .where(eq(aiSuggestions.id, s.id));
  await recordEvent(db, {
    ...ids,
    suggestionId: s.id,
    subjectType: s.subjectType,
    subjectId: s.subjectId,
    eventType: overriding ? "overridden" : "approved",
    actorType: "human",
    actorUserId: userId,
    message: overriding ? `Overridden and applied: ${note}` : `Approved and applied.${note ? ` ${note}` : ""}`,
    detail: { result: ref },
  });
}

export interface BulkResult {
  approved: number;
  failed: Array<{ id: string; title: string; error: string }>;
}

/** Approves many ordinary (non-gated) suggestions; each in its own savepoint. */
export async function approveMany(db: RequestDb, userId: string, ids: string[]): Promise<BulkResult> {
  const result: BulkResult = { approved: 0, failed: [] };
  for (const id of ids) {
    const [s] = await db.select({ title: aiSuggestions.title }).from(aiSuggestions).where(eq(aiSuggestions.id, id)).limit(1);
    try {
      await withSavepoint(db, "ai_bulk", () => decideSuggestion(db, userId, { suggestionId: id, action: "approve" }));
      result.approved++;
    } catch (e) {
      result.failed.push({ id, title: s?.title ?? id, error: errMsg(e) });
    }
  }
  return result;
}

// ------------------------------------------------------------------ reads
export async function requireAiAccess(db: RequestDb, userId: string, engagementId: string): Promise<{ canConfigure: boolean; canRelease: boolean }> {
  const [sup, conf, rel] = await Promise.all([
    hasEngagementPermission(db, userId, engagementId, "ai.supervise"),
    hasEngagementPermission(db, userId, engagementId, "ai.configure"),
    hasEngagementPermission(db, userId, engagementId, "ai.release"),
  ]);
  if (!sup && !conf) throw new NotFoundOrForbiddenError();
  return { canConfigure: conf, canRelease: rel };
}

export type SuggestionRow = typeof aiSuggestions.$inferSelect;

export async function listSuggestions(
  db: RequestDb,
  engagementId: string,
  filter: { status?: SuggestionRow["status"][]; limit?: number } = {},
): Promise<SuggestionRow[]> {
  const where = filter.status?.length
    ? and(eq(aiSuggestions.engagementId, engagementId), inArray(aiSuggestions.status, filter.status))
    : eq(aiSuggestions.engagementId, engagementId);
  return db.select().from(aiSuggestions).where(where).orderBy(desc(aiSuggestions.createdAt)).limit(filter.limit ?? 200);
}

export interface QueueCounts {
  pending: number;
  gated: number;
  autoApplied: number;
  approved: number;
  overridden: number;
  rejected: number;
  failed: number;
}

export async function getQueueCounts(db: RequestDb, engagementId: string): Promise<QueueCounts> {
  const rows = await db
    .select({ status: aiSuggestions.status, gated: sql<boolean>`${aiSuggestions.gate} IS NOT NULL`, n: count() })
    .from(aiSuggestions)
    .where(eq(aiSuggestions.engagementId, engagementId))
    .groupBy(aiSuggestions.status, sql`${aiSuggestions.gate} IS NOT NULL`);
  const c: QueueCounts = { pending: 0, gated: 0, autoApplied: 0, approved: 0, overridden: 0, rejected: 0, failed: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    if (r.status === "pending_review") {
      c.pending += n;
      if (r.gated) c.gated += n;
    } else if (r.status === "auto_applied") c.autoApplied += n;
    else if (r.status === "approved") c.approved += n;
    else if (r.status === "overridden") c.overridden += n;
    else if (r.status === "rejected") c.rejected += n;
    else if (r.status === "failed") c.failed += n;
  }
  return c;
}

export async function listEvents(db: RequestDb, engagementId: string, limit = 100) {
  return db.select().from(aiEvents).where(eq(aiEvents.engagementId, engagementId)).orderBy(desc(aiEvents.createdAt)).limit(limit);
}
