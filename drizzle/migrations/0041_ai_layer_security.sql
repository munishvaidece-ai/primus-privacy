-- PRIMUS PRIVACY — Migration 0041: security layer for the AI layer
-- (migration 0040). Hand-written (DECISIONS.md R-02). Assumes 0040 applied.
--
-- Access model (DECISIONS.md R-183):
--   * Client users (organisation members) get NO access to any ai_* table
--     — the AI queue is practice-internal. Access is by explicit
--     permission on the ENGAGEMENT membership, not plain engagement
--     access:
--         ai.supervise  — see the queue and decide ordinary suggestions
--         ai.release    — additionally decide GATED suggestions
--         ai.configure  — change level / gates / pause for an engagement
--         ai.agent      — held only by the "AI Analyst" role (the AI's
--                         own user): write suggestions, jobs, events
--   * The AI's user can never decide (approve / override / reject) a
--     suggestion — enforced here by a trigger, not just by the app.
--   * A gated suggestion can only be decided by someone holding
--     ai.release.

-- =============================================================================
-- 1. Reparenting guards
-- =============================================================================
CREATE OR REPLACE FUNCTION public.prevent_ai_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
  THEN
    RAISE EXCEPTION 'ai_* rows cannot be moved between tenants, organisations or engagements (table %, row %)', TG_TABLE_NAME, OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_engagement_settings_prevent_reparenting
  BEFORE UPDATE ON "ai_engagement_settings"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ai_reparenting();
CREATE TRIGGER ai_jobs_prevent_reparenting
  BEFORE UPDATE ON "ai_jobs"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ai_reparenting();

-- =============================================================================
-- 2. Suggestion guard: the heart of "the AI cannot approve its own work"
-- =============================================================================
CREATE OR REPLACE FUNCTION public.guard_ai_suggestion_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_agent boolean := false;
  v_can_supervise boolean := false;
  v_can_release boolean := false;
BEGIN
  -- Core content of a suggestion is frozen from the moment it is written:
  -- a human's override goes in final_value, never over the AI's proposal.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.proposed IS DISTINCT FROM OLD.proposed
     OR NEW.rationale IS DISTINCT FROM OLD.rationale
     OR NEW.citations IS DISTINCT FROM OLD.citations
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.risk_tier IS DISTINCT FROM OLD.risk_tier
     OR NEW.gate IS DISTINCT FROM OLD.gate
     OR NEW.routing_reason IS DISTINCT FROM OLD.routing_reason
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.autopilot_level IS DISTINCT FROM OLD.autopilot_level
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'ai_suggestions content is immutable after creation (suggestion %); a human override is recorded in final_value', OLD.id
      USING ERRCODE = '23514';
  END IF;

  -- Lifecycle: only pending_review is open; failed may be re-opened.
  IF OLD.status = 'failed' THEN
    IF NEW.status NOT IN ('failed', 'pending_review') THEN
      RAISE EXCEPTION 'a failed ai_suggestion can only be re-opened (suggestion %)', OLD.id USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status <> 'pending_review' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'ai_suggestions are immutable once decided (suggestion %, status %)', OLD.id, OLD.status
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NOT NULL THEN
    v_is_agent := public.has_engagement_permission(NEW.engagement_id, 'ai.agent');
    v_can_supervise := public.has_engagement_permission(NEW.engagement_id, 'ai.supervise');
    v_can_release := public.has_engagement_permission(NEW.engagement_id, 'ai.release');
  END IF;

  IF NEW.status = 'auto_applied' AND NEW.gate IS NOT NULL THEN
    RAISE EXCEPTION 'a gated ai_suggestion can never be auto-applied (suggestion %, gate %)', NEW.id, NEW.gate
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('approved', 'overridden', 'rejected') THEN
    IF v_is_agent AND NOT v_can_supervise THEN
      RAISE EXCEPTION 'the AI agent cannot approve, override or reject suggestions (suggestion %)', NEW.id
        USING ERRCODE = '42501';
    END IF;
    IF NEW.gate IS NOT NULL AND v_uid IS NOT NULL AND NOT v_can_release THEN
      RAISE EXCEPTION 'suggestion % is held at gate "%": deciding it needs the ai.release permission', NEW.id, NEW.gate
        USING ERRCODE = '42501';
    END IF;
    IF v_uid IS NOT NULL AND NEW.decided_by IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'decided_by must be the deciding user (suggestion %)', NEW.id USING ERRCODE = '23514';
    END IF;
    IF NEW.decided_at IS NULL THEN
      RAISE EXCEPTION 'decided_at is required when a suggestion is decided (suggestion %)', NEW.id USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_suggestions_guard
  BEFORE UPDATE ON "ai_suggestions"
  FOR EACH ROW EXECUTE FUNCTION public.guard_ai_suggestion_update();

-- A suggestion can only be INSERTED in a state the AI is allowed to leave
-- it in: awaiting a human, auto-applied (never when gated) or failed.
CREATE OR REPLACE FUNCTION public.guard_ai_suggestion_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('approved', 'overridden', 'rejected') THEN
    RAISE EXCEPTION 'a suggestion cannot be created already decided by a human (suggestion %)', NEW.id USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'auto_applied' AND NEW.gate IS NOT NULL THEN
    RAISE EXCEPTION 'a gated ai_suggestion can never be auto-applied (suggestion %, gate %)', NEW.id, NEW.gate USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_suggestions_guard_insert
  BEFORE INSERT ON "ai_suggestions"
  FOR EACH ROW EXECUTE FUNCTION public.guard_ai_suggestion_insert();

-- =============================================================================
-- 3. ai_events is append-only
-- =============================================================================
CREATE OR REPLACE FUNCTION public.prevent_ai_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ai_events is append-only (event %)', COALESCE(OLD.id, NEW.id) USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER ai_events_no_update
  BEFORE UPDATE OR DELETE ON "ai_events"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ai_event_mutation();

-- =============================================================================
-- 4. Auditability (generic audit_log; settings and suggestions)
-- =============================================================================
CREATE TRIGGER ai_engagement_settings_audit_log
  AFTER INSERT OR UPDATE ON "ai_engagement_settings"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER ai_suggestions_audit_log
  AFTER INSERT OR UPDATE ON "ai_suggestions"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

-- =============================================================================
-- 5. RLS
-- =============================================================================
ALTER TABLE "ai_engagement_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_engagement_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_jobs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_document_extracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_document_extracts" FORCE ROW LEVEL SECURITY;

-- Shared read rule: practice staff with an AI permission on THIS engagement.
-- (Deliberately not can_access_engagement: that also admits the client's own
-- organisation members.)

CREATE POLICY ai_engagement_settings_select ON "ai_engagement_settings"
  FOR SELECT TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
CREATE POLICY ai_engagement_settings_insert ON "ai_engagement_settings"
  FOR INSERT TO authenticated
  WITH CHECK (public.has_engagement_permission(engagement_id, 'ai.configure'));
CREATE POLICY ai_engagement_settings_update ON "ai_engagement_settings"
  FOR UPDATE TO authenticated
  USING (public.has_engagement_permission(engagement_id, 'ai.configure'))
  WITH CHECK (public.has_engagement_permission(engagement_id, 'ai.configure'));

CREATE POLICY ai_jobs_select ON "ai_jobs"
  FOR SELECT TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
CREATE POLICY ai_jobs_insert ON "ai_jobs"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
CREATE POLICY ai_jobs_update ON "ai_jobs"
  FOR UPDATE TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  )
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );

CREATE POLICY ai_suggestions_select ON "ai_suggestions"
  FOR SELECT TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
-- Only the AI's own user writes suggestions.
CREATE POLICY ai_suggestions_insert ON "ai_suggestions"
  FOR INSERT TO authenticated
  WITH CHECK (public.has_engagement_permission(engagement_id, 'ai.agent'));
CREATE POLICY ai_suggestions_update ON "ai_suggestions"
  FOR UPDATE TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  )
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );

CREATE POLICY ai_events_select ON "ai_events"
  FOR SELECT TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
CREATE POLICY ai_events_insert ON "ai_events"
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.has_engagement_permission(engagement_id, 'ai.supervise')
      OR public.has_engagement_permission(engagement_id, 'ai.configure')
      OR public.has_engagement_permission(engagement_id, 'ai.agent')
    )
    AND (actor_user_id IS NULL OR actor_user_id = auth.uid())
  );

CREATE POLICY ai_document_extracts_select ON "ai_document_extracts"
  FOR SELECT TO authenticated
  USING (
    engagement_id IS NOT NULL
    AND (
      public.has_engagement_permission(engagement_id, 'ai.supervise')
      OR public.has_engagement_permission(engagement_id, 'ai.agent')
    )
  );
CREATE POLICY ai_document_extracts_insert ON "ai_document_extracts"
  FOR INSERT TO authenticated
  WITH CHECK (
    engagement_id IS NOT NULL
    AND public.has_engagement_permission(engagement_id, 'ai.agent')
  );

-- =============================================================================
-- 6. Table-level GRANTs
-- =============================================================================
REVOKE ALL ON
  "ai_engagement_settings",
  "ai_jobs",
  "ai_suggestions",
  "ai_events",
  "ai_document_extracts"
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON "ai_engagement_settings" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "ai_jobs" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "ai_suggestions" TO authenticated;
GRANT SELECT, INSERT ON "ai_events" TO authenticated;
GRANT SELECT, INSERT ON "ai_document_extracts" TO authenticated;

-- =============================================================================
-- 7. Report issuances (append-only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.prevent_ai_report_issuance_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ai_report_issuances is append-only; re-issue creates a new version' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER ai_report_issuances_no_update
  BEFORE UPDATE OR DELETE ON "ai_report_issuances"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ai_report_issuance_mutation();
CREATE TRIGGER ai_report_issuances_audit_log
  AFTER INSERT ON "ai_report_issuances"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

ALTER TABLE "ai_report_issuances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_report_issuances" FORCE ROW LEVEL SECURITY;
-- Staff with ai.supervise see issuances. The issuance itself is written by
-- whoever applies the suggestion: a person with ai.release (gated), or the
-- AI agent only when the gate has been deliberately switched off.
CREATE POLICY ai_report_issuances_select ON "ai_report_issuances"
  FOR SELECT TO authenticated
  USING (public.has_engagement_permission(engagement_id, 'ai.supervise') OR public.has_engagement_permission(engagement_id, 'ai.agent'));
CREATE POLICY ai_report_issuances_insert ON "ai_report_issuances"
  FOR INSERT TO authenticated
  WITH CHECK (
    issued_by = auth.uid()
    AND (public.has_engagement_permission(engagement_id, 'ai.release') OR public.has_engagement_permission(engagement_id, 'ai.agent'))
  );
REVOKE ALL ON "ai_report_issuances" FROM PUBLIC, anon;
GRANT SELECT, INSERT ON "ai_report_issuances" TO authenticated;

-- =============================================================================
-- 8. Locating the tenant's AI agent user
-- =============================================================================
-- The agent is a normal user whose e-mail follows a fixed convention (see
-- scripts/provision-ai-agent.ts). Callable by any signed-in user of the
-- same tenant; returns only an id.
CREATE OR REPLACE FUNCTION public.ai_agent_user_id(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT u.id FROM users u
  WHERE u.tenant_id = p_tenant_id
    AND u.email = 'ai-agent@' || p_tenant_id::text || '.agent.primus.invalid'
    AND u.status = 'active'
    AND EXISTS (SELECT 1 FROM users me WHERE me.id = auth.uid() AND me.tenant_id = p_tenant_id)
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_agent_user_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_agent_user_id(uuid) TO authenticated, service_role;
