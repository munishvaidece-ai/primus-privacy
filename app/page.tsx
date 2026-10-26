import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getViewer } from "@/lib/workspace/common";

// Root route — never rendered as a page itself; redirects into the
// protected shell (if signed in) or to the microsite, whose Sign in
// buttons lead to /login. Depends on the caller's session, so it cannot be
// statically prerendered — see app/(shell)/layout.tsx for why `force-dynamic`
// is set explicitly.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getAuthenticatedUser();
  // Front door: visitors who are not signed in land on the Primus Privacy
  // microsite (static pages in /public/site) and enter the platform
  // through its Sign in buttons, which lead to /login. A signed-in Primus
  // person lands on the workspace dashboard; a client lands on their portal.
  if (!user) redirect("/site/index.html");
  const viewer = await withRequestDb(user.id, (db) => getViewer(db, user.id));
  redirect(viewer.isClient ? "/portal" : "/dashboard");
}
