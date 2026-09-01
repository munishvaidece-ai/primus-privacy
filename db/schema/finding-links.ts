import { pgTable, uuid, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { findings } from "./findings";
import { risks } from "./risks";
import { controls } from "./control-library";
import { processingActivities } from "./processing-activities";

// FindingRisk, FindingControl, FindingProcessingActivity (junctions) —
// DATA_MODEL.md §8/§11: "Finding N ←→ N Risk, Control, ProcessingActivity."
// Insert/delete only, matching every junction table since Milestone 3.
export const findingRisks = pgTable(
  "finding_risks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    findingId: uuid("finding_id").notNull(),
    riskId: uuid("risk_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    findingScopeFk: foreignKey({
      columns: [table.findingId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [findings.id, findings.tenantId, findings.organisationId, findings.engagementId],
      name: "finding_risks_finding_scope_fk",
    }),
    riskScopeFk: foreignKey({
      columns: [table.riskId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [risks.id, risks.tenantId, risks.organisationId, risks.engagementId],
      name: "finding_risks_risk_scope_fk",
    }),
    noDuplicateLink: unique("finding_risks_finding_id_risk_id_key").on(table.findingId, table.riskId),
  }),
);

export const findingControls = pgTable(
  "finding_controls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    findingId: uuid("finding_id").notNull(),
    controlId: uuid("control_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    findingScopeFk: foreignKey({
      columns: [table.findingId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [findings.id, findings.tenantId, findings.organisationId, findings.engagementId],
      name: "finding_controls_finding_scope_fk",
    }),
    // Control is Tenant-scoped only — see risk-links.ts's identical
    // reasoning.
    controlTenantFk: foreignKey({
      columns: [table.controlId, table.tenantId],
      foreignColumns: [controls.id, controls.tenantId],
      name: "finding_controls_control_tenant_fk",
    }),
    noDuplicateLink: unique("finding_controls_finding_id_control_id_key").on(
      table.findingId,
      table.controlId,
    ),
  }),
);

export const findingProcessingActivities = pgTable(
  "finding_processing_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    findingId: uuid("finding_id").notNull(),
    processingActivityId: uuid("processing_activity_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    findingScopeFk: foreignKey({
      columns: [table.findingId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [findings.id, findings.tenantId, findings.organisationId, findings.engagementId],
      name: "finding_processing_activities_finding_scope_fk",
    }),
    processingActivityScopeFk: foreignKey({
      columns: [table.processingActivityId, table.engagementId, table.organisationId],
      foreignColumns: [
        processingActivities.id,
        processingActivities.engagementId,
        processingActivities.organisationId,
      ],
      name: "finding_processing_activities_processing_activity_scope_fk",
    }),
    noDuplicateLink: unique(
      "finding_processing_activities_finding_id_processing_activity_id_key",
    ).on(table.findingId, table.processingActivityId),
  }),
);
