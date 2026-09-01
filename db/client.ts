import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Server-only. Never import this module from a Client Component or any
// code that ships to the browser — see ARCHITECTURE.md §3, SECURITY.md §4.
let pool: Pool | undefined;

export function getDb() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env and fill in a real connection string.",
      );
    }
    pool = new Pool({ connectionString });
  }
  return drizzle(pool, { schema });
}
