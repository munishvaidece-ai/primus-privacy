import { pgTable, uuid, text, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { regulatoryContentStatusEnum } from "./enums";
import { tenants } from "./tenants";
import { regulatoryReferences } from "./regulatory-references";

// Requirement — an obligation derived from one or more RegulatoryReferences
// (DATA_MODEL.md §6). Practice-owned, Tenant-scoped — same boundary as
// RegulatoryReference. Deliberately NOT scoped to a ControlLibraryVersion:
// DATA_MODEL.md §6's field list gives Requirement no such column, and a
// Requirement is expected to be referenced (via ControlRequirement) by
// Controls belonging to more than one library version over time — e.g.
// "R1" used by both Library v1.0 and v2.0 in the historical-
// reproducibility scenario (Milestone 4 instructions). It is the
// Requirement that is shared across library versions; the Controls that
// map to it are not.
export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    primaryRegulatoryReferenceId: uuid("primary_regulatory_reference_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: regulatoryContentStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // The database-enforced version of "a Requirement's primary reference
    // belongs to the same Tenant as the Requirement itself" — the same
    // triple/composite-FK discipline used since Milestone 2.
    primaryRegulatoryReferenceTenantFk: foreignKey({
      columns: [table.primaryRegulatoryReferenceId, table.tenantId],
      foreignColumns: [regulatoryReferences.id, regulatoryReferences.tenantId],
      name: "requirements_primary_regulatory_reference_tenant_fk",
    }),
    idTenantUnique: unique("requirements_id_tenant_id_key").on(table.id, table.tenantId),
  }),
);
