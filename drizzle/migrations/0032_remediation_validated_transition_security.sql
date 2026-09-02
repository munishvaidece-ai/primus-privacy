-- PRIMUS PRIVACY — Migration 0032: close the RemediationAction
-- self-validation gap (P2A.1).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- prior security/hardening migration (DECISIONS.md R-02): RLS policy
-- narrowing isn't modeled in the Drizzle TS schema. Assumes migrations
-- 0000-0031 are already applied.
--
-- P2A's own final report flagged a second, narrower self-validation
-- surface it had deliberately left open (DECISIONS.md R-151):
-- `RemediationAction.status = 'validated'` was directly settable through
-- the ordinary `remediation_actions_update`/`_insert` policies (still the
-- broad `can_access_engagement` check — any active engagement member,
-- client-side roles included), even though DATA_MODEL.md §8 and
-- `validation-records.ts`'s own header define "validated" as exactly
-- the consultant-validation decision `ValidationRecord` creation makes
-- explicit. See DECISIONS.md R-154.
--
-- This migration adds ONE additional WITH CHECK condition to
-- `remediation_actions_insert`/`_update` — the row being written may
-- carry `status = 'validated'` only if the actor holds `validation.perform`
-- (the same permission `validation_records_insert`, migration 0031,
-- already requires). Every other status value, and every other column
-- on this table, is completely unaffected: the pre-existing broad
-- `can_access_engagement` check is kept, not replaced, for everything
-- else — a client retains full, ordinary remediation participation.
-- USING (the read-for-update visibility check) is unchanged.

DROP POLICY IF EXISTS remediation_actions_insert ON "remediation_actions";
CREATE POLICY remediation_actions_insert ON "remediation_actions" FOR INSERT TO authenticated WITH CHECK (
  public.can_access_engagement(engagement_id, organisation_id)
  AND (
    status <> 'validated'
    OR public.has_engagement_permission(engagement_id, 'validation.perform')
    OR public.has_organisation_permission(organisation_id, 'validation.perform')
  )
);

DROP POLICY IF EXISTS remediation_actions_update ON "remediation_actions";
CREATE POLICY remediation_actions_update ON "remediation_actions" FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (
    public.can_access_engagement(engagement_id, organisation_id)
    AND (
      status <> 'validated'
      OR public.has_engagement_permission(engagement_id, 'validation.perform')
      OR public.has_organisation_permission(organisation_id, 'validation.perform')
    )
  );

-- No grant changes needed — the table-level GRANTs from migration 0013
-- are unaffected; RLS policies are the layer being narrowed here, not
-- the underlying GRANT. No new table, column, or permission — reuses
-- `validation.perform`, seeded in migration 0031's own P2A slice.
