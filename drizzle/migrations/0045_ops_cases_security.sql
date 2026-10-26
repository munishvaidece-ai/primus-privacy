-- PRIMUS PRIVACY — Migration 0045: security layer for ops_cases (0044).
-- Practice staff with an AI permission read and manage cases; the AI agent
-- writes its assessment. Client organisation members have no access here.

CREATE TRIGGER ops_cases_prevent_reparenting
  BEFORE UPDATE ON "ops_cases"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ai_reparenting();
CREATE TRIGGER ops_cases_audit_log
  AFTER INSERT OR UPDATE ON "ops_cases"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

-- A response, once approved, is frozen: later edits would otherwise
-- silently change what was signed off.
CREATE OR REPLACE FUNCTION public.guard_ops_case_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.response_approved_at IS NOT NULL AND NEW.draft_response IS DISTINCT FROM OLD.draft_response THEN
    RAISE EXCEPTION 'the response of case % was already approved and cannot be changed', OLD.id USING ERRCODE = '23514';
  END IF;
  IF NEW.case_type IS DISTINCT FROM OLD.case_type OR NEW.reference IS DISTINCT FROM OLD.reference THEN
    RAISE EXCEPTION 'case_type and reference are immutable (case %)', OLD.id USING ERRCODE = '23514';
  END IF;
  IF NEW.response_approved_at IS DISTINCT FROM OLD.response_approved_at AND NEW.response_approved_at IS NOT NULL THEN
    IF auth.uid() IS NOT NULL AND public.has_engagement_permission(NEW.engagement_id, 'ai.agent')
       AND NOT public.has_engagement_permission(NEW.engagement_id, 'ai.supervise') THEN
      RAISE EXCEPTION 'the AI agent cannot approve a case response (case %)', OLD.id USING ERRCODE = '42501';
    END IF;
    IF NEW.case_type = 'breach' AND auth.uid() IS NOT NULL
       AND NOT public.has_engagement_permission(NEW.engagement_id, 'ai.release') THEN
      RAISE EXCEPTION 'approving a breach notice needs the ai.release permission (case %)', OLD.id USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ops_cases_guard
  BEFORE UPDATE ON "ops_cases"
  FOR EACH ROW EXECUTE FUNCTION public.guard_ops_case_update();

ALTER TABLE "ops_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ops_cases" FORCE ROW LEVEL SECURITY;

CREATE POLICY ops_cases_select ON "ops_cases"
  FOR SELECT TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
CREATE POLICY ops_cases_insert ON "ops_cases"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
CREATE POLICY ops_cases_update ON "ops_cases"
  FOR UPDATE TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  )
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );

REVOKE ALL ON "ops_cases" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON "ops_cases" TO authenticated;
