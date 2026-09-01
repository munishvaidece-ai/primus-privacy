import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// The Supabase server client — the *only* place `@supabase/ssr` is
// constructed for Server Components/Actions/Route Handlers. Never
// imported from a Client Component (the `server-only` import above makes
// that a build error, not a code-review convention). Uses only the
// public URL/anon key (safe to expose to the browser per
// NEXT_PUBLIC_-prefixing) — this client never bypasses RLS; it only
// resolves/refreshes the caller's own Supabase Auth session, exactly as
// ARCHITECTURE.md §4 describes ("Auth... issues a session whose JWT
// carries the user id; all tenant/role resolution happens server-side
// against the database, not by trusting claims baked into the JWT beyond
// identity").
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set — see .env.example. " +
        "No Supabase project has been provisioned for this repository yet (DECISIONS.md D-03); " +
        "authentication cannot function until real values are configured.",
    );
  }

  const cookieStore = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component render, where cookies() is
          // read-only — expected and harmless. The middleware (see
          // middleware.ts) is what actually refreshes the session cookie
          // on every request; this catch matches @supabase/ssr's own
          // documented Next.js App Router pattern.
        }
      },
    },
  });
}
