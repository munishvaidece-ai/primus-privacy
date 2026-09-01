import { pgTable, uuid, text, boolean, timestamp, unique, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { masterDataStatusEnum } from "./enums";
import { organisations } from "./organisations";

// DataPrincipalCategory — a category of data subjects (e.g. Customers,
// Employees, Applicants, Vendors, Children), NOT a record of an actual
// natural person (DATA_MODEL.md §5.1; DECISIONS.md D-04 remains open on
// whether individual PII is ever stored — untouched by this milestone).
//
// Split into a stable identity row and a versioned history, per
// DATA_MODEL.md §5.1's Slowly-Changing-Dimension Type 2 pattern — see
// db/schema/systems.ts for the fullest worked comment on why every
// master-data version table is shaped this way (identity table, version
// table, composite FK, single-current partial unique index, and the
// SECURITY DEFINER close-out trigger in migration 0002).
export const dataPrincipalCategories = pgTable(
  "data_principal_categories",
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
    idOrganisationUnique: unique("data_principal_categories_id_organisation_id_key").on(
      table.id,
      table.organisationId,
    ),
  }),
);

export const dataPrincipalCategoryVersions = pgTable(
  "data_principal_category_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dataPrincipalCategoryId: uuid("data_principal_category_id").notNull(),
    // Denormalized from the identity row (and guaranteed consistent with
    // it by the composite FK below) — the same "why" as
    // engagements.tenant_id in Milestone 1: lets RLS check organisation
    // scope directly off this row's own column, with no subquery back
    // into this table's own rows (which would hit the exact
    // self-visibility bug fixed in Milestone 1's
    // can_access_engagement — see DECISIONS.md R-25).
    organisationId: uuid("organisation_id").notNull(),

    name: text("name").notNull(),
    isChildrenFlag: boolean("is_children_flag").notNull().default(false),
    description: text("description"),

    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    identityFk: foreignKey({
      columns: [table.dataPrincipalCategoryId, table.organisationId],
      foreignColumns: [dataPrincipalCategories.id, dataPrincipalCategories.organisationId],
      name: "data_principal_category_versions_identity_fk",
    }),
    // SCD2's core invariant, enforced at the database level: at most one
    // current version per identity, at any moment.
    oneCurrentPerIdentity: uniqueIndex("data_principal_category_versions_one_current_key")
      .on(table.dataPrincipalCategoryId)
      .where(sql`${table.isCurrent} = true`),
  }),
);
