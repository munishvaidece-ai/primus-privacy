-- PRIMUS PRIVACY — Migration 0051: intake files for the guided engagement run.
--
-- Every file a person uploads on the Live Run screen (a filled template, a
-- supporting document, an evidence or proof file) gets a row here: who sent
-- it, when, what the template check said, and what was read from it. The bytes
-- live in object storage like evidence files. A row is never deleted, and
-- what was read from a template is frozen once set, so the AI's evidence trail
-- stays true.

CREATE TABLE "intake_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"phase" smallint NOT NULL,
	"role" text NOT NULL,
	"template_key" text,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parsed" jsonb,
	"uploaded_by" uuid NOT NULL,
	"uploaded_by_name" text DEFAULT '' NOT NULL,
	"uploaded_by_side" text DEFAULT 'primus' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_job_id" uuid,
	CONSTRAINT "intake_files_phase_check" CHECK (phase BETWEEN 1 AND 7),
	CONSTRAINT "intake_files_role_check" CHECK (role IN ('template','support','evidence_file','proof_file')),
	CONSTRAINT "intake_files_source_check" CHECK (source IN ('upload','connector','share')),
	CONSTRAINT "intake_files_side_check" CHECK (uploaded_by_side IN ('primus','client')),
	CONSTRAINT "intake_files_status_check" CHECK (status IN ('received','accepted','rejected','processed')),
	CONSTRAINT "intake_files_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE INDEX "intake_files_engagement_idx" ON "intake_files" ("engagement_id","phase","uploaded_at" DESC);
--> statement-breakpoint

-- Who may add a file: practice staff on the engagement (not the AI agent) and
-- client people with the contribute permission, the same people who may fill in
-- the discovery questionnaire.
CREATE OR REPLACE FUNCTION public.can_upload_intake(p_engagement_id uuid, p_organisation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.can_access_engagement(p_engagement_id, p_organisation_id)
     AND (
       (public.is_practice_user() AND public.is_active_engagement_member(p_engagement_id)
          AND NOT public.has_engagement_permission(p_engagement_id, 'ai.agent'))
       OR (NOT public.is_practice_user() AND public.has_engagement_or_org_permission(p_engagement_id, p_organisation_id, 'client.contribute'))
     );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.can_upload_intake(uuid, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_upload_intake(uuid, uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_intake_file_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.phase IS DISTINCT FROM OLD.phase
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.template_key IS DISTINCT FROM OLD.template_key
     OR NEW.filename IS DISTINCT FROM OLD.filename
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.validation IS DISTINCT FROM OLD.validation
     OR NEW.parsed IS DISTINCT FROM OLD.parsed
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.uploaded_by_name IS DISTINCT FROM OLD.uploaded_by_name
     OR NEW.uploaded_by_side IS DISTINCT FROM OLD.uploaded_by_side
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION 'an uploaded intake file cannot be changed, only marked as processed (file %)', OLD.id USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'processed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a processed intake file cannot change status (file %)', OLD.id USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'processed' AND OLD.status NOT IN ('accepted','received') THEN
    RAISE EXCEPTION 'only an accepted file can be processed (file %)', OLD.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER intake_files_guard BEFORE UPDATE ON "intake_files" FOR EACH ROW EXECUTE FUNCTION public.guard_intake_file_update();
--> statement-breakpoint

ALTER TABLE "intake_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intake_files" FORCE ROW LEVEL SECURITY;

CREATE POLICY intake_files_select ON "intake_files"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY intake_files_insert ON "intake_files"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_upload_intake(engagement_id, organisation_id) AND uploaded_by = auth.uid());
CREATE POLICY intake_files_update ON "intake_files"
  FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));

CREATE TRIGGER intake_files_audit_log
  AFTER INSERT OR UPDATE ON "intake_files"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

REVOKE ALL ON "intake_files" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON "intake_files" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "intake_files" TO service_role;
