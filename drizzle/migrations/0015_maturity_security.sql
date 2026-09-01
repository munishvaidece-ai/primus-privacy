-- PRIMUS PRIVACY — Migration 0015: security layer for Maturity
-- (0014_maturity.sql).
--
-- Hand-written, not drizzle-kit generated — same rationale as migrations
-- 0001, 0003, 0005, 0007, 0009, 0011, and 0013 (DECISIONS.md R-02): RLS,
-- triggers, and cross-module immutability rules aren't modeled in the
-- Drizzle TS schema. Deployable to a real Supabase project as-is;
-- assumes migrations 0000-0014 are already applied.

-- =============================================================================
-- 1. The partial-unique constraint drizzle's declarative `unique()` can't
--    express: "at most one overall (maturity_domain_id IS NULL) row per
--    MaturityAssessment." Postgres treats NULLs as pairwise distinct in
--    an ordinary UNIQUE constraint, so `maturity_scores`' own
--    `maturity_assessment_id, maturity_domain_id` UNIQUE (0014) already
--    correctly enforces "at most one row per domain," but does nothing
--    to stop two overall rows both carrying maturity_domain_id = NULL —
--    only a partial UNIQUE INDEX can express that.
-- =============================================================================

CREATE UNIQUE INDEX "maturity_scores_one_overall_per_assessment_key"
  ON "maturity_scores" ("maturity_assessment_id")
  WHERE "maturity_domain_id" IS NULL;

-- =============================================================================
-- 2. Audit-column foreign keys to users(id)
-- =============================================================================
-- Added here via ALTER TABLE, not in the Drizzle TS schema — same
-- circular-import reasoning as every audit column since tenants.ts.
-- `maturity_assessments.computed_by` did NOT need this treatment — it's
-- a direct Drizzle `.references()` already.

ALTER TABLE "maturity_scoring_methodologies"
  ADD CONSTRAINT "maturity_scoring_methodologies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "maturity_scoring_methodologies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "maturity_domains"
  ADD CONSTRAINT "maturity_domains_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "maturity_domains_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "maturity_domain_weights"
  ADD CONSTRAINT "maturity_domain_weights_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "maturity_domain_weights_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "maturity_domain_control_mappings"
  ADD CONSTRAINT "maturity_domain_control_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "maturity_assessments"
  ADD CONSTRAINT "maturity_assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "maturity_assessments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "maturity_scores"
  ADD CONSTRAINT "maturity_scores_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

-- =============================================================================
-- 3. Reparenting guards
-- =============================================================================

-- `maturity_domains.tenant_id` — the only scope column this table has.
-- `name`/`description`/`code`/`is_active` remain ordinarily mutable
-- (Milestone 8 instructions §4: no versioned framework invented for
-- domains — see maturity-domains.ts / DECISIONS.md).
CREATE OR REPLACE FUNCTION public.prevent_maturity_domain_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION
      'maturity_domains.tenant_id is immutable after creation (maturity domain %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maturity_domains_prevent_reparenting
  BEFORE UPDATE ON "maturity_domains"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_maturity_domain_reparenting();

-- `maturity_assessments.{engagement_id,organisation_id,tenant_id,
-- assessment_id,maturity_scoring_methodology_id}` — the source Assessment
-- and the pinned methodology are as permanent as the scope triple itself
-- (Milestone 8 instructions §3/§9: historical reproducibility depends on
-- both never silently changing). `status`/`computed_at`/`computed_by`/
-- `finalized_at`/the two traceability arrays remain mutable while
-- 'draft' — §5 below's finalization trigger is what locks those once
-- 'finalized', not this trigger.
CREATE OR REPLACE FUNCTION public.prevent_maturity_assessment_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id
     OR NEW.maturity_scoring_methodology_id IS DISTINCT FROM OLD.maturity_scoring_methodology_id THEN
    RAISE EXCEPTION
      'maturity_assessments.{engagement_id,organisation_id,tenant_id,assessment_id,maturity_scoring_methodology_id} are immutable after creation (maturity assessment %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maturity_assessments_prevent_reparenting
  BEFORE UPDATE ON "maturity_assessments"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_maturity_assessment_reparenting();

-- =============================================================================
-- 4. MaturityScoringMethodology append-only close-out — the same
--    "configurable scoring methodology, frozen for reproducibility"
--    guarantee Milestone 7 built for `RiskScoringModel` (DECISIONS.md
--    R-67), applied here per Milestone 8 instructions §9: "do not allow a
--    new methodology version to silently recalculate historical
--    maturity." Identical mechanism to `risk_scoring_models_close_out_
--    previous` (migration 0013), scoped per `tenant_id` — not a new
--    mechanism. `authenticated` has no UPDATE grant on this table at all
--    (§11 below), so every field besides `is_active` is unconditionally
--    immutable too, with no separate tampering-guard trigger needed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.close_out_previous_active_maturity_scoring_methodology()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_active THEN
    UPDATE maturity_scoring_methodologies
    SET is_active = false
    WHERE tenant_id = NEW.tenant_id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maturity_scoring_methodologies_close_out_previous
  BEFORE INSERT ON "maturity_scoring_methodologies"
  FOR EACH ROW EXECUTE FUNCTION public.close_out_previous_active_maturity_scoring_methodology();

-- =============================================================================
-- 4b. MaturityDomainWeight append-only close-out — DATA_MODEL.md §9's own
--    explicit rule: "the same rule as RiskScoringModel applies to
--    MaturityDomainWeight: it is never edited after the engagement's
--    MaturityScore rows have been computed from it." Identical mechanism
--    to `risk_scoring_models_close_out_previous` (migration 0013), scoped
--    per (engagement_id, maturity_domain_id) instead of per tenant_id —
--    not a new mechanism. `authenticated` has no UPDATE grant on this
--    table at all (§11 below), so every field besides `is_active` is
--    unconditionally immutable too, with no separate tampering-guard
--    trigger needed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.close_out_previous_active_maturity_domain_weight()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_active THEN
    UPDATE maturity_domain_weights
    SET is_active = false
    WHERE engagement_id = NEW.engagement_id
      AND maturity_domain_id = NEW.maturity_domain_id
      AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maturity_domain_weights_close_out_previous
  BEFORE INSERT ON "maturity_domain_weights"
  FOR EACH ROW EXECUTE FUNCTION public.close_out_previous_active_maturity_domain_weight();

-- =============================================================================
-- 5. MaturityAssessment finalization guard — Milestone 8 instructions
--    §12: "once a MaturityAssessment is finalized: its score/domain
--    results/methodology version/source assessment context must not
--    silently change... if the current architecture defines only a
--    simple finalized state, implement that rather than inventing a
--    complex workflow." Mirrors `prevent_finalized_assessment_tampering`
--    (migration 0009) exactly: once 'finalized', no further UPDATE of
--    any kind succeeds, not even a no-op; the one legitimate transition
--    (draft -> finalized) stamps `finalized_at` automatically, the same
--    "trigger stamps the timestamp, application never sets it directly"
--    pattern `control_library_versions.published_at` uses (migration
--    0007). Un-finalizing is not a supported transition.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_maturity_assessment_finalization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION
      'a finalized maturity assessment is immutable (maturity assessment %)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  -- OLD.status = 'draft' here (only two states exist).
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IS DISTINCT FROM 'finalized' THEN
      RAISE EXCEPTION
        'a draft maturity assessment may only transition to finalized (attempted %, maturity assessment %)',
        NEW.status, OLD.id
        USING ERRCODE = '23514';
    END IF;
    IF NEW.finalized_at IS NULL THEN
      NEW.finalized_at := now();
    END IF;
  ELSIF NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
    RAISE EXCEPTION
      'maturity_assessments.finalized_at cannot be set directly (maturity assessment %)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER maturity_assessments_enforce_finalization
  BEFORE UPDATE ON "maturity_assessments"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_maturity_assessment_finalization();

-- =============================================================================
-- 6. Require a finalized source Assessment — Milestone 8 instructions §7:
--    Maturity consumes "finalized Assessment Responses." Enforced at the
--    database layer at the moment a MaturityAssessment is created, not
--    merely by application convention — mirrors `enforce_assessment_
--    control_draft_mutable`'s (migration 0009) resolve-then-check
--    pattern, applied to a cross-table INSERT precondition instead of a
--    same-row lock.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.require_finalized_assessment_for_maturity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status assessment_status;
BEGIN
  SELECT status INTO v_status FROM assessments WHERE id = NEW.assessment_id;
  IF v_status IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION
      'a MaturityAssessment can only be computed from a finalized Assessment (assessment %, status %)',
      NEW.assessment_id, v_status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maturity_assessments_require_finalized_assessment
  BEFORE INSERT ON "maturity_assessments"
  FOR EACH ROW EXECUTE FUNCTION public.require_finalized_assessment_for_maturity();

-- =============================================================================
-- 7. MaturityScore insert-gate — DATA_MODEL.md §9: "MaturityScore rows
--    are produced only by the Maturity engine's recalculation routine...
--    never by a direct user edit to a score." Combined with the total
--    absence of an UPDATE/DELETE grant (§9 below), a MaturityScore is
--    fully immutable the instant it exists; this trigger additionally
--    gates *insertion* itself — mirrors `enforce_assessment_control_
--    draft_mutable` (migration 0009): rows may only be inserted while
--    the parent is still 'draft', so a MaturityAssessment's entire set of
--    scores becomes permanently closed the moment it is finalized, not
--    merely each existing row individually frozen.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_maturity_score_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status maturity_assessment_status;
BEGIN
  SELECT status INTO v_status FROM maturity_assessments WHERE id = NEW.maturity_assessment_id;
  IF v_status = 'finalized' THEN
    RAISE EXCEPTION
      'cannot insert a MaturityScore for a finalized MaturityAssessment (maturity assessment %)',
      NEW.maturity_assessment_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maturity_scores_enforce_draft_mutable
  BEFORE INSERT ON "maturity_scores"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_maturity_score_draft_mutable();

-- =============================================================================
-- 8. Enable RLS (FORCE, matching the posture established since migration 0001).
-- =============================================================================

ALTER TABLE "maturity_scoring_methodologies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maturity_scoring_methodologies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "maturity_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maturity_domains" FORCE ROW LEVEL SECURITY;
ALTER TABLE "maturity_domain_weights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maturity_domain_weights" FORCE ROW LEVEL SECURITY;
ALTER TABLE "maturity_domain_control_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maturity_domain_control_mappings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "maturity_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maturity_assessments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "maturity_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maturity_scores" FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 9. Policies
-- =============================================================================
-- `MaturityScoringMethodology`/`MaturityDomain` are Tenant-scoped
-- practice methodology (like `ControlLibraryVersion`/`RiskScoringModel`/
-- `Control`) — reuse the same `can_access_tenant`(read)/`is_active_
-- tenant_member`(write) asymmetry (DECISIONS.md R-47).
-- `MaturityDomainWeight`/`MaturityAssessment`/`MaturityScore` are client
-- engagement data — symmetric `can_access_engagement`, all reusing
-- migration 0001's helpers unchanged (Milestone 8 instructions §14: no
-- second authorization framework). `MaturityDomainControlMapping` is a
-- Tenant-scoped junction (both sides are practice methodology), mirroring
-- `control_requirements`'s own read/write shape exactly (migration 0007).

CREATE POLICY maturity_scoring_methodologies_select ON "maturity_scoring_methodologies" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY maturity_scoring_methodologies_insert ON "maturity_scoring_methodologies" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
-- No UPDATE/DELETE policy — append-only (§4 in migration 0014's schema
-- comment, mirroring risk_scoring_models); the close-out trigger's own
-- internal UPDATE runs as SECURITY DEFINER, bypassing the complete
-- absence of an UPDATE grant for `authenticated` (§9 below is a
-- misnumber-safe reference — see the GRANT section below).

CREATE POLICY maturity_domains_select ON "maturity_domains" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY maturity_domains_insert ON "maturity_domains" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
CREATE POLICY maturity_domains_update ON "maturity_domains" FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id))
  WITH CHECK (public.is_active_tenant_member(tenant_id));

CREATE POLICY maturity_domain_weights_select ON "maturity_domain_weights" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY maturity_domain_weights_insert ON "maturity_domain_weights" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
-- No UPDATE/DELETE policy — append-only (§4 above).

CREATE POLICY maturity_domain_control_mappings_select ON "maturity_domain_control_mappings" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY maturity_domain_control_mappings_insert ON "maturity_domain_control_mappings" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
CREATE POLICY maturity_domain_control_mappings_delete ON "maturity_domain_control_mappings" FOR DELETE TO authenticated USING (public.is_active_tenant_member(tenant_id));

CREATE POLICY maturity_assessments_select ON "maturity_assessments" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY maturity_assessments_insert ON "maturity_assessments" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY maturity_assessments_update ON "maturity_assessments" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));

-- MaturityScore: SELECT/INSERT only — "never directly user-editable"
-- (DATA_MODEL.md §9, verbatim). No UPDATE/DELETE policy or grant at all.
CREATE POLICY maturity_scores_select ON "maturity_scores" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY maturity_scores_insert ON "maturity_scores" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));

-- =============================================================================
-- 10. Auditability — Milestone 8 instructions §15: creation, scoring/
--     calculation, status/finalization, methodology-version association,
--     and material changes while draft must all be auditable; finalized
--     historical maturity must remain reconstructable.
-- =============================================================================
-- No new trigger functions needed: every table in this migration already
-- carries `tenant_id` directly, the same shape migration 0007's
-- `log_methodology_change()`/`log_methodology_relationship_change()`
-- were written for and every later milestone since has confirmed
-- generalizes (DECISIONS.md R-46/R-56) — reused here unchanged for a
-- fifth milestone in a row. `MaturityScoringMethodology`/
-- `MaturityDomainWeight`/`MaturityScore` are audited on INSERT only
-- (never updated); `MaturityDomain`/`MaturityAssessment` are audited on
-- INSERT and UPDATE (both are ordinarily mutable, at least while
-- `MaturityAssessment` is still draft — the finalization event itself is
-- simply the UPDATE that flips `status`, captured the same way every
-- other material update is).

CREATE TRIGGER maturity_scoring_methodologies_audit_log
  AFTER INSERT ON "maturity_scoring_methodologies"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER maturity_domains_audit_log
  AFTER INSERT OR UPDATE ON "maturity_domains"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER maturity_domain_weights_audit_log
  AFTER INSERT ON "maturity_domain_weights"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER maturity_domain_control_mappings_audit_log
  AFTER INSERT OR DELETE ON "maturity_domain_control_mappings"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();
CREATE TRIGGER maturity_assessments_audit_log
  AFTER INSERT OR UPDATE ON "maturity_assessments"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER maturity_scores_audit_log
  AFTER INSERT ON "maturity_scores"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

-- =============================================================================
-- 11. Table-level GRANTs
-- =============================================================================
-- Same belt-and-suspenders posture as every earlier milestone: `anon`
-- gets nothing on any Milestone 8 table.

REVOKE ALL ON
  "maturity_scoring_methodologies", "maturity_domains", "maturity_domain_weights",
  "maturity_domain_control_mappings", "maturity_assessments", "maturity_scores"
FROM PUBLIC, anon;

-- MaturityScoringMethodology / MaturityDomainWeight: SELECT + INSERT
-- only — this absence of an UPDATE/DELETE grant is itself the
-- append-only enforcement mechanism (§4 above).
GRANT SELECT, INSERT ON "maturity_scoring_methodologies" TO authenticated;
GRANT SELECT, INSERT ON "maturity_domain_weights" TO authenticated;

-- MaturityScore: SELECT + INSERT only — "never directly user-editable"
-- (DATA_MODEL.md §9).
GRANT SELECT, INSERT ON "maturity_scores" TO authenticated;

GRANT SELECT, INSERT, UPDATE ON "maturity_domains" TO authenticated;
GRANT SELECT, INSERT, DELETE ON "maturity_domain_control_mappings" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "maturity_assessments" TO authenticated;
