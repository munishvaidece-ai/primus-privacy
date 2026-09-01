import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// The @supabase/ssr-documented Next.js App Router session-refresh
// pattern: middleware re-validates the caller's Supabase session on
// every request and re-issues a refreshed cookie when the access token
// has expired, so Server Components (which cannot themselves write
// cookies during render — see lib/supabase/server.ts) always see an
// up-to-date session. This module never makes an authorization decision
// itself — it only keeps the session cookie current; every actual
// access-control decision happens in lib/authorization/service.ts,
// downstream of a resolved user id.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // No Supabase project configured (see lib/supabase/server.ts) —
    // nothing to refresh; let the request through unchanged so
    // unauthenticated-redirect logic further down the stack (in the
    // protected route layout) is what actually handles this, not a
    // silent middleware failure.
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Re-validates the session against Supabase Auth (not merely decoding
  // the cookie) — required by @supabase/ssr's own documented pattern so
  // an expired/revoked session is actually caught here, not just trusted.
  await supabase.auth.getUser();

  return response;
}
