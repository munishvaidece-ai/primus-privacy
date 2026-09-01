import { pgTable, uuid, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { maturityAssessmentStatusEnum } from "./enums";
import { engagements } from "./engagements";
import { assessments } from "./assessments";
import { maturityScoringMethodologies } from "./maturity-scoring-methodologies";
import { users } from "./users";

// MaturityAssessment — the "run" a set of MaturityScore rows belongs to:
// one computation event, anchored to one finalized Assessment, computed
// under one pinned MaturityScoringMethodology, with one point at which it
// becomes historically locked. DATA_MODEL.md §9's own table has no
// literal `MaturityAssessment` row — `MaturityScore` itself already
// carries `engagement_id`/`assessment_id`/`computed_at` directly, and its
// own prose describes "a computed, versioned snapshot: per-domain scores
// AND an overall weighted score for a given Assessment/period" as one
// coherent unit. Milestone 8 instructions §2 explicitly name
// `MaturityAssessment` as one of the three entities to implement,
// though — this table is the additive grouping/header row that gives
// that unit a single place to pin its Assessment/methodology and a
// single place to finalize/lock, rather than needing per-`MaturityScore`-
// row locking logic for what is conceptually one snapshot. See
// DECISIONS.md — the same posture as every other additive-but-necessary
// entity this project has recorded (e.g. `EvidenceLink`, `ValidationRecord`
// reassessment-trigger columns).
//
// `status` is the "simple finalized state" Milestone 8 instructions §12
// explicitly permit in place of an invented workflow — draft (mutable;
// while the engine is still composing the snapshot) -> finalized
// (migration's tampering-guard trigger: no further UPDATE succeeds at
// all, matching Assessment's own `prevent_finalized_assessment_
// tampering` posture exactly, not a new mechanism). `engagement_id`/
// `organisation_id`/`tenant_id`/`assessment_id`/`maturity_scoring_
// methodology_id` are additionally frozen from the moment of creation
// (migration's reparenting guard) — a MaturityAssessment can never be
// silently repointed at a different Assessment or methodology version,
// draft or finalized.
//
// `computed_from_risk_ids`/`computed_from_validation_record_ids` are
// additive traceability arrays (Milestone 8 instructions §7: Maturity
// must be "capable of consuming signals from... Risk [residual risk]...
// Remediation/Validation [validated remediation outcomes]... without
// duplicating these objects into Maturity tables"). They record which
// specific `Risk`/`ValidationRecord` rows were available and considered
// at computation time — proof the signal was consumed, not a copy of its
// content — mirroring DATA_MODEL.md §9's own `computed_from_control_
// test_ids` field exactly, extended to the two source types that field's
// literal name doesn't cover. See DECISIONS.md for what this milestone's
// synthetic methodology does and does not do with them mathematically
// (instructions §10/§11: Risk and Validation are signals, not automatic
// score inputs, unless an approved methodology says otherwise — none
// does yet).
//
// A finalized Assessment is required at creation (migration's
// `require_finalized_assessment_for_maturity` BEFORE INSERT trigger,
// enforcing instructions §7's "finalized Assessment Responses" at the
// database layer, not merely by convention) — this schema file only
// carries the FK; the migration is what actually checks `assessments.
// status`.
export const maturityAssessments = pgTable(
  "maturity_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    assessmentId: uuid("assessment_id").notNull(),
    maturityScoringMethodologyId: uuid("maturity_scoring_methodology_id").notNull(),
    status: maturityAssessmentStatusEnum("status").notNull().default("draft"),

    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    computedBy: uuid("computed_by").references(() => users.id),
    // Set automatically by trigger the moment status first transitions to
    // 'finalized' (migration) — not settable directly by ordinary
    // application writes, same pattern as `control_library_versions.
    // published_at` (Milestone 4).
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),

    computedFromRiskIds: uuid("computed_from_risk_ids").array(),
    computedFromValidationRecordIds: uuid("computed_from_validation_record_ids").array(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    engagementOrganisationTenantFk: foreignKey({
      columns: [table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [engagements.id, engagements.organisationId, engagements.tenantId],
      name: "maturity_assessments_engagement_organisation_tenant_fk",
    }),
    // Proves the source Assessment really belongs to this exact
    // (engagement, organisation, tenant) — uses `assessments`'
    // Milestone 6 `idEngagementOrganisationTenantUnique`.
    assessmentScopeFk: foreignKey({
      columns: [table.assessmentId, table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [assessments.id, assessments.engagementId, assessments.organisationId, assessments.tenantId],
      name: "maturity_assessments_assessment_scope_fk",
    }),
    // Tenant consistency for the methodology pin — Practice-owned content
    // referenced from client engagement data.
    maturityScoringMethodologyTenantFk: foreignKey({
      columns: [table.maturityScoringMethodologyId, table.tenantId],
      foreignColumns: [maturityScoringMethodologies.id, maturityScoringMethodologies.tenantId],
      name: "maturity_assessments_maturity_scoring_methodology_tenant_fk",
    }),
    // Consumed by `maturity_scores`' composite FK.
    idScopeUnique: unique("maturity_assessments_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
    ),
  }),
);
