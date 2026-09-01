CREATE TYPE "public"."assessment_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."assessment_type" AS ENUM('control_readiness', 'annual', 'dpia', 'sdf_screening', 'third_party');--> statement-breakpoint
CREATE TYPE "public"."control_effectiveness_rating" AS ENUM('not_assessed', 'not_applicable', 'not_implemented', 'partially_implemented', 'implemented');--> statement-breakpoint
CREATE TYPE "public"."control_test_result" AS ENUM('pass', 'fail', 'exception_noted');--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"control_library_version_id" uuid NOT NULL,
	"assessment_type" "assessment_type" NOT NULL,
	"period_label" text NOT NULL,
	"status" "assessment_status" DEFAULT 'draft' NOT NULL,
	"previous_assessment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "assessments_id_organisation_id_key" UNIQUE("id","organisation_id"),
	CONSTRAINT "assessments_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id","control_library_version_id"),
	CONSTRAINT "assessments_id_engagement_id_organisation_id_tenant_id_key" UNIQUE("id","engagement_id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"control_library_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "assessment_controls_assessment_id_control_id_key" UNIQUE("assessment_id","control_id"),
	CONSTRAINT "assessment_controls_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_control_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"effectiveness_rating" "control_effectiveness_rating" NOT NULL,
	"system_suggested_rating" "control_effectiveness_rating",
	"decision_rating" "control_effectiveness_rating",
	"decision_rationale" text,
	"respondent_id" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "assessment_responses_assessment_control_id_key" UNIQUE("assessment_control_id")
);
--> statement-breakpoint
CREATE TABLE "control_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"control_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid,
	"organisation_id" uuid,
	"engagement_id" uuid,
	"methodology" text NOT NULL,
	"sample_description" text,
	"result" "control_test_result" NOT NULL,
	"tester_id" uuid,
	"tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_id_control_library_version_id_key" UNIQUE("id","control_library_version_id");--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_id_control_library_version_id_key" UNIQUE("id","control_library_version_id");--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_engagement_organisation_tenant_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "public"."engagements"("id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_engagement_control_library_version_fk" FOREIGN KEY ("engagement_id","control_library_version_id") REFERENCES "public"."engagements"("id","control_library_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_control_library_version_tenant_fk" FOREIGN KEY ("control_library_version_id","tenant_id") REFERENCES "public"."control_library_versions"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_previous_assessment_organisation_fk" FOREIGN KEY ("previous_assessment_id","organisation_id") REFERENCES "public"."assessments"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_controls" ADD CONSTRAINT "assessment_controls_assessment_scope_fk" FOREIGN KEY ("assessment_id","tenant_id","organisation_id","engagement_id","control_library_version_id") REFERENCES "public"."assessments"("id","tenant_id","organisation_id","engagement_id","control_library_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_controls" ADD CONSTRAINT "assessment_controls_control_library_version_fk" FOREIGN KEY ("control_id","control_library_version_id") REFERENCES "public"."controls"("id","control_library_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_respondent_id_users_id_fk" FOREIGN KEY ("respondent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_assessment_control_scope_fk" FOREIGN KEY ("assessment_control_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."assessment_controls"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_tester_id_users_id_fk" FOREIGN KEY ("tester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_control_tenant_fk" FOREIGN KEY ("control_id","tenant_id") REFERENCES "public"."controls"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_assessment_control_fk" FOREIGN KEY ("assessment_id","control_id") REFERENCES "public"."assessment_controls"("assessment_id","control_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_assessment_scope_fk" FOREIGN KEY ("assessment_id","engagement_id","organisation_id","tenant_id") REFERENCES "public"."assessments"("id","engagement_id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;