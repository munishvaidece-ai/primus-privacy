import { pgTable, uuid, text, timestamp, foreignKey } from "drizzle-orm/pg-core";
import { controlTestResultEnum } from "./enums";
import { controls } from "./control-library";
import { assessments } from "./assessments";
import { assessmentControls } from "./assessment-controls";
import { users } from "./users";

// ControlTest — a specific test performed against a Control (DATA_MODEL.md
// §6): methodology, sample, result. `assessment_id` is explicitly
// **nullable** in DATA_MODEL.md — "a test can also occur outside a formal
// assessment cycle, e.g. continuous monitoring" — which makes this
// table's scoping genuinely two-shaped, not a plain client-engagement
// object like Assessment/AssessmentControl/AssessmentResponse:
//
//   - When `assessment_id` IS NOT NULL: an engagement-scoped, client-
//     specific test — `organisation_id`/`engagement_id` are populated and
//     RLS uses `can_access_engagement`, matching every other client-
//     engagement object.
//   - When `assessment_id` IS NULL: a Tenant-level, practice-governance
//     activity (continuous monitoring of the methodology's own controls,
//     with no client context at all) — `organisation_id`/`engagement_id`
//     stay NULL and RLS uses `can_access_tenant`/`is_active_tenant_member`,
//     matching Milestone 4's Control itself.
//
// `tenant_id` is always populated (a Control always belongs to exactly
// one Tenant) and is what makes cross-tenant reference impossible in
// either shape. Fields match DATA_MODEL.md §6 exactly: control_id,
// assessment_id, methodology, sample_description, result, tester_id,
// tested_at. See DECISIONS.md for the "conclusion"/"exceptions" fields
// Milestone 5 instructions §9 mention but DATA_MODEL.md does not name as
// separate columns.
export const controlTests = pgTable(
  "control_tests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    controlId: uuid("control_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    assessmentId: uuid("assessment_id"),
    // Populated only alongside assessment_id — see the file comment.
    organisationId: uuid("organisation_id"),
    engagementId: uuid("engagement_id"),

    methodology: text("methodology").notNull(),
    sampleDescription: text("sample_description"),
    result: controlTestResultEnum("result").notNull(),
    testerId: uuid("tester_id").references(() => users.id),
    testedAt: timestamp("tested_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // Always enforced: this test's Control really belongs to this test's
    // Tenant — cross-tenant reference is impossible regardless of whether
    // an Assessment is involved.
    controlTenantFk: foreignKey({
      columns: [table.controlId, table.tenantId],
      foreignColumns: [controls.id, controls.tenantId],
      name: "control_tests_control_tenant_fk",
    }),
    // Enforced only when assessment_id IS NOT NULL (a multi-column FK
    // with any NULL member is skipped entirely under Postgres's default
    // MATCH SIMPLE semantics — exactly the behavior wanted for the
    // "outside a formal assessment cycle" case): proves the tested
    // control is genuinely in scope for that assessment (an
    // AssessmentControl row for this exact (assessment_id, control_id)
    // pair must already exist).
    assessmentControlFk: foreignKey({
      columns: [table.assessmentId, table.controlId],
      foreignColumns: [assessmentControls.assessmentId, assessmentControls.controlId],
      name: "control_tests_assessment_control_fk",
    }),
    // Also enforced only when assessment_id IS NOT NULL: ties
    // organisation_id/engagement_id/tenant_id to the real Assessment's,
    // so a standalone test can never masquerade as engagement-scoped with
    // forged values.
    assessmentScopeFk: foreignKey({
      columns: [table.assessmentId, table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [
        assessments.id,
        assessments.engagementId,
        assessments.organisationId,
        assessments.tenantId,
      ],
      name: "control_tests_assessment_scope_fk",
    }),
  }),
);
