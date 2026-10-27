import type { ReactNode } from "react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getUserClientOrgId } from "@/lib/authorization/service";
import { Sidebar } from "@/components/shell/sidebar";
import { unreadCount } from "@/lib/workspace/notifications";
import { UserMenu } from "@/components/shell/user-menu";
import { Wordmark } from "@/components/shell/logo";
import { users } from "@/db/schema/users";
import { organisations } from "@/db/schema/organisations";
import { eq } from "drizzle-orm";
import { isDemoAuthActive } from "@/lib/auth/demo-auth";

// The authenticated application shell (PHASE A instructions §8). Every
// route under this route group — /organisations and everything nested
// under it — is protected by this one `requireAuthenticatedUser()` call;
// no child page re-implements the redirect-if-signed-out check itself
// (instructions §5: "Do not make each page independently reinvent this
// logic"). `/login` lives outside this route group entirely, so it is
// never subject to (or able to trigger) this redirect.
//
// Every route in this subtree depends on the caller's session and on
// live, per-request database access — none of it can be correctly
// prerendered at build time. `force-dynamic` cascades to every nested
// route segment (Next.js route-segment-config inheritance), so `next
// build` never attempts to statically render an authenticated page (and
// never needs Supabase credentials to be present at build time — see
// .env.example).
export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await requireAuthenticatedUser();

  // P2B.5 (Client Onboarding & Acceptance UX): reads the EXISTING
  // authoritative `users.client_org_id` column (via
  // `getUserClientOrgId`, mirroring `getUserTenantId`'s identical
  // shape) — not a new "isClient" flag stored anywhere, just the same
  // signal `accept_invitation()` (migration 0038) already uses to
  // distinguish a practice-side identity from a client one. A UI
  // convenience only (which nav items to render) — every actual access
  // decision remains whichever `canX`/`requireX` check already gates
  // that specific server-side operation, entirely unaffected by this
  // value.
  const { isClient, unread, displayName, orgName } = await withRequestDb(user.id, async (db) => {
    const [me] = await db.select({ name: users.displayName, orgId: users.clientOrgId }).from(users).where(eq(users.id, user.id)).limit(1);
    let orgName: string | null = null;
    if (me?.orgId) {
      const [o] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, me.orgId)).limit(1);
      orgName = o?.name ?? null;
    }
    return { isClient: (me?.orgId ?? null) !== null, unread: await unreadCount(db, user.id), displayName: me?.name ?? null, orgName };
  });
  const home = isClient ? "/portal" : "/dashboard";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <Link href={home} aria-label="Primus Privacy home"><Wordmark /></Link>
            {isClient && orgName ? (
              <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 md:inline-block">{orgName}</span>
            ) : (
              <span className="hidden rounded-full bg-copper-soft px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-copper-deep md:inline-block">Consultant workspace</span>
            )}
          </div>
          <UserMenu email={user.email} name={displayName} side={isClient ? "client" : "primus"} />
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 md:flex-row">
        <Sidebar isClient={isClient} unread={unread} demo={isDemoAuthActive()} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
