-- PRIMUS PRIVACY — Migration 0034: Invitation schema and lifecycle
-- (P2B.1 — Invitation Schema & Lifecycle).
--
-- Generated via `drizzle-kit generate` from `db/schema/invitations.ts`
-- (and the new `invitationStatusEnum` in `db/schema/enums.ts`), no
-- hand-cleaning required — the generated diff touches only the new
-- `invitations` table and its own enum.
--
-- Schema/lifecycle only, per the approved design (docs/P2B_CLIENT_
-- INVITATION_DESIGN.md, docs/P2B.0.1_SECURITY_CLARIFICATIONS.md, the
-- P2B.0 decision review) — no domain function, Server Action, token
-- generation, or SECURITY DEFINER acceptance function exists yet. RLS
-- enablement, the reparenting/terminal-status guard trigger, and the
-- audit-trigger attachment are hand-written in the paired migration
-- 0035 (this table cannot yet be reached at all by the `authenticated`
-- role — see that migration's own header for why that is the correct,
-- smallest-risk state for this slice, not an oversight).
--
-- tenant_id/organisation_id/engagement_id integrity is enforced
-- structurally via the two composite FKs below (`invitations_
-- organisation_tenant_fk`, `invitations_engagement_organisation_
-- tenant_fk`) — the same `(id, organisation_id, tenant_id)` pattern
-- every other engagement-scoped table in this schema already uses —
-- rather than relying on application validation alone. `invited_email`
-- is guaranteed already-lowercased by its own CHECK constraint, so the
-- two partial unique indexes below (one per invitation shape —
-- organisation-scoped vs. engagement-scoped, since a plain composite
-- UNIQUE cannot correctly enforce "at most one pending invitation" when
-- `engagement_id` is NULL — NULL is never equal to NULL in a unique
-- index) correctly treat email case variations as the same target
-- without needing a `lower()` wrapper in the index expression itself.
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid,
	"invited_email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "invitations_invited_email_normalized_check" CHECK ("invitations"."invited_email" = lower("invitations"."invited_email")),
	CONSTRAINT "invitations_status_consistency_check" CHECK ((status = 'pending' AND accepted_at IS NULL AND accepted_user_id IS NULL AND revoked_at IS NULL)
       OR (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_user_id IS NOT NULL AND revoked_at IS NULL)
       OR (status = 'revoked' AND revoked_at IS NOT NULL AND accepted_at IS NULL AND accepted_user_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organisation_tenant_fk" FOREIGN KEY ("organisation_id","tenant_id") REFERENCES "public"."organisations"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_engagement_organisation_tenant_fk" FOREIGN KEY ("engagement_id","organisation_id","tenant_id") REFERENCES "public"."engagements"("id","organisation_id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_tenant_fk" FOREIGN KEY ("invited_by","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_tenant_fk" FOREIGN KEY ("accepted_user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_organisation_scoped_key" ON "invitations" USING btree ("organisation_id","invited_email") WHERE "invitations"."status" = 'pending' AND "invitations"."engagement_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_engagement_scoped_key" ON "invitations" USING btree ("organisation_id","engagement_id","invited_email") WHERE "invitations"."status" = 'pending' AND "invitations"."engagement_id" IS NOT NULL;