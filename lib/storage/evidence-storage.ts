import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Slice C2 (PHASE C2 instructions §4/§5): the single storage
// abstraction point for Evidence file bytes. Uses the EXISTING
// server-side Supabase integration (`lib/supabase/server.ts`'s
// `createSupabaseServerClient`, built in Slice A1 for Auth) rather than
// a second Supabase client architecture — the returned client is the
// full `@supabase/supabase-js` `SupabaseClient`, and `.storage` is
// simply another property of that same, already-session-bound
// instance. Deliberately does NOT use a service-role client: every
// Storage call below runs as the authenticated user's own session,
// exactly mirroring how `lib/db/request-client.ts` runs every database
// query as `SET LOCAL ROLE authenticated` rather than bypassing RLS —
// Storage's own bucket policies (see the SQL this module's own docs
// reference below) are the same kind of independent, narrowly-scoped
// backstop RLS already is for Postgres, not a shortcut around it.

export const EVIDENCE_BUCKET = "evidence";

// DECISIONS.md R-94: a deliberate MVP choice, not an enterprise-scale
// limit — large enough for real compliance documents (policy PDFs,
// signed agreements, configuration exports, screenshots) without
// inviting unbounded uploads. next.config.mjs's own Server Actions
// `bodySizeLimit` is set to accommodate this exact value.
export const EVIDENCE_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

// DECISIONS.md R-94: allow-listed MIME types (never trusted from the
// browser alone — lib/domain/evidence.ts's own validation re-derives
// the extension from the filename and requires it to match one of the
// extensions this same MIME type is allow-listed for, instructions §8's
// "do not blindly trust browser-provided MIME type"). A small, closed
// set covering the realistic compliance-evidence document types this
// product actually handles — not a general-purpose file host.
export const ALLOWED_EVIDENCE_MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "text/plain": [".txt"],
};

// DECISIONS.md R-94: how long a signed URL remains valid. Short-lived,
// per SECURITY.md §5's own explicit requirement ("The only way to read
// a file is a short-lived signed URL") — long enough for a browser to
// actually load/download the file once issued, short enough that a
// leaked URL (a browser history entry, a proxy log) is not a durable
// access grant. Never persisted to PostgreSQL (instructions §17) — only
// ever held in memory for the single response that returns it.
export const SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes

/**
 * The object-key convention (PHASE C2 instructions §6): identifiers
 * only, never a person's name, email, free-form client name, or the
 * original filename (which stays in PostgreSQL, on `document_versions.
 * original_filename`, metadata only — never part of the storage path
 * itself). `documentVersionId` as the leaf segment is deterministic and
 * collision-proof by construction (it's the version's own primary key)
 * — a refinement over Milestone 6's own R-65 illustrative example
 * (`tenants/<id>/documents/<id>/<hash-prefix>`), which used a truncated
 * content hash as the leaf; a hash-prefix does the same job but risks
 * (extremely rare, but real) collision across unrelated uploads with
 * identical content, and ties path structure to content that this
 * function has no reason to depend on. `organisationId` is included in
 * the path (not just `tenantId`/`documentId`) specifically so a real
 * production Storage policy can scope access by organisation-level
 * path prefix, mirroring the same Tenant → Organisation nesting every
 * RLS policy in this project already enforces at the database layer —
 * see DECISIONS.md R-94 for the full reasoning (a consequential choice,
 * per instructions §6).
 */
export function buildEvidenceObjectKey(
  tenantId: string,
  organisationId: string,
  documentId: string,
  documentVersionId: string,
): string {
  return `tenants/${tenantId}/organisations/${organisationId}/documents/${documentId}/${documentVersionId}`;
}

export function sha256Buffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface StorageUploadResult {
  checksumSha256: string;
  fileSizeBytes: number;
}

export interface EvidenceStorageAdapter {
  upload(objectKey: string, content: Buffer, contentType: string): Promise<StorageUploadResult>;
  createSignedUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  remove(objectKey: string): Promise<void>;
}

function isRealSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * The real, production-shaped adapter (PHASE C2 instructions §34: "The
 * repository should be production-ready for the Mumbai configuration").
 * Uses the caller's own authenticated Supabase session
 * (`createSupabaseServerClient()`) — never a service-role key, never
 * constructed with anything that could reach a browser bundle. Requires
 * a private, non-public `evidence` bucket in the target Supabase
 * project (Storage bucket creation and its RLS-style policies are SQL,
 * written but deliberately NOT applied anywhere by this slice — see
 * `supabase/storage-policies.sql` and DECISIONS.md R-95: no production
 * project exists yet to apply them to, instructions §34).
 */
class SupabaseEvidenceStorageAdapter implements EvidenceStorageAdapter {
  private client() {
    return createSupabaseServerClient();
  }

  async upload(objectKey: string, content: Buffer, contentType: string): Promise<StorageUploadResult> {
    const { error } = await this.client()
      .storage.from(EVIDENCE_BUCKET)
      .upload(objectKey, content, { contentType, upsert: false });
    if (error) {
      throw new Error(`Evidence storage upload failed: ${error.message}`);
    }
    return { checksumSha256: sha256Buffer(content), fileSizeBytes: content.byteLength };
  }

  async createSignedUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client().storage.from(EVIDENCE_BUCKET).createSignedUrl(objectKey, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new Error(`Failed to create a signed URL for evidence: ${error?.message ?? "no URL returned"}`);
    }
    return data.signedUrl;
  }

  async remove(objectKey: string): Promise<void> {
    const { error } = await this.client().storage.from(EVIDENCE_BUCKET).remove([objectKey]);
    if (error) {
      throw new Error(`Failed to remove evidence storage object: ${error.message}`);
    }
  }
}

/**
 * Local/test stand-in (PHASE C2 instructions §25: "If the production
 * Supabase project is not yet provisioned, do NOT pretend production
 * storage was tested. Use an appropriate local/test storage mechanism
 * for automated tests"). Writes real bytes to a local, git-ignored
 * directory (`.local-storage/evidence/`) — real file I/O, a real
 * SHA-256 computed from the real bytes, a real deletion — everything
 * this module's own callers actually depend on for correctness is
 * exercised for real. What is NOT real: the "signed URL" is a plain,
 * clearly-fake `local-evidence-storage://` URI encoding an expiry
 * timestamp, never a working HTTP link, never served by any route this
 * project defines — no private bucket, no Storage RLS policy, and no
 * real network boundary is exercised by this class at all. Tests using
 * this adapter verify the *authorization and expiry logic* this class's
 * production counterpart shares the same contract with; they do not,
 * and cannot, prove anything about real Supabase Storage's own bucket
 * privacy or public-URL rejection (DECISIONS.md R-95, PROGRESS.md's own
 * explicit "not tested" list).
 *
 * Exported (not merely module-private) so `tests/shims/evidence-storage.ts`
 * can construct this SAME class directly — reusing its real, unmodified
 * implementation — rather than duplicating it. This does not change
 * `getEvidenceStorageAdapter()`'s own real-app selection logic below at
 * all: a real Supabase-configured `next dev`/`next build`/`next start`
 * still selects `SupabaseEvidenceStorageAdapter` exactly as before: this
 * export only makes the class reachable to import, it does not change
 * which one `getEvidenceStorageAdapter()` picks.
 */
export class LocalEvidenceStorageAdapter implements EvidenceStorageAdapter {
  private root(): string {
    return path.join(process.cwd(), ".local-storage", "evidence");
  }

  private filePath(objectKey: string): string {
    // objectKey is always this module's own buildEvidenceObjectKey()
    // output (UUIDs and fixed literal segments only — see that
    // function's own docstring) — never raw user input — so a plain
    // join is safe; still normalized defensively rather than trusted
    // blindly.
    return path.join(this.root(), objectKey);
  }

  async upload(objectKey: string, content: Buffer, _contentType: string): Promise<StorageUploadResult> {
    const filePath = this.filePath(objectKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
    return { checksumSha256: sha256Buffer(content), fileSizeBytes: content.byteLength };
  }

  async createSignedUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const filePath = this.filePath(objectKey);
    await fs.access(filePath); // throws if the object doesn't exist — mirrors a real 404 from Supabase Storage.
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    return `local-evidence-storage://${encodeURIComponent(objectKey)}?expires=${expiresAt}`;
  }

  async remove(objectKey: string): Promise<void> {
    await fs.rm(this.filePath(objectKey), { force: true });
  }
}

/** Parses a `local-evidence-storage://` URL from `LocalEvidenceStorageAdapter`
 * and reports whether it has expired — test-only (and this module's own
 * doc comments), never called by production code, since a real Supabase
 * signed URL is verified by Supabase's own infrastructure, not by this
 * application. */
export function parseLocalSignedUrl(url: string): { objectKey: string; expiresAt: Date; expired: boolean } {
  const parsed = new URL(url);
  if (parsed.protocol !== "local-evidence-storage:") {
    throw new Error("Not a local-evidence-storage URL.");
  }
  const objectKey = decodeURIComponent(parsed.hostname || parsed.pathname.replace(/^\/+/, ""));
  const expiresMillis = Number(parsed.searchParams.get("expires"));
  const expiresAt = new Date(expiresMillis);
  return { objectKey, expiresAt, expired: Date.now() > expiresMillis };
}

let cachedAdapter: EvidenceStorageAdapter | undefined;

/**
 * Selects the real Supabase-backed adapter once `NEXT_PUBLIC_SUPABASE_URL`/
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` are real values (matching the exact
 * same env-var check `lib/supabase/server.ts` already uses to decide
 * whether Auth can function), or the local file-based stand-in
 * otherwise — the same "real once configured, local/test until then"
 * shape `lib/db/request-client.ts` already established for the database
 * connection (DECISIONS.md D-03/R-85), applied here to Storage now that
 * D-03 itself is resolved but no production project is provisioned yet.
 */
export function getEvidenceStorageAdapter(): EvidenceStorageAdapter {
  if (!cachedAdapter) {
    cachedAdapter = isRealSupabaseConfigured() ? new SupabaseEvidenceStorageAdapter() : new LocalEvidenceStorageAdapter();
  }
  return cachedAdapter;
}
