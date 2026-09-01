import { pgTable, uuid, text, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { findingSeverityEnum, findingStatusEnum } from "./enums";
import { engagements } from "./engagements";
import { users } from "./users";

// Finding — an identified issue/gap (DATA_MODEL.md §8). Engagement-scoped
// client data, the same pattern as `Risk`.
//
// Fields match DATA_MODEL.md §8: engagement_id, title, description,
// severity, status. `owner_id` is additive (Milestone 7 instructions §5
// name "owner" as an expected field; DATA_MODEL.md's own field list for
// `RemediationAction` already includes `owner_id`, so this is the same
// established concept applied consistently, not an invented one — see
// DECISIONS.md). "source/context" and "related assessment/control/
// processing activity" (instructions §5) are expressed through the
// `FindingRisk`/`FindingControl`/`FindingProcessingActivity` junctions
// (finding-links.ts) DATA_MODEL.md §8/§11 already name for exactly this
// purpose, not a separate free-text column.
//
// Milestone 7 instructions §5: "Do not automatically create findings
// from every failed control unless the architecture explicitly requires
// such automation... the consultant should be able to determine whether
// an assessment result represents a finding" — no trigger anywhere in
// this milestone creates a Finding automatically from an
// AssessmentResponse/ControlTest/Risk; every Finding is an explicit
// INSERT.
export const findings = pgTable(
  "findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),

    title: text("title").notNull(),
    description: text("description"),
    severity: findingSeverityEnum("severity").notNull(),
    status: findingStatusEnum("status").notNull().default("open"),
    ownerId: uuid("owner_id").references(() => users.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    engagementOrganisationTenantFk: foreignKey({
      columns: [table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [engagements.id, engagements.organisationId, engagements.tenantId],
      name: "findings_engagement_organisation_tenant_fk",
    }),
    // Consumed by the finding-links junctions and by RemediationFinding.
    idScopeUnique: unique("findings_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
    ),
  }),
);
