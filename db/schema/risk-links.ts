import { pgTable, uuid, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { risks } from "./risks";
import { processingActivities } from "./processing-activities";
import { controls } from "./control-library";

// RiskProcessingActivity, RiskControl (junctions) — DATA_MODEL.md §8/§11:
// "Risk N ←→ N ProcessingActivity; Risk N ←→ N Control." Insert/delete
// only, like every junction table since Milestone 3 (DECISIONS.md R-35).
//
// `ProcessingActivity` is engagement-scoped client data;
// `Control` is Tenant-scoped practice methodology (DATA_MODEL.md §12) —
// each junction's composite FK matches the scope shape of the entity it
// actually points to, not a one-size-fits-all pattern.
export const riskProcessingActivities = pgTable(
  "risk_processing_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    riskId: uuid("risk_id").notNull(),
    processingActivityId: uuid("processing_activity_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    riskScopeFk: foreignKey({
      columns: [table.riskId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [risks.id, risks.tenantId, risks.organisationId, risks.engagementId],
      name: "risk_processing_activities_risk_scope_fk",
    }),
    // Proves the Processing Activity belongs to the same Engagement (and
    // therefore the same Organisation) as the Risk — the database-
    // enforced version of Milestone 7 instructions §13's "make sure they
    // belong to the same appropriate engagement/organisation."
    processingActivityScopeFk: foreignKey({
      columns: [table.processingActivityId, table.engagementId, table.organisationId],
      foreignColumns: [
        processingActivities.id,
        processingActivities.engagementId,
        processingActivities.organisationId,
      ],
      name: "risk_processing_activities_processing_activity_scope_fk",
    }),
    noDuplicateLink: unique("risk_processing_activities_risk_id_processing_activity_id_key").on(
      table.riskId,
      table.processingActivityId,
    ),
  }),
);

export const riskControls = pgTable(
  "risk_controls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    riskId: uuid("risk_id").notNull(),
    controlId: uuid("control_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    riskScopeFk: foreignKey({
      columns: [table.riskId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [risks.id, risks.tenantId, risks.organisationId, risks.engagementId],
      name: "risk_controls_risk_scope_fk",
    }),
    // Control is Tenant-scoped only (no organisation/engagement column
    // exists on it at all) — tenant consistency is the entire invariant
    // to prove here, and it's always active (both sides' tenant_id are
    // NOT NULL).
    controlTenantFk: foreignKey({
      columns: [table.controlId, table.tenantId],
      foreignColumns: [controls.id, controls.tenantId],
      name: "risk_controls_control_tenant_fk",
    }),
    noDuplicateLink: unique("risk_controls_risk_id_control_id_key").on(
      table.riskId,
      table.controlId,
    ),
  }),
);
