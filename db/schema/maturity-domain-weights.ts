import { pgTable, uuid, numeric, boolean, timestamp, foreignKey, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { engagements } from "./engagements";
import { maturityDomains } from "./maturity-domains";

// MaturityDomainWeight — configurable weight of a domain within a given
// Engagement/period, not hard-coded (DATA_MODEL.md §9's exact field
// list: engagement_id, maturity_domain_id, weight). Client engagement
// data, Engagement-scoped (unlike `MaturityDomain`/`MaturityScoring
// Methodology` above, which are Tenant-owned practice content) — a
// weighting choice belongs to one specific engagement/period, not the
// practice's general methodology.
//
// DATA_MODEL.md §9's own explicit rule: "the same rule as
// `RiskScoringModel` applies to `MaturityDomainWeight`: it is never
// edited after the engagement's `MaturityScore` rows have been computed
// from it — a re-weighting is a change for the *next* engagement/period,
// not a retroactive edit to a prior one's already-computed, stored
// `MaturityScore`." Implemented as the identical append-only/`is_active`/
// close-out mechanism `risk_scoring_models` already uses (migration's
// tampering-guard-by-omission — no UPDATE/DELETE grant at all), scoped
// per (engagement_id, maturity_domain_id) pair instead of per Tenant: a
// new weight for the same engagement+domain is a new row; the prior
// active row is automatically closed out, never edited in place. Every
// `MaturityScore` computed for a domain pins the exact weight row used
// (`maturity_domain_weight_id`) — reproducibility follows from that pin,
// the same way `Risk.risk_scoring_model_id` makes a Risk reproducible,
// not from ever needing to prove no *newer* weight exists.
export const maturityDomainWeights = pgTable(
  "maturity_domain_weights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementId: uuid("engagement_id").notNull(),
    // Denormalized from the owning Engagement, for the same RLS/
    // composite-FK reasons every prior milestone denormalized its own
    // scope columns.
    organisationId: uuid("organisation_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    maturityDomainId: uuid("maturity_domain_id").notNull(),
    weight: numeric("weight", { precision: 5, scale: 2 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    weightPositiveCheck: check("maturity_domain_weights_weight_positive_check", sql`weight > 0`),
    engagementOrganisationTenantFk: foreignKey({
      columns: [table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [engagements.id, engagements.organisationId, engagements.tenantId],
      name: "maturity_domain_weights_engagement_organisation_tenant_fk",
    }),
    // Tenant consistency for the domain pin — Practice-owned content
    // referenced from client engagement data.
    maturityDomainTenantFk: foreignKey({
      columns: [table.maturityDomainId, table.tenantId],
      foreignColumns: [maturityDomains.id, maturityDomains.tenantId],
      name: "maturity_domain_weights_maturity_domain_tenant_fk",
    }),
    // Consumed by `maturity_scores`' pin FK.
    idEngagementUnique: unique("maturity_domain_weights_id_engagement_id_key").on(
      table.id,
      table.engagementId,
    ),
  }),
);
