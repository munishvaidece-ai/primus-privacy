CREATE TYPE "public"."control_library_version_status" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."control_type" AS ENUM('preventive', 'detective', 'corrective');--> statement-breakpoint
CREATE TYPE "public"."regulatory_content_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TABLE "regulatory_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"framework_name" text NOT NULL,
	"citation" text NOT NULL,
	"title" text NOT NULL,
	"version" text,
	"status" "regulatory_content_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "regulatory_references_id_tenant_id_key" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"primary_regulatory_reference_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "regulatory_content_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "requirements_id_tenant_id_key" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "control_library_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"status" "control_library_version_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "control_library_versions_id_tenant_id_key" UNIQUE("id","tenant_id"),
	CONSTRAINT "control_library_versions_tenant_id_version_label_key" UNIQUE("tenant_id","version_label")
);
--> statement-breakpoint
CREATE TABLE "controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"control_library_version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"control_type" "control_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "controls_id_tenant_id_key" UNIQUE("id","tenant_id"),
	CONSTRAINT "controls_control_library_version_id_code_key" UNIQUE("control_library_version_id","code")
);
--> statement-breakpoint
CREATE TABLE "control_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "control_requirements_control_id_requirement_id_key" UNIQUE("control_id","requirement_id")
);
--> statement-breakpoint
CREATE TABLE "requirement_regulatory_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"regulatory_reference_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "requirement_regulatory_references_requirement_id_regulatory_reference_id_key" UNIQUE("requirement_id","regulatory_reference_id")
);
--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN "control_library_version_id" uuid;--> statement-breakpoint
ALTER TABLE "regulatory_references" ADD CONSTRAINT "regulatory_references_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_primary_regulatory_reference_tenant_fk" FOREIGN KEY ("primary_regulatory_reference_id","tenant_id") REFERENCES "public"."regulatory_references"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_library_versions" ADD CONSTRAINT "control_library_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_control_library_version_tenant_fk" FOREIGN KEY ("control_library_version_id","tenant_id") REFERENCES "public"."control_library_versions"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_requirements" ADD CONSTRAINT "control_requirements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_requirements" ADD CONSTRAINT "control_requirements_control_tenant_fk" FOREIGN KEY ("control_id","tenant_id") REFERENCES "public"."controls"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_requirements" ADD CONSTRAINT "control_requirements_requirement_tenant_fk" FOREIGN KEY ("requirement_id","tenant_id") REFERENCES "public"."requirements"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_regulatory_references" ADD CONSTRAINT "requirement_regulatory_references_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_regulatory_references" ADD CONSTRAINT "requirement_regulatory_references_requirement_tenant_fk" FOREIGN KEY ("requirement_id","tenant_id") REFERENCES "public"."requirements"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_regulatory_references" ADD CONSTRAINT "requirement_regulatory_references_regulatory_reference_tenant_fk" FOREIGN KEY ("regulatory_reference_id","tenant_id") REFERENCES "public"."regulatory_references"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_control_library_version_tenant_fk" FOREIGN KEY ("control_library_version_id","tenant_id") REFERENCES "public"."control_library_versions"("id","tenant_id") ON DELETE no action ON UPDATE no action;