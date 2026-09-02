-- PRIMUS PRIVACY — Migration 0025: Assessment finalization
-- authorization (Slice C7.3).
--
-- Hand-written (DECISIONS.md R-02). No new table, no new column, no new
-- trigger for immutability — Milestone 5/6's own existing triggers
-- (`assessments_prevent_finalized_tampering`, `assessment_controls_
-- enforce_draft_mutable`, `assessment_responses_enforce_draft_mutable`,
-- `control_tests_enforce_draft_mutable`, `enforce_evidence_link_draft_
-- mutable`) already fully enforce "nothing changes once
-- Assessment.status = 'finalized'" — re-verified fresh this slice by
-- direct inspection of migrations 0009/0011, not re-built. This
-- migration's only job is authorization: WHO may perform the one
-- transition that sets `status = 'finalized'` in the first place.
--
-- `assessments_update` (migration 0009) has existed, unused by any
-- application code, since Milestone 5 — `WITH CHECK
-- (can_access_engagement(engagement_id, organisation_id))` alone, the
-- same coarse "any engagement member" rule every ordinary field edit
-- uses. Nothing before this slice ever issued an UPDATE against
-- `assessments` at all (confirmed by direct inspection of
-- lib/domain/assessments.ts), so this coarse policy was never a live
-- gap until now: finalization is this project's first genuinely
-- consequential, permission-gated `assessments` UPDATE, and the
-- existing policy would let ANY engagement member — not just an
-- Engagement Manager — flip `status` to `finalized` via a raw SQL
-- UPDATE, bypassing the new `assessment.finalize`-gated application
-- check entirely (`lib/domain/assessments.ts`'s own `finalizeAssessment`,
-- `lib/authorization/service.ts`'s own `canFinalizeAssessment`).
--
-- The fix is a NARROWING, not a widening: the existing `can_access_
-- engagement` clause remains for every other row this policy already
-- permitted; a new, additional clause is required only when the NEW
-- row's own `status` is `finalized` — the caller must hold
-- `assessment.finalize` (the same `has_engagement_permission`/
-- `has_organisation_permission` mechanism migration 0024 already
-- built, applied to a new permission key rather than a new mechanism).
-- A transition that does NOT touch `status` (none exist in this
-- project's current code, but the policy stays honest about the
-- general case) is unaffected.

DROP POLICY "assessments_update" ON "assessments";
CREATE POLICY assessments_update ON "assessments"
  FOR UPDATE TO authenticated
  USING (public.can_access_engagement(engagement_id, organisation_id))
  WITH CHECK (
    public.can_access_engagement(engagement_id, organisation_id)
    AND (
      status != 'finalized'
      OR public.has_engagement_permission(engagement_id, 'assessment.finalize')
      OR public.has_organisation_permission(organisation_id, 'assessment.finalize')
    )
  );

-- No other change. `assessments_prevent_finalized_tampering` (migration
-- 0009) independently and unconditionally rejects ANY update once
-- `OLD.status = 'finalized'` regardless of this policy — the two
-- mechanisms are complementary, not redundant: this policy gates WHO
-- may perform the one transition INTO `finalized`; that trigger gates
-- what happens to the row FOREVER AFTER. No GRANT change — `UPDATE` on
-- `assessments` was already granted to `authenticated` (migration
-- 0009). No new audit trigger — `assessments_audit_log` (migration
-- 0009) already fires `AFTER INSERT OR UPDATE` and will capture the
-- finalization transition (actor, before/after `status`) unchanged.
