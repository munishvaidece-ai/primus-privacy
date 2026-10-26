import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/session";

// Root route — never rendered as a page itself; redirects into the
// protected shell (if signed in) or to the microsite, whose Sign in
// buttons lead to /login (PHASE A instructions §3: "unauthenticated
// redirect" still applies to every protected page). Depends on the caller's session, so it
// cannot be statically prerendered — see app/(shell)/layout.tsx's own
// comment for why `force-dynamic` is set explicitly rather than relied
// on implicitly.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getAuthenticatedUser();
  // Front door: visitors who are not signed in land on the Primus Privacy
  // microsite (static pages in /public/site) and enter the platform
  // through its Sign in buttons, which lead to /login. Signed-in users go
  // straight to the platform.
  redirect(user ? "/organisations" : "/site/index.html");
}
