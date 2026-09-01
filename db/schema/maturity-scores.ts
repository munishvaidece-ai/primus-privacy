import { pgTable, uuid, integer, text, timestamp, foreignKey, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { maturityAssessments } from "./maturity-assessments";
import { maturityDomains } from "./maturity-domains";
import { maturityDomainWeights } from "./maturity-domain-weights";

// MaturityScore — "a computed, versioned snapshot: per-domain scores and
// an overall weighted score for a given Assessment/period. Never
// directly user-editable" (DATA_MODEL.md §9, verbatim). One
// `MaturityAssessment` (maturity-assessments.ts) produces many
// MaturityScore rows: one per in-scope `MaturityDomain`
// (`maturity_domain_id` set), plus exactly one overall row
// (`maturity_domain_id` NULL) — DATA_MODEL.md §9's own field list names
// this nullable-for-the-overall-row shape directly, not a separate
// "overall score" column or table.
//
// Fully immutable from the instant of creation — no UPDATE grant, no
// DELETE grant exists at all (migration §8), which is the entire
// enforcement mechanism for "never directly user-editable": correcting a
// score means computing a new `MaturityAssessment`, never editing an
// existing `MaturityScore` row. Milestone 8 instructions §12: "once a
// MaturityAssessment is finalized... its score/domain results must not
// silently change" — trivially true here since a MaturityScore is never
// mutable in the first place, draft or finalized; what the migration's
// `enforce_maturity_score_draft_mutable` trigger additionally gates is
// *insertion*: a MaturityScore may only be inserted while its parent
// MaturityAssessment is still 'draft' (the same "insert-only, gated by
// the parent's status" pattern `assessment_controls` established,
// Milestone 5) — once the parent is finalized, its set of MaturityScore
// rows is permanently closed, not just individually frozen.
//
// `score` is the exact "1–5 scale" DATA_MODEL.md §9 names.
// `maturity_level` is additive (Milestone 8 instructions §5 name
// "maturity level" as an expected field DATA_MODEL.md's own field list
// doesn't yet carry — see DECISIONS.md): a human-readable label resolved
// from the pinned `MaturityScoringMethodology`'s own level-threshold
// table at computation time and stored, not derived live at read time —
// the same "assessor's own selected result... stored, not derived live"
// posture `AssessmentResponse.effectiveness_rating` already established
// (Milestone 5). `computed_from_control_test_ids` is DATA_MODEL.md §9's
// own literal traceability field, implemented as a plain array of ids
// (references to already-frozen `ControlTest` rows, not duplicated
// content) rather than an enforced junction table — matching the field's
// literal name and shape exactly, per Milestone 8 instructions §2's "use
// the exact approved... fields."
// Milestone 8A instructions (Historical Maturity Integrity Hardening):
// `domain_name_snapshot`/`domain_code_snapshot`/`domain_description_
// snapshot` close the one limitation Milestone 8's own final report
// named — `MaturityDomain` (maturity-domains.ts) is deliberately
// unversioned (R-74: "do NOT invent a large production domain
// framework"), so a domain's `name`/`description` remain ordinarily
// mutable after a `MaturityScore` has already been computed against it.
// Rather than versioning `MaturityDomain` itself (which R-74 already
// rejected as disproportionate — DECISIONS.md R-81), these three columns
// are populated ONCE, automatically, by a `BEFORE INSERT` trigger
// (migration 0017) that copies the referenced domain's `name`/`code`/
// `description` at the exact moment this row is created — never settable
// directly by the application (the trigger overwrites whatever value was
// passed, the same "trigger sets it, not the app" posture `published_at`/
// `finalized_at` already use) — and, because `maturity_scores` already
// carries no UPDATE grant at all (this table's own long-standing full
// immutability), the snapshot is permanently frozen the instant it is
// written, with no separate freeze mechanism needed. Null for the
// overall row (no domain to snapshot) — enforced by the CHECK below.
export const maturityScores = pgTable(
  "maturity_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    maturityAssessmentId: uuid("maturity_assessment_id").notNull(),
    // Denormalized from the owning MaturityAssessment.
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    // Nullable: NULL identifies the one overall row for this
    // MaturityAssessment (DATA_MODEL.md §9's own "nullable for the
    // overall row").
    maturityDomainId: uuid("maturity_domain_id"),
    // The specific MaturityDomainWeight row actually used to compute this
    // domain's contribution to the overall score — null for the overall
    // row itself (its own weighting logic, if any, is a methodology-level
    // concern, not a single pinned per-domain weight). Reproducibility
    // follows from this pin, the same way `Risk.risk_scoring_model_id`
    // does — not from re-deriving "the weight in effect at the time."
    maturityDomainWeightId: uuid("maturity_domain_weight_id"),

    score: integer("score").notNull(),
    maturityLevel: text("maturity_level"),
    computedFromControlTestIds: uuid("computed_from_control_test_ids").array(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),

    // Milestone 8A — trigger-populated, never app-settable. See the file
    // comment above.
    domainNameSnapshot: text("domain_name_snapshot"),
    domainCodeSnapshot: text("domain_code_snapshot"),
    domainDescriptionSnapshot: text("domain_description_snapshot"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    scoreRangeCheck: check("maturity_scores_score_range_check", sql`score BETWEEN 1 AND 5`),
    // A pinned weight only ever applies to a per-domain row, never the
    // overall row.
    weightRequiresDomainCheck: check(
      "maturity_scores_weight_requires_domain_check",
      sql`maturity_domain_weight_id IS NULL OR maturity_domain_id IS NOT NULL`,
    ),
    // Milestone 8A: the domain snapshot exists if and only if a domain is
    // referenced — never present on the overall row, and (once the
    // BEFORE INSERT trigger below has run) never absent on a per-domain
    // row. `domain_description_snapshot` is excluded from the non-null
    // side: `maturity_domains.description` is itself nullable (a domain
    // may legitimately have no description), so a null snapshot there is
    // a faithful copy, not a missing one.
    domainSnapshotPresenceCheck: check(
      "maturity_scores_domain_snapshot_presence_check",
      sql`(maturity_domain_id IS NULL AND domain_name_snapshot IS NULL AND domain_code_snapshot IS NULL AND domain_description_snapshot IS NULL)
          OR (maturity_domain_id IS NOT NULL AND domain_name_snapshot IS NOT NULL AND domain_code_snapshot IS NOT NULL)`,
    ),
    maturityAssessmentScopeFk: foreignKey({
      columns: [table.maturityAssessmentId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [
        maturityAssessments.id,
        maturityAssessments.tenantId,
        maturityAssessments.organisationId,
        maturityAssessments.engagementId,
      ],
      name: "maturity_scores_maturity_assessment_scope_fk",
    }),
    // Conditionally active (skipped when null, i.e. the overall row):
    // proves the domain belongs to this Score's own Tenant.
    maturityDomainTenantFk: foreignKey({
      columns: [table.maturityDomainId, table.tenantId],
      foreignColumns: [maturityDomains.id, maturityDomains.tenantId],
      name: "maturity_scores_maturity_domain_tenant_fk",
    }),
    // Conditionally active (skipped when null): proves the pinned weight
    // belongs to this Score's own Engagement.
    maturityDomainWeightScopeFk: foreignKey({
      columns: [table.maturityDomainWeightId, table.engagementId],
      foreignColumns: [maturityDomainWeights.id, maturityDomainWeights.engagementId],
      name: "maturity_scores_maturity_domain_weight_scope_fk",
    }),
    // At most one row per (MaturityAssessment, domain) — standard unique
    // semantics are correct here since `maturity_domain_id` is non-null
    // whenever this constraint's own uniqueness matters. The
    // complementary "at most one overall (domain IS NULL) row per
    // MaturityAssessment" rule needs a partial unique index instead
    // (Postgres treats NULLs as distinct in an ordinary UNIQUE
    // constraint) — added by the hand-written security migration.
    noDuplicateDomainScore: unique("maturity_scores_maturity_assessment_id_maturity_domain_id_key").on(
      table.maturityAssessmentId,
      table.maturityDomainId,
    ),
  }),
);
