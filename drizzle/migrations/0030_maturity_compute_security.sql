-- PRIMUS PRIVACY — Migration 0030: security layer for Maturity compute
-- (M2 — Maturity Implementation, approval §20/§21).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- prior security/hardening migration (DECISIONS.md R-02): RLS policy
-- narrowing isn't modeled in the Drizzle TS schema. Assumes migrations
-- 0000-0029 are already applied.
--
-- Narrows the `maturity_assessments`/`maturity_scores` write path from
-- the broad `can_access_engagement` (any active engagement member —
-- migration 0015) to the new, dedicated `maturity.compute` permission
-- — the RLS backstop for `lib/domain/maturity.ts`'s application-layer
-- `requireMaturityComputeAccess` check. Mirrors migration 0028's own
-- `scope.lock` narrowing of `engagement_scopes_update` exactly (same
-- `has_engagement_permission(...) OR has_organisation_permission(...)`
-- shape) — not a new pattern. SELECT policies are unchanged (approval
-- §21: "do not weaken existing SELECT policies").

DROP POLICY IF EXISTS maturity_assessments_insert ON "maturity_assessments";
CREATE POLICY maturity_assessments_insert ON "maturity_assessments" FOR INSERT TO authenticated
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'maturity.compute')
    OR public.has_organisation_permission(organisation_id, 'maturity.compute')
  );

-- The only UPDATE this table's write path ever performs is the
-- draft -> finalized transition, in the same transaction as creation —
-- so (unlike `engagement_scopes_update`, which has to preserve a
-- broader "anyone with engagement access may edit an ordinary draft
-- field" surface alongside its own narrower lock-transition check) the
-- entire UPDATE surface here is narrowed uniformly, both USING and WITH
-- CHECK, to `maturity.compute`.
DROP POLICY IF EXISTS maturity_assessments_update ON "maturity_assessments";
CREATE POLICY maturity_assessments_update ON "maturity_assessments" FOR UPDATE TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'maturity.compute')
    OR public.has_organisation_permission(organisation_id, 'maturity.compute')
  )
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'maturity.compute')
    OR public.has_organisation_permission(organisation_id, 'maturity.compute')
  );

DROP POLICY IF EXISTS maturity_scores_insert ON "maturity_scores";
CREATE POLICY maturity_scores_insert ON "maturity_scores" FOR INSERT TO authenticated
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'maturity.compute')
    OR public.has_organisation_permission(organisation_id, 'maturity.compute')
  );

-- No grant changes needed — the table-level GRANTs from migration 0015
-- (SELECT/INSERT/UPDATE on maturity_assessments; SELECT/INSERT on
-- maturity_scores, still no UPDATE/DELETE at all) are unaffected; RLS
-- policies are the layer being narrowed here, not the underlying GRANT.
