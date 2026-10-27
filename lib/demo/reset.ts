import "server-only";
import { Pool, type PoolClient } from "pg";
import { isDemoAuthActive } from "@/lib/auth/demo-auth";
import { getEvidenceStorageAdapter } from "@/lib/storage/evidence-storage";
import { FIRM } from "@/lib/demo/orchid/content";

// RESET FOR THE NEXT DEMO
//
// Puts the live-demo firm back to the state it had when it was created: the organisation, the engagement, the people
// and the AI settings stay; everything the demo put in goes (sectors, business units, data map, scope, tests, evidence,
// findings, actions, reports, AI work, uploaded files, notifications). The database connector stays, with its
// "tested" and "scanned" marks cleared, so the scan can be shown again.
//
// This is a deliberate bulk delete, so it is hard to reach by mistake:
//   * it runs only when local demo sign-in is active (never on a real install),
//   * it works only on the one firm this repository invents for the live demo,
//   * it is one transaction: either everything is cleared or nothing is.
// The list of tables is read from the database itself, so a table added later is cleared too.

/** Tables that hold the demo's skeleton and must survive a reset. */
const KEEP_ENGAGEMENT = new Set(["engagement_memberships", "ai_engagement_settings", "ai_connectors", "ai_connector_secrets", "invitations"]);
const KEEP_ORGANISATION = new Set(["organisations", "organisation_memberships", "engagements"]);

export class DemoResetRefused extends Error {}

export interface ResetResult { tables: number; rows: number; files: number }

/**
 * The deletion itself, inside the caller's transaction. Exported so the test can run it on a throwaway database;
 * the guards (demo install only, the one invented firm only) live in resetDemoFirm below.
 */
export async function clearFirmData(c: PoolClient, scope: { organisationId: string; engagementId: string }): Promise<{ tables: number; rows: number; paths: string[] }> {
  const paths: string[] = [];
  let tables = 0;
  let rows = 0;
  const cols = (await c.query<{ table_name: string; column_name: string }>(`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name IN ('engagement_id','organisation_id')`)).rows;
  const byTable = new Map<string, Set<string>>();
  for (const r of cols) byTable.set(r.table_name, (byTable.get(r.table_name) ?? new Set()).add(r.column_name));

  // Rows point at each other in circles (a finding names a task that names the finding), so constraints are
  // switched off for this transaction while every row for this firm is removed together.
  await c.query("SET LOCAL session_replication_role = replica");
  for (const col of ["intake_files", "document_versions"]) {
    const p = await c.query<{ storage_path: string | null }>(`SELECT storage_path FROM ${col} WHERE engagement_id = $1`, [scope.engagementId]);
    for (const r of p.rows) if (r.storage_path) paths.push(r.storage_path);
  }
  const del = async (sqlText: string, id: string) => {
    const res = await c.query(sqlText, [id]);
    if (res.rowCount) { tables += 1; rows += res.rowCount; }
  };
  for (const [table, set] of byTable) {
    if (table === "organisations" || table === "engagements") continue;
    if (set.has("engagement_id") && !KEEP_ENGAGEMENT.has(table)) await del(`DELETE FROM "${table}" WHERE engagement_id = $1`, scope.engagementId);
    // master data and anything else that belongs to the organisation rather than one engagement
    if (set.has("organisation_id") && !KEEP_ORGANISATION.has(table) && !KEEP_ENGAGEMENT.has(table)) await del(`DELETE FROM "${table}" WHERE organisation_id = $1`, scope.organisationId);
  }
  await c.query(`UPDATE ai_connectors SET status = 'configured', last_tested_at = NULL, last_test_ok = NULL, last_test_message = NULL, last_run_at = NULL, updated_at = now() WHERE engagement_id = $1`, [scope.engagementId]);
  return { tables, rows, paths };
}

export async function resetDemoFirm(scope: { organisationId: string; engagementId: string }): Promise<ResetResult> {
  if (!isDemoAuthActive()) throw new DemoResetRefused("Reset is only available on a local demo install.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const c = await pool.connect();
  let out: { tables: number; rows: number; paths: string[] };
  try {
    const org = (await c.query<{ name: string }>("SELECT name FROM organisations WHERE id = $1", [scope.organisationId])).rows[0];
    const eng = (await c.query<{ organisation_id: string }>("SELECT organisation_id FROM engagements WHERE id = $1", [scope.engagementId])).rows[0];
    if (!org || !eng || eng.organisation_id !== scope.organisationId) throw new DemoResetRefused("That engagement was not found.");
    if (org.name !== FIRM.name) throw new DemoResetRefused(`Only ${FIRM.name} can be reset. Other organisations hold data you may want to keep.`);
    await c.query("BEGIN");
    out = await clearFirmData(c, scope);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
  let files = 0;
  const storage = getEvidenceStorageAdapter();
  for (const p of out.paths) {
    try { await storage.remove(p); files += 1; } catch { /* already gone */ }
  }
  return { tables: out.tables, rows: out.rows, files };
}
