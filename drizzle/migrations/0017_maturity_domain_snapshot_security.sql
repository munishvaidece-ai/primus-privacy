-- PRIMUS PRIVACY — Migration 0017: security layer for the Historical
-- Maturity Integrity Hardening (0016_maturity_domain_snapshot.sql).
--
-- Hand-written, not drizzle-kit generated — same rationale as migrations
-- 0001, 0003, 0005, 0007, 0009, 0011, 0013, and 0015 (DECISIONS.md
-- R-02): triggers aren't modeled in the Drizzle TS schema. Deployable to
-- a real Supabase project as-is; assumes migrations 0000-0016 are
-- already applied.
--
-- Milestone 8A closes the one limitation Milestone 8's own final report
-- named: `MaturityDomain` (deliberately unversioned, R-74 — "do NOT
-- invent a large production domain framework") could be renamed/re-
-- described/retired after a `MaturityScore` had already been computed
-- against it, silently changing what a historical score's domain *label*
-- resolves to via a live JOIN (never its numeric result, which was
-- already frozen). See DECISIONS.md R-81 for the full rationale and the
-- alternatives considered (versioning `MaturityDomain` itself, or
-- reconstructing history from `audit_log` alone) and why this — a
-- trigger-populated snapshot on `MaturityScore` — is the smallest
-- solution consistent with the existing architecture.
--
-- No RLS/policy/GRANT changes are needed anywhere in this migration:
-- the three new columns (migration 0016) belong to an existing table
-- already fully covered by its own row-level policies (migration 0015)
-- — a policy authorizes or denies an entire row, not individual columns
-- — and `maturity_scores` already carries no UPDATE grant at all, so
-- the new columns inherit that same total post-creation immutability
-- with zero additional enforcement needed.

-- =============================================================================
-- 1. Domain-definition snapshot trigger — populates `domain_name_
--    snapshot`/`domain_code_snapshot`/`domain_description_snapshot` from
--    the referenced `MaturityDomain` row at the exact moment a
--    `MaturityScore` is created, unconditionally overwriting whatever
--    value (if any) the application attempted to pass — the same
--    "trigger sets it, the application never sets it directly" posture
--    already used for `control_library_versions.published_at`
--    (migration 0007) and `maturity_assessments.finalized_at`
--    (migration 0015). Combined with `maturity_scores` already carrying
--    no UPDATE grant at all (migration 0015 §11), the snapshot becomes
--    permanently frozen the instant it is written — no separate freeze
--    trigger is needed, the same reasoning that already makes every
--    other column on this table immutable after creation.
--
--    For the overall row (`maturity_domain_id IS NULL`), the snapshot
--    columns are unconditionally forced to NULL — defensive, and what
--    keeps `maturity_scores_domain_snapshot_presence_check` (migration
--    0016) satisfied by construction rather than by trusting the caller.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.snapshot_maturity_domain_definition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.maturity_domain_id IS NULL THEN
    NEW.domain_name_snapshot := NULL;
    NEW.domain_code_snapshot := NULL;
    NEW.domain_description_snapshot := NULL;
  ELSE
    SELECT name, code, description
      INTO NEW.domain_name_snapshot, NEW.domain_code_snapshot, NEW.domain_description_snapshot
      FROM maturity_domains
      WHERE id = NEW.maturity_domain_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maturity_scores_snapshot_domain_definition
  BEFORE INSERT ON "maturity_scores"
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_maturity_domain_definition();

-- =============================================================================
-- 2. Backfill (best-effort, additive, non-destructive) — Milestone 8A
--    instructions §8: "if backfill is necessary, explain exactly how it
--    works."
--
--    Exactly how it works: for any pre-existing, domain-scoped
--    `MaturityScore` row whose new snapshot columns are still NULL (i.e.
--    it was created before this migration ran), copy the referenced
--    `MaturityDomain`'s CURRENT `name`/`code`/`description` into the
--    snapshot columns. Only the three new, previously-NULL snapshot
--    columns are touched — `score`, `maturity_level`, `computed_at`,
--    `computed_from_control_test_ids`, and every other historical field
--    on the row are left completely untouched, so this is additive, not
--    a destructive rewrite of any existing historical result.
--
--    The one honest limitation: this backfill can only use the domain's
--    definition AS OF THIS MIGRATION, not necessarily the definition
--    that was actually in effect at each row's own original
--    `computed_at` — that information was never captured before this
--    migration existed, and (short of a full `audit_log.field_changes`
--    replay reconstructing `maturity_domains`' state as of an arbitrary
--    past timestamp — a heavier mechanism this migration does not build,
--    since instructions ask for the smallest solution) cannot be
--    reconstructed with certainty after the fact. This is the honestly
--    best-available reconstruction for any row that predates this
--    migration, not a claim of perfect historical accuracy for such
--    rows. Every `MaturityScore` inserted from this migration onward
--    gets the exact, always-correct snapshot via the trigger above —
--    this gap applies only to rows literally created before Milestone 8A.
--
--    In practice, this UPDATE is a no-op in every environment this
--    project has ever run in: D-03 (data residency) remains unresolved,
--    no real Supabase project has ever been provisioned, and
--    `scripts/reset-test-db.ts` always starts every test run from an
--    empty database — there is no pre-existing `MaturityScore` data
--    anywhere for it to act on. It is included for real-deployment
--    readiness, not because backfill was actually exercised here.
-- =============================================================================

UPDATE maturity_scores ms
SET domain_name_snapshot = md.name,
    domain_code_snapshot = md.code,
    domain_description_snapshot = md.description
FROM maturity_domains md
WHERE ms.maturity_domain_id = md.id
  AND ms.domain_name_snapshot IS NULL;
