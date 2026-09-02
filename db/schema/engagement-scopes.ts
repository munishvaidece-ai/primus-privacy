import { pgTable, uuid, text, timestamp, foreignKey, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { engagementScopeStatusEnum, controlApplicabilityDecisionEnum } from "./enums";
import { engagements } from "./engagements";
import { controlLibraryVersions, controls } from "./control-library";

// EngagementScope — Slice D3's Control-level Applicability & Scope
// layer (approved design, "APPROVED CORE ARCHITECTURE" §2/§3). The
// versioned header for one "scope determination round" of an
// Engagement — deliberately shaped like `Assessment` (draft/locked
// two-state lifecycle, `previous_scope_version_id` self-reference chain
// for revisions), NOT like client master data's SCD2 pattern:
// Applicability is engagement-scoped governance content (like Risk/
// Finding), never reusable Organisation-level master data.
//
// `control_library_version_id` is denormalized from the Engagement's
// own pinned version at creation time — the same reason `assessments`
// denormalizes it (migration 0008): it lets `EngagementScopeControl`'s
// own composite FK prove "this Control belongs to the exact library
// version this Scope was built against" with no subquery, mirroring
// `assessment_controls_control_library_version_fk` exactly.
export const engagementScopes = pgTable(
  "engagement_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementId: uuid("engagement_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    controlLibraryVersionId: uuid("control_library_version_id").notNull(),

    status: engagementScopeStatusEnum("status").notNull().default("draft"),
    // Self-referential, same organisation only — a revision opens a NEW
    // EngagementScope rather than mutating a locked one (D3 §4/§17), the
    // same carried-forward pattern `assessments.previous_assessment_id`
    // already establishes one hop up.
    previousScopeVersionId: uuid("previous_scope_version_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // No separate `locked_at`/`locked_by` columns — `updated_at`/
    // `updated_by`, stamped on the one `draft -> locked` transition,
    // already serve that purpose permanently and unambiguously, because
    // (mirroring `finalizeAssessment`'s own documented reasoning) the
    // lock-immutability trigger guarantees this is the LAST update this
    // row can ever receive.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    engagementScopeFk: foreignKey({
      columns: [table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [engagements.id, engagements.organisationId, engagements.tenantId],
      name: "engagement_scopes_engagement_organisation_tenant_fk",
    }),
    engagementControlLibraryVersionFk: foreignKey({
      columns: [table.engagementId, table.controlLibraryVersionId],
      foreignColumns: [engagements.id, engagements.controlLibraryVersionId],
      name: "engagement_scopes_engagement_control_library_version_fk",
    }),
    controlLibraryVersionTenantFk: foreignKey({
      columns: [table.controlLibraryVersionId, table.tenantId],
      foreignColumns: [controlLibraryVersions.id, controlLibraryVersions.tenantId],
      name: "engagement_scopes_control_library_version_tenant_fk",
    }),
    previousScopeVersionFk: foreignKey({
      columns: [table.previousScopeVersionId, table.organisationId],
      foreignColumns: [table.id, table.organisationId],
      name: "engagement_scopes_previous_scope_version_fk",
    }),
    idOrganisationUnique: unique("engagement_scopes_id_organisation_id_key").on(table.id, table.organisationId),
    // Consumed by `engagement_scope_controls`' own scope-consistency FK
    // — the same "prove (tenant, organisation, engagement, library
    // version) all match the parent" shot `assessment_controls_
    // assessment_scope_fk` already uses against `assessments`.
    idScopeUnique: unique("engagement_scopes_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
      table.controlLibraryVersionId,
    ),
    // Consumed by `applicability_determinations`' own scope-consistency
    // FK, which has no reason to also know the library version — mirrors
    // `assessments` carrying BOTH a 5-column AND a 4-column scope-unique
    // constraint simultaneously (migration 0008), for the same reason.
    idEngagementOrganisationTenantUnique: unique("engagement_scopes_id_engagement_id_organisation_id_tenant_id_key").on(
      table.id,
      table.engagementId,
      table.organisationId,
      table.tenantId,
    ),
  }),
);

// EngagementScopeControl — the operational, Control-level applicability
// decision (D3 §2/§5): does THIS Control, from the Engagement's pinned
// ControlLibraryVersion, apply to this engagement? One row per Control
// is pre-created at EngagementScope-creation time (mirroring
// `createAssessment`'s own "every Control in the pinned library becomes
// a row" population, lib/domain/assessments.ts) with `decision =
// 'undecided'` — so "nobody has reviewed this control yet" is always a
// real, explicit row, never inferred from absence or from a defaulted
// boolean.
export const engagementScopeControls = pgTable(
  "engagement_scope_controls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementScopeId: uuid("engagement_scope_id").notNull(),
    controlId: uuid("control_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    controlLibraryVersionId: uuid("control_library_version_id").notNull(),

    decision: controlApplicabilityDecisionEnum("decision").notNull().default("undecided"),
    // Mandatory (DB-enforced by the CHECK below, application-pre-checked
    // for a clean error) when `decision = 'not_applicable'`. Left NULL,
    // and cleared automatically by the domain layer, when reverted to
    // 'undecided' — a rationale should never survive under a decision it
    // no longer explains.
    rationale: text("rationale"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    scopeFk: foreignKey({
      columns: [table.engagementScopeId, table.tenantId, table.organisationId, table.engagementId, table.controlLibraryVersionId],
      foreignColumns: [
        engagementScopes.id,
        engagementScopes.tenantId,
        engagementScopes.organisationId,
        engagementScopes.engagementId,
        engagementScopes.controlLibraryVersionId,
      ],
      name: "engagement_scope_controls_scope_fk",
    }),
    // CRITICAL (mirrors `assessment_controls_control_library_version_fk`
    // exactly, migration 0008): proves this row's `control_id` genuinely
    // belongs to the exact `control_library_version_id` stored on this
    // same row — which the FK above already constrains to equal the
    // parent EngagementScope's own pinned version. Together, by
    // construction, a cross-tenant or wrong-library-version Control can
    // never be referenced (D3 §3).
    controlLibraryVersionFk: foreignKey({
      columns: [table.controlId, table.controlLibraryVersionId],
      foreignColumns: [controls.id, controls.controlLibraryVersionId],
      name: "engagement_scope_controls_control_library_version_fk",
    }),
    oneDecisionPerControl: unique("engagement_scope_controls_scope_id_control_id_key").on(
      table.engagementScopeId,
      table.controlId,
    ),
    // Consumed by `assessment_controls`' new pinning FK (migration
    // 0028) — proves the snapshot AssessmentControl later pins to
    // genuinely belongs to the same Control and Engagement.
    idControlEngagementUnique: unique("engagement_scope_controls_id_control_id_engagement_id_key").on(
      table.id,
      table.controlId,
      table.engagementId,
    ),
    rationaleRequiredForNotApplicable: check(
      "engagement_scope_controls_rationale_required_check",
      sql`decision != 'not_applicable' OR rationale IS NOT NULL`,
    ),
  }),
);
