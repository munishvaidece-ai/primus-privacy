-- PRIMUS PRIVACY — Migration 0038: secure invitation acceptance
-- (P2B.4 — Secure Invitation Acceptance & User Provisioning).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- prior security/hardening migration (DECISIONS.md R-02): a SECURITY
-- DEFINER function isn't modeled in the Drizzle TS schema. Assumes
-- migrations 0000-0037 are already applied. Purely additive: one new
-- function plus its GRANT/REVOKE. Does not edit migrations 0033-0037.
--
-- =============================================================================
-- 1. Why this MUST be a SECURITY DEFINER function, not an ordinary
--    `authenticated`-role transactional domain function
-- =============================================================================
-- Phase 0 inspection (this slice) confirmed, by direct reading of the
-- CURRENT policies, that no ordinary `authenticated`-role write path
-- exists for a brand-new invitee to grant themselves the membership
-- their own invitation names:
--
--   * `organisation_memberships_insert` (migration 0019) requires
--     `is_active_tenant_member(organisation's tenant)` — i.e. the
--     caller must ALREADY be a practice-side tenant member. A fresh
--     client invitee is not, and structurally cannot be (client users
--     never hold TenantMembership — SECURITY.md §3).
--   * `engagement_memberships_insert` (migration 0019, extended by
--     0024) requires tenant-wide/organisation-wide membership OR
--     `has_engagement_permission`/`has_organisation_permission(
--     'membership.manage')` on the target scope — a fresh invitee holds
--     NONE of these; that is precisely the gap an invitation exists to
--     close.
--   * `invitations_update` (migration 0037) permits an ordinary
--     `membership.manage` actor to reach ONLY `status = 'revoked'`
--     (DECISIONS.md R-163) — `pending -> accepted` is structurally
--     unreachable through that policy for ANY `authenticated`-role
--     caller, on purpose. This migration is the slice R-163 named as
--     reserving that transition for.
--
-- This is exactly what migration 0037's own comments already
-- anticipated ("reserved for a future SECURITY DEFINER
-- `accept_invitation()` function... not bound by this
-- `TO authenticated`-scoped policy at all"). `public.accept_invitation`
-- below is that function — narrowly scoped to exactly this one
-- transaction, never a general "run as service role" mechanism.
--
-- =============================================================================
-- 2. Why the authoritative Auth email is read from `auth.users` INSIDE
--    this function, never accepted as a parameter
-- =============================================================================
-- SECURITY.md's own architecture is explicit: "all tenant/role
-- resolution happens server-side against the database, not by trusting
-- claims baked into the JWT beyond identity." This project's local dev
-- auth shim (scripts/local-dev-auth-shim.sql) deliberately implements
-- ONLY `auth.uid()` — no `auth.jwt()`/`auth.email()` — matching that
-- same posture; a real Supabase JWT's own `email` claim is therefore
-- never read anywhere in this codebase, this migration included.
--
-- If this function instead accepted an `p_auth_email` PARAMETER (set by
-- the calling TypeScript layer from `lib/auth/session.ts`'s own
-- `getAuthenticatedUser()`), a caller invoking this function directly —
-- bypassing the TypeScript wrapper entirely, e.g. via a raw SQL client
-- — could pass ANY string as `p_auth_email`, including a victim's own
-- `invited_email`, and accept an invitation meant for someone else
-- regardless of who they are actually authenticated as. This would
-- completely defeat the "the accepting identity's own email must match
-- `invited_email`" control the brief identifies as one of the most
-- important requirements of this slice.
--
-- The fix: this function takes NO email parameter at all. It derives
-- the authoritative email itself, INSIDE its own SECURITY DEFINER
-- context, via `SELECT email FROM auth.users WHERE id = auth.uid()` —
-- `auth.users` is normally unreadable by `authenticated`/`anon` (the
-- local shim's own comment: "readable only by service_role"), but a
-- SECURITY DEFINER function owned by the same superuser that owns
-- every other SECURITY DEFINER function in this codebase
-- (`handle_new_auth_user`, `has_engagement_permission`, etc.) already
-- has implicit access to it, exactly the same trust boundary those
-- functions already rely on — this is not a new privilege being
-- introduced, it is the same one, used once more, narrowly. The ONLY
-- parameter this function accepts at all is `p_token_hash` — there is
-- no `user_id`/`tenant_id`/`organisation_id`/`engagement_id`/`role_id`/
-- `accepted_user_id` parameter of any kind for a caller to forge; every
-- one of those values is derived from `auth.uid()` (the session
-- context) or from the invitation row itself, never trusted from
-- outside.
--
-- =============================================================================
-- 3. Row locking / single-use / concurrency
-- =============================================================================
-- `SELECT ... FROM invitations WHERE token_hash = $1 FOR UPDATE` — the
-- SAME unique index already backing `invitations_token_hash_key`
-- (migration 0034) makes this an indexed lookup, not a table scan; `FOR
-- UPDATE` acquires a row lock for the remainder of the enclosing
-- transaction. A second, concurrent call for the SAME token_hash blocks
-- at this exact statement until the first call's transaction commits or
-- rolls back (standard PostgreSQL MVCC/locking under READ COMMITTED,
-- this codebase's default) — once unblocked, it re-reads the NOW
-- current row (post-commit, if the first call succeeded) and correctly
-- sees `status = 'accepted'`, failing with `invitation_already_accepted`
-- rather than racing it. Tested directly with two genuinely concurrent
-- PostgreSQL connections (tests/app/invitation-acceptance.test.ts,
-- category M) — not simulated, not sequential.
--
-- =============================================================================
-- 4. What this function does NOT do
-- =============================================================================
-- It does not create a `public.users` row. Phase 0 inspection confirmed
-- `authenticated` holds no INSERT grant on `users` at all (migration
-- 0001: `GRANT SELECT, UPDATE ON "users" TO authenticated` only), and
-- the ONLY writer of a new `users` row anywhere in this schema is
-- `handle_new_auth_user` (migration 0001), itself fired by `auth.users`
-- INSERT — which REQUIRES `raw_app_meta_data.tenant_id` to already be
-- present or the whole `auth.users` insert (and therefore the
-- authentication itself) fails. Consequently, under this codebase's
-- CURRENT architecture, an authenticated Supabase identity structurally
-- ALREADY has a corresponding `public.users` row by the time it could
-- ever call this function — "the user does not exist yet" is not a
-- reachable state through the normal provisioning path, and this
-- function does not invent a second, parallel provisioning mechanism to
-- paper over an inconsistency that should not exist (the brief's own
-- "Do NOT bypass the users identity-integrity model"). If no matching
-- `public.users` row is found regardless (an exceptional, not-supposed-
-- to-happen state), this function fails closed with
-- `invitation_user_profile_missing` rather than creating one.
--
-- It never creates an `OrganisationMembership` as a side effect of an
-- ENGAGEMENT-scoped acceptance. Phase 0 inspection confirmed the
-- existing authorization model does not require one:
-- `can_access_organisation`/`canAccessOrganisation` already falls back
-- to "any active membership on an engagement under this organisation"
-- (migration 0001, `lib/authorization/service.ts`), and
-- `addEngagementMember`'s own existing eligibility rule
-- (`lib/domain/engagement-memberships.ts`) already permits a client user
-- whose `client_org_id` merely MATCHES the engagement's own organisation
-- — no `OrganisationMembership` row is required for either. Inventing
-- one here would be exactly the "do not accidentally grant Client
-- Administrator unless explicitly justified" outcome the brief warns
-- against — an engagement-scoped invitation (Business Owner/IT-CISO/
-- Procurement/Legal) never implies organisation-wide administrative
-- standing.

-- Output columns are prefixed `out_` deliberately: PL/pgSQL implicitly
-- declares a variable for every `RETURNS TABLE` column, in scope for
-- the whole function body — `organisation_id`/`engagement_id`/
-- `role_id`/`tenant_id` are also real column names on `invitations`/
-- `organisation_memberships`/`engagement_memberships`, so using those
-- exact names here would shadow every bare reference to those columns
-- throughout this function with a "column reference is ambiguous"
-- error. Every internal query below additionally qualifies its own
-- columns with a table alias regardless, as defense in depth against
-- the same class of ambiguity.
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token_hash text)
RETURNS TABLE(
  out_invitation_id uuid,
  out_organisation_id uuid,
  out_engagement_id uuid,
  out_tenant_id uuid,
  out_role_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_auth_email text;
  v_inv invitations%ROWTYPE;
  v_user users%ROWTYPE;
  v_existing_membership_id uuid;
  v_existing_role_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    -- Defense in depth — EXECUTE is never granted to anon (see §5
    -- below), so this should be unreachable via the intended calling
    -- convention, but the function must not proceed on a NULL identity
    -- regardless of how it was invoked.
    RAISE EXCEPTION 'invitation_unauthenticated: acceptance requires an authenticated identity' USING ERRCODE = '28000';
  END IF;

  -- The authoritative Auth email — read directly from auth.users by
  -- auth.uid(), never accepted as a parameter. See §2 above.
  SELECT email INTO v_auth_email FROM auth.users WHERE id = v_uid;
  IF v_auth_email IS NULL THEN
    RAISE EXCEPTION 'invitation_unauthenticated: no authoritative email is available for this identity' USING ERRCODE = '28000';
  END IF;
  v_auth_email := lower(trim(v_auth_email));

  -- Lock the invitation row for the remainder of this transaction —
  -- see §3 above for the concurrency guarantee this provides.
  SELECT * INTO v_inv FROM invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found: no invitation matches the presented token' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status = 'revoked' THEN
    RAISE EXCEPTION 'invitation_already_revoked: this invitation has been revoked' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'invitation_already_accepted: this invitation has already been accepted' USING ERRCODE = '22023';
  END IF;
  -- status = 'pending' is the only remaining stored value
  -- (invitation_status_enum has exactly three members) — no `expired`
  -- value is ever stored (db/schema/enums.ts); expiry is checked here,
  -- against the CURRENT time, not written anywhere.
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_expired: this invitation has expired' USING ERRCODE = '22023';
  END IF;

  IF v_inv.invited_email <> v_auth_email THEN
    RAISE EXCEPTION 'invitation_email_mismatch: the authenticated identity''s email does not match this invitation' USING ERRCODE = '22023';
  END IF;

  -- Resolve the caller's OWN users row by auth.uid() — never inserted
  -- here (see §4 above).
  SELECT * INTO v_user FROM users WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_user_profile_missing: no user profile exists for this identity' USING ERRCODE = 'P0002';
  END IF;

  IF v_user.client_org_id IS NULL THEN
    RAISE EXCEPTION 'invitation_practice_user: a practice-side user cannot accept a client invitation' USING ERRCODE = '42501';
  END IF;

  IF v_user.tenant_id <> v_inv.tenant_id THEN
    RAISE EXCEPTION 'invitation_tenant_mismatch: this invitation belongs to a different practice' USING ERRCODE = '42501';
  END IF;

  IF v_user.client_org_id <> v_inv.organisation_id THEN
    RAISE EXCEPTION 'invitation_client_org_mismatch: this invitation belongs to a different client organisation' USING ERRCODE = '42501';
  END IF;

  -- Defense-in-depth re-check of the SAME role allowlist
  -- `invitations_insert` (migration 0037) already enforced at creation
  -- time — every row that exists already satisfies this by
  -- construction (role_id is immutable post-creation, migration 0035),
  -- so this branch is not expected to ever actually reject anything;
  -- it exists so this function does not silently trust that invariant
  -- forever, the same "independently implemented, must independently
  -- agree" discipline SECURITY.md §2 applies between every other pair
  -- of layers in this codebase.
  IF v_inv.engagement_id IS NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = v_inv.role_id AND r.name IN ('Client Administrator', 'Privacy Officer', 'CXO / Executive Viewer')
    ) THEN
      RAISE EXCEPTION 'invitation_role_invalid_for_scope: this invitation''s role is not valid for its own scope' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = v_inv.role_id AND r.name IN ('Business Owner', 'IT/CISO', 'Procurement', 'Legal')
    ) THEN
      RAISE EXCEPTION 'invitation_role_invalid_for_scope: this invitation''s role is not valid for its own scope' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Membership creation — organisation-scoped invitations get an
  -- OrganisationMembership; engagement-scoped invitations get ONLY an
  -- EngagementMembership (see §4 above for why no OrganisationMembership
  -- is created for the engagement-scoped case). Mirrors
  -- `addEngagementMember`'s own established "a revoked-then-regranted
  -- membership is a NEW row, history preserved" convention: only an
  -- ACTIVE existing membership is treated as "already has it"; a
  -- revoked one is never reactivated, a fresh row is inserted instead.
  IF v_inv.engagement_id IS NULL THEN
    SELECT om.id, om.role_id INTO v_existing_membership_id, v_existing_role_id
    FROM organisation_memberships om
    WHERE om.user_id = v_uid AND om.organisation_id = v_inv.organisation_id AND om.status = 'active';

    IF FOUND THEN
      IF v_existing_role_id <> v_inv.role_id THEN
        RAISE EXCEPTION 'invitation_membership_conflict: an existing organisation membership with a different role already exists' USING ERRCODE = '42710';
      END IF;
      -- Same role already granted — nothing to insert, proceed to mark accepted.
    ELSE
      INSERT INTO organisation_memberships (id, user_id, organisation_id, role_id, created_by)
      VALUES (gen_random_uuid(), v_uid, v_inv.organisation_id, v_inv.role_id, v_uid);
    END IF;
  ELSE
    SELECT em.id, em.role_id INTO v_existing_membership_id, v_existing_role_id
    FROM engagement_memberships em
    WHERE em.user_id = v_uid AND em.engagement_id = v_inv.engagement_id AND em.status = 'active';

    IF FOUND THEN
      IF v_existing_role_id <> v_inv.role_id THEN
        RAISE EXCEPTION 'invitation_membership_conflict: an existing engagement membership with a different role already exists' USING ERRCODE = '42710';
      END IF;
    ELSE
      INSERT INTO engagement_memberships (id, user_id, engagement_id, role_id, created_by)
      VALUES (gen_random_uuid(), v_uid, v_inv.engagement_id, v_inv.role_id, v_uid);
    END IF;
  END IF;

  -- The one legitimate pending -> accepted transition. Migration 0035's
  -- own `prevent_invitation_tampering` trigger still fires here
  -- (triggers are not bypassed by SECURITY DEFINER, only RLS/GRANT
  -- checks are) and still permits exactly this: only
  -- status/accepted_at/accepted_user_id/revoked_at may change while the
  -- row was pending, which is exactly what this UPDATE touches.
  UPDATE invitations
  SET status = 'accepted', accepted_user_id = v_uid, accepted_at = now()
  WHERE id = v_inv.id;

  -- migration 0036's own `log_invitation_change()` audit trigger fires
  -- on this UPDATE exactly as it would for any other — `auth.uid()`
  -- inside that trigger still resolves to the REAL accepting user
  -- (v_uid), not this function's own owner: `auth.uid()` reads a
  -- session-level GUC (`request.jwt.claim.sub`), unaffected by
  -- SECURITY DEFINER's role-context change. token_hash remains
  -- stripped from the resulting audit_log row exactly as before — this
  -- function does not touch that trigger.

  RETURN QUERY SELECT v_inv.id, v_inv.organisation_id, v_inv.engagement_id, v_inv.tenant_id, v_inv.role_id;
END;
$$;

-- =============================================================================
-- 5. EXECUTE privileges — authenticated only, never anon
-- =============================================================================
-- Mirrors migration 0024's own EXECUTE grant shape for its SECURITY
-- DEFINER helpers. No anonymous acceptance endpoint exists anywhere in
-- this codebase, and none is introduced here: `anon` never appears in
-- this GRANT at all, so an unauthenticated caller cannot invoke this
-- function under any circumstance, independent of the function's own
-- internal `auth.uid() IS NULL` guard above.
REVOKE EXECUTE ON FUNCTION public.accept_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated, service_role;
