-- Evidence trail for AI suggestions: what the AI read, where each piece came
-- from, and why it was selected. Written once when the suggestion is created
-- and never changed afterwards (like the proposal and citations it explains).
ALTER TABLE "ai_suggestions" ADD COLUMN "sources" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_ai_suggestion_sources()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sources IS DISTINCT FROM OLD.sources THEN
    RAISE EXCEPTION 'ai_suggestions sources are immutable after creation (suggestion %)', OLD.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER ai_suggestions_guard_sources
  BEFORE UPDATE ON "ai_suggestions"
  FOR EACH ROW EXECUTE FUNCTION public.guard_ai_suggestion_sources();

--> statement-breakpoint

-- Names for the evidence trail. The AI agent cannot read the users table, so
-- this is the only way it learns who uploaded or answered something. It returns
-- a display name and which side the person is on (Primus team: client_org_id is
-- null; client organisation: set), only for people who belong to this
-- engagement's practice and, for client people, to this engagement's
-- organisation, and only to someone allowed to work with AI on the engagement.
CREATE OR REPLACE FUNCTION public.ai_actor_names(p_engagement_id uuid, p_ids uuid[])
RETURNS TABLE (id uuid, name text, client_org_id uuid, is_agent boolean)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    public.has_engagement_permission(p_engagement_id, 'ai.agent')
    OR public.has_engagement_permission(p_engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(p_engagement_id, 'ai.configure')
  ) THEN
    RAISE EXCEPTION 'not found or not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.id, coalesce(nullif(u.display_name, ''), u.email)::text, u.client_org_id,
           (u.email LIKE 'ai-agent@%.agent.primus.invalid')
      FROM users u
      JOIN engagements e ON e.id = p_engagement_id
     WHERE u.id = ANY (p_ids)
       AND u.tenant_id = e.tenant_id
       AND (u.client_org_id IS NULL OR u.client_org_id = e.organisation_id);
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.ai_actor_names(uuid, uuid[]) FROM PUBLIC, anon;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.ai_actor_names(uuid, uuid[]) TO authenticated, service_role;
