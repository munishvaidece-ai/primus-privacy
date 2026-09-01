import { pgTable, uuid, text, date, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { remediationActionStatusEnum, remediationPriorityEnum } from "./enums";
import { engagements } from "./engagements";
import { users } from "./users";

// RemediationAction — tracks the fix for one or more findings
// (DATA_MODEL.md §8). Engagement-scoped client data, the same pattern as
// `Risk`/`Finding`.
//
// Fields match DATA_MODEL.md §8: engagement_id, title, owner_id,
// due_date, status — using the exact five-value status set DATA_MODEL.md
// names verbatim (`OPEN|IN_PROGRESS|EVIDENCE_SUBMITTED|VALIDATED|CLOSED`).
// `description`, `priority`, `completed_at` are additive (Milestone 7
// instructions §6 name "action," "priority," and "completion
// information" as expected fields DATA_MODEL.md's own list doesn't yet
// carry — see DECISIONS.md): `description` is the same title/description
// split every other entity in this schema already uses; `priority`
// reuses the same four-point taxonomy as `risk_rating`/
// `finding_severity`; `completed_at` records when `status` first reached
// a terminal value.
//
// Milestone 7 instructions §7's CRITICAL SEMANTIC RULE: `status =
// 'closed'` is NOT proof a control is now effective, and nothing in this
// schema or its triggers treats it as such — no Maturity table exists
// yet (instructions §17), and reaching `validated`/`closed` here has no
// automatic effect on any `Risk`/`AssessmentResponse` row (see
// `ValidationRecord` in validation-records.ts for the one explicit,
// consultant-driven bridge to a reassessment).
export const remediationActions = pgTable(
  "remediation_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),

    title: text("title").notNull(),
    description: text("description"),
    ownerId: uuid("owner_id").references(() => users.id),
    dueDate: date("due_date"),
    priority: remediationPriorityEnum("priority"),
    status: remediationActionStatusEnum("status").notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    engagementOrganisationTenantFk: foreignKey({
      columns: [table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [engagements.id, engagements.organisationId, engagements.tenantId],
      name: "remediation_actions_engagement_organisation_tenant_fk",
    }),
    // Consumed by the remediation-links junctions, by ValidationRecord,
    // and by EvidenceLink's `remediation_action` subject type.
    idScopeUnique: unique("remediation_actions_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
    ),
  }),
);
