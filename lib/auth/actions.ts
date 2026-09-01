"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// PHASE A instructions §3: implement login/logout only — no social
// login, SSO, MFA, password reset UI, invitations, or account
// management in this slice.

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
 */
export async function signIn(formData: FormData): Promise<void> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect(`/login?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.")}`);
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Generic message — SECURITY.md §13: never distinguish "wrong
    // password" from "no such user" in a client-facing response (avoids
    // email-enumeration side channels, SECURITY.md §1).
    redirect(`/login?error=${encodeURIComponent("Incorrect email or password.")}`);
  }

  redirect("/organisations");
}

/** Server Action backing the shell's logout control. */
export async function signOut(): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
