-- PRIMUS PRIVACY — Migration 0019: Organisation/Engagement membership
-- onboarding.
--
-- Hand-written (DECISIONS.md R-02). Closes a real, concrete gap
-- discovered while implementing Slice B1 and confirmed by direct
-- inspection while implementing Slice B2: `organisation_memberships` and
-- `engagement_memberships` have NEVER had an INSERT policy, or even an
-- INSERT GRANT, for the `authenticated` role — migration 0001 granted
-- `SELECT` only on both tables, and defined only `..._select` RLS
-- policies. This means, as things stood before this migration, a
-- membership row on either table could only ever be created by a
-- superuser/migration/seed script — never by ordinary, authenticated
-- application traffic. Slice B1 discovered the consequence
-- (DECISIONS.md R-88): a bare TenantMembership is sufficient to CREATE
-- an Organisation but not to VIEW one afterward, because viewing
-- requires OrganisationMembership/EngagementMembership, and nothing in
-- the existing schema/RLS let the creator (or anyone) grant themselves
-- one. Slice B2's brief explicitly asks to solve this onboarding chain
-- (Tenant → Organisation → OrganisationMembership → Engagement →
-- EngagementMembership) through the *existing* membership model — this
-- migration is that narrow, minimum-necessary schema/policy change,
-- not a new membership model or a broadening of any SELECT policy. See
-- DECISIONS.md for the full reasoning.
--
-- Deliberately does NOT touch `tenant_memberships` (no INSERT policy
-- added there) — nothing in Slice B2 creates a TenantMembership row,
-- and doing so would be a materially different, more powerful
-- capability (who gets practice-wide access) than this migration's
-- narrow scope. Deliberately does NOT add UPDATE/DELETE policies on
-- either table — Slice B2 does not revoke or edit membership, only
-- grant it (instructions explicitly forbid a "role-management
-- console"); those are left for whichever future slice builds
-- membership administration.

-- =============================================================================
-- 1. Resolver functions
-- =============================================================================
-- `organisation_memberships`/`engagement_memberships` do not carry a
-- `tenant_id` column directly (unlike `organisations`/`engagements`,
-- which denormalize it for exactly this reason — see those tables' own
-- migration 0001 comments). To write a WITH CHECK / audit trigger that
-- reasons about the tenant (or organisation) a membership row belongs
-- to, that value must be resolved via the related organisation/
-- engagement row. A plain, ordinary subquery would be subject to
-- `organisations_select`/`engagements_select`'s own RLS — which,
-- for a row created moments earlier in the very same statement's own
-- transaction, the caller frequently cannot yet see (this is exactly
-- the RLS/RETURNING interaction Slice B1 discovered — DECISIONS.md
-- R-87). SECURITY DEFINER sidesteps this the same way every other
-- resolver function in migration 0001 already does (`is_active_tenant_
-- member`, `can_access_organisation`, etc.) — each function here
-- returns only a single UUID, never row data, so this does not leak
-- anything beyond what the calling policy was already deciding whether
-- to expose.

CREATE OR REPLACE FUNCTION public.organisation_tenant_id(p_organisation_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM organisations WHERE id = p_organisation_id;
$$;

CREATE OR REPLACE FUNCTION public.engagement_tenant_id(p_engagement_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM engagements WHERE id = p_engagement_id;
$$;

CREATE OR REPLACE FUNCTION public.engagement_organisation_id(p_engagement_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT organisation_id FROM engagements WHERE id = p_engagement_id;
$$;

CREATE OR REPLACE FUNCTION public.user_tenant_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM users WHERE id = p_user_id;
$$;

REVOKE EXECUTE ON FUNCTION
  public.organisation_tenant_id(uuid),
  public.engagement_tenant_id(uuid),
  public.engagement_organisation_id(uuid),
  public.user_tenant_id(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.organisation_tenant_id(uuid),
  public.engagement_tenant_id(uuid),
  public.engagement_organisation_id(uuid),
  public.user_tenant_id(uuid)
TO authenticated, service_role;

-- =============================================================================
-- 2. organisation_memberships — INSERT policy + GRANT
-- =============================================================================
-- Mirrors the exact rule `organisations_insert` already uses for
-- creating the organisation itself (`is_active_tenant_member`) — the
-- narrowest existing authorization consistent with SECURITY.md §3's
-- "Practice staff do not get implicit cross-client access... they get
-- it only through an explicit ... OrganisationMembership ..., which is
-- itself an auditable, revocable grant": a tenant member may grant
-- OrganisationMembership (on any organisation under their own tenant)
-- to any user who is themselves a member of that same tenant — an
-- explicit, audited act (§3 below), never an implicit bypass of RLS.
-- The second WITH CHECK clause is what makes instructions §5's two
-- "never allow" cases structurally impossible, not merely
-- application-layer-policed:
--   - "Organisation A → membership for a User from Tenant B" — blocked,
--     since `user_tenant_id(user_id)` would not equal the organisation's
--     own tenant.
--   - "Tenant A → Organisation B membership" — blocked, since
--     `is_active_tenant_member` is evaluated against Organisation B's
--     OWN tenant (resolved via `organisation_tenant_id`), not whichever
--     tenant the caller happens to belong to.
CREATE POLICY organisation_memberships_insert ON "organisation_memberships"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_tenant_member(public.organisation_tenant_id(organisation_id))
    AND public.user_tenant_id(user_id) = public.organisation_tenant_id(organisation_id)
  );

GRANT INSERT ON "organisation_memberships" TO authenticated;

-- =============================================================================
-- 3. engagement_memberships — INSERT policy + GRANT
-- =============================================================================
-- Mirrors `engagements_insert`'s own rule exactly (tenant member OR
-- organisation member of the engagement's own organisation) — the same
-- set of people who may create an Engagement may also grant
-- EngagementMembership on it, which is what lets Slice B2's engagement-
-- creation flow grant the creator access to what they just created, in
-- the same transaction, without a broader capability being introduced.
-- Same cross-tenant user-identity guard as §2 above.
CREATE POLICY engagement_memberships_insert ON "engagement_memberships"
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.is_active_tenant_member(public.engagement_tenant_id(engagement_id))
      OR public.is_active_organisation_member(public.engagement_organisation_id(engagement_id))
    )
    AND public.user_tenant_id(user_id) = public.engagement_tenant_id(engagement_id)
  );

GRANT INSERT ON "engagement_memberships" TO authenticated;

-- =============================================================================
-- 4. Audit triggers
-- =============================================================================
-- `engagements` never had an audit trigger either (the same
-- pre-existing, Milestone-1-era gap Slice B1 found and closed for
-- `organisations` — DECISIONS.md R-86) — confirmed by the same grep
-- method. Slice B2 is the first slice to write `engagements` rows via
-- application code, so this is closed now, for the same reason.
-- `log_methodology_change()` (migration 0007) is reused entirely
-- unchanged — `engagements` already carries the `tenant_id`/`id`
-- columns it requires, the same shape as `organisations`.
CREATE TRIGGER engagements_audit_log
  AFTER INSERT OR UPDATE ON "engagements"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

-- `organisation_memberships`/`engagement_memberships` cannot reuse
-- `log_methodology_change()` unchanged — that function reads
-- `NEW.tenant_id` directly, a column neither table has (see §1 above).
-- This is the same function, adapted only to resolve `tenant_id` via
-- the resolver functions §1 already introduces, rather than a
-- differently-designed audit mechanism.
CREATE OR REPLACE FUNCTION public.log_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'organisation_memberships' THEN
    v_tenant_id := public.organisation_tenant_id(NEW.organisation_id);
  ELSIF TG_TABLE_NAME = 'engagement_memberships' THEN
    v_tenant_id := public.engagement_tenant_id(NEW.engagement_id);
  END IF;

  INSERT INTO audit_log (tenant_id, actor_user_id, entity_type, entity_id, action, field_changes)
  VALUES (
    v_tenant_id,
    auth.uid(),
    TG_TABLE_NAME,
    NEW.id,
    lower(TG_OP)::audit_action,
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW)) ELSE to_jsonb(NEW) END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER organisation_memberships_audit_log
  AFTER INSERT OR UPDATE ON "organisation_memberships"
  FOR EACH ROW EXECUTE FUNCTION public.log_membership_change();

CREATE TRIGGER engagement_memberships_audit_log
  AFTER INSERT OR UPDATE ON "engagement_memberships"
  FOR EACH ROW EXECUTE FUNCTION public.log_membership_change();
