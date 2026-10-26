// Creates the AI agent user (one per tenant) if it does not exist yet.
// Idempotent. Needs DATABASE_URL pointing at a role allowed to insert into
// auth.users (Supabase: the `postgres` role).
//   npm run ai:provision-agent
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

async function main() {
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString: cs });
  try {
    const tenants = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM tenants`);
    if (tenants.rows.length === 0) console.log("No tenants exist yet; create your tenant first, then re-run.");
    for (const t of tenants.rows) {
      const email = `ai-agent@${t.id}.agent.primus.invalid`;
      const exists = await pool.query(`SELECT 1 FROM auth.users WHERE email = $1`, [email]);
      if (exists.rowCount) {
        console.log(`tenant ${t.name}: AI agent already provisioned`);
        continue;
      }
      await pool.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
         VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
        [randomUUID(), email, JSON.stringify({ tenant_id: t.id }), JSON.stringify({ display_name: "Primus AI Agent" })],
      );
      console.log(`tenant ${t.name}: AI agent provisioned (${email}) — it cannot sign in; it only acts through the worker`);
    }
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
