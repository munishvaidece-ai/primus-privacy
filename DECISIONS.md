# PRIMUS PRIVACY — Architectural Decisions

Status: Draft v0.3 (Session 3, 2026-09-01: added R-16, closing a
historical-integrity gap found during this session's consistency review;
D-01/D-02 remain RESOLVED from Session 2). This log records material
architectural decisions and
their rationale, in the order they were made. Items requiring a human
product/business decision that cannot be safely inferred from the brief are
marked **DECISION REQUIRED** and are not assumed — implementation should
not proceed past the point where a DECISION REQUIRED item would materially
change the shape of the work, without that decision being made.

---

## Resolved blocking decisions (Session 2, 2026-09-01)

### D-01 — RESOLVED — Tenancy: PRIMUS is one tenant among a future many, from Day 1

**Decision (directed by product owner):** The platform is architected as
multi-tenant from Day 1, with a new top-level `Tenant` entity above
`Organisation`. The MVP deployment contains **exactly one** `Tenant` row
(PRIMUS). All client organisations belong to that tenant. Tenant isolation
is enforced at both the application authorization layer and the
database/RLS layer, as an outer boundary around the existing
client/engagement isolation described in SECURITY.md.

**Explicitly not built in MVP** (per direction, to avoid unnecessary SaaS
complexity): white-label functionality, multi-practice administration UI,
tenant billing/subscription functionality, tenant branding/custom domains.
The `Tenant` table carries only the minimal columns needed for isolation
(`id`, `name`, `status`, `created_at`) — no speculative
branding/billing/domain columns are added ahead of a real Phase 3
requirement for them (D-06 remains open for billing specifically).

**Why this resolves the original tension (see previous D-01 framing
below, kept for record):** the original question was whether to build
multi-practice tenancy now or treat PRIMUS as an implicit singleton baked
into the `Organisation` model. Baking it in would have meant a real schema
and RLS redesign later to retrofit multi-practice isolation. Introducing
the `Tenant` layer now — but populating it with exactly one row, and
building no multi-practice-specific UI or billing — gets the isolation
mechanism in place at negligible MVP cost while deferring every
SaaS-specific capability (billing, branding, self-service onboarding of
new practices) to when Phase 3 actually needs it. See ARCHITECTURE.md §5
and DATA_MODEL.md §2 for the resulting model, and SECURITY.md §2–§3 for
the resulting authorization/isolation layering.

*Original framing (for record):* "Is the platform single-practice... or
must the architecture support multiple, mutually isolated consulting
practices (white-label / multi-practice SaaS) in the future?" — resolved
as above: yes to the tenancy mechanism now, no to every white-label/
multi-practice/billing/branding feature built on top of it in MVP.

### D-02 — RESOLVED — Data-Landscape persistence: client-level master data, engagement-scoped assessment objects, version-pinned references

**Decision (directed by product owner):** Data-Landscape objects are split
into two tiers:

- **Client-level master data** (persists across engagements, owned by the
  client `Organisation`, not by any one `Engagement`): Business Unit, Data
  Principal Category, Personal Data Element, Purpose, System/Application,
  Data Store, Processor (including subprocessors, via the existing
  self-referential `parent_processor_id`).
- **Engagement-scoped assessment objects** (created fresh per engagement,
  never mutated by a later engagement): Processing Activity, Data Flow,
  Assessment (+ Assessment Response, Control Test), Evidence, DPIA, AI Use
  Case Assessment, Risk, Finding, Remediation Action, Maturity Assessment
  (`MaturityScore`), Quality Review.

**Mechanism chosen:** each master-data entity is split into an enduring
**identity row** (stable primary key, never deleted, only ever
retired/status-flagged) and a linked, append-only set of **version rows**
(Slowly-Changing-Dimension Type 2: each version row carries
`valid_from`/`valid_to`/`is_current` and the actual descriptive fields).
Editing a master record's compliance-meaningful attributes **creates a new
version row**; it never mutates an existing one. Every engagement-scoped
object that references a piece of master data (e.g. `ProcessingActivity`
→ `System`) does so through a junction row that stores **both** the
master identity id (for "what does this client currently look like"
queries) **and** the specific version id that was current at the time
(for "what did this look like when the FY2026 engagement ran" queries).
`ProcessingActivity` itself — being engagement-scoped rather than a shared
master object — carries an explicit `carried_forward_from_id`
self-reference so the *same logical* processing activity can be
represented as a chain of immutable, engagement-scoped snapshots over
time, instead of either (a) one mutable row shared and silently rewritten
across engagements, or (b) a full independent duplicate of the entire
client data landscape built from scratch every engagement.

Full mechanism, entity-by-entity shape, and a worked walk-through of the
FY2026 → FY2027 Processor-replacement/DPA-renewal scenario are documented
in DATA_MODEL.md §5 (design) and §5.5 (worked example) — that walk-through
was executed against this document set to confirm the mechanism actually
answers both "what is the client's current state" and "what was the
client's state during the FY2026 assessment" without overwriting history
or duplicating the whole landscape. See ARCHITECTURE.md §5 for the
resulting component/data-flow view.

**Why this resolves the original tension:** a living, engagement-agnostic
`ProcessingActivity` risked a later engagement's edit silently invalidating
what an earlier, finalized assessment was based on (the very problem the
"historical engagements must not be overwritten" principle rules out). A
fully independent per-engagement copy of the entire landscape (Business
Units, Systems, Data Stores, Processors and all) would recreate the
duplicated-data problem principle 1 warns against, and would make ordinary
master-data maintenance (e.g. correcting a System's owner) an
engagement-by-engagement chore. Splitting persistent organisational facts
(who are our systems, processors, data elements) from
point-in-time-assessed facts (what did we find true about them during this
engagement), and pinning the latter to a specific version of the former,
gets both properties without either failure mode.

*Original framing (for record):* "is `ProcessingActivity`... a living
record... or a snapshot re-created per engagement?" — resolved as: neither,
in the form originally posed. `ProcessingActivity` is engagement-scoped
(closer to the "snapshot" framing) but the *master data it references* is
a genuinely persistent, versioned client-level record — the two-tier split
above.

---

## DECISION REQUIRED items (still open)

### D-03 — Data residency

**Question:** Is there a hard requirement (contractual, or as a matter of
DPDP-practice credibility) that client evidence and personal-data-adjacent
metadata be hosted in an India Supabase region, or is any region acceptable
for MVP?

**Why it matters:** the Supabase project region is chosen once and is
expensive to change later (a full data migration). A DPDP-focused
consulting product plausibly gets asked this by clients during
procurement.

**Current status:** no region has been selected. Blocking before the first
production Supabase project is provisioned — not blocking for continued
architecture/documentation work.

### D-04 — Will the platform ever store individual data-principal PII (DSR requests, consent-receipt transactions)?

**Question:** Is `DataPrincipalCategory` always a taxonomy of *categories*
of data subjects (Customers, Employees, Children, …), or will the platform
eventually need to record actual identifiable data principals — e.g. to
manage Data Subject Requests (DSR) or log individual consent transactions
at scale?

**Why it matters:** this is not a minor scope question — it determines
whether PRIMUS PRIVACY itself becomes a processor/controller of end
data-principals' personal data (a materially larger compliance and security
obligation for the platform itself, including e-DSR volumes, individual
rights fulfillment SLAs, and a much larger attack surface of real personal
data at rest). It also determines whether `ConsentMechanism` stays a
lightweight compliance-documentation record (current MVP assumption) or
needs to become a full consent-management-platform data model.

**Current assumption (not yet confirmed):** category-level only for MVP
and Phase 2; a DSR/consent-receipt capability, if ever built, is treated as
a distinct, separately-scoped capability requiring its own security review
before any design work starts on it.

### D-05 — Malware/content scanning on evidence uploads

**Question:** Is a malware-scanning step on evidence uploads a hard
requirement before go-live (given evidence documents come from client
environments and could carry malicious payloads), or is
allow-listed-file-type + size-limit validation sufficient for MVP?

**Why it matters:** scanning requires additional infrastructure
(principle 13 cautions against unnecessary infrastructure), so this is a
deliberate trade-off between security posture and architectural
simplicity, not a default either way.

**Current assumption (not yet confirmed):** deferred past MVP (see
SECURITY.md §5, ROADMAP.md Phase 2), mitigated in the interim by upload
type/size validation and never executing uploaded files server-side.

### D-06 — Billing / subscription model for Phase 3 self-serve SaaS

**Question:** No `Subscription`/`Billing` entity exists anywhere in the
brief's core entity list, but Phase 3 explicitly requires clients to
"continue using the platform after the consulting engagement" as paying
tenants. What's the billing model (seat-based, per-engagement, flat
platform fee) and provider (e.g. Stripe)?

**Why it matters:** this materially affects the `Organisation`/`Engagement`
model (does a `CONTINUOUS_COMPLIANCE` engagement type need its own
subscription-status field?) and is explicitly out of scope for
architecture work now, but needs an answer before Phase 3 schema work
starts.

**Current status:** not designed; correctly deferred (ROADMAP.md Phase 3).

---

## Recorded decisions (resolved, with rationale)

### R-01 — Technology stack: Next.js + TypeScript + PostgreSQL + Supabase + Tailwind + shadcn/ui + Vercel

**Decision:** Adopted as proposed in the brief, no deviation.
**Rationale:** see ARCHITECTURE.md §2 for the full table. In short: this
stack gives managed multi-tenant-capable Postgres with RLS, auth, and
private storage without operating that infrastructure ourselves, and keeps
server-side authorization enforceable by construction via Next.js Server
Components/Actions. No compelling reason to deviate was found.

### R-02 — ORM/schema tooling: Drizzle, with hand-written SQL for RLS policies

**Decision:** Propose Drizzle ORM for typed schema-as-code and migrations;
RLS policies written as plain SQL migrations rather than through the ORM.
**Rationale:** typed queries reduce a class of bugs day-to-day; RLS
policies are security-critical and best reviewed as explicit, readable SQL
rather than generated output. Not yet installed — no migrations exist in
this session, per the instruction to prepare architecture only.
**Status:** proposed, open to revisiting once real schema work starts; not
a DECISION REQUIRED item because it's a reversible implementation choice,
not a product/business one.

### R-03 — Subprocessor modeled as self-referential Processor, not a separate entity

**Decision:** `Processor.parent_processor_id` (nullable, self-referential)
represents a subprocessor relationship, rather than a distinct
`Subprocessor` table.
**Rationale:** a subprocessor is structurally identical to a processor (name,
DPA, contact, risk profile) and can itself have subprocessors — a
self-referential FK supports arbitrary chain depth cleanly; a separate
table would either duplicate all processor fields or require its own
parallel relationship set, which is exactly the "disconnected/duplicated
module" pattern the brief warns against.

### R-04 — DPIA and SDF Screening modeled as specializations of Assessment

**Decision:** `DPIA` and `SDFScreeningDetail` are 1:1 extension tables
keyed on `assessment_id`, reusing `Assessment`, `AssessmentResponse`,
`Evidence`/`EvidenceLink`, `Risk`, and `Finding` rather than building
parallel evidence/finding/risk relationships specific to DPIA or SDF.
**Rationale:** directly implements the brief's explicit instruction that
these "should not be disconnected modules" and that SDF screening "should
be an assessment object with evidence, rationale, methodology version and
consultant conclusion" — that is a description of an Assessment
specialization, not a new engine.

### R-05 — Document vs. Evidence vs. Policy: one storage entity, one meaning entity

**Decision:** `Document` holds file/storage metadata; `Evidence` gives a
`Document` compliance meaning within an engagement (what it supports, its
quality, its visibility); "Policy" is a `Document.document_type`, not a
separate table.
**Rationale:** avoids a parallel "policy library" and a parallel "evidence
store" holding overlapping file data — one storage concept, one
compliance-meaning concept, connected by the same generic `EvidenceLink`
used for every other subject type.

### R-06 — "Audit" (brief) interpreted as practice-internal QualityReview, distinct from AuditLog

**Decision:** the brief's core-entity list includes both "Audit" and
"Audit Log" separately. "Audit Log" is modeled as the append-only technical
audit trail (`AuditLog`). "Audit" is interpreted as a practice-internal
quality-review/peer-review workflow object, performed by the Auditor role
(placed under PRIMUS-side roles in the brief) before work reaches the
client — modeled as `QualityReview`, deliberately named differently from
`AuditLog` to prevent the two being confused in code or conversation.
**Rationale:** the Auditor role's placement among PRIMUS-side roles (not
client-side) strongly implies an internal QA function rather than a
client's external statutory auditor being granted platform access — the
latter would be a materially different (and unstated) access-model
requirement. This is a naming/interpretation call within the bounds of the
brief, not a product-scope ambiguity, so it is recorded here rather than
raised as DECISION REQUIRED; it should be corrected quickly if the
intended meaning was actually "client's external auditor gets read access."

### R-07 — Layered authorization: application policy layer + Postgres RLS, not RLS alone

**Decision:** authorization is enforced at both the application layer
(role/permission/object-visibility) and the database layer (RLS,
tenant/engagement scoping), rather than relying on either alone.
**Rationale:** RLS is an excellent, hard-to-bypass backstop for the one
rule that must never fail (tenant/engagement scoping) but is a poor fit for
the more dynamic authorization surface (role/permission matrices per the
long role list in PRODUCT_SPEC.md, and the consultant-internal/
client-visible split) — expressing all of that purely in RLS policies would
make the policies themselves hard to audit, which undermines the goal.
Application-layer-only would leave tenant isolation dependent on every
query being written correctly, which principle 3 ("strong server-side
authorization," not "hope every query is correct") argues against.

### R-08 — Regulatory content modeled framework-agnostic even though DPDP is the only content in MVP

**Decision:** `RegulatoryReference.framework_name` is a field, not an
implicit assumption of DPDP everywhere in the schema.
**Rationale:** the brief's core entity list already implies extensibility
(`Regulatory Reference` as a generic concept, not `DPDPSection`), and
Phase 3 explicitly anticipates more frameworks. Making this a field instead
of a schema-wide assumption costs nothing now and avoids a schema migration
later. Not treated as DECISION REQUIRED since it doesn't change MVP
scope or effort — MVP still ships DPDP content only (PRODUCT_SPEC.md §5).

### R-09 — Audit-log "material change" definition

**Decision:** the specific list of entities and actions that generate an
`AuditLog` row is enumerated in SECURITY.md §6 (essentially: every write to
every compliance-meaningful entity; excludes read events, transient UI
state, and unsubmitted drafts).
**Rationale:** the brief requires "full audit history for material
changes" without defining "material" precisely; the line drawn is an
implementation-level engineering judgment (draft/unsaved state isn't yet a
"change" to anything), not a product ambiguity that changes the shape of
the platform, so it's recorded here rather than escalated.

### R-10 — `Tenant` replaces the earlier "Organisation of type PRACTICE" modeling

**Decision:** `Organisation` now exclusively represents **client**
organisations; the earlier `type = PRACTICE` variant is removed in favour
of a dedicated `Tenant` entity sitting above `Organisation`. Every `User`
carries a required `tenant_id`; client-side users additionally carry
`client_org_id`; practice-side (PRIMUS) users carry `client_org_id = NULL`.
**Rationale:** implements D-01. Reusing `Organisation` for both "the
practice" and "a client" was already a slightly awkward overload in the
original model (§12 of the original DATA_MODEL.md draft flagged the
ownership split it required); introducing a distinct `Tenant` type is
cleaner than adding an ever-growing set of practice-only columns to the
same table client rows don't need, and matches the vocabulary the product
owner used ("Practice / Workspace / Tenant").

### R-11 — Membership model gains `TenantMembership` and `OrganisationMembership` alongside `EngagementMembership`

**Decision:** two new membership junctions are added:
`TenantMembership` (User × Tenant × Role) for practice-wide standing roles
(Platform Administrator, Practice Partner), and `OrganisationMembership`
(User × Organisation × Role) for client-wide standing roles, primarily
Client Administrator. `EngagementMembership` remains the primary,
most-used scope for day-to-day content access (consultants staffed on a
specific engagement; most client roles working within a specific
engagement).
**Rationale:** the `Tenant` layer forced a decision about where
practice-wide administrative access (which was previously left implicit)
actually lives; symmetrically, Client Administrator's brief description
("manages the client organisation's own users and access") needs
org-wide standing access that per-engagement membership doesn't naturally
provide. Adding both keeps the model consistent (three matching scopes:
Tenant/Organisation/Engagement) rather than special-casing one role.
Authorization resolution now unions permissions granted at whichever
scopes apply to the request — see SECURITY.md §2.

### R-12 — Master-data versioning: Slowly-Changing-Dimension Type 2, applied uniformly to all seven master entities

**Decision:** Business Unit, Data Principal Category, Personal Data
Element, Purpose, System, Data Store, and Processor are each split into an
identity table and a version table, uniformly, even though some (e.g.
Business Unit) change far less often than others (e.g. Processor/DPA
status).
**Rationale:** implements D-02. A uniform mechanism is easier to build,
review, and reason about than mixing SCD2 for volatile entities with plain
mutation for stable ones — and the cost of uniformity is low: an entity
that never changes simply keeps a single version row forever. The
alternative (special-casing which entities get versioned) would save
little and would make the "was this fact true during the FY2026
assessment" question answerable for some entities but not others, which is
exactly the inconsistency the product owner's test scenario was designed
to catch.

### R-13 — `AIUseCase` treated as engagement-scoped, matching `ProcessingActivity`, not added to the master-data list

**Decision:** the product owner's master-data list (D-02) did not include
AI Use Cases, and explicitly listed "AI Use Case Assessments" under
engagement-scoped objects. `AIUseCase` is therefore modeled as
engagement-scoped, structurally parallel to `ProcessingActivity` (own
`carried_forward_from_id` chain), rather than as an eighth master-data
type.
**Rationale:** this is an inference filling a gap the instruction didn't
address explicitly (only "AI Use Case Assessments" was named), made by
following the same pattern already established for the one other
hub-like, clearly-named engagement-scoped object (`ProcessingActivity`).
It is recorded here, not raised as DECISION REQUIRED, because it doesn't
block the first migration and can be revisited later by adding a
master-data tier for AI Use Cases with the same SCD2 mechanism, without a
redesign — the mechanism generalizes.

### R-14 — `Evidence.engagement_id` becomes nullable; `Evidence.client_org_id` becomes the required tenant-scoping column

**Decision:** `Evidence` no longer requires an `engagement_id`. It always
requires `client_org_id` (and transitively `tenant_id`). `engagement_id`
is populated when evidence was collected in the context of a specific
engagement's assessment work, and left null for evidence attached directly
to a master-data version (e.g. a signed DPA collected during ongoing
vendor management, outside any formal engagement cycle).
**Rationale:** D-02 makes master data (e.g. `Processor`) a client-level,
not engagement-level, concept — but master data still needs supporting
evidence (contracts, DPAs, security questionnaires), and forcing that
evidence to borrow an arbitrary engagement's id would misrepresent where
it came from. Evidence's existing generic `EvidenceLink` polymorphic
association already supports linking to a `ProcessorVersion` or other
master-data version row directly; only the required-FK shape needed to
relax to match.

### R-15 — Notice, Retention Rule, and Consent Mechanism left as engagement-scoped (`ProcessingActivity`-attached) for now — flagged as a non-blocking future refinement

**Decision:** these three were not named in the product owner's
master-data list, so they remain attached to the engagement-scoped
`ProcessingActivity` as originally modeled, unchanged by this session.
**Rationale:** at least `Notice` is arguably a persistent, client-level
artifact in reality (a published privacy notice outlives any one
engagement) and could plausibly move to the master-data tier using the
same SCD2 mechanism later. Since the product owner's instructions were
specific about which seven entities move to master data, this session
does not unilaterally expand that list — but the mechanism established in
R-12 generalizes cleanly to these three if a future session decides to
apply it. Not DECISION REQUIRED: it doesn't block the first migration,
since these entities' current engagement-scoped shape is unchanged from
before this session.

### R-16 — `RiskScoringModel` and `MaturityDomainWeight` are append-only / frozen-per-engagement, closing a historical-integrity gap found during this session's consistency review

**Decision:** `RiskScoringModel` changes always create a new row (new
`version`) rather than editing `matrix_definition` in place on an existing
row; `MaturityDomainWeight` is never edited for an engagement after that
engagement's `MaturityScore` rows have been computed from it. `Risk.
inherent_rating`/`residual_rating` and `MaturityScore.score` remain
stored, computed-once values (already true of the original design) rather
than values derived live from the current scoring model/weights at read
time.
**Rationale:** while reviewing this session against the explicit
"historical data cannot be silently rewritten by current-state changes"
check, it became clear the original design named `RiskScoringModel` as
"versioned" and `MaturityDomainWeight` as "configurable" without stating
the same append-only/frozen discipline already applied to
`ControlLibraryVersion` (§6) and the D-02 master-data mechanism (§5) — an
in-place edit to either would have silently changed the documented basis
for every already-scored `Risk` or already-computed `MaturityScore` that
referenced it, which is exactly the failure mode D-02's mechanism was
built to rule out elsewhere. This closes that gap by applying the same
principle already established for methodology (R-04, §6) and master data
(R-12, §5.1) to these two scoring-configuration entities. Not raised as
DECISION REQUIRED: it's the same append-only pattern already used
elsewhere in this schema, applied consistently, not a new product
decision.
