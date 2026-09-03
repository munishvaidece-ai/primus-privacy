"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnTo } from "@/lib/auth/return-to";

// PHASE A instructions §3: implement login/logout only — no social
// login, SSO, MFA, password reset UI, invitations, or account
// management in this slice.
//
// `safeReturnTo` (the P2B.5 open-redirect guard both actions below use)
// lives in its own module, lib/auth/return-to.ts, not here: a
// `"use server"` file may export ONLY async Server Actions — Next.js
// enforces this at build time, confirmed directly when this slice's own
// first build attempt failed with "Server actions must be async
// functions" against a synchronous export from this exact file.

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/**
 * Server Action backing the login form (app/login/page.tsx). Validates
 * input (Zod, per ARCHITECTURE.md §2), then delegates entirely to
 * Supabase Auth — never compares a password itself. A plain
 * `<form action={signIn}>` (no client-side JavaScript required —
 * progressive enhancement) redirects to `/login?error=...` on failure
 * and into the protected shell on success. `redirect()` throws
 * internally by design and must never be wrapped in a try/catch — see
 * Next.js's own documented behavior.
 *
 * P2B.5 adds an optional `returnTo` field (brief §15's "smallest safe
 * return mechanism," so `/invite/[token]` can send an unauthenticated
 * visitor here and get them back afterward): when present and validated
 * safe by `safeReturnTo`, redirects there on success instead of the
 * existing default `/organisations` destination. The `error` redirect
 * path also carries `returnTo` forward unchanged, so a failed login
 * attempt from the invitation flow doesn't lose the destination.
 */
export async function signIn(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const returnToQuery = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : "";

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect(`/login?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}${returnToQuery}`);
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Generic message — SECURITY.md §13: never distinguish "wrong
    // password" from "no such user" in a client-facing response (avoids
    // email-enumeration side channels, SECURITY.md §1).
    redirect(`/login?error=${encodeURIComponent("Incorrect email or password.")}${returnToQuery}`);
  }

  redirect(returnTo ?? "/organisations");
}

/**
 * Server Action backing the shell's logout control. P2B.5 adds an
 * optional `returnTo` field (used only by the invitation email-mismatch
 * screen's own "sign out and try a different account" control, so
 * signing out and back in returns to the same invitation) — every
 * existing caller (the shell's own `UserMenu`) posts with no such field
 * at all, so `safeReturnTo` returns `null` and behavior is byte-for-byte
 * unchanged: redirect to `/login`.
 */
export async function signOut(formData?: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData?.get("returnTo"));
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login");
}
