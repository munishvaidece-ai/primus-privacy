import { pgTable, uuid, text, boolean, timestamp, unique, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { masterDataStatusEnum } from "./enums";
import { organisations } from "./organisations";

// System — an IT system/application (e.g. "Customer CRM", "Core
// Banking", "Mobile Banking App"). This is the entity Milestone 2's
// worked test scenario is built around (a CRM whose hosting/owner change
// between the FY2026 and FY2027 engagements — tests/master-data/
// system-versioning.test.ts).
//
// --- The identity + SCD2 version pattern (shared by every master-data
// entity in this file group: DataPrincipalCategory, PersonalDataElement,
// Purpose, System, DataStore, Processor) ---
//
// DATA_MODEL.md §5.1: each entity is a stable **identity** row (what
// object is this — never mutated except status/retirement, never
// deleted) plus an append-only history of **version** rows (what was its
// state at a point in time — Slowly-Changing-Dimension Type 2:
// `valid_from`/`valid_to`/`is_current`, and the actual descriptive
// fields belong on the version, not the identity).
//
// The version table's `organisation_id` is denormalized from the
// identity row (not a fresh design choice — it mirrors
// `engagements.tenant_id` from Milestone 1, DECISIONS.md R-25): it lets
// RLS check organisation scope directly off the version row's own
// column, with **no subquery back into this same table** — Milestone 1
// hit a real Postgres RLS bug (DECISIONS.md, `can_access_engagement`)
// where a self-referential subquery on the table being INSERTed into
// couldn't see the new row during `RETURNING`; every version table here
// is deliberately built to avoid that class of bug from the start. A
// composite FK — `(entity_id, organisation_id) REFERENCES
// <identity>(id, organisation_id)` — guarantees this denormalized copy
// can never actually drift from the identity row's real organisation.
//
// `one_current_key`, a partial unique index on `(entity_id) WHERE
// is_current = true`, is the database-enforced core of SCD2: at most one
// current version per identity, ever. Creating a new version (the
// `close_out_previous_*_version` triggers in migration 0002) is designed
// to touch *only* the previous current row's `valid_to`/`is_current` —
// never its descriptive fields — which is what makes "changing Version 2
// does not rewrite Version 1" true by construction, not by convention.
// Application code (and RLS — see migration 0002) never has an UPDATE
// path to a version row's descriptive fields at all; the only way to
// change what a version says is to create a new one.
export const systems = pgTable(
  "systems",
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
    idOrganisationUnique: unique("systems_id_organisation_id_key").on(table.id, table.organisationId),
  }),
);

export const systemVersions = pgTable(
  "system_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    systemId: uuid("system_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),

    name: text("name").notNull(),
    owner: text("owner"),
    // Free text on purpose (e.g. "India", "Singapore", "AWS ap-south-1
    // (India)") — DATA_MODEL.md §5.1 names this field without fixing a
    // controlled vocabulary of regions/environments, and Milestone 2's
    // worked scenario only needs a plain hosting-location string.
    hostingEnvironment: text("hosting_environment"),

    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    identityFk: foreignKey({
      columns: [table.systemId, table.organisationId],
      foreignColumns: [systems.id, systems.organisationId],
      name: "system_versions_identity_fk",
    }),
    oneCurrentPerIdentity: uniqueIndex("system_versions_one_current_key")
      .on(table.systemId)
      .where(sql`${table.isCurrent} = true`),
    // Lets db/schema/data-stores.ts composite-FK a DataStoreVersion's
    // `system_version_id` against `(id, organisation_id)`, guaranteeing a
    // data store can never pin to another client's System version.
    idOrganisationUnique: unique("system_versions_id_organisation_id_key").on(
      table.id,
      table.organisationId,
    ),
  }),
);
