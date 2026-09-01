import { pgTable, uuid, text, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { processingActivityLifecycleStatusEnum } from "./enums";
import { engagements } from "./engagements";
import { businessUnits } from "./business-units";
import { users } from "./users";

// ProcessingActivity — the central privacy object in PRIMUS
// (Milestone 3 instructions §1): a real processing operation performed
// by or on behalf of the client (Customer Onboarding, KYC, Fraud
// Detection, …). Engagement-scoped, per DATA_MODEL.md §5.2 — created
// fresh per engagement, never mutated by a later one; `carried_forward_
// from_id` links a new engagement's row to the prior one for the *same
// logical* activity without either row being shared/mutable across
// engagements (§5.4). ROPA is a future view/workflow over this table
// and its junctions (db/schema/processing-activity-links.ts) — not a
// separate dataset (Milestone 3 instructions §11).
//
// Fields match DATA_MODEL.md §5.2's ProcessingActivity row exactly:
// engagement_id, name, description, business_unit_id, owner_user_id,
// lifecycle_status, lawful_basis, carried_forward_from_id. No additional
// speculative fields — Milestone 3 instructions §2 explicitly warn
// against inventing fields "merely because they may be useful in the
// future."
//
// `organisation_id`/`tenant_id` are denormalized (not part of
// DATA_MODEL.md's field list, which lists only `engagement_id` — the
// organisation/tenant are implied transitively through it) for the same
// reason every prior milestone denormalized its own scope columns: RLS
// checks a column directly on this row rather than joining out, and the
// composite FK below makes the denormalized copy provably consistent
// with the owning engagement's real organisation/tenant, never a
// separate source of truth. See DECISIONS.md.
export const processingActivities = pgTable(
  "processing_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),

    name: text("name").notNull(),
    description: text("description"),
    businessUnitId: uuid("business_unit_id"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    lifecycleStatus: processingActivityLifecycleStatusEnum("lifecycle_status")
      .notNull()
      .default("draft"),
    // Free text, deliberately not an enum — DATA_MODEL.md §5.2 names the
    // field without fixing a controlled vocabulary of DPDP lawful bases,
    // and inventing one would be exactly the kind of unrequested
    // structure Milestone 3 instructions §2 warn against.
    lawfulBasis: text("lawful_basis"),
    // Self-referential across engagements (DATA_MODEL.md §5.2/§5.4) —
    // never mutated on the row it points to; only a new engagement's row
    // ever sets this, pointing back.
    carriedForwardFromId: uuid("carried_forward_from_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // FK to users(id) added via ALTER TABLE in the migration SQL — same
    // circular-import reasoning as every other audit column since
    // Milestone 1 (tenants.ts). `owner_user_id` above does NOT need this
    // treatment: users.ts has no reason to import processing-activities.ts
    // back, so no cycle exists for that one column.
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // The database-enforced version of Milestone 3 instructions §7:
    // "ProcessingActivity.tenant_id != Engagement.tenant_id" and
    // "...organisation_id != Engagement.organisation_id" must both be
    // impossible. Requires engagements' Milestone-3-added
    // idOrganisationTenantUnique constraint (db/schema/engagements.ts).
    engagementOrganisationTenantFk: foreignKey({
      columns: [table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [engagements.id, engagements.organisationId, engagements.tenantId],
      name: "processing_activities_engagement_organisation_tenant_fk",
    }),
    // business_unit_id is a direct reference to the identity row, NOT a
    // version — DATA_MODEL.md §5.3 explicitly carves Business Unit out
    // of version-pinning (it's structural, not a compliance fact asserted
    // during the engagement), matching how EngagementBusinessUnitScope
    // already references it directly (§2/§3).
    businessUnitOrganisationFk: foreignKey({
      columns: [table.businessUnitId, table.organisationId],
      foreignColumns: [businessUnits.id, businessUnits.organisationId],
      name: "processing_activities_business_unit_organisation_fk",
    }),
    carriedForwardFromFk: foreignKey({
      columns: [table.carriedForwardFromId, table.organisationId],
      foreignColumns: [table.id, table.organisationId],
      name: "processing_activities_carried_forward_from_fk",
    }),
    // Required so the junction tables (processing-activity-links.ts) can
    // composite-FK against (processing_activity_id, engagement_id,
    // organisation_id) in one shot.
    idEngagementOrganisationUnique: unique(
      "processing_activities_id_engagement_id_organisation_id_key",
    ).on(table.id, table.engagementId, table.organisationId),
    idOrganisationUnique: unique("processing_activities_id_organisation_id_key").on(
      table.id,
      table.organisationId,
    ),
  }),
);
