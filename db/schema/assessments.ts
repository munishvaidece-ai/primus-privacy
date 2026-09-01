import { pgTable, uuid, text, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { assessmentStatusEnum, assessmentTypeEnum } from "./enums";
import { engagements } from "./engagements";
import { controlLibraryVersions } from "./control-library";

// Assessment — one instance of assessing a defined set of controls within
// an Engagement over a period (DATA_MODEL.md §6). This is client
// engagement data (unlike the Milestone 4 methodology tables) — scoped to
// Organisation/Engagement, not just Tenant, and RLS'd accordingly.
//
// Fields match DATA_MODEL.md §6's Assessment row exactly: engagement_id,
// assessment_type, period_label, status, previous_assessment_id. No
// `control_library_version_id` is named there, but Milestone 5
// instructions §1/§3 require an Assessment to be "permanently associated
// with... Control Library Version" and to make it database-impossible for
// an Assessment to disagree with its Engagement's pinned version — the
// same denormalize-for-composite-FK discipline used for every other scope
// column since Milestone 1, applied here to a consistency invariant
// rather than a pure ownership one. See DECISIONS.md.
export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementId: uuid("engagement_id").notNull(),
    // Denormalized from the owning Engagement, for the same RLS/composite-
    // FK reasons every prior milestone denormalized its own scope columns
    // (no subquery back into the table a policy protects).
    organisationId: uuid("organisation_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    // Denormalized from `engagements.control_library_version_id` — see
    // the file comment above. NOT NULL: an Assessment can only be created
    // once its Engagement has a methodology pinned (enforced by the
    // composite FK below, since a NULL here could never match a real
    // `engagements.control_library_version_id` value via that FK anyway).
    controlLibraryVersionId: uuid("control_library_version_id").notNull(),

    assessmentType: assessmentTypeEnum("assessment_type").notNull(),
    periodLabel: text("period_label").notNull(),
    status: assessmentStatusEnum("status").notNull().default("draft"),
    // Self-referential, same organisation only — a correction after
    // finalization opens a new Assessment rather than mutating history
    // (DATA_MODEL.md §6), the same carried-forward pattern
    // ProcessingActivity/Engagement already use.
    previousAssessmentId: uuid("previous_assessment_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // FK to users(id) added via ALTER TABLE in the migration SQL — same
    // circular-import reasoning as every audit column since tenants.ts.
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // The database-enforced version of "Assessment.{organisation_id,
    // tenant_id} must match its Engagement's" — identical discipline to
    // ProcessingActivity's own engagement FK (Milestone 3).
    engagementOrganisationTenantFk: foreignKey({
      columns: [table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [engagements.id, engagements.organisationId, engagements.tenantId],
      name: "assessments_engagement_organisation_tenant_fk",
    }),
    // CRITICAL (Milestone 5 instructions §3): an Assessment cannot
    // reference a ControlLibraryVersion inconsistent with its Engagement
    // — proven by construction, since this FK requires the row's own
    // (engagement_id, control_library_version_id) pair to already exist
    // as a real Engagement's (id, control_library_version_id) pair
    // (engagements.ts's Milestone 5 addition). An Engagement whose own
    // pin later changes cannot happen at all (Milestone 4's immutable-
    // once-set trigger), so this can never drift after the fact either.
    engagementControlLibraryVersionFk: foreignKey({
      columns: [table.engagementId, table.controlLibraryVersionId],
      foreignColumns: [engagements.id, engagements.controlLibraryVersionId],
      name: "assessments_engagement_control_library_version_fk",
    }),
    // Belt-and-suspenders tenant consistency for the library version
    // itself (redundant with the FK above once the Engagement FK holds,
    // but costs nothing and matches every prior milestone's posture of
    // proving each relationship independently rather than relying on
    // transitive inference).
    controlLibraryVersionTenantFk: foreignKey({
      columns: [table.controlLibraryVersionId, table.tenantId],
      foreignColumns: [controlLibraryVersions.id, controlLibraryVersions.tenantId],
      name: "assessments_control_library_version_tenant_fk",
    }),
    previousAssessmentOrganisationFk: foreignKey({
      columns: [table.previousAssessmentId, table.organisationId],
      foreignColumns: [table.id, table.organisationId],
      name: "assessments_previous_assessment_organisation_fk",
    }),
    // Consumed by the self-referencing FK immediately above — Postgres
    // requires an explicit UNIQUE constraint matching exactly the
    // referenced column pair, `id` alone (already the PK) isn't enough
    // once paired with a second column (same requirement `processing_
    // activities.id_organisation_id_key` satisfies for its own
    // carried_forward_from_id self-reference — Milestone 3).
    idOrganisationUnique: unique("assessments_id_organisation_id_key").on(
      table.id,
      table.organisationId,
    ),
    // Consumed by `assessment_controls`' composite FK proving "this
    // AssessmentControl's (tenant, organisation, engagement, library
    // version) all match its own Assessment's" in one shot.
    idScopeUnique: unique("assessments_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
      table.controlLibraryVersionId,
    ),
    // Consumed by `control_tests`' (assessment_id-present) linkage FK,
    // which doesn't need the library-version column.
    idEngagementOrganisationTenantUnique: unique(
      "assessments_id_engagement_id_organisation_id_tenant_id_key",
    ).on(table.id, table.engagementId, table.organisationId, table.tenantId),
  }),
);
