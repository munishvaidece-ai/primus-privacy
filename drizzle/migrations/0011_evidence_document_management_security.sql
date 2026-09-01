-- PRIMUS PRIVACY — Migration 0011: security layer for Evidence & Document
-- Management (0010_evidence_document_management.sql).
--
-- Hand-written, not drizzle-kit generated — same rationale as migrations
-- 0001, 0003, 0005, 0007, and 0009 (DECISIONS.md R-02): RLS, triggers,
-- and cross-module immutability rules aren't modeled in the Drizzle TS
-- schema. Deployable to a real Supabase project as-is; assumes
-- migrations 0000-0010 are already applied.

-- =============================================================================
-- 1. Audit-column foreign keys to users(id)
-- =============================================================================
-- Added here via ALTER TABLE, not in the Drizzle TS schema — same
-- circular-import reasoning as every audit column since tenants.ts.
-- `document_versions.uploaded_by`, `documents.owner_user_id`, and
-- `evidence.reviewed_by` did NOT need this treatment — all three are
-- direct Drizzle `.references()` already, since no cycle exists for them.

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "documents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "evidence_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "evidence_links"
  ADD CONSTRAINT "evidence_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

-- =============================================================================
-- 2. Reparenting guards
-- =============================================================================
-- `documents.{tenant_id,organisation_id,engagement_id}` are immutable
-- after creation, matching every master-data-shaped identity table since
-- Milestone 2: RLS's WITH CHECK can authorize a change but can't cleanly
-- express "these columns never change" without also blocking ordinary
-- edits (title, document_type, owner_user_id, status — all legitimately
-- mutable) by users who have real access to the row.
CREATE OR REPLACE FUNCTION public.prevent_document_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id THEN
    RAISE EXCEPTION
      'documents.{tenant_id,organisation_id,engagement_id} are immutable after creation (document %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_prevent_reparenting
  BEFORE UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_document_reparenting();

-- `evidence.{tenant_id,organisation_id,engagement_id,document_version_id}`
-- are immutable after creation — the last of these specifically so
-- "which DocumentVersion this Evidence points to" can never silently
-- change (the same historical-reproducibility principle Milestone 5
-- applied to `assessments.control_library_version_id` — Milestone 6
-- instructions §8/§15). Only `title`/`description`/`evidence_type`/
-- `quality_rating`/`visibility`/`collected_at`/the review fields are
-- ordinarily mutable.
CREATE OR REPLACE FUNCTION public.prevent_evidence_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.document_version_id IS DISTINCT FROM OLD.document_version_id THEN
    RAISE EXCEPTION
      'evidence.{tenant_id,organisation_id,engagement_id,document_version_id} are immutable after creation (evidence %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_prevent_reparenting
  BEFORE UPDATE ON "evidence"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_evidence_reparenting();

-- =============================================================================
-- 3. DocumentVersion version-number assignment — Milestone 6 instructions
--    §4: the application never sets `version_number` directly; it is
--    trigger-assigned, monotonically, per document. Runs BEFORE INSERT so
--    the value is in place before the `document_id, version_number`
--    UNIQUE constraint is checked. Not SECURITY DEFINER: `authenticated`
--    already has SELECT+INSERT on `document_versions` (§7 below), so the
--    internal MAX(...) lookup needs no elevated privilege — unlike the
--    SCD2 close-out triggers (migration 0003), which specifically needed
--    to bypass `authenticated`'s lack of an UPDATE grant.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assign_document_version_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version_number := COALESCE(
    (SELECT MAX(version_number) FROM document_versions WHERE document_id = NEW.document_id),
    0
  ) + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_versions_assign_version_number
  BEFORE INSERT ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION public.assign_document_version_number();

-- =============================================================================
-- 4. DocumentVersion immutability — Milestone 6 instructions §4/§14: "A
--    document version must be immutable after creation... ordinary
--    application/database paths cannot replace its storage object,
--    change its hash, change its version number, or change the
--    historical uploaded-by information. If correction is required,
--    create a new version." The one deliberate, narrow exception:
--    `scan_status` may transition exactly once, from 'pending' to a
--    terminal value — a placeholder for a future scanning integration
--    (DECISIONS.md D-05), not something this milestone's code writes to.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_document_version_tampering()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
     OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION
      'a document version is immutable after creation, except its scan_status (version %)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF OLD.scan_status IS DISTINCT FROM 'pending' AND NEW.scan_status IS DISTINCT FROM OLD.scan_status THEN
    RAISE EXCEPTION
      'document_versions.scan_status can only transition once, away from pending (version %)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER document_versions_prevent_tampering
  BEFORE UPDATE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_document_version_tampering();

-- =============================================================================
-- 5. EvidenceLink finalization lock — extends Milestone 5's finalized-
--    assessment immutability one hop further: once the Assessment behind
--    an EvidenceLink's subject is finalized, the link itself can no
--    longer be created or removed, matching Milestone 6 instructions §8's
--    "changing... must not silently rewrite the historical evidence
--    relationship." A standalone ControlTest (no assessment_id) is never
--    locked by this trigger, matching Milestone 5's own posture for it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_evidence_link_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_subject_type evidence_link_subject_type;
  v_assessment_response_id uuid;
  v_control_test_id uuid;
  v_status assessment_status;
BEGIN
  v_id := COALESCE(NEW.id, OLD.id);
  v_subject_type := COALESCE(NEW.subject_type, OLD.subject_type);
  v_assessment_response_id := COALESCE(NEW.assessment_response_id, OLD.assessment_response_id);
  v_control_test_id := COALESCE(NEW.control_test_id, OLD.control_test_id);

  IF v_subject_type = 'assessment_response' THEN
    SELECT a.status INTO v_status
      FROM assessment_responses ar
      JOIN assessment_controls ac ON ac.id = ar.assessment_control_id
      JOIN assessments a ON a.id = ac.assessment_id
      WHERE ar.id = v_assessment_response_id;
  ELSE
    SELECT a.status INTO v_status
      FROM control_tests ct
      JOIN assessments a ON a.id = ct.assessment_id
      WHERE ct.id = v_control_test_id;
  END IF;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION
      'cannot % an EvidenceLink whose subject belongs to a finalized assessment (subject_type %, link %)',
      TG_OP, v_subject_type, v_id
      USING ERRCODE = '23514';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER evidence_links_enforce_draft_mutable
  BEFORE INSERT OR DELETE ON "evidence_links"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_evidence_link_draft_mutable();

-- =============================================================================
-- 6. Enable RLS (FORCE, matching the posture established since migration 0001).
-- =============================================================================

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "evidence_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence_links" FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 7. Policies
-- =============================================================================
-- `documents`/`document_versions`/`evidence`/`evidence_links` are client
-- data (Milestone 6 instructions §11: "Ensure access respects Tenant →
-- Organisation → Engagement boundaries"), so every policy reuses
-- `public.can_access_engagement(uuid, uuid)` / `public.can_access_
-- organisation(uuid)` from migration 0001 unchanged (instructions §16:
-- "reuse the existing authorization helpers") — symmetric read/write,
-- matching ProcessingActivity/Assessment (Milestones 3/5), not Milestone
-- 4's Tenant-content read/write asymmetry (this isn't practice
-- methodology). Every table here is dual-shaped exactly like Evidence
-- itself (DATA_MODEL.md §4, DECISIONS.md R-14): engagement-scoped when
-- `engagement_id` is set, organisation-level otherwise — never
-- Tenant-only, since `organisation_id` is NOT NULL throughout this
-- migration's tables (unlike Milestone 5's `control_tests`, which has a
-- genuinely Tenant-only standalone shape).
--
-- The `visibility` (CONSULTANT_INTERNAL/CLIENT_VISIBLE) distinction is
-- deliberately NOT encoded here — SECURITY.md §2 already establishes
-- that this check belongs to the application/permission layer, not RLS
-- ("RLS policies are a poor fit for... the consultant-internal/client-
-- visible split"), and Milestone 6 instructions §12 ask to "preserve the
-- existing visibility model," not build a second one. See DECISIONS.md.

CREATE POLICY documents_select ON "documents" FOR SELECT TO authenticated USING (
  (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
  OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
);
CREATE POLICY documents_insert ON "documents" FOR INSERT TO authenticated WITH CHECK (
  (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
  OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
);
-- Reparenting is blocked unconditionally by §2's trigger regardless of
-- what this allows.
CREATE POLICY documents_update ON "documents" FOR UPDATE TO authenticated
  USING (
    (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
  )
  WITH CHECK (
    (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
  );
-- No DELETE policy — a Document is archived via `status`, never hard-deleted.

CREATE POLICY document_versions_select ON "document_versions" FOR SELECT TO authenticated USING (
  (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
  OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
);
CREATE POLICY document_versions_insert ON "document_versions" FOR INSERT TO authenticated WITH CHECK (
  (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
  OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
);
-- UPDATE exists solely so the one legitimate scan_status transition can
-- happen — §4's trigger is what actually restricts what succeeds.
CREATE POLICY document_versions_update ON "document_versions" FOR UPDATE TO authenticated
  USING (
    (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
  )
  WITH CHECK (
    (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
  );
-- No DELETE policy — a version is never removed; a correction is a new
-- version (instructions §4/§14).

CREATE POLICY evidence_select ON "evidence" FOR SELECT TO authenticated USING (
  (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
  OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
);
CREATE POLICY evidence_insert ON "evidence" FOR INSERT TO authenticated WITH CHECK (
  (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
  OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
);
CREATE POLICY evidence_update ON "evidence" FOR UPDATE TO authenticated
  USING (
    (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
  )
  WITH CHECK (
    (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
  );
-- No DELETE policy — Evidence is never hard-deleted; retire it via
-- `review_status = 'expired'`.

CREATE POLICY evidence_links_select ON "evidence_links" FOR SELECT TO authenticated USING (
  (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
  OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
);
CREATE POLICY evidence_links_insert ON "evidence_links" FOR INSERT TO authenticated WITH CHECK (
  (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
  OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
);
CREATE POLICY evidence_links_delete ON "evidence_links" FOR DELETE TO authenticated USING (
  (engagement_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
  OR (engagement_id IS NULL AND public.can_access_organisation(organisation_id))
);
-- No UPDATE policy — junction table, insert/delete only (DECISIONS.md R-35).

-- =============================================================================
-- 8. Auditability — Milestone 6 instructions §17: document creation,
--    document version creation, evidence creation, evidence review,
--    acceptance/rejection, expiry/status changes, EvidenceLink creation/
--    removal, and relevant metadata changes must all be auditable.
-- =============================================================================
-- No new trigger functions needed: every table in this migration carries
-- `tenant_id` directly, exactly the shape migration 0007's `log_
-- methodology_change()` / `log_methodology_relationship_change()` were
-- written for and migration 0009 already confirmed generalizes to a
-- second milestone's tables (DECISIONS.md R-56) — reused here unchanged
-- for a third. Status changes (review acceptance/rejection/expiry) are
-- plain UPDATEs on `evidence`, already captured generically.

CREATE TRIGGER documents_audit_log
  AFTER INSERT OR UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER document_versions_audit_log
  AFTER INSERT OR UPDATE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER evidence_audit_log
  AFTER INSERT OR UPDATE ON "evidence"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER evidence_links_audit_log
  AFTER INSERT OR DELETE ON "evidence_links"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();

-- =============================================================================
-- 9. Table-level GRANTs
-- =============================================================================
-- Same belt-and-suspenders posture as every earlier milestone: `anon`
-- gets nothing on any Milestone 6 table.

REVOKE ALL ON
  "documents",
  "document_versions",
  "evidence",
  "evidence_links"
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON "documents" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "document_versions" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "evidence" TO authenticated;
GRANT SELECT, INSERT, DELETE ON "evidence_links" TO authenticated;
