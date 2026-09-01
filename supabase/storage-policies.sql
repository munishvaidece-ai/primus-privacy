-- PRIMUS PRIVACY — Supabase Storage: `evidence` bucket + policies.
--
-- NOT applied by this repository's own migration runner
-- (scripts/apply-migrations.ts only ever reads drizzle/migrations/) and
-- NOT executed against any database by Slice C2 — no production
-- Supabase project exists yet (DECISIONS.md D-03: the region is
-- resolved, AWS Mumbai `ap-south-1`, but the project itself is not
-- provisioned; PHASE C2 instructions §34 explicitly forbid provisioning
-- it or creating a real bucket in this slice). This file is the exact
-- SQL to run, via the Supabase SQL editor, once that Mumbai project
-- exists — see DECISIONS.md R-95 for the full reasoning and for why
-- this is written now rather than deferred entirely (instructions §34:
-- "The repository should be production-ready for the Mumbai
-- configuration, but provisioning remains a separate controlled step").
--
-- Not independently verified against a real Supabase project (none is
-- reachable from this environment — DECISIONS.md D-03/R-85's own
-- network-egress limitation). Re-verify the `storage.foldername(name)`
-- index arithmetic below against a real project before relying on it in
-- production; it is derived from Supabase's documented behavior
-- (`storage.foldername` returns every path segment except the final
-- object-name segment), not exercised end-to-end here.
--
-- === Bucket configuration (create via the Supabase dashboard or the
-- Management API — buckets themselves are not created by SQL) ===
--   name:                evidence
--   public:              false   -- SECURITY.md §5: never a public bucket.
--   file_size_limit:     26214400 bytes (25MB) — matches
--                         lib/storage/evidence-storage.ts's
--                         EVIDENCE_MAX_FILE_SIZE_BYTES (DECISIONS.md R-94).
--   allowed_mime_types:  see lib/storage/evidence-storage.ts's
--                        ALLOWED_EVIDENCE_MIME_TYPES — keep both lists
--                        in sync by hand; Supabase's own bucket-level
--                        MIME allow-list is a second, independent layer
--                        on top of this application's own validation
--                        (lib/domain/evidence.ts), not a replacement for it.
--
-- === Object key convention this policy set assumes (lib/storage/
-- evidence-storage.ts's buildEvidenceObjectKey) ===
--   tenants/<tenantId>/organisations/<organisationId>/documents/<documentId>/<documentVersionId>
--
-- `storage.foldername(name)` returns every path segment except the
-- final one (the object's own "filename", here `documentVersionId`) as
-- a 1-indexed text[]:
--   [1]=tenants  [2]=tenantId  [3]=organisations  [4]=organisationId
--   [5]=documents  [6]=documentId
-- So `(storage.foldername(name))[4]` recovers the organisation id
-- straight from the path, with no lookup needed — reused directly
-- against this project's own `public.can_access_organisation` function
-- (migration 0001), the exact same authorization rule Postgres RLS
-- already applies to the `evidence`/`document_versions` tables that
-- describe this same object. Narrowest possible policy (instructions
-- §20) — not a broad "authenticated can read everything" grant.

CREATE POLICY evidence_bucket_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'evidence'
    AND public.can_access_organisation(((storage.foldername(name))[4])::uuid)
  );

CREATE POLICY evidence_bucket_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'evidence'
    AND public.can_access_organisation(((storage.foldername(name))[4])::uuid)
  );

-- Deletion mirrors the same organisation-level check — used only by
-- this application's own compensating cleanup (lib/domain/evidence.ts)
-- when a database write fails after a successful upload, never exposed
-- as an ordinary user-facing "delete evidence file" action (Evidence/
-- DocumentVersion are never hard-deleted at the database layer either
-- — migration 0011's own immutability triggers).
CREATE POLICY evidence_bucket_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'evidence'
    AND public.can_access_organisation(((storage.foldername(name))[4])::uuid)
  );

-- No UPDATE policy — matching `document_versions`' own immutability
-- (migration 0011's `prevent_document_version_tampering` trigger): once
-- uploaded, an evidence object's bytes are never replaced in place, per
-- PHASE C2 instructions §11 ("Do NOT overwrite an existing version").

-- No anonymous policy of any kind — `anon` gets nothing, matching every
-- other table's GRANT posture in this project since migration 0001.
