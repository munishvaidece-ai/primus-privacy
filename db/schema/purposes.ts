import { pgTable, uuid, text, boolean, timestamp, unique, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { masterDataStatusEnum } from "./enums";
import { organisations } from "./organisations";

// Purpose — a reusable purpose-of-processing taxonomy entry (e.g.
// Customer Onboarding, KYC, Fraud Prevention, Marketing), meant to be
// referenced by many Processing Activities later (Milestone 2
// instructions §8) — not built yet, but this table is what a future
// ProcessingActivityPurpose junction (DATA_MODEL.md §5.3) will point to.
// See db/schema/systems.ts for the full identity+version pattern comment.
export const purposes = pgTable(
  "purposes",
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
    idOrganisationUnique: unique("purposes_id_organisation_id_key").on(table.id, table.organisationId),
  }),
);

export const purposeVersions = pgTable(
  "purpose_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purposeId: uuid("purpose_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),

    name: text("name").notNull(),
    description: text("description"),

    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    identityFk: foreignKey({
      columns: [table.purposeId, table.organisationId],
      foreignColumns: [purposes.id, purposes.organisationId],
      name: "purpose_versions_identity_fk",
    }),
    oneCurrentPerIdentity: uniqueIndex("purpose_versions_one_current_key")
      .on(table.purposeId)
      .where(sql`${table.isCurrent} = true`),
    // Milestone 3 addition — same reasoning as system_versions'
    // idSystemOrganisationUnique. Purely additive (DECISIONS.md).
    idPurposeOrganisationUnique: unique("purpose_versions_id_purpose_id_organisation_id_key").on(
      table.id,
      table.purposeId,
      table.organisationId,
    ),
  }),
);
