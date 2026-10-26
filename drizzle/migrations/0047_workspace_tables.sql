-- PRIMUS PRIVACY — Migration 0047: workspace and client-portal tables
-- (DECISIONS.md R-191..R-199). Security (RLS, triggers, grants) is in 0048.
--
--   notifications            in-app messages to one user
--   engagement_activity      human-readable activity feed per engagement
--   engagement_tasks         assigned tasks and milestones, Primus or client side
--   clarifications (+messages)  reviewer questions and client answers
--   evidence_requests        "please provide this evidence"
--   engagement_discovery (+sections)  the 13-step client questionnaire
--   report_releases          reports released to the client (immutable snapshot)

CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_title_len_check" CHECK (char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "notifications_body_len_check" CHECK (body IS NULL OR char_length(body) <= 2000),
	CONSTRAINT "notifications_link_check" CHECK (link IS NULL OR (link LIKE '/%' AND link NOT LIKE '//%' AND char_length(link) <= 500))
);
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id", "read_at", "created_at" DESC);
--> statement-breakpoint

CREATE TABLE "engagement_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"client_visible" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_activity_summary_len_check" CHECK (char_length(summary) BETWEEN 1 AND 500),
	CONSTRAINT "engagement_activity_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE INDEX "engagement_activity_engagement_idx" ON "engagement_activity" ("engagement_id", "occurred_at" DESC);
--> statement-breakpoint

CREATE TABLE "engagement_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"kind" text DEFAULT 'task' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_side" text NOT NULL,
	"assignee_user_id" uuid,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "engagement_tasks_kind_check" CHECK (kind IN ('task','milestone')),
	CONSTRAINT "engagement_tasks_side_check" CHECK (assignee_side IN ('primus','client')),
	CONSTRAINT "engagement_tasks_status_check" CHECK (status IN ('open','done','cancelled')),
	CONSTRAINT "engagement_tasks_title_len_check" CHECK (char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "engagement_tasks_description_len_check" CHECK (description IS NULL OR char_length(description) <= 2000),
	CONSTRAINT "engagement_tasks_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE INDEX "engagement_tasks_engagement_idx" ON "engagement_tasks" ("engagement_id", "status", "due_date");
--> statement-breakpoint

CREATE TABLE "clarifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"reference" text,
	"subject" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"raised_by" uuid NOT NULL,
	"raised_by_side" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clarifications_status_check" CHECK (status IN ('open','answered','closed')),
	CONSTRAINT "clarifications_side_check" CHECK (raised_by_side IN ('primus','client')),
	CONSTRAINT "clarifications_subject_len_check" CHECK (char_length(subject) BETWEEN 1 AND 300),
	CONSTRAINT "clarifications_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id"),
	CONSTRAINT "clarifications_id_engagement_key" UNIQUE ("id","engagement_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "clarifications_reference_key" ON "clarifications" ("engagement_id","reference");
--> statement-breakpoint
CREATE INDEX "clarifications_engagement_idx" ON "clarifications" ("engagement_id", "status", "raised_at" DESC);
--> statement-breakpoint

CREATE TABLE "clarification_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"clarification_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"author_side" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clarification_messages_side_check" CHECK (author_side IN ('primus','client')),
	CONSTRAINT "clarification_messages_body_len_check" CHECK (char_length(body) BETWEEN 1 AND 5000),
	CONSTRAINT "clarification_messages_clarification_fk" FOREIGN KEY ("clarification_id","engagement_id") REFERENCES "clarifications"("id","engagement_id")
);
--> statement-breakpoint
CREATE INDEX "clarification_messages_thread_idx" ON "clarification_messages" ("clarification_id", "created_at");
--> statement-breakpoint

CREATE TABLE "evidence_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"reference" text,
	"title" text NOT NULL,
	"description" text,
	"question_ref" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"fulfilled_evidence_id" uuid,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_requests_status_check" CHECK (status IN ('requested','fulfilled','cancelled')),
	CONSTRAINT "evidence_requests_title_len_check" CHECK (char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "evidence_requests_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id"),
	CONSTRAINT "evidence_requests_evidence_fk" FOREIGN KEY ("fulfilled_evidence_id") REFERENCES "evidence"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_requests_reference_key" ON "evidence_requests" ("engagement_id","reference");
--> statement-breakpoint
CREATE INDEX "evidence_requests_engagement_idx" ON "evidence_requests" ("engagement_id", "status");
--> statement-breakpoint

CREATE TABLE "engagement_discovery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_discovery_status_check" CHECK (status IN ('in_progress','submitted','approved')),
	CONSTRAINT "engagement_discovery_engagement_key" UNIQUE ("engagement_id"),
	CONSTRAINT "engagement_discovery_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint

CREATE TABLE "discovery_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "discovery_sections_key_check" CHECK (section_key ~ '^[a-z_]{3,40}$'),
	CONSTRAINT "discovery_sections_unique" UNIQUE ("engagement_id","section_key"),
	CONSTRAINT "discovery_sections_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint

CREATE TABLE "report_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"title" text NOT NULL,
	"report_type" text DEFAULT 'engagement_report' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" bytea NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_releases_title_len_check" CHECK (char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "report_releases_size_check" CHECK (size_bytes > 0 AND size_bytes <= 20000000 AND size_bytes = octet_length(content)),
	CONSTRAINT "report_releases_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "report_releases_version_key" ON "report_releases" ("engagement_id","report_type","version");
