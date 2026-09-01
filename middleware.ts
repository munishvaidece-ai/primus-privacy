import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on every request except static assets/images/favicon — the
    // standard @supabase/ssr-recommended matcher, so the session cookie
    // stays fresh for every page/Server Action without re-running on
    // requests that can't use a session anyway.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
