-- PRIMUS PRIVACY — Migration 0026: Control Library Authoring (Slice D1).
--
-- Adds the one new resolver function this slice's dedicated
-- `methodology.manage` permission needs (`has_tenant_permission`,
-- mirroring migration 0024's `has_engagement_permission`/
-- `has_organisation_permission` exactly, one scope up: TenantMembership
-- instead of Engagement/OrganisationMembership), and narrows the six
-- Milestone-4 methodology tables' write policies (migration 0007) from
-- "any active Tenant member" (`is_active_tenant_member`) to "an active
-- Tenant member whose Role grants `methodology.manage`" — the same
-- narrowing precedent migration 0025 established for
-- `assessments_update`/`assessment.finalize`.
--
-- No new table, no new column on any existing table — direct inspection
-- (this slice's own §1) confirmed every table Control Library Authoring
-- needs already exists, fully built, since Milestone 4
-- (0006_control_library.sql / 0007_control_library_security.sql):
-- `regulatory_references`, `requirements`, `control_library_versions`,
-- `controls`, `control_requirements`, `requirement_regulatory_
-- references` — including the full draft/published/retired lifecycle,
-- publish-immutability triggers, draft-mutable guards, reparenting
-- guards, and audit-log triggers this slice's own domain layer builds
-- directly on top of, unchanged. This migration only tightens WHO may
-- write, not WHAT the write mechanism is.
--
-- SELECT policies (`can_access_tenant(tenant_id)`) are UNCHANGED —
-- read access to methodology content is not this slice's concern
-- (PRODUCT_UX_BLUEPRINT.md §8's own Permission Matrix gives the
-- "Consultant"/"Reviewer" columns "R" on Methodology; narrowing SELECT
-- here would contradict that), and this slice's own MVP scope is
-- authoring (write), per instruction.

-- =============================================================================
-- 1. has_tenant_permission — the tenant-scope resolver function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_tenant_permission(p_tenant_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_memberships tm
    JOIN role_permissions rp ON rp.role_id = tm.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
      AND p.key = p_permission_key
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_tenant_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_tenant_permission(uuid, text) TO authenticated, service_role;

-- =============================================================================
-- 2. Narrow the six methodology tables' write policies
-- =============================================================================
-- Before this migration, ANY active Tenant member (any tenant-scope
-- Role at all) could raw-SQL author/edit methodology content — the
-- same "real, live gap" shape migration 0025's own R-118 closed for
-- Assessment finalization. Today's only two seeded tenant-scope Roles
-- (Platform Administrator, Practice Partner — db/seed/roles.ts) both
-- receive `methodology.manage` (DECISIONS.md, this slice), so no
-- legitimate user's access actually narrows; a future tenant-scope
-- Role added without this permission is now correctly excluded by
-- construction, not merely by convention.

DROP POLICY "regulatory_references_insert" ON "regulatory_references";
CREATE POLICY regulatory_references_insert ON "regulatory_references" FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));
DROP POLICY "regulatory_references_update" ON "regulatory_references";
CREATE POLICY regulatory_references_update ON "regulatory_references" FOR UPDATE TO authenticated
  USING (public.has_tenant_permission(tenant_id, 'methodology.manage'))
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));

DROP POLICY "requirements_insert" ON "requirements";
CREATE POLICY requirements_insert ON "requirements" FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));
DROP POLICY "requirements_update" ON "requirements";
CREATE POLICY requirements_update ON "requirements" FOR UPDATE TO authenticated
  USING (public.has_tenant_permission(tenant_id, 'methodology.manage'))
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));

DROP POLICY "control_library_versions_insert" ON "control_library_versions";
CREATE POLICY control_library_versions_insert ON "control_library_versions" FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));
DROP POLICY "control_library_versions_update" ON "control_library_versions";
CREATE POLICY control_library_versions_update ON "control_library_versions" FOR UPDATE TO authenticated
  USING (public.has_tenant_permission(tenant_id, 'methodology.manage'))
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));

DROP POLICY "controls_insert" ON "controls";
CREATE POLICY controls_insert ON "controls" FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));
DROP POLICY "controls_update" ON "controls";
CREATE POLICY controls_update ON "controls" FOR UPDATE TO authenticated
  USING (public.has_tenant_permission(tenant_id, 'methodology.manage'))
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));
DROP POLICY "controls_delete" ON "controls";
CREATE POLICY controls_delete ON "controls" FOR DELETE TO authenticated
  USING (public.has_tenant_permission(tenant_id, 'methodology.manage'));

DROP POLICY "control_requirements_insert" ON "control_requirements";
CREATE POLICY control_requirements_insert ON "control_requirements" FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));
DROP POLICY "control_requirements_delete" ON "control_requirements";
CREATE POLICY control_requirements_delete ON "control_requirements" FOR DELETE TO authenticated
  USING (public.has_tenant_permission(tenant_id, 'methodology.manage'));

DROP POLICY "requirement_regulatory_references_insert" ON "requirement_regulatory_references";
CREATE POLICY requirement_regulatory_references_insert ON "requirement_regulatory_references" FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_permission(tenant_id, 'methodology.manage'));
DROP POLICY "requirement_regulatory_references_delete" ON "requirement_regulatory_references";
CREATE POLICY requirement_regulatory_references_delete ON "requirement_regulatory_references" FOR DELETE TO authenticated
  USING (public.has_tenant_permission(tenant_id, 'methodology.manage'));
