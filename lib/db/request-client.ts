import "server-only";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

// The application's own connection pool. Per ARCHITECTURE.md §3/§7: only
// server processes hold this credential; it is never referenced from a
// Client Component. `DATABASE_URL` is documented in .env.example.
//
// Known limitation (see PROGRESS.md): in a real deployed Supabase
// project, this connection would normally use the `authenticator` role
// Supabase provisions — a LOGIN role restricted to `SET ROLE anon /
// authenticated / service_role` and nothing else. No Supabase project has
// ever been provisioned for this repository (DECISIONS.md D-03), so
// `DATABASE_URL` in every environment this project has actually run in
// points at the local Postgres superuser, exactly like every migration/
// seed script since Milestone 1. This does NOT weaken RLS enforcement for
// the actual code paths below — every function in this module
// unconditionally executes `SET LOCAL ROLE authenticated`/`anon` (plus the
// `request.jwt.claim.sub` GUC `auth.uid()` reads) before running a single
// domain query, so RLS is genuinely, independently re-checked on every
// request. It does mean the connection's own *ceiling* privilege is
// broader than a production `authenticator` role would allow — the same
// gap PROGRESS.md's own production-readiness section already tracks for
// every earlier milestone's dev/test tooling, not a new one this slice
// introduces.
let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set. See .env.example.");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export type RequestDb = ReturnType<typeof drizzle<typeof schema, PoolClient>>;

/**
 * Opens one Postgres connection for the lifetime of `fn`, sets the
 * session's effective role to `authenticated` (with the
 * `request.jwt.claim.sub` GUC `auth.uid()` reads set to `userId`) or to
 * `anon` when `userId` is null — the exact mechanism Supabase's own
 * request layer uses in production, and the same one
 * `tests/rls/helpers.ts`'s `asUser`/`asAnon` have exercised since
 * Milestone 1 (see `scripts/local-dev-auth-shim.sql`). Every RLS policy
 * written since Milestone 1 therefore applies to `fn`'s queries
 * unchanged — this function does not implement a second authorization
 * mechanism, it is the first real caller of the existing one.
 *
 * Commits on success (this is real application traffic, not a test
 * fixture — contrast with `asFixtureSetup`/`asUser`'s rollback-always
 * test posture) and rolls back on any thrown error, so a failed mutation
 * never partially applies.
 */
export async function withRequestDb<T>(
  userId: string | null,
  fn: (db: RequestDb, client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (userId) {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    } else {
      await client.query("SET LOCAL ROLE anon");
    }
    const db = drizzle(client, { schema });
    const result = await fn(db, client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
