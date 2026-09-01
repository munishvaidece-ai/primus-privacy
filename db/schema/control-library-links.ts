import { pgTable, uuid, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { regulatoryReferences } from "./regulatory-references";
import { requirements } from "./requirements";
import { controls } from "./control-library";

// RequirementRegulatoryReference — secondary/cross citations, when a
// Requirement draws on more than one RegulatoryReference beyond its own
// primary_regulatory_reference_id (DATA_MODEL.md §6, §11: "secondary
// citations only — primary is 1:N"). Insert/delete only, like every
// junction table since Milestone 3 (R-35) — a changed mapping is a
// delete-then-insert, never an in-place update. Not gated by any
// ControlLibraryVersion status: this junction connects two entities that
// are themselves not library-version-scoped.
export const requirementRegulatoryReferences = pgTable(
  "requirement_regulatory_references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    requirementId: uuid("requirement_id").notNull(),
    regulatoryReferenceId: uuid("regulatory_reference_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    requirementTenantFk: foreignKey({
      columns: [table.requirementId, table.tenantId],
      foreignColumns: [requirements.id, requirements.tenantId],
      name: "requirement_regulatory_references_requirement_tenant_fk",
    }),
    regulatoryReferenceTenantFk: foreignKey({
      columns: [table.regulatoryReferenceId, table.tenantId],
      foreignColumns: [regulatoryReferences.id, regulatoryReferences.tenantId],
      name: "requirement_regulatory_references_regulatory_reference_tenant_fk",
    }),
    // Prevents the exact same (requirement, regulatory reference) pair
    // from being linked twice (Milestone 4 instructions: duplicate-
    // mapping prevention).
    noDuplicateMapping: unique(
      "requirement_regulatory_references_requirement_id_regulatory_reference_id_key",
    ).on(table.requirementId, table.regulatoryReferenceId),
  }),
);

// ControlRequirement — a Control can satisfy multiple Requirements; a
// Requirement can be satisfied by multiple Controls (DATA_MODEL.md §6).
// Insert/delete only, same convention. Mutable only while the mapping's
// Control belongs to a 'draft' ControlLibraryVersion — migration 0007's
// enforce_control_requirement_draft_mutable trigger is what actually
// enforces this; this table only carries the rows.
export const controlRequirements = pgTable(
  "control_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    controlId: uuid("control_id").notNull(),
    requirementId: uuid("requirement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    controlTenantFk: foreignKey({
      columns: [table.controlId, table.tenantId],
      foreignColumns: [controls.id, controls.tenantId],
      name: "control_requirements_control_tenant_fk",
    }),
    requirementTenantFk: foreignKey({
      columns: [table.requirementId, table.tenantId],
      foreignColumns: [requirements.id, requirements.tenantId],
      name: "control_requirements_requirement_tenant_fk",
    }),
    noDuplicateMapping: unique("control_requirements_control_id_requirement_id_key").on(
      table.controlId,
      table.requirementId,
    ),
  }),
);
