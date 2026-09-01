import "server-only";
import { eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { roles } from "@/db/schema";

// `roles` is global reference/taxonomy data (migration 0001: "readable
// by any authenticated user," no RLS restriction) — this lookup works
// regardless of the caller's own membership state, unlike a query
// against a tenant-scoped table. Used by Slice B2's membership-grant
// paths to resolve the fixed, server-chosen role for a grant, never a
// browser-supplied role id (PHASE B2 instructions §6/§11: choose the
// role server-side, do not expose a role picker to the caller).
export async function getRoleIdByName(db: RequestDb, name: string): Promise<string> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1);
  if (!row) {
    // Should never happen against real seed data (db/seed/roles.ts) —
    // a clear, loud failure here is better than silently granting no
    // role or an arbitrary one.
    throw new Error(`Role "${name}" not found. Has db/seed/roles.ts been run?`);
  }
  return row.id;
}
