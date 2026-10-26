import "server-only";
import { sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";

export interface EmitInput {
  engagementId: string;
  kind: string;
  /** One sentence, e.g. "Ananya Rao released 3 findings." */
  summary: string;
  subjectType?: string;
  subjectId?: string;
  /** Show this line in the client's activity feed too. */
  clientVisible?: boolean;
  /** Also drop an in-app notification into these people's inbox. */
  notify?: { audience: "practice" | "client" | "all"; title: string; body?: string; link?: string };
}

/**
 * Records one line in the engagement's activity feed and, optionally, notifies
 * colleagues. Both go through database functions that re-check the caller's
 * access; a failure here must never undo the real action, so each call runs in
 * its own savepoint and any error is logged and swallowed.
 */
export async function emit(db: RequestDb, input: EmitInput): Promise<void> {
  // A raw SAVEPOINT, not db.transaction(): the request is already inside one
  // transaction, and a nested BEGIN/COMMIT would end it early.
  await db.execute(sql`savepoint workspace_emit`);
  try {
    await db.execute(
      sql`select public.record_activity(${input.engagementId}::uuid, ${input.kind}, ${input.summary}, ${input.subjectType ?? null}, ${input.subjectId ?? null}::uuid, ${input.clientVisible ?? false})`,
    );
    if (input.notify) {
      await db.execute(
        sql`select public.notify_engagement(${input.engagementId}::uuid, ${input.notify.audience}, ${input.kind}, ${input.notify.title}, ${input.notify.body ?? null}, ${input.notify.link ?? null}, true)`,
      );
    }
    await db.execute(sql`release savepoint workspace_emit`);
  } catch (err) {
    console.error("workspace emit failed", err);
    await db.execute(sql`rollback to savepoint workspace_emit`);
    await db.execute(sql`release savepoint workspace_emit`);
  }
}

export async function actorName(db: RequestDb, userId: string): Promise<string> {
  const r = await db.execute<{ n: string | null }>(sql`select coalesce(nullif(display_name, ''), email) as n from users where id = ${userId}::uuid`);
  return r.rows[0]?.n ?? "Someone";
}
