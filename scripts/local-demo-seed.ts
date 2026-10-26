// Adds a small set of FICTIONAL demo data so every screen has something to
// show when you try the product locally: a demo client with a readiness
// engagement, an assessment from the starter library, a Primus team and four
// client users. Safe to run again (it does nothing if the demo client exists).
// Not for production: it is only ever run by `npm run local:setup`.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { demoAuthProblem } from "../lib/auth/demo-auth-rules";

const PRIMUS_TEAM = [
  { name: "Priya Nair", email: "priya.nair@primus.local", engagement: "Engagement Manager", tenantRole: "Practice Partner" },
  { name: "Arjun Mehta", email: "arjun.mehta@primus.local", engagement: "Consultant" },
  { name: "Meera Iyer", email: "meera.iyer@primus.local", engagement: "Auditor" },
] as const;
const CLIENT_TEAM = [
  { name: "Asha Verma", email: "asha.verma@democlient.example", org: "Client Administrator" },
  { name: "Rohan Gupta", email: "rohan.gupta@democlient.example", org: "Privacy Officer" },
  { name: "Kabir Shah", email: "kabir.shah@democlient.example", org: "CXO / Executive Viewer" },
  { name: "Neha Joshi", email: "neha.joshi@democlient.example", engagement: "Business Owner" },
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const problem = demoAuthProblem({ ...process.env, NODE_ENV: "development" });
  if (problem) throw new Error(`Refusing to add demo data: ${problem}`);
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    const tenant = (await c.query<{ id: string }>("SELECT id FROM tenants WHERE name = 'Primus Partners'")).rows[0];
    if (!tenant) throw new Error("The practice does not exist yet. Run: npm run local:setup");
    const tenantId = tenant.id;
    if ((await c.query("SELECT 1 FROM organisations WHERE tenant_id = $1 AND name = 'Demo Client Pvt Ltd'", [tenantId])).rowCount) {
      console.log("✓ Demo data already present.");
      return;
    }
    await c.query("BEGIN");
    const role = async (name: string) => {
      const r = await c.query<{ id: string }>("SELECT id FROM roles WHERE name = $1", [name]);
      if (!r.rows[0]) throw new Error(`Role "${name}" is missing (run bootstrap first).`);
      return r.rows[0].id;
    };
    const user = async (name: string, email: string, clientOrgId?: string) => {
      const id = randomUUID();
      const meta: Record<string, string> = { tenant_id: tenantId };
      if (clientOrgId) meta.client_org_id = clientOrgId;
      await c.query("INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ($1,$2,$3::jsonb,$4::jsonb)", [id, email, JSON.stringify(meta), JSON.stringify({ display_name: name })]);
      return id;
    };

    // the library: publish the starter so an assessment can be built from it
    const lib = (await c.query<{ id: string }>("SELECT id FROM control_library_versions WHERE tenant_id = $1 AND version_label LIKE 'DPDP starter%' LIMIT 1", [tenantId])).rows[0];
    if (!lib) throw new Error("The starter control library is missing (bootstrap --starter-library).");
    await c.query("UPDATE control_library_versions SET status = 'published', version_label = 'DPDP starter (demo copy)' WHERE id = $1 AND status <> 'published'", [lib.id]);

    const orgId = (await c.query<{ id: string }>("INSERT INTO organisations (tenant_id, name, industry, hq_location) VALUES ($1,'Demo Client Pvt Ltd','Financial services','Mumbai') RETURNING id", [tenantId])).rows[0]!.id;
    const engId = (await c.query<{ id: string }>("INSERT INTO engagements (tenant_id, organisation_id, name, engagement_type, status, control_library_version_id) VALUES ($1,$2,'DPDP readiness FY2026-27','readiness','active',$3) RETURNING id", [tenantId, orgId, lib.id])).rows[0]!.id;

    // The administrator made by bootstrap works every engagement end to end.
    const admin = (await c.query<{ id: string }>("SELECT id FROM auth.users WHERE email = 'admin@primus.local'")).rows[0];
    if (admin) await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [admin.id, engId, await role("Engagement Manager")]);

    
    for (const p of PRIMUS_TEAM) {
      const id = await user(p.name, p.email);
      if ("tenantRole" in p) await c.query("INSERT INTO tenant_memberships (user_id, tenant_id, role_id) VALUES ($1,$2,$3)", [id, tenantId, await role(p.tenantRole)]);
      await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [id, engId, await role(p.engagement)]);
    }
    for (const p of CLIENT_TEAM) {
      const id = await user(p.name, p.email, orgId);
      if ("org" in p) await c.query("INSERT INTO organisation_memberships (user_id, organisation_id, role_id) VALUES ($1,$2,$3)", [id, orgId, await role(p.org)]);
      else await c.query("INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1,$2,$3)", [id, engId, await role(p.engagement)]);
    }

    // an assessment over every starter control, nothing answered yet (a row
    // appears when someone answers, exactly as in real use)
    const asId = (await c.query<{ id: string }>("INSERT INTO assessments (engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label) VALUES ($1,$2,$3,$4,'control_readiness','FY2026-27') RETURNING id", [engId, orgId, tenantId, lib.id])).rows[0]!.id;
    const controls = await c.query<{ id: string }>("SELECT id FROM controls WHERE control_library_version_id = $1 ORDER BY code", [lib.id]);
    for (const ctl of controls.rows) {
      await c.query("INSERT INTO assessment_controls (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id) VALUES ($1,$2,$3,$4,$5,$6) ", [asId, ctl.id, tenantId, orgId, engId, lib.id]);
    }

    // two findings: one already shared with the client, one still a private draft
    await c.query("INSERT INTO findings (engagement_id, organisation_id, tenant_id, title, description, severity, released_at) VALUES ($1,$2,$3,'No documented retention schedule','Personal data is kept without defined periods for erasure.','high', now())", [engId, orgId, tenantId]);
    await c.query("INSERT INTO findings (engagement_id, organisation_id, tenant_id, title, description, severity) VALUES ($1,$2,$3,'Breach response plan untested','The plan exists but has never been rehearsed (DRAFT: not yet released to the client).','medium')", [engId, orgId, tenantId]);

    await c.query("COMMIT");
    console.log(`✓ Demo data added: "Demo Client Pvt Ltd" with ${controls.rows.length} controls, ${PRIMUS_TEAM.length + 1} Primus users, ${CLIENT_TEAM.length} client users, 2 findings (one draft).`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message ?? e}`);
  process.exit(1);
});
