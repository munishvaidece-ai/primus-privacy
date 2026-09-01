-- PRIMUS PRIVACY — Migration 0007: security layer for Regulatory Content
-- & the Control Library (0006_control_library.sql).
--
-- Hand-written, not drizzle-kit generated — same rationale as migrations
-- 0001, 0003, and 0005 (DECISIONS.md R-02): RLS, triggers, and
-- cross-module immutability rules aren't modeled in the Drizzle TS
-- schema. Deployable to a real Supabase project as-is; assumes
-- migrations 0000-0006 are already applied.

-- =============================================================================
-- 1. Audit-column foreign keys to users(id)
-- =============================================================================
-- Added here via ALTER TABLE, not in the Drizzle TS schema — same
-- circular-import reasoning as every earlier milestone's audit columns.

ALTER TABLE "regulatory_references"
  ADD CONSTRAINT "regulatory_references_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "regulatory_references_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "requirements"
  ADD CONSTRAINT "requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "requirements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "control_library_versions"
  ADD CONSTRAINT "control_library_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "control_library_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "controls"
  ADD CONSTRAINT "controls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  ADD CONSTRAINT "controls_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id");

ALTER TABLE "control_requirements"
  ADD CONSTRAINT "control_requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");
ALTER TABLE "requirement_regulatory_references"
  ADD CONSTRAINT "requirement_regulatory_references_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id");

-- =============================================================================
-- 2. Reparenting guard — tenant_id is immutable after creation on every
--    methodology identity table, for the same reason as every earlier
--    milestone's reparenting guards (Milestone 1 R-19, Milestone 2 R-31,
--    Milestone 3 §2): RLS's WITH CHECK can authorize a change but can't
--    cleanly express "this column never changes" without also blocking
--    ordinary updates by users who legitimately have write access. One
--    generic function reused across all four identity tables — they all
--    share the exact column name `tenant_id`, so no per-table function is
--    needed here, matching migration 0003's `prevent_master_data_
--    reparenting()` but keyed on `tenant_id` (the Practice boundary) not
--    `organisation_id` (the client boundary) — see DECISIONS.md.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_methodology_reparenting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION
      'tenant_id is immutable after creation (table %, row %, old tenant %, attempted new tenant %)',
      TG_TABLE_NAME, OLD.id, OLD.tenant_id, NEW.tenant_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER regulatory_references_prevent_reparenting
  BEFORE UPDATE ON "regulatory_references"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_methodology_reparenting();
CREATE TRIGGER requirements_prevent_reparenting
  BEFORE UPDATE ON "requirements"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_methodology_reparenting();
CREATE TRIGGER control_library_versions_prevent_reparenting
  BEFORE UPDATE ON "control_library_versions"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_methodology_reparenting();
CREATE TRIGGER controls_prevent_reparenting
  BEFORE UPDATE ON "controls"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_methodology_reparenting();

-- =============================================================================
-- 3. Engagement.control_library_version_id pin guard — Milestone 4
--    instructions: the pin must (a) reference a published or retired
--    version, never a draft (a draft's content isn't final and may still
--    change), and (b) be immutable once set, so "which methodology this
--    engagement used" can never be silently rewritten after the fact —
--    the same historical-reproducibility guarantee the milestone brief
--    asks for, applied at the Engagement side of the relationship.
--    Setting it for the first time (from NULL) is allowed; changing an
--    already-set pin is not, even to another published version.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_engagement_control_library_pin_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status control_library_version_status;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.control_library_version_id IS NOT NULL
     AND NEW.control_library_version_id IS DISTINCT FROM OLD.control_library_version_id THEN
    RAISE EXCEPTION
      'engagements.control_library_version_id is immutable once set (engagement %, currently pinned to %)',
      OLD.id, OLD.control_library_version_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.control_library_version_id IS NOT NULL THEN
    SELECT status INTO v_status FROM control_library_versions WHERE id = NEW.control_library_version_id;
    IF v_status = 'draft' THEN
      RAISE EXCEPTION
        'an Engagement cannot pin to a draft control library version (version %, engagement %)',
        NEW.control_library_version_id, NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER engagements_prevent_control_library_pin_change
  BEFORE INSERT OR UPDATE ON "engagements"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_engagement_control_library_pin_change();

-- =============================================================================
-- 4. ControlLibraryVersion publish/immutability guard — Milestone 4
--    instructions: "published methodology cannot be modified through
--    ordinary application paths"; keep transition rules simple.
--
--    Rules (deliberately simple, not a workflow engine):
--    - draft   -> published : allowed; published_at is stamped by this
--                              trigger the moment it happens (not settable
--                              directly by the application).
--    - draft   -> retired   : blocked — a version must be published before
--                              it can be retired (retiring a draft that
--                              was never offered to any Engagement has no
--                              meaning here; document as a simplification).
--    - published -> retired : allowed; the only transition a published
--                              version may ever make.
--    - published -> draft   : blocked (no un-publishing).
--    - retired   -> *       : blocked unconditionally (retired is terminal).
--    - status unchanged, but version_label/other descriptive fields
--      edited while status IN ('published','retired'): blocked — this is
--      the actual "content is immutable" enforcement; while status =
--      'draft', ordinary edits are unrestricted.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_control_library_version_tampering()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION
      'a retired control library version is immutable (version %)', OLD.id
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'published' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IS DISTINCT FROM 'retired' THEN
        RAISE EXCEPTION
          'a published control library version may only transition to retired (attempted %, version %)',
          NEW.status, OLD.id
          USING ERRCODE = '23514';
      END IF;
    END IF;
    -- Whether staying published or moving to retired in this same UPDATE,
    -- no descriptive field may change alongside it.
    IF NEW.version_label IS DISTINCT FROM OLD.version_label
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION
        'a published control library version''s content is immutable (version %)', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.status = 'draft' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION
        'a draft control library version may only transition to published (attempted %, version %)',
        NEW.status, OLD.id
        USING ERRCODE = '23514';
    END IF;
    IF NEW.published_at IS NULL THEN
      NEW.published_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER control_library_versions_prevent_tampering
  BEFORE UPDATE ON "control_library_versions"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_control_library_version_tampering();

-- =============================================================================
-- 5. Control draft-mutable guard — the mechanism that makes a published
--    library's Controls immutable, not just the ControlLibraryVersion row
--    itself. A Control may only be INSERTed, UPDATEd, or DELETEd while its
--    owning ControlLibraryVersion is still 'draft'; its
--    control_library_version_id is also immutable once set (a Control
--    never migrates between library versions — DATA_MODEL.md §6/
--    DECISIONS.md).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_control_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status control_library_version_status;
  v_version_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_version_id := OLD.control_library_version_id;
  ELSE
    v_version_id := NEW.control_library_version_id;
    IF TG_OP = 'UPDATE' AND NEW.control_library_version_id IS DISTINCT FROM OLD.control_library_version_id THEN
      RAISE EXCEPTION
        'controls.control_library_version_id is immutable after creation (control %)', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT status INTO v_status FROM control_library_versions WHERE id = v_version_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'cannot % a control belonging to a % control library version (version %)',
      TG_OP, v_status, v_version_id
      USING ERRCODE = '23514';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER controls_enforce_draft_mutable
  BEFORE INSERT OR UPDATE OR DELETE ON "controls"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_control_draft_mutable();

-- =============================================================================
-- 6. ControlRequirement draft-mutable guard — same rule, one level down:
--    a control-requirement mapping may only be created or removed while
--    the Control side belongs to a 'draft' library version. This is what
--    keeps a *published* version's mappings frozen even though the
--    junction row itself carries no status of its own.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_control_requirement_draft_mutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status control_library_version_status;
  v_control_id uuid;
BEGIN
  v_control_id := COALESCE(NEW.control_id, OLD.control_id);
  SELECT clv.status INTO v_status
    FROM controls c
    JOIN control_library_versions clv ON clv.id = c.control_library_version_id
    WHERE c.id = v_control_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'cannot % a control-requirement mapping for a control in a % control library version (control %)',
      TG_OP, v_status, v_control_id
      USING ERRCODE = '23514';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER control_requirements_enforce_draft_mutable
  BEFORE INSERT OR DELETE ON "control_requirements"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_control_requirement_draft_mutable();

-- =============================================================================
-- 7. Enable RLS (FORCE, matching the posture established since migration 0001).
-- =============================================================================

ALTER TABLE "regulatory_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_references" FORCE ROW LEVEL SECURITY;
ALTER TABLE "requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requirements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "control_library_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "control_library_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "controls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "controls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "control_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "control_requirements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "requirement_regulatory_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requirement_regulatory_references" FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 8. Policies
-- =============================================================================
-- Reuses `public.can_access_tenant(uuid)` and `public.is_active_tenant_
-- member(uuid)` from migration 0001 unchanged (Milestone 4 instructions:
-- "reuse the existing authorization framework — no second mechanism").
-- Every row here carries `tenant_id` directly (§1-2 above / migration
-- 0006), so every policy evaluates against a column on the row itself —
-- no subquery back into the table it protects.
--
-- Deliberate read/write asymmetry, a Milestone 4 design decision
-- (DECISIONS.md): SELECT uses `can_access_tenant` (anyone with a
-- legitimate foothold anywhere in the tenant — including engagement
-- consultants who need to read the methodology their engagement runs
-- against) but INSERT/UPDATE use the narrower `is_active_tenant_member`
-- (only practice-level members may author or change methodology
-- content — this is practice governance, not ordinary engagement work,
-- and every write path here also feeds the publish-immutability
-- guarantee above).

CREATE POLICY regulatory_references_select ON "regulatory_references" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY regulatory_references_insert ON "regulatory_references" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
CREATE POLICY regulatory_references_update ON "regulatory_references" FOR UPDATE TO authenticated USING (public.is_active_tenant_member(tenant_id)) WITH CHECK (public.is_active_tenant_member(tenant_id));
-- No DELETE policy — retired via `status`, never hard-deleted.

CREATE POLICY requirements_select ON "requirements" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY requirements_insert ON "requirements" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
CREATE POLICY requirements_update ON "requirements" FOR UPDATE TO authenticated USING (public.is_active_tenant_member(tenant_id)) WITH CHECK (public.is_active_tenant_member(tenant_id));

CREATE POLICY control_library_versions_select ON "control_library_versions" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY control_library_versions_insert ON "control_library_versions" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
-- UPDATE is how status/publishing transitions happen — §4's trigger is
-- what actually restricts which transitions succeed, independent of this
-- policy's own tenant-membership check.
CREATE POLICY control_library_versions_update ON "control_library_versions" FOR UPDATE TO authenticated USING (public.is_active_tenant_member(tenant_id)) WITH CHECK (public.is_active_tenant_member(tenant_id));

CREATE POLICY controls_select ON "controls" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY controls_insert ON "controls" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
CREATE POLICY controls_update ON "controls" FOR UPDATE TO authenticated USING (public.is_active_tenant_member(tenant_id)) WITH CHECK (public.is_active_tenant_member(tenant_id));
CREATE POLICY controls_delete ON "controls" FOR DELETE TO authenticated USING (public.is_active_tenant_member(tenant_id));

-- Junction tables: SELECT/INSERT/DELETE (relationship changes are
-- delete-then-insert, not update-in-place — matching every junction
-- table since Milestone 3). No UPDATE policy/grant for `authenticated`.
CREATE POLICY control_requirements_select ON "control_requirements" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY control_requirements_insert ON "control_requirements" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
CREATE POLICY control_requirements_delete ON "control_requirements" FOR DELETE TO authenticated USING (public.is_active_tenant_member(tenant_id));

CREATE POLICY requirement_regulatory_references_select ON "requirement_regulatory_references" FOR SELECT TO authenticated USING (public.can_access_tenant(tenant_id));
CREATE POLICY requirement_regulatory_references_insert ON "requirement_regulatory_references" FOR INSERT TO authenticated WITH CHECK (public.is_active_tenant_member(tenant_id));
CREATE POLICY requirement_regulatory_references_delete ON "requirement_regulatory_references" FOR DELETE TO authenticated USING (public.is_active_tenant_member(tenant_id));

-- =============================================================================
-- 9. Auditability — Milestone 4 instructions: creation, draft
--    modification, publishing, retirement, version creation, and mapping
--    changes must all be auditable, reusing the existing audit-log
--    architecture.
-- =============================================================================
-- A new function, not a reuse of migration 0003's `log_master_data_
-- change()`: that function resolves the owning tenant via `organisations`
-- from `NEW.organisation_id`, which none of these tables have — they
-- carry `tenant_id` directly, so the lookup is unnecessary, not just
-- differently-shaped. `TG_TABLE_NAME`/`NEW.id`/`lower(TG_OP)` generalize
-- exactly as before.

CREATE OR REPLACE FUNCTION public.log_methodology_change()
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
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW)) ELSE to_jsonb(NEW) END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER regulatory_references_audit_log AFTER INSERT OR UPDATE ON "regulatory_references" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER requirements_audit_log AFTER INSERT OR UPDATE ON "requirements" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
-- Covers creation, publishing, and retirement alike — each is just an
-- INSERT or UPDATE on this table; §4's trigger already guarantees only
-- the legitimate transitions ever reach here.
CREATE TRIGGER control_library_versions_audit_log AFTER INSERT OR UPDATE ON "control_library_versions" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();
CREATE TRIGGER controls_audit_log AFTER INSERT OR UPDATE ON "controls" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

-- Junction tables: insert/delete only (§6 above), so `log_master_data_
-- change()`'s UPDATE-shaped `field_changes` doesn't apply and `NEW` is
-- null on DELETE — reuses the DELETE-aware pattern migration 0005
-- established (`log_processing_activity_relationship_change()`), adapted
-- to read `tenant_id` directly instead of resolving it via organisations.
CREATE OR REPLACE FUNCTION public.log_methodology_relationship_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row_id uuid;
  v_tenant_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row_id := OLD.id;
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_row_id := NEW.id;
    v_tenant_id := NEW.tenant_id;
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

CREATE TRIGGER control_requirements_audit_log AFTER INSERT OR DELETE ON "control_requirements" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();
CREATE TRIGGER requirement_regulatory_references_audit_log AFTER INSERT OR DELETE ON "requirement_regulatory_references" FOR EACH ROW EXECUTE FUNCTION public.log_methodology_relationship_change();

-- =============================================================================
-- 10. Table-level GRANTs
-- =============================================================================
-- Same belt-and-suspenders posture as every earlier milestone: `anon`
-- gets nothing on any Milestone 4 table.

REVOKE ALL ON
  "regulatory_references",
  "requirements",
  "control_library_versions",
  "controls",
  "control_requirements",
  "requirement_regulatory_references"
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON
  "regulatory_references",
  "requirements",
  "control_library_versions"
TO authenticated;

-- `controls` additionally gets DELETE — §5's trigger is the actual
-- backstop; the grant only decides whether the attempt reaches that far.
GRANT SELECT, INSERT, UPDATE, DELETE ON "controls" TO authenticated;

GRANT SELECT, INSERT, DELETE ON
  "control_requirements",
  "requirement_regulatory_references"
TO authenticated;
