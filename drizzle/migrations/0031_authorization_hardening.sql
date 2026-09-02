-- PRIMUS PRIVACY — Migration 0031: authorization & confidentiality
-- hardening (P2A).
--
-- Hand-written, not drizzle-kit generated — same rationale as every
-- prior security/hardening migration (DECISIONS.md R-02): RLS policy
-- narrowing isn't modeled in the Drizzle TS schema. Assumes migrations
-- 0000-0030 are already applied.
--
-- Narrows the write path of four tables from the broad
-- `can_access_engagement` (any active engagement member — migration
-- 0015) to the four new, dedicated permissions P2A introduces
-- (`risk.manage`, `finding.manage`, `validation.perform`,
-- `evidence.review`) — the RLS backstop for the matching application-
-- layer `require*Access` checks added to lib/domain/risks.ts,
-- lib/domain/findings.ts, lib/domain/validation.ts and
-- lib/domain/evidence.ts this same slice. Mirrors migration 0030's own
-- `maturity.compute` narrowing exactly (same
-- `has_engagement_permission(...) OR has_organisation_permission(...)`
-- shape) — not a new pattern.
--
-- Deliberately UNCHANGED (see DECISIONS.md for the reasoning behind
-- each):
--   * All SELECT policies, `evidence_select` included — visibility is
--     enforced at the application layer (getEvidenceDownloadUrl and the
--     getEvidenceSummaryFor* family), not by RLS; SECURITY.md already
--     documents `evidence.visibility` as deliberately not an RLS
--     condition, and the sensitive action (actual file retrieval) is
--     fully gated server-side before any signed URL is issued.
--   * `validation_records_update` — unused by any domain code (exists
--     only for a future narrow reassessment-trigger transition per its
--     own migration-0013 comment); no self-validation vector runs
--     through it today.
--   * `remediation_actions_insert`/`remediation_actions_update` — Part 4
--     of the P2A brief explicitly preserves client remediation
--     participation; over-restricting this table was out of scope.

DROP POLICY IF EXISTS risks_insert ON "risks";
CREATE POLICY risks_insert ON "risks" FOR INSERT TO authenticated WITH CHECK (
  public.has_engagement_permission(engagement_id, 'risk.manage')
  OR public.has_organisation_permission(organisation_id, 'risk.manage')
);
DROP POLICY IF EXISTS risks_update ON "risks";
CREATE POLICY risks_update ON "risks" FOR UPDATE TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'risk.manage')
    OR public.has_organisation_permission(organisation_id, 'risk.manage')
  )
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'risk.manage')
    OR public.has_organisation_permission(organisation_id, 'risk.manage')
  );

DROP POLICY IF EXISTS findings_insert ON "findings";
CREATE POLICY findings_insert ON "findings" FOR INSERT TO authenticated WITH CHECK (
  public.has_engagement_permission(engagement_id, 'finding.manage')
  OR public.has_organisation_permission(organisation_id, 'finding.manage')
);
DROP POLICY IF EXISTS findings_update ON "findings";
CREATE POLICY findings_update ON "findings" FOR UPDATE TO authenticated
  USING (
    public.has_engagement_permission(engagement_id, 'finding.manage')
    OR public.has_organisation_permission(organisation_id, 'finding.manage')
  )
  WITH CHECK (
    public.has_engagement_permission(engagement_id, 'finding.manage')
    OR public.has_organisation_permission(organisation_id, 'finding.manage')
  );

-- ValidationRecord: only the INSERT path (the actual validation
-- decision — createValidationRecord) is narrowed. This is the direct
-- fix for the self-validation gap P2 discovered: a client could
-- previously validate its own remediation. `validation_records_update`
-- is left untouched (see header).
DROP POLICY IF EXISTS validation_records_insert ON "validation_records";
CREATE POLICY validation_records_insert ON "validation_records" FOR INSERT TO authenticated WITH CHECK (
  public.has_engagement_permission(engagement_id, 'validation.perform')
  OR public.has_organisation_permission(organisation_id, 'validation.perform')
);

-- Evidence: only UPDATE (the review/accept/reject decision —
-- reviewEvidence, the sole writer of this table's UPDATE path) is
-- narrowed. INSERT stays broad (`can_access_engagement`) — both
-- consultants and clients may still upload evidence (uploadEvidence),
-- with visibility auto-computed per-uploader at the application layer.
DROP POLICY IF EXISTS evidence_update ON "evidence";
CREATE POLICY evidence_update ON "evidence" FOR UPDATE TO authenticated
  USING (
    (engagement_id IS NOT NULL AND (
      public.has_engagement_permission(engagement_id, 'evidence.review')
      OR public.has_organisation_permission(organisation_id, 'evidence.review')
    ))
    OR (engagement_id IS NULL AND public.has_organisation_permission(organisation_id, 'evidence.review'))
  )
  WITH CHECK (
    (engagement_id IS NOT NULL AND (
      public.has_engagement_permission(engagement_id, 'evidence.review')
      OR public.has_organisation_permission(organisation_id, 'evidence.review')
    ))
    OR (engagement_id IS NULL AND public.has_organisation_permission(organisation_id, 'evidence.review'))
  );

-- No grant changes needed — the table-level GRANTs from migration 0011/
-- 0013 are unaffected; RLS policies are the layer being narrowed here,
-- not the underlying GRANT.
