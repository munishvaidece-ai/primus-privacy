import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
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
//
// P2B.0.2 (migration 0033's own tampering-guard trigger,
// `prevent_user_identity_tampering`): `id`/`tenant_id`/`client_org_id`/
// `email`/`status`/`created_at` are immutable via the ordinary
// `authenticated`-role self-update path this table's own RLS policy
// (`users_update_self`) otherwise allows — closing a real, empirically
// confirmed gap (docs/P2B.0.1_SECURITY_CLARIFICATIONS.md) where RLS's
// row-level `id = auth.uid()` check alone did not prevent a user from
// changing their OWN tenant/organisation/email/status. Only
// `display_name`/`updated_at` remain self-editable — unused by any
// feature today, left open at zero cost rather than closed for one
// that doesn't exist yet.
export const users = pgTable(
  "users",
  {
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
  },
  (table) => ({
    // Slice C3.1 (migration 0020): consumed by `risks.owner_id`'s own
    // composite FK (`risks_owner_id_tenant_fk`, db/schema/risks.ts) —
    // `id` is already globally unique (primary key); this adds no new
    // restriction on `users` itself, it only makes `(id, tenant_id)`
    // independently referenceable, exactly as Postgres requires for a
    // composite foreign key. Mirrors `risk_scoring_models_id_tenant_id_
    // key`'s identical shape (db/schema/risk-scoring-models.ts).
    idTenantUnique: unique("users_id_tenant_id_key").on(table.id, table.tenantId),
  }),
);
