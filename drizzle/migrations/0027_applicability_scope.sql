-- PRIMUS PRIVACY — Migration 0027: Applicability & Scope (Slice D3).
--
-- drizzle-kit-generated from db/schema/{engagement-scopes,applicability-
-- determinations,assessment-controls}.ts, then hand-cleaned: drizzle-kit's
-- own snapshot has drifted from several earlier hand-written migrations
-- (0020-0023's owner_id/validated_by tenant-scoping FKs, DECISIONS.md R-02)
-- that were never drizzle-kit-generated themselves, so `generate` proposed
-- re-dropping/re-adding those unrelated FKs plus a spurious
-- `users_id_tenant_id_key` constraint as phantom "drift" — none of that
-- belongs to this slice and all of it has been removed below, leaving only
-- the genuinely new D3 schema. Reordered from drizzle-kit's raw output
-- (types → tables → new columns → FKs) for readability, matching every
-- earlier schema migration's own hand-cleanup (e.g. 0004's own comment).

CREATE TYPE "public"."applicability_determination_decision" AS ENUM('applicable', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."control_applicability_decision" AS ENUM('undecided', 'applicable', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."engagement_scope_status" AS ENUM('draft', 'locked');--> statement-breakpoint

CREATE TABLE "engagement_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"control_library_version_id" uuid NOT NULL,
	"status" "engagement_scope_status" DEFAULT 'draft' NOT NULL,
	"previous_scope_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "engagement_scopes_id_organisation_id_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "engagement_scopes_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id","control_library_version_id"),
	CONSTRAINT "engagement_scopes_id_engagement_id_organisation_id_tenant_id_key" UNIQUE("id","engagement_id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "engagement_scope_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_scope_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"control_library_version_id" uuid NOT NULL,
	"decision" "control_applicability_decision" DEFAULT 'undecided' NOT NULL,
	"rationale" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "engagement_scope_controls_scope_id_control_id_key" UNIQUE("engagement_scope_id","control_id"),
	CONSTRAINT "engagement_scope_controls_id_control_id_engagement_id_key" UNIQUE("id","control_id","engagement_id"),
	CONSTRAINT "engagement_scope_controls_rationale_required_check" CHECK (decision != 'not_applicable' OR rationale IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "applicability_determinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_scope_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"scope_description" text NOT NULL,
	"decision_value" "applicability_determination_decision" NOT NULL,
	"decision_rationale" text,
	"system_suggested_value" "applicability_determination_decision",
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "applicability_determinations_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id"),
	CONSTRAINT "applicability_determinations_rationale_required_check" CHECK (decision_value != 'not_applicable' OR decision_rationale IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "applicability_determination_regulatory_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicability_determination_id" uuid NOT NULL,
	"regulatory_reference_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ad_regulatory_references_determination_id_reference_id_key" UNIQUE("applicability_determination_id","regulatory_reference_id")
);
--> statement-breakpoint

-- Slice D3 snapshot columns on the EXISTING assessment_controls table
-- (D3 approval §4/§7): written once, by `createAssessment`, never
-- filtering AssessmentControl membership — see the security migration
-- (0028) for why no new immutability trigger is needed for them.
ALTER TABLE "assessment_controls" ADD COLUMN "applicability_decision" "control_applicability_decision" DEFAULT 'undecided' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_controls" ADD COLUMN "applicability_rationale" text;--> statement-breakpoint
ALTER TABLE "assessment_controls" ADD COLUMN "applicability_decided_by" uuid;--> statement-breakpoint
ALTER TABLE "assessment_controls" ADD COLUMN "applicability_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment_controls" ADD COLUMN "engagement_scope_control_id" uuid;--> statement-breakpoint

ALTER TABLE "engagement_scopes" ADD CONSTRAINT "engagement_scopes_engagement_organisation_tenant_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "public"."engagements"("id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_scopes" ADD CONSTRAINT "engagement_scopes_engagement_control_library_version_fk" FOREIGN KEY ("engagement_id","control_library_version_id") REFERENCES "public"."engagements"("id","control_library_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_scopes" ADD CONSTRAINT "engagement_scopes_control_library_version_tenant_fk" FOREIGN KEY ("control_library_version_id","tenant_id") REFERENCES "public"."control_library_versions"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_scopes" ADD CONSTRAINT "engagement_scopes_previous_scope_version_fk" FOREIGN KEY ("previous_scope_version_id","organisation_id") REFERENCES "public"."engagement_scopes"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "engagement_scope_controls" ADD CONSTRAINT "engagement_scope_controls_scope_fk" FOREIGN KEY ("engagement_scope_id","tenant_id","organisation_id","engagement_id","control_library_version_id") REFERENCES "public"."engagement_scopes"("id","tenant_id","organisation_id","engagement_id","control_library_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- CRITICAL (mirrors assessment_controls_control_library_version_fk,
-- migration 0008): proves this row's control_id genuinely belongs to
-- the exact control_library_version_id stored on this same row, which
-- the FK above already constrains to equal the parent EngagementScope's
-- own pinned version — together, by construction, a cross-tenant or
-- wrong-library-version Control can never be referenced (D3 §3).
ALTER TABLE "engagement_scope_controls" ADD CONSTRAINT "engagement_scope_controls_control_library_version_fk" FOREIGN KEY ("control_id","control_library_version_id") REFERENCES "public"."controls"("id","control_library_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "applicability_determinations" ADD CONSTRAINT "applicability_determinations_scope_fk" FOREIGN KEY ("engagement_scope_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."engagement_scopes"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "applicability_determination_regulatory_references" ADD CONSTRAINT "ad_regulatory_references_determination_fk" FOREIGN KEY ("applicability_determination_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."applicability_determinations"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicability_determination_regulatory_references" ADD CONSTRAINT "ad_regulatory_references_reference_tenant_fk" FOREIGN KEY ("regulatory_reference_id","tenant_id") REFERENCES "public"."regulatory_references"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Slice D3 §7 (snapshot design): proves the pinned EngagementScopeControl
-- source genuinely belongs to the SAME Control and Engagement as this
-- AssessmentControl row — the identical "prove by construction"
-- technique as assessment_controls_control_library_version_fk, applied
-- to the new snapshot pin. Nullable on both sides (no locked Scope may
-- have existed at Assessment creation), matching every other optional
-- composite FK in this codebase (e.g. data_store_versions_system_
-- version_organisation_fk).
ALTER TABLE "assessment_controls" ADD CONSTRAINT "assessment_controls_engagement_scope_control_fk" FOREIGN KEY ("engagement_scope_control_id","control_id","engagement_id") REFERENCES "public"."engagement_scope_controls"("id","control_id","engagement_id") ON DELETE no action ON UPDATE no action;
