// Applies the SQL files in drizzle/migrations/ in filename order, ONCE each.
// Applied files are recorded (with a checksum) in public.schema_migrations,
// so running this on every deployment is safe: only new files run.
//
//   npm run db:migrate:apply                      (uses DATABASE_URL)
//   npm run db:migrate:apply -- --baseline        (see below)
//   tsx scripts/apply-migrations.ts <connection-string>
//
// --baseline: for a database that was set up by the OLD version of this
// script (which had no record-keeping). It records every file as already
// applied WITHOUT running it, so only newer files run afterwards. Use it
// once, and only if you are sure the database already holds those files.
//
// Each file runs inside one transaction: a failure leaves the database
// exactly as it was before that file. A file whose first line is
// "-- no-transaction" runs outside a transaction (for statements that
// cannot run inside one).
import "dotenv/config";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  const args = process.argv.slice(2);
  const baseline = args.includes("--baseline");
  const connectionString = args.find((a) => !a.startsWith("--")) ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Pass a connection string as the first argument or set DATABASE_URL.");

  const dir = join(process.cwd(), "drizzle", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map((await client.query<{ filename: string; checksum: string }>("SELECT filename, checksum FROM public.schema_migrations")).rows.map((r) => [r.filename, r.checksum]));

    if (baseline) {
      let n = 0;
      for (const f of files) {
        if (done.has(f)) continue;
        await client.query("INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)", [f, sha(readFileSync(join(dir, f), "utf8"))]);
        n++;
      }
      console.log(`Baseline recorded for ${n} file(s). Nothing was executed.`);
      return;
    }

    // An already-applied file must not have been edited since.
    for (const f of files) {
      const have = done.get(f);
      if (have && have !== sha(readFileSync(join(dir, f), "utf8"))) {
        throw new Error(`Migration ${f} was changed after it was applied. Never edit an applied migration; add a new one.`);
      }
    }

    // On a database that already has data but no record (old runs), refuse to guess.
    if (done.size === 0) {
      const existing = await client.query("SELECT to_regclass('public.tenants') AS t");
      if (existing.rows[0].t) {
        throw new Error("This database already has PRIMUS tables but no migration record. If it is up to date with the files in drizzle/migrations, run once with --baseline; otherwise ask the engineer who set it up.");
      }
    }

    let applied = 0;
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(dir, f), "utf8");
      console.log(`Applying ${f}...`);
      const tx = !sql.startsWith("-- no-transaction");
      try {
        if (tx) await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)", [f, sha(sql)]);
        if (tx) await client.query("COMMIT");
      } catch (e) {
        if (tx) await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(`Migration ${f} failed and was rolled back: ${(e as Error).message}`);
      }
      applied++;
    }
    console.log(applied ? `Applied ${applied} migration file(s).` : "Database is up to date.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
