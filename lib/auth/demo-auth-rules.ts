// The safety rules for local demo sign-in, kept free of framework imports so
// the setup scripts and the tests can use them directly. See demo-auth.ts.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Pure check, exported for tests. Returns the reason demo sign-in must be refused, or null if it is allowed. */
export function demoAuthProblem(env: Record<string, string | undefined>): string | null {
  if (env.NODE_ENV === "production") return "this is a production build (demo sign-in only runs with `npm run dev`).";
  if (env.NEXT_PUBLIC_SUPABASE_URL) return "a Supabase project is configured, so the real sign-in must be used.";
  let host: string | null = null;
  try {
    host = new URL(env.DATABASE_URL ?? "").hostname.toLowerCase();
  } catch {
    host = null;
  }
  if (!host || !LOCAL_HOSTS.has(host)) return "DATABASE_URL does not point at this computer.";
  return null;
}
