import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { tenantStatusEnum } from "./enums";

// Tenant — the outermost isolation boundary: one consulting practice's
// entire deployment. Exactly one row exists in the MVP deployment
// (DECISIONS.md D-01), but the schema supports many. Deliberately
// minimal: no branding/billing/white-label columns (DECISIONS.md D-01,
// D-06) — those are added only when a real Phase 3 need exists.
export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: tenantStatusEnum("status").notNull().default("active"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Nullable: the very first tenant is bootstrapped before any user
  // exists to attribute it to. `users.tenant_id` references `tenants.id`,
  // so a `tenants -> users` reference here would be a circular TS import;
  // the FK to users(id) is instead added via ALTER TABLE at the end of
  // the migration SQL, once both tables exist. See
  // drizzle/migrations/0000_identity_tenancy_engagement.sql.
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
});
