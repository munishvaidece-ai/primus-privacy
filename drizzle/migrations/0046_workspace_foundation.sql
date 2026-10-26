-- PRIMUS PRIVACY — Migration 0046: workspace foundation (DECISIONS.md R-191..).
--
-- Adds what the portfolio / client-portal screens need on top of the
-- existing model: organisation industry and HQ, findings that stay private
-- until a person releases them, assessment submission and reviewer
-- validation, the new permissions, and the helper functions the later
-- tables use.

-- ---------------------------------------------------------------------------
-- Organisations: industry and headquarters (shown in lists and filters).
-- ---------------------------------------------------------------------------
ALTER TABLE "organisations" ADD COLUMN "industry" text;
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "hq_location" text;
--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_industry_len_check" CHECK (industry IS NULL OR char_length(industry) <= 80);
--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_hq_len_check" CHECK (hq_location IS NULL OR char_length(hq_location) <= 120);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Findings: private until released.
-- ---------------------------------------------------------------------------
ALTER TABLE "findings" ADD COLUMN "released_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "released_by" uuid;
--> statement-breakpoint
-- Findings that already exist were already visible to the client; keep that.
UPDATE "findings" SET released_at = created_at, released_by = created_by WHERE released_at IS NULL;
--> statement-breakpoint
CREATE INDEX "findings_engagement_released_idx" ON "findings" ("engagement_id", "released_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Assessment: client submission and reviewer validation.
-- ---------------------------------------------------------------------------
ALTER TABLE "assessments" ADD COLUMN "submitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "submitted_by" uuid;
--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD COLUMN "validated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD COLUMN "validated_by" uuid;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Is the caller a practice (PRIMUS-side) user? users.client_org_id is NULL
-- for practice users and set for client users (the same signal
-- accept_invitation() uses). False for an unauthenticated caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_practice_user()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT client_org_id IS NULL FROM users WHERE id = auth.uid()), false);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_practice_user() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_practice_user() TO authenticated;
--> statement-breakpoint

-- Is this user the platform's AI agent? (a user that holds the AI Analyst role)
CREATE OR REPLACE FUNCTION public.is_ai_agent_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM engagement_memberships em
    JOIN roles r ON r.id = em.role_id
    WHERE em.user_id = p_user_id AND r.name = 'AI Analyst'
  ) OR EXISTS (
    SELECT 1 FROM users u WHERE u.id = p_user_id AND u.email LIKE 'ai-agent@%.agent.primus.invalid'
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_ai_agent_user(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_ai_agent_user(uuid) TO authenticated;
