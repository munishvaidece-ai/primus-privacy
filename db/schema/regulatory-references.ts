import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { regulatoryContentStatusEnum } from "./enums";
import { tenants } from "./tenants";

// RegulatoryReference — a citable provision (DATA_MODEL.md §6): e.g. "DPDP
// Act 2023, Section 8(5)". Framework-agnostic (framework_name is free
// text, not an enum) so other regulations can be added later without a
// schema change — §6's own stated intent. Practice-owned: belongs to the
// Tenant directly, never to a client Organisation (§12) — the boundary
// this milestone exists to enforce; no `organisation_id` column exists
// anywhere on this table.
//
// This is synthetic, clearly-labeled test-fixture content only. No real
// regulatory text is scraped, generated, or asserted as legally complete
// by this milestone — see PROGRESS.md.
export const regulatoryReferences = pgTable(
  "regulatory_references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    frameworkName: text("framework_name").notNull(),
    citation: text("citation").notNull(),
    title: text("title").notNull(),
    // Free text, e.g. "2023" — a descriptive marker of which edition of
    // the framework this citation is drawn from, NOT a version chain.
    // RegulatoryReference has no ControlLibraryVersion FK and is not
    // itself SCD2-versioned (DATA_MODEL.md §12; DECISIONS.md).
    version: text("version"),
    status: regulatoryContentStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // FK to users(id) added via ALTER TABLE in the migration SQL — same
    // circular-import reasoning as every audit column since tenants.ts.
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // Lets requirements.ts and requirement_regulatory_references
    // composite-FK against (id, tenant_id) in one shot, proving tenant
    // consistency by construction — the same discipline every prior
    // milestone applied to its own scope column.
    idTenantUnique: unique("regulatory_references_id_tenant_id_key").on(
      table.id,
      table.tenantId,
    ),
  }),
);
