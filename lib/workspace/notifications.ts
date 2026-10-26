import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { notifications } from "@/db/schema";

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
  engagementId: string | null;
}

/** The caller's own notifications, newest first. RLS limits this to their own rows. */
export async function listNotifications(db: RequestDb, userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationRow[]> {
  const conds = [eq(notifications.userId, userId)];
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  return db
    .select({ id: notifications.id, kind: notifications.kind, title: notifications.title, body: notifications.body, link: notifications.link, readAt: notifications.readAt, createdAt: notifications.createdAt, engagementId: notifications.engagementId })
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 100);
}

export async function unreadCount(db: RequestDb, userId: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(r?.n ?? 0);
}

export async function markRead(db: RequestDb, userId: string, id: string): Promise<void> {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function markAllRead(db: RequestDb, userId: string): Promise<number> {
  const rows = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).returning({ id: notifications.id });
  return rows.length;
}
