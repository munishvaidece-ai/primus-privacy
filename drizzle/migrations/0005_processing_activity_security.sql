-- PRIMUS PRIVACY — Migration 0005: security layer for Processing
-- Activity & the Version-Pinned Junction Layer (0004_processing_activity.sql).
--
-- Hand-written, not drizzle-kit generated — same rationale as migrations
-- 0001 and 0003 (DECISIONS.md R-02). Deployable to a real Supabase
-- project as-is; assumes migrations 0000-0004 are already applied.

-- =============================================================================
-- 1. Audit-column foreign keys to users(id)
-- =============================================================================
-- Added here via ALTER TABLE, not in the Drizzle TS schema — same
-- circular-import reasoning as every earlier milestone's audit columns
-- (tenants.ts, etc.). `processing_activities.owner_user_id` did NOT need
-- this treatment — it's a direct Drizzle `.references()` in migration
-- 0004 already, since no cycle exists there (see
-- db/schema/processing-activities.ts).

ALTER TABLE "processing_activities"
  ADD CONSTRAINT "processing_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "processing_activities_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "processing_activity_data_principal_categories"
  ADD CONSTRAINT "pa_data_principal_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "processing_activity_personal_data_elements"
  ADD CONSTRAINT "pa_personal_data_elements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "processing_activity_purposes"
  ADD CONSTRAINT "pa_purposes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "processing_activity_systems"
  ADD CONSTRAINT "pa_systems_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "processing_activity_data_stores"
  ADD CONSTRAINT "pa_data_stores_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "processing_activity_processors"
  ADD CONSTRAINT "pa_processors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

-- =============================================================================
-- 2. Reparenting guard — engagement_id/organisation_id/tenant_id are
--    immutable after creation on `processing_activities`, for the same
--    reason as every earlier milestone's reparenting guards (Milestone 1
--    R-19, Milestone 2 R-31): RLS's WITH CHECK can authorize a change but
--    can't cleanly express "these columns never change" without also
--    blocking ordinary updates (name, description, lifecycle_status,
--    business_unit_id, owner_user_id — all legitimately mutable) by users
--    who have real access to the row. `business_unit_id` is deliberately
--    NOT protected here — reassigning a processing activity to a
--    different business unit within the SAME organisation is an ordinary
--    business change, not "reparenting" in the tenant/org/engagement
--    sense this guard exists to prevent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_processing_activity_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION
      'processing_activities.{engagement_id,organisation_id,tenant_id} are immutable after creation (processing activity %)',
      OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER processing_activities_prevent_reparenting
  BEFORE UPDATE ON "processing_activities"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_processing_activity_reparenting();

-- =============================================================================
-- 3. Auditability — Milestone 3 instructions §9: creation, modification,
--    status change, carry-forward, relationship changes, and retirement
--    must all be auditable.
-- =============================================================================
-- `processing_activities` reuses migration 0003's `log_master_data_change()`
-- unchanged (AFTER INSERT OR UPDATE) — it already generalizes via
-- `organisation_id`/`NEW.id`/`TG_TABLE_NAME`, so no new function is
-- needed. This alone covers creation, ordinary modification, status
-- change (an UPDATE like any other), retirement (a status UPDATE to
-- 'retired'), and carry-forward (an INSERT whose field_changes JSON
-- includes the new row's `carried_forward_from_id`) — see PROGRESS.md.
CREATE TRIGGER processing_activities_audit_log
  AFTER INSERT OR UPDATE ON "processing_activities"
  FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();

-- Junction tables are never updated in place (DATA_MODEL.md §5.3's
-- version-pinned links are facts asserted once; changing which version
-- applies means removing the old link and adding a new one, not editing
-- one row — see §6/§7 below). "Relationship changes" are therefore
-- captured as INSERT (a link created) and DELETE (a link removed)
-- events. `log_master_data_change()` can't handle DELETE (it reads
-- `NEW`, which is null for a DELETE trigger) — a small, generic variant
-- that resolves the acting row from `NEW` or `OLD` depending on `TG_OP`.
CREATE OR REPLACE FUNCTION public.log_processing_activity_relationship_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_row_id uuid;
  v_organisation_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row_id := OLD.id;
    v_organisation_id := OLD.organisation_id;
  ELSE
    v_row_id := NEW.id;
    v_organisation_id := NEW.organisation_id;
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM organisations WHERE id = v_organisation_id;
  IF v_tenant_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO audit_log (tenant_id, actor_user_id, entity_type, entity_id, action, field_changes)
  VALUES (
    v_tenant_id,
    auth.uid(),
    TG_TABLE_NAME,
    v_row_id,
    lower(TG_OP)::audit_action,
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER pa_data_principal_categories_audit_log AFTER INSERT OR DELETE ON "processing_activity_data_principal_categories" FOR EACH ROW EXECUTE FUNCTION public.log_processing_activity_relationship_change();
CREATE TRIGGER pa_personal_data_elements_audit_log AFTER INSERT OR DELETE ON "processing_activity_personal_data_elements" FOR EACH ROW EXECUTE FUNCTION public.log_processing_activity_relationship_change();
CREATE TRIGGER pa_purposes_audit_log AFTER INSERT OR DELETE ON "processing_activity_purposes" FOR EACH ROW EXECUTE FUNCTION public.log_processing_activity_relationship_change();
CREATE TRIGGER pa_systems_audit_log AFTER INSERT OR DELETE ON "processing_activity_systems" FOR EACH ROW EXECUTE FUNCTION public.log_processing_activity_relationship_change();
CREATE TRIGGER pa_data_stores_audit_log AFTER INSERT OR DELETE ON "processing_activity_data_stores" FOR EACH ROW EXECUTE FUNCTION public.log_processing_activity_relationship_change();
CREATE TRIGGER pa_processors_audit_log AFTER INSERT OR DELETE ON "processing_activity_processors" FOR EACH ROW EXECUTE FUNCTION public.log_processing_activity_relationship_change();

-- =============================================================================
-- 4. Enable RLS (FORCE, matching the posture established since migration 0001).
-- =============================================================================

ALTER TABLE "processing_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_activities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_data_principal_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_data_principal_categories" FORCE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_personal_data_elements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_personal_data_elements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_purposes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_purposes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_systems" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_systems" FORCE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_data_stores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_data_stores" FORCE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_processors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_activity_processors" FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 5. Policies
-- =============================================================================
-- Reuses `public.can_access_engagement(uuid, uuid)` from migration 0001
-- unchanged (Milestone 3 instructions §8: "Reuse the existing
-- authorization helpers. Do NOT create a second authorization
-- framework."). Every row here carries both `engagement_id` and
-- `organisation_id` directly (§1-2 above / migration 0004), so every
-- policy evaluates `can_access_engagement(engagement_id,
-- organisation_id)` with no subquery back into the table it protects —
-- the same discipline as every table since Milestone 1's
-- `can_access_engagement` fix.

CREATE POLICY processing_activities_select ON "processing_activities"
  FOR SELECT TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY processing_activities_insert ON "processing_activities"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));

-- engagement_id/organisation_id/tenant_id changes are blocked
-- unconditionally by the §2 trigger regardless of what this allows.
CREATE POLICY processing_activities_update ON "processing_activities"
  FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));

-- No DELETE policy — Processing Activities are retired via
-- `lifecycle_status`, never hard-deleted (matching every master-data
-- identity table since Milestone 2).

-- Junction tables: SELECT/INSERT/DELETE (relationship changes are
-- delete-then-insert, not update-in-place — §3 above). No UPDATE policy
-- for `authenticated` at all, matching Milestone 2's version-table
-- posture for the same reason.
CREATE POLICY pa_data_principal_categories_select ON "processing_activity_data_principal_categories" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_data_principal_categories_insert ON "processing_activity_data_principal_categories" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_data_principal_categories_delete ON "processing_activity_data_principal_categories" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY pa_personal_data_elements_select ON "processing_activity_personal_data_elements" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_personal_data_elements_insert ON "processing_activity_personal_data_elements" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_personal_data_elements_delete ON "processing_activity_personal_data_elements" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY pa_purposes_select ON "processing_activity_purposes" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_purposes_insert ON "processing_activity_purposes" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_purposes_delete ON "processing_activity_purposes" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY pa_systems_select ON "processing_activity_systems" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_systems_insert ON "processing_activity_systems" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_systems_delete ON "processing_activity_systems" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY pa_data_stores_select ON "processing_activity_data_stores" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_data_stores_insert ON "processing_activity_data_stores" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_data_stores_delete ON "processing_activity_data_stores" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

CREATE POLICY pa_processors_select ON "processing_activity_processors" FOR SELECT TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_processors_insert ON "processing_activity_processors" FOR INSERT TO authenticated WITH CHECK (public.can_access_engagement(engagement_id, organisation_id));
CREATE POLICY pa_processors_delete ON "processing_activity_processors" FOR DELETE TO authenticated USING (public.can_access_engagement(engagement_id, organisation_id));

-- =============================================================================
-- 6. Table-level GRANTs
-- =============================================================================
-- Same belt-and-suspenders posture as every earlier milestone: `anon`
-- gets nothing on any Milestone 3 table.

REVOKE ALL ON
  "processing_activities",
  "processing_activity_data_principal_categories",
  "processing_activity_personal_data_elements",
  "processing_activity_purposes",
  "processing_activity_systems",
  "processing_activity_data_stores",
  "processing_activity_processors"
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON "processing_activities" TO authenticated;

GRANT SELECT, INSERT, DELETE ON
  "processing_activity_data_principal_categories",
  "processing_activity_personal_data_elements",
  "processing_activity_purposes",
  "processing_activity_systems",
  "processing_activity_data_stores",
  "processing_activity_processors"
TO authenticated;
