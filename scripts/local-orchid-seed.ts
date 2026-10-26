// Creates the FICTIONAL broking firm used for the end-to-end live demo: Orchid Hill Securities Limited.
// Unlike the three older demo firms it starts EMPTY: an organisation, an engagement and people, nothing else.
// Everything else (sectors, business units, systems, controls in scope, tests, evidence, findings, actions)
// is put in during the demo, by uploading the files in the demo pack and letting the AI work.
//
// Safe to run again (does nothing if the firm exists). Only ever run by `npm run local:setup`.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { demoAuthProblem } from "../lib/auth/demo-auth-rules";
import { FIRM } from "../lib/demo/orchid/content";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const problem = demoAuthProblem({ ...process.env, NODE_ENV: "development" });
  if (problem) throw new Error(`Refusing to add demo data: ${problem}`);
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  let created: { org: string; eng: string; admin: string } | null = null;
  try {
    const tenant = (await c.query<{ id: string }>("SELECT id FROM tenants WHERE name = 'Primus Partners'")).rows[0];
    if (!tenant) throw new Error("The practice does not exist yet. Run: npm run local:setup");
    const tenantId = tenant.id;
    if ((await c.query("SELECT 1 FROM organisations WHERE tenant_id = $1 AND name = $2", [tenantId, FIRM.name])).rowCount) {
      console.log("✓ Orchid Hill (live demo firm) already present.");
      return;
    }
    const lib = (await c.query<{ id: string }>("SELECT id FROM control_library_versions WHERE tenant_id = $1 AND status = 'published' ORDER BY created_at LIMIT 1", [tenantId])).rows[0];
    if (!lib) throw new Error("No published control library. Run the full setup first (npm run local:setup).");
    const admin = (await c.query<{ id: string }>("SELECT id FROM auth.users WHERE email = 'admin@primus.local'")).rows[0];
    if (!admin) throw new Error("The demo administrator is missing. Run the full setup first.");
    const arjun = (await c.query<{ id: string }>("SELECT id FROM auth.users WHERE email = 'arjun.mehta@primus.local'")).rows[0];
    const role = async (name: string) => {
      const r = await c.query<{ id: string }>("SELECT id FROM roles WHERE name = $1", [name]);
      if (!r.rows[0]) throw new Error(`Role "${name}" is missing.`);
      return r.rows[0].id;
    };
    await c.query("BEGIN");
    const org = (await c.query<{ id: string }>("INSERT INTO organisations (tenant_id, name, industry, hq_location) VALUES ($1,$2,$3,$4) RETURNING id", [tenantId, FIRM.name, FIRM.industry, FIRM.hq])).rows[0]!.id;
    const eng = (await c.query<{ id: string }>("INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type, status, control_library_version_id) VALUES ($1,$2,$3,'readiness','active',$4) RETURNING id", [tenantId, org, FIRM.engagement, lib.id])).rows[0]!.id;
    await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [admin.id, eng, await role("Engagement Manager")]);
    if (arjun) await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [arjun.id, eng, await role("Consultant")]);
    for (const p of FIRM.team) {
      const id = randomUUID();
      await c.query("INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ($1,$2,$3::jsonb,$4::jsonb)", [id, p.email, JSON.stringify({ tenant_id: tenantId, client_org_id: org }), JSON.stringify({ display_name: p.name })]);
      await c.query("INSERT INTO organisation_memberships (user_id, organisation_id, role_id) VALUES ($1,$2,$3)", [id, org, await role(p.org)]);
    }
    await c.query("COMMIT");
    created = { org, eng, admin: admin.id };
    console.log(`✓ Added ${FIRM.name}: an empty engagement, ${FIRM.team.length} client people and the Primus team, ready for the live demo.`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
  if (created) {
    // switch the AI on at "Full autopilot" with the sign-off gates on, so the demo shows both what it does alone and where it stops
    const { withRequestDb } = await import("../lib/db/request-client");
    const { saveAiSettings } = await import("../lib/ai/settings");
    await withRequestDb(created.admin, (db) =>
      saveAiSettings(db, created!.admin, {
        engagementId: created!.eng, organisationId: created!.org, enabled: true, level: 3, thresholdSupervised: 0.9, thresholdFull: 0.75,
        gates: { rejectCriticalEvidence: true, releaseCriticalFindings: true, issueFinalReport: true, sendBreachNotices: true }, allowExternalAi: false,
      }),
    );
    console.log("✓ AI switched on for Orchid Hill (Full autopilot, sign-off gates on).");
    // the PostgreSQL connector, pointed at the fictional back-office database (read-only; the AI worker runs the scan)
    const { createConnector } = await import("../lib/connectors/service");
    const { sampleDbUrl } = await import("../lib/demo/orchid/sample-db");
    await withRequestDb(created.admin, (db) =>
      createConnector(db, created!.admin, { engagementId: created!.eng, organisationId: created!.org }, {
        type: "postgres_database",
        name: "Orchid Hill back-office database",
        config: { sampleRows: "50" },
        secret: { connectionString: sampleDbUrl(url) },
      }),
    );
    console.log("✓ Connector added: Orchid Hill back-office database (fictional, read-only).");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message ?? e}`);
  process.exit(1);
});
