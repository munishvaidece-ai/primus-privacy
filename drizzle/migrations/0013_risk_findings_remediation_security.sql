-- PRIMUS PRIVACY — Migration 0013: security layer for Risk, Findings &
-- Remediation (0012_risk_findings_remediation.sql).
--
-- Hand-written, not drizzle-kit generated — same rationale as migrations
-- 0001, 0003, 0005, 0007, 0009, and 0011 (DECISIONS.md R-02): RLS,
-- triggers, and cross-module immutability rules aren't modeled in the
-- Drizzle TS schema. Deployable to a real Supabase project as-is;
-- assumes migrations 0000-0012 are already applied.

-- =============================================================================
-- 1. The deferred EvidenceLink CHECK constraint (see migration 0012's own
--    trailing comment): Postgres forbids using an enum value added by
--    `ALTER TYPE ... ADD VALUE` within the same implicit transaction that
--    also uses it in an expression. Migration 0012 added
--    'remediation_action'/'validation_record' to `evidence_link_subject_
--    type` and is applied as its own single-statement-batch transaction
--    (scripts/apply-migrations.ts); those values are safely committed by
--    the time this file runs, so the CHECK referencing them can be added
--    here.
-- =============================================================================

ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_subject_matches_type_check" CHECK (
  (subject_type = 'assessment_response' AND assessment_response_id IS NOT NULL AND control_test_id IS NULL AND remediation_action_id IS NULL AND validation_record_id IS NULL)
  OR (subject_type = 'control_test' AND control_test_id IS NOT NULL AND assessment_response_id IS NULL AND remediation_action_id IS NULL AND validation_record_id IS NULL)
  OR (subject_type = 'remediation_action' AND remediation_action_id IS NOT NULL AND assessment_response_id IS NULL AND control_test_id IS NULL AND validation_record_id IS NULL)
  OR (subject_type = 'validation_record' AND validation_record_id IS NOT NULL AND assessment_response_id IS NULL AND control_test_id IS NULL AND remediation_action_id IS NULL)
);

-- Note: no RLS/policy/grant changes are needed on `evidence_links` itself
-- for the two new subject types. Its existing dual-mode policies
-- (migration 0011) already branch on `engagement_id IS NOT NULL` generically
-- — since `RemediationAction`/`ValidationRecord` are always engagement-
-- scoped (§7 below), an EvidenceLink to either always routes through the
-- `can_access_engagement` branch automatically. No new authorization
-- logic, no second mechanism.

-- =============================================================================
-- 2. Audit-column foreign keys to users(id)
-- =============================================================================
-- Added here via ALTER TABLE, not in the Drizzle TS schema — same
-- circular-import reasoning as every audit column since tenants.ts.
-- `risks.owner_id`, `findings.owner_id`, `remediation_actions.owner_id`,
-- and `validation_records.validated_by` did NOT need this treatment —
-- all four are direct Drizzle `.references()` already.

ALTER TABLE "risk_scoring_models"
  ADD CONSTRAINT "risk_scoring_models_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "risk_scoring_models_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "risks"
  ADD CONSTRAINT "risks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "risks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
ALTER TABLE "risk_controls"
  ADD CONSTRAINT "risk_controls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "risk_processing_activities"
  ADD CONSTRAINT "risk_processing_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "findings"
  ADD CONSTRAINT "findings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "findings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
ALTER TABLE "finding_controls"
  ADD CONSTRAINT "finding_controls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "finding_processing_activities"
  ADD CONSTRAINT "finding_processing_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "finding_risks"
  ADD CONSTRAINT "finding_risks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "remediation_actions"
  ADD CONSTRAINT "remediation_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "remediation_actions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
ALTER TABLE "remediation_controls"
  ADD CONSTRAINT "remediation_controls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "remediation_findings"
  ADD CONSTRAINT "remediation_findings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "remediation_risks"
  ADD CONSTRAINT "remediation_risks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "validation_records"
  ADD CONSTRAINT "validation_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

-- =============================================================================
-- 3. Reparenting guards
-- =============================================================================

-- `risks.{engagement_id,organisation_id,tenant_id,risk_scoring_model_id}`
-- are immutable after creation — the last of these is the scoring-model
-- pin itself (Milestone 7 instructions §4/§11: historical reproducibility
-- after a newer RiskScoringModel exists). A deliberate re-score under a
-- different model creates a new Risk row via `previous_risk_id`
-- (risks.ts), never an in-place reparent. Ordinary fields (title,
-- description, likelihood, impact, ratings, status, owner_id) remain
-- mutable — an active risk register entry, not a frozen snapshot.
CREATE OR REPLACE FUNCTION public.prevent_risk_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.risk_scoring_model_id IS DISTINCT FROM OLD.risk_scoring_model_id THEN
    RAISE EXCEPTION
      'risks.{engagement_id,organisation_id,tenant_id,risk_scoring_model_id} are immutable after creation (risk %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER risks_prevent_reparenting
  BEFORE UPDATE ON "risks"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_risk_reparenting();

-- `findings.{engagement_id,organisation_id,tenant_id}` — same discipline,
-- no scoring-model pin to add.
CREATE OR REPLACE FUNCTION public.prevent_finding_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION
      'findings.{engagement_id,organisation_id,tenant_id} are immutable after creation (finding %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER findings_prevent_reparenting
  BEFORE UPDATE ON "findings"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_finding_reparenting();

-- `remediation_actions.{engagement_id,organisation_id,tenant_id}` — same.
CREATE OR REPLACE FUNCTION public.prevent_remediation_action_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION
      'remediation_actions.{engagement_id,organisation_id,tenant_id} are immutable after creation (remediation action %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER remediation_actions_prevent_reparenting
  BEFORE UPDATE ON "remediation_actions"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_remediation_action_reparenting();

-- =============================================================================
-- 4. RiskScoringModel append-only close-out — DATA_MODEL.md §8's own
--    explicit statement: "append-only, like ControlLibraryVersion... a
--    change to the scoring approach creates a new RiskScoringModel row."
--    Flipping a new row's `is_active` to true automatically closes out
--    whichever row was previously active for the same Tenant — the same
--    "at most one current row" bookkeeping Milestone 2's SCD2 close-out
--    triggers use, adapted to a plain boolean instead of `is_current`/
--    `valid_to`. This is the ONLY way `is_active` ever changes on an
--    existing row: `authenticated` has no UPDATE grant on this table at
--    all (§8 below), so every other field is unconditionally immutable
--    too, with no separate tampering-guard trigger needed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.close_out_previous_active_risk_scoring_model()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_active THEN
    UPDATE risk_scoring_models
    SET is_active = false
    WHERE tenant_id = NEW.tenant_id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER risk_scoring_models_close_out_previous
  BEFORE INSERT ON "risk_scoring_models"
  FOR EACH ROW EXECUTE FUNCTION public.close_out_previous_active_risk_scoring_model();

-- =============================================================================
-- 4b. ValidationRecord tampering guard — Milestone 7 instructions §8:
--    "Validation must be an explicit event/record." Every field is
--    permanently frozen at creation EXCEPT `triggers_control_test_id`/
--    `triggers_assessment_response_id`, which may transition exactly
--    once, from NULL to a real value — DATA_MODEL.md §8's own described
--    sequence is "a ValidationRecord is created by a consultant → only a
--    ValidationRecord with outcome = ACCEPTED may trigger a new
--    ControlTest/AssessmentResponse," i.e. the reassessment can
--    legitimately happen *after* the validation decision itself was
--    recorded, not necessarily atomically with it — the same narrow,
--    documented exception `document_versions.scan_status` gets
--    (migration 0011 §4), applied here to the one field whose value is
--    allowed to be genuinely unknown at the moment of validation.
--    `outcome`/`validated_by`/`validated_at`/`rationale`/every scope
--    column remain fully immutable — a validation decision itself is
--    never edited in place; a correction is a new ValidationRecord.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_validation_record_tampering()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.remediation_action_id IS DISTINCT FROM OLD.remediation_action_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.validated_by IS DISTINCT FROM OLD.validated_by
     OR NEW.validated_at IS DISTINCT FROM OLD.validated_at
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.rationale IS DISTINCT FROM OLD.rationale THEN
    RAISE EXCEPTION
      'a ValidationRecord''s decision fields are immutable after creation (validation record %)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF OLD.triggers_control_test_id IS NOT NULL AND NEW.triggers_control_test_id IS DISTINCT FROM OLD.triggers_control_test_id THEN
    RAISE EXCEPTION
      'validation_records.triggers_control_test_id can only be set once (validation record %)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF OLD.triggers_assessment_response_id IS NOT NULL AND NEW.triggers_assessment_response_id IS DISTINCT FROM OLD.triggers_assessment_response_id THEN
    RAISE EXCEPTION
      'validation_records.triggers_assessment_response_id can only be set once (validation record %)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validation_records_prevent_tampering
  BEFORE UPDATE ON "validation_records"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_validation_record_tampering();

-- =============================================================================
-- 5. Enable RLS (FORCE, matching the posture established since migration 0001).
-- =============================================================================

ALTER TABLE "risk_scoring_models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_scoring_models" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_controls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_controls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "risk_processing_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_processing_activities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "findings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "finding_controls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_controls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "finding_processing_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_processing_activities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "finding_risks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_risks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "remediation_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remediation_actions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "remediation_controls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remediation_controls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "remediation_findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remediation_findings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "remediation_risks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remediation_risks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "validation_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "validation_records" FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 6. Policies
-- =============================================================================
-- `RiskScoringModel` is Tenant-scoped practice methodology (like
-- `ControlLibraryVersion`, Milestone 4) — reuses the same read/write
-- asymmetry (DECISIONS.md R-47): SELECT via the wider
-- `can_access_tenant`, INSERT via the narrower `is_active_tenant_member`
-- (practice governance). Everything else in this migration is client
-- engagement data (like `Assessment`/`ProcessingActivity`) — symmetric
-- `can_access_engagement` read/write, all reusing migration 0001's
-- helpers unchanged (Milestone 7 instructions §14: no second
-- authorization framework).

CREATE POLICY risk_scoring_models_select ON "risk_scoring_models" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY risk_scoring_models_insert ON "risk_scoring_models" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
-- No UPDATE/DELETE policy — append-only (§4 above); the close-out
-- trigger's own internal UPDATE runs as SECURITY DEFINER, bypassing the
-- complete absence of an UPDATE grant for `authenticated` (§8 below).

CREATE POLICY risks_select ON "risks" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY risks_insert ON "risks" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY risks_update ON "risks" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY risk_controls_select ON "risk_controls" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY risk_controls_insert ON "risk_controls" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY risk_controls_delete ON "risk_controls" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY risk_processing_activities_select ON "risk_processing_activities" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY risk_processing_activities_insert ON "risk_processing_activities" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY risk_processing_activities_delete ON "risk_processing_activities" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY findings_select ON "findings" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY findings_insert ON "findings" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY findings_update ON "findings" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY finding_controls_select ON "finding_controls" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY finding_controls_insert ON "finding_controls" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY finding_controls_delete ON "finding_controls" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY finding_processing_activities_select ON "finding_processing_activities" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY finding_processing_activities_insert ON "finding_processing_activities" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY finding_processing_activities_delete ON "finding_processing_activities" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY finding_risks_select ON "finding_risks" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY finding_risks_insert ON "finding_risks" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY finding_risks_delete ON "finding_risks" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY remediation_actions_select ON "remediation_actions" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY remediation_actions_insert ON "remediation_actions" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY remediation_actions_update ON "remediation_actions" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY remediation_controls_select ON "remediation_controls" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY remediation_controls_insert ON "remediation_controls" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY remediation_controls_delete ON "remediation_controls" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY remediation_findings_select ON "remediation_findings" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY remediation_findings_insert ON "remediation_findings" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY remediation_findings_delete ON "remediation_findings" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY remediation_risks_select ON "remediation_risks" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY remediation_risks_insert ON "remediation_risks" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY remediation_risks_delete ON "remediation_risks" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

-- ValidationRecord: SELECT/INSERT/UPDATE — an explicit event/record
-- (Milestone 7 instructions §8/§16). UPDATE exists solely for the one
-- narrow, one-time reassessment-trigger transition §4b's trigger
-- describes; every decision field (outcome/validated_by/validated_at/
-- rationale) remains unconditionally frozen regardless of what this
-- policy allows. No DELETE policy or grant at all.
CREATE POLICY validation_records_select ON "validation_records" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY validation_records_insert ON "validation_records" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY validation_records_update ON "validation_records" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));

-- =============================================================================
-- 7. Auditability — Milestone 7 instructions §15: Risk creation/scoring/
--    status changes/material updates; Finding creation/severity-or-
--    status changes/material updates; Remediation creation/assignment/
--    status changes/completion; Validation creation/decision must all be
--    auditable.
-- =============================================================================
-- No new trigger functions needed: every table in this migration already
-- carries `tenant_id` directly, exactly the shape migration 0007's
-- `log_methodology_change()`/`log_methodology_relationship_change()`
-- were written for and every later milestone since has confirmed
-- generalizes (DECISIONS.md R-46/R-56) — reused here unchanged for a
-- fourth milestone in a row. `RiskScoringModel` is audited on INSERT
-- only (not UPDATE), matching Milestone 2's version-table convention:
-- the close-out trigger's own internal UPDATE of the just-superseded row
-- is mechanical bookkeeping already implied by the new row's own insert
-- audit entry, not separately logged. `ValidationRecord` is likewise
-- INSERT-only (it is never updated at all).

CREATE TRIGGER risk_scoring_models_audit_log
  AFTER INSERT ON "risk_scoring_models"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER risks_audit_log
  AFTER INSERT OR UPDATE ON "risks"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER risk_controls_audit_log
  AFTER INSERT OR DELETE ON "risk_controls"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();
CREATE TRIGGER risk_processing_activities_audit_log
  AFTER INSERT OR DELETE ON "risk_processing_activities"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();

CREATE TRIGGER findings_audit_log
  AFTER INSERT OR UPDATE ON "findings"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER finding_controls_audit_log
  AFTER INSERT OR DELETE ON "finding_controls"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();
CREATE TRIGGER finding_processing_activities_audit_log
  AFTER INSERT OR DELETE ON "finding_processing_activities"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();
CREATE TRIGGER finding_risks_audit_log
  AFTER INSERT OR DELETE ON "finding_risks"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();

CREATE TRIGGER remediation_actions_audit_log
  AFTER INSERT OR UPDATE ON "remediation_actions"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER remediation_controls_audit_log
  AFTER INSERT OR DELETE ON "remediation_controls"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();
CREATE TRIGGER remediation_findings_audit_log
  AFTER INSERT OR DELETE ON "remediation_findings"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();
CREATE TRIGGER remediation_risks_audit_log
  AFTER INSERT OR DELETE ON "remediation_risks"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();

-- AFTER UPDATE too now (unlike RiskScoringModel's INSERT-only posture):
-- the one legitimate update (setting a reassessment trigger) is a real,
-- separately meaningful event worth its own audit entry, not mechanical
-- bookkeeping implied by the row's own creation.
CREATE TRIGGER validation_records_audit_log
  AFTER INSERT OR UPDATE ON "validation_records"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

-- =============================================================================
-- 8. Table-level GRANTs
-- =============================================================================
-- Same belt-and-suspenders posture as every earlier milestone: `anon`
-- gets nothing on any Milestone 7 table.

REVOKE ALL ON
  "risk_scoring_models", "risks", "risk_controls", "risk_processing_activities",
  "findings", "finding_controls", "finding_processing_activities", "finding_risks",
  "remediation_actions", "remediation_controls", "remediation_findings", "remediation_risks",
  "validation_records"
FROM PUBLIC, anon;

-- RiskScoringModel: SELECT + INSERT only, no UPDATE, no DELETE — this
-- absence of grants is itself the append-only enforcement mechanism
-- (§4 above).
GRANT SELECT, INSERT ON "risk_scoring_models" TO authenticated;

-- ValidationRecord: SELECT + INSERT + UPDATE, no DELETE — the UPDATE
-- grant exists solely for the one narrow, trigger-enforced reassessment-
-- trigger transition (§4b above); every decision field stays frozen
-- regardless of this grant.
GRANT SELECT, INSERT, UPDATE ON "validation_records" TO authenticated;

GRANT SELECT, INSERT, UPDATE ON "risks" TO authenticated;
GRANT SELECT, INSERT, DELETE ON "risk_controls", "risk_processing_activities" TO authenticated;

GRANT SELECT, INSERT, UPDATE ON "findings" TO authenticated;
GRANT SELECT, INSERT, DELETE ON "finding_controls", "finding_processing_activities", "finding_risks" TO authenticated;

GRANT SELECT, INSERT, UPDATE ON "remediation_actions" TO authenticated;
GRANT SELECT, INSERT, DELETE ON "remediation_controls", "remediation_findings", "remediation_risks" TO authenticated;
