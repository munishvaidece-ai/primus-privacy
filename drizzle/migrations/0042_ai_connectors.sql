-- PRIMUS PRIVACY — Migration 0042: connectors (DECISIONS.md R-188).
--
-- A connector is a configured link from an engagement to a client system
-- the AI may scan. The platform stores METADATA ONLY about what a scan
-- finds (an asset's name, location, the categories of personal data it
-- appears to hold and counts) — never copies of the personal data itself.
-- Secrets (passwords, tokens) live in a separate table that no end-user
-- role can read; see migration 0043.

CREATE TABLE "ai_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"connector_type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'configured' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"has_secret" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ai_connectors_status_check" CHECK (status IN ('configured','connected','error','disabled')),
	CONSTRAINT "ai_connectors_name_key" UNIQUE("engagement_id","name"),
	CONSTRAINT "ai_connectors_id_engagement_key" UNIQUE("id","engagement_id"),
	CONSTRAINT "ai_connectors_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint

CREATE TABLE "ai_connector_secrets" (
	"connector_id" uuid PRIMARY KEY NOT NULL,
	"engagement_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_connector_secrets_connector_fk" FOREIGN KEY ("connector_id","engagement_id") REFERENCES "ai_connectors"("id","engagement_id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE "ai_connector_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"run_type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "ai_connector_runs_type_check" CHECK (run_type IN ('test','scan')),
	CONSTRAINT "ai_connector_runs_status_check" CHECK (status IN ('running','succeeded','failed')),
	CONSTRAINT "ai_connector_runs_connector_fk" FOREIGN KEY ("connector_id","engagement_id") REFERENCES "ai_connectors"("id","engagement_id")
);
--> statement-breakpoint
CREATE INDEX "ai_connector_runs_connector_idx" ON "ai_connector_runs" ("connector_id","started_at" DESC);--> statement-breakpoint

CREATE TABLE "ai_discovered_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"run_id" uuid,
	"asset_type" text NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pii_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"sensitivity" text DEFAULT 'unclassified' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_discovered_assets_sensitivity_check" CHECK (sensitivity IN ('unclassified','none','personal','sensitive')),
	CONSTRAINT "ai_discovered_assets_key" UNIQUE("connector_id","asset_type","location"),
	CONSTRAINT "ai_discovered_assets_connector_fk" FOREIGN KEY ("connector_id","engagement_id") REFERENCES "ai_connectors"("id","engagement_id")
);
--> statement-breakpoint
CREATE INDEX "ai_discovered_assets_engagement_idx" ON "ai_discovered_assets" ("engagement_id","last_seen_at" DESC);
