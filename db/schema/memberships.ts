import { pgTable, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { membershipStatusEnum } from "./enums";
import { tenants } from "./tenants";
import { organisations } from "./organisations";
import { engagements } from "./engagements";
import { users } from "./users";
import { roles } from "./roles";

// Three membership scopes (DATA_MODEL.md §2) — the primary authorization
// anchors. Each is a straightforward User × Scope × Role junction with a
// revocable `status`. A partial unique index on the active row per
// (user, scope-object) is how "prevent duplicate active memberships"
// (Milestone 1 instructions §2) is enforced: a user can hold at most one
// *active* membership per tenant/organisation/engagement at a time, but
// a revoked-then-regranted membership is a new row, preserving history
// rather than overwriting the revoked one.
//
// `EngagementMembership.business_unit_id` from DATA_MODEL.md §2 is
// omitted — Business Unit is out of this milestone's scope (see
// DECISIONS.md).

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    status: membershipStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    oneActivePerUserTenant: uniqueIndex("tenant_memberships_active_user_tenant_key")
      .on(table.userId, table.tenantId)
      .where(sql`${table.status} = 'active'`),
  }),
);

export const organisationMemberships = pgTable(
  "organisation_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    status: membershipStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    oneActivePerUserOrg: uniqueIndex("organisation_memberships_active_user_org_key")
      .on(table.userId, table.organisationId)
      .where(sql`${table.status} = 'active'`),
  }),
);

export const engagementMemberships = pgTable(
  "engagement_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    status: membershipStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    oneActivePerUserEngagement: uniqueIndex(
      "engagement_memberships_active_user_engagement_key",
    )
      .on(table.userId, table.engagementId)
      .where(sql`${table.status} = 'active'`),
  }),
);
