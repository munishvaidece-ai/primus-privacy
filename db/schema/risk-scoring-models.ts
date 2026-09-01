import { pgTable, uuid, text, boolean, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// RiskScoringModel — a configurable likelihood × impact → rating matrix,
// versioned (DATA_MODEL.md §8). Risk-scoring logic reads this table; it
// is not scattered as hard-coded thresholds in application code
// (Milestone 7 instructions §4). Practice-owned, Tenant-scoped — the
// same boundary as `ControlLibraryVersion` (DATA_MODEL.md §6/§12): a
// scoring methodology is reused across every client, not duplicated per
// engagement. No `organisation_id`/`engagement_id` column exists here,
// matching DATA_MODEL.md §8's own field list exactly.
//
// Append-only (DATA_MODEL.md §8's own explicit statement, DECISIONS.md
// R-16): `matrix_definition` and every other descriptive field are
// immutable after creation (migration's tampering-guard trigger) — a
// change in scoring approach creates a NEW row (new `version`), never an
// in-place edit, so `Risk.risk_scoring_model_id` stays a provably
// reproducible pin regardless of what scoring models are created later.
// `is_active` marks which single model new Risk rows should be scored
// under; flipping it on a new row automatically closes out whichever
// row was previously active (migration's close-out trigger, the same
// "at most one current row" pattern Milestone 2's SCD2 version tables
// use) — this is bookkeeping about *which model is offered for new
// scoring*, not a change to any existing model's own content, and has no
// effect whatsoever on any `Risk` row already pointing at an earlier
// model (DECISIONS.md).
export const riskScoringModels = pgTable(
  "risk_scoring_models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    version: text("version").notNull(),
    // Structured likelihood×impact grid (DATA_MODEL.md §8: "matrix_
    // definition (structured, e.g. JSONB grid)") — read by risk-scoring
    // logic, never hard-coded. This milestone stores and pins the
    // configuration; it does not implement an automatic scoring
    // calculator (Milestone 7 instructions §4/§18 keep the data layer
    // authoritative without building a scoring engine or dashboard).
    matrixDefinition: jsonb("matrix_definition").notNull(),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    tenantVersionUnique: unique("risk_scoring_models_tenant_id_version_key").on(
      table.tenantId,
      table.version,
    ),
    // Consumed by `risks`' composite FK proving a Risk's scoring model
    // belongs to the same Tenant.
    idTenantUnique: unique("risk_scoring_models_id_tenant_id_key").on(table.id, table.tenantId),
  }),
);
