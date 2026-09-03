// P2B.5 (Client Onboarding & Acceptance UX, brief §15). Split out of
// lib/auth/actions.ts: a `"use server"` file may export ONLY async
// Server Actions (Next.js enforces this at build time — "Server actions
// must be async functions" — confirmed directly, this slice's own first
// build attempt failed on it), so this plain, synchronous, independently
// testable validator lives in its own module instead.
//
// Validates a caller-supplied post-login return destination before it is
// ever passed to `redirect()` — an unvalidated `returnTo` would be a
// classic open-redirect vector (an attacker crafts
// `/login?returnTo=https://evil.example` or the protocol-relative
// `//evil.example`, hoping a signed-in victim gets bounced there).
// Accepts ONLY a same-origin, absolute-path destination: must start
// with a single `/`, must not start with `//` (a protocol-relative URL —
// browsers resolve this against whatever host precedes it, exactly like
// a full external URL) or `/\` (some browsers normalize a leading
// backslash to a second slash, the same class of trick), and must not
// itself look like an absolute URL with a scheme
// (`javascript:`/`https:`/etc.). Returns `null` for anything not
// confidently safe — every call site falls back to its own existing,
// unconditional default destination in that case.
export function safeReturnTo(value: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return value;
}
