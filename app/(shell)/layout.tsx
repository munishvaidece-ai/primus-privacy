import type { ReactNode } from "react";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { GlobalNav } from "@/components/shell/nav";
import { UserMenu } from "@/components/shell/user-menu";

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

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/organisations" className="text-sm font-semibold tracking-tight text-slate-900">
              PRIMUS PRIVACY
            </Link>
            <GlobalNav />
          </div>
          <UserMenu email={user.email} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
