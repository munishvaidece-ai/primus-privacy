import { pgTable, uuid, text, boolean, timestamp, unique, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { masterDataStatusEnum } from "./enums";
import { organisations } from "./organisations";
import { systemVersions } from "./systems";

// DataStore — a data repository (e.g. "Customer Database", "Data
// Warehouse", "Object Storage", "Backup Repository"). "It may relate to
// a System" (Milestone 2 instructions §10) — `systemVersionId` is
// nullable because a data store isn't required to belong to one (e.g. a
// shared object-storage bucket used across systems, or one not yet
// mapped to a specific system). See db/schema/systems.ts for the full
// identity+version pattern comment shared by this file group.
export const dataStores = pgTable(
  "data_stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    status: masterDataStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    idOrganisationUnique: unique("data_stores_id_organisation_id_key").on(
      table.id,
      table.organisationId,
    ),
  }),
);

export const dataStoreVersions = pgTable(
  "data_store_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dataStoreId: uuid("data_store_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),

    name: text("name").notNull(),
    storageType: text("storage_type"),
    location: text("location"),
    // Which System *version* this data store belonged to at the time
    // (DATA_MODEL.md §5.1: "a data store can move between systems over
    // time") — nullable; when set, the composite FK below requires it to
    // belong to the SAME organisation as this data store version,
    // preventing a data store from ever being pinned to another client's
    // system even by mistake.
    systemVersionId: uuid("system_version_id"),

    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    identityFk: foreignKey({
      columns: [table.dataStoreId, table.organisationId],
      foreignColumns: [dataStores.id, dataStores.organisationId],
      name: "data_store_versions_identity_fk",
    }),
    systemVersionOrganisationFk: foreignKey({
      columns: [table.systemVersionId, table.organisationId],
      foreignColumns: [systemVersions.id, systemVersions.organisationId],
      name: "data_store_versions_system_version_organisation_fk",
    }),
    oneCurrentPerIdentity: uniqueIndex("data_store_versions_one_current_key")
      .on(table.dataStoreId)
      .where(sql`${table.isCurrent} = true`),
  }),
);
