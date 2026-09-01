import { pgTable, uuid, text, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { processingActivityProcessorRoleEnum } from "./enums";
import { processingActivities } from "./processing-activities";
import { dataPrincipalCategoryVersions } from "./data-principal-categories";
import { personalDataElementVersions } from "./personal-data-elements";
import { purposeVersions } from "./purposes";
import { systemVersions } from "./systems";
import { dataStoreVersions } from "./data-stores";
import { processorVersions } from "./processors";

// The version-pinned junction layer connecting ProcessingActivity to
// Milestone 2's master data (DATA_MODEL.md §5.3). Every one of these six
// tables stores BOTH the master identity id (for "what does this client
// currently look like" queries) AND the specific `*_version_id` that was
// current when the engagement asserted the relationship (for "what did
// this look like during FY2026" queries) — the whole point of the
// version-pinned design, per DATA_MODEL.md §5.3 and Milestone 3
// instructions §3.
//
// Shared shape, reused across all six: `processing_activity_id` +
// denormalized `engagement_id`/`organisation_id` (so RLS reuses
// `can_access_engagement(engagement_id, organisation_id)` unchanged,
// with no subquery back into any of these tables — Milestone 3
// instructions §8; the same discipline as every version table since
// Milestone 2), a composite FK proving the link belongs to a real
// ProcessingActivity with a matching engagement/organisation, and a
// SECOND composite FK — `(x_version_id, x_id, organisation_id)
// REFERENCES x_versions(id, x_id, organisation_id)` — proving the
// pinned version genuinely belongs to that master entity, in that same
// organisation. Because both composite FKs constrain the SAME
// `organisation_id` column on this one row, "the Processing Activity's
// organisation equals the master-data version's organisation" holds
// automatically — not by a third check, just by construction (the same
// technique Milestone 1/2 already relied on). This is what makes
// Milestone 3 instructions §5 items 11-12 ("cannot reference a version
// belonging to another Organisation/Tenant") true at the schema level,
// not merely at the RLS level.
//
// ProcessingActivityNotice (DATA_MODEL.md §5.3) is not implemented —
// `Notice` doesn't exist as a table yet (deferred since before Milestone
// 2; DECISIONS.md). `Data Flow` is likewise out of Milestone 3's scope
// (not named in its instructions).

export const processingActivityDataPrincipalCategories = pgTable(
  "processing_activity_data_principal_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    processingActivityId: uuid("processing_activity_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    dataPrincipalCategoryId: uuid("data_principal_category_id").notNull(),
    dataPrincipalCategoryVersionId: uuid("data_principal_category_version_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    processingActivityFk: foreignKey({
      columns: [table.processingActivityId, table.engagementId, table.organisationId],
      foreignColumns: [processingActivities.id, processingActivities.engagementId, processingActivities.organisationId],
      name: "pa_data_principal_categories_pa_fk",
    }),
    versionFk: foreignKey({
      columns: [table.dataPrincipalCategoryVersionId, table.dataPrincipalCategoryId, table.organisationId],
      foreignColumns: [dataPrincipalCategoryVersions.id, dataPrincipalCategoryVersions.dataPrincipalCategoryId, dataPrincipalCategoryVersions.organisationId],
      name: "pa_data_principal_categories_version_fk",
    }),
    onePerActivity: unique("pa_data_principal_categories_pa_category_key").on(
      table.processingActivityId,
      table.dataPrincipalCategoryId,
    ),
  }),
);

export const processingActivityPersonalDataElements = pgTable(
  "processing_activity_personal_data_elements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    processingActivityId: uuid("processing_activity_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    personalDataElementId: uuid("personal_data_element_id").notNull(),
    personalDataElementVersionId: uuid("personal_data_element_version_id").notNull(),
    // "plus a per-link sensitivity note" — DATA_MODEL.md §5.3.
    sensitivityNote: text("sensitivity_note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    processingActivityFk: foreignKey({
      columns: [table.processingActivityId, table.engagementId, table.organisationId],
      foreignColumns: [processingActivities.id, processingActivities.engagementId, processingActivities.organisationId],
      name: "pa_personal_data_elements_pa_fk",
    }),
    versionFk: foreignKey({
      columns: [table.personalDataElementVersionId, table.personalDataElementId, table.organisationId],
      foreignColumns: [personalDataElementVersions.id, personalDataElementVersions.personalDataElementId, personalDataElementVersions.organisationId],
      name: "pa_personal_data_elements_version_fk",
    }),
    onePerActivity: unique("pa_personal_data_elements_pa_element_key").on(
      table.processingActivityId,
      table.personalDataElementId,
    ),
  }),
);

export const processingActivityPurposes = pgTable(
  "processing_activity_purposes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    processingActivityId: uuid("processing_activity_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    purposeId: uuid("purpose_id").notNull(),
    purposeVersionId: uuid("purpose_version_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    processingActivityFk: foreignKey({
      columns: [table.processingActivityId, table.engagementId, table.organisationId],
      foreignColumns: [processingActivities.id, processingActivities.engagementId, processingActivities.organisationId],
      name: "pa_purposes_pa_fk",
    }),
    versionFk: foreignKey({
      columns: [table.purposeVersionId, table.purposeId, table.organisationId],
      foreignColumns: [purposeVersions.id, purposeVersions.purposeId, purposeVersions.organisationId],
      name: "pa_purposes_version_fk",
    }),
    onePerActivity: unique("pa_purposes_pa_purpose_key").on(table.processingActivityId, table.purposeId),
  }),
);

export const processingActivitySystems = pgTable(
  "processing_activity_systems",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    processingActivityId: uuid("processing_activity_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    systemId: uuid("system_id").notNull(),
    systemVersionId: uuid("system_version_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    processingActivityFk: foreignKey({
      columns: [table.processingActivityId, table.engagementId, table.organisationId],
      foreignColumns: [processingActivities.id, processingActivities.engagementId, processingActivities.organisationId],
      name: "pa_systems_pa_fk",
    }),
    versionFk: foreignKey({
      columns: [table.systemVersionId, table.systemId, table.organisationId],
      foreignColumns: [systemVersions.id, systemVersions.systemId, systemVersions.organisationId],
      name: "pa_systems_version_fk",
    }),
    onePerActivity: unique("pa_systems_pa_system_key").on(table.processingActivityId, table.systemId),
  }),
);

export const processingActivityDataStores = pgTable(
  "processing_activity_data_stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    processingActivityId: uuid("processing_activity_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    dataStoreId: uuid("data_store_id").notNull(),
    dataStoreVersionId: uuid("data_store_version_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    processingActivityFk: foreignKey({
      columns: [table.processingActivityId, table.engagementId, table.organisationId],
      foreignColumns: [processingActivities.id, processingActivities.engagementId, processingActivities.organisationId],
      name: "pa_data_stores_pa_fk",
    }),
    versionFk: foreignKey({
      columns: [table.dataStoreVersionId, table.dataStoreId, table.organisationId],
      foreignColumns: [dataStoreVersions.id, dataStoreVersions.dataStoreId, dataStoreVersions.organisationId],
      name: "pa_data_stores_version_fk",
    }),
    onePerActivity: unique("pa_data_stores_pa_store_key").on(table.processingActivityId, table.dataStoreId),
  }),
);

export const processingActivityProcessors = pgTable(
  "processing_activity_processors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    processingActivityId: uuid("processing_activity_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    processorId: uuid("processor_id").notNull(),
    processorVersionId: uuid("processor_version_id").notNull(),
    // "plus a role attribute (PROCESSOR or JOINT_CONTROLLER)" — DATA_MODEL.md §5.3.
    role: processingActivityProcessorRoleEnum("role").notNull().default("processor"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    processingActivityFk: foreignKey({
      columns: [table.processingActivityId, table.engagementId, table.organisationId],
      foreignColumns: [processingActivities.id, processingActivities.engagementId, processingActivities.organisationId],
      name: "pa_processors_pa_fk",
    }),
    versionFk: foreignKey({
      columns: [table.processorVersionId, table.processorId, table.organisationId],
      foreignColumns: [processorVersions.id, processorVersions.processorId, processorVersions.organisationId],
      name: "pa_processors_version_fk",
    }),
    onePerActivity: unique("pa_processors_pa_processor_key").on(table.processingActivityId, table.processorId),
  }),
);
