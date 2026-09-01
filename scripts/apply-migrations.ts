// Applies every .sql file in drizzle/migrations/, in filename order,
// against the target database. Intentionally simple (no migration-state
// tracking table yet — Milestone 1 is a single, focused slice; a proper
// migration-history mechanism is a fair thing to add once there is more
// than one milestone's worth of migrations to sequence).
//
// Usage: DATABASE_URL=... tsx scripts/apply-migrations.ts
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

async function main() {
  const connectionString = process.argv[2] ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Pass a connection string as argv[2] or set DATABASE_URL.");
  }

  const migrationsDir = join(process.cwd(), "drizzle", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      console.log(`Applying ${file}...`);
      await client.query(sql);
    }
    console.log(`Applied ${files.length} migration file(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
