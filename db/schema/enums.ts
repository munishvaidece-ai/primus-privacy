import { pgEnum } from "drizzle-orm/pg-core";

// Shared enums for Milestone 1 (Identity + Tenancy + Engagement Structure).
// Kept small and explicit per DATA_MODEL.md's "explicit status
// fields/enums where justified" — not a placeholder for every conceivable
// future state.

export const tenantStatusEnum = pgEnum("tenant_status", ["active", "suspended"]);

export const organisationStatusEnum = pgEnum("organisation_status", [
  "active",
  "suspended",
  "offboarded",
]);

// Matches DATA_MODEL.md §3's engagement_type enum.
export const engagementTypeEnum = pgEnum("engagement_type", [
  "readiness",
  "annual_assessment",
  "dpia_programme",
  "third_party_assessment",
  "continuous_compliance",
]);

export const engagementStatusEnum = pgEnum("engagement_status", [
  "draft",
  "active",
  "closed",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

// Matches DATA_MODEL.md §2's three membership scopes.
export const roleScopeEnum = pgEnum("role_scope", [
  "tenant",
  "organisation",
  "engagement",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "revoked",
]);

export const auditActionEnum = pgEnum("audit_action", [
  "insert",
  "update",
  "delete",
]);

// --- Milestone 2 (Client Master Data, DATA_MODEL.md §5.1) ------------------

// Shared by all seven master-data identity tables. "Retired" is the only
// deactivation state this milestone needs — master data is never hard
// deleted (DATA_MODEL.md §5.1: "never deleted, only retired").
export const masterDataStatusEnum = pgEnum("master_data_status", [
  "active",
  "retired",
]);

// PersonalDataElementVersion.sensitivity_category. DATA_MODEL.md §5.1
// names the field without fixing its values; this is an engineering
// judgment call (PROGRESS.md), not a DPDP legal classification — a
// consultant can still record a more specific legal basis elsewhere
// later without this enum needing to model it.
export const dataSensitivityEnum = pgEnum("data_sensitivity", [
  "general",
  "sensitive",
  "critical",
]);

// --- Milestone 3 (Processing Activity & Version-Pinned Junction Layer) -----

// DATA_MODEL.md §5.2 names `lifecycle_status` as a ProcessingActivity
// field but does not fix its values. Milestone 3 instructions §10
// explicitly offer this exact four-state set as the expected default
// ("If the document supports states such as: Draft, Active, Under
// Review, Retired, use the documented values") — adopted as-is rather
// than inventing a competing lifecycle. No transition-rule constraint is
// enforced (any status may move to any other): DATA_MODEL.md does not
// specify transition rules, and instruction §10 says to document that
// rather than silently building workflow logic — recorded in
// DECISIONS.md.
export const processingActivityLifecycleStatusEnum = pgEnum(
  "processing_activity_lifecycle_status",
  ["draft", "active", "under_review", "retired"],
);

// ProcessingActivityProcessor.role, per DATA_MODEL.md §5.3.
export const processingActivityProcessorRoleEnum = pgEnum(
  "processing_activity_processor_role",
  ["processor", "joint_controller"],
);

// --- Milestone 4 (Regulatory Content & Control Library, DATA_MODEL.md §6) --

// RegulatoryReference.status / Requirement.status. Practice-owned
// reference data — mirrors master_data_status's two-state shape
// (DATA_MODEL.md §5.1) but is kept as its own enum, not a reuse of
// `master_data_status`: these are a structurally different concern
// (practice methodology, Tenant-scoped) from client master data
// (Organisation-scoped), and DATA_MODEL.md §12 explicitly warns against
// conflating the two. Retired reference content is never hard deleted —
// same convention as master data.
export const regulatoryContentStatusEnum = pgEnum("regulatory_content_status", [
  "active",
  "retired",
]);

// ControlLibraryVersion.status, per DATA_MODEL.md §6. A simple,
// three-state lifecycle (Milestone 4 instructions: "keep transition
// rules simple, document decisions rather than building sophisticated
// workflow logic") — draft (mutable; the only state new Controls/
// ControlRequirement mappings may be written into), published
// (immutable at the database level; what an Engagement pins to),
// retired (a superseded published version — permanently immutable, no
// longer offered for new Engagements, still referenced by old ones).
export const controlLibraryVersionStatusEnum = pgEnum("control_library_version_status", [
  "draft",
  "published",
  "retired",
]);

// Control.control_type. DATA_MODEL.md §6 names the field without fixing
// its values — an engineering judgment call (DECISIONS.md), same posture
// as Milestone 2's `data_sensitivity` enum: a small, standard, closed
// taxonomy rather than free text or an invented DPDP-specific scheme.
export const controlTypeEnum = pgEnum("control_type", [
  "preventive",
  "detective",
  "corrective",
]);

// --- Milestone 5 (Assessment Engine, DATA_MODEL.md §6) ---------------------

// Assessment.status. DATA_MODEL.md §6 names exactly two values —
// "status (DRAFT|FINALIZED)" — not the four-state draft/in-progress/
// under-review/finalized set Milestone 5 instructions §4 offer only
// conditionally ("if the approved model supports states such as...").
// The approved model (DATA_MODEL.md) supports two; implementing more
// would be exactly the "invent workflow" this project has consistently
// avoided since Milestone 3 (DECISIONS.md). "In progress" work is simply
// an Assessment whose status is still 'draft' — ordinary mutation is
// allowed for any non-finalized assessment, with no further sub-states
// tracked. See DECISIONS.md.
export const assessmentStatusEnum = pgEnum("assessment_status", ["draft", "finalized"]);

// Assessment.assessment_type, per DATA_MODEL.md §6's exact enumeration:
// "assessment_type covers CONTROL_READINESS, ANNUAL, DPIA, SDF_SCREENING,
// THIRD_PARTY — DPIA and SDF screening are specializations of Assessment,
// not disconnected modules." Only `Assessment` itself is built this
// milestone (§7's DPIA/SDFScreeningDetail 1:1 extension tables are out of
// scope — Milestone 5 instructions explicitly exclude DPIA/AI); the type
// value is still recorded so a later milestone's DPIA/SDFScreeningDetail
// tables can select on `assessment_type` without a migration to this
// enum.
export const assessmentTypeEnum = pgEnum("assessment_type", [
  "control_readiness",
  "annual",
  "dpia",
  "sdf_screening",
  "third_party",
]);

// AssessmentResponse.effectiveness_rating / system_suggested_rating /
// decision_rating all share this domain — the exact five-value vocabulary
// Milestone 5 instructions §7 require ("Not Assessed, Not Applicable, Not
// Implemented, Partially Implemented, Implemented... do not collapse
// these into a simple boolean"), which DATA_MODEL.md §6 names the field
// (`effectiveness_rating`) for but does not itself fix a value set —
// exactly the closed-taxonomy judgment-call posture already used for
// `control_type`/`data_sensitivity` (DECISIONS.md), except this taxonomy
// is dictated directly by the milestone brief rather than invented here.
export const controlEffectivenessRatingEnum = pgEnum("control_effectiveness_rating", [
  "not_assessed",
  "not_applicable",
  "not_implemented",
  "partially_implemented",
  "implemented",
]);

// ControlTest.result. DATA_MODEL.md §6 names the field without fixing its
// values — an engineering judgment call (DECISIONS.md), same posture as
// `control_type`: a small, closed taxonomy distinguishing a clean pass, a
// clean fail, and a pass-with-caveats result, rather than free text or a
// boolean. Milestone 5 instructions §9's "conclusion"/"exceptions"
// concepts, which DATA_MODEL.md's field list does not name as separate
// columns, are captured as this enum's third value plus the free-text
// `sample_description` field DATA_MODEL.md does name — see DECISIONS.md.
export const controlTestResultEnum = pgEnum("control_test_result", [
  "pass",
  "fail",
  "exception_noted",
]);
