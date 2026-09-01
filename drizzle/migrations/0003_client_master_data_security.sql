-- PRIMUS PRIVACY — Migration 0003: security layer for the Client Master
-- Data slice (0002_client_master_data.sql).
--
-- Hand-written, not drizzle-kit generated — same rationale as migration
-- 0001 (DECISIONS.md R-02): RLS, triggers, and cross-module FKs aren't
-- modeled in the Drizzle TS schema. Deployable to a real Supabase project
-- as-is; assumes migrations 0000-0002 (and their `auth.users` dependency)
-- are already applied.

-- =============================================================================
-- 1. Audit-column foreign keys to users(id)
-- =============================================================================
-- Added here via ALTER TABLE, not in the Drizzle TS schema — same
-- circular-import reasoning as migration 0001 §1.

ALTER TABLE "business_units"
  ADD CONSTRAINT "business_units_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "business_units_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "data_principal_categories"
  ADD CONSTRAINT "data_principal_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "data_principal_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
ALTER TABLE "data_principal_category_versions"
  ADD CONSTRAINT "data_principal_category_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "personal_data_elements"
  ADD CONSTRAINT "personal_data_elements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "personal_data_elements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
ALTER TABLE "personal_data_element_versions"
  ADD CONSTRAINT "personal_data_element_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "purposes"
  ADD CONSTRAINT "purposes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "purposes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
ALTER TABLE "purpose_versions"
  ADD CONSTRAINT "purpose_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "systems"
  ADD CONSTRAINT "systems_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "systems_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
ALTER TABLE "system_versions"
  ADD CONSTRAINT "system_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "data_stores"
  ADD CONSTRAINT "data_stores_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "data_stores_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
ALTER TABLE "data_store_versions"
  ADD CONSTRAINT "data_store_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

ALTER TABLE "processors"
  ADD CONSTRAINT "processors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "processors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");
ALTER TABLE "processor_versions"
  ADD CONSTRAINT "processor_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

-- =============================================================================
-- 2. Reparenting guard — organisation_id is immutable after creation on
--    every master-data identity table, for the same reason as migration
--    0001 §2 (Milestone 1 R-19): RLS's WITH CHECK can authorize a change,
--    but can't cleanly express "this column never changes" without also
--    blocking ordinary updates by users who legitimately lack broader
--    membership. One generic function, reused across all seven identity
--    tables (they all share the exact column name `organisation_id`, so
--    no per-table function is needed here, unlike the SCD2 close-out
--    triggers in §3 below).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_master_data_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
    RAISE EXCEPTION
      'organisation_id is immutable after creation (table %, row %, old organisation %, attempted new organisation %)',
      TG_TABLE_NAME, OLD.id, OLD.organisation_id, NEW.organisation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_units_prevent_reparenting
  BEFORE UPDATE ON "business_units"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_master_data_reparenting();
CREATE TRIGGER data_principal_categories_prevent_reparenting
  BEFORE UPDATE ON "data_principal_categories"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_master_data_reparenting();
CREATE TRIGGER personal_data_elements_prevent_reparenting
  BEFORE UPDATE ON "personal_data_elements"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_master_data_reparenting();
CREATE TRIGGER purposes_prevent_reparenting
  BEFORE UPDATE ON "purposes"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_master_data_reparenting();
CREATE TRIGGER systems_prevent_reparenting
  BEFORE UPDATE ON "systems"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_master_data_reparenting();
CREATE TRIGGER data_stores_prevent_reparenting
  BEFORE UPDATE ON "data_stores"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_master_data_reparenting();
CREATE TRIGGER processors_prevent_reparenting
  BEFORE UPDATE ON "processors"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_master_data_reparenting();

-- =============================================================================
-- 3. SCD2 close-out triggers — the mechanism behind "a new version must
--    not destroy the previous version" (Milestone 2 §2/§3).
-- =============================================================================
-- Each function runs BEFORE INSERT on its version table: if the row
-- being inserted is current (`NEW.is_current`), it first flips whatever
-- row was previously current for that same identity to
-- `is_current = false, valid_to = NEW.valid_from` — and *only* those two
-- bookkeeping columns; every descriptive column on the old row is
-- untouched. Running BEFORE the new row's own INSERT (rather than AFTER)
-- means the old row is already non-current by the time the new row's own
-- INSERT is checked against the `one_current_key` partial unique index,
-- so no transient two-current-rows state — and no deferred-constraint
-- trickery — is ever needed.
--
-- SECURITY DEFINER (owned by the migration-running superuser) so this
-- works regardless of the inserting role's own grants: `authenticated`
-- has SELECT+INSERT on version tables but deliberately no UPDATE grant
-- at all (§6-7 below) — the ONLY way a version row's lifecycle columns
-- ever change is through this trigger, never through a direct
-- application UPDATE. That is what makes historical immutability a
-- database-enforced property, not an application convention.

CREATE OR REPLACE FUNCTION public.close_out_previous_data_principal_category_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE data_principal_category_versions
    SET is_current = false, valid_to = NEW.valid_from
    WHERE data_principal_category_id = NEW.data_principal_category_id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER data_principal_category_versions_close_out_previous
  BEFORE INSERT ON "data_principal_category_versions"
  FOR EACH ROW EXECUTE FUNCTION public.close_out_previous_data_principal_category_version();

CREATE OR REPLACE FUNCTION public.close_out_previous_personal_data_element_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE personal_data_element_versions
    SET is_current = false, valid_to = NEW.valid_from
    WHERE personal_data_element_id = NEW.personal_data_element_id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER personal_data_element_versions_close_out_previous
  BEFORE INSERT ON "personal_data_element_versions"
  FOR EACH ROW EXECUTE FUNCTION public.close_out_previous_personal_data_element_version();

CREATE OR REPLACE FUNCTION public.close_out_previous_purpose_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE purpose_versions
    SET is_current = false, valid_to = NEW.valid_from
    WHERE purpose_id = NEW.purpose_id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purpose_versions_close_out_previous
  BEFORE INSERT ON "purpose_versions"
  FOR EACH ROW EXECUTE FUNCTION public.close_out_previous_purpose_version();

CREATE OR REPLACE FUNCTION public.close_out_previous_system_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE system_versions
    SET is_current = false, valid_to = NEW.valid_from
    WHERE system_id = NEW.system_id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER system_versions_close_out_previous
  BEFORE INSERT ON "system_versions"
  FOR EACH ROW EXECUTE FUNCTION public.close_out_previous_system_version();

CREATE OR REPLACE FUNCTION public.close_out_previous_data_store_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE data_store_versions
    SET is_current = false, valid_to = NEW.valid_from
    WHERE data_store_id = NEW.data_store_id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER data_store_versions_close_out_previous
  BEFORE INSERT ON "data_store_versions"
  FOR EACH ROW EXECUTE FUNCTION public.close_out_previous_data_store_version();

CREATE OR REPLACE FUNCTION public.close_out_previous_processor_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE processor_versions
    SET is_current = false, valid_to = NEW.valid_from
    WHERE processor_id = NEW.processor_id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER processor_versions_close_out_previous
  BEFORE INSERT ON "processor_versions"
  FOR EACH ROW EXECUTE FUNCTION public.close_out_previous_processor_version();

-- =============================================================================
-- 4. Enable RLS (FORCE, matching migration 0001's posture — defense in
--    depth; service_role's BYPASSRLS is the only intended bypass, and
--    even it is still subject to the GRANT restrictions in §7).
-- =============================================================================

ALTER TABLE "business_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "data_principal_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_principal_categories" FORCE ROW LEVEL SECURITY;
ALTER TABLE "data_principal_category_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_principal_category_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "personal_data_elements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_data_elements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "personal_data_element_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personal_data_element_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "purposes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purposes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "purpose_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purpose_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "systems" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "systems" FORCE ROW LEVEL SECURITY;
ALTER TABLE "system_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "data_stores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_stores" FORCE ROW LEVEL SECURITY;
ALTER TABLE "data_store_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_store_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "processors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processors" FORCE ROW LEVEL SECURITY;
ALTER TABLE "processor_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processor_versions" FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 5. Policies
-- =============================================================================
-- Reuses `public.can_access_organisation(uuid)` from migration 0001
-- unchanged (Milestone 2 instructions §14: "Reuse the existing
-- authorization helpers... do not create a second competing
-- authorization mechanism"). Every version table's `organisation_id` is
-- its own direct column (§1-3 above), so every policy here evaluates
-- `can_access_organisation(organisation_id)` with **no subquery back
-- into the table it's protecting** — deliberately avoiding the exact
-- self-referential-subquery-during-RETURNING bug migration 0001 found
-- and fixed in `can_access_engagement` (DECISIONS.md).
--
-- Identity tables: SELECT/INSERT/UPDATE (status/name-level edits;
-- organisation_id changes are blocked by the §2 trigger regardless of
-- what this WITH CHECK allows). No DELETE policy — master data is
-- retired via `status`, never hard-deleted.
--
-- Version tables: SELECT/INSERT only. No UPDATE policy for
-- `authenticated` at all — creating a new version is how you "edit" a
-- version; there is no application path to mutate an existing one's
-- descriptive fields (see §3's comment). No DELETE policy.

CREATE POLICY business_units_select ON "business_units" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY business_units_insert ON "business_units" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY business_units_update ON "business_units" FOR UPDATE TO authenticated USING (public.can_access_organisation(organisation_id)) WITH CHECK (public.can_access_organisation(organisation_id));

CREATE POLICY data_principal_categories_select ON "data_principal_categories" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY data_principal_categories_insert ON "data_principal_categories" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY data_principal_categories_update ON "data_principal_categories" FOR UPDATE TO authenticated USING (public.can_access_organisation(organisation_id)) WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY data_principal_category_versions_select ON "data_principal_category_versions" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY data_principal_category_versions_insert ON "data_principal_category_versions" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));

CREATE POLICY personal_data_elements_select ON "personal_data_elements" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY personal_data_elements_insert ON "personal_data_elements" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY personal_data_elements_update ON "personal_data_elements" FOR UPDATE TO authenticated USING (public.can_access_organisation(organisation_id)) WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY personal_data_element_versions_select ON "personal_data_element_versions" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY personal_data_element_versions_insert ON "personal_data_element_versions" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));

CREATE POLICY purposes_select ON "purposes" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY purposes_insert ON "purposes" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY purposes_update ON "purposes" FOR UPDATE TO authenticated USING (public.can_access_organisation(organisation_id)) WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY purpose_versions_select ON "purpose_versions" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY purpose_versions_insert ON "purpose_versions" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));

CREATE POLICY systems_select ON "systems" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY systems_insert ON "systems" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY systems_update ON "systems" FOR UPDATE TO authenticated USING (public.can_access_organisation(organisation_id)) WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY system_versions_select ON "system_versions" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY system_versions_insert ON "system_versions" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));

CREATE POLICY data_stores_select ON "data_stores" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY data_stores_insert ON "data_stores" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY data_stores_update ON "data_stores" FOR UPDATE TO authenticated USING (public.can_access_organisation(organisation_id)) WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY data_store_versions_select ON "data_store_versions" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY data_store_versions_insert ON "data_store_versions" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));

CREATE POLICY processors_select ON "processors" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY processors_insert ON "processors" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY processors_update ON "processors" FOR UPDATE TO authenticated USING (public.can_access_organisation(organisation_id)) WITH CHECK (public.can_access_organisation(organisation_id));
CREATE POLICY processor_versions_select ON "processor_versions" FOR SELECT TO authenticated USING (public.can_access_organisation(organisation_id));
CREATE POLICY processor_versions_insert ON "processor_versions" FOR INSERT TO authenticated WITH CHECK (public.can_access_organisation(organisation_id));

-- =============================================================================
-- 6. Auditability — Milestone 2 instructions §15: "Material creation,
--    modification, version creation and retirement/deactivation must be
--    auditable." One generic trigger function, reused across all 13
--    master-data tables: every one of them carries `organisation_id`
--    directly (identity tables their own; version tables the same
--    denormalized column used throughout this migration), so a single
--    function can resolve the owning tenant and log the change without
--    any table-specific logic. SECURITY DEFINER so it can always write
--    to `audit_log` regardless of the calling role's own grants there —
--    exactly like migration 0001's `handle_new_auth_user`.
--
--    Attached AFTER INSERT OR UPDATE on identity tables (creation,
--    ordinary modification, and retirement — a `status = 'retired'`
--    change is just an UPDATE, captured generically) and AFTER INSERT
--    only on version tables (a new version row is what "modifying" a
--    version-tracked entity means; the close-out trigger's own internal
--    UPDATE of the just-superseded row is mechanical bookkeeping already
--    implied by the new version's own audit entry, so it is not
--    separately logged — see DECISIONS.md).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.log_master_data_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM organisations WHERE id = NEW.organisation_id;
  IF v_tenant_id IS NULL THEN
    -- Should be unreachable given the organisation_id FK every one of
    -- these tables carries; never let an audit-logging problem block the
    -- underlying write.
    RETURN NEW;
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

CREATE TRIGGER business_units_audit_log AFTER INSERT OR UPDATE ON "business_units" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER data_principal_categories_audit_log AFTER INSERT OR UPDATE ON "data_principal_categories" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER data_principal_category_versions_audit_log AFTER INSERT ON "data_principal_category_versions" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER personal_data_elements_audit_log AFTER INSERT OR UPDATE ON "personal_data_elements" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER personal_data_element_versions_audit_log AFTER INSERT ON "personal_data_element_versions" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER purposes_audit_log AFTER INSERT OR UPDATE ON "purposes" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER purpose_versions_audit_log AFTER INSERT ON "purpose_versions" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER systems_audit_log AFTER INSERT OR UPDATE ON "systems" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER system_versions_audit_log AFTER INSERT ON "system_versions" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER data_stores_audit_log AFTER INSERT OR UPDATE ON "data_stores" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER data_store_versions_audit_log AFTER INSERT ON "data_store_versions" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER processors_audit_log AFTER INSERT OR UPDATE ON "processors" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();
CREATE TRIGGER processor_versions_audit_log AFTER INSERT ON "processor_versions" FOR EACH ROW EXECUTE FUNCTION public.log_master_data_change();

-- =============================================================================
-- 7. Table-level GRANTs
-- =============================================================================
-- Same belt-and-suspenders posture as migration 0001 §7: `anon` gets
-- nothing on any Milestone 2 table.

REVOKE ALL ON
  "business_units",
  "data_principal_categories", "data_principal_category_versions",
  "personal_data_elements", "personal_data_element_versions",
  "purposes", "purpose_versions",
  "systems", "system_versions",
  "data_stores", "data_store_versions",
  "processors", "processor_versions"
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON
  "business_units",
  "data_principal_categories",
  "personal_data_elements",
  "purposes",
  "systems",
  "data_stores",
  "processors"
TO authenticated;

-- Version tables: SELECT + INSERT only — no UPDATE grant at all, so even
-- a bug in a future policy couldn't allow `authenticated` to rewrite a
-- version's descriptive fields; only the SECURITY DEFINER close-out
-- trigger (owned by the migration-running role, not `authenticated`)
-- can ever change a version row after it's inserted.
GRANT SELECT, INSERT ON
  "data_principal_category_versions",
  "personal_data_element_versions",
  "purpose_versions",
  "system_versions",
  "data_store_versions",
  "processor_versions"
TO authenticated;
