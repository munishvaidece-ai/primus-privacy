-- PRIMUS PRIVACY — Migration 0035: security layer for the Invitation
-- schema (P2B.1 — Invitation Schema & Lifecycle).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- prior security/hardening migration (DECISIONS.md R-02): triggers,
-- RLS enablement, and GRANT/REVOKE statements aren't modeled in the
-- Drizzle TS schema. Assumes migration 0034 is already applied.
--
-- =============================================================================
-- 1. Reparenting + terminal-state guard
-- =============================================================================
-- Mirrors `engagement_memberships_prevent_reparenting`'s (migration
-- 0024) exact shape, extended one step further: `validation_records`'
-- own "a decision, once made, is frozen" posture (Milestone 7) applies
-- here even more strictly, since an Invitation has no analogous
-- "settable once, later" exception field the way validation_records'
-- reassessment-trigger columns are — once `status` leaves 'pending',
-- the ENTIRE row is frozen, full stop. While still `pending`, every
-- identity-defining column (everything except `status`/`accepted_at`/
-- `accepted_user_id`/`revoked_at`, which the eventual acceptance/
-- revoke functions — P2B.3/P2B.4 — will set exactly once, together, as
-- one legitimate transition) remains immutable — a correction is
-- always a NEW invitation, never an edit, matching this codebase's own
-- established "resend = revoke old + create new" design (docs/P2B_
-- CLIENT_INVITATION_DESIGN.md §6), never an in-place mutation of an
-- existing row's own core identity.
CREATE OR REPLACE FUNCTION public.prevent_invitation_tampering()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION
      'invitations rows are immutable once status leaves ''pending'' (invitation %); a correction is a new invitation, never an edit',
      OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.invited_email IS DISTINCT FROM OLD.invited_email
     OR NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'invitations.{id,tenant_id,organisation_id,engagement_id,invited_email,role_id,token_hash,invited_by,expires_at,created_at} are immutable after creation (invitation %); a correction is a new invitation, never an edit',
      OLD.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invitations_prevent_tampering
  BEFORE UPDATE ON "invitations"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_invitation_tampering();

-- =============================================================================
-- 2. Audit — reuses the EXISTING generic mechanism, no new trigger
--    function
-- =============================================================================
-- `log_methodology_change()` (migration 0007) already reads `NEW.
-- tenant_id` directly and works for any table carrying its own plain
-- `tenant_id` column — exactly `invitations`' own shape (unlike
-- `organisation_memberships`/`engagement_memberships`, which needed
-- `log_membership_change()`'s own tenant-resolver logic because those
-- two tables have no `tenant_id` column of their own at all). Captures
-- INSERT (created) and every UPDATE (the one legitimate pending →
-- accepted/revoked transition) automatically — no new application-level
-- audit-insert code needed for either event, the same "no new audit
-- trigger needed" conclusion migration 0024's own comment already
-- reached for an analogous case.
--
-- `token_hash` IS captured by this trigger's own `to_jsonb(NEW)` (the
-- same mechanism already captures `document_versions.checksum_sha256`
-- in every existing audit entry for that table, with no prior concern
-- raised) — a considered decision, not an oversight: a SHA-256 digest
-- is not reversible to the raw token it was derived from, so recording
-- it openly in the audit trail exposes nothing. The raw token itself
-- is never a column on this table at all, so there is nothing for this
-- trigger to ever leak regardless.
CREATE TRIGGER invitations_audit_log
  AFTER INSERT OR UPDATE ON "invitations"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

-- =============================================================================
-- 3. RLS — enabled, deliberately with NO policy and NO grant to
--    `authenticated` yet
-- =============================================================================
-- This is the correct, smallest-risk state for THIS slice, not an
-- oversight: P2B.1 is schema and lifecycle only (per its own brief) —
-- no domain function, Server Action, or SECURITY DEFINER acceptance
-- function exists yet to justify any particular shape of RLS policy.
-- Rather than open an interim, necessarily-too-broad policy now and
-- narrow it later (the exact `engagement_memberships_insert` churn
-- migration 0019 → 0024 already went through once), this migration
-- enables RLS (mandatory — every tenant-scoped table in this schema
-- does, and leaving it off would be the real, glaring inconsistency)
-- and grants `authenticated` nothing at all on this table. With no
-- GRANT, any `authenticated`-role attempt to touch this table fails at
-- the privilege-check level before RLS is even evaluated — the exact
-- same "no GRANT exists for `anon`... fails at the privilege-check
-- level" posture this codebase already documents and tests for other
-- tables (tests/rls/tenant-isolation.test.ts, Test 6b). `service_role`
-- (BYPASSRLS) and the migration/fixture superuser connection are
-- unaffected either way, exactly like every other table. P2B.2 is the
-- slice that adds the real, `membership.manage`-based policies.
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON "invitations" FROM PUBLIC, anon;
-- Deliberately no `GRANT ... TO authenticated` here — see §3 above.
