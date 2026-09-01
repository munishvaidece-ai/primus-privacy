// PHASE A instructions §21 (Authentication): "unauthenticated protected-
// route test," "authenticated session test." Exercises
// `getAuthenticatedUser`/`requireAuthenticatedUser`'s own control flow
// against a stand-in satisfying `SupabaseAuthClientLike` — this is the
// one place in this slice a stub is used, and it stubs only the
// third-party Supabase SDK boundary, never any authorization logic (see
// lib/auth/session.ts's own file comment, and PROGRESS.md, for exactly
// why: no live Supabase Auth backend — cloud or local — is reachable
// from this environment, DECISIONS.md D-03). Every authorization
// decision this application makes is tested for real, against real
// PostgreSQL, in tests/app/authorization.test.ts and
// tests/app/assessments.test.ts — nothing about authorization is stubbed
// anywhere in this suite.
import { describe, expect, it } from "vitest";
import { getAuthenticatedUser, requireAuthenticatedUser, type SupabaseAuthClientLike } from "@/lib/auth/session";

function stubClient(user: { id: string; email?: string | null } | null): SupabaseAuthClientLike {
  return { auth: { getUser: async () => ({ data: { user }, error: user ? null : new Error("no session") }) } };
}

describe("Session resolution", () => {
  it("getAuthenticatedUser returns null when there is no session (unauthenticated)", async () => {
    const result = await getAuthenticatedUser(stubClient(null));
    expect(result).toBeNull();
  });

  it("requireAuthenticatedUser redirects to /login when there is no session — the protected-route check", async () => {
    let thrown: unknown;
    try {
      await requireAuthenticatedUser(stubClient(null));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    // Next.js's own redirect() mechanism: throws an Error whose `digest`
    // encodes the destination — see node_modules/next/dist/client/
    // components/redirect.js. Asserting on this (not merely "it threw")
    // is what proves the redirect target is genuinely /login, not just
    // that some exception occurred.
    expect((thrown as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;.*;\/login;/);
  });

  it("getAuthenticatedUser returns the resolved user when a session exists (authenticated)", async () => {
    const result = await getAuthenticatedUser(stubClient({ id: "11111111-1111-1111-1111-111111111111", email: "consultant@example.test" }));
    expect(result).toEqual({ id: "11111111-1111-1111-1111-111111111111", email: "consultant@example.test" });
  });

  it("requireAuthenticatedUser returns the user (no redirect) when a session exists", async () => {
    const result = await requireAuthenticatedUser(
      stubClient({ id: "22222222-2222-2222-2222-222222222222", email: null }),
    );
    expect(result).toEqual({ id: "22222222-2222-2222-2222-222222222222", email: null });
  });

  it("getAuthenticatedUser returns null when the Supabase client itself reports an error", async () => {
    const client: SupabaseAuthClientLike = {
      auth: { getUser: async () => ({ data: { user: null }, error: new Error("invalid token") }) },
    };
    const result = await getAuthenticatedUser(client);
    expect(result).toBeNull();
  });
});
