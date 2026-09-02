-- PRIMUS PRIVACY — Migration 0028: security layer for Applicability &
-- Scope (0027_applicability_scope.sql).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- earlier security-layer migration (0001, 0003, 0005, 0007, 0009, 0011,
-- 0013, 0015, 0017; DECISIONS.md R-02). Deployable to a real Supabase
-- project as-is; assumes migrations 0000-0027 are already applied.

-- =============================================================================
-- 1. Audit-column foreign keys to users(id)
-- =============================================================================

ALTER TABLE "engagement_scopes"
  ADD CONSTRAINT "engagement_scopes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "engagement_scopes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "engagement_scope_controls"
  ADD CONSTRAINT "engagement_scope_controls_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "engagement_scope_controls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "engagement_scope_controls_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "applicability_determinations"
  ADD CONSTRAINT "applicability_determinations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "applicability_determinations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "applicability_determinations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "applicability_determination_regulatory_references"
  ADD CONSTRAINT "ad_regulatory_references_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "assessment_controls"
  ADD CONSTRAINT "assessment_controls_applicability_decided_by_users_id_fk" FOREIGN KEY ("applicability_decided_by") REFERENCES "users"("id");

-- =============================================================================
-- 2. Reparenting guards — the scope-defining columns are immutable after
--    creation, matching every earlier milestone's own reparenting guards
--    (Milestone 5's `prevent_assessment_reparenting` is the closest
--    precedent, reused in shape here).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_engagement_scope_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.control_library_version_id IS DISTINCT FROM OLD.control_library_version_id
     OR NEW.previous_scope_version_id IS DISTINCT FROM OLD.previous_scope_version_id THEN
    RAISE EXCEPTION
      'engagement_scopes.{engagement_id,organisation_id,tenant_id,control_library_version_id,previous_scope_version_id} are immutable after creation (scope %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_scopes_prevent_reparenting
  BEFORE UPDATE ON "engagement_scopes"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_engagement_scope_reparenting();

CREATE OR REPLACE FUNCTION public.prevent_engagement_scope_control_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.engagement_scope_id IS DISTINCT FROM OLD.engagement_scope_id
     OR NEW.control_id IS DISTINCT FROM OLD.control_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.control_library_version_id IS DISTINCT FROM OLD.control_library_version_id THEN
    RAISE EXCEPTION
      'engagement_scope_controls.{engagement_scope_id,control_id,tenant_id,organisation_id,engagement_id,control_library_version_id} are immutable after creation (row %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_scope_controls_prevent_reparenting
  BEFORE UPDATE ON "engagement_scope_controls"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_engagement_scope_control_reparenting();

CREATE OR REPLACE FUNCTION public.prevent_applicability_determination_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.engagement_scope_id IS DISTINCT FROM OLD.engagement_scope_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id THEN
    RAISE EXCEPTION
      'applicability_determinations.{engagement_scope_id,tenant_id,organisation_id,engagement_id} are immutable after creation (determination %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER applicability_determinations_prevent_reparenting
  BEFORE UPDATE ON "applicability_determinations"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_applicability_determination_reparenting();

-- =============================================================================
-- 3. Lock immutability — D3 §4: "once locked: Scope header immutable,
--    RegulatoryReference applicability immutable, Control applicability
--    immutable." Mirrors migration 0009's finalization-immutability
--    family exactly, one level up (Assessment -> EngagementScope).
-- =============================================================================

-- The EngagementScope row itself: once 'locked', no further UPDATE of
-- any kind succeeds — not even a no-op. "Reopening" is not a supported
-- transition (D3 §4: "Do NOT implement a 'reopen' action" — a
-- correction opens a NEW EngagementScope via previous_scope_version_id
-- instead, the identical Assessment precedent).
CREATE OR REPLACE FUNCTION public.prevent_locked_engagement_scope_tampering()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION
      'a locked engagement scope is immutable (scope %)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_scopes_prevent_locked_tampering
  BEFORE UPDATE ON "engagement_scopes"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_engagement_scope_tampering();

-- EngagementScopeControl: a Control's applicability decision must
-- freeze once its parent EngagementScope is locked.
CREATE OR REPLACE FUNCTION public.enforce_engagement_scope_control_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status engagement_scope_status;
  v_scope_id uuid;
BEGIN
  v_scope_id := COALESCE(NEW.engagement_scope_id, OLD.engagement_scope_id);
  SELECT status INTO v_status FROM engagement_scopes WHERE id = v_scope_id;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION
      'cannot % an EngagementScopeControl on a locked scope (scope %)',
      TG_OP, v_scope_id
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER engagement_scope_controls_enforce_draft_mutable
  BEFORE INSERT OR UPDATE ON "engagement_scope_controls"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_engagement_scope_control_draft_mutable();

-- ApplicabilityDetermination: same rule, one level up.
CREATE OR REPLACE FUNCTION public.enforce_applicability_determination_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status engagement_scope_status;
  v_scope_id uuid;
BEGIN
  v_scope_id := COALESCE(NEW.engagement_scope_id, OLD.engagement_scope_id);
  SELECT status INTO v_status FROM engagement_scopes WHERE id = v_scope_id;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION
      'cannot % an ApplicabilityDetermination on a locked scope (scope %)',
      TG_OP, v_scope_id
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER applicability_determinations_enforce_draft_mutable
  BEFORE INSERT OR UPDATE ON "applicability_determinations"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_applicability_determination_draft_mutable();

-- ApplicabilityDeterminationRegulatoryReference: insert/delete-only
-- junction (matching every other junction since Milestone 3,
-- DECISIONS.md R-35) — gated the same way, via a two-level resolution
-- (determination -> scope), mirroring `assessment_responses_enforce_
-- draft_mutable`'s own two-level join.
CREATE OR REPLACE FUNCTION public.enforce_ad_regulatory_reference_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status engagement_scope_status;
  v_determination_id uuid;
BEGIN
  v_determination_id := COALESCE(NEW.applicability_determination_id, OLD.applicability_determination_id);
  SELECT es.status INTO v_status
    FROM applicability_determinations ad
    JOIN engagement_scopes es ON es.id = ad.engagement_scope_id
    WHERE ad.id = v_determination_id;
  IF v_status = 'locked' THEN
    RAISE EXCEPTION
      'cannot % an ApplicabilityDeterminationRegulatoryReference on a locked scope (determination %)',
      TG_OP, v_determination_id
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER ad_regulatory_references_enforce_draft_mutable
  BEFORE INSERT OR DELETE ON "applicability_determination_regulatory_references"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ad_regulatory_reference_draft_mutable();

-- No new trigger for `assessment_controls`' own D3 snapshot columns
-- (applicability_decision/rationale/decided_by/decided_at/engagement_
-- scope_control_id): no application code path ever UPDATEs them after
-- `createAssessment` writes them once — the identical "immutable by
-- omission" reasoning already documented for `control_library_version_
-- id` on this same table (migration 0008). The table's own pre-existing
-- finalization-immutability trigger (`assessment_controls_enforce_
-- draft_mutable`, migration 0009) covers INSERT/DELETE only (this table
-- has no UPDATE policy at all — see 0009 §5) — nothing about that
-- changes here.

-- =============================================================================
-- 4. Enable RLS (FORCE, matching the posture established since migration 0001).
-- =============================================================================

ALTER TABLE "engagement_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_scopes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engagement_scope_controls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_scope_controls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "applicability_determinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applicability_determinations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "applicability_determination_regulatory_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applicability_determination_regulatory_references" FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 5. Policies
-- =============================================================================
-- Reuses `public.can_access_engagement(uuid, uuid)` (migration 0001)
-- for ordinary read/propose/edit access — the same coarse rule every
-- engagement-scoped table already uses (D3 §9: Consultant may
-- propose/edit a draft Scope with plain engagement access). LOCKING is
-- the one narrower, permission-gated transition — mirroring migration
-- 0025's exact narrowing shape (`assessment.finalize`), applied here to
-- the new, DEDICATED `scope.lock` permission (D3 approval, Change 3):
-- deliberately NOT the same permission as `assessment.finalize`, even
-- though both currently resolve to the same seeded role (Engagement
-- Manager) — see db/seed/roles.ts and DECISIONS.md for why they must
-- stay independently controllable.

CREATE POLICY engagement_scopes_select ON "engagement_scopes"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY engagement_scopes_insert ON "engagement_scopes"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
-- Reparenting is blocked unconditionally by §2's trigger; lock
-- immutability by §3's — this policy only decides ordinary access PLUS
-- the one narrower rule for the draft -> locked transition itself.
CREATE POLICY engagement_scopes_update ON "engagement_scopes"
  FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (
    public.can_access_engagement(engagement_id, organisation_id)
    AND (
      status != 'locked'
      OR public.has_engagement_permission(engagement_id, 'scope.lock')
      OR public.has_organisation_permission(organisation_id, 'scope.lock')
    )
  );
-- No DELETE policy — a Scope version is never hard-deleted, matching
-- every substantive (non-junction) table since Milestone 2.

CREATE POLICY engagement_scope_controls_select ON "engagement_scope_controls"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY engagement_scope_controls_insert ON "engagement_scope_controls"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY engagement_scope_controls_update ON "engagement_scope_controls"
  FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
-- No DELETE policy — every Control in the pinned library gets exactly
-- one pre-populated row (mirroring AssessmentControl's own population);
-- "undoing" a decision means setting it back to 'undecided', never
-- removing the row.

CREATE POLICY applicability_determinations_select ON "applicability_determinations"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY applicability_determinations_insert ON "applicability_determinations"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY applicability_determinations_update ON "applicability_determinations"
  FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
-- No DELETE policy — matches EngagementScopeControl's own posture
-- above (edit in place while draft, never remove).

CREATE POLICY ad_regulatory_references_select ON "applicability_determination_regulatory_references"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY ad_regulatory_references_insert ON "applicability_determination_regulatory_references"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY ad_regulatory_references_delete ON "applicability_determination_regulatory_references"
  FOR DELETE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
-- No UPDATE policy — junction table, insert/delete only (DECISIONS.md R-35).

-- =============================================================================
-- 6. Auditability — D3 §13: Scope creation, decision changes while
--    draft, lock, and revision must all be auditable. No new audit
--    function needed: every D3 table denormalizes `tenant_id` directly
--    (§1 above), the exact shape `log_methodology_change()`/`log_
--    methodology_relationship_change()` (migration 0007, already reused
--    unchanged by the entire Assessment Engine, migration 0009) were
--    written for.
-- =============================================================================

CREATE TRIGGER engagement_scopes_audit_log
  AFTER INSERT OR UPDATE ON "engagement_scopes"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER engagement_scope_controls_audit_log
  AFTER INSERT OR UPDATE ON "engagement_scope_controls"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER applicability_determinations_audit_log
  AFTER INSERT OR UPDATE ON "applicability_determinations"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER ad_regulatory_references_audit_log
  AFTER INSERT OR DELETE ON "applicability_determination_regulatory_references"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();

-- =============================================================================
-- 7. Table-level GRANTs
-- =============================================================================
-- Same belt-and-suspenders posture as every earlier milestone: `anon`
-- gets nothing on any Slice D3 table.

REVOKE ALL ON
  "engagement_scopes",
  "engagement_scope_controls",
  "applicability_determinations",
  "applicability_determination_regulatory_references"
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON "engagement_scopes" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "engagement_scope_controls" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "applicability_determinations" TO authenticated;
GRANT SELECT, INSERT, DELETE ON "applicability_determination_regulatory_references" TO authenticated;
