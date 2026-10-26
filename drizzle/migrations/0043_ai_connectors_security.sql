-- PRIMUS PRIVACY — Migration 0043: security layer for connectors (0042).
--
--   * Connector config is visible to practice staff with an AI permission
--     and writable by ai.configure only.
--   * Secrets are NEVER selectable by any end-user role. They are written
--     through set_ai_connector_secret() (ai.configure) and read through
--     get_ai_connector_secret() (the AI agent's user only — the worker
--     decrypts them in memory to run a scan or test).
--   * Discovered assets / runs are written by the AI agent only.

CREATE TRIGGER ai_connectors_prevent_reparenting
  BEFORE UPDATE ON "ai_connectors"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ai_reparenting();
CREATE TRIGGER ai_connectors_audit_log
  AFTER INSERT OR UPDATE ON "ai_connectors"
  FOR EACH ROW EXECUTE FUNCTION public.log_methodology_change();

ALTER TABLE "ai_connectors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_connectors" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_connector_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_connector_secrets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_connector_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_connector_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_discovered_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_discovered_assets" FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_connectors_select ON "ai_connectors"
  FOR SELECT TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
CREATE POLICY ai_connectors_insert ON "ai_connectors"
  FOR INSERT TO authenticated
  WITH CHECK (public.has_engagement_permission(engagement_id, 'ai.configure'));
-- The agent may update test/run bookkeeping columns; configuration changes
-- need ai.configure.
CREATE POLICY ai_connectors_update ON "ai_connectors"
  FOR UPDATE TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  )
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );

-- Agent-only edits are limited to bookkeeping columns.
CREATE OR REPLACE FUNCTION public.guard_ai_connector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND public.has_engagement_permission(NEW.engagement_id, 'ai.agent')
     AND NOT public.has_engagement_permission(NEW.engagement_id, 'ai.configure')
     AND (NEW.connector_type IS DISTINCT FROM OLD.connector_type
          OR NEW.name IS DISTINCT FROM OLD.name
          OR NEW.config IS DISTINCT FROM OLD.config
          OR NEW.has_secret IS DISTINCT FROM OLD.has_secret)
  THEN
    RAISE EXCEPTION 'the AI agent may not change connector configuration (connector %)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.connector_type IS DISTINCT FROM OLD.connector_type THEN
    RAISE EXCEPTION 'connector_type is immutable (connector %)', OLD.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_connectors_guard
  BEFORE UPDATE ON "ai_connectors"
  FOR EACH ROW EXECUTE FUNCTION public.guard_ai_connector_update();

-- ai_connector_secrets: RLS on, NO policy, NO grant. Only the two
-- SECURITY DEFINER functions below can touch it.
REVOKE ALL ON "ai_connector_secrets" FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_ai_connector_secret(p_connector_id uuid, p_ciphertext text, p_key_version integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_engagement_id uuid;
BEGIN
  SELECT engagement_id INTO v_engagement_id FROM ai_connectors WHERE id = p_connector_id;
  IF v_engagement_id IS NULL OR NOT public.has_engagement_permission(v_engagement_id, 'ai.configure') THEN
    RAISE EXCEPTION 'not found or not permitted' USING ERRCODE = '42501';
  END IF;
  INSERT INTO ai_connector_secrets (connector_id, engagement_id, ciphertext, key_version, updated_at)
  VALUES (p_connector_id, v_engagement_id, p_ciphertext, p_key_version, now())
  ON CONFLICT (connector_id) DO UPDATE
    SET ciphertext = EXCLUDED.ciphertext, key_version = EXCLUDED.key_version, updated_at = now();
  UPDATE ai_connectors SET has_secret = true, updated_at = now() WHERE id = p_connector_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_connector_secret(p_connector_id uuid)
RETURNS TABLE (ciphertext text, key_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_engagement_id uuid;
BEGIN
  SELECT engagement_id INTO v_engagement_id FROM ai_connectors WHERE id = p_connector_id;
  IF v_engagement_id IS NULL OR NOT public.has_engagement_permission(v_engagement_id, 'ai.agent') THEN
    RAISE EXCEPTION 'not found or not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT s.ciphertext, s.key_version FROM ai_connector_secrets s WHERE s.connector_id = p_connector_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_ai_connector_secret(uuid, text, integer), public.get_ai_connector_secret(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ai_connector_secret(uuid, text, integer), public.get_ai_connector_secret(uuid) TO authenticated;

CREATE POLICY ai_connector_runs_select ON "ai_connector_runs"
  FOR SELECT TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
CREATE POLICY ai_connector_runs_insert ON "ai_connector_runs"
  FOR INSERT TO authenticated
  WITH CHECK (public.has_engagement_permission(engagement_id, 'ai.agent'));
CREATE POLICY ai_connector_runs_update ON "ai_connector_runs"
  FOR UPDATE TO authenticated
  USING (public.has_engagement_permission(engagement_id, 'ai.agent'))
  WITH CHECK (public.has_engagement_permission(engagement_id, 'ai.agent'));

CREATE POLICY ai_discovered_assets_select ON "ai_discovered_assets"
  FOR SELECT TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'ai.supervise')
    OR public.has_engagement_permission(engagement_id, 'ai.configure')
    OR public.has_engagement_permission(engagement_id, 'ai.agent')
  );
CREATE POLICY ai_discovered_assets_insert ON "ai_discovered_assets"
  FOR INSERT TO authenticated
  WITH CHECK (public.has_engagement_permission(engagement_id, 'ai.agent'));
CREATE POLICY ai_discovered_assets_update ON "ai_discovered_assets"
  FOR UPDATE TO authenticated
  USING (public.has_engagement_permission(engagement_id, 'ai.agent'))
  WITH CHECK (public.has_engagement_permission(engagement_id, 'ai.agent'));

REVOKE ALL ON "ai_connectors", "ai_connector_runs", "ai_discovered_assets" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON "ai_connectors" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "ai_connector_runs" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON "ai_discovered_assets" TO authenticated;
