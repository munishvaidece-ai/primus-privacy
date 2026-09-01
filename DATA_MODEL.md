# PRIMUS PRIVACY — Conceptual Data Model

Status: Draft v0.1 — conceptual model to guide schema design. No migrations
exist yet. Field lists are conceptual (the fields that matter for
understanding the model), not final column specs.

This document expands and, in places, refines the entity list given in the
product brief — adding junction tables, enums, and a small number of
supporting entities the relationships require, and explicitly noting where
an entity in the brief is modeled as a specialization of another rather than
a standalone table (with rationale). Every such deviation is also logged in
DECISIONS.md.

## 1. Design Conventions Used Throughout

- Every operational table carries `client_id` (directly or transitively via
  `engagement_id`) — the tenant-scoping column checked by both RLS and the
  application authorization layer.
- Every material table carries `created_by`, `created_at`,
  `updated_by`, `updated_at`.
- Any field that is a **system suggestion** is paired with a **human
  decision** field and, where the decision overrides or rejects the
  suggestion, a rationale: `system_suggested_value`, `decision_value`,
  `decided_by`, `decided_at`, `decision_rationale`. This pattern recurs on
  `AssessmentResponse`, `Risk`, `ApplicabilityDetermination`,
  `SDFScreeningDetail`, and `DPIA`. It is the concrete implementation of
  "system recommendations may be generated, consultants must review, accept,
  modify or reject them."
- Any field visible only to the consulting practice carries an explicit
  `visibility` enum (`CONSULTANT_INTERNAL` | `CLIENT_VISIBLE`), never an
  implicit "don't show this in the client UI" convention.
- Polymorphic associations (one entity attaching to many different entity
  types — Evidence, Notes, Tasks) are modeled as a junction table with
  `(subject_type, subject_id)` rather than a nullable foreign key per
  possible target, so the set of attachable entities can grow without
  schema churn on the attaching entity itself.

## 2. Identity & Tenancy

| Entity | Purpose | Key conceptual fields | Relationships |
|---|---|---|---|
| **Organisation** | The tenant boundary. `type` = `PRACTICE` (PRIMUS, a singleton) or `CLIENT`. | name, type, status | 1 Organisation → many BusinessUnit; 1 Organisation → many Engagement (as client); 1 Organisation → many User (home org) |
| **BusinessUnit** | Optional subdivision of a Client organisation. | name, parent_business_unit_id (self-referential, for hierarchy) | belongs to Organisation |
| **User** | A person with platform access. | name, email, home_organisation_id, status | belongs to Organisation (home org); M2M Engagement via EngagementMembership |
| **Role** | A named bundle of permissions (system-defined initially; the PRIMUS-side and Client-side roles enumerated in PRODUCT_SPEC.md). | name, scope (`PRACTICE`&#124;`CLIENT`), is_system_defined | M2M Permission via RolePermission |
| **Permission** | A single fine-grained capability, e.g. `assessment_response.write`, `evidence.internal.read`. | key, description | M2M Role via RolePermission |
| **RolePermission** *(junction)* | Which permissions a role grants. | | Role × Permission |
| **EngagementMembership** *(junction)* | The primary authorization anchor: who has what role on which engagement, optionally scoped to a business unit. | user_id, engagement_id, role_id, business_unit_id (nullable), status | User × Engagement × Role |

## 3. Engagement Structure

| Entity | Purpose | Key fields | Relationships |
|---|---|---|---|
| **Engagement** | A discrete, time-bounded piece of work for a client (e.g. "DPDP Readiness & Implementation — FY2026"). Historical engagements are never overwritten. | client_org_id, name, engagement_type (`READINESS`&#124;`ANNUAL_ASSESSMENT`&#124;`DPIA_PROGRAMME`&#124;`THIRD_PARTY_ASSESSMENT`&#124;`CONTINUOUS_COMPLIANCE`&#124;…), period_start, period_end, status (`DRAFT`&#124;`ACTIVE`&#124;`CLOSED`), control_library_version_id, previous_engagement_id (nullable, for period-over-period comparability) | belongs to Organisation (client); has EngagementMembership; is the scoping parent of nearly every entity below |
| **EngagementBusinessUnitScope** *(junction)* | Restricts an engagement to specific business units, when not practice-wide. | | Engagement × BusinessUnit |

## 4. Discovery, Applicability & Evidence

| Entity | Purpose | Key fields | Relationships |
|---|---|---|---|
| **Task** | Generic, assignable to-do, reused across every workflow (discovery requests, evidence requests, remediation due dates, review reminders). | engagement_id, assignee_id, title, status, due_date | polymorphic link via TaskLink |
| **TaskLink** *(junction, polymorphic)* | What a Task is about. | subject_type, subject_id | Task × any entity |
| **Note** | Free-text comment/annotation, with explicit visibility. | engagement_id, author_id, body, visibility | polymorphic link via NoteLink |
| **NoteLink** *(junction, polymorphic)* | What a Note is attached to. | subject_type, subject_id | Note × any entity |
| **Document** | A stored file's technical metadata (storage path, hash, mime type, size, scan status). | storage_path, filename, mime_type, size, uploaded_by | referenced by Evidence |
| **Evidence** | The compliance meaning of a stored Document within an engagement: what it evidences, its quality/classification, and its visibility. | engagement_id, document_id, title, evidence_type, quality_rating, visibility, collected_at | belongs to Engagement; references Document; M2M to its subject(s) via EvidenceLink |
| **EvidenceLink** *(junction, polymorphic)* | What a piece of Evidence supports — a ControlTest, AssessmentResponse, Finding, RemediationAction, DPIA, ApplicabilityDetermination, ProcessingActivity, etc. | evidence_id, subject_type, subject_id | Evidence × any entity |
| **ApplicabilityDetermination** | Records which regulatory obligations apply to the engagement/client (or a scoped part of it), with rationale — never an unreviewed auto-conclusion. | engagement_id, scope_description, system_suggested_value, decision_value, decision_rationale, decided_by, decided_at | belongs to Engagement; M2M RegulatoryReference |
| **ApplicabilityDeterminationRegulatoryReference** *(junction)* | | | ApplicabilityDetermination × RegulatoryReference |

`Document` vs `Evidence` vs `Policy`: the brief lists "Policy / Document" as
one entity and "Evidence" separately. These are modeled as: `Document` is
the storage-technical wrapper for any uploaded file (a policy PDF, a
screenshot, a contract); `Evidence` is what gives a `Document` compliance
meaning inside an engagement (what it evidences, its quality, its
visibility). A client policy upload is simply a `Document` of
`document_type = POLICY`, optionally linked as `Evidence` to whatever it
supports. This avoids a duplicated "policy library" existing alongside the
evidence store.

## 5. Data Landscape (Processing Activities and what connects to them)

**Processing Activity is the hub entity of the whole model.** Every other
Data-Landscape object exists to describe *how* a processing activity
actually processes personal data, and connects to it via a many-to-many
junction (a processing activity commonly involves multiple systems,
multiple data elements, multiple processors, and so on — and a given
system, purpose, or processor is commonly shared across multiple processing
activities).

| Entity | Purpose | Key fields |
|---|---|---|
| **ProcessingActivity** | The central hub. | engagement_id, name, description, business_unit_id, owner_user_id, lifecycle_status, lawful_basis |
| **DataPrincipalCategory** | A *category* of data subjects (e.g. Customers, Employees, Children, Vendor Contacts) — a taxonomy entry, not a record of an actual natural person (see DECISIONS.md §D-04 — DECISION REQUIRED on whether individual data-principal PII is ever stored). | engagement_id, name, is_children_flag |
| **PersonalDataElement** | Catalogue of data element types (e.g. PAN, email, biometric) with sensitivity classification. | engagement_id, name, sensitivity_category |
| **Purpose** | Purpose of processing (reusable taxonomy). | engagement_id, name, description |
| **System** | An IT system/application. | engagement_id, name, owner |
| **DataStore** | A data repository within a System (DB, file share, SaaS module). | system_id, name, storage_type, location |
| **Processor** | An external processor. Self-referential `parent_processor_id` represents a **subprocessor** — a subprocessor is a Processor whose parent is another Processor, not a separate table, because a subprocessor is structurally identical to a processor and this correctly supports arbitrary subprocessor chains. | engagement_id, name, parent_processor_id (nullable), dpa_document_id |
| **DataFlow** | Movement of data between two endpoints (each endpoint is a ProcessingActivity, System, DataStore, or Processor — polymorphic). | engagement_id, source_type, source_id, destination_type, destination_id, is_cross_border, transfer_mechanism |
| **RetentionRule** | Retention policy for a PersonalDataElement within a ProcessingActivity. | processing_activity_id, personal_data_element_id, trigger_event, retention_period, disposal_method |
| **Notice** | A privacy notice (versioned document) covering one or more purposes/processing activities. | engagement_id, document_id, version, effective_date |
| **ConsentMechanism** | Describes *how* consent is obtained for a processing activity (mechanism, granularity, withdrawal method) — a compliance-documentation record, not a per-data-principal consent transaction log (that is a distinct, larger product — see DECISIONS.md §D-04 and ROADMAP.md). | processing_activity_id, mechanism_description, withdrawal_method |

**Junction tables (many-to-many) connecting ProcessingActivity to the above:**

- `ProcessingActivityDataPrincipalCategory`
- `ProcessingActivityPersonalDataElement` (with a per-link sensitivity note)
- `ProcessingActivityPurpose`
- `ProcessingActivitySystem`
- `ProcessingActivityDataStore`
- `ProcessingActivityProcessor` (with a `role` attribute: `PROCESSOR` or
  `JOINT_CONTROLLER`)
- `ProcessingActivityNotice`

## 6. Regulatory Content, Controls & Assessment Engine

Regulatory content and the control library are explicitly separate from
client engagement data (principle 9), and are independently **versioned**
so that an engagement can pin to the framework version in effect when its
assessment was performed, while the library itself keeps evolving.

| Entity | Purpose | Key fields |
|---|---|---|
| **RegulatoryReference** | A citable provision (e.g. DPDP Act 2023, specific section). Framework-agnostic so other regulations can be added later without a schema change. | framework_name, citation, title, version |
| **Requirement** | An obligation derived from one or more RegulatoryReferences. | primary_regulatory_reference_id, title, description |
| **RequirementRegulatoryReference** *(junction)* | Secondary/cross citations, when a requirement draws on more than one reference. | | Requirement × RegulatoryReference |
| **ControlLibraryVersion** | A named, dated snapshot of the control library — what an Engagement pins to. | version_label, published_at, status |
| **Control** | A reusable control definition belonging to a ControlLibraryVersion. | control_library_version_id, code, title, description, control_type |
| **ControlRequirement** *(junction)* | A control can satisfy multiple requirements; a requirement can be satisfied by multiple controls. | | Control × Requirement |
| **Assessment** | One instance of assessing a defined set of controls within an Engagement over a period. `assessment_type` covers `CONTROL_READINESS`, `ANNUAL`, `DPIA`, `SDF_SCREENING`, `THIRD_PARTY` — DPIA and SDF screening are **specializations of Assessment**, not disconnected modules (see §7). | engagement_id, assessment_type, period_label, status (`DRAFT`&#124;`FINALIZED`), previous_assessment_id (nullable) |
| **AssessmentControl** *(junction)* | The specific controls in scope for this assessment instance. | | Assessment × Control |
| **AssessmentResponse** | The actual result for one AssessmentControl: effectiveness rating, narrative, respondent — carries the system-suggestion/decision pattern. | assessment_control_id, effectiveness_rating, system_suggested_rating, decision_rating, decision_rationale, respondent_id, submitted_at | 
| **ControlTest** | A specific test performed against a control: methodology, sample, result. | control_id, assessment_id (nullable — a test can also occur outside a formal assessment cycle, e.g. continuous monitoring), methodology, sample_description, result, tester_id, tested_at |

Once an `Assessment.status = FINALIZED`, its `AssessmentResponse` rows
become read-only at the application layer. A correction after
finalization is made by opening a new `Assessment` (linked via
`previous_assessment_id`) rather than mutating history — this is what makes
"compare posture across assessment periods" possible and satisfies
"historical assessments must remain intact."

## 7. DPIA, SDF Screening & AI Use Case

Per the brief, these must **not** be disconnected modules. They reuse the
Assessment engine rather than duplicating an evidence/finding/risk workflow
of their own:

| Entity | Purpose | Key fields |
|---|---|---|
| **DPIA** | A 1:1 extension of an `Assessment` (`assessment_type = DPIA`) carrying DPIA-specific fields. All evidence, findings, risks and control links use the *same* junction mechanisms as everything else. | assessment_id (1:1), necessity_proportionality_narrative, system_suggested_high_risk_flag, consultant_conclusion, consultation_notes |
| **SDFScreeningDetail** | A 1:1 extension of an `Assessment` (`assessment_type = SDF_SCREENING`) for Significant-Data-Fiduciary / children / high-risk screening. | assessment_id (1:1), methodology_version, system_suggested_candidate_flag, consultant_conclusion, decision_rationale |
| **DPIAProcessingActivity** *(junction)* | Which processing activities a DPIA covers. | | DPIA × ProcessingActivity |
| **AIUseCase** | A catalog object (like ProcessingActivity) describing a specific AI use case. | engagement_id, name, description, lifecycle_status |
| **AIUseCaseProcessingActivity**, **AIUseCaseSystem**, **AIUseCaseProcessor**, **AIUseCaseDataStore** *(junctions)* | Connects an AI use case into the same underlying data/system/processor model rather than a parallel one. | | |

The system may compute `system_suggested_high_risk_flag` /
`system_suggested_candidate_flag` from processing characteristics (e.g.
children's data present, large-scale sensitive processing) — but these are
**candidate indicators only**. `consultant_conclusion` is a separate,
required, human-authored field, and no code path treats the system flag as
the conclusion. Children's-data and other high-risk processing is
represented through `DataPrincipalCategory.is_children_flag` and the
ordinary processing/data model, feeding these specialized assessments —
not a bespoke "children module."

## 8. Risk, Findings & Remediation

| Entity | Purpose | Key fields |
|---|---|---|
| **RiskScoringModel** | A configurable likelihood × impact → rating matrix, versioned. Risk scoring logic reads this table; it is not scattered as hard-coded thresholds in application code. | name, version, matrix_definition (structured, e.g. JSONB grid), is_active |
| **Risk** | A risk register entry. | engagement_id, title, description, likelihood, impact, inherent_rating, residual_likelihood, residual_impact, residual_rating, risk_scoring_model_id, status, owner_id |
| **RiskProcessingActivity**, **RiskControl** *(junctions)* | | | Risk × ProcessingActivity, Risk × Control |
| **Finding** | An identified issue/gap. | engagement_id, title, description, severity, status |
| **FindingRisk**, **FindingControl**, **FindingProcessingActivity** *(junctions)* | | | Finding × Risk, Finding × Control, Finding × ProcessingActivity |
| **RemediationAction** | Tracks the fix for one or more findings. | engagement_id, title, owner_id, due_date, status (`OPEN`&#124;`IN_PROGRESS`&#124;`EVIDENCE_SUBMITTED`&#124;`VALIDATED`&#124;`CLOSED`) |
| **RemediationFinding**, **RemediationRisk**, **RemediationControl** *(junctions)* | | | RemediationAction × Finding/Risk/Control |
| **ValidationRecord** | The explicit consultant-validation step between "evidence submitted" and "control reassessment" — makes the required sequence a real, auditable object rather than an implicit status flip. | remediation_action_id, validated_by, validated_at, outcome, triggers_control_reassessment_id (nullable FK to a new ControlTest/AssessmentResponse) |

`Evidence` attaches to `RemediationAction` and `ValidationRecord` via the
same generic `EvidenceLink` used everywhere else.

**Enforced flow (application-layer state machine, not a convention):**
`RemediationAction.status → EVIDENCE_SUBMITTED` requires linked Evidence to
exist → a `ValidationRecord` is created by a consultant → *only* a
`ValidationRecord` with `outcome = ACCEPTED` may trigger a new `ControlTest`
/ `AssessmentResponse` on the associated control → *that* is what the
Maturity engine reads. Marking a `RemediationAction` "closed" has no direct
effect on maturity.

## 9. Maturity

| Entity | Purpose | Key fields |
|---|---|---|
| **MaturityDomain** | A configurable scoring domain (e.g. "Governance", "Data Management", "Third-Party Risk"). | name, description |
| **MaturityDomainWeight** | Configurable weight of a domain within a given engagement/period — not hard-coded. | engagement_id, maturity_domain_id, weight |
| **MaturityDomainControlMapping** *(junction)* | Which controls feed which domain's score. | | MaturityDomain × Control |
| **MaturityScore** | A computed, versioned snapshot: per-domain scores and an overall weighted score for a given Assessment/period. Never directly user-editable. | engagement_id, assessment_id, maturity_domain_id (nullable for the overall row), score (1–5 scale), computed_at, computed_from_control_test_ids (traceability) |

`MaturityScore` rows are produced only by the Maturity engine's
recalculation routine, triggered by an accepted `ValidationRecord` leading
to a control reassessment, or by a new `Assessment` finalization — never by
a direct user edit to a score.

## 10. Audit, Quality Review & Reporting

| Entity | Purpose | Key fields |
|---|---|---|
| **AuditLog** | Append-only record of every material change. No UPDATE/DELETE grants at the database level. | actor_user_id, client_org_id, engagement_id, entity_type, entity_id, action, field_changes (structured diff), reason (nullable, used for overrides), occurred_at, ip_address |
| **QualityReview** | Practice-internal QA/peer-review of engagement work product, performed by the Auditor role, before it reaches the client. This is the interpretation used for the brief's "Audit" entity — kept distinctly named from `AuditLog` to avoid confusion between a compliance audit trail and a quality-review workflow object (see DECISIONS.md). | engagement_id, reviewer_id, scope_description, outcome, sign_off_at |
| **Notification** | In-app notification to a user, generated from Task/workflow events. | user_id, subject_type, subject_id, message, read_at |

Reports (ROPA export, risk register export, engagement summary, board
report) are generated on demand from queries over the entities above,
filtered by the requester's role/visibility scope — there is no separate
"reporting" table that duplicates this data.

## 11. Cardinality Summary (selected, non-obvious relationships)

- Organisation (CLIENT) 1 —→ N Engagement (never deleted; historical
  engagements retained indefinitely).
- Engagement 1 —→ N ProcessingActivity, but see §12 for the open question
  on whether Data-Landscape objects are engagement-local or persist across
  engagements for the same client.
- ProcessingActivity N ←→ N: DataPrincipalCategory, PersonalDataElement,
  Purpose, System, DataStore, Processor, Notice.
- Processor 1 —→ N Processor (self-referential, subprocessor chain).
- Control N ←→ N Requirement; Requirement N ←→ N RegulatoryReference
  (secondary citations only — primary is 1:N).
- Assessment 1 —→ N AssessmentControl —→ 1 AssessmentResponse each.
- Risk N ←→ N ProcessingActivity; Risk N ←→ N Control.
- Finding N ←→ N Risk, Control, ProcessingActivity.
- RemediationAction N ←→ N Finding, Risk, Control.
- Evidence N ←→ N (any subject type) via `EvidenceLink` — genuinely
  many-to-many: one piece of evidence (e.g. one signed DPA) can support
  multiple control tests and multiple processing activities at once.

## 12. Ownership, Versioning & Audit History (cross-cutting)

- **Ownership:** every entity from §3 onward carries `client_org_id`
  (directly or via `engagement_id`) as its tenant owner. `Control`,
  `Requirement`, `RegulatoryReference` belong to the **Practice**
  organisation and its `ControlLibraryVersion`, never to a client — this is
  the concrete separation between "methodology" and "client data."
- **Versioning:**
  - Regulatory/methodology content versions via `ControlLibraryVersion` /
    `RegulatoryReference.version`; an `Engagement` pins to one
    `control_library_version_id` at creation.
  - Client engagement history versions via `Engagement.previous_engagement_id`
    and `Assessment.previous_assessment_id` chains — new period, new row,
    old row untouched.
  - `MaturityScore` is itself an immutable, timestamped snapshot per
    assessment period, which is what makes trend comparison possible.
- **Audit history:** every write from the domain/service layer that
  touches a material entity (defined in SECURITY.md §6) produces one
  `AuditLog` row. This is separate from — and does not replace —
  point-in-time snapshots like `MaturityScore`; the audit log answers "what
  changed and who changed it," snapshots answer "what did we conclude at
  this point in time."

## 13. Open Items Feeding This Model

Two modeling choices here are marked DECISION REQUIRED in DECISIONS.md
because they materially affect this schema and cannot be safely assumed:

- **§5 / §12** — whether Data-Landscape objects (ProcessingActivity and
  everything under it) are engagement-scoped and re-created each
  engagement, or persist as a living record across a client's engagements
  with per-engagement snapshots at finalization. The model above assumes
  engagement-scoped with an explicit `previous_engagement_id` linkage as
  the default, recommended posture — pending confirmation.
- **§5 (DataPrincipalCategory, ConsentMechanism)** — whether the platform
  will ever store actual individual data-principal PII (DSR requests,
  consent-receipt transactions), which has its own significant privacy/
  security implications for a *privacy platform itself*.
