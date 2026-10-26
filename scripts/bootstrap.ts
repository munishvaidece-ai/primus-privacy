// First-time (and repeatable) setup of a deployment. Idempotent: running it
// again changes nothing that already exists.
//
//   npm run bootstrap -- --tenant "Primus Partners" --admin-email you@firm.com [--starter-library]
//
// It: (1) creates your practice (tenant), (2) loads the role & permission
// list, (3) provisions the AI agent user, (4) creates a starter risk scoring
// model if the practice has none, (5) optionally loads the DRAFT starter
// control library, and (6) creates the first administrator (Platform Administrator).
//
// Administrator creation:
//  - If NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, the
//    user is created through Supabase Auth's admin API with the password in
//    BOOTSTRAP_ADMIN_PASSWORD (change it after first sign-in). This path is
//    written to the documented API but has NOT been run against a live
//    Supabase project by the author.
//  - Otherwise (local development with the auth shim) a profile is inserted
//    directly; that user cannot sign in.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { STARTER_CONTROLS, STARTER_REFERENCES } from "../db/seed/starter-library";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

// A plain 5×5 likelihood × impact matrix. The practice can add its own
// model later; the AI uses whichever one is active.
const MATRIX = {
  scale: "1-5",
  dimensions: ["likelihood", "impact"],
  bands: [
    { name: "low", min: 1, max: 4 },
    { name: "medium", min: 5, max: 9 },
    { name: "high", min: 10, max: 15 },
    { name: "critical", min: 16, max: 25 },
  ],
  note: "Score = likelihood × impact. Starter model created by the bootstrap script; review it.",
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const tenantName = arg("tenant");
  if (!tenantName) throw new Error('Pass --tenant "Your practice name".');
  const pool = new Pool({ connectionString: url });
  try {
    // 1. tenant
    let tenantId: string;
    const found = await pool.query<{ id: string }>("SELECT id FROM tenants WHERE name = $1", [tenantName]);
    if (found.rows[0]) {
      tenantId = found.rows[0].id;
      console.log(`✓ Practice "${tenantName}" already exists.`);
    } else {
      tenantId = (await pool.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [tenantName])).rows[0]!.id;
      console.log(`✓ Practice "${tenantName}" created.`);
    }

    // 2. roles & permissions
    execFileSync("npx", ["tsx", "db/seed/roles.ts"], { stdio: "inherit", env: process.env });

    // 3. AI agent
    execFileSync("npx", ["tsx", "--require", "./scripts/preload-server-only.cjs", "scripts/provision-ai-agent.ts"], { stdio: "inherit", env: process.env });

    // 4. risk scoring model
    const model = await pool.query("SELECT 1 FROM risk_scoring_models WHERE tenant_id = $1 AND is_active", [tenantId]);
    if (model.rowCount) console.log("✓ An active risk scoring model already exists.");
    else {
      await pool.query(`INSERT INTO risk_scoring_models (tenant_id, name, version, matrix_definition, is_active) VALUES ($1, 'Likelihood × impact (5×5)', 'v1', $2::jsonb, true)`, [tenantId, JSON.stringify(MATRIX)]);
      console.log("✓ Starter risk scoring model created (review it).");
    }

    // 5. starter library (draft)
    if (flag("starter-library")) {
      const label = "DPDP starter (DRAFT — review before publishing)";
      const have = await pool.query("SELECT 1 FROM control_library_versions WHERE tenant_id = $1 AND version_label LIKE 'DPDP starter%'", [tenantId]);
      if (have.rowCount) console.log("✓ Starter control library already loaded.");
      else {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const lib = (await c.query<{ id: string }>("INSERT INTO control_library_versions (tenant_id, version_label) VALUES ($1, $2) RETURNING id", [tenantId, label])).rows[0]!.id;
          const refIds = new Map<string, string>();
          for (const r of STARTER_REFERENCES) {
            const row = await c.query<{ id: string }>(
              `INSERT INTO regulatory_references (tenant_id, framework_name, citation, title, version) VALUES ($1, 'Digital Personal Data Protection Act, 2023', $2, $3, '2023') RETURNING id`,
              [tenantId, r.citation, r.title],
            );
            refIds.set(r.citation, row.rows[0]!.id);
          }
          for (const k of STARTER_CONTROLS) {
            const ctl = await c.query<{ id: string }>(
              `INSERT INTO controls (tenant_id, control_library_version_id, code, title, control_type, description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
              [tenantId, lib, k.code, k.title, k.type, k.description],
            );
            const req = await c.query<{ id: string }>(
              `INSERT INTO requirements (tenant_id, primary_regulatory_reference_id, title, description) VALUES ($1,$2,$3,$4) RETURNING id`,
              [tenantId, refIds.get(k.ref)!, k.title, k.description],
            );
            await c.query(`INSERT INTO control_requirements (tenant_id, control_id, requirement_id) VALUES ($1,$2,$3)`, [tenantId, ctl.rows[0]!.id, req.rows[0]!.id]);
          }
          await c.query("COMMIT");
          console.log(`✓ Starter control library loaded as a DRAFT with ${STARTER_CONTROLS.length} controls. Review it, then publish it under Methodology → Control Library.`);
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      }
    }

    // 6. first administrator
    const email = arg("admin-email");
    if (email) {
      let userId: string | null = (await pool.query<{ id: string }>("SELECT id FROM auth.users WHERE lower(email) = lower($1)", [email])).rows[0]?.id ?? null;
      if (!userId) {
        const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supaUrl && serviceKey) {
          const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
          if (!password || password.length < 12) throw new Error("Set BOOTSTRAP_ADMIN_PASSWORD (at least 12 characters) to create the first administrator. Change it after first sign-in.");
          const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
          const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { tenant_id: tenantId }, user_metadata: { display_name: arg("admin-name") ?? "Administrator" } });
          if (error || !data.user) throw new Error(`Supabase could not create the administrator: ${error?.message}`);
          userId = data.user.id;
          console.log(`✓ Administrator ${email} created in Supabase Auth.`);
        } else {
          userId = randomUUID();
          await pool.query("INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ($1,$2,$3::jsonb,$4::jsonb)", [userId, email, JSON.stringify({ tenant_id: tenantId }), JSON.stringify({ display_name: arg("admin-name") ?? "Administrator" })]);
          console.log(`✓ Administrator profile ${email} created (local development, no Supabase: sign in with the demo sign-in page, or connect Supabase for real sign-in).`);
        }
      }
      // One active tenant membership per person: Platform Administrator
      // already includes everything Practice Partner can do.
      const has = await pool.query("SELECT 1 FROM tenant_memberships WHERE user_id = $1 AND tenant_id = $2 AND status = 'active'", [userId, tenantId]);
      if (!has.rowCount) {
        await pool.query(
          `INSERT INTO tenant_memberships (user_id, tenant_id, role_id) SELECT $1, $2, r.id FROM roles r WHERE r.name = 'Platform Administrator'`,
          [userId, tenantId],
        );
      }
      console.log(`✓ ${email} is a Platform Administrator.`);
    } else {
      console.log("• No --admin-email given: no administrator was created.");
    }
    console.log("\nDone. Next: sign in, create the client organisation and engagement, add yourself as Engagement Manager, then open the engagement's AI Operations Centre.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
