import { NextResponse } from "next/server";
import { Pool } from "pg";

// Liveness / readiness probe for the load balancer and container platform.
// Reveals nothing beyond up/down. Not behind sign-in by design.
export const dynamic = "force-dynamic";

let pool: Pool | undefined;

export async function GET() {
  const url = process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ ok: false, database: "not configured" }, { status: 503 });
  try {
    pool ??= new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 3000 });
    await pool.query("SELECT 1");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}
