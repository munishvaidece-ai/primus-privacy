CREATE TYPE "public"."finding_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'in_progress', 'resolved', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."remediation_action_status" AS ENUM('open', 'in_progress', 'evidence_submitted', 'validated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."remediation_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."risk_rating" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."risk_status" AS ENUM('open', 'mitigating', 'accepted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."validation_outcome" AS ENUM('accepted', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."evidence_link_subject_type" ADD VALUE 'remediation_action';--> statement-breakpoint
ALTER TYPE "public"."evidence_link_subject_type" ADD VALUE 'validation_record';--> statement-breakpoint
CREATE TABLE "risk_scoring_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"matrix_definition" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "risk_scoring_models_tenant_id_version_key" UNIQUE("tenant_id","version"),
	CONSTRAINT "risk_scoring_models_id_tenant_id_key" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_response_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"likelihood" integer NOT NULL,
	"impact" integer NOT NULL,
	"inherent_rating" "risk_rating" NOT NULL,
	"residual_likelihood" integer,
	"residual_impact" integer,
	"residual_rating" "risk_rating",
	"risk_scoring_model_id" uuid NOT NULL,
	"status" "risk_status" DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"previous_risk_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "risks_id_organisation_id_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "risks_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id"),
	CONSTRAINT "risks_likelihood_range_check" CHECK (likelihood BETWEEN 1 AND 5),
	CONSTRAINT "risks_impact_range_check" CHECK (impact BETWEEN 1 AND 5),
	CONSTRAINT "risks_residual_likelihood_range_check" CHECK (residual_likelihood IS NULL OR residual_likelihood BETWEEN 1 AND 5),
	CONSTRAINT "risks_residual_impact_range_check" CHECK (residual_impact IS NULL OR residual_impact BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "risk_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"risk_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "risk_controls_risk_id_control_id_key" UNIQUE("risk_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "risk_processing_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"risk_id" uuid NOT NULL,
	"processing_activity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "risk_processing_activities_risk_id_processing_activity_id_key" UNIQUE("risk_id","processing_activity_id")
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" "finding_severity" NOT NULL,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "findings_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id")
);
--> statement-breakpoint
CREATE TABLE "finding_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "finding_controls_finding_id_control_id_key" UNIQUE("finding_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "finding_processing_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"processing_activity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "finding_processing_activities_finding_id_processing_activity_id_key" UNIQUE("finding_id","processing_activity_id")
);
--> statement-breakpoint
CREATE TABLE "finding_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "finding_risks_finding_id_risk_id_key" UNIQUE("finding_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "remediation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_id" uuid,
	"due_date" date,
	"priority" "remediation_priority",
	"status" "remediation_action_status" DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "remediation_actions_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id")
);
--> statement-breakpoint
CREATE TABLE "remediation_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"remediation_action_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "remediation_controls_remediation_action_id_control_id_key" UNIQUE("remediation_action_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "remediation_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"remediation_action_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "remediation_findings_remediation_action_id_finding_id_key" UNIQUE("remediation_action_id","finding_id")
);
--> statement-breakpoint
CREATE TABLE "remediation_risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"remediation_action_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "remediation_risks_remediation_action_id_risk_id_key" UNIQUE("remediation_action_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "validation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"remediation_action_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" "validation_outcome" NOT NULL,
	"rationale" text,
	"triggers_control_test_id" uuid,
	"triggers_assessment_response_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "validation_records_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id"),
	CONSTRAINT "validation_records_only_accepted_triggers_reassessment_check" CHECK (outcome = 'accepted' OR (triggers_control_test_id IS NULL AND triggers_assessment_response_id IS NULL)),
	CONSTRAINT "validation_records_at_most_one_reassessment_target_check" CHECK (triggers_control_test_id IS NULL OR triggers_assessment_response_id IS NULL)
);
--> statement-breakpoint
ALTER TABLE "evidence_links" DROP CONSTRAINT "evidence_links_assessment_response_requires_engagement_check";--> statement-breakpoint
ALTER TABLE "evidence_links" DROP CONSTRAINT "evidence_links_subject_matches_type_check";--> statement-breakpoint
ALTER TABLE "evidence_links" ADD COLUMN "remediation_action_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD COLUMN "validation_record_id" uuid;--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_id_organisation_id_key" UNIQUE("id","organisation_id");--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_id_tenant_id_organisation_id_engagement_id_key" UNIQUE("id","tenant_id","organisation_id","engagement_id");--> statement-breakpoint
ALTER TABLE "risk_scoring_models" ADD CONSTRAINT "risk_scoring_models_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_engagement_organisation_tenant_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "public"."engagements"("id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_risk_scoring_model_tenant_fk" FOREIGN KEY ("risk_scoring_model_id","tenant_id") REFERENCES "public"."risk_scoring_models"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_assessment_response_scope_fk" FOREIGN KEY ("assessment_response_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."assessment_responses"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_previous_risk_organisation_fk" FOREIGN KEY ("previous_risk_id","organisation_id") REFERENCES "public"."risks"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_controls" ADD CONSTRAINT "risk_controls_risk_scope_fk" FOREIGN KEY ("risk_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."risks"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_controls" ADD CONSTRAINT "risk_controls_control_tenant_fk" FOREIGN KEY ("control_id","tenant_id") REFERENCES "public"."controls"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_processing_activities" ADD CONSTRAINT "risk_processing_activities_risk_scope_fk" FOREIGN KEY ("risk_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."risks"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_processing_activities" ADD CONSTRAINT "risk_processing_activities_processing_activity_scope_fk" FOREIGN KEY ("processing_activity_id","engagement_id","organisation_id") REFERENCES "public"."processing_activities"("id","engagement_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_engagement_organisation_tenant_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "public"."engagements"("id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_controls" ADD CONSTRAINT "finding_controls_finding_scope_fk" FOREIGN KEY ("finding_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."findings"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_controls" ADD CONSTRAINT "finding_controls_control_tenant_fk" FOREIGN KEY ("control_id","tenant_id") REFERENCES "public"."controls"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_processing_activities" ADD CONSTRAINT "finding_processing_activities_finding_scope_fk" FOREIGN KEY ("finding_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."findings"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_processing_activities" ADD CONSTRAINT "finding_processing_activities_processing_activity_scope_fk" FOREIGN KEY ("processing_activity_id","engagement_id","organisation_id") REFERENCES "public"."processing_activities"("id","engagement_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_risks" ADD CONSTRAINT "finding_risks_finding_scope_fk" FOREIGN KEY ("finding_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."findings"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_risks" ADD CONSTRAINT "finding_risks_risk_scope_fk" FOREIGN KEY ("risk_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."risks"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_engagement_organisation_tenant_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "public"."engagements"("id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_controls" ADD CONSTRAINT "remediation_controls_remediation_action_scope_fk" FOREIGN KEY ("remediation_action_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."remediation_actions"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_controls" ADD CONSTRAINT "remediation_controls_control_tenant_fk" FOREIGN KEY ("control_id","tenant_id") REFERENCES "public"."controls"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_findings" ADD CONSTRAINT "remediation_findings_remediation_action_scope_fk" FOREIGN KEY ("remediation_action_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."remediation_actions"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_findings" ADD CONSTRAINT "remediation_findings_finding_scope_fk" FOREIGN KEY ("finding_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."findings"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_risks" ADD CONSTRAINT "remediation_risks_remediation_action_scope_fk" FOREIGN KEY ("remediation_action_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."remediation_actions"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_risks" ADD CONSTRAINT "remediation_risks_risk_scope_fk" FOREIGN KEY ("risk_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."risks"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_records" ADD CONSTRAINT "validation_records_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_records" ADD CONSTRAINT "validation_records_remediation_action_scope_fk" FOREIGN KEY ("remediation_action_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."remediation_actions"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_records" ADD CONSTRAINT "validation_records_triggers_control_test_scope_fk" FOREIGN KEY ("triggers_control_test_id","organisation_id") REFERENCES "public"."control_tests"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_records" ADD CONSTRAINT "validation_records_triggers_assessment_response_scope_fk" FOREIGN KEY ("triggers_assessment_response_id","organisation_id") REFERENCES "public"."assessment_responses"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_remediation_action_scope_fk" FOREIGN KEY ("remediation_action_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."remediation_actions"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_validation_record_scope_fk" FOREIGN KEY ("validation_record_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."validation_records"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_evidence_id_remediation_action_id_key" UNIQUE("evidence_id","remediation_action_id");--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_evidence_id_validation_record_id_key" UNIQUE("evidence_id","validation_record_id");--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_requires_engagement_check" CHECK (subject_type = 'control_test' OR engagement_id IS NOT NULL);
-- NOTE: `evidence_links_subject_matches_type_check` is intentionally NOT
-- recreated in this file. Postgres forbids using an enum value added by
-- `ALTER TYPE ... ADD VALUE` (lines 8-9 above) within the same implicit
-- transaction that also uses it in an expression — and this migration
-- file is applied as one multi-statement batch (see
-- scripts/apply-migrations.ts), which Postgres executes as a single
-- transaction. The replacement CHECK constraint (referencing the new
-- 'remediation_action'/'validation_record' values) is added in migration
-- 0013 instead, once the enum additions above are safely committed. Until
-- 0013 runs, `evidence_links` is briefly without this specific CHECK —
-- the same sequencing every migration pair in this project already
-- accepts between its schema file and its hand-written security file.
-- See DECISIONS.md.