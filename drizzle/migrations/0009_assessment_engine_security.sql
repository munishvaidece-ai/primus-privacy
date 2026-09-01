-- PRIMUS PRIVACY — Migration 0009: security layer for the Assessment
-- Engine (0008_assessment_engine.sql).
--
-- Hand-written, not drizzle-kit generated — same rationale as migrations
-- 0001, 0003, 0005, and 0007 (DECISIONS.md R-02): RLS, triggers, and
-- cross-module immutability rules aren't modeled in the Drizzle TS
-- schema. Deployable to a real Supabase project as-is; assumes
-- migrations 0000-0008 are already applied.

-- =============================================================================
-- 1. Audit-column foreign keys to users(id)
-- =============================================================================
-- Added here via ALTER TABLE, not in the Drizzle TS schema — same
-- circular-import reasoning as every audit column since tenants.ts.
-- `assessment_responses.respondent_id` / `control_tests.tester_id` did
-- NOT need this treatment — both are direct Drizzle `.references()`
-- already, since neither users.ts nor those columns' own module has a
-- reason to import back the other way.

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "assessments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "assessment_controls"
  ADD CONSTRAINT "assessment_controls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "assessment_responses"
  ADD CONSTRAINT "assessment_responses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "assessment_responses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "control_tests"
  ADD CONSTRAINT "control_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "control_tests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

-- =============================================================================
-- 2. Reparenting guards — the scope-defining columns are immutable after
--    creation on every mutable assessment-engine table, for the same
--    reason as every earlier milestone's reparenting guards: RLS's WITH
--    CHECK can authorize a change but can't cleanly express "these
--    columns never change" without also blocking ordinary updates by
--    users who legitimately have write access. `assessment_controls` and
--    `assessment_responses`' own junction-adjacent rows need no
--    reparenting guard of their own beyond what §3's finalization guard
--    already blocks (assessment_controls has no UPDATE policy at all —
--    §5 — so there is nothing to reparent).
-- =============================================================================

-- `assessments.{engagement_id,organisation_id,tenant_id,control_library_
-- version_id}` — the last of these is the methodology pin itself; an
-- Assessment silently switching which library version it used would
-- defeat the entire historical-reproducibility guarantee this milestone
-- exists to build (Milestone 5 instructions §1/§12).
CREATE OR REPLACE FUNCTION public.prevent_assessment_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.control_library_version_id IS DISTINCT FROM OLD.control_library_version_id THEN
    RAISE EXCEPTION
      'assessments.{engagement_id,organisation_id,tenant_id,control_library_version_id} are immutable after creation (assessment %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assessments_prevent_reparenting
  BEFORE UPDATE ON "assessments"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_assessment_reparenting();

-- `assessment_responses.{assessment_control_id,tenant_id,organisation_id,
-- engagement_id}` — a response must always stay attached to the same
-- AssessmentControl it was created for; only the substantive fields
-- (ratings, rationale, respondent, timestamp) are ordinarily mutable.
CREATE OR REPLACE FUNCTION public.prevent_assessment_response_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assessment_control_id IS DISTINCT FROM OLD.assessment_control_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id THEN
    RAISE EXCEPTION
      'assessment_responses.{assessment_control_id,tenant_id,organisation_id,engagement_id} are immutable after creation (response %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assessment_responses_prevent_reparenting
  BEFORE UPDATE ON "assessment_responses"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_assessment_response_reparenting();

-- `control_tests.{control_id,tenant_id,assessment_id,organisation_id,
-- engagement_id}` — only the descriptive test fields (methodology,
-- sample_description, result, tester_id, tested_at) are ordinarily
-- mutable. This also blocks retroactively attaching a previously-
-- standalone test to an Assessment (or detaching it) after the fact —
-- the assessment_id/organisation_id/engagement_id set at creation are
-- permanent.
CREATE OR REPLACE FUNCTION public.prevent_control_test_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.control_id IS DISTINCT FROM OLD.control_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id THEN
    RAISE EXCEPTION
      'control_tests.{control_id,tenant_id,assessment_id,organisation_id,engagement_id} are immutable after creation (control test %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER control_tests_prevent_reparenting
  BEFORE UPDATE ON "control_tests"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_control_test_reparenting();

-- =============================================================================
-- 3. Finalization immutability — Milestone 5 instructions §10: "Finalized
--    assessments must be protected from ordinary mutation... never
--    silently overwrite the historical final assessment." DATA_MODEL.md
--    §6 names this explicitly for AssessmentResponse ("its
--    AssessmentResponse rows become read-only at the application
--    layer"); this migration enforces it at the DATABASE layer, and
--    extends the same protection to AssessmentControl and ControlTest
--    (when tied to the finalized assessment) — instructions §10's own
--    framing ("Finalized assessments must be protected from ordinary
--    mutation") is about the whole assessment, not only its responses
--    (DECISIONS.md).
-- =============================================================================

-- The Assessment row itself: once 'finalized', no further UPDATE of any
-- kind succeeds — not even a no-op. Un-finalizing is not a supported
-- transition (DATA_MODEL.md §6: a correction opens a new Assessment via
-- previous_assessment_id instead). Two states only (enums.ts), so no
-- other transition logic is needed — draft -> finalized is the only
-- state change and this trigger doesn't need to gate it at all, since
-- nothing else is ever blocked while still draft.
CREATE OR REPLACE FUNCTION public.prevent_finalized_assessment_tampering()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION
      'a finalized assessment is immutable (assessment %)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assessments_prevent_finalized_tampering
  BEFORE UPDATE ON "assessments"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_finalized_assessment_tampering();

-- AssessmentControl: a control's inclusion/exclusion from scope must
-- freeze once the assessment is finalized — insert/delete only, gated by
-- the parent Assessment's status.
CREATE OR REPLACE FUNCTION public.enforce_assessment_control_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status assessment_status;
  v_assessment_id uuid;
BEGIN
  v_assessment_id := COALESCE(NEW.assessment_id, OLD.assessment_id);
  SELECT status INTO v_status FROM assessments WHERE id = v_assessment_id;
  IF v_status = 'finalized' THEN
    RAISE EXCEPTION
      'cannot % an AssessmentControl on a finalized assessment (assessment %)',
      TG_OP, v_assessment_id
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER assessment_controls_enforce_draft_mutable
  BEFORE INSERT OR DELETE ON "assessment_controls"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assessment_control_draft_mutable();

-- AssessmentResponse: the exact "AssessmentResponse rows become read-only"
-- rule DATA_MODEL.md §6 names directly. Resolves the parent Assessment's
-- status via assessment_control_id -> assessment_controls -> assessments
-- (a two-level join is unavoidable here — AssessmentResponse denormalizes
-- tenant/organisation/engagement but not the Assessment's own status,
-- which is exactly the kind of frequently-changing value that should
-- never be copied onto a dependent row).
CREATE OR REPLACE FUNCTION public.enforce_assessment_response_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status assessment_status;
  v_assessment_control_id uuid;
BEGIN
  v_assessment_control_id := COALESCE(NEW.assessment_control_id, OLD.assessment_control_id);
  SELECT a.status INTO v_status
    FROM assessment_controls ac
    JOIN assessments a ON a.id = ac.assessment_id
    WHERE ac.id = v_assessment_control_id;
  IF v_status = 'finalized' THEN
    RAISE EXCEPTION
      'cannot % an AssessmentResponse on a finalized assessment (assessment control %)',
      TG_OP, v_assessment_control_id
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER assessment_responses_enforce_draft_mutable
  BEFORE INSERT OR UPDATE OR DELETE ON "assessment_responses"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assessment_response_draft_mutable();

-- ControlTest: gated only when assessment_id IS NOT NULL (a standalone,
-- continuous-monitoring test has no assessment to finalize against, and
-- is never locked by this trigger).
CREATE OR REPLACE FUNCTION public.enforce_control_test_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status assessment_status;
  v_assessment_id uuid;
BEGIN
  v_assessment_id := COALESCE(NEW.assessment_id, OLD.assessment_id);
  IF v_assessment_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_status FROM assessments WHERE id = v_assessment_id;
  IF v_status = 'finalized' THEN
    RAISE EXCEPTION
      'cannot % a ControlTest tied to a finalized assessment (assessment %)',
      TG_OP, v_assessment_id
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER control_tests_enforce_draft_mutable
  BEFORE INSERT OR UPDATE OR DELETE ON "control_tests"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_control_test_draft_mutable();

-- =============================================================================
-- 4. Enable RLS (FORCE, matching the posture established since migration 0001).
-- =============================================================================

ALTER TABLE "assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assessment_controls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_controls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "assessment_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_responses" FORCE ROW LEVEL SECURITY;
ALTER TABLE "control_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "control_tests" FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 5. Policies
-- =============================================================================
-- `assessments`/`assessment_controls`/`assessment_responses` are client
-- engagement data (Milestone 5 instructions §14: "All assessment objects
-- must respect Tenant → Organisation → Engagement boundaries"), so they
-- reuse `public.can_access_engagement(uuid, uuid)` from migration 0001
-- unchanged (instructions §15: no second authorization framework) —
-- symmetric read/write, exactly matching ProcessingActivity's own model
-- (migration 0005), not Milestone 4's Tenant-content read/write
-- asymmetry (that asymmetry was specifically about practice-governed
-- methodology; an Assessment is client work, performed by whoever has
-- engagement access).
--
-- `control_tests` is genuinely dual-shaped (see control-tests.ts's file
-- comment): each policy branches on whether `assessment_id` is set.

CREATE POLICY assessments_select ON "assessments"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY assessments_insert ON "assessments"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
-- Reparenting is blocked unconditionally by §2's trigger; finalization
-- immutability by §3's — this policy only decides ordinary access.
CREATE POLICY assessments_update ON "assessments"
  FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
-- No DELETE policy — an Assessment is never hard-deleted, matching every
-- substantive (non-junction) table since Milestone 2.

CREATE POLICY assessment_controls_select ON "assessment_controls"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY assessment_controls_insert ON "assessment_controls"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY assessment_controls_delete ON "assessment_controls"
  FOR DELETE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
-- No UPDATE policy — junction table, insert/delete only (§2's own
-- comment / DECISIONS.md R-35's established convention).

CREATE POLICY assessment_responses_select ON "assessment_responses"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY assessment_responses_insert ON "assessment_responses"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY assessment_responses_update ON "assessment_responses"
  FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
-- No DELETE policy — a response is corrected by editing it while still
-- draft, or by a new Assessment after finalization; it is never removed
-- outright (documented, not silently decided — DECISIONS.md).

-- control_tests: dual-mode, matching the file's two scoping shapes.
CREATE POLICY control_tests_select ON "control_tests"
  FOR SELECT TO authenticated
  USING (
    (assessment_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (assessment_id IS NULL AND public.can_access_tenant(tenant_id))
  );
CREATE POLICY control_tests_insert ON "control_tests"
  FOR INSERT TO authenticated
  WITH CHECK (
    (assessment_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (assessment_id IS NULL AND public.is_active_tenant_member(tenant_id))
  );
CREATE POLICY control_tests_update ON "control_tests"
  FOR UPDATE TO authenticated
  USING (
    (assessment_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (assessment_id IS NULL AND public.is_active_tenant_member(tenant_id))
  )
  WITH CHECK (
    (assessment_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (assessment_id IS NULL AND public.is_active_tenant_member(tenant_id))
  );
CREATE POLICY control_tests_delete ON "control_tests"
  FOR DELETE TO authenticated
  USING (
    (assessment_id IS NOT NULL AND public.can_access_engagement(engagement_id, organisation_id))
    OR (assessment_id IS NULL AND public.is_active_tenant_member(tenant_id))
  );

-- =============================================================================
-- 6. Auditability — Milestone 5 instructions §16: assessment creation,
--    status transitions, control inclusion, response changes, rationale
--    changes, test creation/modification, and finalization must all be
--    auditable, reusing the existing audit-log architecture.
-- =============================================================================
-- No new trigger functions needed: every assessment-engine table already
-- denormalizes `tenant_id` directly (§2 above / migration 0008),
-- exactly the shape migration 0007's `log_methodology_change()` /
-- `log_methodology_relationship_change()` were written for — reusing
-- them unchanged here, rather than migration 0003/0005's organisation-
-- id-joining variant, is a closer fit (not a rewrite of those functions,
-- just a new set of callers) and satisfies "reuse the existing audit-log
-- architecture" more precisely than introducing a third variant would.
-- Status transitions and finalization are both plain UPDATEs on
-- `assessments`, already captured generically.

CREATE TRIGGER assessments_audit_log
  AFTER INSERT OR UPDATE ON "assessments"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER assessment_controls_audit_log
  AFTER INSERT OR DELETE ON "assessment_controls"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();
CREATE TRIGGER assessment_responses_audit_log
  AFTER INSERT OR UPDATE ON "assessment_responses"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER control_tests_audit_log
  AFTER INSERT OR UPDATE ON "control_tests"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

-- =============================================================================
-- 7. Table-level GRANTs
-- =============================================================================
-- Same belt-and-suspenders posture as every earlier milestone: `anon`
-- gets nothing on any Milestone 5 table.

REVOKE ALL ON
  "assessments",
  "assessment_controls",
  "assessment_responses",
  "control_tests"
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON "assessments" TO authenticated;
GRANT SELECT, INSERT, DELETE ON "assessment_controls" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "assessment_responses" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "control_tests" TO authenticated;
