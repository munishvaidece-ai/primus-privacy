-- PRIMUS PRIVACY — Migration 0039: invitation preview
-- (P2B.5 — Client Onboarding & Acceptance UX).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- prior security/hardening migration (DECISIONS.md R-02). Assumes
-- migrations 0000-0038 are already applied. Purely additive: one new,
-- read-only function plus its GRANT/REVOKE. Does not edit migrations
-- 0033-0038.
--
-- =============================================================================
-- Why this function is needed
-- =============================================================================
-- P2B.5's confirmation screen (brief §2) must show an authenticated
-- invitee safe invitation metadata — organisation name, engagement name,
-- invited role, invited email — BEFORE they choose to accept, so they
-- can make an informed "Accept" / "Cancel" decision. Migration 0037's
-- own `invitations_select` RLS policy restricts SELECT to
-- `membership.manage` actors ONLY (P2B.2, DECISIONS.md) — deliberately,
-- since an ordinary invitation lists an email address and a role about
-- to be granted real access, and browsing invitations is not an
-- ordinary member's business. The invitee themselves holds NO
-- membership at all yet (that is the entire point of the invitation),
-- so an ordinary RLS-scoped SELECT returns zero rows for them — there
-- is no existing read path this screen could use instead.
--
-- This is the exact same "resolve something RLS would otherwise hide,
-- for a narrow, legitimate purpose" shape migration 0024's own
-- `eligible_engagement_members`/`resolve_membership_candidate` already
-- established (SECURITY DEFINER, STABLE, read-only, returns only the
-- specific fields the calling screen needs) — not a new authorization
-- model, an application of the existing one. `invitations_select`
-- itself is NOT widened or relaxed by this migration; it remains
-- exactly what P2B.2 established.
--
-- =============================================================================
-- Why this does NOT duplicate acceptance logic
-- =============================================================================
-- This function performs NO validation beyond "does a row with this
-- token_hash exist" and NO mutation of any kind — no row lock, no
-- status/expiry/email/tenant/role check, no write. Every one of those
-- checks remains exclusively `accept_invitation()`'s own responsibility
-- (migration 0038) — this function exists only so the confirmation
-- screen can render safe, human-readable context, and so the SAME
-- screen can distinguish "expired"/"revoked"/"already accepted"/"not
-- found" (brief §3) by reading `out_status`/`out_expires_at` itself,
-- without ever attempting or simulating acceptance. The presented raw
-- token is hashed by the SAME `hashInvitationToken()` (P2B.3) the real
-- acceptance path uses, then passed here already hashed — this
-- function, like `accept_invitation()`, never receives or handles the
-- raw token itself.
--
-- Returns NO internal identifiers at all — no `id`, `tenant_id`,
-- `organisation_id`, `engagement_id`, `role_id`, and certainly no
-- `token_hash` — only the five human-readable/status fields the
-- confirmation screen actually renders. `token_hash` is used solely as
-- the WHERE-clause lookup key; it is never included in the SELECT list
-- itself, so there is no risk of a future refactor accidentally
-- returning it.

CREATE OR REPLACE FUNCTION public.preview_invitation(p_token_hash text)
RETURNS TABLE(
  out_invited_email text,
  out_organisation_name text,
  out_engagement_name text,
  out_role_name text,
  out_status invitation_status,
  out_expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT i.invited_email, o.name, e.name, r.name, i.status, i.expires_at
  FROM invitations i
  JOIN organisations o ON o.id = i.organisation_id
  LEFT JOIN engagements e ON e.id = i.engagement_id
  JOIN roles r ON r.id = i.role_id
  WHERE i.token_hash = p_token_hash;
$$;

-- EXECUTE privileges — authenticated only, never anon. Mirrors
-- migration 0038's own `accept_invitation()` grant shape exactly: the
-- confirmation screen is reached only AFTER the "Authentication" step
-- in the approved flow (brief's own diagram — unauthenticated visitors
-- see a generic, static "you have been invited" message with no
-- database lookup at all), so there is no legitimate anonymous caller
-- of this function either.
REVOKE EXECUTE ON FUNCTION public.preview_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_invitation(text) TO authenticated, service_role;
