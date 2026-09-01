// Drops and recreates the `public` and `auth` schemas in the test
// database, then re-applies the local auth shim, both migrations, and
// the role/permission seed — giving each RLS test run a known-clean
// starting state. LOCAL/CI TESTING ONLY (see
// scripts/local-dev-auth-shim.sql's header).
import "dotenv/config";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

async function main() {
  const connectionString =
    process.env.TEST_DATABASE_SUPERUSER_URL ??
    "postgres://postgres:postgres@localhost:5432/primus_privacy_test";

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE;");
    await client.query("DROP SCHEMA IF EXISTS auth CASCADE;");
    await client.query("CREATE SCHEMA public;");
    await client.query(readFileSync("scripts/local-dev-auth-shim.sql", "utf8"));
  } finally {
    await client.end();
  }

  execFileSync("npx", ["tsx", "scripts/apply-migrations.ts", connectionString], {
    stdio: "inherit",
  });
  execFileSync("npx", ["tsx", "db/seed/roles.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: connectionString },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
