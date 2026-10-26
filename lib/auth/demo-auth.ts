import "server-only";
import { cookies } from "next/headers";
import { Pool } from "pg";
import { demoAuthProblem } from "@/lib/auth/demo-auth-rules";

// ============================================================================
// LOCAL DEMO SIGN-IN — for trying the product on your own computer only.
//
// When LOCAL_DEMO_AUTH=true, the login page lists the people in your local
// database and signing in is one click, with no password. It exists so the
// product can be tested end to end before Supabase sign-in is connected.
//
// It is deliberately hard to leave switched on by mistake. It works ONLY when
// ALL of these hold, and otherwise the app refuses to run (it never quietly
// falls back to "anyone can sign in"):
//   * LOCAL_DEMO_AUTH is exactly "true"
//   * NODE_ENV is not "production"   (npm run dev; never npm start / Docker image)
//   * DATABASE_URL points at this computer (localhost / 127.0.0.1 / ::1)
//   * no Supabase project is configured (NEXT_PUBLIC_SUPABASE_URL is empty)
//
// Remove LOCAL_DEMO_AUTH from the environment and the real Supabase sign-in
// (lib/auth/actions.ts) is what runs. Nothing else changes.
// ============================================================================

export const DEMO_COOKIE = "primus_demo_user";

export class DemoAuthMisconfiguredError extends Error {
  constructor(reason: string) {
    super(`LOCAL_DEMO_AUTH is switched on but cannot be used: ${reason} Remove LOCAL_DEMO_AUTH from the environment to use the real sign-in.`);
    this.name = "DemoAuthMisconfiguredError";
  }
}

/** True when the person asked for demo sign-in AND it is safe. Throws if they asked but it is not safe. */
export function isDemoAuthActive(): boolean {
  if (process.env.LOCAL_DEMO_AUTH !== "true") return false;
  const problem = demoAuthProblem(process.env);
  if (problem) throw new DemoAuthMisconfiguredError(problem);
  return true;
}

let pool: Pool | undefined;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DemoUser {
  id: string;
  email: string;
  displayName: string | null;
  side: "primus" | "client";
  roles: string[];
}

/** Everyone who can be signed in as, Primus team first. The AI agent user is never offered. */
export async function listDemoUsers(): Promise<DemoUser[]> {
  const r = await db().query<{ id: string; email: string; display_name: string | null; client_org_id: string | null; roles: string[] | null }>(`
    SELECT u.id, u.email, u.display_name, u.client_org_id,
           ARRAY(
             SELECT r.name FROM roles r WHERE r.id IN (
               SELECT role_id FROM tenant_memberships WHERE user_id = u.id AND status = 'active'
               UNION SELECT role_id FROM organisation_memberships WHERE user_id = u.id AND status = 'active'
               UNION SELECT role_id FROM engagement_memberships WHERE user_id = u.id AND status = 'active')
             ORDER BY r.name) AS roles
      FROM users u
     WHERE u.email NOT LIKE 'ai-agent@%.agent.primus.invalid'
     ORDER BY (u.client_org_id IS NOT NULL), u.created_at, u.email`);
  return r.rows.map((x) => ({ id: x.id, email: x.email, displayName: x.display_name, side: x.client_org_id ? "client" : "primus", roles: x.roles ?? [] }));
}

export async function findDemoUser(id: string): Promise<{ id: string; email: string | null } | null> {
  if (!UUID.test(id)) return null;
  const r = await db().query<{ id: string; email: string | null }>("SELECT id, email FROM users WHERE id = $1 AND email NOT LIKE 'ai-agent@%.agent.primus.invalid'", [id]);
  return r.rows[0] ?? null;
}

/** The user chosen on the demo login page, or null. */
export async function getDemoSessionUser(): Promise<{ id: string; email: string | null } | null> {
  const id = cookies().get(DEMO_COOKIE)?.value;
  return id ? findDemoUser(id) : null;
}

