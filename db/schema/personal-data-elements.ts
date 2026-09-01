import { pgTable, uuid, text, boolean, timestamp, unique, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { masterDataStatusEnum, dataSensitivityEnum } from "./enums";
import { organisations } from "./organisations";

// PersonalDataElement — the master catalogue of personal-data element
// *types* the client processes (e.g. Name, Email, PAN, Account Number) —
// the privacy data catalogue, not a customer database (Milestone 2
// instructions §7: "Do not store actual customer values"). See
// db/schema/systems.ts for the full comment on the identity+version
// pattern shared by every entity in this file group.
export const personalDataElements = pgTable(
  "personal_data_elements",
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
    idOrganisationUnique: unique("personal_data_elements_id_organisation_id_key").on(
      table.id,
      table.organisationId,
    ),
  }),
);

export const personalDataElementVersions = pgTable(
  "personal_data_element_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personalDataElementId: uuid("personal_data_element_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),

    name: text("name").notNull(),
    sensitivityCategory: dataSensitivityEnum("sensitivity_category").notNull().default("general"),

    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    identityFk: foreignKey({
      columns: [table.personalDataElementId, table.organisationId],
      foreignColumns: [personalDataElements.id, personalDataElements.organisationId],
      name: "personal_data_element_versions_identity_fk",
    }),
    oneCurrentPerIdentity: uniqueIndex("personal_data_element_versions_one_current_key")
      .on(table.personalDataElementId)
      .where(sql`${table.isCurrent} = true`),
  }),
);
