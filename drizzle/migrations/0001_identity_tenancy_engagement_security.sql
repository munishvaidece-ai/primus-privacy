-- PRIMUS PRIVACY — Migration 0001: security layer for the Identity +
-- Tenancy + Engagement Structure slice (0000_identity_tenancy_engagement.sql).
--
-- Hand-written, not drizzle-kit generated — consistent with DECISIONS.md
-- R-02 ("RLS policies written as plain SQL migrations rather than
-- through the ORM"). Do not fold this into 0000 or regenerate it with
-- `drizzle-kit generate`; the Drizzle TS schema intentionally does not
-- model RLS, triggers, or the auth.users FK (see db/schema/*.ts comments).
--
-- Deployable to a real Supabase project as-is: it assumes `auth.users`
-- and `auth.uid()` already exist (Supabase provides both natively). For
-- local/CI testing without a Supabase project, run
-- scripts/local-dev-auth-shim.sql FIRST to provide compatible stand-ins —
-- see that file's header for exactly what it shims and why it must never
-- be run against a real Supabase project.

-- =============================================================================
-- 1. Audit-column foreign keys to users(id) and users(id) -> auth.users(id)
-- =============================================================================
-- Added here via ALTER TABLE (not in the Drizzle TS schema) solely to
-- avoid a circular TypeScript module import between users.ts and
-- tenants.ts/organisations.ts/engagements.ts — see those files' comments.
-- These are ordinary, permanent FK constraints, not a workaround of
-- convenience; they are enforced identically to any other FK from here on.

ALTER TABLE "users"
  ADD CONSTRAINT "users_id_auth_users_id_fk"
  FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "tenants_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "organisations"
  ADD CONSTRAINT "organisations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "organisations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "engagements"
  ADD CONSTRAINT "engagements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "engagements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "tenant_memberships"
  ADD CONSTRAINT "tenant_memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "organisation_memberships"
  ADD CONSTRAINT "organisation_memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "engagement_memberships"
  ADD CONSTRAINT "engagement_memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id");

-- =============================================================================
-- 2. Reparenting guards — tenant_id / organisation_id are immutable after
--    creation, as an absolute DB-level invariant (Milestone 1 instructions
--    §4: "Do not allow inconsistent tenant relationships"), independent of
--    who is asking (including service_role). This is deliberately a
--    trigger, not an RLS WITH CHECK clause: RLS can express "the acting
--    user must be authorized to make this change" but not cleanly express
--    "this specific column must never change regardless of who's asking"
--    without comparing OLD and NEW, which triggers do naturally.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_organisation_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION
      'organisations.tenant_id is immutable after creation (organisation %, old tenant %, attempted new tenant %)',
      OLD.id, OLD.tenant_id, NEW.tenant_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organisations_prevent_reparenting
  BEFORE UPDATE ON "organisations"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_organisation_reparenting();

CREATE OR REPLACE FUNCTION public.prevent_engagement_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
    RAISE EXCEPTION
      'engagements.tenant_id / organisation_id are immutable after creation (engagement %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagements_prevent_reparenting
  BEFORE UPDATE ON "engagements"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_engagement_reparenting();

-- =============================================================================
-- 3. auth.users -> public.users provisioning trigger
-- =============================================================================
-- Deliberately does NOT default tenant_id: a PRIMUS PRIVACY user profile
-- cannot exist without a known tenant, and this milestone has no
-- self-service signup (ROADMAP.md — self-serve onboarding is Phase 3).
-- The intended flow is server-side provisioning via the Supabase Admin
-- API, which sets `raw_app_meta_data.tenant_id` (and, for client-side
-- users, `client_org_id`) at account-creation time; this trigger simply
-- projects that into the profile row. Absence of tenant_id is a hard
-- error, not a silently-skipped row — see DECISIONS.md for this recorded
-- implementation decision.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_client_org_id uuid;
BEGIN
  v_tenant_id := (NEW.raw_app_meta_data ->> 'tenant_id')::uuid;
  v_client_org_id := NULLIF(NEW.raw_app_meta_data ->> 'client_org_id', '')::uuid;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION
      'auth.users.raw_app_meta_data.tenant_id is required to provision a PRIMUS PRIVACY user profile (auth user %)',
      NEW.id;
  END IF;

  INSERT INTO public.users (id, tenant_id, client_org_id, email, display_name, status)
  VALUES (
    NEW.id,
    v_tenant_id,
    v_client_org_id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'display_name',
    'active'
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Keep public.users.email in sync with auth.users.email (the source of
-- truth for the identifier). This does NOT duplicate a credential — see
-- db/schema/users.ts for why a synced email is a deliberate, narrow
-- exception to "don't duplicate Supabase auth data."
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.users SET email = NEW.email, updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_email_change();

-- =============================================================================
-- 4. Authorization helper functions
-- =============================================================================
-- SECURITY DEFINER + a locked-down search_path: these functions read
-- membership tables that themselves have RLS enabled, on behalf of RLS
-- policies on OTHER tables. Without SECURITY DEFINER, a call to (say)
-- can_access_organisation() from inside an organisations RLS policy would
-- itself be subject to organisation_memberships' own RLS as the calling
-- user, which is unnecessary and risks recursive-policy edge cases;
-- SECURITY DEFINER lets the function read membership rows directly (it
-- only ever returns a boolean, never row data, so this does not leak
-- anything the RLS policy wasn't already deciding to expose).
-- EXECUTE is revoked from PUBLIC and re-granted narrowly below (§6).

CREATE OR REPLACE FUNCTION public.is_active_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_memberships
    WHERE tenant_id = p_tenant_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_organisation_member(p_organisation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organisation_memberships
    WHERE organisation_id = p_organisation_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_engagement_member(p_engagement_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM engagement_memberships
    WHERE engagement_id = p_engagement_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

-- An organisation is accessible if the caller has org-wide membership on
-- it, OR membership on any engagement under it. TenantMembership alone
-- does NOT grant access here — per SECURITY.md §3: "Practice staff do
-- not get implicit cross-client access within their own tenant — they
-- get it only through an explicit EngagementMembership (or ...
-- OrganisationMembership)."
CREATE OR REPLACE FUNCTION public.can_access_organisation(p_organisation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.is_active_organisation_member(p_organisation_id)
    OR EXISTS (
      SELECT 1 FROM engagements e
      WHERE e.organisation_id = p_organisation_id
        AND public.is_active_engagement_member(e.id)
    );
$$;

-- An engagement is accessible via its own EngagementMembership, or via
-- OrganisationMembership on its parent org (an org-wide role sees every
-- engagement of its own client — e.g. Client Administrator).
--
-- Takes `p_organisation_id` directly rather than looking it up by
-- re-querying `engagements` for `p_engagement_id`: a self-referential
-- subquery on the same table a row is being INSERTed into cannot see
-- that row during the same command's RETURNING row-security check (a
-- documented Postgres RLS visibility limitation — INSERT policies are
-- evaluated within the same command as the insert, before the command
-- counter advances for a fresh scan of the table). Both id and
-- organisation_id are already columns of the row being checked, so no
-- subquery is needed at all — this is also simply more efficient.
CREATE OR REPLACE FUNCTION public.can_access_engagement(p_engagement_id uuid, p_organisation_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.is_active_engagement_member(p_engagement_id)
    OR public.is_active_organisation_member(p_organisation_id);
$$;

-- A tenant row itself is visible to anyone with ANY legitimate foothold
-- in it (tenant/organisation/engagement membership) — the Tenant table
-- carries only name/status, so broad read visibility within one's own
-- tenant is low-risk. This does NOT extend to organisation/engagement
-- CONTENT — see can_access_organisation / can_access_engagement above,
-- which TenantMembership alone does not satisfy.
CREATE OR REPLACE FUNCTION public.can_access_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.is_active_tenant_member(p_tenant_id)
    OR EXISTS (
      SELECT 1 FROM organisations o
      WHERE o.tenant_id = p_tenant_id
        AND public.can_access_organisation(o.id)
    );
$$;

-- Used for `users` table visibility: can the caller see p_other_user_id's
-- profile because they share an active membership scope (same tenant,
-- same organisation, or same engagement)? Narrower than "same tenant" —
-- requires an actual shared foothold, not just co-existing in a large
-- tenant.
CREATE OR REPLACE FUNCTION public.shares_membership_scope(p_other_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_memberships a
    JOIN tenant_memberships b ON a.tenant_id = b.tenant_id
    WHERE a.user_id = auth.uid() AND a.status = 'active'
      AND b.user_id = p_other_user_id AND b.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM organisation_memberships a
    JOIN organisation_memberships b ON a.organisation_id = b.organisation_id
    WHERE a.user_id = auth.uid() AND a.status = 'active'
      AND b.user_id = p_other_user_id AND b.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM engagement_memberships a
    JOIN engagement_memberships b ON a.engagement_id = b.engagement_id
    WHERE a.user_id = auth.uid() AND a.status = 'active'
      AND b.user_id = p_other_user_id AND b.status = 'active'
  );
$$;

-- =============================================================================
-- 5. Enable RLS (with FORCE, so even a table-owning role is subject to
--    it — defense in depth; service_role's BYPASSRLS attribute is the
--    only intended bypass, and even it is still subject to the plain
--    GRANT revocations in §6, e.g. audit_log append-only).
-- =============================================================================

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organisations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engagements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "organisation_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organisation_memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "engagement_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 6. Policies
-- =============================================================================

-- --- tenants -----------------------------------------------------------
-- Milestone 1 scope decision (DECISIONS.md): tenant provisioning
-- (INSERT/UPDATE/DELETE) is a platform-ops action performed via
-- service_role in this milestone, not exposed to `authenticated` at all
-- — no write policy is defined, so RLS denies by default.
CREATE POLICY tenants_select ON "tenants"
  FOR SELECT TO authenticated
  USING (public.can_access_tenant(id));

-- --- organisations -------------------------------------------------------
CREATE POLICY organisations_select ON "organisations"
  FOR SELECT TO authenticated
  USING (public.can_access_organisation(id));

-- A tenant member can onboard a new client organisation under their own
-- tenant (fine-grained role permission, e.g. restricting this to
-- Platform Administrator specifically, is an application-layer concern
-- per DECISIONS.md R-07 — RLS enforces the tenant-scope backstop only).
CREATE POLICY organisations_insert ON "organisations"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id));

-- tenant_id re-parenting is blocked unconditionally by the
-- organisations_prevent_reparenting trigger (§2), so this policy only
-- needs to gate ordinary updates by someone with real access to the row.
CREATE POLICY organisations_update ON "organisations"
  FOR UPDATE TO authenticated
  USING (public.can_access_organisation(id))
  WITH CHECK (public.can_access_organisation(id));

-- --- engagements -----------------------------------------------------------
CREATE POLICY engagements_select ON "engagements"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(id, organisation_id));

-- A tenant member (opening a new engagement for any client in their
-- tenant) or an organisation member (an org-wide client role requesting
-- a new engagement for their own org) may create one. The composite FK
-- to organisations(id, tenant_id) (0000 migration) makes an inconsistent
-- (organisation_id, tenant_id) pair impossible regardless of this check.
CREATE POLICY engagements_insert ON "engagements"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_tenant_member(tenant_id)
    OR public.is_active_organisation_member(organisation_id)
  );

CREATE POLICY engagements_update ON "engagements"
  FOR UPDATE TO authenticated
  USING (public.can_access_engagement(id, organisation_id))
  WITH CHECK (public.can_access_engagement(id, organisation_id));

-- --- users -----------------------------------------------------------------
CREATE POLICY users_select_self_or_shared_scope ON "users"
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_membership_scope(id));

-- Row creation happens exclusively via the on_auth_user_created trigger
-- (§3), which is SECURITY DEFINER and therefore not subject to RLS — no
-- INSERT policy is defined for `authenticated`.
CREATE POLICY users_update_self ON "users"
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- --- roles / permissions / role_permissions ---------------------------
-- Global reference/taxonomy data, not tenant-scoped. Readable by any
-- authenticated user; writes are a service_role/migration concern in
-- this milestone (Milestone 1 instructions §3: "Do not overbuild the
-- permission-management UI").
CREATE POLICY roles_select ON "roles" FOR SELECT TO authenticated USING (true);
CREATE POLICY permissions_select ON "permissions" FOR SELECT TO authenticated USING (true);
CREATE POLICY role_permissions_select ON "role_permissions" FOR SELECT TO authenticated USING (true);

-- --- membership tables -------------------------------------------------
-- SELECT: a user always sees their own membership rows, and sees the
-- roster of any scope they are themselves an active member of.
-- INSERT/UPDATE/DELETE (granting or revoking a role): deliberately NOT
-- exposed to `authenticated` in this milestone. SECURITY.md's threat
-- table requires that granting a broader membership "requires a
-- permission of its own, not just write access to the membership
-- table" — encoding that safely as a self-service RLS policy is exactly
-- the kind of dynamic, role-permission-matrix logic DECISIONS.md R-07
-- says does not belong in RLS. All membership grants/revocations go
-- through server-only application code (using service_role, after its
-- own authorization check) until a future milestone's object-level
-- permission model can express this safely in RLS. See DECISIONS.md for
-- this recorded decision.
CREATE POLICY tenant_memberships_select ON "tenant_memberships"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_active_tenant_member(tenant_id));

CREATE POLICY organisation_memberships_select ON "organisation_memberships"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_active_organisation_member(organisation_id));

CREATE POLICY engagement_memberships_select ON "engagement_memberships"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_active_engagement_member(engagement_id));

-- --- audit_log -----------------------------------------------------------
-- SELECT scoped to tenant access, matching the coarse "minimum audit-log
-- foundation" this milestone asks for; finer per-entity audit visibility
-- is deferred to the full audit-log milestone (DECISIONS.md).
CREATE POLICY audit_log_select ON "audit_log"
  FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));

-- A caller may only write an audit entry under a tenant they can
-- actually access — prevents forging entries under an unrelated tenant.
-- No UPDATE/DELETE policy exists for anyone; append-only is enforced
-- again, more strongly, by the GRANT revocations in §7 (which apply even
-- to service_role, unlike RLS).
CREATE POLICY audit_log_insert ON "audit_log"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_tenant(tenant_id));

-- =============================================================================
-- 7. Table-level GRANTs
-- =============================================================================
-- Belt-and-suspenders alongside RLS (DECISIONS.md R-07): a role with no
-- GRANT on a table is denied before RLS is even evaluated.  `anon`
-- receives nothing on any table in this migration — no part of Milestone
-- 1's data is meant to be reachable without authentication.

REVOKE ALL ON
  "tenants", "organisations", "engagements", "users",
  "roles", "permissions", "role_permissions",
  "tenant_memberships", "organisation_memberships", "engagement_memberships",
  "audit_log"
FROM PUBLIC, anon;

GRANT SELECT ON "tenants" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "organisations" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "engagements" TO authenticated;
GRANT SELECT, UPDATE ON "users" TO authenticated;
GRANT SELECT ON "roles", "permissions", "role_permissions" TO authenticated;
GRANT SELECT ON "tenant_memberships", "organisation_memberships", "engagement_memberships" TO authenticated;

-- Append-only, even for service_role: INSERT/SELECT only, ever.
GRANT SELECT, INSERT ON "audit_log" TO authenticated, service_role;
REVOKE UPDATE, DELETE ON "audit_log" FROM PUBLIC, anon, authenticated, service_role;

-- EXECUTE on the SECURITY DEFINER helper functions (§4): narrowly
-- granted, never to anon.
REVOKE EXECUTE ON FUNCTION
  public.is_active_tenant_member(uuid),
  public.is_active_organisation_member(uuid),
  public.is_active_engagement_member(uuid),
  public.can_access_organisation(uuid),
  public.can_access_engagement(uuid, uuid),
  public.can_access_tenant(uuid),
  public.shares_membership_scope(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.is_active_tenant_member(uuid),
  public.is_active_organisation_member(uuid),
  public.is_active_engagement_member(uuid),
  public.can_access_organisation(uuid),
  public.can_access_engagement(uuid, uuid),
  public.can_access_tenant(uuid),
  public.shares_membership_scope(uuid)
TO authenticated, service_role;
