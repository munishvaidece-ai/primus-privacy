# PRIMUS PRIVACY — Conceptual Data Model

Status: Draft v0.3 — conceptual model to guide schema design. No migrations
exist yet. Field lists are conceptual (the fields that matter for
understanding the model), not final column specs.

**Session 2 revision (2026-09-01):** resolves DECISIONS.md D-01 (Tenant
layer, §2) and D-02 (client-level master data vs. engagement-scoped
assessment objects, §5), per explicit product-owner direction. §5 is
substantially rewritten; §2, §7, §11, §12, §13 are updated for
consistency; a worked example against the product owner's FY2026/FY2027
test scenario is included at §5.5.

**Session 3 revision (2026-09-01):** consistency review — fixed a stray
`client_id`/`client_org_id` naming inconsistency in §1; closed a
historical-integrity gap in §8/§9 (`RiskScoringModel` and
`MaturityDomainWeight` made explicitly append-only/frozen-per-engagement,
DECISIONS.md R-16), no other structural changes.

This document expands and, in places, refines the entity list given in the
product brief — adding junction tables, enums, and a small number of
supporting entities the relationships require, and explicitly noting where
an entity in the brief is modeled as a specialization of another rather than
a standalone table (with rationale). Every such deviation is also logged in
DECISIONS.md.

## 1. Design Conventions Used Throughout

- Every operational table carries `client_org_id` (directly or
  transitively via `engagement_id`), and every client-owned table
  ultimately carries `tenant_id` (directly on `User`/`Organisation`,
  transitively everywhere else) — the two tenant-scoping columns checked
  by both RLS and the application authorization layer (§2, §12).
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

**Revised in Session 2 to resolve DECISION D-01** (see DECISIONS.md) — a
`Tenant` entity is introduced above `Organisation` as the outermost
isolation boundary. The MVP deployment contains exactly one `Tenant` row
(PRIMUS); the mechanism is designed so a future Phase 3 could add more
tenants without a schema/RLS redesign, without any multi-practice,
billing, or branding functionality being built now.

| Entity | Purpose | Key conceptual fields | Relationships |
|---|---|---|---|
| **Tenant** | The outermost isolation boundary — one consulting practice's entire deployment. Exactly one row in MVP. Deliberately minimal: no branding, billing, or white-label columns are added ahead of a real need for them (see DECISIONS.md D-01, D-06). | name, status, created_at | 1 Tenant → many Organisation (client); 1 Tenant → many User; 1 Tenant → many ControlLibraryVersion (methodology is practice-owned — see §6) |
| **TenantMembership** *(junction)* | Practice-wide standing roles that aren't naturally scoped to one engagement (Platform Administrator, Practice Partner). | user_id, tenant_id, role_id, status | User × Tenant × Role |
| **Organisation** | A client organisation — the primary tenant-scoped data-ownership boundary. (No longer doubles as the practice's own record — see Tenant, above.) | tenant_id, name, status | belongs to Tenant; 1 Organisation → many BusinessUnit; 1 Organisation → many Engagement; 1 Organisation → many client-side User |
| **OrganisationMembership** *(junction)* | Client-wide standing roles not naturally scoped to one engagement — primarily Client Administrator. | user_id, organisation_id, role_id, status | User × Organisation × Role |
| **BusinessUnit** | A subdivision of a Client organisation. Structural/navigational, not a compliance fact asserted during an engagement — referenced directly by identity, not version-pinned (contrast with §5's master data). Promoted to client-level **master data** under DECISION D-02, versioned per §5's mechanism if its own attributes (name, structure) need historical tracking; its use as an engagement/membership *scope*, however, always points at the current identity row. | name, parent_business_unit_id (self-referential, for hierarchy) | belongs to Organisation |
| **User** | A person with platform access. `tenant_id` is required for every user (their home practice). `client_org_id` is set only for client-side users; practice-side (PRIMUS) users have `client_org_id = NULL`. | name, email, tenant_id, client_org_id (nullable), status | belongs to Tenant; optionally belongs to Organisation; M2M Tenant via TenantMembership; M2M Organisation via OrganisationMembership; M2M Engagement via EngagementMembership |
| **Role** | A named bundle of permissions (system-defined initially; the PRIMUS-side and Client-side roles enumerated in PRODUCT_SPEC.md). | name, scope (`TENANT`&#124;`ORGANISATION`&#124;`ENGAGEMENT`), is_system_defined | M2M Permission via RolePermission |
| **Permission** | A single fine-grained capability, e.g. `assessment_response.write`, `evidence.internal.read`, `master_data.system.write`. | key, description | M2M Role via RolePermission |
| **RolePermission** *(junction)* | Which permissions a role grants. | | Role × Permission |
| **EngagementMembership** *(junction)* | The primary, most-used authorization anchor: who has what role on which engagement, optionally scoped to a business unit. | user_id, engagement_id, role_id, business_unit_id (nullable), status | User × Engagement × Role |

Three membership scopes now exist (Tenant, Organisation, Engagement) for a
reason, not by accident: they mirror the three real isolation boundaries
(practice, client, engagement) that SECURITY.md §3 enforces, and
authorization resolution unions whichever of them apply to a given
request rather than relying on one catch-all table. `EngagementMembership`
remains the boundary essentially everyone (consultants staffed on a job,
and most client-side roles) actually uses day to day; the other two exist
for the small number of roles that genuinely need standing access broader
than one engagement.

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
| **Evidence** | The compliance meaning of a stored Document: what it evidences, its quality/classification, and its visibility. `client_org_id` is always required; `engagement_id` is **nullable** (populated when evidence was collected during a specific engagement's assessment work; left null for evidence attached directly to a master-data version — e.g. a signed DPA collected during ongoing vendor management outside any formal engagement — see DECISIONS.md R-14). | client_org_id, engagement_id (nullable), document_id, title, evidence_type, quality_rating, visibility, collected_at | belongs to Organisation; optionally belongs to Engagement; references Document; M2M to its subject(s) via EvidenceLink |
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

**Implementation clarification (Milestone 6, DECISIONS.md R-57 through
R-63):** `Document` above is implemented as two tables — `Document` (a
new, mutable logical identity carrying `tenant_id`/`organisation_id`/
`engagement_id`/`title`/`document_type`/`owner_user_id`/`status`, none of
which this section's own field list names) and `DocumentVersion` (an
immutable per-upload record carrying this section's original five fields
— `storage_path, filename, mime_type, size, uploaded_by` — plus
`version_number`, `checksum_sha256`, `uploaded_at`, `scan_status`).
`Evidence.document_id` is implemented as `document_version_id`,
referencing `DocumentVersion` specifically (not `Document`), so a
historical Evidence record stays pinned to the exact file it was
collected against even as later versions of the same logical Document
are uploaded. `Evidence` additionally carries `description`,
`review_status`, `reviewed_by`, `reviewed_at`, `review_rationale`, and
`valid_until` — an evidence review lifecycle this section's field list
doesn't yet name, using exactly the four states (pending_review/
accepted/rejected/expired) required by implementation. `EvidenceLink`'s
polymorphic `subject_type`/`subject_id` pair is implemented as a
`subject_type` enum plus one nullable, genuinely-FK'd column per
supported subject type (`assessment_response_id`, `control_test_id` —
the only two subject types built so far), not a bare untyped pair — a
security-critical requirement (a bare `uuid` column cannot carry a real
foreign key, so it could never prove tenant/organisation/engagement
consistency at the database layer). See PROGRESS.md for the full
Milestone 6 report.

## 5. Data Landscape (Processing Activities and what connects to them)

**Rewritten in Session 2 to implement DECISION D-02** (DECISIONS.md).
**Processing Activity remains the hub entity of the whole model** — this
does not change. What changes is *what kind of thing* the objects around
it are: some are genuinely persistent facts about the client
(their systems, their processors, their data taxonomy) that outlive any
one engagement; others are what a specific engagement asserted or found
about how personal data was actually processed at that time. The former
are **client-level master data**; the latter are **engagement-scoped
assessment objects**. Getting this split right — and pinning the
connection between them — is what makes both "what is the client's
current state" and "what was the client's state during the FY2026
assessment" answerable without overwriting history or duplicating the
whole landscape (worked through end-to-end in §5.5).

### 5.1 Client-level master data (persistent, versioned, owned by the Organisation)

Seven entity types are master data, per direction: Business Unit, Data
Principal Category, Personal Data Element, Purpose, System, Data Store,
Processor. Each is modeled as an **identity table** (a stable id that is
never deleted, only retired) plus a **version table** implementing
Slowly-Changing-Dimension Type 2: every version row carries `valid_from`,
`valid_to` (null while current), `is_current`, and the entity's actual
descriptive fields. Editing a master record's compliance-meaningful
attributes always **inserts a new version row**; it never updates an
existing one in place (see DECISIONS.md R-12 for why this is applied
uniformly rather than only to the entities that change often).

| Identity entity | Purpose | Version entity | Version-specific fields |
|---|---|---|---|
| **BusinessUnit** | A subdivision of the client. | *(no separate version table — see §2; used structurally, not version-pinned)* | — |
| **DataPrincipalCategory** | A category of data subjects (e.g. Customers, Employees, Children). | **DataPrincipalCategoryVersion** | name, is_children_flag, description |
| **PersonalDataElement** | Catalogue entry for a data element type (e.g. PAN, email, biometric). | **PersonalDataElementVersion** | name, sensitivity_category |
| **Purpose** | A reusable purpose-of-processing taxonomy entry. | **PurposeVersion** | name, description |
| **System** | An IT system/application. | **SystemVersion** | name, owner, hosting_environment |
| **DataStore** | A data repository within a System. | **DataStoreVersion** | name, storage_type, location; `system_version_id` (which System version this data store belonged to at the time — a data store can move between systems over time) |
| **Processor** | An external processor. Self-referential `parent_processor_id` on the **identity** row represents a subprocessor chain (unchanged from the original design — a subprocessor is structurally identical to a processor, so no separate table). | **ProcessorVersion** | name (a processor can be legally renamed/re-badged without changing identity), dpa_document_id, dpa_version_label, risk_tier |

Every identity table carries `client_org_id` (its tenant/client owner —
master data belongs to the client, not to any one engagement) and a
`status` (`ACTIVE`/`RETIRED`) for entities no longer in use. Every version
table carries `created_by`/`created_at` per the usual convention (§1) so
each version change is itself attributable and audited.

**Implementation clarification (Milestone 2, DECISIONS.md R-25):** every
version table also denormalizes its own `organisation_id`, constrained by
a composite FK back to its identity table's `(id, organisation_id)` —
not called out above since it follows directly from this section's own
design rather than changing it, but recorded here because it materially
shaped the RLS policies (DECISIONS.md R-25 explains why: it lets every
policy check organisation scope off the row's own column, with no
subquery back into the table it's protecting). `ProcessorVersion.
dpa_document_id` is deferred until a Document/Evidence table exists to
reference (DECISIONS.md R-29); `dpa_version_label` and `risk_tier` are
implemented as-is.

**"What is the client's current state" query:** identity row JOIN its
version row `WHERE is_current = true` — no engagement involved at all.
This is what a client-wide Data Inventory / Processor Register "current
state" view reads from directly.

### 5.2 Engagement-scoped assessment objects (created fresh per engagement)

Processing Activity, Data Flow, Assessment (+ its children), Evidence,
DPIA, AI Use Case (+ its Assessment), Risk, Finding, Remediation Action,
Maturity Assessment, and Quality Review are all scoped to one `Engagement`
and are never mutated by a later engagement (per direction). §6–§10 cover
the assessment-engine, risk/finding/remediation, and maturity members of
this list in detail; this section covers the two that sit directly in the
Data Landscape:

| Entity | Purpose | Key fields |
|---|---|---|
| **ProcessingActivity** | The central hub, scoped to one engagement. `carried_forward_from_id` links to the prior engagement's row for the *same logical* processing activity, so continuity is traceable without one mutable row being shared (and silently rewritten) across engagements. | engagement_id, name, description, business_unit_id, owner_user_id, lifecycle_status, lawful_basis, carried_forward_from_id (nullable, self-referential across engagements) |
| **DataFlow** | Movement of data between two endpoints, as it stood during this engagement. Each endpoint is polymorphic and — when it targets a master-data entity — carries the version pin (see §5.3) alongside the identity reference. | engagement_id, source_type, source_id, source_version_id (nullable, when source is master data), destination_type, destination_id, destination_version_id (nullable), is_cross_border, transfer_mechanism |

`RetentionRule`, `Notice`, and `ConsentMechanism` remain attached to
`ProcessingActivity` (hence engagement-scoped) exactly as originally
modeled — the product owner's master-data list did not name them, so this
session leaves them as-is rather than expanding that list unilaterally
(see DECISIONS.md R-15 for the non-blocking note that `Notice` in
particular could plausibly move to the master-data tier later using the
same mechanism).

**Implementation clarification (Milestone 3, DECISIONS.md R-32/R-33):**
`ProcessingActivity` also denormalizes `organisation_id`/`tenant_id`
(not listed above, which names only `engagement_id` — the organisation/
tenant are implied transitively through it) for the same reason every
denormalized scope column since Milestone 1 exists: a composite FK to
`Engagement`'s own `(id, organisation_id, tenant_id)` makes the copy
provably consistent, and RLS checks it directly with no join. `lifecycle_
status` is implemented as `draft`/`active`/`under_review`/`retired`
(DECISIONS.md R-32); no transition-rule constraint exists yet. `DataFlow`
(row above) remains unbuilt — not part of Milestone 3's scope
(DECISIONS.md R-36).

### 5.3 Connecting the two tiers: version-pinned junctions

`ProcessingActivity`'s many-to-many junctions to master data are the
crucial mechanism. Each one stores **both** the master identity id (for
"what does this client currently look like, and which engagements have
touched this System/Processor/…" queries) **and** the specific
`*_version_id` that was current when the engagement asserted the
relationship (for "what did this look like when the FY2026 assessment
ran" queries):

- `ProcessingActivityDataPrincipalCategory` — `data_principal_category_id`, `data_principal_category_version_id`
- `ProcessingActivityPersonalDataElement` — `personal_data_element_id`, `personal_data_element_version_id`, plus a per-link sensitivity note
- `ProcessingActivityPurpose` — `purpose_id`, `purpose_version_id`
- `ProcessingActivitySystem` — `system_id`, `system_version_id`
- `ProcessingActivityDataStore` — `data_store_id`, `data_store_version_id`
- `ProcessingActivityProcessor` — `processor_id`, `processor_version_id`, plus a `role` attribute (`PROCESSOR` or `JOINT_CONTROLLER`)
- `ProcessingActivityNotice` — unchanged (`Notice` stays engagement-scoped, §5.2)

`EngagementBusinessUnitScope` and `EngagementMembership.business_unit_id`
(§2, §3) reference `business_unit_id` directly, **not** a version — these
are structural/administrative associations ("which part of the client
does this engagement cover"), not compliance facts asserted during the
engagement, so version-pinning doesn't apply to them (see §2's
`BusinessUnit` row for this same distinction). `ProcessingActivity.
business_unit_id` gets the same direct-reference treatment for the same
reason (DECISIONS.md R-37).

**Implementation clarification (Milestone 3, DECISIONS.md R-34):** each
junction's FK to a version table is implemented as a *triple* composite
key — `(x_version_id, x_id, organisation_id) REFERENCES
x_versions(id, x_id, organisation_id)` — not the version table's own
pairwise `(id, organisation_id)` uniqueness from §5.1. The extra column
proves the pinned version genuinely belongs to the specific master
entity the junction also names (not just to the right organisation),
closing a gap a pairwise check alone would leave open. Junction rows are
insert/delete only — never updated in place (DECISIONS.md R-35): a
changed pin is a removed link plus a new one, not an edited row.

**Service-layer rule, not a schema-level guarantee:** when a consultant
links a `ProcessingActivity` to a piece of master data, the domain service
resolves and stores whichever version is currently `is_current = true` at
that moment as the pin — the schema permits pinning to any version
(useful for the "carry forward" action in §5.4, which deliberately
re-resolves to the *new* current version rather than copying the old
pin), but ordinary linking always pins to "now."

### 5.4 Carrying a Processing Activity forward into a new engagement

When a new engagement opens for a client with a prior engagement,
consultants use an explicit "carry forward" action (not an automatic
background process) per processing activity that's still relevant: it
creates a **new** `ProcessingActivity` row in the new engagement, sets
`carried_forward_from_id` to the prior engagement's row, copies the
descriptive fields as a starting point, and re-creates each master-data
junction **re-resolved to each master entity's current version** at the
time of carry-forward (not the old pin) — reflecting that the new
engagement is assessing the client's *current* systems/processors/data,
starting from where the last engagement left off. The consultant then
edits from there (adds/removes systems, swaps a processor, etc.) as the
new engagement's discovery work finds changes. The prior engagement's
`ProcessingActivity` row, and everything it pinned to, is never touched.

### 5.5 Worked example — testing the mechanism against the FY2026 → FY2027 scenario

This is the scenario the product owner specified, walked through against
the model above to confirm it actually holds:

> Client: ABC Financial Services. Engagement 1: DPDP Readiness — FY2026.
> Engagement 2: Annual DPDP Assessment — FY2027. FY2026: Processing
> Activity PA-014 uses System A, which stores data in Data Store A;
> Processor XYZ processes the data, DPA version 1. FY2027: PA-014 is
> still relevant; System A has changed; Processor XYZ has been replaced
> by Processor ABC; the DPA has changed; the processing activity has been
> reassessed.

**FY2026 (Engagement 1), as recorded at the time:**

- `ProcessingActivity` row `PA-014-E1` (`engagement_id = E1`,
  `carried_forward_from_id = NULL`).
- Master data already exists or is created during discovery: `System`
  identity `SYS-A` with `SystemVersion SYS-A-v1` (`is_current = true` at
  the time); `DataStore` identity `DS-A` with `DataStoreVersion DS-A-v1`;
  `Processor` identity `PROC-XYZ` with `ProcessorVersion PROC-XYZ-v1`
  (`dpa_version_label = "v1"`).
- Junctions: `ProcessingActivitySystem(PA-014-E1, SYS-A, SYS-A-v1)`,
  `ProcessingActivityDataStore(PA-014-E1, DS-A, DS-A-v1)`,
  `ProcessingActivityProcessor(PA-014-E1, PROC-XYZ, PROC-XYZ-v1, role=PROCESSOR)`.
- The FY2026 Assessment finalizes; `AssessmentResponse` rows for the
  controls covering PA-014 become read-only (§6).

**Between engagements, master data changes independently:**

- System A is materially changed (e.g. a re-platforming): a new
  `SystemVersion SYS-A-v2` is inserted, `SYS-A-v1.valid_to` is set,
  `SYS-A-v2.is_current = true`. `SYS-A` the identity row is unchanged.
- Processor XYZ is dropped and Processor ABC is engaged instead: this is
  **not** a version change on `PROC-XYZ` — a new, separate `Processor`
  identity `PROC-ABC` is created (or already existed as unrelated master
  data) with its own current `ProcessorVersion PROC-ABC-v1`
  (`dpa_version_label = "v1"` for *this* processor). `PROC-XYZ`'s own
  identity and version history are untouched — it simply stops being
  referenced by any *current* engagement's junctions going forward, while
  remaining exactly as it was for anyone querying FY2026.
- (If, instead, XYZ itself had simply renewed its DPA rather than being
  replaced, that would be a new `ProcessorVersion PROC-XYZ-v2` on the
  *same* `PROC-XYZ` identity — the model handles both cases, and they are
  distinguishable in the data: same identity id with a new version vs. a
  different identity id entirely.)

**FY2027 (Engagement 2), created via carry-forward from FY2026:**

- New `ProcessingActivity` row `PA-014-E2` (`engagement_id = E2`,
  `carried_forward_from_id = PA-014-E1`) — same logical activity, new
  engagement-scoped row, per §5.4.
- Carry-forward re-resolves each junction to current versions: System →
  `SYS-A-v2` (System A's new state), Data Store → `DS-A`'s then-current
  version. Processor: the consultant removes the `PROC-XYZ` link (no
  longer applicable) and adds `ProcessingActivityProcessor(PA-014-E2,
  PROC-ABC, PROC-ABC-v1, role=PROCESSOR)` during FY2027 discovery, once
  the replacement is confirmed.
- FY2027's assessment reassesses PA-014 against current controls,
  producing new `AssessmentResponse`/`ControlTest` rows tied to `E2`,
  independent of FY2026's.

**Both required questions are now answerable, without ambiguity:**

1. *"What is the client's current state?"* — query `System`/`Processor`/…
   identity rows joined to their `is_current = true` version, entirely
   independent of any engagement; separately, query the *latest*
   engagement's (`E2`'s) `ProcessingActivity` set and junctions for the
   currently-assessed operational picture (which processing activities
   use which processor, right now).
2. *"What was the client's state when the FY2026 assessment was
   performed?"* — query `E1`'s `ProcessingActivity` rows and their
   junctions exactly as they were pinned: `PA-014-E1` → `SYS-A-v1`,
   `DS-A-v1`, `PROC-XYZ-v1` (DPA v1). This result is unaffected by
   `SYS-A-v2`, `PROC-ABC`, or the FY2027 engagement existing at all —
   nothing was overwritten to produce either answer, and no full
   duplicate of ABC Financial's data landscape was created to preserve
   FY2026's picture — only the version rows that actually changed, plus
   one new `ProcessingActivity` row per carried-forward activity, were
   added.

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

**Implementation clarification (Milestone 5, DECISIONS.md R-49/R-50/R-51):**
`Assessment` additionally denormalizes `organisation_id`, `tenant_id`, and
`control_library_version_id` (not listed in the field column above, which
predates this level of cross-table consistency enforcement) — the last of
these makes "an Assessment uses the same ControlLibraryVersion as its
Engagement" and "an AssessmentControl only references a Control from that
same ControlLibraryVersion" both database-enforced composite-FK
invariants rather than application checks. `Assessment.status` is
implemented as exactly the two values already named here
(`DRAFT`/`FINALIZED`); the four-state draft/in-progress/under-review/
finalized workflow some later planning documents may suggest was not
built — "in progress" is simply an Assessment that is still `DRAFT`.
`AssessmentControl` carries no fields beyond the junction itself;
`AssessmentResponse` (not `AssessmentControl`) is where per-control
assessment state lives, matching this section's own field list. See
PROGRESS.md for the full Milestone 5 report, including the still-open
Milestone 4 limitation that published `Requirement` content is not
independently frozen by a `ControlLibraryVersion`'s publish state
(unaddressed this milestone — out of scope).

**Implementation clarification (Milestone 4, DECISIONS.md R-40/R-42/R-43):**
this milestone implements `RegulatoryReference`, `Requirement`,
`RequirementRegulatoryReference`, `ControlLibraryVersion`, `Control`, and
`ControlRequirement` only (`Assessment` and everything below it in this
table remain out of scope, as this section already says). All six
implemented tables denormalize `tenant_id` directly (not listed in the
field columns above, which predate the Tenant/Practice split) — `Control`
also carries it despite belonging to a `ControlLibraryVersion`, so its own
RLS/triggers never need to join out to resolve tenancy. `Requirement` is
**not** scoped to a `ControlLibraryVersion` (no such column) — it is
shared across library versions by design (R-43), which is what makes a
Requirement like "R1" meaningfully the same object when referenced from
both an older and a newer library version. A new library version's
Controls are new rows (new `id`, same `code`), not new rows in a
version-table chained to a shared identity row — the client SCD2 pattern
(§5.1) is deliberately not reused here (R-42). `ControlLibraryVersion.status`
is `draft`/`published`/`retired`; a `Control` (and its `ControlRequirement`
mappings) may only be inserted, updated, or deleted while its own
`control_library_version_id`'s version is `draft` — enforced by database
triggers, not the application layer, satisfying "published methodology
cannot be modified through ordinary application paths" (R-44/R-45).

## 7. DPIA, SDF Screening & AI Use Case

Per the brief, these must **not** be disconnected modules. They reuse the
Assessment engine rather than duplicating an evidence/finding/risk workflow
of their own:

| Entity | Purpose | Key fields |
|---|---|---|
| **DPIA** | A 1:1 extension of an `Assessment` (`assessment_type = DPIA`) carrying DPIA-specific fields. All evidence, findings, risks and control links use the *same* junction mechanisms as everything else. | assessment_id (1:1), necessity_proportionality_narrative, system_suggested_high_risk_flag, consultant_conclusion, consultation_notes |
| **SDFScreeningDetail** | A 1:1 extension of an `Assessment` (`assessment_type = SDF_SCREENING`) for Significant-Data-Fiduciary / children / high-risk screening. | assessment_id (1:1), methodology_version, system_suggested_candidate_flag, consultant_conclusion, decision_rationale |
| **DPIAProcessingActivity** *(junction)* | Which processing activities a DPIA covers. | | DPIA × ProcessingActivity |
| **AIUseCase** | A catalog object (structurally like ProcessingActivity) describing a specific AI use case — engagement-scoped, with its own `carried_forward_from_id` chain, following the same pattern as ProcessingActivity (§5.2/§5.4) rather than being added to the master-data tier, since the product owner's D-02 direction named "AI Use Case Assessments" as engagement-scoped and did not include AI Use Cases in the master-data list — see DECISIONS.md R-13. | engagement_id, name, description, lifecycle_status, carried_forward_from_id (nullable) |
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

**`RiskScoringModel` is append-only, like `ControlLibraryVersion` (§6),
for the same reason:** `Risk.risk_scoring_model_id` pins each risk to the
specific matrix that produced its `inherent_rating`/`residual_rating`, and
those rating fields are themselves stored, computed-once values, not
derived live from the model at read time. Editing an existing
`RiskScoringModel` row's `matrix_definition` in place would silently
change the documented basis for every risk already scored against it —
exactly the kind of retroactive rewrite this architecture is built to
prevent. A change to the scoring approach creates a **new**
`RiskScoringModel` row (new `version`); existing `Risk` rows keep pointing
at the version they were actually scored under until a consultant
explicitly re-scores them (producing new stored rating values, same
row or a new one per the engagement's own change-tracking, not a
silent recalculation).

**Enforced flow (application-layer state machine, not a convention):**
`RemediationAction.status → EVIDENCE_SUBMITTED` requires linked Evidence to
exist → a `ValidationRecord` is created by a consultant → *only* a
`ValidationRecord` with `outcome = ACCEPTED` may trigger a new `ControlTest`
/ `AssessmentResponse` on the associated control → *that* is what the
Maturity engine reads. Marking a `RemediationAction` "closed" has no direct
effect on maturity.

**Implementation clarification (Milestone 7, DECISIONS.md R-66 through
R-71):** all entities and junctions in this section's table are now
implemented. Several additive fields exist beyond the literal field
lists above, each recorded in DECISIONS.md R-66: `Risk.assessment_
response_id` (nullable — makes this section's own "Assessment Response
→ Risk" relationship, named in prose elsewhere in this document, a real
FK) and `Risk.previous_risk_id` (nullable self-reference, for a
superseding-record chain when a risk is recalculated); `Finding.owner_
id`; `RemediationAction.description`, `RemediationAction.priority`
(nullable), and `RemediationAction.completed_at` (nullable, recording
*when* completion happened, not only that `status` reached `closed`);
`ValidationRecord.rationale`. No field already named above was renamed,
removed, or given different semantics.

**Implementation clarification (Slice C3.1, DECISIONS.md R-101):**
`Risk.owner_id` is now enforced tenant-scoped at the database level — a
composite foreign key `(owner_id, tenant_id) → users(id, tenant_id)`
(backed by a new `UNIQUE (id, tenant_id)` constraint on `users`)
replaces what had been a plain `owner_id → users(id)` reference. No
field was renamed, removed, or given different application-level
semantics — `owner_id` still identifies the same single user a Risk is
assigned to; only its referential-integrity guarantee was strengthened
to match the tenant boundary every other engagement-scoped relationship
in this document already enforces.

**Implementation clarification (Slice C4, DECISIONS.md R-102):**
`Finding.owner_id` received the identical tenant-scoping hardening —
found in the same unprotected shape `Risk.owner_id` had before Slice
C3.1, and closed the same way, reusing the same `UNIQUE (id, tenant_id)`
constraint on `users`. No field was renamed, removed, or given
different application-level semantics.

**Implementation clarification (Slice C5, DECISIONS.md R-104):**
`RemediationAction.owner_id` received the identical tenant-scoping
hardening — the third and, for this project's current schema, final
instance of this pattern (after `Risk.owner_id`/`Finding.owner_id` in
Slices C3.1/C4). No field was renamed, removed, or given different
application-level semantics.

`ValidationRecord.triggers_control_reassessment_id` is implemented as
two separate nullable FK columns (`triggers_control_test_id`/
`triggers_assessment_response_id`), one per target table, mirroring
`EvidenceLink`'s own per-subject-type-nullable-column pattern (§4) —
the same reason applies: a real foreign key can only target one table.
At most one may be set (CHECK constraint), and only when `outcome =
ACCEPTED` (CHECK constraint), matching this section's own "Enforced
flow" paragraph exactly. Both FKs are scoped to `organisation_id` only,
**not** `engagement_id` — DECISIONS.md R-70 records why: this project's
own established pattern (§5.5's FY2026/FY2027 worked example) is that
each assessment cycle is a new Engagement of the same Organisation, so
the reassessment a `ValidationRecord` points to routinely lives in a
*later* Engagement than the remediation itself. `EvidenceLink` was
extended with two more nullable subject-type columns (`remediation_
action_id`, `validation_record_id`) for this section's own "`Evidence`
attaches to `RemediationAction` and `ValidationRecord`" sentence.

`ValidationRecord` is mutable in one narrow, deliberate sense: its
decision fields (`outcome`/`validated_by`/`validated_at`/`rationale`)
are permanently frozen after creation by a trigger, but the two
reassessment-trigger columns above may be set exactly once, later, from
`NULL` — because the reassessment they point to often does not exist
yet at the moment the validation decision itself is recorded (DECISIONS.md
R-69). This section's own "Enforced flow" state machine
(`OPEN → IN_PROGRESS → EVIDENCE_SUBMITTED → VALIDATED → CLOSED`, and
"EVIDENCE_SUBMITTED requires linked Evidence to exist") is implemented
exactly as this section frames it — an application-layer concern, not a
database-enforced precondition (DECISIONS.md R-71); the database does
enforce, and this milestone's tests directly verify, the one guarantee
this section states as non-negotiable: `RemediationAction.status`
changes never themselves alter a Risk, a Finding, an AssessmentResponse,
or any Maturity signal — only an explicit `ValidationRecord` does that,
and only by recording that a reassessment happened, never by performing
one automatically.

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
a direct user edit to a score. The same rule as `RiskScoringModel` applies
to `MaturityDomainWeight`: it is engagement-scoped (one weight per
engagement+domain) and is never edited after the engagement's
`MaturityScore` rows have been computed from it — a re-weighting is a
change for the *next* engagement/period, not a retroactive edit to a prior
one's already-computed, stored `MaturityScore`. This is what makes
"maturity calculations are reproducible for a historical assessment" hold:
`MaturityScore.computed_from_control_test_ids` traces to specific
`ControlTest` rows, which trace to a specific `Assessment`, which used a
specific, by-then-frozen `MaturityDomainWeight` set — none of which a later
engagement's configuration changes can reach back and alter.

**Implementation clarification (Milestone 8, DECISIONS.md R-72 through
R-80):** all entities in this section's table are now implemented, plus
one additive grouping entity, `MaturityAssessment`, this table's own
prose already implies ("a computed, versioned snapshot... for a given
Assessment/period" describes one coherent unit) but does not name as a
separate row — it anchors one finalized `Assessment` and one pinned
`MaturityScoringMethodology` (below) that a `MaturityAssessment`'s own
set of `MaturityScore` rows hang off of, and is the row this section's
own finalization/reproducibility guarantee actually locks (R-72).
`MaturityScoringMethodology` (Tenant-scoped, append-only, mirrors
`RiskScoringModel`'s exact shape) is the "configurable scoring
methodology" this section's own second paragraph implies but does not
name explicitly — the vehicle for the rating-to-domain-score mapping and
maturity-level thresholds a real Maturity engine would read, never
hard-coded (R-73). No production domain taxonomy, scoring weights,
maturity levels, or thresholds were invented here — every domain/
methodology this milestone's own tests create is explicitly named as
synthetic/test content, not PRIMUS's eventual proprietary methodology.

`MaturityScore.score` is stored per the 1–5 scale this section already
specifies; `maturity_level` is an additive field (a resolved,
human-readable label from the pinned methodology's own level-threshold
table, stored once at computation time — not derived live at read time,
matching `AssessmentResponse.effectiveness_rating`'s own posture). No
scoring *engine* exists yet — this milestone builds and tests the data
structures a future engine would read and write, the same posture
`RiskScoringModel` already established for Risk (Milestone 7): nothing
in this schema computes a `MaturityScore` value automatically; every
score in this milestone's own tests is written directly, simulating what
a future engine's calculation would produce.

Two additive traceability arrays, `computed_from_risk_ids`/`computed_
from_validation_record_ids` (on `MaturityAssessment`, mirroring this
section's own `computed_from_control_test_ids` field on `MaturityScore`
exactly), record which `Risk`/`ValidationRecord` rows were available and
considered at computation time, satisfying this document's own "Risk...
residual risk" and "Remediation/Validation... validated remediation
outcomes" source-signal language without duplicating either table. Like
`computed_from_control_test_ids` itself, these are plain arrays, not
foreign-key-enforced per element (R-79) — and, per the architecture's own
explicit caution against inventing an unapproved Risk-to-Maturity or
Validation-to-Maturity formula, neither array's contents are yet
mathematically factored into any stored score; the open methodology
question is preserved, not silently resolved (R-79/R-80).

**Implementation clarification (Milestone 8A, DECISIONS.md R-81/R-82):**
`MaturityScore` additionally carries `domain_name_snapshot`/`domain_
code_snapshot`/`domain_description_snapshot` (nullable; present only on
a per-domain row, never the overall row), populated once by a database
trigger at the moment the row is created and never application-settable.
This closes the one limitation Milestone 8's own report identified:
`MaturityDomain` (still deliberately unversioned — no change from R-74)
remains ordinarily mutable, so a domain's `name`/`description` could be
renamed or revised after a `MaturityScore` had already been computed
against it; the snapshot is what makes that historical score's *domain
identity/definition*, not only its numeric result, permanently
reproducible regardless of any later change to the live `MaturityDomain`
row. No existing entity, field, versioning mechanism (`MaturityScoring
Methodology`, `MaturityDomainWeight`), or finalization rule
(`MaturityAssessment`) was altered.

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

- Tenant 1 —→ N Organisation (client); Tenant 1 —→ N User. Exactly one
  Tenant row exists in MVP (DECISIONS.md D-01).
- Organisation (CLIENT) 1 —→ N Engagement (never deleted; historical
  engagements retained indefinitely).
- Organisation 1 —→ N master-data identity rows (BusinessUnit,
  DataPrincipalCategory, PersonalDataElement, Purpose, System, DataStore,
  Processor); each identity 1 —→ N of its own version rows, exactly one of
  which has `is_current = true` at any moment (§5.1).
- Engagement 1 —→ N ProcessingActivity (engagement-scoped, per D-02);
  ProcessingActivity 0..1 —→ (self, across engagements) via
  `carried_forward_from_id` (§5.4).
- ProcessingActivity N ←→ N master data — DataPrincipalCategory,
  PersonalDataElement, Purpose, System, DataStore, Processor — via
  junctions that each carry both the master identity id and the pinned
  version id (§5.3). ProcessingActivity N ←→ N Notice (engagement-scoped,
  unchanged).
- Processor 1 —→ N Processor (self-referential, subprocessor chain, on
  the **identity** row — unaffected by version-pinning).
- Control N ←→ N Requirement; Requirement N ←→ N RegulatoryReference
  (secondary citations only — primary is 1:N).
- Assessment 1 —→ N AssessmentControl —→ 1 AssessmentResponse each.
- Risk N ←→ N ProcessingActivity; Risk N ←→ N Control.
- Finding N ←→ N Risk, Control, ProcessingActivity.
- RemediationAction N ←→ N Finding, Risk, Control.
- Evidence N ←→ N (any subject type) via `EvidenceLink` — genuinely
  many-to-many: one piece of evidence (e.g. one signed DPA) can support
  multiple control tests and multiple processing activities at once, and
  (since `Evidence.engagement_id` is nullable, R-14) can attach directly to
  a master-data version rather than to any one engagement.

## 12. Ownership, Versioning & Audit History (cross-cutting)

- **Ownership:** `Tenant` sits above everything (§2). Every client-owned
  entity carries `client_org_id` (directly or via `engagement_id`) as its
  tenant-of-record; `Organisation.tenant_id` places it under the Practice
  tenant. `Control`, `Requirement`, `RegulatoryReference` belong to the
  **Practice** (via `Tenant` and `ControlLibraryVersion`), never to a
  client — this is the concrete separation between "methodology" and
  "client data," unchanged by the Session 2 revision.
- **Two distinct, deliberately different versioning mechanisms exist, for
  two different concerns — do not conflate them:**
  1. **Methodology versioning** (`ControlLibraryVersion`,
     `RegulatoryReference.version`) — the Practice's control library and
     regulatory content evolve independently of any client; an
     `Engagement` pins to one `control_library_version_id` at creation.
     This is a *practice-owned* version chain.
  2. **Client master-data versioning** (§5.1's SCD2 pattern:
     `SystemVersion`, `ProcessorVersion`, etc.) — a specific client's
     factual record of their own systems/processors/data evolves
     independently of any engagement; an engagement-scoped junction pins
     to whichever version was current when the engagement asserted the
     relationship (§5.3). This is a *client-owned* version chain,
     introduced in Session 2 to resolve D-02.
  Both exist so that "what did we assess against" stays answerable for
  historical periods on both axes (methodology *and* client facts) even as
  both keep evolving for the client's ongoing (and future clients')
  engagements.
- **Engagement/assessment-instance versioning** (unchanged):
  `Engagement.previous_engagement_id` and
  `Assessment.previous_assessment_id` chains, and `ProcessingActivity`/
  `AIUseCase`'s own `carried_forward_from_id` chains (new in Session 2,
  §5.4) — new period, new row, old row untouched.
  `MaturityScore` is itself an immutable, timestamped snapshot per
  assessment period, which is what makes trend comparison possible.
- **Audit history:** every write from the domain/service layer that
  touches a material entity (defined in SECURITY.md §6) produces one
  `AuditLog` row — including the creation of a new master-data version row
  (a `System` or `Processor` change is exactly the kind of material change
  §6 requires logging). This is separate from — and does not replace —
  point-in-time snapshots like `MaturityScore` or a pinned
  `ProcessorVersion`; the audit log answers "what changed and who changed
  it," snapshots/version-pins answer "what did we conclude/reference at
  this point in time."

## 13. Open Items Feeding This Model

D-01 and D-02 (previously open here) were resolved by explicit
product-owner direction in Session 2 — see DECISIONS.md for the resolved
decisions and this document's §2/§5 for the resulting model. One item from
the original list remains genuinely open and unchanged:

- **§5.1 (DataPrincipalCategory), §5.2 (ConsentMechanism)** — whether the
  platform will ever store actual individual data-principal PII (DSR
  requests, consent-receipt transactions), which has its own significant
  privacy/security implications for a *privacy platform itself*. Still
  DECISION REQUIRED (DECISIONS.md D-04); not touched by the D-01/D-02
  resolution.

Two new, non-blocking notes were added by this session's resolution work
(recorded in DECISIONS.md, not escalated, since neither changes the shape
of the first migration):

- Whether `Notice`, `RetentionRule`, and `ConsentMechanism` should also
  move to the master-data tier (DECISIONS.md R-15).
- Whether `AIUseCase` should eventually gain its own master-data tier
  rather than being purely engagement-scoped (DECISIONS.md R-13).
