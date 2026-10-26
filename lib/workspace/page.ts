import "server-only";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb, type RequestDb } from "@/lib/db/request-client";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { AssessmentFinalizedError } from "@/lib/domain/assessments";
import { WorkspaceInputError, getViewer, mapDbError, type Viewer } from "./common";
import { engagementMetrics, type EngagementMetrics } from "./portfolio";

export interface PageCtx {
  db: RequestDb;
  user: AuthenticatedUser;
  viewer: Viewer;
}

/** Signs the user in and runs the page's reads in one request-scoped transaction. */
export async function loadPage<T>(fn: (ctx: PageCtx) => Promise<T>): Promise<{ user: AuthenticatedUser; viewer: Viewer; data: T }> {
  const user = await requireAuthenticatedUser();
  return withRequestDb(user.id, async (db) => {
    const viewer = await getViewer(db, user.id);
    try {
      const data = await fn({ db, user, viewer });
      return { user, viewer, data };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });
}

export function withFlag(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/** A message that is safe to show, for the errors the screens expect. */
export function friendlyError(err: unknown): string {
  let e = err;
  try {
    mapDbError(err);
  } catch (mapped) {
    e = mapped;
  }
  if (e instanceof WorkspaceInputError) return e.message;
  if (e instanceof NotFoundOrForbiddenError) return "You do not have permission to do that, or it no longer exists.";
  if (e instanceof AssessmentFinalizedError) return e.message;
  const named = e as { name?: string; message?: string };
  if (named && typeof named.name === "string" && /Error$/.test(named.name) && named.name !== "Error" && named.name !== "DrizzleQueryError" && typeof named.message === "string" && !/(violates|constraint|relation|syntax|column)/i.test(named.message)) {
    return named.message;
  }
  console.error("workspace action failed", err);
  return "Something went wrong. Please try again.";
}

/**
 * Runs one form action: signs in, runs `fn` in a transaction, then sends the
 * person back to `path` with a green or red message. Never lets a database
 * message through.
 */
export async function act(path: string, fn: (ctx: PageCtx) => Promise<string | void>, okMessage = "1"): Promise<never> {
  const user = await requireAuthenticatedUser();
  let error: string | null = null;
  let ok = okMessage;
  try {
    const out = await withRequestDb(user.id, async (db) => {
      const viewer = await getViewer(db, user.id);
      return fn({ db, user, viewer });
    });
    if (typeof out === "string") ok = out;
  } catch (err) {
    error = friendlyError(err);
  }
  revalidatePath(path.split("?")[0]!);
  redirect(error ? withFlag(path, "error", error) : withFlag(path, "saved", ok));
}

export const uuidOr = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);
export const formString = (fd: FormData, key: string): string => String(fd.get(key) ?? "");

// ---------------------------------------------------------------------------
// The client portal works on one engagement at a time. The person picks it
// with ?e=<id>; the default is the first active engagement they can see.
// ---------------------------------------------------------------------------
export interface PortalCtx extends PageCtx {
  engagements: EngagementMetrics[];
  current: EngagementMetrics;
  /** Appended to portal links so the chosen engagement is kept. */
  q: string;
}

export async function loadPortal<T>(searchParams: { e?: string }, fn: (ctx: PortalCtx) => Promise<T>): Promise<{ user: AuthenticatedUser; viewer: Viewer; portal: PortalCtx; data: T }> {
  const r = await loadPage(async (ctx) => {
    const engagements = await engagementMetrics(ctx.db);
    if (engagements.length === 0) return { empty: true as const };
    const wanted = uuidOr(searchParams.e);
    const current = engagements.find((e) => e.id === wanted) ?? engagements.find((e) => e.status === "active") ?? engagements[0]!;
    const portal: PortalCtx = { ...ctx, engagements, current, q: engagements.length > 1 ? `?e=${current.id}` : "" };
    return { empty: false as const, portal, data: await fn(portal) };
  });
  if (r.data.empty) {
    redirect("/portal/none");
  }
  return { user: r.user, viewer: r.viewer, portal: r.data.portal, data: r.data.data };
}

export function portalPath(base: string, engagementId: string, extra?: string): string {
  return withFlag(base, "e", engagementId) + (extra ? `&${extra}` : "");
}
