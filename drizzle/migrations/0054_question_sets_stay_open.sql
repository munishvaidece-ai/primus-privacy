-- PRIMUS PRIVACY — Migration 0054: question sets stay open for answers.
--
-- The sector question sets (section keys that start with "sq_") are saved in
-- discovery_sections like the discovery steps, but they are not part of the
-- scope the client submits and Primus approves. A client keeps answering them
-- while the engagement runs. So for these keys the lock that follows the
-- discovery status (submitted, approved) does not apply; who may write is the
-- same as for discovery (practice staff on the engagement, not the AI agent;
-- client people with the contribute permission).

CREATE OR REPLACE FUNCTION public.can_edit_question_sets(p_engagement_id uuid, p_organisation_id uuid)
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
     );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.can_edit_question_sets(uuid, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_edit_question_sets(uuid, uuid) TO authenticated;
--> statement-breakpoint

DROP POLICY discovery_sections_insert ON "discovery_sections";
--> statement-breakpoint
DROP POLICY discovery_sections_update ON "discovery_sections";
--> statement-breakpoint
CREATE POLICY discovery_sections_insert ON "discovery_sections" FOR INSERT TO authenticated
  WITH CHECK (
    CASE WHEN section_key LIKE 'sq\_%' THEN public.can_edit_question_sets(engagement_id, organisation_id)
         ELSE public.can_edit_discovery(engagement_id, organisation_id) END
  );
--> statement-breakpoint
CREATE POLICY discovery_sections_update ON "discovery_sections" FOR UPDATE TO authenticated
  USING (
    CASE WHEN section_key LIKE 'sq\_%' THEN public.can_edit_question_sets(engagement_id, organisation_id)
         ELSE public.can_edit_discovery(engagement_id, organisation_id) END
  )
  WITH CHECK (
    CASE WHEN section_key LIKE 'sq\_%' THEN public.can_edit_question_sets(engagement_id, organisation_id)
         ELSE public.can_edit_discovery(engagement_id, organisation_id) END
  );
