-- PRIMUS PRIVACY — Migration 0044: operational cases (DECISIONS.md R-189).
--
-- The four operating flows beside the seven-phase engagement journey:
-- data-principal rights requests, personal-data breaches, consent reviews
-- and vendor (processor) reviews. One engagement-scoped table with a
-- case_type; the AI triages each case, drafts the response and clocks the
-- deadline; outgoing breach notices sit behind a sign-off gate.
--
-- PRIVACY: a case carries a client-side REFERENCE (a ticket id from the
-- client's own system) — not the data principal's name or contact details.

CREATE TABLE "ops_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"case_type" text NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"severity" "ai_risk_tier",
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_assessment" jsonb,
	"draft_response" text,
	"response_approved_at" timestamp with time zone,
	"response_approved_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ops_cases_type_check" CHECK (case_type IN ('rights_request','breach','consent_review','vendor_review')),
	CONSTRAINT "ops_cases_status_check" CHECK (status IN ('new','triaged','in_progress','awaiting_approval','closed')),
	CONSTRAINT "ops_cases_reference_key" UNIQUE("engagement_id","reference"),
	CONSTRAINT "ops_cases_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE INDEX "ops_cases_engagement_idx" ON "ops_cases" ("engagement_id","case_type","status");
