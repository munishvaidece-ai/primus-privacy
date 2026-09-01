import { pgTable, uuid, text, timestamp, foreignKey, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { validationOutcomeEnum } from "./enums";
import { remediationActions } from "./remediation-actions";
import { controlTests } from "./control-tests";
import { assessmentResponses } from "./assessment-controls";
import { users } from "./users";

// ValidationRecord — the explicit consultant-validation step between
// "evidence submitted" and "control reassessment" (DATA_MODEL.md §8): "a
// real, auditable object rather than an implicit status flip." An
// explicit event/record (Milestone 7 instructions §8) — every decision
// field (`outcome`/`validated_by`/`validated_at`/`rationale`) is frozen
// after creation (migration's tampering-guard trigger); a validation
// decision, once made, is corrected by a new ValidationRecord, never
// edited in place. The one deliberate, narrow exception is the
// reassessment-trigger columns below, which may be set exactly once,
// later — see their own comment.
//
// Fields match DATA_MODEL.md §8: remediation_action_id, validated_by,
// validated_at, outcome, triggers_control_reassessment_id. The last of
// these — described as "a new FK to a new ControlTest/AssessmentResponse"
// — is implemented as two separate nullable columns
// (`triggersControlTestId`/`triggersAssessmentResponseId`), mirroring
// EvidenceLink's own per-type-nullable-FK-column pattern (DECISIONS.md
// R-60) rather than a bare polymorphic pair, for the same reason: a real
// foreign key can only target one specific table. `rationale` is
// additive (Milestone 7 instructions §8 name "rationale/notes" as an
// expected field DATA_MODEL.md's own list doesn't yet carry — see
// DECISIONS.md).
//
// Milestone 7 instructions §9 (REASSESSMENT BOUNDARY): setting
// `triggers_control_test_id`/`triggers_assessment_response_id` records
// that a reassessment *happened* (a consultant explicitly created a new
// ControlTest/AssessmentResponse and linked it here); it never creates
// one automatically, and nothing in this migration mutates any existing,
// historical ControlTest/AssessmentResponse row as a side effect of
// validation. Their scope FKs deliberately check only `organisation_id`,
// not `engagement_id` — DATA_MODEL.md/this project's own established
// pattern (e.g. Milestone 2's FY2026/FY2027 worked example) is that each
// assessment cycle is a *new Engagement*, so the reassessment this
// ValidationRecord points to routinely lives in a later Engagement of
// the same client, not the one the remediation itself was raised in. See
// DECISIONS.md.
export const validationRecords = pgTable(
  "validation_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    remediationActionId: uuid("remediation_action_id").notNull(),
    // Denormalized from the owning RemediationAction (always fully
    // scoped — RemediationAction.engagement_id is required, unlike
    // ControlTest's dual shape) for RLS and downstream composite FKs.
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id").notNull(),

    // Slice C6 (migration 0023, DECISIONS.md R-107): no plain
    // `.references(() => users.id)` here — the composite
    // `validatorTenantFk` below (referencing `users(id, tenant_id)`,
    // not `users(id)` alone) is the real constraint, mirroring
    // `risks.owner_id`'s/`findings.owner_id`'s/`remediation_actions.
    // owner_id`'s identical Slices C3.1/C4/C5 fix.
    validatedBy: uuid("validated_by"),
    validatedAt: timestamp("validated_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: validationOutcomeEnum("outcome").notNull(),
    rationale: text("rationale"),
    // At most one set — see the CHECK below. Both null means "validated,
    // no reassessment recorded yet."
    triggersControlTestId: uuid("triggers_control_test_id"),
    triggersAssessmentResponseId: uuid("triggers_assessment_response_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    // DATA_MODEL.md §8's own explicit rule: "only a ValidationRecord with
    // outcome = ACCEPTED may trigger a new ControlTest/AssessmentResponse."
    // A rejected validation can never carry a reassessment trigger.
    onlyAcceptedTriggersReassessmentCheck: check(
      "validation_records_only_accepted_triggers_reassessment_check",
      sql`outcome = 'accepted' OR (triggers_control_test_id IS NULL AND triggers_assessment_response_id IS NULL)`,
    ),
    atMostOneReassessmentTargetCheck: check(
      "validation_records_at_most_one_reassessment_target_check",
      sql`triggers_control_test_id IS NULL OR triggers_assessment_response_id IS NULL`,
    ),
    remediationActionScopeFk: foreignKey({
      columns: [table.remediationActionId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [
        remediationActions.id,
        remediationActions.tenantId,
        remediationActions.organisationId,
        remediationActions.engagementId,
      ],
      name: "validation_records_remediation_action_scope_fk",
    }),
    // Slice C6 (migration 0023): tenant consistency for the validator —
    // conditionally active (skipped when validated_by is null), proves
    // whoever `validated_by` names belongs to this exact
    // ValidationRecord's own tenant. Mirrors `risks`'/`findings`'/
    // `remediation_actions`' identical `ownerTenantFk` (Slices
    // C3.1/C4/C5, DECISIONS.md R-107).
    validatorTenantFk: foreignKey({
      columns: [table.validatedBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
      name: "validation_records_validated_by_tenant_fk",
    }),
    // Conditionally active (skipped when null): proves the reassessment
    // ControlTest belongs to this same Organisation — deliberately
    // organisation-only, not engagement-scoped (see the file comment
    // above: a reassessment routinely happens in a later Engagement of
    // the same client). Still proves tenant consistency transitively
    // (an Organisation belongs to exactly one Tenant), so cross-tenant
    // reference remains impossible.
    triggersControlTestScopeFk: foreignKey({
      columns: [table.triggersControlTestId, table.organisationId],
      foreignColumns: [controlTests.id, controlTests.organisationId],
      name: "validation_records_triggers_control_test_scope_fk",
    }),
    triggersAssessmentResponseScopeFk: foreignKey({
      columns: [table.triggersAssessmentResponseId, table.organisationId],
      foreignColumns: [assessmentResponses.id, assessmentResponses.organisationId],
      name: "validation_records_triggers_assessment_response_scope_fk",
    }),
    // Consumed by `evidence_links`' `validation_record` subject-type FK
    // (DATA_MODEL.md §8: "Evidence attaches to... ValidationRecord via
    // the same generic EvidenceLink used everywhere else").
    idScopeUnique: unique("validation_records_id_scope_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
      table.engagementId,
    ),
  }),
);
