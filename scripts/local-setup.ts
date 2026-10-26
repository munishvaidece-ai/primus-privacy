// One-command setup for trying the product on your own computer.
//
//   npm run local:setup
//
// It: (1) creates `.env` from .env.local-demo.example if you have none (and
// fills in CONNECTOR_SECRET_KEY), (2) waits for the local database, (3) adds the
// small local stand-in for Supabase's sign-in tables, (4) creates all tables,
// (5) creates the practice, roles, AI agent and a demo administrator, and
// (6) adds a small set of clearly fictional demo data. Safe to run again.
//
// It refuses to run against any database that is not on this computer.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { Client } from "pg";
import { demoAuthProblem } from "../lib/auth/demo-auth-rules";

async function main() {
  if (!existsSync(".env")) {
    copyFileSync(".env.local-demo.example", ".env");
    console.log("✓ Created .env from .env.local-demo.example");
  }
  let env = readFileSync(".env", "utf8");
  if (/^CONNECTOR_SECRET_KEY=\s*$/m.test(env)) {
    env = env.replace(/^CONNECTOR_SECRET_KEY=\s*$/m, `CONNECTOR_SECRET_KEY=${randomBytes(32).toString("base64")}`);
    writeFileSync(".env", env);
    console.log("✓ Generated CONNECTOR_SECRET_KEY");
  }
  dotenv.config();

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in .env.");
  const problem = demoAuthProblem({ ...process.env, NODE_ENV: "development" });
  if (problem) throw new Error(`Refusing to set up demo data here: ${problem}`);

  // 1. wait for the database
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    const c = new Client({ connectionString: url });
    try {
      await c.connect();
      await c.query("SELECT 1");
      ready = true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      await c.end().catch(() => undefined);
    }
  }
  if (!ready) throw new Error("Could not reach the database at DATABASE_URL. Is it running? (npm run local:db)");
  console.log("✓ Database reachable");

  // 2. local stand-in for Supabase's auth tables and roles
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(readFileSync("scripts/local-dev-auth-shim.sql", "utf8"));
  } finally {
    await c.end();
  }
  console.log("✓ Local sign-in tables ready");

  const run = (args: string[]) => execFileSync("npx", ["tsx", "--require", "./scripts/preload-server-only.cjs", ...args], { stdio: "inherit", env: process.env });
  // 3. tables
  run(["scripts/apply-migrations.ts"]);
  // 4. practice, roles, AI agent, risk model, starter library, administrator
  run(["scripts/bootstrap.ts", "--tenant", "Primus Partners", "--admin-email", "admin@primus.local", "--admin-name", "Demo Administrator", "--starter-library"]);
  // 5. fictional demo data
  run(["scripts/local-demo-seed.ts"]);
  // 6. fictional uploaded documents, then the platform's own AI works on them
  run(["scripts/local-demo-ai-seed.ts"]);

  console.log("\nAll set. Start the app with:  npm run dev   then open http://localhost:3000");
}

main().catch((e) => {
  console.error(`\n✗ ${e.message ?? e}`);
  process.exit(1);
});
