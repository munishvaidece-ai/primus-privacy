-- PRIMUS PRIVACY — Migration 0036: invitation audit hardening
-- (P2B.1.1 — Invitation Token Audit Hardening).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- prior security/hardening migration (DECISIONS.md R-02): a trigger
-- function swap isn't modeled in the Drizzle TS schema. Assumes
-- migrations 0000-0035 are already applied.
--
-- Narrowly scoped: this migration touches ONLY `invitations`' own
-- audit-trigger attachment. It does not alter the invitations table
-- itself, its lifecycle, its pending-uniqueness constraints, or its
-- tenant/organisation/engagement foreign keys (all migration 0034/
-- 0035, unchanged) — and it does not touch `log_methodology_change()`
-- itself, so every OTHER table already using that shared function
-- (documents, document_versions, evidence, regulatory_references,
-- requirements, control_library_versions, controls, assessments,
-- engagements, and more) is completely unaffected.
--
-- P2B.1 (migration 0035) attached the existing, fully generic
-- `log_methodology_change()` to `invitations` — technically reusable
-- (it assumes nothing "methodology"-specific; the name is historical,
-- the behavior is table-agnostic, and it is already reused across a
-- dozen unrelated tables), but its `to_jsonb(NEW)`/`to_jsonb(OLD)`
-- full-row capture has no field-exclusion mechanism at all, so it also
-- captured `invitations.token_hash` in every `audit_log.field_changes`
-- entry. Reconsidered as a credential-handling issue (not a reversal
-- of DECISIONS.md R-158's own reasoning that a SHA-256 digest is not
-- reversible — it isn't, and `document_versions.checksum_sha256` being
-- captured the same open way remains correct and unchanged): unlike an
-- ordinary content-integrity checksum, `token_hash` is the verifier for
-- a bearer invitation credential, and `audit_log` is readable by any
-- tenant-wide member (`audit_log_select`'s own `can_access_tenant`
-- policy, migration 0001) for the life of the practice — storing the
-- verifier there widens its exposure surface for no audit benefit the
-- other, non-sensitive columns don't already provide on their own. See
-- DECISIONS.md R-159 (supersedes R-158's audit-treatment conclusion
-- specifically; R-158's `log_methodology_change()`-reuse-is-generically-
-- appropriate conclusion still stands).
--
-- Fix: a new, invitation-specific trigger function — not a change to
-- the shared one, and not a removal of invitation auditing — that
-- strips exactly the one sensitive key before it ever reaches
-- `audit_log`, using Postgres's own `jsonb - text` key-removal
-- operator. This is enforced at the database/trigger boundary itself:
-- no future call site, application bug, or direct-SQL write can cause
-- `token_hash` to reach `audit_log` through this path, regardless of
-- what any application code does or fails to do.
CREATE OR REPLACE FUNCTION public.log_invitation_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO audit_log (tenant_id, actor_user_id, entity_type, entity_id, action, field_changes)
  VALUES (
    NEW.tenant_id,
    auth.uid(),
    TG_TABLE_NAME,
    NEW.id,
    lower(TG_OP)::audit_action,
    CASE WHEN TG_OP = 'UPDATE'
      THEN jsonb_build_object('old', to_jsonb(OLD) - 'token_hash', 'new', to_jsonb(NEW) - 'token_hash')
      ELSE to_jsonb(NEW) - 'token_hash'
    END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invitations_audit_log ON "invitations";
CREATE TRIGGER invitations_audit_log
  AFTER INSERT OR UPDATE ON "invitations"
  FOR EACH ROW EXECUTE FUNCTION public.log_invitation_change();

-- Every other column — id, tenant_id, organisation_id, engagement_id,
-- invited_email, role_id, status, expires_at, invited_by, accepted_
-- user_id, accepted_at, revoked_at, created_at — remains fully captured
-- exactly as before: invitation-created, status-changed, accepted, and
-- revoked events are all still reconstructable from `audit_log` alone.
-- Only the credential verifier itself is withheld.
