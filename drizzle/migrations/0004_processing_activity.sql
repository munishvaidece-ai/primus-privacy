CREATE TYPE "public"."processing_activity_lifecycle_status" AS ENUM('draft', 'active', 'under_review', 'retired');--> statement-breakpoint
CREATE TYPE "public"."processing_activity_processor_role" AS ENUM('processor', 'joint_controller');--> statement-breakpoint
CREATE TABLE "processing_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"business_unit_id" uuid,
	"owner_user_id" uuid,
	"lifecycle_status" "processing_activity_lifecycle_status" DEFAULT 'draft' NOT NULL,
	"lawful_basis" text,
	"carried_forward_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "processing_activities_id_engagement_id_organisation_id_key" UNIQUE("id","engagement_id","organisation_id"),
	CONSTRAINT "processing_activities_id_organisation_id_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "processing_activity_data_principal_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"processing_activity_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"data_principal_category_id" uuid NOT NULL,
	"data_principal_category_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "pa_data_principal_categories_pa_category_key" UNIQUE("processing_activity_id","data_principal_category_id")
);
--> statement-breakpoint
CREATE TABLE "processing_activity_data_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"processing_activity_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"data_store_id" uuid NOT NULL,
	"data_store_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "pa_data_stores_pa_store_key" UNIQUE("processing_activity_id","data_store_id")
);
--> statement-breakpoint
CREATE TABLE "processing_activity_personal_data_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"processing_activity_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"personal_data_element_id" uuid NOT NULL,
	"personal_data_element_version_id" uuid NOT NULL,
	"sensitivity_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "pa_personal_data_elements_pa_element_key" UNIQUE("processing_activity_id","personal_data_element_id")
);
--> statement-breakpoint
CREATE TABLE "processing_activity_processors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"processing_activity_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"processor_id" uuid NOT NULL,
	"processor_version_id" uuid NOT NULL,
	"role" "processing_activity_processor_role" DEFAULT 'processor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "pa_processors_pa_processor_key" UNIQUE("processing_activity_id","processor_id")
);
--> statement-breakpoint
CREATE TABLE "processing_activity_purposes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"processing_activity_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"purpose_id" uuid NOT NULL,
	"purpose_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "pa_purposes_pa_purpose_key" UNIQUE("processing_activity_id","purpose_id")
);
--> statement-breakpoint
CREATE TABLE "processing_activity_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"processing_activity_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"system_id" uuid NOT NULL,
	"system_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "pa_systems_pa_system_key" UNIQUE("processing_activity_id","system_id")
);
--> statement-breakpoint
-- Reordered from drizzle-kit's original output: these new UNIQUE
-- constraints on already-existing tables (Milestones 1-2) must exist
-- BEFORE any of the composite FKs below that reference them — drizzle-kit
-- emitted them at the end of the file, which fails ("no unique
-- constraint matching given keys") since Postgres applies ALTER TABLE
-- statements in file order. Purely a statement-ordering fix; nothing
-- about what's created changed from what drizzle-kit generated.
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_id_organisation_id_tenant_id_key" UNIQUE("id","organisation_id","tenant_id");--> statement-breakpoint
ALTER TABLE "data_principal_category_versions" ADD CONSTRAINT "data_principal_category_versions_id_category_org_key" UNIQUE("id","data_principal_category_id","organisation_id");--> statement-breakpoint
ALTER TABLE "personal_data_element_versions" ADD CONSTRAINT "personal_data_element_versions_id_element_org_key" UNIQUE("id","personal_data_element_id","organisation_id");--> statement-breakpoint
ALTER TABLE "purpose_versions" ADD CONSTRAINT "purpose_versions_id_purpose_id_organisation_id_key" UNIQUE("id","purpose_id","organisation_id");--> statement-breakpoint
ALTER TABLE "system_versions" ADD CONSTRAINT "system_versions_id_system_id_organisation_id_key" UNIQUE("id","system_id","organisation_id");--> statement-breakpoint
ALTER TABLE "data_store_versions" ADD CONSTRAINT "data_store_versions_id_data_store_id_organisation_id_key" UNIQUE("id","data_store_id","organisation_id");--> statement-breakpoint
ALTER TABLE "processor_versions" ADD CONSTRAINT "processor_versions_id_processor_id_organisation_id_key" UNIQUE("id","processor_id","organisation_id");--> statement-breakpoint
ALTER TABLE "processing_activities" ADD CONSTRAINT "processing_activities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activities" ADD CONSTRAINT "processing_activities_engagement_organisation_tenant_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "public"."engagements"("id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activities" ADD CONSTRAINT "processing_activities_business_unit_organisation_fk" FOREIGN KEY ("business_unit_id","organisation_id") REFERENCES "public"."business_units"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activities" ADD CONSTRAINT "processing_activities_carried_forward_from_fk" FOREIGN KEY ("carried_forward_from_id","organisation_id") REFERENCES "public"."processing_activities"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_data_principal_categories" ADD CONSTRAINT "pa_data_principal_categories_pa_fk" FOREIGN KEY ("processing_activity_id","engagement_id","organisation_id") REFERENCES "public"."processing_activities"("id","engagement_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_data_principal_categories" ADD CONSTRAINT "pa_data_principal_categories_version_fk" FOREIGN KEY ("data_principal_category_version_id","data_principal_category_id","organisation_id") REFERENCES "public"."data_principal_category_versions"("id","data_principal_category_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_data_stores" ADD CONSTRAINT "pa_data_stores_pa_fk" FOREIGN KEY ("processing_activity_id","engagement_id","organisation_id") REFERENCES "public"."processing_activities"("id","engagement_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_data_stores" ADD CONSTRAINT "pa_data_stores_version_fk" FOREIGN KEY ("data_store_version_id","data_store_id","organisation_id") REFERENCES "public"."data_store_versions"("id","data_store_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_personal_data_elements" ADD CONSTRAINT "pa_personal_data_elements_pa_fk" FOREIGN KEY ("processing_activity_id","engagement_id","organisation_id") REFERENCES "public"."processing_activities"("id","engagement_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_personal_data_elements" ADD CONSTRAINT "pa_personal_data_elements_version_fk" FOREIGN KEY ("personal_data_element_version_id","personal_data_element_id","organisation_id") REFERENCES "public"."personal_data_element_versions"("id","personal_data_element_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_processors" ADD CONSTRAINT "pa_processors_pa_fk" FOREIGN KEY ("processing_activity_id","engagement_id","organisation_id") REFERENCES "public"."processing_activities"("id","engagement_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_processors" ADD CONSTRAINT "pa_processors_version_fk" FOREIGN KEY ("processor_version_id","processor_id","organisation_id") REFERENCES "public"."processor_versions"("id","processor_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_purposes" ADD CONSTRAINT "pa_purposes_pa_fk" FOREIGN KEY ("processing_activity_id","engagement_id","organisation_id") REFERENCES "public"."processing_activities"("id","engagement_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_purposes" ADD CONSTRAINT "pa_purposes_version_fk" FOREIGN KEY ("purpose_version_id","purpose_id","organisation_id") REFERENCES "public"."purpose_versions"("id","purpose_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_systems" ADD CONSTRAINT "pa_systems_pa_fk" FOREIGN KEY ("processing_activity_id","engagement_id","organisation_id") REFERENCES "public"."processing_activities"("id","engagement_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity_systems" ADD CONSTRAINT "pa_systems_version_fk" FOREIGN KEY ("system_version_id","system_id","organisation_id") REFERENCES "public"."system_versions"("id","system_id","organisation_id") ON DELETE no action ON UPDATE no action;