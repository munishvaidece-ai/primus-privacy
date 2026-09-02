-- PRIMUS PRIVACY — Migration 0037: invitation authorization & RLS
-- (P2B.2 — Invitation Authorization & RLS).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- prior security/hardening migration (DECISIONS.md R-02): GRANT/RLS
-- policy statements aren't modeled in the Drizzle TS schema. Assumes
-- migrations 0000-0036 are already applied. Purely additive: migration
-- 0035 enabled RLS on `invitations` and created zero policies (its own
-- §3 comment: "P2B.2 is the slice that adds the real, `membership.
-- manage`-based policies") — this migration adds exactly those three
-- policies plus the matching GRANT, and does not DROP, REPLACE, or
-- otherwise touch any existing policy on this or any other table.
--
-- =============================================================================
-- 1. The security contract this migration implements
-- =============================================================================
-- Who may manage invitations — create, list/read, or revoke — is the
-- SAME `membership.manage` permission (`db/seed/roles.ts`, migration
-- 0024's `has_engagement_permission`/`has_organisation_permission`
-- functions) that already governs `engagement_memberships`
-- create/revoke (Slice C7.2). This migration does not invent a second
-- authorization model:
--
--   * organisation-scoped invitations (`engagement_id IS NULL`) require
--     organisation-level `membership.manage` ONLY — no engagement-level
--     fallback. An Engagement Manager staffed on a single engagement of
--     this organisation must not thereby gain authority to invite an
--     organisation-wide administrator for the whole client; that
--     authority belongs to Client Administrator alone. Mirrors
--     `lib/authorization/service.ts`'s new `canManageOrganisationInvitations`.
--
--   * engagement-scoped invitations (`engagement_id IS NOT NULL`)
--     require engagement-level OR organisation-level `membership.
--     manage` — the EXACT existing rule `engagement_memberships_insert`/
--     `_update` (migration 0024) and `canManageEngagementMembership`
--     (lib/authorization/service.ts) already use, reused unchanged, not
--     reimplemented.
--
-- Both `has_engagement_permission`/`has_organisation_permission`
-- already exist (migration 0024) — this migration calls them, it does
-- not redefine them.
--
-- List/read authorization (`invitations_select`) is restricted to
-- `membership.manage` actors ONLY — deliberately NOT the broader "any
-- same-tenant/organisation/engagement member" shape `can_access_
-- organisation`/`can_access_engagement` grant elsewhere in this schema.
-- An invitation names an email address and a role about to be granted
-- real access; an ordinary Consultant or Business Owner with no
-- `membership.manage` grant has no legitimate need to browse it.
--
-- Role allowlist enforcement (P2B.0 Decision 4): a malicious caller
-- must not be able to create an invitation for an arbitrary role merely
-- by supplying another `role_id`. Enforced here via a `roles.name`
-- subquery inside `invitations_insert`'s WITH CHECK — `roles_select`
-- (migration 0001) is `USING (true)`, globally readable, so this
-- subquery needs no privilege elevation of its own. The SAME two lists
-- are independently enforced at the application layer by
-- `lib/authorization/service.ts`'s new `isInvitationRoleAllowedForScope`/
-- `canAssignInvitationRole` (SECURITY.md §2: independently implemented,
-- must independently agree).
--
-- Protected-field enforcement: migration 0035's own
-- `prevent_invitation_tampering` trigger (UNCHANGED, not touched by this
-- migration) already makes tenant_id/organisation_id/engagement_id/
-- invited_email/role_id/token_hash/invited_by/expires_at/created_at
-- structurally immutable the instant a row exists, and freezes the
-- ENTIRE row once `status` leaves 'pending' — that trigger alone already
-- closes "move between orgs/engagements," "change invited_email,"
-- "escalate via role_id," "change token_hash," and "manipulate
-- created_at or expires_at" for every UPDATE, independent of RLS. What
-- remains, and what this migration's own policies close, is the INSERT
-- boundary (nothing before this migration constrained what a fresh row
-- could claim) and the UPDATE authorization boundary (WHO may perform
-- the one still-legal pending -> {accepted, revoked} transition, and —
-- see §3 below — which of those two destinations an ordinary
-- `membership.manage` actor may reach at all):
--
--   * `invited_by = auth.uid()` at INSERT — a caller must attribute a
--     new invitation to themselves; forging a different `invited_by` is
--     rejected. (Immutable thereafter, per the existing trigger.)
--   * `status = 'pending' AND accepted_user_id IS NULL AND accepted_at
--     IS NULL AND revoked_at IS NULL` at INSERT — a caller cannot
--     fabricate an already-accepted or already-revoked row at creation
--     time; every invitation must be genuinely born pending. This is
--     the INSERT-time half of "forge accepted_user_id or accepted_at" —
--     the UPDATE-time half is closed by §3 below.
--
-- =============================================================================
-- 2. invitations_select — membership.manage actors only
-- =============================================================================
CREATE POLICY invitations_select ON "invitations"
  FOR SELECT TO authenticated
  USING (
    public.has_organisation_permission(organisation_id, 'membership.manage')
    OR (engagement_id IS NOT NULL AND public.has_engagement_permission(engagement_id, 'membership.manage'))
  );

-- =============================================================================
-- 3. invitations_insert — membership.manage + role allowlist + INSERT-time
--    field integrity
-- =============================================================================
CREATE POLICY invitations_insert ON "invitations"
  FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND status = 'pending'
    AND accepted_user_id IS NULL
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND (
      public.has_organisation_permission(organisation_id, 'membership.manage')
      OR (engagement_id IS NOT NULL AND public.has_engagement_permission(engagement_id, 'membership.manage'))
    )
    AND (
      (
        engagement_id IS NULL
        AND EXISTS (
          SELECT 1 FROM roles r
          WHERE r.id = role_id AND r.name IN ('Client Administrator', 'Privacy Officer', 'CXO / Executive Viewer')
        )
      )
      OR (
        engagement_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM roles r
          WHERE r.id = role_id AND r.name IN ('Business Owner', 'IT/CISO', 'Procurement', 'Legal')
        )
      )
    )
  );

-- =============================================================================
-- 4. invitations_update — membership.manage actors, pending -> revoked ONLY
-- =============================================================================
-- Deliberately does NOT allow an ordinary `membership.manage` actor's
-- plain UPDATE to reach `status = 'accepted'`. Acceptance is a
-- DIFFERENT actor (the invitee, authenticated by token possession/email
-- match — P2B.4, not yet built) and a DIFFERENT authorization basis
-- entirely, not "anyone who could have created the invitation." This
-- WITH CHECK structurally reserves that transition for a future
-- SECURITY DEFINER `accept_invitation()` function, which will run with
-- its own owner's privilege (the same mechanism `handle_new_auth_user`/
-- `log_invitation_change()` already rely on) and so is not bound by this
-- `TO authenticated`-scoped policy at all — this migration prepares that
-- boundary without introducing acceptance itself (P2B.2's own explicit
-- scope: "Do not introduce acceptance in this slice").
--
-- Evaluation order: migration 0035's `prevent_invitation_tampering`
-- BEFORE ROW trigger fires first and does not block a pending ->
-- accepted transition (only status/accepted_at/accepted_user_id/
-- revoked_at may change while pending); this WITH CHECK then evaluates
-- the resulting NEW row and rejects it unless `status = 'revoked'`.
CREATE POLICY invitations_update ON "invitations"
  FOR UPDATE TO authenticated
  USING (
    public.has_organisation_permission(organisation_id, 'membership.manage')
    OR (engagement_id IS NOT NULL AND public.has_engagement_permission(engagement_id, 'membership.manage'))
  )
  WITH CHECK (
    status = 'revoked'
    AND (
      public.has_organisation_permission(organisation_id, 'membership.manage')
      OR (engagement_id IS NOT NULL AND public.has_engagement_permission(engagement_id, 'membership.manage'))
    )
  );

-- =============================================================================
-- 5. Grant
-- =============================================================================
-- No DELETE — matching the established convention (engagement_
-- memberships, validation_records, and every other lifecycle-tracked
-- table in this schema: a correction is a new row/a status transition,
-- never a hard delete).
GRANT SELECT, INSERT, UPDATE ON "invitations" TO authenticated;
