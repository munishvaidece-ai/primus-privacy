CREATE TYPE "public"."document_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('policy', 'contract', 'screenshot', 'certificate', 'report', 'system_configuration', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_version_scan_status" AS ENUM('pending', 'clean', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."evidence_link_subject_type" AS ENUM('assessment_response', 'control_test');--> statement-breakpoint
CREATE TYPE "public"."evidence_quality_rating" AS ENUM('strong', 'adequate', 'weak');--> statement-breakpoint
CREATE TYPE "public"."evidence_review_status" AS ENUM('pending_review', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('policy_document', 'screenshot', 'system_configuration_export', 'signed_agreement', 'certificate', 'other');--> statement-breakpoint
CREATE TYPE "public"."evidence_visibility" AS ENUM('client_visible', 'consultant_internal');--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid,
	"version_number" integer NOT NULL,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"scan_status" "document_version_scan_status" DEFAULT 'pending' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "document_versions_document_id_version_number_key" UNIQUE("document_id","version_number"),
	CONSTRAINT "document_versions_id_tenant_id_organisation_id_key" UNIQUE("id","tenant_id","organisation_id"),
	CONSTRAINT "document_versions_id_engagement_id_key" UNIQUE("id","engagement_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid,
	"title" text NOT NULL,
	"document_type" "document_type" NOT NULL,
	"owner_user_id" uuid,
	"status" "document_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "documents_id_tenant_id_organisation_id_key" UNIQUE("id","tenant_id","organisation_id"),
	CONSTRAINT "documents_id_engagement_id_key" UNIQUE("id","engagement_id")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid,
	"document_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"evidence_type" "evidence_type" NOT NULL,
	"quality_rating" "evidence_quality_rating",
	"visibility" "evidence_visibility" DEFAULT 'consultant_internal' NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_status" "evidence_review_status" DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_rationale" text,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "evidence_id_tenant_id_organisation_id_key" UNIQUE("id","tenant_id","organisation_id"),
	CONSTRAINT "evidence_id_engagement_id_key" UNIQUE("id","engagement_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid,
	"subject_type" "evidence_link_subject_type" NOT NULL,
	"assessment_response_id" uuid,
	"control_test_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "evidence_links_evidence_id_assessment_response_id_key" UNIQUE("evidence_id","assessment_response_id"),
	CONSTRAINT "evidence_links_evidence_id_control_test_id_key" UNIQUE("evidence_id","control_test_id"),
	CONSTRAINT "evidence_links_subject_matches_type_check" CHECK ((subject_type = 'assessment_response' AND assessment_response_id IS NOT NULL AND control_test_id IS NULL)
          OR (subject_type = 'control_test' AND control_test_id IS NOT NULL AND assessment_response_id IS NULL)),
	CONSTRAINT "evidence_links_assessment_response_requires_engagement_check" CHECK (subject_type <> 'assessment_response' OR engagement_id IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "assessment_responses" ADD CONSTRAINT "assessment_responses_id_scope_key" UNIQUE("id","tenant_id","organisation_id","engagement_id");--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_id_tenant_id_key" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_id_organisation_id_key" UNIQUE("id","organisation_id");--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_id_engagement_id_key" UNIQUE("id","engagement_id");--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_tenant_organisation_fk" FOREIGN KEY ("document_id","tenant_id","organisation_id") REFERENCES "public"."documents"("id","tenant_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_engagement_fk" FOREIGN KEY ("document_id","engagement_id") REFERENCES "public"."documents"("id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_document_version_organisation_fk" FOREIGN KEY ("document_version_id","tenant_id","organisation_id") REFERENCES "public"."document_versions"("id","tenant_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_document_version_engagement_fk" FOREIGN KEY ("document_version_id","engagement_id") REFERENCES "public"."document_versions"("id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_evidence_scope_fk" FOREIGN KEY ("evidence_id","tenant_id","organisation_id") REFERENCES "public"."evidence"("id","tenant_id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_evidence_engagement_fk" FOREIGN KEY ("evidence_id","engagement_id") REFERENCES "public"."evidence"("id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_assessment_response_scope_fk" FOREIGN KEY ("assessment_response_id","tenant_id","organisation_id","engagement_id") REFERENCES "public"."assessment_responses"("id","tenant_id","organisation_id","engagement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_control_test_tenant_fk" FOREIGN KEY ("control_test_id","tenant_id") REFERENCES "public"."control_tests"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_control_test_organisation_fk" FOREIGN KEY ("control_test_id","organisation_id") REFERENCES "public"."control_tests"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_control_test_engagement_fk" FOREIGN KEY ("control_test_id","engagement_id") REFERENCES "public"."control_tests"("id","engagement_id") ON DELETE no action ON UPDATE no action;