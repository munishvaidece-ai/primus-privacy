-- PRIMUS PRIVACY — Migration 0024: Engagement membership management
-- (Slice C7.2).
--
-- Hand-written (DECISIONS.md R-02). Closes a real, structural gap
-- confirmed by direct inspection: migration 0019's own
-- `engagement_memberships_insert` policy was deliberately scoped to
-- "the same set of people who may create an Engagement" (tenant-wide or
-- organisation-wide membership) — enough to let a newly-created
-- Engagement's own creator be granted access to it in the same
-- transaction, but NOT enough for the realistic, everyday case this
-- slice builds: an ordinary Engagement Manager, who typically holds
-- ONLY an `engagement_memberships` row on their own single engagement
-- (no tenant- or organisation-wide membership at all — confirmed by
-- direct inspection of `createEngagement`, which grants the creator
-- exactly one `engagement_memberships` row and nothing else), adding a
-- colleague or client user to THAT engagement. Under migration 0019's
-- policy alone, that Engagement Manager would be rejected by RLS even
-- once the application layer (this slice's own `membership.manage`
-- permission check, DECISIONS.md R-114) has already approved them — a
-- real, structural blocker for this feature's primary intended user,
-- not a hypothetical edge case.
--
-- `engagement_memberships` also has NO UPDATE policy at all before this
-- migration (migration 0019's own comment: "Deliberately does NOT add
-- UPDATE/DELETE policies... those are left for whichever future slice
-- builds membership administration") — needed now for Revoke, which is
-- a status change (`active` -> `revoked`), never a hard DELETE — see
-- DECISIONS.md R-114 for why: the partial unique index on the active
-- row per (user, engagement) (migration 0000) only makes sense as a
-- design if a revoked row is meant to persist alongside a later active
-- re-grant as a separate row, not be deleted outright.
--
-- Both additions reuse the ALREADY-SEEDED Role/Permission/RolePermission
-- mechanism (`db/seed/roles.ts`'s own `membership.manage` grant to
-- Engagement Manager (engagement-scope) and Client Administrator
-- (organisation-scope)) rather than inventing a new permission or role.
-- This is the first RLS policy in this codebase to consult that
-- mechanism directly, but it is not a new authorization system —
-- Role/Permission/RolePermission has existed, fully seeded with exactly
-- this grant, since Milestone 1; nothing before this slice ever read it
-- at the RLS or application layer (lib/authorization/service.ts's own
-- file comment, until this slice, explicitly says so).
--
-- Every existing way to pass `engagement_memberships_insert` still
-- passes unchanged (tenant-wide or organisation-wide membership) — this
-- migration adds a THIRD way (permission-based), it removes none, and
-- the outer "target user's own tenant must match the engagement's
-- tenant" clause is untouched, so that structural boundary remains
-- exactly as enforced as before.

-- =============================================================================
-- 1. Permission-resolver functions
-- =============================================================================
-- SECURITY DEFINER for the same reason migration 0019's own resolver
-- functions are (RLS-recursion avoidance querying membership tables
-- from within a membership-table policy) — each returns only a single
-- boolean, never row data, so this does not leak anything beyond what
-- the calling policy was already deciding whether to expose. Checks the
-- CALLING user (auth.uid()) only, never a caller-supplied user id — an
-- actor can never ask "does some other user have this permission,"
-- matching every other resolver function in this project.

CREATE OR REPLACE FUNCTION public.has_engagement_permission(p_engagement_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM engagement_memberships em
    JOIN role_permissions rp ON rp.role_id = em.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE em.engagement_id = p_engagement_id
      AND em.user_id = auth.uid()
      AND em.status = 'active'
      AND p.key = p_permission_key
  );
$$;

CREATE OR REPLACE FUNCTION public.has_organisation_permission(p_organisation_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organisation_memberships om
    JOIN role_permissions rp ON rp.role_id = om.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE om.organisation_id = p_organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND p.key = p_permission_key
  );
$$;

REVOKE EXECUTE ON FUNCTION
  public.has_engagement_permission(uuid, text),
  public.has_organisation_permission(uuid, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.has_engagement_permission(uuid, text),
  public.has_organisation_permission(uuid, text)
TO authenticated, service_role;

-- =============================================================================
-- 2. engagement_memberships — extend INSERT (additive OR clause), add UPDATE
-- =============================================================================

DROP POLICY "engagement_memberships_insert" ON "engagement_memberships";
CREATE POLICY engagement_memberships_insert ON "engagement_memberships"
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.is_active_tenant_member(public.engagement_tenant_id(engagement_id))
      OR public.is_active_organisation_member(public.engagement_organisation_id(engagement_id))
      OR public.has_engagement_permission(engagement_id, 'membership.manage')
      OR public.has_organisation_permission(public.engagement_organisation_id(engagement_id), 'membership.manage')
    )
    AND public.user_tenant_id(user_id) = public.engagement_tenant_id(engagement_id)
  );

-- Only the caller who could have GRANTED this membership may revoke
-- it — the identical permission-based rule as INSERT's own new clauses,
-- reused unchanged rather than a separately-invented "who can revoke"
-- rule. Deliberately does NOT include the tenant-/organisation-wide
-- membership fallback INSERT still carries (that fallback exists only
-- to support Slice B2's own self-onboarding-at-creation-time flow,
-- which never updates an existing row) — an ordinary tenant/
-- organisation member with no `membership.manage` permission has no
-- business revoking someone else's engagement membership.
CREATE POLICY engagement_memberships_update ON "engagement_memberships"
  FOR UPDATE TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'membership.manage')
    OR public.has_organisation_permission(public.engagement_organisation_id(engagement_id), 'membership.manage')
  )
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'membership.manage')
    OR public.has_organisation_permission(public.engagement_organisation_id(engagement_id), 'membership.manage')
  );

GRANT UPDATE ON "engagement_memberships" TO authenticated;

-- =============================================================================
-- 3. Reparenting guard — only `status`/`updated_at` may change via UPDATE
-- =============================================================================
-- Without this, a caller whose WITH CHECK passes for a legitimate
-- revoke could ALSO silently change `user_id`/`engagement_id`/`role_id`
-- in the same UPDATE statement — the RLS policy above only re-validates
-- the NEW row's own scope, not "only status actually changed." A real
-- privilege-escalation surface (quietly reassigning someone else's
-- membership row to a different, more powerful role, or to a different
-- engagement) without this guard. The same reparenting-guard pattern
-- every other mutable table in this project already uses
-- (assessments_prevent_reparenting, prevent_validation_record_tampering,
-- etc.), applied here for the first time to a membership table.

CREATE OR REPLACE FUNCTION public.prevent_engagement_membership_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    RAISE EXCEPTION
      'engagement_memberships.{user_id,engagement_id,role_id} are immutable after creation (membership %); revoke and re-grant instead',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_memberships_prevent_reparenting
  BEFORE UPDATE ON "engagement_memberships"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_engagement_membership_reparenting();

-- No new audit trigger needed — `engagement_memberships_audit_log`
-- (migration 0019) already fires `AFTER INSERT OR UPDATE`, so a Revoke
-- (an UPDATE) is already captured by the existing mechanism, unchanged.

-- =============================================================================
-- 4. Eligible-user resolution — a genuine, real gap this slice's own
--    testing discovered (not assumed from a prior report): `users_select`
--    (migration 0001) is `id = auth.uid() OR shares_membership_scope(id)`
--    — a caller can only see another user's row if they ALREADY share a
--    tenant/organisation/engagement membership with them. This is
--    correct and unchanged for every existing screen, but it means the
--    very feature this slice builds — finding a user who is NOT YET on
--    this Engagement, in order to add them — is structurally invisible
--    through ordinary RLS: an Engagement Manager cannot even SELECT a
--    candidate user's row to check whether they're eligible.
--
--    The fix is the same SECURITY DEFINER pattern this file (and
--    migration 0001/0019) already uses to resolve exactly this kind of
--    "need to reason about a row RLS would otherwise hide, for a
--    narrow, legitimate purpose" problem — NOT a widening of
--    `users_select` itself (which would let any authenticated user
--    browse their whole tenant's user directory, a materially broader
--    and unrelated capability this slice does not need or introduce).
--    Both functions below re-check `has_engagement_permission`/
--    `has_organisation_permission` internally, on every call, rather
--    than relying on the calling application code alone — an
--    unauthorized caller gets zero rows, never an error that would
--    leak whether a given user exists.

CREATE OR REPLACE FUNCTION public.eligible_engagement_members(p_engagement_id uuid)
RETURNS TABLE(id uuid, email text, display_name text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email, u.display_name
  FROM users u, engagements e
  WHERE e.id = p_engagement_id
    AND (
      public.has_engagement_permission(p_engagement_id, 'membership.manage')
      OR public.has_organisation_permission(e.organisation_id, 'membership.manage')
    )
    AND u.tenant_id = e.tenant_id
    AND u.status = 'active'
    AND (u.client_org_id IS NULL OR u.client_org_id = e.organisation_id)
    AND NOT EXISTS (
      SELECT 1 FROM engagement_memberships em
      WHERE em.engagement_id = p_engagement_id AND em.user_id = u.id AND em.status = 'active'
    )
  ORDER BY u.email;
$$;

-- The single-user counterpart `addEngagementMember` itself uses, so its
-- own error messages can stay specific (suspended / wrong tenant / wrong
-- organisation) rather than collapsing to one generic "not eligible" —
-- returns only the three fields needed to make that determination, no
-- email/display_name (this one is looked up by an id the caller already
-- has, from the Add Member form's own submission, not browsed).
CREATE OR REPLACE FUNCTION public.resolve_membership_candidate(p_engagement_id uuid, p_user_id uuid)
RETURNS TABLE(tenant_id uuid, client_org_id uuid, status user_status)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT u.tenant_id, u.client_org_id, u.status
  FROM users u
  WHERE u.id = p_user_id
    AND (
      public.has_engagement_permission(p_engagement_id, 'membership.manage')
      OR public.has_organisation_permission(public.engagement_organisation_id(p_engagement_id), 'membership.manage')
    );
$$;

-- A third, related gap this slice's own testing found (not assumed): the
-- membership ROSTER itself (instructions §16, shown to any engagement
-- member, not only a manager) has the identical problem once a member
-- is revoked. `shares_membership_scope`'s own engagement-membership
-- branch requires BOTH sides' membership to be `status = 'active'`
-- (migration 0001) — the moment a member is revoked, they no longer
-- share an *active* scope with anyone still on the engagement, so a
-- plain `JOIN users` roster query silently drops their row (or, with a
-- LEFT JOIN, shows a real EngagementMembership row with no name/email
-- attached) purely as an RLS side effect, not because anything about
-- the membership itself became hidden. This directly contradicts this
-- project's own established "show status honestly, never collapse
-- history" posture (e.g. ValidationRecord's full history, Slice C6) —
-- a revoked member's own past presence on the engagement is exactly the
-- kind of history this product is built to keep visible, not erase.
CREATE OR REPLACE FUNCTION public.engagement_membership_roster(p_engagement_id uuid)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  email text,
  display_name text,
  role_name text,
  status membership_status,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT em.id, em.user_id, u.email, u.display_name, r.name, em.status, em.created_at
  FROM engagement_memberships em
  JOIN users u ON u.id = em.user_id
  JOIN roles r ON r.id = em.role_id
  WHERE em.engagement_id = p_engagement_id
    AND public.can_access_engagement(p_engagement_id, public.engagement_organisation_id(p_engagement_id))
  ORDER BY em.created_at;
$$;

REVOKE EXECUTE ON FUNCTION
  public.eligible_engagement_members(uuid),
  public.resolve_membership_candidate(uuid, uuid),
  public.engagement_membership_roster(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.eligible_engagement_members(uuid),
  public.resolve_membership_candidate(uuid, uuid),
  public.engagement_membership_roster(uuid)
TO authenticated, service_role;
