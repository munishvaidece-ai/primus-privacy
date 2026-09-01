# PRIMUS PRIVACY — Product / UX Integration Blueprint

Status: Draft v1.0 — planning document, Session 13, 2026-09-01. Produced
after Milestones 1-8A (Identity/Tenancy through Historical Maturity
Integrity Hardening) were implemented, tested, and approved — see
PROGRESS.md for the full build record. **No application code, migration,
schema change, or UI component was created in this session.** This
document is the only repository change.

This blueprint designs the product/UX layer that sits on top of the
already-built, already-tested domain model. It does not re-litigate any
approved architecture decision (ARCHITECTURE.md, SECURITY.md,
DATA_MODEL.md, DECISIONS.md) — it reads those documents as the
authoritative source and designs screens, navigation, and workflow
around them, exactly as instructed. Every entity named below is either
(a) an implemented, migrated, tested table (Milestones 1-8A) or (b) an
entity DATA_MODEL.md describes but that has no migration yet — every
instance of (b) is explicitly labeled **[NOT YET BUILT]** the first time
it is used in each section, so this document never quietly implies more
backend exists than actually does.

## 0. Lovable prototype accessibility

**Lovable prototype not accessible from this environment.** Both the
`WebFetch` tool and a direct `curl` to
`https://id-preview--5037a5f6-5eb1-4c80-acbb-6f342bbb9d81.lovable.app/app`
were attempted; both were blocked by this session's network egress proxy
(`EGRESS_BLOCKED` / HTTP `403` on the CONNECT tunnel — a network-level
block, not a transient failure). No screenshots, exported prototype
files, or Lovable artifacts exist anywhere in this repository (searched
for `*lovable*`, `*screenshot*`, `*mockup*`, `*wireframe*`, and common
image/design-file extensions — none found). Per instruction, nothing
about the Lovable prototype's actual screens, layout, or visual language
is asserted anywhere in this document — §10 (Lovable → PRIMUS mapping)
and §20 (design-system recommendation) are built entirely from
PRODUCT_SPEC.md/ARCHITECTURE.md and are explicitly marked as such.

---

## 1. Executive Summary

The backend built across Milestones 1-8A is, in a specific and important
sense, **already MVP-workflow-complete**: every entity the MVP end-to-end
workflow in PRODUCT_SPEC.md §3 and this blueprint's own §12 needs
already exists as a real, tested, RLS-protected PostgreSQL table —
Organisation → Engagement → Processing Activity → Control Assessment →
Evidence → Risk → Finding → Remediation → Validation → Maturity, with
tenant/organisation/engagement isolation, historical immutability, and
audit logging verified by 370 passing tests against real PostgreSQL.
**Nothing in the application layer exists yet.** `app/` contains exactly
two placeholder files (`layout.tsx`, `page.tsx`); there is no
authentication wiring, no Server Action, no route beyond the Next.js
default shell, no UI component, and no read model. The gap between
"backend is done" and "product is usable" is entirely an application/UX
gap, not a domain-model gap — which is the central, load-bearing finding
of this blueprint and the reason its recommended build sequence (§23)
starts with authentication and the engagement workspace shell, not with
any single business feature.

A second, equally load-bearing finding: **the current schema has no
field- or row-level visibility model for anything except `Evidence`**
(and, transitively, `Document`). `Risk`, `Finding`, `RemediationAction`,
`AssessmentResponse`, and `ValidationRecord` carry no `visibility`
column at all — SECURITY.md §4's stated mitigation ("sensitive fields are
dropped server-side, not hidden by the client") is sufficient to build a
correct client-visible view *without* a schema change, but only if the
application layer is disciplined about it from the first screen built.
This blueprint treats that discipline as a first-class design constraint
throughout, not an afterthought (§9).

The recommended path: build the application shell and authentication
first (Phase A, §23), then the Organisation/Engagement workspace, then
one true vertical slice through the full Assessment→Evidence→Risk→
Finding→Remediation→Validation chain end-to-end against real Postgres
data (§14) before building any further breadth. Maturity, reporting, and
the client portal follow once that slice is proven. DPIA/SDF, Notice/
Consent/DataFlow, Task/Notification, and AI features remain exactly
where PRODUCT_SPEC.md and ROADMAP.md already put them — Phase 2/3 — and
this blueprint does not move them earlier.

---

## 2. Current Backend Capability

Implemented, migrated (18 migration files, `0000`-`0017`), RLS-enabled,
and tested (370 tests, run twice, real PostgreSQL 16) as of Milestone 8A:

| Domain area | Entities (table name) | Status |
|---|---|---|
| Identity & Tenancy | `tenants`, `organisations`, `users`, `roles`, `permissions`, `role_permissions`, `tenant_memberships`, `organisation_memberships`, `engagement_memberships`, `engagements` | Built |
| Audit | `audit_log` (append-only, no UPDATE/DELETE grant) | Built |
| Client Master Data (SCD2) | `business_units`, `data_principal_categories`(+versions), `personal_data_elements`(+versions), `purposes`(+versions), `systems`(+versions), `data_stores`(+versions), `processors`(+versions) | Built |
| Processing Activities | `processing_activities` + 6 version-pinned junctions to master data | Built |
| Regulatory & Control Library | `regulatory_references`, `requirements`, `requirement_regulatory_references`, `control_library_versions`, `controls`, `control_requirements` | Built |
| Assessment Engine | `assessments`, `assessment_controls`, `assessment_responses`, `control_tests` | Built |
| Evidence & Documents | `documents`, `document_versions`, `evidence`, `evidence_links` | Built (storage layer is a placeholder — see §21) |
| Risk, Findings, Remediation | `risk_scoring_models`, `risks`, `risk_controls`, `risk_processing_activities`, `findings` + 3 junctions, `remediation_actions` + 3 junctions, `validation_records` | Built |
| Maturity | `maturity_scoring_methodologies`, `maturity_domains`, `maturity_domain_weights`, `maturity_domain_control_mappings`, `maturity_assessments`, `maturity_scores` (+ Milestone 8A domain-definition snapshot) | Built |

**Described in DATA_MODEL.md, not yet migrated (`[NOT YET BUILT]`):**
`DPIA`, `SDFScreeningDetail`, `AIUseCase`, `Notice`, `RetentionRule`,
`ConsentMechanism`, `DataFlow`, `Task`/`TaskLink`, `Notification`,
`QualityReview`, `ApplicabilityDetermination`. None of these are
required for the MVP workflow this blueprint recommends (§9/§12); every
one is explicitly out of MVP scope per PRODUCT_SPEC.md §5 already.

**Application layer: nothing exists.** No Supabase Auth integration, no
Server Action, no Route Handler, no authorization-resolution module, no
Zod schema, no read model/view, no UI component beyond the two
placeholder files noted in §1. `app/` is the Next.js default shell only.

---

## 3. Consultant User Journey

The consultant's actual working unit is **the engagement**, not the
platform globally — a consultant staffed across three clients spends
nearly all working time inside one engagement at a time, needs to switch
between engagements quickly, and needs the platform's own methodology
(control library, risk-scoring model, maturity methodology) to be
reachable but clearly separated from any one client's data. Concretely:

1. **Login** → lands on a personal dashboard (§13: "active engagements
   I'm staffed on," not a firm-wide summary a Consultant has no
   permission to see in full).
2. **Choose an Organisation** (client) — either from the dashboard's
   engagement list directly, or via an Organisations list for anyone with
   `OrganisationMembership`/`TenantMembership` breadth (Practice
   Partner/Platform Administrator).
3. **Choose an Engagement** under that Organisation — most day-to-day
   consultants never see another client's Organisation list at all
   (`EngagementMembership` only), and that is correct, not a UX
   limitation to work around.
4. **Inside the engagement**, work moves through the same broadly linear
   order DATA_MODEL.md's own object graph and PRODUCT_SPEC.md §3 already
   describe: Setup → Data Landscape/ROPA → Assessment → Evidence → Risk →
   Findings → Remediation → Validation → Maturity → Reports — implemented
   as a **persistent engagement navigation shell** (§7), not a wizard the
   consultant is forced through in order; a consultant returns to any of
   these areas at any time within an active engagement.
5. **Methodology work** (control library authoring, risk-scoring-model/
   maturity-methodology configuration) is a **separate, Tenant-scoped
   area outside any Organisation/Engagement**, reachable from global
   navigation, visible only to roles holding `TenantMembership` — this
   mirrors the schema's own hard separation (`Control`/
   `RiskScoringModel`/`MaturityScoringMethodology` are Tenant-owned
   practice content, never duplicated per client, DATA_MODEL.md §12) and
   must not be presented inside an Engagement's own navigation, where a
   consultant could mistakenly believe an edit is scoped to one client.

## 4. Client User Journey

The client user's working unit is narrower still: **their organisation's
current, active engagement** (or, once Continuous Compliance exists as a
real engagement type in production, an ongoing programme rather than a
single dated project). A client user should never need to understand
"Tenant" or see PRIMUS's other clients exist at all.

1. **Login** → lands directly on their organisation's active-engagement
   summary — no Organisation-picker step for the common case of one
   active engagement (a multi-engagement client, e.g. one for FY2026
   Readiness and a separate Continuous Compliance engagement, gets a
   simple picker, not a full Organisations list UI).
2. **Within the engagement**, the client sees a narrower slice of the
   same object graph the consultant works in — never a separate,
   duplicated "client view" data model (PRODUCT_SPEC.md's own governing
   principle: one source of truth). What differs is *visibility and
   write scope*, not the underlying entities:
   - **See**: their own Processing Activities/data landscape (read, and
     depending on role, contribute to); assessment progress and
     (client-visible) results; requested evidence items and their own
     uploads; findings and remediation actions assigned to them;
     maturity results once the consultant has released them; the final
     report.
   - **Do**: upload evidence against a request; provide/confirm business
     context on their own Processing Activities and master data
     (Business Owner/IT-CISO/Procurement roles); mark their own
     Remediation Actions' progress (never finalize `status = validated`
     — only a consultant `ValidationRecord` does that, per DATA_MODEL.md
     §8's own CRITICAL rule, and the UI must never suggest otherwise).
   - **Never see**: consultant-internal Evidence/Notes
     (`visibility = consultant_internal`, enforced server-side already
     by SECURITY.md §2/§5); assessor rationale fields on internal
     working drafts before a result is released (an application-layer
     convention this blueprint recommends — see §9's visibility
     discipline, since no schema column enforces it yet for
     non-Evidence entities); any other client's data (enforced by RLS
     regardless of UI).
3. There is **no client-side "Organisations" or "Methodology" area at
   all** — those concepts don't exist for a client user; their entire
   navigation surface is engagement-scoped.

---

## 5. Screen Inventory

Legend — **Phase**: `MVP` / `P2` (Should-have, follows shortly) / `Later`
(deliberately deferred). **New backend?**: `No` (fully supported today)
/ `App-layer only` (needs Server Actions/read-models but no schema
change) / `Yes — [entity]` (needs a `[NOT YET BUILT]` entity from §2).

| # | Screen | User | Purpose | Backend entities (read) | Backend entities (write) | Permissions | Key actions | Phase | New backend? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Login | Both | Authenticate | `users` | — (Supabase Auth session) | none (pre-auth) | Sign in, forgot password | MVP | App-layer only (Supabase Auth wiring) |
| 2 | Consultant Dashboard | Consultant | "My engagements," at-a-glance status | `engagements`, `engagement_memberships`, `assessments`, `findings`, `remediation_actions` | — | any `EngagementMembership` | Open an engagement | MVP | App-layer only |
| 3 | Organisations list | Consultant (Tenant/Org-wide roles) | Find/onboard a client | `organisations` | `organisations` (create) | `TenantMembership` (broad roles) | Create Organisation, search | MVP | No |
| 4 | Organisation Home | Consultant | Client home: business units, engagements, master-data landscape | `organisations`, `business_units`, `engagements` | `business_units` | `OrganisationMembership` or any `EngagementMembership` on that client | Open/create Engagement, edit Business Units | MVP | No |
| 5 | Client Master Data (tabs: Data Principal Categories / Personal Data Elements / Purposes / Systems / Data Stores / Processors) | Consultant, Client (IT-CISO/Procurement contribute) | The client's persistent compliance facts (SCD2) | `*_versions` tables (current + history) | new version rows (never edits current row) | `OrganisationMembership` / relevant `EngagementMembership` | Add/edit (creates new version), view history | MVP | App-layer only |
| 6 | Engagement Setup | Consultant | Type, period, control-library-version pin, scope | `engagements`, `control_library_versions` | `engagements` (pin, status) | `Engagement Manager` role | Set control library version, activate/close | MVP | No |
| 7 | Engagement Membership | Consultant (Engagement Manager) | Staff the engagement | `engagement_memberships`, `users` | `engagement_memberships` | `membership.manage` | Add/revoke member+role | MVP | No |
| 8 | Engagement Overview | Both | Engagement-scoped status dashboard | `assessments`, `findings`, `remediation_actions`, `maturity_assessments` (all engagement-scoped) | — | any `EngagementMembership` | Navigate to any engagement area | MVP | App-layer only (read model, §16) |
| 9 | Processing Activities / ROPA (list + detail) | Both (client contributes) | The connective hub — how personal data actually flows | `processing_activities` + 6 junctions | `processing_activities`, junctions | `OrganisationMembership`/`EngagementMembership` | Create/edit activity, link master data, carry forward from prior engagement | MVP | No |
| 10 | Control Library browse (read, within engagement) | Both | See what's in scope for this engagement's pinned version | `control_library_versions`, `controls`, `requirements`, `regulatory_references` | — | any `EngagementMembership` | Browse controls/requirements | MVP | No |
| 11 | Assessment workspace (Assessment → AssessmentControl grid → AssessmentResponse) | Consultant (client sees released results) | The core control-assessment workflow | `assessments`, `assessment_controls`, `assessment_responses`, `control_tests`, evidence summaries | `assessment_responses`, `control_tests`, `assessments` (finalize) | assessment-response write role; finalize = Engagement Manager | Record response, run/record a control test, link evidence, finalize assessment | MVP | No |
| 12 | Evidence Library | Both (client uploads/sees client-visible only) | Central evidence store for the engagement | `documents`, `document_versions`, `evidence`, `evidence_links` | `documents`, `document_versions`, `evidence`, `evidence_links` | write role + `visibility` check on read | Upload, link to subject, review/accept/reject, download (signed URL) | MVP | Yes — real Storage/signed URLs (§21) |
| 13 | Risk Register (list + detail) | Consultant (client sees released risks) | Risk identification and scoring | `risks`, `risk_scoring_models`, `risk_controls`, `risk_processing_activities` | `risks`, junctions | risk-write role | Create risk, score (pinned model), link control/PA | MVP | No |
| 14 | Findings (list + detail) | Consultant (client sees assigned) | Identified gaps | `findings` + 3 junctions | `findings`, junctions | finding-write role | Create finding, link risk/control/PA, set status | MVP | No |
| 15 | Remediation (list + kanban-by-status + detail) | Both (client updates own progress) | Track fixes | `remediation_actions` + 3 junctions, `evidence_links` | `remediation_actions`, junctions | remediation-write (consultant); client can update only their assigned action's non-terminal fields | Create, assign, submit evidence, change status (never to `validated` from client side) | MVP | No |
| 16 | Validation panel (embedded in Remediation detail, not a top-level screen) | Consultant only | Record the explicit accept/reject decision | `validation_records`, linked evidence | `validation_records` | consultant validation role | Validate (accepted/rejected) + rationale, later link reassessment | MVP | No |
| 17 | Maturity (Maturity Assessment detail: per-domain + overall score, trend across periods) | Both once released | The computed maturity snapshot | `maturity_assessments`, `maturity_scores`, `maturity_scoring_methodologies` | (scores are engine/consultant-written, never user-edited — DATA_MODEL.md §9) | maturity-read role; write is a controlled "compute" action | Trigger computation (consultant), finalize, view trend | MVP | App-layer only (the computation itself — see §21 gap) |
| 18 | Reports (generate/export engagement report) | Both | The client-facing deliverable | Everything above, filtered by visibility | — (generates a document, doesn't write domain data) | report-read role, visibility-filtered | Generate PDF/export, view history of generated reports | MVP | App-layer only |
| 19 | Audit Log viewer | Consultant (Tenant/Engagement-scoped) | "Who did what, when" | `audit_log` | — | `audit_log.read` | Filter by entity/actor/date | MVP | No |
| 20 | Methodology Admin — Control Library | Platform Administrator | Author/publish control library versions | `control_library_versions`, `controls`, `control_requirements` | same | `TenantMembership`, is_active_tenant_member | Draft, publish, retire a version | MVP | No |
| 21 | Methodology Admin — Regulatory Content | Platform Administrator | Regulatory references/requirements | `regulatory_references`, `requirements` | same | `TenantMembership` | Add/retire reference content | MVP | No |
| 22 | Methodology Admin — Risk Scoring Model | Platform Administrator | Configure the scoring matrix | `risk_scoring_models` | same (append-only — new version) | `TenantMembership` | Publish a new scoring-model version | MVP | No |
| 23 | Methodology Admin — Maturity Methodology | Platform Administrator | Configure domains/weights/methodology | `maturity_scoring_methodologies`, `maturity_domains`, `maturity_domain_control_mappings` | same | `TenantMembership` | Publish methodology version, edit domain, map controls | MVP | No |
| 24 | Administration — Users & Roles | Platform Administrator | User/role/membership admin | `users`, `roles`, `role_permissions`, all membership tables | same | `user.manage`/`membership.manage` | Create user, grant/revoke membership | MVP | No |
| 25 | Client Portal Dashboard | Client (any role) | Client-organisation home | `organisations`, `engagements` (their own only) | — | any client membership | Open active engagement | MVP | App-layer only |
| 26 | Client Evidence Requests | Client | "What's being asked of us" | `evidence_links` (unfulfilled), + Task **[NOT YET BUILT]** for a true request queue | `evidence`, `document_versions` | client contributor role | Upload against a request | MVP (without formal Task tracking) / P2 (with Task) | App-layer for MVP; Yes — `Task` for P2 quality |
| 27 | Client Findings/Remediation view | Client | Their own action items | `findings`, `remediation_actions` assigned to them | `remediation_actions` (progress fields) | client contributor role | Update progress, submit evidence | MVP | No |
| 28 | User Profile / Account | Both | Own profile, password | `users` | `users` (own row) | self | Edit profile | MVP | App-layer only |
| 29 | Notifications (in-app) | Both | "Something needs your attention" | Task/Notification **[NOT YET BUILT]** | same | membership-scoped | Mark read, deep-link to source | P2 | Yes — `Task`, `Notification` |
| 30 | DPIA workspace | Consultant | Data Protection Impact Assessment | `DPIA` **[NOT YET BUILT]** (specialization of Assessment) | same | engagement role | Full DPIA workflow | P2 (explicitly deferred by this milestone's own instructions) | Yes — `DPIA` |
| 31 | SDF Screening workspace | Consultant | High-risk/SDF screening | `SDFScreeningDetail` **[NOT YET BUILT]** | same | engagement role | Screening workflow | P2 | Yes — `SDFScreeningDetail` |
| 32 | Notice / Consent / Retention management | Both | Notice content, retention rules, consent mechanism description | `Notice`/`RetentionRule`/`ConsentMechanism` **[NOT YET BUILT]** | same | engagement role | CRUD | P2 | Yes |
| 33 | Data Flow diagram/view | Both | Visual flow of data between systems/processors | `DataFlow` **[NOT YET BUILT]** | same | engagement role | View/build flow | Later | Yes |
| 34 | AI Use Case tracking | Consultant | AI-system inventory (a DPDP-adjacent, not core-MVP, concern) | `AIUseCase` **[NOT YET BUILT]** | same | engagement role | CRUD | Later | Yes |
| 35 | Quality Review workflow | Auditor role | Internal QA before client delivery | `QualityReview` **[NOT YET BUILT]** | same | Auditor role | Review, sign off | P2 | Yes |
| 36 | Cross-engagement / cross-period Maturity trend dashboard | Both | Compare maturity over time across periods | `maturity_assessments` (multiple periods) | — | maturity-read role | Compare trend | P2 (explicitly named Phase 2 in ROADMAP.md) | App-layer only |
| 37 | Continuous Compliance workspace | Both | Post-engagement, ongoing operation | Same entities under a `continuous_compliance` `engagement_type` | same | engagement role | Ongoing assessment/evidence cadence | P2 | App-layer only (entity already supports the type) |
| 38 | Billing / Subscription | Client Admin, Platform Administrator | Self-serve billing | none — **D-06 undecided** | — | — | — | Later | Yes — undesigned entity, DECISION REQUIRED first |

No screen above was added merely because it "sounds useful" — every row
traces to an entity in DATA_MODEL.md and a step in PRODUCT_SPEC.md §3's
workflow narrative; conversely, several plausible screens were
deliberately *not* listed as separate top-level items (a standalone
"Notes" screen, a standalone "Business Unit" top-level nav item, a
standalone "Control Test" screen separate from Assessment) because they
are sub-views/tabs of the screens above, not independent destinations —
see §7 for the navigation rationale.

---

## 6. Navigation Architecture

**Derived from the domain model's own three isolation boundaries**
(Tenant → Organisation → Engagement, ARCHITECTURE.md §5/SECURITY.md §3),
not from a generic SaaS template. The navigation *is* the authorization
boundary made visible, which is exactly what keeps a user from
plausibly believing they can reach something RLS would reject anyway —
good navigation design here is a security-legibility feature, not only
a usability one.

### Consultant application — three navigation tiers, not one flat menu

**Tier 1 — Global shell** (visible always, contents vary by role):
- **Dashboard** — "my engagements" (§5 #2).
- **Organisations** — visible only to roles with tenant/org-wide reach;
  a `Consultant` with only `EngagementMembership` grants does not see
  this at all and goes Dashboard → engagement directly. This is a
  deliberate asymmetry, not an oversight: most users never need it.
- **Methodology** — the Tenant-scoped practice-content area (§5 #20-23),
  visible only to `TenantMembership` holders. Never nested inside an
  Organisation or Engagement.
- **Administration** — users/roles/memberships/audit (§5 #19/#24),
  Platform Administrator only.

**Tier 2 — Organisation shell** (once inside an Organisation): Business
Units, Master Data (§5 #5), Engagements list. A thin layer — most
Organisation-level work is actually the launching point into an
Engagement, not a destination in itself.

**Tier 3 — Engagement shell** (once inside an Engagement — the tier a
consultant lives in most of the day): **Overview · Data Landscape/ROPA ·
Assessment · Evidence · Risk · Findings · Remediation · Maturity ·
Reports · Members**. This is the example structure the brief offered,
and it is in fact the recommended one — not because it was assumed, but
because it maps 1:1 onto (a) DATA_MODEL.md's own top-level entity
groupings (§4 through §9) and (b) the actual RLS/authorization scope
(everything in this tier shares the same `EngagementMembership` check),
so no navigation item here ever requires explaining a different
permission model than its siblings. Two deliberate compressions from a
maximalist reading of the domain model:

- **Validation is not its own nav item** — it is a panel inside a
  Remediation Action's detail view, because a `ValidationRecord` has no
  meaning independent of the specific `RemediationAction` it validates
  (DATA_MODEL.md §8) and a dedicated top-level "Validation" list would
  just be a filtered re-listing of the same Remediation records.
- **Control Test is not its own nav item** — it lives inside the
  Assessment workspace, attached to the `AssessmentControl` row it
  belongs to, because that is the only place a control test is actually
  authored or read in context (a standalone list of `ControlTest` rows
  divorced from the assessment grid loses the context that makes any of
  them meaningful).

### Client application — one tier, engagement-scoped only

**Dashboard → (their one or few) Engagements → within an engagement:
Overview · Our Information (Data Landscape, read/contribute) · Requests
(evidence needed from us) · Findings & Remediation (ours) · Maturity ·
Reports.** No Organisations, no Methodology, no Administration tier
exists for a client at all — those concepts have no client-side meaning.
Risk and Assessment are deliberately *not* separate client-facing nav
items: a client sees *findings and remediation* (the actionable,
released output) more than the raw assessment/risk working data, per
§9's visibility discipline — a client-visible summary of assessment
progress belongs on the Overview screen, not a full separate Assessment
workspace mirroring the consultant's own.

---

## 7. Backend Entity → Screen Mapping

Full systematic mapping (Read model / Write model / Authorization /
Audit / Historical rules), for every MVP screen. Screens sharing an
identical shape are grouped.

### Engagement Overview (§5 #8)
- **Reads:** `engagements`, `assessments` (status/progress rollup),
  `findings` (open count by severity), `remediation_actions` (status
  rollup), `maturity_assessments` (latest finalized).
- **Writes:** none — pure read model (§16).
- **Authorization:** any `EngagementMembership` on this engagement (or
  `OrganisationMembership`/`TenantMembership` reaching it).
- **Audit:** none (a read view is not itself audited, SECURITY.md §6).
- **Historical rules:** none directly; the rollups it reads are each
  individually subject to their own source table's rules below.

### Assessment workspace (§5 #11) — worked in full, per the brief's own example
- **Reads:** `engagements` (pinned `control_library_version_id`),
  `control_library_versions`, `controls`, `assessments`,
  `assessment_controls`, `assessment_responses`, `evidence_links` (for
  the linked-evidence summary shown per response).
- **Writes:** `assessment_responses` (create/edit while draft),
  `control_tests` (insert/delete while draft, per the parent
  Assessment's status), `assessments` (the one `draft → finalized`
  transition).
- **Authorization:** an assessment-response-write role (any
  `EngagementMembership` whose `Role` grants it) for ordinary edits;
  finalization is a narrower, named permission (Engagement Manager, per
  PRODUCT_SPEC.md §2) — the UI must gate the "Finalize" action
  separately from the "Save response" action even though both are
  nominally "editing the assessment," because the backend already
  enforces this asymmetry (Milestone 5's finalization trigger) and the
  UI should never let a user attempt an action the server will reject.
- **Audit:** response creation/update, control-test creation, and
  finalization all generate `audit_log` rows automatically (existing
  triggers) — no UI-side audit code is needed, only a UI that *reads*
  the audit trail for the history view (§17).
- **Historical rules:** once `Assessment.status = 'finalized'`, the
  entire Assessment/AssessmentControl/AssessmentResponse/ControlTest
  subtree becomes immutable at the database layer — the UI must not
  render editable form controls for a finalized assessment at all
  (matching the server's own rejection, not merely disabling a button
  after a failed save).

### Evidence Library (§5 #12)
- **Reads:** `documents`, `document_versions`, `evidence`,
  `evidence_links` — filtered by `evidence.visibility` for any
  client-side reader (server-side filter, never client-side hiding).
- **Writes:** `documents`/`document_versions` (upload — a new version,
  never overwrites a prior one), `evidence` (create + review fields),
  `evidence_links` (attach to a subject).
- **Authorization:** evidence-write role for upload/link; review-decision
  fields require a narrower reviewer permission.
- **Audit:** creation, review-status change, link/unlink all audited.
- **Historical rules:** `DocumentVersion` is fully immutable once
  created (no UPDATE grant at all); a finalized Assessment's linked
  Evidence cannot be unlinked (Milestone 6's finalization-lock trigger)
  — the UI must not offer an "unlink" control on evidence attached to a
  finalized assessment result.

### Risk / Finding / Remediation / Validation (§5 #13-16)
- **Reads:** `risks`+junctions, `risk_scoring_models` (pinned, for
  display of the scoring basis), `findings`+junctions,
  `remediation_actions`+junctions, `validation_records`.
- **Writes:** `risks` (create/score — `risk_scoring_model_id` is
  immutable once set), `findings` (create/status), `remediation_actions`
  (create/assign/status — client-side write is restricted to a subset
  of status transitions, an application-layer rule since the DB itself
  deliberately does not enforce the full state machine, DECISIONS.md
  R-71), `validation_records` (create — consultant-only; its own
  reassessment-trigger fields settable exactly once, later).
- **Authorization:** risk/finding-write roles (consultant); remediation
  status update is the one place a client-contributor role gets a real
  write permission into this chain, narrowly scoped to *their assigned*
  `RemediationAction`'s progress fields, never to `validated`/`closed`.
- **Audit:** every create/status-change/scoring-change on all four
  entities is already audited (Milestone 7's triggers).
- **Historical rules:** a `Risk`'s `risk_scoring_model_id` is frozen at
  creation (historical reproducibility, DECISIONS.md R-16/R-67); a
  `ValidationRecord`'s decision fields are frozen after creation, its
  reassessment-trigger columns settable exactly once — the UI must
  present validation as a one-time, deliberate act, never an editable
  form field re-opened later, and must show "record a new validation" as
  the correction path rather than "edit the existing one."

### Maturity (§5 #17)
- **Reads:** `maturity_assessments`, `maturity_scores` (including the
  Milestone 8A domain-name/code/description snapshot — the UI should
  render *from the snapshot*, not a live join to `maturity_domains`, for
  any finalized historical `MaturityAssessment`, to actually honor the
  guarantee that migration built), `maturity_scoring_methodologies`.
- **Writes:** `maturity_assessments`/`maturity_scores` — this pair is
  written by a controlled "compute" server action (§21 gap: the
  computation logic itself doesn't exist yet, only the tables and rules
  it must obey), never a free-form user edit — `maturity_scores` has no
  UPDATE/DELETE grant at all by design.
- **Authorization:** maturity-read role for viewing; triggering a
  computation is a narrower permission (likely Engagement Manager or
  Consultant with a specific grant).
- **Audit:** creation/finalization already audited.
- **Historical rules:** once `status = 'finalized'`, no field on the
  `MaturityAssessment` or any of its `MaturityScore` rows may change —
  the UI must treat a finalized Maturity result exactly like a finalized
  Assessment: read-only, with "compute a new one" as the only forward
  path, never "edit this one."

### Reports (§5 #18)
- **Reads:** everything above, through the same server-side
  visibility filter used for the client portal itself — the report
  generator must reuse the exact same read models the client UI uses
  for client-visible fields, not a separately-hand-maintained "what goes
  in the PDF" field list that can drift out of sync (PRODUCT_SPEC.md's
  "one source of truth" principle applies to reports as much as to
  screens).
- **Writes:** none to domain data; may write a `generated_reports` audit
  trail row of its own (a candidate small addition, not yet designed —
  see §21).
- **Authorization:** report-read role, itself visibility-filtered per
  reader (a client user generating "their" report never sees a
  consultant-internal field even inside the PDF).
- **Audit:** report generation itself should be an audited event (who
  generated/downloaded which report, when) — SECURITY.md §6's own
  "material change" framing extends naturally to "material export."
- **Historical rules:** a generated report is a point-in-time artifact
  over then-current data; re-generating the "same" report later can
  legitimately produce a different result if underlying data changed —
  this must be labeled clearly in the UI ("generated as of [timestamp]"),
  distinct from the frozen historical rows (Assessment, Risk, Maturity)
  the report is built from.

---

## 8. Permission Matrix

**Existing role model (do not invent new database roles):**
`Role.scope ∈ {tenant, organisation, engagement}`, 12 seeded roles
(`db/seed/roles.ts`) — Platform Administrator, Practice Partner
(tenant); Engagement Manager, Consultant, Auditor, Business Owner,
IT/CISO, Procurement, Legal (engagement); Client Administrator, Privacy
Officer, CXO/Executive Viewer (organisation) — plus 8 seeded, explicitly
**illustrative, not exhaustive** `Permission` rows and a
`RolePermission` grant table wired for exactly 4 of the 12 roles so far
(`db/seed/roles.ts`'s own comment: "not an exhaustive catalogue... enough
to prove RolePermission works end to end"). Building out the remaining
fine-grained permissions (`assessment_response.write`,
`evidence.internal.read`, etc. — named in ARCHITECTURE.md/SECURITY.md
but not yet seeded) is application-layer/seed-data work, not a schema
change — **flagged as a real, NON-BLOCKING gap in §22**.

The brief's 6 requested columns map onto this existing role model as
follows (none of the 6 is a new database row; each is either a direct
match or an application-level grouping label over 2+ existing roles):

| Requested column | Existing role(s) | Notes |
|---|---|---|
| Tenant | Platform Administrator, Practice Partner | Direct match — `TenantMembership` |
| Consultant | Consultant, Engagement Manager | Engagement Manager additionally gets finalize/membership-manage |
| Reviewer | Auditor | Direct match; its actual QA workflow (`QualityReview`) is **[NOT YET BUILT]**, so today "Reviewer" access is scoped by `EngagementMembership` alone, same read/limited-write shape as Consultant minus write on finalized content |
| Client Admin | Client Administrator | Direct match — `OrganisationMembership` |
| Client Contributor | Business Owner, IT/CISO, Procurement, Legal | Application-level grouping — these four roles share the same *shape* of access (their own assigned items, narrow write) even though DATA_MODEL.md keeps them as 4 distinct seeded roles for reporting/assignment clarity, not 1 |
| Client Viewer | CXO/Executive Viewer | Direct match; Privacy Officer is broader than this (organisation-wide, closer to Client Admin's read reach) and is called out separately where it matters, not forced into this column |

**Capability matrix** (`R`=Read, `C`=Create, `E`=Edit, `F`=Finalize,
`D`=Delete, `CV`=Client-Visible — a capability with no letter in a
column means no access at all):

| Capability | Tenant | Consultant | Reviewer | Client Admin | Client Contributor | Client Viewer |
|---|---|---|---|---|---|---|
| Organisation manage | R,C,E | R | R | R,E (own org) | R (own org) | R (own org) |
| Engagement create/manage | R,C,E | R,C,E (staffed) | R (staffed) | R (own org) | — | R (own org) |
| Membership grant/revoke | R,C,E,D | R,C,E,D (Eng. Manager, own engagement) | — | R,C,E,D (own org users) | — | — |
| Methodology (Control Library / Risk Model / Maturity Methodology) | R,C,E,F | R | R | — | — | — |
| Client Master Data (Business Units, Systems, etc.) | R | R,C,E | R | R,E (own org) | R,E (own scope) | R |
| Processing Activities / ROPA | R | R,C,E | R | R | R,E (own scope) | R |
| Assessment response | R | R,C,E,F | R | CV (released only) | — | CV (released only) |
| Control Test | R | R,C,E | R | — | — | — |
| Evidence upload/review | R | R,C,E | R | CV (client_visible only) | C (own uploads),CV | CV |
| Evidence internal notes | R | R,C,E | R | — | — | — |
| Risk create/score | R | R,C,E | R | CV (released only) | — | CV (released only) |
| Finding create/manage | R | R,C,E | R | CV | CV (assigned) | CV |
| Remediation create/assign | R | R,C,E | R | CV | R,E (own, progress fields only) | CV |
| Validation record | R | R,C (F — decision is permanent) | R | CV | — | CV |
| Maturity view | R | R | R | CV (released only) | — | CV (released only) |
| Maturity compute/finalize | R | C,F (Engagement Manager) | — | — | — | — |
| Reports generate/view | R | R,C | R | R,CV | — | R,CV |
| Audit log view | R (tenant scope) | R (staffed engagements) | R | — | — | — |

**CV column reading note:** "CV (released only)" marks the exact
places where §1's "no visibility column exists yet" gap is load-bearing
— these cells are enforceable today only by application-layer
discipline (never returning a not-yet-released row/field to a
client-facing query), not by any database constraint, unlike the "CV"
cells on Evidence, which the existing `evidence.visibility` column
already enforces server-side regardless of application discipline.

**Missing permission decisions this matrix surfaces, not resolved here:**
1. Should "Reviewer" (Auditor) get any write access at all before
   `QualityReview` is built, or read-only until then?
2. Exactly which `RemediationAction` fields a Client Contributor may
   edit (status subset, due-date acknowledgment, evidence link only?) —
   application-layer state-machine design deferred by DECISIONS.md R-71
   itself, still open.
3. Whether Privacy Officer gets Client Admin-equivalent *read* breadth
   with Client Contributor-equivalent *write* narrowness, or its own
   distinct shape — not yet decided, flagged here rather than assumed.

---

## 9. Client-Visible vs. Internal Model

| Entity | Field-level split today? | Recommended MVP treatment |
|---|---|---|
| `AssessmentResponse` | No visibility column | Release the *response* (effectiveness/decision rating) once the parent Assessment is finalized (or explicitly "shared" pre-finalization, if the workflow wants interim visibility); `decision_rationale` should be treated as consultant-internal by application convention unless a consultant explicitly marks it for the client — **no schema support for that "explicitly marks" step exists yet**, so MVP's honest default is: rationale stays internal, only the rating is client-visible. |
| `Evidence` / `Document` | **Yes** — `evidence.visibility` enum, server-enforced (Milestone 6) | Use as-is; this is the one entity where the schema itself is the enforcement, not application discipline. |
| `Risk` | No visibility column | Client sees a released Risk's rating/description; internal scoring detail (raw likelihood/impact inputs, if deemed sensitive) is an application-layer judgment call, not schema-enforced — flag for future `visibility` column if a real need to hide specific risks from a client ever arises (not observed yet). |
| `Finding` | No visibility column | Same pattern as Risk — client sees findings assigned/relevant to them; "accepted, not remediating" findings may carry consultant-only context in `description` that should stay internal by convention. |
| `RemediationAction` | No visibility column | Client sees their own assigned actions in full (they need the detail to act on it) — this is the one entity where "client-visible" and "consultant-internal" largely coincide by necessity, not a real internal/external split to design around. |
| `ValidationRecord` | No visibility column | The *outcome* (accepted/rejected) should be client-visible once recorded — it's the direct answer to "is my remediation done." `rationale` may be internal-only by the same convention as `AssessmentResponse.decision_rationale`. |
| `MaturityScore`/`MaturityAssessment` | No visibility column | Client sees a maturity result only once its `MaturityAssessment.status = 'finalized'` — never a draft/in-progress computation. |

**Where field-level visibility will eventually be required, beyond
row-level release-gating:** `AssessmentResponse.decision_rationale`,
`ValidationRecord.rationale`, and any future consultant working-notes
field on `Risk`/`Finding` are the concrete candidates — each is exactly
the shape `Evidence.visibility` already solves, and extending that same
enum column to these tables (rather than inventing a new mechanism) is
the natural next schema step *if and when* product usage proves the
application-layer convention above isn't sufficient — **not recommended
as MVP schema work**, since SECURITY.md §4's server-side field-dropping
pattern is sufficient for a correctly-disciplined MVP build, and adding
unused visibility columns ahead of a proven need repeats exactly the
premature-complexity mistake this project's own architecture principles
warn against.

---

## 10. Lovable → PRIMUS Mapping

The Lovable prototype is inaccessible from this environment (§0); this
table is built entirely from PRODUCT_SPEC.md/ARCHITECTURE.md/ROADMAP.md
and this blueprint's own screen inventory (§5) — **no Lovable screen,
label, or layout is asserted or invented anywhere below.**

| Lovable concept/screen | PRIMUS screen | Real backend entity | Reuse | Change | Remove |
|---|---|---|---|---|---|
| *(unknown — inaccessible)* | — | — | — | — | — |

Nothing further can be responsibly populated in this table without
inspecting the actual prototype. **Recommended follow-up (not performed
in this session):** obtain either (a) a network path to the Lovable
preview URL from an environment that can reach it, or (b) exported
screenshots/a design export committed to the repository, then re-run
this one section as a small, targeted addition to this document — it
does not require redoing any other part of this blueprint.

---

## 11. MVP Definition

### MUST HAVE

- Authentication (Supabase Auth) + server-side session resolution +
  the two-layer authorization module (ARCHITECTURE.md §4) — nothing
  else is buildable safely before this, exactly as ROADMAP.md already
  states.
- Organisation + Engagement management, membership.
- Client Master Data screens (the 6-tab area, §5 #5) — every later
  screen depends on this existing for a client.
- Processing Activities / ROPA.
- Control Library **read** access inside an engagement (authoring stays
  Methodology-admin-only, already MVP per ROADMAP.md item 4).
- Assessment workspace: response recording, control test recording,
  finalization.
- Evidence: upload, link, review, visibility-gated read — even with the
  storage layer still a placeholder (§21), the authorization/metadata
  path must be real.
- Risk register, Findings, Remediation, Validation — the full chain,
  since PRODUCT_SPEC.md §5 explicitly scopes MVP as "the full
  remediation→evidence→validation→reassessment loop," not a partial
  slice.
- Maturity: at minimum, a manually-triggered computation (the *engine*
  logic itself is new application code, §21) producing a real,
  finalized `MaturityAssessment`.
- One exportable engagement report.
- Audit log viewer (even minimal — filter by entity/date is enough).
- Client portal: dashboard, evidence upload, findings/remediation view.

### SHOULD HAVE (follows shortly after MVP)

- Task/Notification system (in-app) — makes "what's being requested of
  the client" a real, trackable object rather than an out-of-band
  conversation; genuinely improves the MVP workflow's UX without being
  required for the workflow to *function*.
- Cross-period Maturity trend view.
- QualityReview workflow for the Auditor role.
- Fuller permission catalogue (beyond the 8 illustrative permissions).
- Real Supabase Storage + signed URLs (currently placeholder metadata
  only) — should-have rather than must-have only in the narrow sense
  that the *screens* can be built and tested against the metadata layer
  first; it is a **production-readiness blocker** before real client
  files are ever accepted (§22), which is a different question from
  "blocks the UI screens from being built."

### LATER (deliberately excluded)

- DPIA/SDF Screening UI, AI Use Case tracking, Notice/Consent/
  Retention/DataFlow UI — all explicitly Non-MVP per PRODUCT_SPEC.md §5
  already; this blueprint does not move any of them earlier.
- Malware scanning on uploads (D-05, deferred).
- Multi-framework regulatory content beyond DPDP.
- Billing/subscription, multi-practice/white-label (D-06, Phase 3).
- AI-assisted drafting, benchmarking, advanced analytics.
- SSO/SCIM, third-party integrations.
- Mobile applications (§18).

---

## 12. MVP End-to-End Workflow

The brief's own 15-step example is, on inspection, **already fully
supported by the existing backend with zero new schema** — a genuinely
useful finding, restated here as the concrete recommended MVP demo path
rather than a hypothetical:

1. Consultant creates Organisation. *(`organisations` — built)*
2. Consultant creates Engagement, pins control library version.
   *(`engagements` — built)*
3. Processing Activities are captured, linked to master data.
   *(`processing_activities` + junctions — built)*
4. Controls are assessed — `AssessmentControl` scoped from the pinned
   library, `AssessmentResponse` recorded. *(built)*
5. Client provides evidence — uploaded directly against the relevant
   `AssessmentResponse`/`ControlTest` (no formal Task/Request object
   required for the backend to function — see §11's SHOULD-HAVE note).
   *(`evidence`, `evidence_links` — built)*
6. Consultant reviews evidence (`evidence.review_status`). *(built)*
7. Assessment response is recorded/updated, then the Assessment is
   finalized. *(built)*
8. Risk is identified from the finalized response
   (`risks.assessment_response_id`). *(built)*
9. Finding is created, linked to the Risk. *(built)*
10. Remediation Action is assigned, linked to the Finding. *(built)*
11. Remediation evidence is submitted
    (`evidence_links.remediation_action_id`). *(built)*
12. Consultant validates (`validation_records`, outcome = accepted).
    *(built)*
13. The validation's reassessment trigger points at a new
    `AssessmentResponse`/`ControlTest` in a later period — the control
    is genuinely reassessed, never automatically. *(built,
    Milestone 7's own required scenario)*
14. Maturity assessment is generated from the (now-improved) finalized
    Assessment. *(built, Milestone 8's own required scenario)*
15. Consultant and client both see the resulting status — gated by the
    visibility rules in §9. *(needs the application-layer read models
    and screens this blueprint specifies; the underlying data is real
    and correct)*

**What this proves:** the entire MVP demo narrative can be built and
demonstrated to a prospective client using *only* application-layer
work (auth, Server Actions, screens, read models) — no further schema
milestone is required to reach a genuinely complete, realistic MVP demo.
That is the single most actionable finding in this blueprint.

---

## 13. Recommended First Vertical Slice

**Slice: "Record and finalize one Assessment Response, end to end."**

`UI (Assessment workspace, one AssessmentControl row) → Server Action
(submitAssessmentResponse) → Authorization check (EngagementMembership +
assessment-response-write permission, resolved server-side) → Domain
write (INSERT/UPDATE assessment_responses, subject to the finalization
guard already enforced by the database) → Audit (existing trigger fires
automatically — no new audit code needed) → Read model refresh (the same
screen re-renders the saved response) → user-visible result.`

Chosen over alternatives (Organisation creation, Evidence upload) because
it is the smallest slice that exercises **every layer** this blueprint
cares about proving works together for real: real authentication, a real
authorization decision that can genuinely deny (a user without the
permission, or on a finalized assessment, must see a real rejection, not
a client-side-only disabled button), a real database write against a
table with non-trivial business rules already enforced at the DB layer
(the finalization-immutability trigger), a real audit trail, and a
result that is meaningfully different from "nothing happened" to a real
user. Evidence upload is deliberately *not* the first slice, because its
storage layer is a known placeholder (§21) and would conflate "does the
application layer work" with "is Supabase Storage wired up" — two
different, separately-sequenced problems.

It must run against real PostgreSQL (the existing `primus_privacy_test`/
dev database, already provisioned by this project's own tooling) — no
mock data, per instruction, except that Supabase Storage itself may
remain the existing metadata-only placeholder for this one slice, since
Evidence linking is not part of the chosen slice.

---

## 14. Routing Architecture

Derived directly from the three isolation boundaries (§6), not a
template:

```
/login
/dashboard                                                    — consultant "my engagements"
/organisations                                                — Tenant/Org-wide roles only
/organisations/[organisationId]
/organisations/[organisationId]/master-data/[category]
/organisations/[organisationId]/engagements/[engagementId]
  /overview
  /setup
  /members
  /data-landscape                (Processing Activities / ROPA)
  /assessment
  /assessment/[assessmentId]
  /evidence
  /risks
  /risks/[riskId]
  /findings
  /findings/[findingId]
  /remediation
  /remediation/[remediationActionId]
  /maturity
  /reports
/methodology                                                  — Tenant-scoped, outside any Organisation
  /control-library
  /risk-scoring-model
  /maturity-methodology
  /regulatory-content
/admin                                                         — users, roles, memberships, audit
  /users
  /audit-log

# Client portal — a distinct route group, never nested under /organisations
/portal
/portal/engagements/[engagementId]
  /overview
  /our-information
  /requests
  /findings
  /remediation
  /maturity
  /reports
```

**Security note (explicit, per instruction):** every route above is a
*presentation* convenience only — `[organisationId]`/`[engagementId]`
path segments carry no authority by themselves; every Server Action and
data fetch behind these routes re-resolves the caller's actual
membership server-side exactly as ARCHITECTURE.md §7 describes, so a
crafted URL to an engagement the user has no membership on must fail
identically whether or not the route "looks" like it should be
reachable. `/portal` is a fully separate route group specifically so a
client-side bug can never accidentally reuse a consultant-side
data-fetching function that assumes broader access — a structural,
not just logical, separation.

---

## 15. Server / API Boundary

| Feature area | Recommended mechanism | Rationale |
|---|---|---|
| Form submissions with side effects (create/update Engagement, AssessmentResponse, Risk, Finding, RemediationAction, ValidationRecord, etc.) | **Server Action** | Matches ARCHITECTURE.md §2/§3's explicit rationale: keeps the authorization check in server-only code by construction; no separate API contract to keep in sync. |
| Page-load data (Engagement Overview, Assessment grid, Risk Register list) | **Server Component data fetch** | No client-side round trip needed for initial render; the query is already scoped server-side. |
| Evidence upload (file bytes) | **Route Handler** (needed for `multipart/form-data`/streaming in a way Server Actions handle less naturally) → mints a signed upload URL/handles the stream, then calls the same domain-service function a Server Action would | Keeps the *authorization and domain-rule* code identical to every other write path; only the transport differs because of file semantics. |
| Signed URL issuance for evidence *download* | **Route Handler**, authorization-checked identically to any other read, per SECURITY.md §5 | A signed URL is itself a credential; must never be mintable from a path that skips the authorization layer. |
| Report generation/export | **Route Handler** (returns a binary/PDF stream) calling the same read models the report content needs | Reuses read models rather than duplicating "what goes in the report." |
| Real-time-ish status (e.g. "evidence scan complete") | Not needed at MVP — polling/refresh on navigation is sufficient; do not introduce websockets/real-time infrastructure ahead of a proven need (ARCHITECTURE.md §1's own non-goals). |

**The browser is never the authorization boundary**, per instruction —
every mechanism above terminates in the same server-only domain-service
layer ARCHITECTURE.md §4 already specifies, which is itself gated by the
same two-layer authorization model (application policy + RLS) regardless
of which of the three mechanisms above delivered the request.

---

## 16. Read-Model / View Requirements

**No new persisted tables for UI convenience** — every view below is a
query (or a small set of queries composed server-side), never a
duplicated domain table, per instruction and per ARCHITECTURE.md's own
"one relational data model that every view reads from" goal.

| View | Composed from | Notes |
|---|---|---|
| Engagement Overview | `engagements` + rollup counts from `assessments`/`findings`/`remediation_actions`/`maturity_assessments` | A single server-side query function, reused by both the Overview screen and the Dashboard's per-engagement summary card — not two separately-maintained aggregations. |
| Assessment Progress | `assessment_controls` LEFT JOIN `assessment_responses` | "N of M controls responded" is a `COUNT`/`COALESCE` over existing rows, not a stored percentage column. |
| Risk Summary (by rating) | `GROUP BY risks.inherent_rating` (and `residual_rating`) | Feeds both the Risk Register list header and any future dashboard widget — one query, two render targets. |
| Remediation Summary (by status) | `GROUP BY remediation_actions.status` | Same pattern — powers a kanban view's column counts and a dashboard card identically. |
| Maturity Summary | `maturity_scores` for the latest finalized `maturity_assessment_id` per engagement | Must read the Milestone 8A domain-snapshot columns, not a live join to `maturity_domains`, once the source `MaturityAssessment` is finalized. |
| Evidence Requests (client-visible) | `evidence_links` with no fulfilling `evidence` row yet, scoped to client-visible subjects | The honest MVP shape without `Task` — becomes a real Task-backed view once built (§5 #29). |

---

## 17. History / Audit UX

Every screen below needs a **history affordance** beyond "the current
row," because the domain model was deliberately built around append-only
and versioned records — hiding that from the UI would waste exactly the
guarantee Milestones 1-8A spent their effort building:

| Screen | What history to show | Source |
|---|---|---|
| Assessment detail | Who changed a response, when, prior value → new value, and the exact finalization event | `audit_log` filtered on `entity_type = 'assessment_responses'`/`'assessments'`, `entity_id` |
| Client Master Data (any of the 6) | Full version history of a System/Processor/etc. — not just "current" | The identity+version (SCD2) chain itself, §5.1 — this is a first-class read, not an audit-log lookup |
| Evidence detail | Which `DocumentVersion` is pinned, and the full version list for that Document | `document_versions` ordered by `version_number` |
| Risk detail | Which `RiskScoringModel` version scored it, and the `previous_risk_id` chain if re-scored | `risk_scoring_models` (pinned), `risks.previous_risk_id` |
| Remediation detail | Full status-change timeline, plus the linked `ValidationRecord`(s) | `audit_log` + `validation_records` |
| Maturity detail | Which `MaturityScoringMethodology` version computed it, and prior periods' results for trend | `maturity_scoring_methodologies` (pinned), `maturity_assessments` across periods |
| Methodology admin (Control Library / Risk Model / Maturity Methodology) | Draft → published → retired lifecycle, and every prior version | The version tables themselves |
| Membership screens | Grant/revoke history | `audit_log` on the three membership tables |

None of this needs to be built as a separate "history module" — it is
one reusable "entity history panel" component reading `audit_log` by
`(entity_type, entity_id)`, plus, for the specifically versioned
entities above, a second reusable "version chain" component reading the
relevant version table directly. Two components, applied consistently,
not one bespoke history UI per screen.

---

## 18. Search / Filter Strategy

**Start with PostgreSQL queries; no search infrastructure**, per
instruction. Prioritized exactly as listed:

- **Organisations** — name search (`ILIKE`), status filter. Low volume
  (one practice's client list) — a simple filtered list is sufficient
  indefinitely.
- **Engagements** — filter by Organisation, status, type, period; text
  search on name.
- **Processing Activities** — the highest-volume list in a typical
  engagement; needs name/status/business-unit filter plus filter by
  linked master-data entity (e.g. "activities using System X") — a set
  of indexed `WHERE`/`JOIN` queries, not a search engine.
- **Controls** (within the pinned library) — filter by `control_type`,
  by Requirement/RegulatoryReference; text search on code/title.
- **Evidence** — filter by subject type, review status, visibility,
  uploader, date range; text search on title/filename.
- **Findings** — filter by severity, status, linked Risk/Control/PA.
- **Remediation** — filter by status, priority, owner, due-date range
  (overdue is a derived filter, not a stored flag).

If real usage later shows PostgreSQL full-text search (`tsvector`) is
insufficient for cross-entity search (e.g. "find anything mentioning
'vendor X'" across Processing Activities, Findings, Evidence titles at
once), that is a Phase 2+ decision to make with real query-pattern data
— not a reason to introduce Elasticsearch now.

---

## 19. Responsive / Accessibility Recommendations

**Responsive priorities:** consultant experience is desktop-first
(dense tables — the Assessment grid, Risk Register, Remediation list —
genuinely need width; a consultant's real working context is a laptop/
desktop). The client portal must be usable on a tablet and a large
phone at minimum (a client-side reviewer plausibly checks/uploads
evidence from a phone) — its narrower engagement-scoped navigation (§6)
already makes this more tractable than the consultant app's dense
tables. **No separate mobile application**, per instruction — a
responsive web app only.

**Accessibility baseline** (not implemented in this session, per
instruction — recorded as a requirement for the eventual build):
keyboard navigation through every table/form/action (no mouse-only
interaction, especially for the Assessment response grid and Remediation
kanban); explicit `<label>`s on every form control, not placeholder-text-
as-label; visible focus states everywhere shadcn/ui's defaults are kept
(§20); semantic HTML structure (real `<table>` for tabular data, real
heading hierarchy per page, landmark regions); accessible table
semantics for the Assessment/Risk/Remediation grids specifically (row/
column headers correctly associated, not just visually aligned); client-
side form validation paired with server-side validation messages
surfaced accessibly (not color-only); **status indicators must never be
color-only** — every status badge (Assessment draft/finalized, Finding
severity, Remediation status, Risk rating, Maturity level) needs a text
label or icon alongside its color, both for accessibility and because
color-only status is a real compliance-product risk (a colorblind
reviewer must be able to tell "critical" from "low" reliably).

---

## 20. Design-System Recommendation

Built from PRODUCT_SPEC.md/ARCHITECTURE.md only — **the Lovable
prototype's actual visual language is unknown** (§0) and nothing below
should be read as a description of it.

ARCHITECTURE.md §2 already commits to **Tailwind CSS + shadcn/ui**
(accessible, unstyled-by-default primitives copied into the repo, not an
opaque dependency) — this blueprint recommends keeping that choice
unchanged, and building the following conventions on top of it once
implementation starts:

- **Status badges** as a single shared component (color + text label,
  per §19), reused for every status enum in the schema (`Assessment.
  status`, `RemediationAction.status`, `Risk.inherent_rating`/
  `residual_rating`, `Finding.severity`/`status`, `MaturityAssessment.
  status`, `Document.status`, `Evidence.review_status`) rather than a
  bespoke badge per screen — the schema already has a small, closed set
  of enums for exactly this reason (DATA_MODEL.md §1's own convention).
- **Data tables** as one shared, accessible table component (sort,
  filter-row, pagination) reused across Processing Activities, Controls,
  Evidence, Risks, Findings, Remediation — these are structurally the
  same UI pattern (a filterable list → a detail page) seven times over,
  not seven different table implementations.
- **Detail-page layout** as one shared template (header with status
  badge + key actions, tabbed or sectioned body, a history panel per
  §17) reused across every entity detail screen.
- **Forms** built on a shared form component wired to the same Zod
  schemas the server actions validate against (ARCHITECTURE.md §2),
  so client-side validation messages and server-side rejection messages
  come from one schema, not two hand-maintained copies.
- **Two visual "modes," not two apps:** the consultant app (denser,
  more actions per screen, methodology/admin areas visible) and the
  client portal (sparser, fewer actions, narrower navigation, per §6)
  should share the same component library and token set, differing in
  information density and available actions, not in visual identity —
  this reinforces "one platform," which matters for client trust in a
  compliance product.

**Design-system implementation itself is explicitly not performed in
this session** — this is a direction to build against later, per
instruction.

---

## 21. Backend / Domain Gaps

### BLOCKING (must be resolved before that screen/workflow can be implemented for real use)

| Gap | Blocks | Notes |
|---|---|---|
| No authentication/authorization application code exists at all | Every screen | The single largest gap; Supabase Auth + the two-layer authorization module (ARCHITECTURE.md §4) is Phase A, not negotiable. |
| Real Supabase Storage / signed URLs not implemented (`storage_path` is a placeholder object-key string, DECISIONS.md R-65) | Evidence upload/download for real client files | Blocks *accepting real client evidence*, not blocks *building/testing the Evidence screens* against the metadata layer. |
| Data residency (D-03) undecided | Provisioning a real production Supabase project | Does not block continued application-layer development against a dev/staging database in any region. |
| Maturity computation engine doesn't exist (only the data structures and rules it must obey — RiskScoringModel/MaturityScoringMethodology precedent: "store and pin the configuration, don't build a calculator" was deliberate through Milestone 8) | Maturity screen's "compute" action | New application-layer code (not a schema change) — the exact formula (Risk-to-Maturity, Validation-to-Maturity mathematical relationships) remains an explicitly open methodology question per DECISIONS.md R-79/R-80; this must be resolved by a product/methodology decision, not invented by whoever builds the UI. |
| Report generation code doesn't exist | Reports screen | Application-layer only, not a schema gap — needs building, per §11 MUST HAVE. |

### NON-BLOCKING (can be handled later)

| Gap | Notes |
|---|---|
| `Requirement` content is not independently frozen by a `ControlLibraryVersion`'s publish state (DECISIONS.md R-43/R-44, carried since Milestone 4) | Only the library's own Control set/mappings are frozen; a `Requirement`'s text could theoretically be edited after a library referencing it is published. Real, documented, low-probability-in-practice gap. |
| Malware scanning on uploads (D-05) | Deferred per existing decision; mitigated by type/size validation. |
| DSR / individual data-principal PII scope (D-04) | Current assumption (category-level only) holds; no screen in this blueprint requires resolving it. |
| Notification/Task system (`[NOT YET BUILT]`) | MVP workflow functions without it (§12); genuinely improves UX, correctly sequenced as SHOULD-HAVE. |
| Client-visible vs. internal field model beyond Evidence (§9) | Application-layer discipline is sufficient for MVP; a real schema gap only if/when a proven need for row-level release-gating beyond "finalized or not" emerges. |
| Full search/indexing beyond PostgreSQL queries | Not needed at current or foreseeable near-term data volume. |
| Billing (D-06) | Phase 3 only, undesigned by explicit prior decision. |
| Only 8 illustrative `Permission` rows seeded, not the full fine-grained catalogue named in ARCHITECTURE.md/SECURITY.md prose | Seed-data completion, not a schema change — needed before the permission matrix (§8) can be enforced exactly as designed, but doesn't block earlier screens that only need coarse role checks. |

---

## 22. Production-Readiness Gates

| Gate | Status |
|---|---|
| Authentication | Not implemented — Supabase Auth chosen (ARCHITECTURE.md §2), not wired. |
| Authorization (application layer) | Not implemented — design is fully specified (ARCHITECTURE.md §4, SECURITY.md §2), no code exists. |
| RLS | **Implemented and tested** — every table since Milestone 1 has RLS `ENABLE`+`FORCE`, verified via direct `psql` inspection every milestone, 370 tests passing. |
| Private storage / signed URLs | Not implemented — placeholder metadata layer only (DECISIONS.md R-65). |
| Malware scanning | Not implemented — deferred by explicit decision (D-05). |
| Audit | **Implemented and tested** — append-only `audit_log`, no UPDATE/DELETE grant, triggers on every material table since Milestone 1, 370 tests covering it. |
| Backups | Not implemented — depends on a provisioned Supabase project (not yet created); Supabase's managed PITR is the intended mechanism (ARCHITECTURE.md §9/SECURITY.md §11), decision not exercised yet. |
| Encryption | Partially — Postgres/Supabase provide encryption at rest and in transit by platform default once provisioned; no application-level field encryption exists or has been decided as needed. |
| Data residency | **Decision required (D-03)** — blocking before a real production Supabase project is provisioned. |
| Secrets management | Not exercised — no deployed environment yet; the pattern (Vercel/Supabase env config, never committed, never client-bundled) is specified (SECURITY.md §7), not yet tested in a real deployment. |
| Logging | Not implemented — structured server-side logging of denials/failed auth/evidence access is specified (SECURITY.md §12), not built (no server code exists yet to log from). |
| Monitoring | Not implemented — deferred by explicit decision (Phase 2, SECURITY.md §12). |
| Error handling | Not implemented — pattern specified (SECURITY.md §13: generic client-facing errors, full detail server-side only), no code exists yet. |
| Retention/deletion | **Decision required** — no retention/deletion policy has been designed for any entity; SECURITY.md §6 only states audit-log retention "follows the engagement/client data retention policy," which does not yet exist as a concrete policy. |
| DSR functionality | Not applicable under current MVP assumption (D-04: category-level data-principal tracking only) — would require its own scoped design and security review before any work starts, per D-04's own explicit framing. |
| Incident response | Not designed — no plan exists; genuinely needed before real client data is accepted, not addressed by any milestone to date. |

**Already implemented:** RLS, audit logging, and the full historical-
immutability/versioning discipline across every domain table.
**Partially implemented:** encryption (platform-default, once
provisioned; nothing custom). **Not implemented:** authentication,
application-layer authorization, private storage/signed URLs, malware
scanning, backups (unexercised), logging, monitoring, error handling.
**Decision required:** data residency (D-03), retention/deletion policy,
incident response plan. This is a realistic, sobering list — real client
data must not be accepted until the "Not implemented"/"Decision
required" rows above are closed, which is materially more work than the
screens in §5 alone represent, and should be communicated as such
alongside this blueprint.

---

## 23. Build Sequence

**Phase A — Application shell + Authentication.** Supabase Auth wiring,
session resolution, the authorization-resolution module (ARCHITECTURE.md
§4), the Next.js route/layout shell for both the consultant app and
`/portal`, and a minimal Dashboard. Nothing else is buildable safely
before this, exactly per ROADMAP.md's own stated order.

**Phase B — Organisation / Engagement management.** Organisations list,
Organisation Home, Engagement Setup/Membership, Client Master Data
screens (the 6-tab area) — every later screen depends on real
Organisations/Engagements/master data existing to attach to.

**Phase C — Vertical slice (§14), then Assessment workspace in full,**
including Control Library read-access and Evidence's metadata/
authorization path (storage still placeholder). Ends with a real,
finalizable Assessment.

**Phase D — Risk / Findings / Remediation / Validation**, the full
chain, since the backend already treats these as one connected loop
(§12) — building them together, not as four separately-sequenced
mini-projects, keeps the UI honest about the loop's actual shape.

**Phase E — Maturity**, including the computation-engine application
code this blueprint flags as new work (§21) — sequenced after Risk/
Findings/Remediation because Maturity's own required historical
scenario (Milestone 8) depends on a finalized Assessment and (for a
fully realistic demo) a validated remediation already existing.

**Phase F — Client portal.** Deliberately built *after* the consultant-
side chain works end-to-end, not in parallel from the start — every
client-portal screen is a narrower, visibility-filtered view of data the
consultant-side screens already prove is correct; building the portal
first would mean building the visibility-filtering discipline (§9)
against workflows that don't exist yet to test it against.

**Phase G — Reports.** Sequenced last among MVP phases because it reads
from (and must stay honest about) every other domain area — building it
before the areas it reports on exist would produce a report generator
tested against fixtures, not real workflow output.

**Phase H — Real Storage/signed URLs**, malware-scanning decision,
production-readiness gates (§22) — sequenced as its own phase, run in
parallel with F/G rather than blocking them, since it's an
infrastructure/ops track, not a screen-building one.

**Explicitly not scheduled** in this build sequence at all, matching
ROADMAP.md: DPIA/SDF UI, Notice/Consent/DataFlow, AI Use Case, Quality
Review, cross-period Maturity trend dashboards, billing, multi-practice/
white-label, additional regulatory frameworks, AI-assisted drafting,
advanced analytics/benchmarking.

---

## 24. Product Roadmap

### MVP
Everything in §11's MUST HAVE list, built per the §23 phase sequence.
Deliverable: one real engagement, one real client, moved through the
entire object graph end-to-end (§12), server-enforced access control,
full audit trail, one exportable report — matching PRODUCT_SPEC.md §5
and ROADMAP.md's own MVP definition exactly, now with a concrete UX
plan behind it.

### V1 (≈ ROADMAP.md "Phase 2")
Task/Notification system; real Supabase Storage + signed URLs (moving
the BLOCKING production-readiness gate to closed); DPIA & SDF-screening
UI (over the already-modeled Assessment specialization); AI Use Case
tracking UI; cross-engagement/cross-period Maturity trend dashboards;
Notice & consent-management UI expansion; QualityReview workflow for
the Auditor role; MFA, SSO for PRIMUS-side users; malware scanning on
evidence upload (once real file volume justifies it, D-05); Continuous
Compliance engagement-type hardening for the client-facing experience.

### V2 (≈ ROADMAP.md "Phase 3")
Self-serve client onboarding + billing/subscription (D-06 resolved
first); multi-practice/white-label (the `Tenant` mechanism is already
built for this — this phase is data provisioning + the white-label-
specific UI, not a schema change); additional regulatory frameworks
beyond DPDP (content work, not architecture — `RegulatoryReference` is
already framework-agnostic); SSO/SCIM at scale, ticketing/DLP/CASB
integrations.

### Future / Strategic
AI-assisted drafting (strictly additive, strictly suggest/accept/
modify/reject, never a source of a final conclusion — PRODUCT_SPEC.md
principles 9-11 continue to apply unchanged); advanced analytics/
cross-client benchmarking (with the client-organisation isolation and
consent implications of cross-client aggregation resolved explicitly
before any such feature is designed, per ROADMAP.md's own existing
caution). **AI does not drive product architecture at any stage of this
roadmap** — every AI-shaped item above is explicitly placed last and
explicitly framed as additive to an already-complete human workflow,
never as a replacement for the consultant/client review-and-decide
pattern DATA_MODEL.md §1 and PRODUCT_SPEC.md principle 9 already build
into every system-suggested field in the schema.

---

## 25. Exact Recommendation For What To Build Next

**Build Phase A (§23): Supabase Auth integration, server-side session
resolution, and the two-layer authorization-resolution module described
in ARCHITECTURE.md §4** — then immediately validate it with the
recommended first vertical slice (§14): a real consultant logs in, opens
a real Engagement they're staffed on via `EngagementMembership`, and
records one `AssessmentResponse` through a Server Action that performs a
real, potentially-denying authorization check against real PostgreSQL,
producing a real `audit_log` row.

This is the correct next step, not any specific feature screen, because
(a) it is the one piece every other item in this blueprint — every
screen in §5, every gate in §22, the entire build sequence in §23 —
depends on, and (b) §12's own finding means the *feature* work behind it
is unusually low-risk once auth exists: the domain model already
supports the full MVP workflow without further schema change, so the
critical path to a demonstrable product runs through the application
layer, starting with authentication, not through more backend
milestones.

This blueprint recommends returning to the user for explicit approval of
this document, and of Phase A specifically, before any application code
is written — consistent with this session's own instruction to plan
only.

---

*End of PRODUCT_UX_BLUEPRINT.md. See PROGRESS.md for the milestone
build history this blueprint is built on top of, and DECISIONS.md for
every architectural decision referenced above by its R-/D- number.*
