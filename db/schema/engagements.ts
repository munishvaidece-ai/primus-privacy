import { pgTable, uuid, text, date, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { engagementTypeEnum, engagementStatusEnum } from "./enums";
import { organisations } from "./organisations";
import { controlLibraryVersions } from "./control-library";

// Engagement — a discrete, time-bounded piece of work for a client
// (e.g. "DPDP Readiness & Implementation — FY2026"). Belongs to exactly
// one Organisation and therefore one Tenant. Historical engagements are
// never overwritten (DATA_MODEL.md §3) — later milestones (the
// Assessment Engine) add the tables that hang off this one; this
// milestone only establishes the engagement itself and its tenancy
// invariant.
//
// `control_library_version_id` (DATA_MODEL.md §3, §12: "an Engagement
// pins to one control_library_version_id at creation") is added here in
// Milestone 4, now that ControlLibraryVersion exists (deferred from
// Milestone 1 — DECISIONS.md R-23). Nullable, since every Engagement
// created in Milestones 1-3 predates this column and an Engagement may
// legitimately exist before a methodology is pinned to it. Immutable
// once set, and only settable to a published or retired library version
// — enforced by migration 0007's trigger, not by this schema file.
export const engagements = pgTable(
  "engagements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Denormalized for RLS efficiency (Milestone 1 instructions §4) — a
    // policy can filter on `engagements.tenant_id` directly instead of
    // joining through `organisations` on every row check. Consistency
    // with `organisations.tenant_id` is enforced by the composite FK
    // below, not by application convention.
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    name: text("name").notNull(),
    engagementType: engagementTypeEnum("engagement_type").notNull(),
    status: engagementStatusEnum("status").notNull().default("draft"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    // Self-referential — links a new engagement to the prior one for the
    // same client, for period-over-period comparability (DATA_MODEL.md
    // §3, §12). Historical engagements are never mutated to point
    // forward; only a new engagement points back.
    previousEngagementId: uuid("previous_engagement_id"),
    // Milestone 4 addition — see the file comment above.
    controlLibraryVersionId: uuid("control_library_version_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // FK to users(id) added via ALTER TABLE in the migration SQL.
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // The database-enforced version of Milestone 1 instructions §4:
    // "Engagement.tenant_id = Organisation.tenant_id". A composite FK
    // against organisations(id, tenant_id) makes it structurally
    // impossible to insert or update an engagement whose (organisation,
    // tenant) pair doesn't match a real organisation row — including the
    // case of an org that later gets re-parented to a different tenant
    // (which itself the organisations table's own FK/RLS rules resist —
    // see the RLS migration and tests/rls).
    organisationTenantFk: foreignKey({
      columns: [table.organisationId, table.tenantId],
      foreignColumns: [organisations.id, organisations.tenantId],
      name: "engagements_organisation_tenant_fk",
    }),
    previousEngagementFk: foreignKey({
      columns: [table.previousEngagementId],
      foreignColumns: [table.id],
      name: "engagements_previous_engagement_fk",
    }),
    // Milestone 4 addition: proves "an Engagement can only pin to its own
    // Tenant's methodology" by construction — the same triple-FK
    // discipline used throughout. Draft-vs-published/retired gating and
    // immutability-once-set are enforced by migration 0007's trigger, not
    // by this FK (a composite FK can prove tenant consistency; it cannot
    // express "only if status != draft").
    controlLibraryVersionTenantFk: foreignKey({
      columns: [table.controlLibraryVersionId, table.tenantId],
      foreignColumns: [controlLibraryVersions.id, controlLibraryVersions.tenantId],
      name: "engagements_control_library_version_tenant_fk",
    }),
    // Milestone 3 addition: lets `processing_activities` composite-FK
    // against (id, organisation_id, tenant_id), guaranteeing
    // ProcessingActivity.{organisation_id,tenant_id} can never drift from
    // its own engagement's — the same discipline as the FK above, one
    // level deeper. Purely additive (a new UNIQUE constraint; no column
    // or data change) — not a correction of Milestone 1, an extension
    // for a consumer that didn't exist yet (DECISIONS.md).
    idOrganisationTenantUnique: unique("engagements_id_organisation_id_tenant_id_key").on(
      table.id,
      table.organisationId,
      table.tenantId,
    ),
  }),
);
