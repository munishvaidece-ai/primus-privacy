// Test-only shim for lib/storage/evidence-storage.ts's ADAPTER SELECTION
// ONLY (aliased in vitest.config.ts, for tests only — the real Next.js
// dev/build/start in package.json's own scripts continue to resolve the
// real module, completely unaffected by this file; this alias is never
// applied outside a vitest run). Mirrors tests/shims/server-only.ts's own
// exact reasoning for a structurally identical problem: the real
// `getEvidenceStorageAdapter()` selects `SupabaseEvidenceStorageAdapter`
// whenever NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are configured — correct,
// unchanged production behavior, and also correct for local `next dev`
// once real Supabase Auth is needed (which is exactly why those two vars
// are legitimately present in `.env` for this project's own local
// development). But `SupabaseEvidenceStorageAdapter.upload()` calls
// `createSupabaseServerClient()` -> `cookies()` (next/headers), which
// requires Next.js's own request-scope machinery — something a bare
// `vitest` process never has, regardless of whether the code under test
// is doing anything wrong. Nothing about this is an authorization or
// security concern to test: `lib/storage/evidence-storage.ts`'s own
// LocalEvidenceStorageAdapter docstring already says as much for the
// identical reason `server-only`'s shim exists.
//
// Reuses the real, unmodified `LocalEvidenceStorageAdapter` exported
// from the real module — no storage logic (upload/signed-URL/remove) is
// reimplemented or duplicated here. A relative import (not the `@/...`
// alias) is used deliberately so this file reaches the REAL module
// rather than re-resolving back to itself through the very alias this
// file exists to define.
export * from "../../lib/storage/evidence-storage";

import { LocalEvidenceStorageAdapter, type EvidenceStorageAdapter } from "../../lib/storage/evidence-storage";

let cachedAdapter: EvidenceStorageAdapter | undefined;

/**
 * Overrides the real `getEvidenceStorageAdapter`'s re-export above (a
 * local declaration always wins over a same-named binding pulled in by
 * `export *`, per the ES module spec — no ambiguity error, no need to
 * exclude the name from the `export *` line above). Always returns the
 * local/test stand-in, unconditionally — never consults
 * NEXT_PUBLIC_SUPABASE_URL/ANON_KEY at all, so this file's own behavior
 * cannot drift with whatever `.env` happens to contain. Cached exactly
 * like the real function, for the same reason (one adapter instance per
 * process run).
 */
export function getEvidenceStorageAdapter(): EvidenceStorageAdapter {
  if (!cachedAdapter) {
    cachedAdapter = new LocalEvidenceStorageAdapter();
  }
  return cachedAdapter;
}
