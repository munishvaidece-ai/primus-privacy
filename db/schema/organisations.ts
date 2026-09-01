import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { organisationStatusEnum } from "./enums";
import { tenants } from "./tenants";

// Organisation — a client organisation. Belongs to exactly one Tenant.
// This table represents client organisations exclusively; it never
// doubles as the practice's own record (DECISIONS.md R-10). "Tenant" is
// never used as a synonym for "client organisation" anywhere in this
// schema — see ARCHITECTURE.md §5.
//
// Business Units are deliberately NOT modeled in this milestone — the
// milestone scope is Identity + Tenancy + Engagement Structure only; see
// DECISIONS.md for the recorded scope-cut.
export const organisations = pgTable(
  "organisations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    status: organisationStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // FK to users(id) added via ALTER TABLE in the migration SQL — see
    // tenants.ts for why (avoids a circular TS import with users.ts).
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // Required so `engagements` can hold a composite FK
    // (organisation_id, tenant_id) -> (id, tenant_id), which is what
    // makes "Engagement.tenant_id = Organisation.tenant_id" a real,
    // database-enforced invariant rather than an application convention
    // (Milestone 1 instructions §4).
    idTenantUnique: unique("organisations_id_tenant_id_key").on(table.id, table.tenantId),
  }),
);
