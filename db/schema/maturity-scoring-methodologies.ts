import { pgTable, uuid, text, boolean, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// MaturityScoringMethodology — the configurable methodology a
// MaturityAssessment is computed under: how a finalized AssessmentResponse's
// `effectiveness_rating` maps to a per-domain contribution, and how a
// numeric score resolves to a human-readable maturity level. Milestone 8
// instructions §6 (CRITICAL): "do not hard-code arbitrary scoring... unless
// DATA_MODEL.md or an existing approved decision explicitly specifies
// those values... implement the data structures required to support a
// configurable scoring methodology." DATA_MODEL.md §9 does not itself
// name this table — it is the Maturity-domain counterpart to
// `RiskScoringModel` (DATA_MODEL.md §8, Milestone 7), which the same
// instructions §9 explicitly point to: "if a configurable maturity
// scoring model already exists in DATA_MODEL.md, use it. If not,
// implement only the minimum versioning structure required" — see
// DECISIONS.md.
//
// Practice-owned, Tenant-scoped — the exact same boundary and shape as
// `RiskScoringModel`: append-only (every field frozen after creation,
// migration's tampering-guard-by-omission — no UPDATE/DELETE grant
// exists at all), `is_active` marks which single methodology new
// MaturityAssessment rows should be computed under, and creating a new
// active row automatically closes out whichever row was previously
// active for the same Tenant (migration's close-out trigger, identical
// mechanism to `risk_scoring_models`, not a new one — Milestone 8
// instructions §9's own "do not allow a new methodology version to
// silently recalculate historical maturity").
//
// `definition` is a structured jsonb document the Maturity engine reads,
// never hard-coded application logic — this milestone's own tests use a
// clearly synthetic test configuration only (instructions §4/§16: no
// final PRIMUS methodology, weights, or levels are invented here).
export const maturityScoringMethodologies = pgTable(
  "maturity_scoring_methodologies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    version: text("version").notNull(),
    // e.g. { "rating_scores": { "implemented": 5, "partially_implemented": 3,
    // "not_implemented": 1, "not_applicable": null }, "levels": [{ "min": 1,
    // "max": 2, "label": "Ad Hoc" }, ...] } — read by the Maturity engine,
    // never scattered as hard-coded thresholds in application code.
    definition: jsonb("definition").notNull(),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    tenantVersionUnique: unique("maturity_scoring_methodologies_tenant_id_version_key").on(
      table.tenantId,
      table.version,
    ),
    // Consumed by `maturity_assessments`' composite FK proving a
    // MaturityAssessment's methodology pin belongs to the same Tenant.
    idTenantUnique: unique("maturity_scoring_methodologies_id_tenant_id_key").on(
      table.id,
      table.tenantId,
    ),
  }),
);
