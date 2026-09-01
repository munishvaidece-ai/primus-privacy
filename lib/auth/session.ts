import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthenticatedUser {
  /** Supabase `auth.users.id` — identical to `public.users.id`
   * (db/schema/users.ts: "`id` IS `auth.users.id`"). */
  id: string;
  email: string | null;
}

/** The minimal shape `getAuthenticatedUser` needs from a Supabase Auth
 * client — narrower than the full `SupabaseClient` type so this module's
 * own control flow (not the Supabase SDK itself) is what a unit test
 * exercises when it passes a stand-in satisfying this interface. See
 * tests/app/session.test.ts for exactly what is and is not covered by
 * such a test, and PROGRESS.md for why: no live Supabase Auth backend
 * (cloud or local) is reachable from this environment (DECISIONS.md
 * D-03), so the real `supabase.auth.getUser()` network call cannot be
 * exercised end-to-end here. */
export interface SupabaseAuthClientLike {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: unknown;
    }>;
  };
}

/**
 * Resolves the current request's authenticated user, or `null` if there
 * is none. Always calls `auth.getUser()` (re-validates the session
 * against Supabase Auth), never merely decodes a cookie — the same
 * "never trusts a user id passed from the client" posture SECURITY.md §1
 * requires.
 */
export async function getAuthenticatedUser(
  client?: SupabaseAuthClientLike,
): Promise<AuthenticatedUser | null> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Resolves the current user or redirects to `/login` — the single
 * reusable "is this page protected" check every authenticated route
 * calls, so no page independently reinvents the redirect logic (PHASE A
 * instructions §5).
 */
export async function requireAuthenticatedUser(
  client?: SupabaseAuthClientLike,
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(client);
  if (!user) {
    redirect("/login");
  }
  return user;
}
