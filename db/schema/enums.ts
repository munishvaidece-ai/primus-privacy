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

// --- Milestone 6 (Evidence & Document Management, DATA_MODEL.md §4) -------

// Document.status. A simple lifecycle — active (in use) / archived (no
// longer current, but its DocumentVersions remain forever, per Milestone
// 6 instructions §14's immutability requirement). Not part of
// DATA_MODEL.md's current Document field list — see DECISIONS.md for why
// `Document` was split into `Document`/`DocumentVersion` this milestone.
export const documentStatusEnum = pgEnum("document_status", ["active", "archived"]);

// Document.document_type. DATA_MODEL.md §4's own prose gives one worked
// example ("a client policy upload is simply a Document of document_type
// = POLICY") without fixing the full value set — an engineering judgment
// call, same posture as `control_type`/`data_sensitivity` (DECISIONS.md).
export const documentTypeEnum = pgEnum("document_type", [
  "policy",
  "contract",
  "screenshot",
  "certificate",
  "report",
  "system_configuration",
  "other",
]);

// DocumentVersion.scan_status. DATA_MODEL.md §4 names "scan status" as
// part of a Document's technical metadata. Malware scanning itself is
// explicitly deferred (DECISIONS.md D-05, SECURITY.md §5) — this column
// exists so a future scanning integration has somewhere to write its
// result; nothing in this milestone runs a scanner, so every row stays
// 'pending' in practice. See documents.ts for the one narrow exception
// to DocumentVersion's otherwise-total immutability this column gets.
export const documentVersionScanStatusEnum = pgEnum("document_version_scan_status", [
  "pending",
  "clean",
  "flagged",
]);

// Evidence.evidence_type. DATA_MODEL.md §4 names the field without fixing
// values — an engineering judgment call matching `control_type`'s posture.
export const evidenceTypeEnum = pgEnum("evidence_type", [
  "policy_document",
  "screenshot",
  "system_configuration_export",
  "signed_agreement",
  "certificate",
  "other",
]);

// Evidence.quality_rating. DATA_MODEL.md §4 names the field without
// fixing values — same posture.
export const evidenceQualityRatingEnum = pgEnum("evidence_quality_rating", [
  "strong",
  "adequate",
  "weak",
]);

// Evidence.visibility — the CONSULTANT_INTERNAL/CLIENT_VISIBLE distinction
// SECURITY.md §2/§5 already name explicitly (unchanged by this
// milestone: "Preserve the existing visibility model" — Milestone 6
// instructions §12). Stored so the application layer can enforce it on
// every read, exactly as SECURITY.md's existing two-layer model already
// specifies — RLS deliberately does not encode this distinction (see
// DECISIONS.md).
export const evidenceVisibilityEnum = pgEnum("evidence_visibility", [
  "client_visible",
  "consultant_internal",
]);

// Evidence.review_status — Milestone 6 instructions §13's exact four
// states. DATA_MODEL.md's current Evidence field list does not yet name a
// review workflow at all; this is a genuine additive clarification (see
// DECISIONS.md), not an invented complex workflow — exactly the four
// states instructed, no more.
export const evidenceReviewStatusEnum = pgEnum("evidence_review_status", [
  "pending_review",
  "accepted",
  "rejected",
  "expired",
]);

// EvidenceLink.subject_type — deliberately a small, closed set covering
// only the subject types wired up so far, not an open-ended polymorphic
// type column. See evidence-links.ts / DECISIONS.md for the
// "safer/stronger approach" Milestone 6 instructions §7 asked for in
// place of a bare, unconstrained (subject_type, subject_id) pair.
// `remediation_action`/`validation_record` are Milestone 7 additions —
// DATA_MODEL.md §8 states directly "Evidence attaches to RemediationAction
// and ValidationRecord via the same generic EvidenceLink used everywhere
// else," exactly the extension path Milestone 6's own DECISIONS.md R-60
// anticipated ("one more nullable column and one more CHECK branch").
export const evidenceLinkSubjectTypeEnum = pgEnum("evidence_link_subject_type", [
  "assessment_response",
  "control_test",
  "remediation_action",
  "validation_record",
]);

// --- Milestone 7 (Risk, Findings & Remediation, DATA_MODEL.md §8) ---------

// Risk.inherent_rating / residual_rating. DATA_MODEL.md §8 names both
// fields without fixing a value set — an engineering judgment call
// (DECISIONS.md), matching `control_type`'s posture: a small, standard
// four-point taxonomy rather than an unbounded scale.
export const riskRatingEnum = pgEnum("risk_rating", ["low", "medium", "high", "critical"]);

// Risk.status. DATA_MODEL.md §8 names the field without fixing values —
// a simple, ordinary risk-register lifecycle (Milestone 7 instructions
// §16: "do not invent a complex workflow if the current architecture
// does not define one"). No transition-rule constraint is enforced, same
// posture as ProcessingActivity.lifecycle_status (Milestone 3).
export const riskStatusEnum = pgEnum("risk_status", ["open", "mitigating", "accepted", "closed"]);

// Finding.severity. DATA_MODEL.md §8 names the field without fixing
// values — same four-point posture as `risk_rating`, for consistency
// across the two closely-related taxonomies.
export const findingSeverityEnum = pgEnum("finding_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

// Finding.status. DATA_MODEL.md §8 names the field without fixing
// values. `accepted` covers a Finding a consultant/client deliberately
// chooses not to remediate (a legitimate, common GRC outcome), distinct
// from `resolved` (remediated and validated).
export const findingStatusEnum = pgEnum("finding_status", [
  "open",
  "in_progress",
  "resolved",
  "accepted",
]);

// RemediationAction.status — DATA_MODEL.md §8 fixes this exact five-value
// set verbatim: "OPEN|IN_PROGRESS|EVIDENCE_SUBMITTED|VALIDATED|CLOSED".
// Implemented as-is, lowercased to match this project's enum-naming
// convention throughout.
export const remediationActionStatusEnum = pgEnum("remediation_action_status", [
  "open",
  "in_progress",
  "evidence_submitted",
  "validated",
  "closed",
]);

// RemediationAction.priority. Milestone 7 instructions §6 name "priority"
// as an expected field; DATA_MODEL.md's own field list doesn't yet
// include it (an additive clarification — DECISIONS.md), reusing the
// same four-point taxonomy as `risk_rating`/`finding_severity` for
// consistency.
export const remediationPriorityEnum = pgEnum("remediation_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

// ValidationRecord.outcome. DATA_MODEL.md §8's own prose names exactly
// one value directly ("only a ValidationRecord with outcome = ACCEPTED
// may trigger a new ControlTest/AssessmentResponse") — a simple binary
// decision (accepted/rejected), not an invented multi-state workflow
// (Milestone 7 instructions §16).
export const validationOutcomeEnum = pgEnum("validation_outcome", ["accepted", "rejected"]);

// --- Milestone 8 (Maturity, DATA_MODEL.md §9) ------------------------------

// MaturityAssessment.status. Not a field DATA_MODEL.md's own §9 table
// names — MaturityAssessment itself is a Milestone 8 additive entity (see
// maturity-assessments.ts / DECISIONS.md). A simple two-state lifecycle,
// deliberately mirroring `assessment_status` (Milestone 5) exactly rather
// than a distinct enum with the same two values: Milestone 8 instructions
// §12 explicitly say "if the current architecture defines only a simple
// finalized state, implement that rather than inventing a complex
// workflow" — this is that same simple state, reusing the identical
// draft/finalized vocabulary already approved for the entity Maturity
// consumes (Assessment) rather than inventing a parallel naming scheme.
export const maturityAssessmentStatusEnum = pgEnum("maturity_assessment_status", [
  "draft",
  "finalized",
]);
