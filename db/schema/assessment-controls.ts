import { pgTable, uuid, text, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { controlEffectivenessRatingEnum } from "./enums";
import { assessments } from "./assessments";
import { controls } from "./control-library";
import { users } from "./users";

// AssessmentControl — the inclusion of a specific Control (from the
// Assessment's pinned ControlLibraryVersion) in scope for a particular
// Assessment (DATA_MODEL.md §6: "Assessment × Control", a plain
// junction). It carries no assessment-specific state of its own beyond
// which control is in scope — that role belongs to AssessmentResponse
// below, the entity DATA_MODEL.md already names for exactly this purpose
// (`assessment_control_id`). The underlying `Control` row is never
// touched by anything here (Milestone 5 instructions §5).
//
// Insert/delete only, like every junction table since Milestone 3
// (DECISIONS.md R-35) — removing a control from scope is a DELETE, never
// an in-place edit. Mutable (insertable/deletable) only while the parent
// Assessment is still 'draft' — migration 0009's finalization-immutability
// trigger is the actual mechanism; this table only carries the rows.
export const assessmentControls = pgTable(
  "assessment_controls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentId: uuid("assessment_id").notNull(),
    controlId: uuid("control_id").notNull(),
    // Denormalized from the owning Assessment (tenant/organisation/
    // engagement) and from the Control (library version) — every column
    // this table's own RLS policies and the CRITICAL library-version
    // consistency FK below need directly on the row, no subquery back
    // into the tables it protects or references.
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),
    controlLibraryVersionId: uuid("control_library_version_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    // CRITICAL (Milestone 5 instructions §6): proves "this row's
    // (tenant, organisation, engagement, library version) all match its
    // own Assessment's" in one shot — the assessment side of the
    // consistency invariant.
    assessmentScopeFk: foreignKey({
      columns: [
        table.assessmentId,
        table.tenantId,
        table.organisationId,
        table.engagementId,
        table.controlLibraryVersionId,
      ],
      foreignColumns: [
        assessments.id,
        assessments.tenantId,
        assessments.organisationId,
        assessments.engagementId,
        assessments.controlLibraryVersionId,
      ],
      name: "assessment_controls_assessment_scope_fk",
    }),
    // CRITICAL (Milestone 5 instructions §6): the control side — proves
    // this row's `control_id` really belongs to the exact
    // `control_library_version_id` value stored on this same row. Because
    // that value is *also* constrained (by the FK above) to equal the
    // owning Assessment's own `control_library_version_id`, the two FKs
    // together prove, by construction, that "AssessmentControl.control_id
    // belongs to the ControlLibraryVersion used by the Assessment" —
    // Assessment A pinned to Library v1.0 cannot reference Control C-100
    // from Library v2.0, because no row could ever satisfy both FKs
    // simultaneously with mismatched values. No trigger required.
    controlLibraryVersionFk: foreignKey({
      columns: [table.controlId, table.controlLibraryVersionId],
      foreignColumns: [controls.id, controls.controlLibraryVersionId],
      name: "assessment_controls_control_library_version_fk",
    }),
    // A control appears at most once per assessment.
    assessmentControlUnique: unique("assessment_controls_assessment_id_control_id_key").on(
      table.assessmentId,
      table.controlId,
    ),
    // Consumed by `assessment_responses`' own composite FK.
    idScopeUnique: unique("assessment_controls_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
    ),
  }),
);

// AssessmentResponse — the actual result recorded for one AssessmentControl
// (DATA_MODEL.md §6): "Assessment 1 → N AssessmentControl → 1
// AssessmentResponse each" — at most one response per AssessmentControl
// (the UNIQUE constraint below), not a history of responses. Unlike the
// junction tables, this carries substantive, evolving content (a
// rationale, a rating, who submitted it) — an ordinarily-mutable row
// while its Assessment is still 'draft' (matching how Milestone 4's
// Control stays editable while its library version is 'draft'), not an
// insert/delete-only fact.
//
// Fields match DATA_MODEL.md §6 exactly: assessment_control_id,
// effectiveness_rating, system_suggested_rating, decision_rating,
// decision_rationale, respondent_id, submitted_at. `effectiveness_rating`
// is the assessor's own selected result (Milestone 5 instructions §7 —
// "selected result... assessor... assessment date" map to
// effectiveness_rating/respondent_id/submitted_at); `system_suggested_
// rating` is left for a future automated-suggestion engine to populate —
// nothing in this milestone writes to it, per instruction §8's ban on
// auto-generating conclusions; `decision_rating`/`decision_rationale`
// record the reviewer/approval outcome instructions §7 asks for, when one
// has been made (both nullable — a response may exist with only an
// assessor's own effectiveness_rating and no review yet).
export const assessmentResponses = pgTable(
  "assessment_responses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assessmentControlId: uuid("assessment_control_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    effectivenessRating: controlEffectivenessRatingEnum("effectiveness_rating").notNull(),
    systemSuggestedRating: controlEffectivenessRatingEnum("system_suggested_rating"),
    decisionRating: controlEffectivenessRatingEnum("decision_rating"),
    decisionRationale: text("decision_rationale"),
    respondentId: uuid("respondent_id").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    assessmentControlScopeFk: foreignKey({
      columns: [table.assessmentControlId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [
        assessmentControls.id,
        assessmentControls.tenantId,
        assessmentControls.organisationId,
        assessmentControls.engagementId,
      ],
      name: "assessment_responses_assessment_control_scope_fk",
    }),
    // At most one response per AssessmentControl (DATA_MODEL.md §11's
    // "1 AssessmentResponse each"). "Not yet assessed" is therefore the
    // *absence* of a row for a given AssessmentControl, not a row with
    // effectiveness_rating = 'not_assessed' — see Milestone 5
    // instructions §13 / DECISIONS.md.
    assessmentControlUnique: unique("assessment_responses_assessment_control_id_key").on(
      table.assessmentControlId,
    ),
    // Milestone 6 addition: consumed by `evidence_links`' composite FK,
    // proving an EvidenceLink to an AssessmentResponse carries the exact
    // same (tenant, organisation, engagement) tuple as the response it
    // supports — the same discipline as every consumer of this table.
    idScopeUnique: unique("assessment_responses_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
    ),
  }),
);
