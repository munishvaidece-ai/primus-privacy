-- PRIMUS PRIVACY — Migration 0053: consultation requests ("Connect with us").
--
-- A client person who wants a deeper DPDP review fills in a short form and
-- asks for a 30 minute consultation with the Primus experts. The row keeps
-- exactly what they typed, the notice they were shown and the consent text they
-- agreed to (with the time), so Primus can show later what the person was told
-- and what they agreed to. Primus staff on the engagement read and work the
-- requests; the person who sent it can read their own. A request is never
-- edited by the client after sending.

CREATE TABLE "consultation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"organisation_name" text NOT NULL,
	"sector_key" text,
	"employee_band" text,
	"website" text,
	"contact_name" text NOT NULL,
	"contact_designation" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_mobile" text NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_time" text,
	"note" text,
	"submitter_is_contact" boolean NOT NULL,
	"notice_version" text NOT NULL,
	"consent_text" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"internal_note" text,
	"email_status" text DEFAULT 'pending' NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultation_requests_status_check" CHECK (status IN ('new','contacted','scheduled','done','closed')),
	CONSTRAINT "consultation_requests_email_status_check" CHECK (email_status IN ('pending','sent','not_configured','failed')),
	CONSTRAINT "consultation_requests_mobile_check" CHECK (contact_mobile ~ '^\+?[0-9][0-9 ()-]{6,18}[0-9]$'),
	CONSTRAINT "consultation_requests_email_check" CHECK (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
	CONSTRAINT "consultation_requests_len_check" CHECK (char_length(organisation_name) BETWEEN 1 AND 200 AND char_length(contact_name) BETWEEN 1 AND 120 AND char_length(contact_designation) BETWEEN 1 AND 120 AND char_length(contact_email) <= 254 AND (note IS NULL OR char_length(note) <= 600)),
	CONSTRAINT "consultation_requests_consent_check" CHECK (char_length(consent_text) > 40 AND char_length(notice_version) > 0),
	CONSTRAINT "consultation_requests_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE INDEX "consultation_requests_engagement_idx" ON "consultation_requests" ("engagement_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX "consultation_requests_status_idx" ON "consultation_requests" ("status","created_at" DESC);
--> statement-breakpoint

-- What a person may change after sending: nothing. What Primus may change:
-- who handled it, the status, an internal note, and the email delivery result.
CREATE OR REPLACE FUNCTION public.guard_consultation_request_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.organisation_name IS DISTINCT FROM OLD.organisation_name
     OR NEW.sector_key IS DISTINCT FROM OLD.sector_key
     OR NEW.employee_band IS DISTINCT FROM OLD.employee_band
     OR NEW.website IS DISTINCT FROM OLD.website
     OR NEW.contact_name IS DISTINCT FROM OLD.contact_name
     OR NEW.contact_designation IS DISTINCT FROM OLD.contact_designation
     OR NEW.contact_email IS DISTINCT FROM OLD.contact_email
     OR NEW.contact_mobile IS DISTINCT FROM OLD.contact_mobile
     OR NEW.topics IS DISTINCT FROM OLD.topics
     OR NEW.preferred_time IS DISTINCT FROM OLD.preferred_time
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.submitter_is_contact IS DISTINCT FROM OLD.submitter_is_contact
     OR NEW.notice_version IS DISTINCT FROM OLD.notice_version
     OR NEW.consent_text IS DISTINCT FROM OLD.consent_text
     OR NEW.consented_at IS DISTINCT FROM OLD.consented_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a consultation request cannot be changed after it was sent' USING ERRCODE = '23514';
  END IF;
  -- The person who sent it may only record whether the email reached Primus.
  IF auth.uid() IS NOT NULL AND NOT public.is_practice_user()
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.handled_by IS DISTINCT FROM OLD.handled_by
          OR NEW.handled_at IS DISTINCT FROM OLD.handled_at
          OR NEW.internal_note IS DISTINCT FROM OLD.internal_note) THEN
    RAISE EXCEPTION 'only the Primus team can work a consultation request' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consultation_requests_guard BEFORE UPDATE ON "consultation_requests" FOR EACH ROW EXECUTE FUNCTION public.guard_consultation_request_update();
--> statement-breakpoint

ALTER TABLE "consultation_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "consultation_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Primus staff on the engagement see every request; a client person sees only their own.
CREATE POLICY consultation_requests_select ON "consultation_requests" FOR SELECT TO authenticated
  USING (
    public.can_access_engagement(engagement_id, organisation_id)
    AND (public.is_practice_user() OR submitted_by = auth.uid())
  );
--> statement-breakpoint
-- Anyone who can open the engagement may send a request in their own name.
CREATE POLICY consultation_requests_insert ON "consultation_requests" FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_engagement(engagement_id, organisation_id)
    AND submitted_by = auth.uid()
    AND status = 'new'
  );
--> statement-breakpoint
-- Primus staff work a request (status, note); the sender may only record the email result (the trigger above enforces that).
CREATE POLICY consultation_requests_update ON "consultation_requests" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id) AND (public.is_practice_user() OR submitted_by = auth.uid()))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id) AND (public.is_practice_user() OR submitted_by = auth.uid()));
--> statement-breakpoint
-- Primus staff may erase a request when the purpose has ended or the person asks.
CREATE POLICY consultation_requests_delete ON "consultation_requests" FOR DELETE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id) AND public.is_practice_user());
--> statement-breakpoint

REVOKE ALL ON "consultation_requests" FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "consultation_requests" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "consultation_requests" TO service_role;
