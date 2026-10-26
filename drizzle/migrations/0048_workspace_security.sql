-- PRIMUS PRIVACY — Migration 0048: security for the workspace tables (0046, 0047).
--
-- Principles, same as the rest of the platform:
--   * every table has forced row level security;
--   * a client user can only ever see their own organisation's rows, and only
--     the rows meant for the client (client-visible activity, client-side
--     tasks, released findings, released reports);
--   * the AI agent can never release a finding or report, validate an answer
--     or approve discovery;
--   * rows that are history (activity, messages, released reports) cannot be
--     edited or deleted.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_engagement_or_org_permission(p_engagement_id uuid, p_organisation_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_engagement_permission(p_engagement_id, p_permission_key)
      OR public.has_organisation_permission(p_organisation_id, p_permission_key);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.has_engagement_or_org_permission(uuid, uuid, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.has_engagement_or_org_permission(uuid, uuid, text) TO authenticated;
--> statement-breakpoint

-- Row guard shared by the new tables: ids, tenant, organisation and
-- engagement can never change.
CREATE OR REPLACE FUNCTION public.prevent_workspace_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
  THEN
    RAISE EXCEPTION 'rows of % cannot be moved between tenants, organisations or engagements (row %)', TG_TABLE_NAME, OLD.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Per-engagement running reference (CLR-001, ER-001 ...). Definer so the count
-- sees every row regardless of who can read it; serialised per engagement.
CREATE OR REPLACE FUNCTION public.assign_engagement_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  IF NEW.reference IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || NEW.engagement_id::text));
  EXECUTE format('SELECT count(*) + 1 FROM %I WHERE engagement_id = $1', TG_TABLE_NAME) INTO n USING NEW.engagement_id;
  NEW.reference := TG_ARGV[0] || '-' || lpad(n::text, 3, '0');
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Findings: private until released
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS findings_select ON "findings";
--> statement-breakpoint
CREATE POLICY findings_select ON "findings"
  FOR SELECT TO authenticated
  USING (
    public.can_access_engagement(engagement_id, organisation_id)
    AND (released_at IS NOT NULL OR public.is_practice_user())
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_finding_release()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.released_at IS NOT NULL AND auth.uid() IS NOT NULL
       AND NOT public.has_engagement_permission(NEW.engagement_id, 'finding.release') THEN
      RAISE EXCEPTION 'releasing a finding needs the finding.release permission' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.released_at IS NOT NULL THEN
    IF NEW.released_at IS DISTINCT FROM OLD.released_at OR NEW.released_by IS DISTINCT FROM OLD.released_by THEN
      RAISE EXCEPTION 'a released finding cannot be withdrawn (finding %)', OLD.id USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.released_at IS NOT NULL THEN
    IF auth.uid() IS NOT NULL THEN
      IF NOT public.has_engagement_permission(NEW.engagement_id, 'finding.release')
         OR public.has_engagement_permission(NEW.engagement_id, 'ai.agent') THEN
        RAISE EXCEPTION 'releasing a finding needs the finding.release permission (finding %)', OLD.id USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER findings_guard_release
  BEFORE INSERT OR UPDATE ON "findings"
  FOR EACH ROW EXECUTE FUNCTION public.guard_finding_release();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Assessment: submission by the client, validation by a reviewer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_assessment_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by THEN
    IF auth.uid() IS NOT NULL THEN
      IF NEW.submitted_at IS NOT NULL THEN
        IF NOT (public.has_engagement_or_org_permission(NEW.engagement_id, NEW.organisation_id, 'client.submit')
                OR public.has_engagement_permission(NEW.engagement_id, 'assessment.review')) THEN
          RAISE EXCEPTION 'submitting an assessment needs the client.submit permission' USING ERRCODE = '42501';
        END IF;
      ELSE
        IF NOT public.has_engagement_permission(NEW.engagement_id, 'assessment.review') THEN
          RAISE EXCEPTION 'returning an assessment for changes needs the assessment.review permission' USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assessments_guard_submission
  BEFORE UPDATE ON "assessments"
  FOR EACH ROW EXECUTE FUNCTION public.guard_assessment_submission();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_response_validation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_submitted timestamptz;
BEGIN
  -- Locked for client users once the assessment is submitted.
  IF auth.uid() IS NOT NULL AND NOT public.is_practice_user() THEN
    IF NOT public.has_engagement_or_org_permission(NEW.engagement_id, NEW.organisation_id, 'client.contribute') THEN
      RAISE EXCEPTION 'answering assessment questions needs the client.contribute permission' USING ERRCODE = '42501';
    END IF;
    SELECT a.submitted_at INTO v_submitted
      FROM assessment_controls ac JOIN assessments a ON a.id = ac.assessment_id
     WHERE ac.id = NEW.assessment_control_id;
    IF v_submitted IS NOT NULL THEN
      RAISE EXCEPTION 'the assessment was submitted and can no longer be edited by the client' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.validated_at IS DISTINCT FROM OLD.validated_at OR NEW.validated_by IS DISTINCT FROM OLD.validated_by THEN
      IF auth.uid() IS NOT NULL AND (
           NOT public.has_engagement_permission(NEW.engagement_id, 'assessment.review')
           OR public.has_engagement_permission(NEW.engagement_id, 'ai.agent')) THEN
        RAISE EXCEPTION 'validating an answer needs the assessment.review permission' USING ERRCODE = '42501';
      END IF;
    ELSIF OLD.validated_at IS NOT NULL
          AND (NEW.effectiveness_rating IS DISTINCT FROM OLD.effectiveness_rating
               OR NEW.decision_rationale IS DISTINCT FROM OLD.decision_rationale) THEN
      -- A changed answer is no longer the answer that was validated.
      NEW.validated_at := NULL;
      NEW.validated_by := NULL;
    END IF;
  ELSIF NEW.validated_at IS NOT NULL AND auth.uid() IS NOT NULL
        AND NOT public.has_engagement_permission(NEW.engagement_id, 'assessment.review') THEN
    RAISE EXCEPTION 'validating an answer needs the assessment.review permission' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assessment_responses_guard_validation
  BEFORE INSERT OR UPDATE ON "assessment_responses"
  FOR EACH ROW EXECUTE FUNCTION public.guard_response_validation();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- notifications: the recipient reads and marks their own; creation is only
-- through notify_engagement() below.
-- ---------------------------------------------------------------------------
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_select ON "notifications" FOR SELECT TO authenticated USING (user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY notifications_update ON "notifications" FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
--> statement-breakpoint
REVOKE ALL ON "notifications" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT ON "notifications" TO authenticated;
--> statement-breakpoint
GRANT UPDATE ("read_at") ON "notifications" TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.notify_engagement(
  p_engagement_id uuid, p_audience text, p_kind text, p_title text, p_body text, p_link text, p_exclude_self boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid; v_tenant uuid; v_n integer;
BEGIN
  IF p_audience NOT IN ('practice', 'client', 'all') THEN
    RAISE EXCEPTION 'unknown audience %', p_audience USING ERRCODE = '22023';
  END IF;
  SELECT organisation_id, tenant_id INTO v_org, v_tenant FROM engagements WHERE id = p_engagement_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_engagement(p_engagement_id, v_org) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = '42501';
  END IF;
  INSERT INTO notifications (tenant_id, organisation_id, engagement_id, user_id, kind, title, body, link)
  SELECT v_tenant, v_org, p_engagement_id, u.id, p_kind, left(p_title, 200), left(p_body, 2000), p_link
    FROM users u
   WHERE u.status = 'active'
     AND u.id IN (
       SELECT em.user_id FROM engagement_memberships em WHERE em.engagement_id = p_engagement_id AND em.status = 'active'
       UNION
       SELECT om.user_id FROM organisation_memberships om WHERE om.organisation_id = v_org AND om.status = 'active')
     AND NOT public.is_ai_agent_user(u.id)
     AND (p_audience = 'all'
          OR (p_audience = 'practice' AND u.client_org_id IS NULL)
          OR (p_audience = 'client' AND u.client_org_id IS NOT NULL))
     AND (NOT p_exclude_self OR u.id <> auth.uid());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.notify_engagement(uuid, text, text, text, text, text, boolean) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.notify_engagement(uuid, text, text, text, text, text, boolean) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- engagement_activity: append-only feed; clients see only client-visible rows
-- ---------------------------------------------------------------------------
ALTER TABLE "engagement_activity" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "engagement_activity" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY engagement_activity_select ON "engagement_activity" FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id) AND (client_visible OR public.is_practice_user()));
--> statement-breakpoint
REVOKE ALL ON "engagement_activity" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT ON "engagement_activity" TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.record_activity(
  p_engagement_id uuid, p_kind text, p_summary text, p_subject_type text, p_subject_id uuid, p_client_visible boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_tenant uuid; v_id uuid;
BEGIN
  SELECT organisation_id, tenant_id INTO v_org, v_tenant FROM engagements WHERE id = p_engagement_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_engagement(p_engagement_id, v_org) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = '42501';
  END IF;
  INSERT INTO engagement_activity (tenant_id, organisation_id, engagement_id, actor_user_id, kind, summary, subject_type, subject_id, client_visible)
  VALUES (v_tenant, v_org, p_engagement_id, auth.uid(), p_kind, left(p_summary, 500), p_subject_type, p_subject_id, p_client_visible)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_activity(uuid, text, text, text, uuid, boolean) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.record_activity(uuid, text, text, text, uuid, boolean) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- engagement_tasks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_task_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a task''s kind and creator cannot change (task %)', OLD.id USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'a % task cannot be changed again (task %)', OLD.status, OLD.id USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'done' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, now());
      NEW.completed_by := COALESCE(NEW.completed_by, auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER engagement_tasks_prevent_reparenting BEFORE UPDATE ON "engagement_tasks" FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_reparenting();
--> statement-breakpoint
CREATE TRIGGER engagement_tasks_guard BEFORE UPDATE ON "engagement_tasks" FOR EACH ROW EXECUTE FUNCTION public.guard_task_update();
--> statement-breakpoint
CREATE TRIGGER engagement_tasks_audit_log AFTER INSERT OR UPDATE ON "engagement_tasks" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
--> statement-breakpoint
ALTER TABLE "engagement_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "engagement_tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY engagement_tasks_select ON "engagement_tasks" FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id) AND (assignee_side = 'client' OR kind = 'milestone' OR public.is_practice_user()));
--> statement-breakpoint
CREATE POLICY engagement_tasks_insert ON "engagement_tasks" FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_engagement(engagement_id, organisation_id)
    AND created_by = auth.uid()
    AND kind = CASE WHEN public.is_practice_user() THEN kind ELSE 'task' END
    AND (
      (public.is_practice_user() AND public.is_active_engagement_member(engagement_id))
      OR (NOT public.is_practice_user() AND assignee_side = 'client')
    )
  );
--> statement-breakpoint
CREATE POLICY engagement_tasks_update ON "engagement_tasks" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id) AND (assignee_side = 'client' OR public.is_practice_user()))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id) AND (assignee_side = 'client' OR public.is_practice_user()));
--> statement-breakpoint
REVOKE ALL ON "engagement_tasks" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "engagement_tasks" TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- clarifications and their messages
-- ---------------------------------------------------------------------------
CREATE TRIGGER clarifications_assign_reference BEFORE INSERT ON "clarifications" FOR EACH ROW EXECUTE FUNCTION public.assign_engagement_reference('CLR');
--> statement-breakpoint
CREATE TRIGGER clarifications_prevent_reparenting BEFORE UPDATE ON "clarifications" FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_reparenting();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_clarification_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.raised_by IS DISTINCT FROM OLD.raised_by OR NEW.raised_by_side IS DISTINCT FROM OLD.raised_by_side
     OR NEW.raised_at IS DISTINCT FROM OLD.raised_at
     OR NEW.subject_type IS DISTINCT FROM OLD.subject_type OR NEW.subject_id IS DISTINCT FROM OLD.subject_id THEN
    RAISE EXCEPTION 'a clarification''s reference, subject and origin cannot change (%)', OLD.id USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'closed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a closed clarification cannot be reopened (%)', OLD.id USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    IF auth.uid() IS NOT NULL AND NOT (public.is_practice_user() OR OLD.raised_by = auth.uid()) THEN
      RAISE EXCEPTION 'only the person who raised a clarification, or the Primus team, can close it' USING ERRCODE = '42501';
    END IF;
    NEW.closed_at := COALESCE(NEW.closed_at, now());
    NEW.closed_by := COALESCE(NEW.closed_by, auth.uid());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER clarifications_guard BEFORE UPDATE ON "clarifications" FOR EACH ROW EXECUTE FUNCTION public.guard_clarification_update();
--> statement-breakpoint
CREATE TRIGGER clarifications_audit_log AFTER INSERT OR UPDATE ON "clarifications" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
--> statement-breakpoint
ALTER TABLE "clarifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clarifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY clarifications_select ON "clarifications" FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
--> statement-breakpoint
CREATE POLICY clarifications_insert ON "clarifications" FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_engagement(engagement_id, organisation_id)
    AND raised_by = auth.uid()
    AND raised_by_side = CASE WHEN public.is_practice_user() THEN 'primus' ELSE 'client' END
    AND (NOT public.is_practice_user() OR public.is_active_engagement_member(engagement_id))
  );
--> statement-breakpoint
CREATE POLICY clarifications_update ON "clarifications" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
--> statement-breakpoint
REVOKE ALL ON "clarifications" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "clarifications" TO authenticated;
--> statement-breakpoint

-- A new message moves the thread along: a reply from the other side marks it
-- answered; a follow-up from the side that asked reopens it.
CREATE OR REPLACE FUNCTION public.after_clarification_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_status text; v_side text;
BEGIN
  SELECT status, raised_by_side INTO v_status, v_side FROM clarifications WHERE id = NEW.clarification_id;
  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'this clarification is closed' USING ERRCODE = '23514';
  END IF;
  IF NEW.author_side <> v_side AND v_status = 'open' THEN
    UPDATE clarifications SET status = 'answered', updated_at = now() WHERE id = NEW.clarification_id;
  ELSIF NEW.author_side = v_side AND v_status = 'answered' THEN
    UPDATE clarifications SET status = 'open', updated_at = now() WHERE id = NEW.clarification_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER clarification_messages_after_insert AFTER INSERT ON "clarification_messages" FOR EACH ROW EXECUTE FUNCTION public.after_clarification_message();
--> statement-breakpoint
ALTER TABLE "clarification_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clarification_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY clarification_messages_select ON "clarification_messages" FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
--> statement-breakpoint
CREATE POLICY clarification_messages_insert ON "clarification_messages" FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_engagement(engagement_id, organisation_id)
    AND author_id = auth.uid()
    AND author_side = CASE WHEN public.is_practice_user() THEN 'primus' ELSE 'client' END
    AND (NOT public.is_practice_user() OR public.is_active_engagement_member(engagement_id))
  );
--> statement-breakpoint
REVOKE ALL ON "clarification_messages" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT ON "clarification_messages" TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- evidence_requests
-- ---------------------------------------------------------------------------
CREATE TRIGGER evidence_requests_assign_reference BEFORE INSERT ON "evidence_requests" FOR EACH ROW EXECUTE FUNCTION public.assign_engagement_reference('ER');
--> statement-breakpoint
CREATE TRIGGER evidence_requests_prevent_reparenting BEFORE UPDATE ON "evidence_requests" FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_reparenting();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_evidence_request_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_ev_engagement uuid;
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'reference and requester of an evidence request cannot change (%)', OLD.id USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'requested' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.fulfilled_evidence_id IS DISTINCT FROM OLD.fulfilled_evidence_id) THEN
    RAISE EXCEPTION 'a % evidence request cannot be changed again (%)', OLD.status, OLD.id USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'fulfilled' AND OLD.status = 'requested' THEN
    IF NEW.fulfilled_evidence_id IS NULL THEN
      RAISE EXCEPTION 'link the uploaded evidence to fulfil the request' USING ERRCODE = '23514';
    END IF;
    SELECT engagement_id INTO v_ev_engagement FROM evidence WHERE id = NEW.fulfilled_evidence_id;
    IF v_ev_engagement IS DISTINCT FROM NEW.engagement_id THEN
      RAISE EXCEPTION 'the evidence belongs to a different engagement' USING ERRCODE = '23514';
    END IF;
    NEW.fulfilled_at := now();
    NEW.fulfilled_by := auth.uid();
  END IF;
  -- Only reviewers may reword, re-date or cancel a request.
  IF auth.uid() IS NOT NULL AND NOT public.has_engagement_permission(NEW.engagement_id, 'evidence.review') THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.question_ref IS DISTINCT FROM OLD.question_ref
       OR NEW.status = 'cancelled' THEN
      RAISE EXCEPTION 'only a reviewer can change or cancel an evidence request' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER evidence_requests_guard BEFORE UPDATE ON "evidence_requests" FOR EACH ROW EXECUTE FUNCTION public.guard_evidence_request_update();
--> statement-breakpoint
CREATE TRIGGER evidence_requests_audit_log AFTER INSERT OR UPDATE ON "evidence_requests" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
--> statement-breakpoint
ALTER TABLE "evidence_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY evidence_requests_select ON "evidence_requests" FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
--> statement-breakpoint
CREATE POLICY evidence_requests_insert ON "evidence_requests" FOR INSERT TO authenticated
  WITH CHECK (public.has_engagement_permission(engagement_id, 'evidence.review') AND requested_by = auth.uid() AND status = 'requested');
--> statement-breakpoint
CREATE POLICY evidence_requests_update ON "evidence_requests" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
--> statement-breakpoint
REVOKE ALL ON "evidence_requests" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "evidence_requests" TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Discovery questionnaire
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_edit_discovery(p_engagement_id uuid, p_organisation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_access_engagement(p_engagement_id, p_organisation_id)
     AND (
       (public.is_practice_user() AND public.is_active_engagement_member(p_engagement_id)
          AND NOT public.has_engagement_permission(p_engagement_id, 'ai.agent'))
       OR (NOT public.is_practice_user() AND public.has_engagement_or_org_permission(p_engagement_id, p_organisation_id, 'client.contribute'))
     )
     AND COALESCE((
       SELECT CASE d.status
                WHEN 'in_progress' THEN true
                WHEN 'submitted' THEN public.is_practice_user()
                ELSE false
              END
         FROM engagement_discovery d WHERE d.engagement_id = p_engagement_id), true);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.can_edit_discovery(uuid, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_edit_discovery(uuid, uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_discovery_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND auth.uid() IS NOT NULL THEN
    IF OLD.status = 'in_progress' AND NEW.status = 'submitted' THEN
      IF NOT (public.has_engagement_or_org_permission(NEW.engagement_id, NEW.organisation_id, 'client.submit')
              OR public.has_engagement_permission(NEW.engagement_id, 'discovery.approve')) THEN
        RAISE EXCEPTION 'submitting the discovery questionnaire needs the client.submit permission' USING ERRCODE = '42501';
      END IF;
      NEW.submitted_at := now(); NEW.submitted_by := auth.uid();
    ELSIF NEW.status = 'approved' OR OLD.status = 'approved' OR (OLD.status = 'submitted' AND NEW.status = 'in_progress') THEN
      IF NOT public.has_engagement_permission(NEW.engagement_id, 'discovery.approve')
         OR public.has_engagement_permission(NEW.engagement_id, 'ai.agent') THEN
        RAISE EXCEPTION 'approving, returning or reopening discovery needs the discovery.approve permission' USING ERRCODE = '42501';
      END IF;
      IF NEW.status = 'approved' THEN NEW.approved_at := now(); NEW.approved_by := auth.uid();
      ELSE NEW.approved_at := NULL; NEW.approved_by := NULL; END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER engagement_discovery_prevent_reparenting BEFORE UPDATE ON "engagement_discovery" FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_reparenting();
--> statement-breakpoint
CREATE TRIGGER engagement_discovery_guard BEFORE UPDATE ON "engagement_discovery" FOR EACH ROW EXECUTE FUNCTION public.guard_discovery_update();
--> statement-breakpoint
CREATE TRIGGER engagement_discovery_audit_log AFTER INSERT OR UPDATE ON "engagement_discovery" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
--> statement-breakpoint
ALTER TABLE "engagement_discovery" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "engagement_discovery" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY engagement_discovery_select ON "engagement_discovery" FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
--> statement-breakpoint
CREATE POLICY engagement_discovery_insert ON "engagement_discovery" FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id) AND status = 'in_progress');
--> statement-breakpoint
CREATE POLICY engagement_discovery_update ON "engagement_discovery" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
--> statement-breakpoint
REVOKE ALL ON "engagement_discovery" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "engagement_discovery" TO authenticated;
--> statement-breakpoint

CREATE TRIGGER discovery_sections_prevent_reparenting BEFORE UPDATE ON "discovery_sections" FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_reparenting();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_discovery_section()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.section_key IS DISTINCT FROM OLD.section_key THEN
    RAISE EXCEPTION 'a discovery section''s key cannot change' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER discovery_sections_guard BEFORE INSERT OR UPDATE ON "discovery_sections" FOR EACH ROW EXECUTE FUNCTION public.guard_discovery_section();
--> statement-breakpoint
ALTER TABLE "discovery_sections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "discovery_sections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY discovery_sections_select ON "discovery_sections" FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
--> statement-breakpoint
CREATE POLICY discovery_sections_insert ON "discovery_sections" FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_discovery(engagement_id, organisation_id));
--> statement-breakpoint
CREATE POLICY discovery_sections_update ON "discovery_sections" FOR UPDATE TO authenticated
  USING (public.can_edit_discovery(engagement_id, organisation_id))
  WITH CHECK (public.can_edit_discovery(engagement_id, organisation_id));
--> statement-breakpoint
REVOKE ALL ON "discovery_sections" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "discovery_sections" TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- report_releases: immutable snapshots; the client sees what was released
-- ---------------------------------------------------------------------------
ALTER TABLE "report_releases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "report_releases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY report_releases_select ON "report_releases" FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
--> statement-breakpoint
CREATE POLICY report_releases_insert ON "report_releases" FOR INSERT TO authenticated
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'report.release')
    AND NOT public.has_engagement_permission(engagement_id, 'ai.agent')
    AND released_by = auth.uid()
  );
--> statement-breakpoint
REVOKE ALL ON "report_releases" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT ON "report_releases" TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Rights requests, seen from the client side. ops_cases also holds the AI's
-- draft and assessment, so a client never reads the table directly: it goes
-- through these functions, which return only the fields the client owns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rights_access_ok(p_engagement_id uuid, p_manage boolean)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organisation_id INTO v_org FROM engagements WHERE id = p_engagement_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_engagement(p_engagement_id, v_org) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = '42501';
  END IF;
  IF p_manage THEN
    IF NOT (public.has_engagement_or_org_permission(p_engagement_id, v_org, 'rights.manage')
            OR public.has_engagement_permission(p_engagement_id, 'ai.supervise')) THEN
      RAISE EXCEPTION 'not found' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT (public.has_engagement_or_org_permission(p_engagement_id, v_org, 'rights.view')
             OR public.has_engagement_or_org_permission(p_engagement_id, v_org, 'rights.manage')
             OR public.has_engagement_permission(p_engagement_id, 'ai.supervise')) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_org;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rights_access_ok(uuid, boolean) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.rights_access_ok(uuid, boolean) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.client_list_rights_requests(p_engagement_id uuid)
RETURNS TABLE (id uuid, reference text, title text, request_type text, channel text,
               received_at timestamptz, due_at timestamptz, status text, closed_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.rights_access_ok(p_engagement_id, false);
  RETURN QUERY
    SELECT c.id, c.reference, c.title, c.details->>'requestType', c.details->>'channel',
           c.received_at, c.due_at, c.status, c.closed_at
      FROM ops_cases c
     WHERE c.engagement_id = p_engagement_id AND c.case_type = 'rights_request'
     ORDER BY c.received_at DESC
     LIMIT 500;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.client_list_rights_requests(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.client_list_rights_requests(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.client_log_rights_request(
  p_engagement_id uuid, p_title text, p_request_type text, p_channel text, p_received_at timestamptz, p_due_at timestamptz)
RETURNS TABLE (id uuid, reference text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid; v_tenant uuid; v_n integer; v_ref text; v_id uuid; v_received timestamptz; v_due timestamptz;
BEGIN
  v_org := public.rights_access_ok(p_engagement_id, true);
  IF p_request_type NOT IN ('access','correction','erasure','grievance','nomination','withdraw_consent') THEN
    RAISE EXCEPTION 'unknown request type' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) = 0 OR char_length(p_title) > 200 THEN
    RAISE EXCEPTION 'give the request a short title (up to 200 characters)' USING ERRCODE = '22023';
  END IF;
  IF p_channel IS NULL OR char_length(btrim(p_channel)) = 0 OR char_length(p_channel) > 60 THEN
    RAISE EXCEPTION 'say how the request was received' USING ERRCODE = '22023';
  END IF;
  SELECT tenant_id INTO v_tenant FROM engagements WHERE engagements.id = p_engagement_id;
  v_received := COALESCE(p_received_at, now());
  v_due := COALESCE(p_due_at, v_received + interval '90 days');
  PERFORM pg_advisory_xact_lock(hashtext('ops_cases' || p_engagement_id::text));
  SELECT count(*) + 1 INTO v_n FROM ops_cases c WHERE c.engagement_id = p_engagement_id AND c.case_type = 'rights_request';
  v_ref := 'RR-' || extract(year FROM v_received AT TIME ZONE 'UTC')::int || '-' || lpad(v_n::text, 4, '0');
  INSERT INTO ops_cases (tenant_id, organisation_id, engagement_id, case_type, reference, title, received_at, due_at, details, created_by, updated_by)
  VALUES (v_tenant, v_org, p_engagement_id, 'rights_request', v_ref, btrim(p_title), v_received, v_due,
          jsonb_build_object('requestType', p_request_type, 'channel', btrim(p_channel), 'identityVerified', false, 'retentionObligation', false, 'notes', ''),
          auth.uid(), auth.uid())
  RETURNING ops_cases.id INTO v_id;
  -- Let the AI triage it, if the AI is switched on and not paused.
  INSERT INTO ai_jobs (tenant_id, organisation_id, engagement_id, kind, payload, dedupe_key, requested_by)
  SELECT v_tenant, v_org, p_engagement_id, 'plan', '{"full": false}'::jsonb, 'plan', auth.uid()
    FROM ai_engagement_settings s
   WHERE s.engagement_id = p_engagement_id AND s.enabled AND NOT s.paused
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT v_id, v_ref;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.client_log_rights_request(uuid, text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.client_log_rights_request(uuid, text, text, text, timestamptz, timestamptz) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.client_set_rights_status(p_case_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_eng uuid; v_type text; v_cur text;
BEGIN
  SELECT engagement_id, case_type, status INTO v_eng, v_type, v_cur FROM ops_cases WHERE id = p_case_id;
  IF v_eng IS NULL OR v_type <> 'rights_request' THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rights_access_ok(v_eng, true);
  IF p_status NOT IN ('in_progress', 'closed') THEN
    RAISE EXCEPTION 'a request can be moved to in progress or closed' USING ERRCODE = '22023';
  END IF;
  IF v_cur = 'closed' THEN
    RAISE EXCEPTION 'this request is already closed' USING ERRCODE = '23514';
  END IF;
  UPDATE ops_cases
     SET status = p_status,
         closed_at = CASE WHEN p_status = 'closed' THEN now() ELSE closed_at END,
         updated_by = auth.uid(), updated_at = now()
   WHERE id = p_case_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.client_set_rights_status(uuid, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.client_set_rights_status(uuid, text) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Team directory of one engagement: everyone with an active role on it or on
-- its client organisation, from both sides. Existing row security shows a
-- person only the people who share their own membership scope; the directory
-- of an engagement the caller can already open is a deliberate widening, and
-- it returns names, email and role only. The AI agent is not listed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_engagement_stakeholders(p_engagement_id uuid)
RETURNS TABLE (user_id uuid, email text, display_name text, is_client boolean, role text, scope text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organisation_id INTO v_org FROM engagements WHERE engagements.id = p_engagement_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_engagement(p_engagement_id, v_org) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, u.display_name::text, (u.client_org_id IS NOT NULL), r.name::text, 'engagement'::text
      FROM engagement_memberships m
      JOIN users u ON u.id = m.user_id
      JOIN roles r ON r.id = m.role_id
     WHERE m.engagement_id = p_engagement_id AND m.status = 'active'
       AND u.email NOT LIKE 'ai-agent@%.agent.primus.invalid'
    UNION ALL
    SELECT u.id, u.email::text, u.display_name::text, (u.client_org_id IS NOT NULL), r.name::text, 'organisation'::text
      FROM organisation_memberships om
      JOIN users u ON u.id = om.user_id
      JOIN roles r ON r.id = om.role_id
     WHERE om.organisation_id = v_org AND om.status = 'active'
       AND u.email NOT LIKE 'ai-agent@%.agent.primus.invalid';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_engagement_stakeholders(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.list_engagement_stakeholders(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Organisation industry and headquarters: only the Primus team (a tenant
-- member) edits them; client users, who can otherwise update their own
-- organisation row, cannot change these two fields.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_organisation_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.industry IS DISTINCT FROM OLD.industry OR NEW.hq_location IS DISTINCT FROM OLD.hq_location)
     AND auth.uid() IS NOT NULL
     AND NOT (public.is_practice_user() AND public.is_active_tenant_member(NEW.tenant_id)) THEN
    RAISE EXCEPTION 'only the Primus team can change an organisation''s industry or headquarters' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organisations_guard_profile BEFORE UPDATE ON "organisations" FOR EACH ROW EXECUTE FUNCTION public.guard_organisation_profile();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit trail for one engagement (from the platform audit log).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.engagement_audit_trail(p_engagement_id uuid, p_limit integer DEFAULT 200)
RETURNS TABLE (id uuid, occurred_at timestamptz, actor_user_id uuid, actor_email text, entity_type text,
               entity_id uuid, action text, changed_fields text[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organisation_id INTO v_org FROM engagements WHERE engagements.id = p_engagement_id;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT public.can_access_engagement(p_engagement_id, v_org)
     OR NOT public.has_engagement_permission(p_engagement_id, 'audit.view') THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT a.id, a.occurred_at, a.actor_user_id, u.email, a.entity_type, a.entity_id, a.action::text,
           CASE WHEN a.action = 'update' AND jsonb_typeof(a.field_changes->'new') = 'object' THEN
             ARRAY(SELECT n.key FROM jsonb_each(a.field_changes->'new') n
                    WHERE n.value IS DISTINCT FROM (a.field_changes->'old')->n.key
                      AND n.key NOT IN ('updated_at', 'updated_by')
                    ORDER BY n.key)
           ELSE ARRAY[]::text[] END
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.tenant_id = (SELECT tenant_id FROM engagements WHERE engagements.id = p_engagement_id)
       AND (
            a.entity_id = p_engagement_id
         OR a.field_changes->>'engagement_id' = p_engagement_id::text
         OR a.field_changes->'new'->>'engagement_id' = p_engagement_id::text)
     ORDER BY a.occurred_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 1000);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.engagement_audit_trail(uuid, integer) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.engagement_audit_trail(uuid, integer) TO authenticated;
