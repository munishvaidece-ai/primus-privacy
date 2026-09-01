import { pgTable, uuid, timestamp, foreignKey, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { evidenceLinkSubjectTypeEnum } from "./enums";
import { evidence } from "./evidence";
import { assessmentResponses } from "./assessment-controls";
import { controlTests } from "./control-tests";

// EvidenceLink — what a piece of Evidence supports (DATA_MODEL.md §4).
// DATA_MODEL.md describes this as a fully generic polymorphic junction
// (`subject_type`, `subject_id` — no per-type FK). Milestone 6
// instructions §7 explicitly override that shape for security reasons:
// "do NOT rely on the application layer alone... do not create a
// completely generic polymorphic relationship if the approved model
// provides a safer/stronger approach... this is a security-critical
// area." A bare (text, uuid) pair cannot carry a real foreign key at all
// (Postgres FKs target one specific table), so it could never prove
// tenant/organisation/engagement consistency at the database layer —
// exactly what instructions §7 forbid relying on the application layer
// for.
//
// This milestone implements only the two subject types DATA_MODEL.md's
// architecture already anticipates being wired up now (instructions §6):
// `AssessmentResponse` and `ControlTest`. Each gets its own nullable,
// genuinely-FK'd column (`assessment_response_id` / `control_test_id`);
// `subject_type` records which one is populated and is enforced by a
// CHECK constraint, not left to convention. Extending to a future
// subject type (Finding, RemediationAction, etc., once those tables
// exist) means adding one more nullable column and one more CHECK
// branch — the same pattern, not a rewrite. See DECISIONS.md.
export const evidenceLinks = pgTable(
  "evidence_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceId: uuid("evidence_id").notNull(),
    // Denormalized from Evidence (tenant/organisation always; engagement
    // only when Evidence itself is engagement-scoped) — every column
    // this table's own RLS policies and subject-side composite FKs need
    // directly on the row.
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id"),

    subjectType: evidenceLinkSubjectTypeEnum("subject_type").notNull(),
    assessmentResponseId: uuid("assessment_response_id"),
    controlTestId: uuid("control_test_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    // Exactly one subject column populated, matching subject_type — the
    // database, not application convention, decides which FK below is
    // actually checked (a nullable FK column is only enforced when
    // non-null).
    subjectMatchesTypeCheck: check(
      "evidence_links_subject_matches_type_check",
      sql`(subject_type = 'assessment_response' AND assessment_response_id IS NOT NULL AND control_test_id IS NULL)
          OR (subject_type = 'control_test' AND control_test_id IS NOT NULL AND assessment_response_id IS NULL)`,
    ),
    // AssessmentResponse is always engagement-scoped (Milestone 5) — an
    // EvidenceLink to one must carry a real engagement_id, so the
    // assessmentResponseScopeFk below is never silently skipped.
    assessmentResponseRequiresEngagementCheck: check(
      "evidence_links_assessment_response_requires_engagement_check",
      sql`subject_type <> 'assessment_response' OR engagement_id IS NOT NULL`,
    ),

    // Evidence side — always active (tenant/organisation are never null).
    evidenceScopeFk: foreignKey({
      columns: [table.evidenceId, table.tenantId, table.organisationId],
      foreignColumns: [evidence.id, evidence.tenantId, evidence.organisationId],
      name: "evidence_links_evidence_scope_fk",
    }),
    // Conditionally active (skipped when this link's own engagement_id is
    // null): ties it to Evidence's own real engagement_id when present.
    evidenceEngagementFk: foreignKey({
      columns: [table.evidenceId, table.engagementId],
      foreignColumns: [evidence.id, evidence.engagementId],
      name: "evidence_links_evidence_engagement_fk",
    }),

    // AssessmentResponse side — CRITICAL (Milestone 6 instructions §7):
    // proves this link's (tenant, organisation, engagement) all match the
    // exact AssessmentResponse it claims to support. Always active
    // whenever assessment_response_id is set (the CHECK above guarantees
    // engagement_id is non-null in that case too, so this 4-column FK is
    // never silently skipped).
    assessmentResponseScopeFk: foreignKey({
      columns: [table.assessmentResponseId, table.tenantId, table.organisationId, table.engagementId],
      foreignColumns: [
        assessmentResponses.id,
        assessmentResponses.tenantId,
        assessmentResponses.organisationId,
        assessmentResponses.engagementId,
      ],
      name: "evidence_links_assessment_response_scope_fk",
    }),

    // ControlTest side — two FKs mirroring ControlTest's own dual-shaped
    // scoping (control-tests.ts): tenant consistency is always active;
    // organisation/engagement consistency is proven whenever this link's
    // own organisation_id/engagement_id are set. Because Evidence itself
    // is always organisation-scoped (organisation_id NOT NULL), an
    // EvidenceLink can never successfully target a standalone
    // (Tenant-only, no organisation) ControlTest — no row in
    // `control_tests` with a NULL organisation_id could ever satisfy
    // `controlTestOrganisationFk`.
    controlTestTenantFk: foreignKey({
      columns: [table.controlTestId, table.tenantId],
      foreignColumns: [controlTests.id, controlTests.tenantId],
      name: "evidence_links_control_test_tenant_fk",
    }),
    controlTestOrganisationFk: foreignKey({
      columns: [table.controlTestId, table.organisationId],
      foreignColumns: [controlTests.id, controlTests.organisationId],
      name: "evidence_links_control_test_organisation_fk",
    }),
    controlTestEngagementFk: foreignKey({
      columns: [table.controlTestId, table.engagementId],
      foreignColumns: [controlTests.id, controlTests.engagementId],
      name: "evidence_links_control_test_engagement_fk",
    }),

    // The same piece of Evidence isn't linked to the same subject twice.
    noDuplicateAssessmentResponseLink: unique(
      "evidence_links_evidence_id_assessment_response_id_key",
    ).on(table.evidenceId, table.assessmentResponseId),
    noDuplicateControlTestLink: unique("evidence_links_evidence_id_control_test_id_key").on(
      table.evidenceId,
      table.controlTestId,
    ),
  }),
);
