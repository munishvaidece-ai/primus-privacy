import { pgTable, uuid, text, integer, timestamp, foreignKey, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { riskRatingEnum, riskStatusEnum } from "./enums";
import { engagements } from "./engagements";
import { riskScoringModels } from "./risk-scoring-models";
import { assessmentResponses } from "./assessment-controls";
import { users } from "./users";

// Risk — a risk register entry (DATA_MODEL.md §8). Client engagement
// data, engagement-scoped (like Assessment — Milestone 5), not
// Tenant-only practice content like `RiskScoringModel` above.
//
// Fields match DATA_MODEL.md §8: engagement_id, title, description,
// likelihood, impact, inherent_rating, residual_likelihood,
// residual_impact, residual_rating, risk_scoring_model_id, status,
// owner_id. `assessment_response_id` (nullable) and `previous_risk_id`
// (nullable, self-referential) are additive — see DECISIONS.md: Milestone
// 7's CORE PRINCIPLE names "Assessment Response → Risk" as the first
// conceptual link in the chain, but DATA_MODEL.md's literal field list
// has no such column (only the M2M `RiskProcessingActivity`/`RiskControl`
// junctions — §11's "Risk N ←→ N ProcessingActivity; Risk N ←→ N
// Control"); a direct, optional pointer to the specific AssessmentResponse
// that prompted a risk is what makes "FY2026 Risk remains historically
// reproducible" concretely traceable (Milestone 7 instructions §10).
export const risks = pgTable(
  "risks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    // Nullable — not every Risk arises from a formal assessment result
    // (a risk can be identified through other means: a discovery
    // interview, a client-reported incident, etc.).
    assessmentResponseId: uuid("assessment_response_id"),

    title: text("title").notNull(),
    description: text("description"),
    // 1–5 scale (DATA_MODEL.md §9's own convention for MaturityScore;
    // reused here for consistency — a bounded, documented judgment call,
    // not an unconstrained number).
    likelihood: integer("likelihood").notNull(),
    impact: integer("impact").notNull(),
    inherentRating: riskRatingEnum("inherent_rating").notNull(),
    residualLikelihood: integer("residual_likelihood"),
    residualImpact: integer("residual_impact"),
    residualRating: riskRatingEnum("residual_rating"),
    // Pinned at creation, immutable thereafter (migration's reparenting
    // guard) — Milestone 7 instructions §4/§11: "the historical Risk must
    // continue to resolve to v1 and remain reproducible" after a newer
    // RiskScoringModel is introduced. A deliberate re-score under a
    // different model creates a new Risk row via `previous_risk_id`,
    // mirroring Assessment's own `previous_assessment_id` chain
    // (DATA_MODEL.md §6) — never an in-place reparent.
    riskScoringModelId: uuid("risk_scoring_model_id").notNull(),
    status: riskStatusEnum("status").notNull().default("open"),
    ownerId: uuid("owner_id").references(() => users.id),
    previousRiskId: uuid("previous_risk_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    likelihoodRangeCheck: check("risks_likelihood_range_check", sql`likelihood BETWEEN 1 AND 5`),
    impactRangeCheck: check("risks_impact_range_check", sql`impact BETWEEN 1 AND 5`),
    residualLikelihoodRangeCheck: check(
      "risks_residual_likelihood_range_check",
      sql`residual_likelihood IS NULL OR residual_likelihood BETWEEN 1 AND 5`,
    ),
    residualImpactRangeCheck: check(
      "risks_residual_impact_range_check",
      sql`residual_impact IS NULL OR residual_impact BETWEEN 1 AND 5`,
    ),
    engagementOrganisationTenantFk: foreignKey({
      columns: [table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [engagements.id, engagements.organisationId, engagements.tenantId],
      name: "risks_engagement_organisation_tenant_fk",
    }),
    // Tenant consistency for the scoring-model pin — Practice-owned
    // content (Tenant-scoped) referenced from client engagement data.
    riskScoringModelTenantFk: foreignKey({
      columns: [table.riskScoringModelId, table.tenantId],
      foreignColumns: [riskScoringModels.id, riskScoringModels.tenantId],
      name: "risks_risk_scoring_model_tenant_fk",
    }),
    // Conditionally active (skipped when assessment_response_id is
    // null): proves the triggering AssessmentResponse belongs to this
    // exact Risk's own tenant/organisation/engagement.
    assessmentResponseScopeFk: foreignKey({
      columns: [table.assessmentResponseId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [
        assessmentResponses.id,
        assessmentResponses.tenantId,
        assessmentResponses.organisationId,
        assessmentResponses.engagementId,
      ],
      name: "risks_assessment_response_scope_fk",
    }),
    previousRiskOrganisationFk: foreignKey({
      columns: [table.previousRiskId, table.organisationId],
      foreignColumns: [table.id, table.organisationId],
      name: "risks_previous_risk_organisation_fk",
    }),
    idOrganisationUnique: unique("risks_id_organisation_id_key").on(table.id, table.organisationId),
    // Consumed by the junction tables' (risk_processing_activities,
    // risk_controls) and downstream Finding/RemediationAction junctions'
    // composite FKs.
    idScopeUnique: unique("risks_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
    ),
  }),
);
