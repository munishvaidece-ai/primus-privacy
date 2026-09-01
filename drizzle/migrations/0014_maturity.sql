CREATE TYPE "public"."maturity_assessment_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TABLE "maturity_scoring_methodologies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"definition" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "maturity_scoring_methodologies_tenant_id_version_key" UNIQUE("tenant_id","version"),
	CONSTRAINT "maturity_scoring_methodologies_id_tenant_id_key" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "maturity_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "maturity_domains_tenant_id_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "maturity_domains_id_tenant_id_key" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "maturity_domain_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"maturity_domain_id" uuid NOT NULL,
	"weight" numeric(5, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "maturity_domain_weights_id_engagement_id_key" UNIQUE("id","engagement_id"),
	CONSTRAINT "maturity_domain_weights_weight_positive_check" CHECK (weight > 0)
);
--> statement-breakpoint
CREATE TABLE "maturity_domain_control_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"maturity_domain_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "maturity_domain_control_mappings_maturity_domain_id_control_id_key" UNIQUE("maturity_domain_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "maturity_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"maturity_scoring_methodology_id" uuid NOT NULL,
	"status" "maturity_assessment_status" DEFAULT 'draft' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"computed_by" uuid,
	"finalized_at" timestamp with time zone,
	"computed_from_risk_ids" uuid[],
	"computed_from_validation_record_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "maturity_assessments_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id")
);
--> statement-breakpoint
CREATE TABLE "maturity_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"maturity_assessment_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"maturity_domain_id" uuid,
	"maturity_domain_weight_id" uuid,
	"score" integer NOT NULL,
	"maturity_level" text,
	"computed_from_control_test_ids" uuid[],
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "maturity_scores_maturity_assessment_id_maturity_domain_id_key" UNIQUE("maturity_assessment_id","maturity_domain_id"),
	CONSTRAINT "maturity_scores_score_range_check" CHECK (score BETWEEN 1 AND 5),
	CONSTRAINT "maturity_scores_weight_requires_domain_check" CHECK (maturity_domain_weight_id IS NULL OR maturity_domain_id IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "maturity_scoring_methodologies" ADD CONSTRAINT "maturity_scoring_methodologies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_domains" ADD CONSTRAINT "maturity_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_domain_weights" ADD CONSTRAINT "maturity_domain_weights_engagement_organisation_tenant_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "public"."engagements"("id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_domain_weights" ADD CONSTRAINT "maturity_domain_weights_maturity_domain_tenant_fk" FOREIGN KEY ("maturity_domain_id","tenant_id") REFERENCES "public"."maturity_domains"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_domain_control_mappings" ADD CONSTRAINT "maturity_domain_control_mappings_maturity_domain_tenant_fk" FOREIGN KEY ("maturity_domain_id","tenant_id") REFERENCES "public"."maturity_domains"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_domain_control_mappings" ADD CONSTRAINT "maturity_domain_control_mappings_control_tenant_fk" FOREIGN KEY ("control_id","tenant_id") REFERENCES "public"."controls"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_assessments" ADD CONSTRAINT "maturity_assessments_computed_by_users_id_fk" FOREIGN KEY ("computed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_assessments" ADD CONSTRAINT "maturity_assessments_engagement_organisation_tenant_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "public"."engagements"("id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_assessments" ADD CONSTRAINT "maturity_assessments_assessment_scope_fk" FOREIGN KEY ("assessment_id","engagement_id","organisation_id","tenant_id") REFERENCES "public"."assessments"("id","engagement_id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_assessments" ADD CONSTRAINT "maturity_assessments_maturity_scoring_methodology_tenant_fk" FOREIGN KEY ("maturity_scoring_methodology_id","tenant_id") REFERENCES "public"."maturity_scoring_methodologies"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_scores" ADD CONSTRAINT "maturity_scores_maturity_assessment_scope_fk" FOREIGN KEY ("maturity_assessment_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."maturity_assessments"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_scores" ADD CONSTRAINT "maturity_scores_maturity_domain_tenant_fk" FOREIGN KEY ("maturity_domain_id","tenant_id") REFERENCES "public"."maturity_domains"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_scores" ADD CONSTRAINT "maturity_scores_maturity_domain_weight_scope_fk" FOREIGN KEY ("maturity_domain_weight_id","engagement_id") REFERENCES "public"."maturity_domain_weights"("id","engagement_id") ON DELETE no action ON UPDATE no action;