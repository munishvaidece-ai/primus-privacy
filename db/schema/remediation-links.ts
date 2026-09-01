import { pgTable, uuid, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { remediationActions } from "./remediation-actions";
import { findings } from "./findings";
import { risks } from "./risks";
import { controls } from "./control-library";

// RemediationFinding, RemediationRisk, RemediationControl (junctions) —
// DATA_MODEL.md §8/§11: "RemediationAction N ←→ N Finding, Risk, Control."
// Insert/delete only, matching every junction table since Milestone 3.
export const remediationFindings = pgTable(
  "remediation_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    remediationActionId: uuid("remediation_action_id").notNull(),
    findingId: uuid("finding_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    remediationActionScopeFk: foreignKey({
      columns: [table.remediationActionId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [
        remediationActions.id,
        remediationActions.tenantId,
        remediationActions.organisationId,
        remediationActions.engagementId,
      ],
      name: "remediation_findings_remediation_action_scope_fk",
    }),
    findingScopeFk: foreignKey({
      columns: [table.findingId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [findings.id, findings.tenantId, findings.organisationId, findings.engagementId],
      name: "remediation_findings_finding_scope_fk",
    }),
    noDuplicateLink: unique("remediation_findings_remediation_action_id_finding_id_key").on(
      table.remediationActionId,
      table.findingId,
    ),
  }),
);

export const remediationRisks = pgTable(
  "remediation_risks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    remediationActionId: uuid("remediation_action_id").notNull(),
    riskId: uuid("risk_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    remediationActionScopeFk: foreignKey({
      columns: [table.remediationActionId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [
        remediationActions.id,
        remediationActions.tenantId,
        remediationActions.organisationId,
        remediationActions.engagementId,
      ],
      name: "remediation_risks_remediation_action_scope_fk",
    }),
    riskScopeFk: foreignKey({
      columns: [table.riskId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [risks.id, risks.tenantId, risks.organisationId, risks.engagementId],
      name: "remediation_risks_risk_scope_fk",
    }),
    noDuplicateLink: unique("remediation_risks_remediation_action_id_risk_id_key").on(
      table.remediationActionId,
      table.riskId,
    ),
  }),
);

export const remediationControls = pgTable(
  "remediation_controls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    remediationActionId: uuid("remediation_action_id").notNull(),
    controlId: uuid("control_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    remediationActionScopeFk: foreignKey({
      columns: [table.remediationActionId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [
        remediationActions.id,
        remediationActions.tenantId,
        remediationActions.organisationId,
        remediationActions.engagementId,
      ],
      name: "remediation_controls_remediation_action_scope_fk",
    }),
    // Control is Tenant-scoped only — see risk-links.ts's identical
    // reasoning.
    controlTenantFk: foreignKey({
      columns: [table.controlId, table.tenantId],
      foreignColumns: [controls.id, controls.tenantId],
      name: "remediation_controls_control_tenant_fk",
    }),
    noDuplicateLink: unique("remediation_controls_remediation_action_id_control_id_key").on(
      table.remediationActionId,
      table.controlId,
    ),
  }),
);
