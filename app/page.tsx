import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/session";

// Root route — never rendered as a page itself; redirects into the
// protected shell (if signed in) or to /login (PHASE A instructions §3:
// "unauthenticated redirect"). Depends on the caller's session, so it
// cannot be statically prerendered — see app/(shell)/layout.tsx's own
// comment for why `force-dynamic` is set explicitly rather than relied
// on implicitly.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getAuthenticatedUser();
  redirect(user ? "/organisations" : "/login");
}
