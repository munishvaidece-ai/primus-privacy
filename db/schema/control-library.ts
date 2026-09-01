import { pgTable, uuid, text, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { controlLibraryVersionStatusEnum, controlTypeEnum } from "./enums";
import { tenants } from "./tenants";

// ControlLibraryVersion — a named, dated snapshot of the Practice's
// control library (DATA_MODEL.md §6): what an Engagement pins to at
// creation. Practice-owned, Tenant-scoped — never duplicated per client
// (Milestone 4 instructions). `status` is the simple three-state
// lifecycle documented in enums.ts; migration 0007's triggers are what
// actually enforce "a published version's content cannot be modified
// through ordinary application paths" — this table only carries the
// state, it doesn't gate anything by itself.
export const controlLibraryVersions = pgTable(
  "control_library_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    versionLabel: text("version_label").notNull(),
    status: controlLibraryVersionStatusEnum("status").notNull().default("draft"),
    // Set automatically by trigger the moment status first transitions to
    // 'published' (migration 0007) — not settable directly by ordinary
    // application writes once non-null.
    publishedAt: timestamp("published_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    idTenantUnique: unique("control_library_versions_id_tenant_id_key").on(
      table.id,
      table.tenantId,
    ),
    // A Tenant shouldn't have two library versions sharing a label — an
    // ordinary data-quality constraint, not a compliance rule.
    tenantVersionLabelUnique: unique(
      "control_library_versions_tenant_id_version_label_key",
    ).on(table.tenantId, table.versionLabel),
  }),
);

// Control — a reusable control definition belonging to exactly one
// ControlLibraryVersion (DATA_MODEL.md §6). Controls are never shared
// across library versions and never duplicated per client (Milestone 4
// instructions: "do not reuse the client SCD2 pattern blindly for the
// control library; do not duplicate controls per client"). A new library
// version that carries forward an existing control's intent gets its own
// new Control row — same `code`, new id, new control_library_version_id
// — deliberately WITHOUT a formal carry-forward FK chain: DATA_MODEL.md
// §6 lists no such column for Control, and the milestone brief asks for
// simple draft/published/retired semantics, not a full carry-forward
// workflow (documented in DECISIONS.md).
export const controls = pgTable(
  "controls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    controlLibraryVersionId: uuid("control_library_version_id").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    controlType: controlTypeEnum("control_type").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    controlLibraryVersionTenantFk: foreignKey({
      columns: [table.controlLibraryVersionId, table.tenantId],
      foreignColumns: [controlLibraryVersions.id, controlLibraryVersions.tenantId],
      name: "controls_control_library_version_tenant_fk",
    }),
    idTenantUnique: unique("controls_id_tenant_id_key").on(table.id, table.tenantId),
    // A control's code is unique within its own library version, not
    // globally — "C1" in Library v1.0 and "C1" in Library v2.0 are two
    // distinct rows that happen to share a human-readable code, exactly
    // the historical-reproducibility scenario (Milestone 4 instructions).
    libraryVersionCodeUnique: unique("controls_control_library_version_id_code_key").on(
      table.controlLibraryVersionId,
      table.code,
    ),
  }),
);
