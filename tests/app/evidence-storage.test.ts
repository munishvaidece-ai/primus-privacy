// Slice C2 — the storage adapter layer, tested in isolation from
// PostgreSQL (PHASE C2 instructions §25: "Clearly distinguish: database
// tests / storage integration tests / production Supabase validation").
// This file exercises `LocalEvidenceStorageAdapter` — the local/test
// stand-in every Vitest run receives regardless of `.env`'s own
// NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY contents,
// because `@/lib/storage/evidence-storage` resolves to
// `tests/shims/evidence-storage.ts` under Vitest (see that file, and
// `vitest.config.ts`'s own alias entry, for why: those two vars are
// legitimately configured in local `.env` for real Supabase Auth, but
// their presence must never make an automated test run attempt real
// Supabase Storage access — no production Supabase project's bucket
// should ever see traffic from a `vitest` run). Real file I/O, a real
// SHA-256 over real bytes, and a real deletion are exercised here; what
// is NOT exercised anywhere in this project is real Supabase Storage's
// own bucket privacy or public-URL rejection — see PROGRESS.md's
// explicit "not tested" list and this file's own comments on the
// specific tests PHASE C2 instructions §26 (18-22) ask for that cannot
// run here.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildEvidenceObjectKey,
  getEvidenceStorageAdapter,
  parseLocalSignedUrl,
  sha256Buffer,
  EVIDENCE_BUCKET,
  LocalEvidenceStorageAdapter,
} from "@/lib/storage/evidence-storage";

describe("Evidence storage adapter (Slice C2) — local/test stand-in", () => {
  const localStorageRoot = path.join(process.cwd(), ".local-storage", "evidence");

  beforeEach(async () => {
    // The meaningful invariant is adapter SELECTION, not raw env-var
    // presence — `.env` legitimately carries real Supabase configuration
    // for local development (real Auth needs it), so asserting those
    // vars are absent is no longer a valid precondition. What must hold
    // regardless is that Vitest itself never receives the real
    // Supabase-backed adapter: confirmed directly, by identity, via the
    // module-alias shim (tests/shims/evidence-storage.ts) rather than by
    // inferring it from `.env`'s contents.
    expect(getEvidenceStorageAdapter()).toBeInstanceOf(LocalEvidenceStorageAdapter);
  });

  afterEach(async () => {
    await fs.rm(localStorageRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("buildEvidenceObjectKey produces an identifier-only path — no filename, no PII", () => {
    const tenantId = randomUUID();
    const organisationId = randomUUID();
    const documentId = randomUUID();
    const documentVersionId = randomUUID();
    const key = buildEvidenceObjectKey(tenantId, organisationId, documentId, documentVersionId);
    expect(key).toBe(`tenants/${tenantId}/organisations/${organisationId}/documents/${documentId}/${documentVersionId}`);
    // Never a person's name, email, or free-form filename.
    expect(key).not.toMatch(/@/);
    expect(key).not.toMatch(/\.(pdf|docx?|xlsx?|png|jpe?g|txt)$/i);
  });

  it("upload writes real bytes and returns a real SHA-256 checksum computed from those bytes", async () => {
    const adapter = getEvidenceStorageAdapter();
    const key = buildEvidenceObjectKey(randomUUID(), randomUUID(), randomUUID(), randomUUID());
    const content = Buffer.from("synthetic evidence file content — not a real client document", "utf8");

    const result = await adapter.upload(key, content, "text/plain");

    expect(result.checksumSha256).toBe(sha256Buffer(content));
    expect(result.fileSizeBytes).toBe(content.byteLength);

    const onDisk = await fs.readFile(path.join(localStorageRoot, key));
    expect(onDisk.equals(content)).toBe(true);
  });

  it("createSignedUrl fails for an object that was never uploaded (mirrors a real 404)", async () => {
    const adapter = getEvidenceStorageAdapter();
    const key = buildEvidenceObjectKey(randomUUID(), randomUUID(), randomUUID(), randomUUID());
    await expect(adapter.createSignedUrl(key, 300)).rejects.toThrow();
  });

  it("createSignedUrl encodes a real, checkable expiry — not yet expired immediately after issuance, expired once the clock passes it", async () => {
    const adapter = getEvidenceStorageAdapter();
    const key = buildEvidenceObjectKey(randomUUID(), randomUUID(), randomUUID(), randomUUID());
    await adapter.upload(key, Buffer.from("content"), "text/plain");

    const url = await adapter.createSignedUrl(key, 300);
    const parsed = parseLocalSignedUrl(url);
    expect(parsed.objectKey).toBe(key);
    expect(parsed.expired).toBe(false);

    const alreadyExpiredUrl = await adapter.createSignedUrl(key, -1);
    expect(parseLocalSignedUrl(alreadyExpiredUrl).expired).toBe(true);
  });

  it("remove deletes the object; a subsequent signed-URL request then fails", async () => {
    const adapter = getEvidenceStorageAdapter();
    const key = buildEvidenceObjectKey(randomUUID(), randomUUID(), randomUUID(), randomUUID());
    await adapter.upload(key, Buffer.from("content"), "text/plain");

    await adapter.remove(key);

    await expect(fs.access(path.join(localStorageRoot, key))).rejects.toThrow();
    await expect(adapter.createSignedUrl(key, 300)).rejects.toThrow();
  });

  it("remove on a never-uploaded key does not throw (idempotent, matching Supabase Storage's own remove semantics)", async () => {
    const adapter = getEvidenceStorageAdapter();
    const key = buildEvidenceObjectKey(randomUUID(), randomUUID(), randomUUID(), randomUUID());
    await expect(adapter.remove(key)).resolves.toBeUndefined();
  });

  it("getEvidenceStorageAdapter returns the same cached instance across calls", () => {
    expect(getEvidenceStorageAdapter()).toBe(getEvidenceStorageAdapter());
  });

  // --- Honest limitations (PHASE C2 instructions §25/§26) ------------
  // The following required "Storage" security tests (instructions §26,
  // items 18-22 — bucket privacy, public-URL rejection, a real signed
  // URL working, real signed-URL expiry against Supabase's own
  // infrastructure, and revoked access not remaining available) cannot
  // be executed in this environment: no production (or any real)
  // Supabase project exists (DECISIONS.md D-03 — the region is
  // resolved, but the project itself is not provisioned) and this
  // environment's own network egress to supabase.co is blocked
  // (confirmed directly in Slice A1). This is reported here explicitly,
  // per instructions §26's own "If a test cannot run because the
  // production Supabase project does not yet exist, explicitly report
  // that instead of substituting a false claim" — not silently skipped.
  it("[DOCUMENTED, NOT EXECUTABLE HERE] real Supabase Storage bucket privacy / public-URL rejection / real signed-URL issuance and expiry", () => {
    expect(EVIDENCE_BUCKET).toBe("evidence"); // the only fact about the real bucket this suite can assert.
  });
});
