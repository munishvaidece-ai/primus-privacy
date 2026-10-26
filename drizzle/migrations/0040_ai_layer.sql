-- PRIMUS PRIVACY — Migration 0040: AI layer (autopilot, supervisor queue,
-- audit trail, extracted document text).
--
-- Hand-written, same rationale as every earlier hand-written migration
-- (DECISIONS.md R-02). Security layer (RLS, triggers, GRANTs) is in the
-- companion migration 0041, by this project's established convention.
--
-- Design (DECISIONS.md R-182..R-190):
--   * The AI is an ordinary, dedicated USER (an "AI Analyst" engagement
--     membership), never a bypass: everything it writes to the existing
--     domain tables goes through the same domain functions, the same RLS
--     and the same audit trail as a human's action.
--   * Every AI output is first recorded as an `ai_suggestions` row
--     (suggest / accept / modify / reject — the repo's own AI principle,
--     ARCHITECTURE.md §8). Autopilot is a POLICY that auto-accepts
--     suggestions; it is never a separate write path.
--   * Four sign-off gates can force a suggestion to a human regardless of
--     the autopilot level.
--   * Metadata only: nothing here stores client personal data beyond the
--     text of documents the practice already holds as evidence.

CREATE TYPE "public"."ai_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_status" AS ENUM('pending_review', 'auto_applied', 'approved', 'overridden', 'rejected', 'superseded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_risk_tier" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Per-engagement AI settings: the autopilot level, the pause switch, the
-- confidence thresholds and the four gates.
-- -----------------------------------------------------------------------------
CREATE TABLE "ai_engagement_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"autopilot_level" smallint DEFAULT 2 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_by" uuid,
	"threshold_supervised" numeric(3,2) DEFAULT 0.90 NOT NULL,
	"threshold_full" numeric(3,2) DEFAULT 0.75 NOT NULL,
	"gate_reject_critical_evidence" boolean DEFAULT true NOT NULL,
	"gate_release_critical_findings" boolean DEFAULT true NOT NULL,
	"gate_issue_final_report" boolean DEFAULT true NOT NULL,
	"gate_send_breach_notices" boolean DEFAULT true NOT NULL,
	"allow_external_ai" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ai_engagement_settings_engagement_key" UNIQUE("engagement_id"),
	CONSTRAINT "ai_engagement_settings_level_check" CHECK (autopilot_level BETWEEN 1 AND 3),
	CONSTRAINT "ai_engagement_settings_threshold_check" CHECK (threshold_supervised BETWEEN 0.50 AND 1.00 AND threshold_full BETWEEN 0.50 AND 1.00),
	CONSTRAINT "ai_engagement_settings_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Job queue (database-backed; the worker claims with FOR UPDATE SKIP LOCKED).
-- -----------------------------------------------------------------------------
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "ai_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"result" jsonb,
	"dedupe_key" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_jobs_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE INDEX "ai_jobs_claim_idx" ON "ai_jobs" ("status","run_after");--> statement-breakpoint
CREATE INDEX "ai_jobs_engagement_idx" ON "ai_jobs" ("engagement_id","created_at" DESC);--> statement-breakpoint
-- At most one queued/running job per dedupe key — makes "run autopilot"
-- idempotent when pressed twice.
CREATE UNIQUE INDEX "ai_jobs_active_dedupe_key" ON "ai_jobs" ("engagement_id","dedupe_key") WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Suggestions: every AI output, with its evidence, confidence and routing.
-- -----------------------------------------------------------------------------
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"proposed" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" numeric(4,3) NOT NULL,
	"risk_tier" "ai_risk_tier" NOT NULL,
	"gate" text,
	"routing_reason" text NOT NULL,
	"status" "ai_suggestion_status" DEFAULT 'pending_review' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"autopilot_level" smallint NOT NULL,
	"input_hash" text NOT NULL,
	"final_value" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"applied_at" timestamp with time zone,
	"apply_error" text,
	"result_ref" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_suggestions_confidence_check" CHECK (confidence BETWEEN 0 AND 1),
	CONSTRAINT "ai_suggestions_level_check" CHECK (autopilot_level BETWEEN 1 AND 3),
	CONSTRAINT "ai_suggestions_decision_note_check" CHECK (status NOT IN ('rejected','overridden') OR decision_note IS NOT NULL),
	CONSTRAINT "ai_suggestions_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id"),
	CONSTRAINT "ai_suggestions_job_fk" FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id")
);
--> statement-breakpoint
CREATE INDEX "ai_suggestions_queue_idx" ON "ai_suggestions" ("engagement_id","status","created_at" DESC);--> statement-breakpoint
-- A given (kind, subject, input) is suggested once while still open: the
-- same inputs never produce a duplicate suggestion on re-run.
CREATE UNIQUE INDEX "ai_suggestions_open_input_key" ON "ai_suggestions" ("engagement_id","kind","input_hash") WHERE status = 'pending_review';--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Append-only, human-readable AI audit trail (in addition to the generic
-- audit_log trigger on the tables above).
-- -----------------------------------------------------------------------------
CREATE TABLE "ai_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"suggestion_id" uuid,
	"job_id" uuid,
	"subject_type" text,
	"subject_id" uuid,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"message" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_events_actor_type_check" CHECK (actor_type IN ('ai','human','system')),
	CONSTRAINT "ai_events_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE INDEX "ai_events_engagement_idx" ON "ai_events" ("engagement_id","created_at" DESC);--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Extracted text of uploaded evidence documents (so a document is read
-- once, not once per AI task). Text of documents the practice already
-- holds as evidence — never harvested client data.
-- -----------------------------------------------------------------------------
CREATE TABLE "ai_document_extracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid,
	"document_version_id" uuid NOT NULL,
	"text_content" text NOT NULL,
	"char_count" integer NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"method" text NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_document_extracts_version_key" UNIQUE("document_version_id"),
	CONSTRAINT "ai_document_extracts_version_fk" FOREIGN KEY ("document_version_id","tenant_id","organisation_id") REFERENCES "document_versions"("id","tenant_id","organisation_id")
);
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- Final-report issuances: the signed-off executive narrative of an assessment.
-- Immutable; a re-issue is a new row with a higher version.
-- -----------------------------------------------------------------------------
CREATE TABLE "ai_report_issuances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"headline" text NOT NULL,
	"narrative" text NOT NULL,
	"suggestion_id" uuid,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_report_issuances_version_key" UNIQUE("assessment_id","version"),
	CONSTRAINT "ai_report_issuances_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id"),
	CONSTRAINT "ai_report_issuances_assessment_fk" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id")
);
