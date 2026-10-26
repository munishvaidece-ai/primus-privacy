// Creates the FICTIONAL back-office database the PostgreSQL connector scans in the Orchid Hill demo.
// Safe to run again. Only ever run by `npm run local:setup`, and only on this computer.
import "dotenv/config";
import { demoAuthProblem } from "../lib/auth/demo-auth-rules";
import { buildSampleDb } from "../lib/demo/orchid/sample-db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const problem = demoAuthProblem({ ...process.env, NODE_ENV: "development" });
  if (problem) throw new Error(`Refusing to create demo data: ${problem}`);
  const r = await buildSampleDb(url);
  console.log(r.created ? "✓ Created the fictional back-office database for the connector demo (orchid_hill_backoffice)." : "✓ The fictional back-office database already exists.");
}
main().catch((e) => { console.error(`\n✗ ${e.message ?? e}`); process.exit(1); });
