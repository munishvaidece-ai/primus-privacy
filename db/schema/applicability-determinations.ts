import { pgTable, uuid, text, timestamp, foreignKey, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { applicabilityDeterminationDecisionEnum } from "./enums";
import { engagementScopes } from "./engagement-scopes";
import { regulatoryReferences } from "./regulatory-references";

// ApplicabilityDetermination — DATA_MODEL.md §4's own, already-specified
// entity, implemented here unchanged in shape (D3 approved architecture
// §1/§8): the RegulatoryReference-level, narrative/report-facing record
// of "which regulatory obligations apply to this engagement" — never
// responsible for AssessmentControl membership (that is
// EngagementScopeControl's job, below). Belongs to one EngagementScope
// version, immutable once that parent is locked.
//
// Unlike EngagementScopeControl, there is no fixed, enumerable set of
// "every RegulatoryReference must get a row" — a consultant adds
// determinations for whichever references are actually relevant to
// discuss, so the row's own existence already represents a real
// decision; `decision_value` is therefore a plain two-value enum
// (applicable/not_applicable), never a third "undecided" state (see
// enums.ts).
export const applicabilityDeterminations = pgTable(
  "applicability_determinations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    engagementScopeId: uuid("engagement_scope_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    // Free text, per DATA_MODEL.md §4's own field ("scope_description")
    // — deliberately not a formal link to ProcessingActivity/BusinessUnit
    // (D3 design §D/§K: RegulatoryReference-level applicability is a
    // narrative record, not a structural scoping key).
    scopeDescription: text("scope_description").notNull(),
    decisionValue: applicabilityDeterminationDecisionEnum("decision_value").notNull(),
    // Mandatory when `decision_value = 'not_applicable'` (CHECK below),
    // matching Product Principle 9 ("system suggestions are always
    // paired with an explicit human decision field").
    decisionRationale: text("decision_rationale"),
    // Reserved, per DATA_MODEL.md §4's own field name — never written by
    // any automated engine (none exists; D3 §12: never auto-mark, never
    // AI). Left nullable/unused, exactly like `AssessmentResponse.
    // system_suggested_rating` already is.
    systemSuggestedValue: applicabilityDeterminationDecisionEnum("system_suggested_value"),
    decidedBy: uuid("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    scopeFk: foreignKey({
      columns: [table.engagementScopeId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [engagementScopes.id, engagementScopes.tenantId, engagementScopes.organisationId, engagementScopes.engagementId],
      name: "applicability_determinations_scope_fk",
    }),
    idScopeUnique: unique("applicability_determinations_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
    ),
    rationaleRequiredForNotApplicable: check(
      "applicability_determinations_rationale_required_check",
      sql`decision_value != 'not_applicable' OR decision_rationale IS NOT NULL`,
    ),
  }),
);

// ApplicabilityDeterminationRegulatoryReference (junction) — DATA_MODEL.md
// §4's own M2M. `RegulatoryReference` is Tenant-scoped-only (no
// organisation/engagement column); the FK below proves tenant
// consistency, the same discipline `requirements_primary_regulatory_
// reference_tenant_fk` already uses.
export const applicabilityDeterminationRegulatoryReferences = pgTable(
  "applicability_determination_regulatory_references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicabilityDeterminationId: uuid("applicability_determination_id").notNull(),
    regulatoryReferenceId: uuid("regulatory_reference_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    determinationFk: foreignKey({
      columns: [table.applicabilityDeterminationId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [
        applicabilityDeterminations.id,
        applicabilityDeterminations.tenantId,
        applicabilityDeterminations.organisationId,
        applicabilityDeterminations.engagementId,
      ],
      name: "ad_regulatory_references_determination_fk",
    }),
    regulatoryReferenceTenantFk: foreignKey({
      columns: [table.regulatoryReferenceId, table.tenantId],
      foreignColumns: [regulatoryReferences.id, regulatoryReferences.tenantId],
      name: "ad_regulatory_references_reference_tenant_fk",
    }),
    noDuplicateLink: unique("ad_regulatory_references_determination_id_reference_id_key").on(
      table.applicabilityDeterminationId,
      table.regulatoryReferenceId,
    ),
  }),
);
