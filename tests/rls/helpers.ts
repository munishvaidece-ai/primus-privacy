// Test harness for the RLS suite. Connects as the local Postgres
// superuser (fixture setup, bypasses RLS unconditionally) and provides
// `asUser`/`asAnon` to run assertions under real RLS enforcement by
// switching the session's effective role, exactly as Supabase's own
// request layer does per-request (SET ROLE + the request.jwt.claim.sub
// GUC that auth.uid() reads) — see scripts/local-dev-auth-shim.sql.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const connectionString =
  process.env.TEST_DATABASE_SUPERUSER_URL ??
  "postgres://postgres:postgres@localhost:5432/primus_privacy_test";

export const pool = new Pool({ connectionString });

/** Runs `fn` as the given authenticated user (RLS fully enforced), inside
 * a transaction that is always rolled back afterward so tests never leak
 * state into one another. Returns fn's result, or lets fn's thrown error
 * propagate (the caller asserts on success/failure). */
export async function asUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await fn(client);
    return result;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

/**
 * P2B.4: opens a real, independent connection already `BEGIN`-ed and
 * `SET LOCAL ROLE authenticated` with `userId`'s own `auth.uid()` claim
 * — the caller controls `COMMIT`/`ROLLBACK` itself. `asUser` above
 * cannot express a genuine concurrency test (two independent
 * transactions racing each other, where at least one must actually
 * commit to observe a real outcome): it always rolls back at the end of
 * its own single callback, on a single connection. This is the smallest
 * extension needed to hold a transaction open across multiple awaited
 * steps on its OWN connection — e.g. two of these, fired concurrently,
 * both attempting `accept_invitation()` for the same token. The caller
 * MUST end the transaction itself and always call `client.release()`
 * when done (mirrors `pool.connect()`'s own usage contract).
 */
export async function beginAsUser(userId: string): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
  return client;
}

/** Runs `fn` as an unauthenticated (anon) request — no JWT claim at all. */
export async function asAnon<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE anon");
    const result = await fn(client);
    return result;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

/** Runs `fn` as the Postgres superuser (fixture setup only — bypasses
 * RLS and every GRANT check, exactly as service_role does via BYPASSRLS
 * in real Supabase, except more so since this is a true superuser). Each
 * call is its own transaction, committed, so fixtures persist for
 * subsequent asUser/asAnon calls in the same test. */
export async function asFixtureSetup<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// --- Fixture builders --------------------------------------------------

export async function createTenant(client: PoolClient, name: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO tenants (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return rows[0]!.id;
}

export async function createOrganisation(client: PoolClient, tenantId: string, name: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO organisations (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, name],
  );
  return rows[0]!.id;
}

export async function createEngagement(
  client: PoolClient,
  tenantId: string,
  organisationId: string,
  name: string,
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type)
     VALUES ($1, $2, $3, 'readiness') RETURNING id`,
    [tenantId, organisationId, name],
  );
  return rows[0]!.id;
}

/** Creates an auth.users row (firing the provisioning trigger, which
 * creates the matching public.users row) and returns the user id. */
export async function createUser(
  client: PoolClient,
  opts: { tenantId: string; clientOrgId?: string; email?: string },
) {
  const id = randomUUID();
  const email = opts.email ?? `${id}@example.test`;
  const appMeta: Record<string, string> = { tenant_id: opts.tenantId };
  if (opts.clientOrgId) appMeta.client_org_id = opts.clientOrgId;
  await client.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)`,
    [id, email, JSON.stringify(appMeta)],
  );
  return id;
}

export async function getOrCreateRole(client: PoolClient, name: string) {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM roles WHERE name = $1`, [name]);
  if (rows[0]) return rows[0].id;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO roles (name, scope) VALUES ($1, 'engagement') RETURNING id`,
    [name],
  );
  return inserted.rows[0]!.id;
}

export async function grantTenantMembership(
  client: PoolClient,
  userId: string,
  tenantId: string,
  roleName = "Practice Partner",
) {
  const roleId = await getOrCreateRole(client, roleName);
  await client.query(
    `INSERT INTO tenant_memberships (user_id, tenant_id, role_id) VALUES ($1, $2, $3)`,
    [userId, tenantId, roleId],
  );
}

export async function grantOrganisationMembership(
  client: PoolClient,
  userId: string,
  organisationId: string,
  roleName = "Client Administrator",
) {
  const roleId = await getOrCreateRole(client, roleName);
  await client.query(
    `INSERT INTO organisation_memberships (user_id, organisation_id, role_id) VALUES ($1, $2, $3)`,
    [userId, organisationId, roleId],
  );
}

export async function grantEngagementMembership(
  client: PoolClient,
  userId: string,
  engagementId: string,
  roleName = "Consultant",
) {
  const roleId = await getOrCreateRole(client, roleName);
  await client.query(
    `INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1, $2, $3)`,
    [userId, engagementId, roleId],
  );
}
