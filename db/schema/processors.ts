import { pgTable, uuid, text, boolean, timestamp, unique, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { masterDataStatusEnum } from "./enums";
import { organisations } from "./organisations";

// Processor — an external processor/vendor (e.g. "KYC Vendor", "Cloud
// Provider", "Analytics Vendor"). "A Processor belongs to an
// Organisation's privacy landscape" (Milestone 2 instructions §11).
//
// `parentProcessorId` is the self-referential subprocessor chain
// DECISIONS.md R-03 already established (a subprocessor is structurally
// identical to a processor, so no separate table) — DATA_MODEL.md §5.1
// explicitly keeps it on the identity row, unchanged here. Milestone 2
// instructions §11 say to implement subprocessor relationships only if
// "already explicitly required by the current DATA_MODEL.md schema" —
// R-03/§5.1 already require exactly this one column, so it's included;
// no further subprocessor *workflow* (a management UI, notification
// chain, etc.) is built. The composite FK below additionally guarantees
// a subprocessor chain can never cross organisation boundaries — a
// parent processor must belong to the same client as its subprocessor.
//
// See db/schema/systems.ts for the full identity+version pattern comment
// shared by this file group.
export const processors = pgTable(
  "processors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    parentProcessorId: uuid("parent_processor_id"),
    status: masterDataStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    idOrganisationUnique: unique("processors_id_organisation_id_key").on(
      table.id,
      table.organisationId,
    ),
    parentProcessorOrganisationFk: foreignKey({
      columns: [table.parentProcessorId, table.organisationId],
      foreignColumns: [table.id, table.organisationId],
      name: "processors_parent_processor_organisation_fk",
    }),
  }),
);

export const processorVersions = pgTable(
  "processor_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    processorId: uuid("processor_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),

    // A processor can be legally renamed/re-badged without changing
    // identity (DATA_MODEL.md §5.1) — hence name lives on the version,
    // not the identity row.
    name: text("name").notNull(),
    // `dpaDocumentId` from DATA_MODEL.md §5.1 is deliberately NOT
    // included yet — Document/Evidence tables don't exist until a later
    // milestone (DECISIONS.md, mirroring R-23's Business-Unit-FK-style
    // scope cut from Milestone 1). `dpaVersionLabel` (free text) is kept
    // so the worked examples in DATA_MODEL.md §5.5 ("DPA version 1") are
    // still representable without a hard FK to a table that isn't built.
    dpaVersionLabel: text("dpa_version_label"),
    riskTier: text("risk_tier"),

    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    isCurrent: boolean("is_current").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    identityFk: foreignKey({
      columns: [table.processorId, table.organisationId],
      foreignColumns: [processors.id, processors.organisationId],
      name: "processor_versions_identity_fk",
    }),
    oneCurrentPerIdentity: uniqueIndex("processor_versions_one_current_key")
      .on(table.processorId)
      .where(sql`${table.isCurrent} = true`),
    // Milestone 3 addition — same reasoning as system_versions'
    // idSystemOrganisationUnique. Purely additive (DECISIONS.md).
    idProcessorOrganisationUnique: unique("processor_versions_id_processor_id_organisation_id_key").on(
      table.id,
      table.processorId,
      table.organisationId,
    ),
  }),
);
