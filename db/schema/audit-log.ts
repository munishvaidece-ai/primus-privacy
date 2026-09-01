import { pgTable, uuid, text, jsonb, timestamp, inet } from "drizzle-orm/pg-core";
import { auditActionEnum } from "./enums";
import { tenants } from "./tenants";

// AuditLog — minimum foundation for Milestone 1's tables only (append-only
// record of material writes to tenants/organisations/engagements/
// memberships). This is NOT the full audit engine described in
// DATA_MODEL.md §10/SECURITY.md §6 (no UI, no coverage of later
// milestones' entities) — just enough to prove every foundational table
// gets a real, tamper-resistant trail from day one.
//
// Append-only is enforced at the GRANT level, not just by convention: the
// migration SQL revokes UPDATE/DELETE on this table from every
// non-superuser role (see drizzle/migrations/0000_identity_tenancy_
// engagement.sql).
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  // Nullable: not every audited event has a human actor (e.g. a
  // trigger-driven system action). FK to users(id) added via ALTER TABLE
  // in the migration SQL (same circular-import reasoning as tenants.ts).
  actorUserId: uuid("actor_user_id"),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: auditActionEnum("action").notNull(),
  fieldChanges: jsonb("field_changes"),
  reason: text("reason"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: inet("ip_address"),
});
