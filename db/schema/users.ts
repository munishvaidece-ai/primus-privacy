import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { userStatusEnum } from "./enums";
import { tenants } from "./tenants";
import { organisations } from "./organisations";

// User — the minimum identity relationship necessary to connect an
// authenticated Supabase user to the PRIMUS authorization model. This is
// NOT a duplicate of Supabase Auth: no password, MFA secret, or session
// data lives here. `id` IS `auth.users.id` (a real FK in the migration
// SQL — see below) — this table only adds the platform-specific profile
// fields authorization needs.
//
// `email` is a deliberate, narrow exception to "don't duplicate
// credentials": an email address is an identifier, not a credential
// (unlike a password hash or session token), and keeping a synced copy
// here avoids every membership/roster query needing a separate call to
// Supabase's Admin API just to show who a row belongs to. It is kept in
// sync via a trigger from `auth.users`, never written directly by
// application code — see the migration SQL.
//
// Practice-side (PRIMUS) users have `client_org_id = NULL`; client-side
// users have it set. Every user has a required `tenant_id` (their home
// practice) — see DATA_MODEL.md §2, ARCHITECTURE.md §5.
export const users = pgTable("users", {
  // References auth.users(id) — added via ALTER TABLE in the migration
  // SQL, since Drizzle's pg-core has no first-class handle on Supabase's
  // `auth` schema tables.
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  clientOrgId: uuid("client_org_id").references(() => organisations.id),
  email: text("email").notNull(),
  displayName: text("display_name"),
  status: userStatusEnum("status").notNull().default("active"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
