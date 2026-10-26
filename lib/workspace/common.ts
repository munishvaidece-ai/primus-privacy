import "server-only";
import { eq, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { engagements, organisations, users } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission, hasOrganisationPermission, requireEngagementAccess } from "@/lib/authorization/service";

/** A problem with what the person typed or with the state of the record; the message is safe to show. */
export class WorkspaceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceInputError";
  }
}

export type Side = "primus" | "client";

export interface Viewer {
  userId: string;
  email: string | null;
  displayName: string | null;
  /** Client-side user (works for a client organisation) vs Primus practice user. */
  isClient: boolean;
  clientOrgId: string | null;
  side: Side;
}

/** The signed-in user, read from their own `users` row (RLS lets everyone read their own). */
export async function getViewer(db: RequestDb, userId: string): Promise<Viewer> {
  const [row] = await db
    .select({ email: users.email, displayName: users.displayName, clientOrgId: users.clientOrgId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const clientOrgId = row?.clientOrgId ?? null;
  return {
    userId,
    email: row?.email ?? null,
    displayName: row?.displayName ?? null,
    isClient: clientOrgId !== null,
    clientOrgId,
    side: clientOrgId !== null ? "client" : "primus",
  };
}

export interface EngagementRef {
  id: string;
  tenantId: string;
  organisationId: string;
  name: string;
  organisationName: string;
  periodEnd: string | null;
  status: "draft" | "active" | "closed";
}

/** Loads an engagement and proves the caller can access it. Never trusts a browser-supplied organisation id. */
export async function loadEngagement(db: RequestDb, userId: string, engagementId: string): Promise<EngagementRef> {
  const [e] = await db
    .select({
      id: engagements.id,
      tenantId: engagements.tenantId,
      organisationId: engagements.organisationId,
      name: engagements.name,
      organisationName: organisations.name,
      periodEnd: engagements.periodEnd,
      status: engagements.status,
    })
    .from(engagements)
    .innerJoin(organisations, eq(organisations.id, engagements.organisationId))
    .where(eq(engagements.id, engagementId))
    .limit(1);
  if (!e) throw new NotFoundOrForbiddenError();
  await requireEngagementAccess(db, userId, e.id, e.organisationId);
  return e;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function cleanText(value: unknown, label: string, max: number, opts: { required?: boolean } = {}): string {
  const text = String(value ?? "").trim();
  if (opts.required !== false && text.length === 0) throw new WorkspaceInputError(`${label} is required.`);
  if (text.length > max) throw new WorkspaceInputError(`${label} must be at most ${max} characters.`);
  return text;
}

export function parseDate(value: unknown, label: string, opts: { required?: boolean } = {}): string | null {
  const text = String(value ?? "").trim();
  if (!text) {
    if (opts.required) throw new WorkspaceInputError(`${label} is required.`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(text + "T00:00:00Z").getTime())) {
    throw new WorkspaceInputError(`${label} is not a valid date.`);
  }
  return text;
}

/** Whole days from today to a date (negative when overdue). */
export function daysUntil(date: string | Date | null): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date.length === 10 ? date + "T00:00:00Z" : date) : date;
  const today = new Date(todayIso() + "T00:00:00Z");
  return Math.round((d.getTime() - today.getTime()) / 86400_000);
}

export const sqlCount = sql<number>`count(*)::int`;

/** Finds the Postgres error code/message whether or not the driver wrapped the error. */
function pgInfo(err: unknown): { code?: string; message?: string } {
  const e = err as { code?: string; message?: string; cause?: unknown } | null;
  if (!e) return {};
  if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return { code: e.code, message: e.message };
  if (e.cause) return pgInfo(e.cause);
  return {};
}

/**
 * Turns a rule enforced inside the database into the right application error:
 * "not allowed / not found" becomes NotFoundOrForbidden; the database's own
 * plain-language messages for bad input (codes 22023, 23514, 23505, 22P02,
 * and the P0001 raise used by the workspace triggers) become input errors.
 */
export function mapDbError(err: unknown): never {
  if (err instanceof WorkspaceInputError || err instanceof NotFoundOrForbiddenError) throw err;
  const { code, message } = pgInfo(err);
  if (code === "42501") throw new NotFoundOrForbiddenError();
  if (code && ["22023", "23514", "23505", "P0001", "22001"].includes(code) && message) throw new WorkspaceInputError(message);
  throw err;
}

/** Does the person hold this permission on the engagement, either directly or through an organisation-wide role? */
export async function hasPermission(db: RequestDb, userId: string, eng: { id: string; organisationId: string }, key: string): Promise<boolean> {
  return (await hasEngagementPermission(db, userId, eng.id, key)) || (await hasOrganisationPermission(db, userId, eng.organisationId, key));
}
