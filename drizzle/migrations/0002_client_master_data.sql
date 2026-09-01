CREATE TYPE "public"."data_sensitivity" AS ENUM('general', 'sensitive', 'critical');--> statement-breakpoint
CREATE TYPE "public"."master_data_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TABLE "business_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_business_unit_id" uuid,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "business_units_id_organisation_id_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "data_principal_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "data_principal_categories_id_organisation_id_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "data_principal_category_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_principal_category_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_children_flag" boolean DEFAULT false NOT NULL,
	"description" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "personal_data_element_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"personal_data_element_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sensitivity_category" "data_sensitivity" DEFAULT 'general' NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "personal_data_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "personal_data_elements_id_organisation_id_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "purpose_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "purposes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "purposes_id_organisation_id_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "system_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"owner" text,
	"hosting_environment" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "system_versions_id_organisation_id_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "systems_id_organisation_id_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "data_store_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_store_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"storage_type" text,
	"location" text,
	"system_version_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "data_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "data_stores_id_organisation_id_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "processor_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"processor_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dpa_version_label" text,
	"risk_tier" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "processors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"parent_processor_id" uuid,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "processors_id_organisation_id_key" UNIQUE("id","organisation_id")
);
--> statement-breakpoint
ALTER TABLE "business_units" ADD CONSTRAINT "business_units_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_principal_categories" ADD CONSTRAINT "data_principal_categories_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_principal_category_versions" ADD CONSTRAINT "data_principal_category_versions_identity_fk" FOREIGN KEY ("data_principal_category_id","organisation_id") REFERENCES "public"."data_principal_categories"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_data_element_versions" ADD CONSTRAINT "personal_data_element_versions_identity_fk" FOREIGN KEY ("personal_data_element_id","organisation_id") REFERENCES "public"."personal_data_elements"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_data_elements" ADD CONSTRAINT "personal_data_elements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purpose_versions" ADD CONSTRAINT "purpose_versions_identity_fk" FOREIGN KEY ("purpose_id","organisation_id") REFERENCES "public"."purposes"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purposes" ADD CONSTRAINT "purposes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_versions" ADD CONSTRAINT "system_versions_identity_fk" FOREIGN KEY ("system_id","organisation_id") REFERENCES "public"."systems"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "systems" ADD CONSTRAINT "systems_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_store_versions" ADD CONSTRAINT "data_store_versions_identity_fk" FOREIGN KEY ("data_store_id","organisation_id") REFERENCES "public"."data_stores"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_store_versions" ADD CONSTRAINT "data_store_versions_system_version_organisation_fk" FOREIGN KEY ("system_version_id","organisation_id") REFERENCES "public"."system_versions"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_stores" ADD CONSTRAINT "data_stores_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processor_versions" ADD CONSTRAINT "processor_versions_identity_fk" FOREIGN KEY ("processor_id","organisation_id") REFERENCES "public"."processors"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processors" ADD CONSTRAINT "processors_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processors" ADD CONSTRAINT "processors_parent_processor_organisation_fk" FOREIGN KEY ("parent_processor_id","organisation_id") REFERENCES "public"."processors"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_principal_category_versions_one_current_key" ON "data_principal_category_versions" USING btree ("data_principal_category_id") WHERE "data_principal_category_versions"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_data_element_versions_one_current_key" ON "personal_data_element_versions" USING btree ("personal_data_element_id") WHERE "personal_data_element_versions"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "purpose_versions_one_current_key" ON "purpose_versions" USING btree ("purpose_id") WHERE "purpose_versions"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "system_versions_one_current_key" ON "system_versions" USING btree ("system_id") WHERE "system_versions"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "data_store_versions_one_current_key" ON "data_store_versions" USING btree ("data_store_id") WHERE "data_store_versions"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "processor_versions_one_current_key" ON "processor_versions" USING btree ("processor_id") WHERE "processor_versions"."is_current" = true;