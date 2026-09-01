import { pgTable, uuid, text, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { roleScopeEnum } from "./enums";

// Role — a named bundle of permissions. `scope` matches the three
// membership scopes (DATA_MODEL.md §2): a role is only ever granted via
// the membership table matching its scope (a `tenant`-scoped role via
// TenantMembership, etc.) — enforced at the application layer and by the
// seed data in db/seed/roles.ts, not by a DB constraint in this
// milestone (see DECISIONS.md for why).
export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  scope: roleScopeEnum("scope").notNull(),
  description: text("description"),
  isSystemDefined: boolean("is_system_defined").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Permission — a single fine-grained capability. This milestone seeds a
// small, representative set (see db/seed/roles.ts) to prove the
// foundation works — not an exhaustive permission catalogue, which is an
// ongoing task across every future milestone (Milestone 1 instructions
// §3: "Do not overbuild the permission-management UI... the database
// should establish the membership/role foundation").
export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  description: text("description"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
  }),
);
