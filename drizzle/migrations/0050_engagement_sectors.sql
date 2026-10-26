-- PRIMUS PRIVACY — Migration 0050: engagement sectors (regulation map).
--
-- Records which sectors an engagement operates in, so the platform can show
-- Part A (DPDP) and Part B (sector rules) and the AI can decide which sector
-- controls apply. The sector list itself lives in code (lib/regulation); this
-- table stores only the choice. Read by anyone with engagement access; changed
-- only by Primus staff.

CREATE TABLE "engagement_sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"sector_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "engagement_sectors_key_check" CHECK (sector_key IN ('broking','banking','insurance','healthcare','telecom','ecommerce','ott','aviation','ai','education','msme','government')),
	CONSTRAINT "engagement_sectors_unique" UNIQUE("engagement_id","sector_key"),
	CONSTRAINT "engagement_sectors_engagement_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "engagements"("id","organisation_id","tenant_id")
);
--> statement-breakpoint
CREATE INDEX "engagement_sectors_engagement_idx" ON "engagement_sectors" ("engagement_id");
--> statement-breakpoint

ALTER TABLE "engagement_sectors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_sectors" FORCE ROW LEVEL SECURITY;

CREATE POLICY engagement_sectors_select ON "engagement_sectors"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY engagement_sectors_insert ON "engagement_sectors"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_engagement(engagement_id, organisation_id)
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.client_org_id IS NULL)
  );
CREATE POLICY engagement_sectors_delete ON "engagement_sectors"
  FOR DELETE TO authenticated
  USING (
    public.can_access_engagement(engagement_id, organisation_id)
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.client_org_id IS NULL)
  );

CREATE TRIGGER engagement_sectors_audit_log
  AFTER INSERT OR DELETE ON "engagement_sectors"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();

REVOKE ALL ON "engagement_sectors" FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON "engagement_sectors" TO authenticated;
GRANT SELECT, INSERT, DELETE ON "engagement_sectors" TO service_role;
