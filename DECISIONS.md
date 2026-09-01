# PRIMUS PRIVACY — Architectural Decisions

Status: Draft v0.10 (Session 17, 2026-09-01: D-03 — data residency —
RESOLVED: Supabase, AWS Mumbai region `ap-south-1`, directed by the
product owner; see D-03 below. D-01/D-02 remain RESOLVED from Session
2; D-04/D-05/D-06 remain open; R-16 through R-93 from Sessions 3-16
stand unchanged — see PROGRESS.md for the Slice-by-slice build log).
This log records material architectural decisions and
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

### D-03 — RESOLVED (Session 17, 2026-09-01) — Data residency: Supabase, AWS Mumbai region (`ap-south-1`)

**Decision (directed by product owner):** PRIMUS production
infrastructure will use Supabase with the specific AWS Mumbai region
`ap-south-1`. Concretely:

- **Supabase PostgreSQL** → Mumbai (`ap-south-1`).
- **Supabase Storage** → Mumbai, the same production project as the
  database (not a separate project/region).
- **Supabase Auth** → the same production project (not a separate
  project/region).
- Any other Supabase-managed regional processing (e.g. Edge Functions,
  if ever adopted) should use Mumbai where the service supports
  regional pinning.
- **No production client documents** are to be uploaded or stored
  anywhere until the actual Mumbai-region production Supabase project
  exists and is the one in use — this decision authorizes the choice
  of region, not the provisioning itself (explicitly not done as part
  of this decision — see "Not done by this decision" below).

**Basis for the decision:** PRIMUS's own product/security/contractual
requirement for India-region residency of client data — a business
decision the product owner made for this product, not a claim that
India-region hosting is the only legally permissible configuration.

**Important clarification, recorded verbatim because it is easy to
mis-state:** the DPDP Act does **not** universally require all personal
data to remain in India. The Act permits the Central Government to
restrict transfers of personal data to specified countries or
territories (a notified-list mechanism, not a blanket in-country-only
rule) — as of this decision, no such notification exists that would
make India-only hosting a DPDP-mandated requirement for PRIMUS's own
processing. PRIMUS is choosing India-region residency as its **own**,
stronger-than-legally-required product/security/contractual posture —
useful for client procurement credibility and a defensible-by-default
security stance, not because DPDP itself compels it. Nothing in this
project's documentation should assert or imply the stronger claim
("DPDP requires all personal data to stay in India") — SECURITY.md,
ARCHITECTURE.md, and any client-facing material should describe this as
PRIMUS's own residency commitment, not a restatement of DPDP's actual
transfer-restriction mechanism.

**Region selection is a data-location control only.** Choosing
`ap-south-1` decides *where the bytes physically sit* — it is not, by
itself, a claim of regulatory compliance, security adequacy, or DPDP
conformance. Production readiness still requires the full set of
separate, substantive controls this decision does **not** provide:

- private storage (no publicly-readable buckets/objects)
- signed URLs (time-limited, scoped access to any stored file — never a
  permanent public link)
- Row-Level Security (already built, Milestones 1-9; a real Supabase
  project must actually run with it enforced, not merely have the SQL
  defined)
- authentication (Supabase Auth is provisioned, but its production
  configuration — session policy, MFA where required, etc. — is a
  separate exercise from picking a region)
- audit (the existing `audit_log` mechanism; a production deployment
  must actually be writing to it under real traffic)
- encryption (at rest and in transit — Supabase's own platform defaults
  plus anything PRIMUS layers on top, evaluated separately)
- malware/content scanning on uploads (D-05, still open/deferred)
- retention/deletion policy and its actual enforcement
- processor contractual controls (a Data Processing Agreement/equivalent
  with Supabase itself, and with any other processor in the chain)
- backup/recovery (a tested restore procedure, not merely "backups are
  enabled")
- monitoring (of the production system's own health/security signals)
- incident response (a real, exercised plan, not only a document)

None of these are addressed by this decision. Each remains its own,
separate piece of production-readiness work, tracked in PROGRESS.md's
production-readiness section, not silently assumed to be "handled" by
having picked a region.

**Not done by this decision (explicitly, per instruction):** the
production Supabase project itself is **not** provisioned as part of
recording this decision — `ap-south-1` is now the settled *target*
region for when it is provisioned, closing the "which region" half of
D-03's original open question, but no infrastructure change, Storage
implementation, or schema change accompanies this entry. `lib/db/
request-client.ts`'s own documented limitation (DECISIONS.md R-85) —
that this project's `DATABASE_URL` still points at a local Postgres
superuser rather than a real Supabase `authenticator` role — is
therefore **not** closed by this decision either; it closes only once a
real `ap-south-1` project exists and the application is repointed at
it, which remains separate, future work.

*Original framing (for record):* "Is there a hard requirement
(contractual, or as a matter of DPDP-practice credibility) that client
evidence and personal-data-adjacent metadata be hosted in an India
Supabase region, or is any region acceptable for MVP?" — resolved as
above: yes, a hard requirement, specifically `ap-south-1`, decided by
the product owner as PRIMUS's own posture rather than as a restatement
of what DPDP itself mandates.

---

## DECISION REQUIRED items (still open)

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

---

## Milestone 1 implementation decisions (Session 4, 2026-09-01)

Recorded while building the Identity + Tenancy + Engagement Structure
database foundation (`drizzle/migrations/0000_identity_tenancy_engagement.sql`,
`0001_identity_tenancy_engagement_security.sql`). See PROGRESS.md for the
full milestone report.

### R-17 — Membership grants/revocations are service_role-only in Milestone 1's RLS; no self-service write path for `authenticated`

**Decision:** `tenant_memberships`, `organisation_memberships`, and
`engagement_memberships` have a SELECT policy for `authenticated` (see
their own rows, plus the roster of any scope they're an active member of)
but no INSERT/UPDATE/DELETE policy at all — granting or revoking a
membership requires the `service_role` connection (bypasses RLS), used
only by trusted server-side application code that performs its own
authorization/permission check first.
**Rationale:** SECURITY.md's threat table requires that granting a
broader membership "requires a permission of its own, not just write
access to the membership table." Encoding *which* role can grant *which*
other role, safely, as a self-service RLS policy is exactly the dynamic
role-permission-matrix logic R-07 already says doesn't belong in RLS
(RLS is the tenant/scope-isolation backstop, not the fine-grained
permission engine). Until a future milestone's object-level permission
model can express "requires permission X" inside a WITH CHECK safely,
routing all membership mutations through server-only code is the
conservative, correct choice — consistent with ARCHITECTURE.md's
"Next.js server ↔ Postgres: only server processes hold database
credentials" pattern, which the browser never violates anyway.

### R-18 — `tenants` table writes (INSERT/UPDATE/DELETE) are service_role-only in Milestone 1

**Decision:** No `authenticated`-role write policy exists on `tenants`;
provisioning a new practice tenant is treated as a platform-ops action in
this milestone, performed via service_role.
**Rationale:** the MVP has exactly one `Tenant` row (DECISIONS.md D-01);
there is no in-product "create a new tenant" workflow to support yet, and
building RLS for a feature that doesn't exist yet would be premature.
When Phase 3 (multi-practice) becomes real, this gets a proper
permission-gated policy alongside whatever admin workflow creates it.

### R-19 — `organisations.tenant_id` and `engagements.{tenant_id,organisation_id}` are immutable after creation, enforced by a trigger rather than an RLS `WITH CHECK`

**Decision:** `BEFORE UPDATE` triggers (`organisations_prevent_reparenting`,
`engagements_prevent_reparenting`) unconditionally reject any attempt to
change these columns, regardless of who is asking — including
`service_role` and the Postgres superuser used for fixture setup.
**Rationale:** RLS's `WITH CHECK` can express "the acting user must be
authorized to make this change" but cannot cleanly compare OLD vs. NEW
column values to express "this specific column must never change" without
also blocking ordinary updates to other columns by users who legitimately
lack tenant-wide membership (a Client Administrator updating their own
org's name has `OrganisationMembership` but not `TenantMembership`, so a
`WITH CHECK` requiring tenant membership for *any* update would wrongly
block that). A trigger comparing `OLD`/`NEW` directly is the correct tool
for an absolute, per-column immutability rule, and is verified in
`tests/rls/tenancy-consistency.test.ts` (Milestone 1 RLS Test 3) to hold
even for a superuser bypassing RLS entirely — proving reparenting is
impossible at the schema level, not just discouraged by policy.

### R-20 — `users.email` is a synced, denormalized convenience column, not a duplicated credential

**Decision:** `public.users.email` is kept in sync with `auth.users.email`
via an `AFTER UPDATE` trigger (`on_auth_user_email_updated`) and set once
at provisioning time (`on_auth_user_created`); it is never written
directly by application code.
**Rationale:** Milestone 1 instructions §2 say "do not duplicate Supabase
authentication credentials in our own database unnecessarily." An email
address is an identifier, not a credential — no password hash, MFA
secret, or session token exists anywhere outside `auth.users`/`auth`
schema tables, which this migration set never touches except via the
provisioning trigger's read of `NEW.email`/`NEW.raw_user_meta_data`.
Without a synced copy, every membership-roster or "who does this belong
to" query would need a separate Supabase Admin API call per user, which
is both an unnecessary runtime dependency and contrary to "one source of
truth" for ordinary read paths.

### R-21 — `auth.users` → `public.users` provisioning requires `raw_app_meta_data.tenant_id`; there is no default-tenant fallback

**Decision:** the `handle_new_auth_user()` trigger function raises an
exception if `NEW.raw_app_meta_data ->> 'tenant_id'` is absent — it never
silently defaults to the (currently only) tenant.
**Rationale:** Milestone 1 has no self-service signup (ROADMAP.md places
that in Phase 3), so every real user account is expected to be
provisioned by trusted server-side code via the Supabase Admin API, which
sets `app_metadata.tenant_id` (and, for client-side users,
`client_org_id`) at creation time. Defaulting to "the one tenant that
happens to exist right now" would be a silent, MVP-only assumption baked
into a trigger that's supposed to also work once a second tenant exists
(D-01) — failing loudly instead keeps the provisioning path correct as
written, unconditionally, rather than correct only by accident of there
being one tenant today.

### R-22 — Role-to-scope assignment for the 12 seeded roles (`db/seed/roles.ts`)

**Decision:** `Platform Administrator` and `Practice Partner` are seeded
as `tenant`-scoped roles; `Client Administrator`, `Privacy Officer`, and
`CXO / Executive Viewer` as `organisation`-scoped; the remaining seven
(`Engagement Manager`, `Consultant`, `Auditor`, `Business Owner`,
`IT/CISO`, `Procurement`, `Legal`) as `engagement`-scoped.
**Rationale:** the tenant/organisation split for `Platform
Administrator`/`Practice Partner` vs. everyone PRIMUS-side follows
DECISIONS.md R-11 directly. The client-side split is a judgment call this
milestone had to make that R-11 didn't fully resolve: `Client
Administrator` was explicitly named in R-11 as organisation-scoped;
`Privacy Officer` and `CXO / Executive Viewer` are added to that tier
here because PRODUCT_SPEC.md describes them as needing "broadest
client-side visibility" and "summary/dashboard-level visibility ... for
governance reporting" respectively — both read as needing all of a
client's engagements, not one at a time, which only organisation-level
membership provides. `IT/CISO` is kept `engagement`-scoped for now even
though it will plausibly want client-wide visibility once master data
(Systems, Processors — DECISIONS.md D-02) exists in a later milestone;
narrower-than-necessary is the safer default to widen later, and this is
recorded as revisitable, not a considered final answer. None of this is
DECISION REQUIRED: it's seed-data classification within an already-agreed
three-scope model, easily changed by editing `db/seed/roles.ts` and
re-running it — not a schema or RLS change.

### R-23 — Business Unit, `control_library_version_id`, and `EngagementMembership.business_unit_id` are deliberately out of Milestone 1

**Decision:** no `business_units` table exists in this migration set;
`engagements.control_library_version_id` (from DATA_MODEL.md §3) and
`engagement_memberships.business_unit_id` (from DATA_MODEL.md §2) are
both omitted from the Milestone 1 schema.
**Rationale:** Milestone 1 instructions §2 name exactly six concepts to
implement (Tenant, Organisation, Engagement, User, and the three
membership tables); Business Unit is not among them, and `Control` /
`ControlLibraryVersion` belong to the (explicitly out-of-scope) Assessment
Engine milestone. Including a foreign key to a table that doesn't exist
yet isn't possible, and building Business Unit now would be exactly the
kind of "blindly create every field from the conceptual documents" the
instructions warn against. This is a scope cut, not a design change —
DATA_MODEL.md is unmodified; these fields are simply not yet built.

### R-24 — Local Postgres 16 + a hand-written `auth` schema/role shim stands in for Supabase in this milestone's tests, per D-03 being unresolved

**Decision:** `tests/rls` runs against a local PostgreSQL 16 database
with `scripts/local-dev-auth-shim.sql` providing a byte-for-byte
reimplementation of Supabase's `auth.uid()` and the
`anon`/`authenticated`/`service_role` role shape — clearly marked as
local/CI-only and never to be run against a real Supabase project (which
already provides all of it).
**Rationale:** Milestone 1 instructions §10 explicitly anticipate and
permit this ("If a full Supabase environment is not yet provisioned
because D-03 data residency is unresolved, use a local/test
PostgreSQL-compatible environment where practical... Clearly document any
limitation."). The two real migrations
(`0000_identity_tenancy_engagement.sql`,
`0001_identity_tenancy_engagement_security.sql`) contain nothing
Supabase-incompatible and were not modified to accommodate the shim — the
shim exists entirely alongside them, in a separate file, so what's tested
locally is exactly what would run against a real Supabase project.
**Known limitation:** this shim does not (and cannot) exercise
Supabase-specific request-layer behavior (PostgREST's actual JWT
verification, Storage, realtime, connection pooling via PgBouncer) — only
the `auth.uid()` / role-membership mechanics that this milestone's RLS
policies depend on. Full end-to-end verification against a real Supabase
project is still required once D-03 is resolved and a project is
provisioned, before this is considered production-verified rather than
locally-verified.

---

## Milestone 2 implementation decisions (Session 5, 2026-09-01)

Recorded while building the Client Master Data database layer
(`drizzle/migrations/0002_client_master_data.sql`,
`0003_client_master_data_security.sql`). See PROGRESS.md for the full
milestone report.

### R-25 — Every master-data version table denormalizes `organisation_id`, with a composite FK back to its identity table

**Decision:** `system_versions`, `processor_versions`, and the other four
version tables all carry their own `organisation_id` column (not just
`system_id`/`processor_id`/etc.), constrained by
`FOREIGN KEY (<entity>_id, organisation_id) REFERENCES <identity>(id,
organisation_id)`.
**Rationale:** two reasons, both load-bearing. First, RLS: every policy
on a version table evaluates `can_access_organisation(organisation_id)`
directly off the row's own column — with **no subquery back into that
same table** — deliberately avoiding the exact class of bug Milestone 1
found and fixed in `can_access_engagement` (a self-referential subquery
on the table being `INSERT ... RETURNING`-ed into cannot see the row
being inserted). Second, integrity: the composite FK means a version row
can never be inserted under an `organisation_id` that doesn't actually
match its own identity row's organisation, even by a bug or a
direct/service-role write — the same discipline as
`engagements(organisation_id, tenant_id) -> organisations(id,
tenant_id)` from Milestone 1, applied one level deeper.

### R-26 — SCD2 "close out the previous version" runs as a `BEFORE INSERT` trigger, not `AFTER INSERT`

**Decision:** each version table's close-out trigger fires `BEFORE
INSERT`, closing out whatever row was previously current for that
identity *before* the new row is actually written — not `AFTER INSERT`.
**Rationale:** the `one_current_key` partial unique index (`(<entity>_id)
WHERE is_current = true`) is checked immediately as each row is written,
not deferred. An `AFTER INSERT` trigger would try to insert the new
current row first (while the old one is still marked current), which
would trip that very index before the trigger ever got a chance to close
the old row out — a real ordering bug, not a hypothetical one (caught by
directly reasoning through the transaction semantics before writing any
test, given how costly this exact class of self-reference/timing bug
proved in Milestone 1). Firing `BEFORE INSERT` and closing out the old
row first means the new row's own insert never conflicts with anything.

### R-27 — Version rows are immutable to application code via `GRANT`, not only via a missing RLS policy

**Decision:** `authenticated` receives `SELECT, INSERT` on every version
table and explicitly no `UPDATE` grant at all (migration 0003 §7) — not
merely "no UPDATE policy," which alone would already deny it under RLS,
but a genuine absence of the underlying table privilege, checked before
RLS is even evaluated.
**Rationale:** the same belt-and-suspenders posture Milestone 1 applied
to `audit_log`'s append-only guarantee (DECISIONS.md, migration 0001
§7): a version row's descriptive fields must never be edited in place —
only the `SECURITY DEFINER` close-out trigger (R-26), owned by the
migration-running role rather than `authenticated`, may ever change a
version row's `is_current`/`valid_to` after creation. Removing the grant
outright means even a future bug in RLS policy authoring couldn't
accidentally reopen a write path here.

### R-28 — Cross-organisation reference safety for a future engagement-to-master-data link is proven with a test-only scratch table, not a shipped junction table

**Decision:** `tests/master-data/version-tenant-consistency.test.ts`
creates and rolls back an ordinary (not `TEMP` — Postgres forbids a
foreign key from a temporary table to a permanent one) scratch table
shaped exactly like DATA_MODEL.md §5.3's future
`ProcessingActivitySystem` junction, to prove the composite-FK mechanism
correctly rejects a cross-organisation reference — without building
`ProcessingActivity` or any of its junction tables, which Milestone 2
instructions §1/§12 explicitly place out of scope.
**Rationale:** instruction §4 requires demonstrating "an engagement
cannot reference a version belonging to another Organisation/Tenant,"
but the entity that will actually hold that reference doesn't exist
yet. Building it prematurely to satisfy a test would violate the
milestone's own scope boundary; not testing the property at all would
leave a core historical-integrity claim unverified. A scratch table
scoped to one test's transaction — never migrated, never part of the
shipped schema — resolves the tension: it proves the *mechanism* (the
same composite-FK technique already used throughout this schema) works,
using only already-shipped tables as its FK targets. The two *already
shipped* composite FKs that touch this same property directly
(`DataStoreVersion.system_version_id`, `Processor.parent_processor_id`)
are also tested, for a real (not scratch-table) proof point.

### R-29 — `ProcessorVersion.dpa_document_id` deferred; `dpa_version_label` (free text) carries the worked examples instead

**Decision:** DATA_MODEL.md §5.1 lists `dpa_document_id` as a
`ProcessorVersion` field; this migration does not include it.
**Rationale:** mirrors DECISIONS.md R-23's pattern from Milestone 1 — a
Document/Evidence table doesn't exist until a later milestone
(Discovery/Evidence, not yet built), so a hard FK to it isn't possible,
and an FK-less dangling UUID column inviting future wiring was judged
worse than simply not having the column yet. `dpa_version_label` (plain
text, already in the schema) is enough to represent DATA_MODEL.md §5.5's
own worked examples ("DPA version 1") without it.

### R-30 — Master-data auditability is enforced by database triggers, not left to a future application-layer audit service

**Decision:** every one of the 13 master-data tables carries a
`SECURITY DEFINER` `AFTER INSERT` (and, for identity tables, `AFTER
UPDATE`) trigger that writes an `audit_log` row automatically — one
generic function (`log_master_data_change()`), reused across all 13
tables since every one of them carries `organisation_id` directly.
**Rationale:** Milestone 1 documented audit-log population as an
application-layer "Audit service" responsibility (ARCHITECTURE.md §4,
SECURITY.md §6) and built only the table + RLS foundation, since no
application code existed yet to call it. Milestone 2 instructions §15
make "must be auditable" an explicit deliverable for master-data
creation, modification, version creation, and retirement — and since
there is still no application/service layer in this milestone either,
the only way to make that true *now*, rather than as a promise for a
later milestone, is to enforce it at the database level. This is a
strengthening of the original design, not a contradiction of it: a
future application-layer audit service can still write additional,
richer audit entries (e.g. with a human-authored `reason` for an
override) alongside these automatic ones — the trigger guarantees a
baseline that never depends on application code remembering to log
anything, which the original app-layer-only design didn't.

### R-31 — One generic reparenting-guard trigger function, reused across all seven master-data identity tables

**Decision:** `public.prevent_master_data_reparenting()` is a single
function (using `TG_TABLE_NAME` for its error message, not per-table
logic) attached via `CREATE TRIGGER` to each of the seven identity
tables — unlike Milestone 1, which wrote two separate, table-specific
functions (`prevent_organisation_reparenting`,
`prevent_engagement_reparenting`) for the same kind of guard.
**Rationale:** Milestone 1's two guarded tables protected different
column sets (`organisations.tenant_id` alone vs.
`engagements.{tenant_id, organisation_id}` together), so table-specific
functions were the simplest correct option there. Every Milestone 2
master-data identity table protects exactly one column,
`organisation_id`, with identical semantics — a genuine case where one
generic function is simpler and no less clear than seven near-identical
copies, not a departure from Milestone 1's general preference for
explicit, un-clever SQL (which is why the six SCD2 close-out triggers,
whose column names genuinely differ per table, remain six separate
functions rather than one dynamic-SQL one — see R-26 and the migration
file's own comments).

---

## Milestone 3 implementation decisions (Session 6, 2026-09-01)

Recorded while building Processing Activity & the Version-Pinned Junction
Layer (`drizzle/migrations/0004_processing_activity.sql`,
`0005_processing_activity_security.sql`). See PROGRESS.md for the full
milestone report.

### R-32 — `lifecycle_status` values adopted verbatim from Milestone 3's own instructions; no transition rules enforced

**Decision:** `processing_activity_lifecycle_status` is
`draft`/`active`/`under_review`/`retired`; any status may move to any
other — no state-machine trigger restricts transitions.
**Rationale:** DATA_MODEL.md §5.2 names `lifecycle_status` as a field
without fixing its values. Milestone 3 instructions §10 explicitly say
"If the document supports states such as: Draft, Active, Under Review,
Retired, use the documented values" — that four-state set is adopted
exactly, rather than inventing a competing lifecycle, since it's the
instruction's own offered default in the absence of a DATA_MODEL.md
definition. Transition rules ("can a Draft go straight to Retired?") are
genuinely unspecified anywhere, and instruction §10 says to document that
rather than silently build workflow logic — so no transition constraint
exists. Not DECISION REQUIRED: the instruction itself supplied a
reasonable default value set; only the transition-rule question is left
open, and it's a additive, non-breaking thing to add later (a trigger
checking OLD/NEW status) without a schema change.

### R-33 — `processing_activities.owner_user_id` is a direct Drizzle `.references()`, unlike `created_by`/`updated_by`

**Decision:** `owner_user_id` is declared with `.references(() =>
users.id)` directly in `db/schema/processing-activities.ts`; `created_by`
and `updated_by` still get their FK added via `ALTER TABLE` in the
migration SQL, matching every other table since Milestone 1.
**Rationale:** the `ALTER TABLE`-in-SQL pattern exists specifically to
avoid a circular TypeScript module import (`users.ts` needs to reference
`tenants.ts`/`organisations.ts`, so those files can't cleanly import
`users.ts` back at the top level). `processing-activities.ts` has no such
cycle — nothing in `users.ts` needs to import it — so there is no reason
to apply the workaround to `owner_user_id` specifically; doing so anyway
would be copying a pattern past the problem it solves. `created_by`/
`updated_by` keep the established pattern for consistency across every
table, even though (for this specific table) they technically wouldn't
need to.

### R-34 — Triple composite FK `(version_id, identity_id, organisation_id)`, extending Milestone 2's pairwise `(version_id, organisation_id)` pattern; requires new `UNIQUE` constraints on Milestone 1/2 tables, added as an additive extension migration

**Decision:** every version-pinned junction's FK to a master-data version
table references three columns at once —
`(x_version_id, x_id, organisation_id) REFERENCES x_versions(id, x_id,
organisation_id)` — not just `(x_version_id, organisation_id)` as
Milestone 2's own version tables used internally. This requires new
`UNIQUE(id, x_id, organisation_id)` constraints on all six version
tables and a new `UNIQUE(id, organisation_id, tenant_id)` on
`engagements`, added via `ALTER TABLE` (both in the TS schema files —
`db/schema/systems.ts` etc. — and, correspondingly, in migration 0004's
generated SQL, reordered — see R-39).
**Rationale:** Milestone 2's pairwise FK only proves "this version
belongs to *some* entity in this organisation" — it does not prove the
version belongs to the *specific* identity (`system_id`, `processor_id`,
…) the junction row also names. A junction row could otherwise pass its
pairwise FK while `x_version_id` and `x_id` silently referred to two
different, unrelated entities that both happen to share an organisation.
The triple FK closes this gap completely, and — because the junction's
single `organisation_id` column is the one both the
Processing-Activity-side FK and the version-side FK constrain — also
gets "the Processing Activity's organisation equals the version's
organisation" for free, without a third check (Milestone 3 instructions
§5 items 11-12). This is additive schema evolution on already-shipped
tables (new `UNIQUE` constraints only; no column, data, or existing-FK
change), not a correction of a Milestone 1/2 defect — those milestones
were correct as far as they went; they simply didn't anticipate a
consumer needing this stricter guarantee, which would have been
premature to build before that consumer existed (Milestone 3 instructions
§15 distinguishes "correcting an error" from this kind of extension, and
this session treats it as the latter).

### R-35 — Version-pinned junction tables are insert/delete only, never updated in place

**Decision:** none of the six junction tables have an `UPDATE` grant or
RLS policy for `authenticated`. "Changing" which version of a System (or
Processor, Purpose, …) a Processing Activity is pinned to means deleting
the old junction row and inserting a new one — never updating an existing
row's `x_version_id`.
**Rationale:** a version-pinned junction row's meaning *is* the specific
version it names — DATA_MODEL.md §5.3 describes it as "what did this look
like when the engagement ran," a fact asserted once. Allowing in-place
updates would blur "we changed our mind about which version applies" with
"we're now asserting a different fact," and would also reopen exactly the
kind of accidental-history-rewrite risk every prior milestone's
immutability guards exist to prevent. Delete-then-insert keeps each state
change as two distinct, separately-audited events (a `delete` and an
`insert` row in `audit_log` — DECISIONS.md R-38) rather than one opaque
`update`.

### R-36 — `ProcessingActivityNotice` and `DataFlow` remain unbuilt

**Decision:** neither DATA_MODEL.md §5.3's `ProcessingActivityNotice`
junction nor §5.2's `DataFlow` table exist in this milestone's schema.
**Rationale:** `Notice` itself doesn't exist as a table (deferred since
before Milestone 2 — DECISIONS.md R-15), so a junction to it isn't
possible yet. `DataFlow` was never named in Milestone 3's instructions
(§1-§14 name Processing Activity and its version-pinned links to the
seven master-data entities specifically); building it without being
asked would be exactly the kind of unrequested scope Milestone 3
instructions §2 and §14 warn against. Both remain schema-ready to add
later: `DataFlow`'s polymorphic endpoint design (DATA_MODEL.md §5.2) is
unaffected by anything built this milestone, and a `ProcessingActivityNotice`
junction would follow the exact same six-table pattern already
established the moment `Notice` exists.

### R-37 — `ProcessingActivity.business_unit_id` is a direct reference to the identity row, not version-pinned

**Decision:** `business_unit_id` on `processing_activities` is a plain
(composite-FK-guarded) reference to `business_units.id` — not a junction
table, and not pinned to a specific state of the business unit the way
System/Processor/etc. links are.
**Rationale:** DATA_MODEL.md §5.3 explicitly carves Business Unit out of
version-pinning already ("`EngagementBusinessUnitScope` and
`EngagementMembership.business_unit_id` … reference `business_unit_id`
directly, not a version — these are structural/administrative
associations … not compliance facts asserted during the engagement").
`ProcessingActivity.business_unit_id` is the same kind of association
("which part of the client does this activity belong to"), so it gets
the same treatment Milestone 2's `BusinessUnit` table itself already
has (no version table at all) — this isn't a new decision, just applying
an existing one consistently to a new consumer.

### R-38 — A second, DELETE-aware generic audit-trigger function for junction tables

**Decision:** `public.log_processing_activity_relationship_change()` is a
new function, distinct from Milestone 2's `log_master_data_change()`,
used only by the six junction tables' `AFTER INSERT OR DELETE` triggers.
**Rationale:** `log_master_data_change()` reads `NEW.id`/
`NEW.organisation_id`, which is `NULL` for a `DELETE` trigger (only `OLD`
is populated then) — since junction tables need DELETE auditing (R-35)
and `processing_activities` itself does not (it's never hard-deleted,
matching every master-data identity table since Milestone 2), a single
shared function would need to handle a case
(`processing_activities` + `DELETE`) that should never actually occur.
Two small, purpose-fitted functions were judged clearer than one function
defensively handling a combination its own callers never use.

### R-39 — Migration 0004's generated statement order was corrected before first use (new `UNIQUE` constraints moved ahead of the FKs that depend on them)

**Decision:** `drizzle-kit generate` emitted the new `UNIQUE` constraints
on `engagements`/the six version tables (R-34) *after* the composite FKs
that reference them, in the same file — applying it as generated failed
with "no unique constraint matching given keys." The statements were
reordered (constraints first, then the FKs) within the same, still-unapplied
generated file before it was ever run against any database.
**Rationale:** not a correction of prior migration history (Milestone 3
instructions §15) — migration 0004 had never been applied anywhere; this
is the normal "review generated SQL before trusting it" step every
migration in this project has gone through. Recorded here because it's a
real, likely-to-recur drizzle-kit limitation (it doesn't topologically
order cross-table `ALTER TABLE` statements within one generated file) —
worth watching for in any future milestone that adds a `UNIQUE`
constraint to an existing table in the same generation pass as a new
table's FK against it.

---

## Milestone 4 — Regulatory Content & Control Library (Session 7, 2026-09-01)

### R-40 — `RegulatoryReference`, `Requirement`, `ControlLibraryVersion`, and `Control` are Tenant-scoped, not Organisation-scoped

**Decision:** All four methodology identity tables carry `tenant_id`
directly (no `organisation_id` column anywhere on them), and RLS/triggers
are keyed on `tenant_id` throughout — a structurally different scope
column from every Milestone 2/3 client-data table.
**Rationale:** DATA_MODEL.md §12 states this explicitly: "`Control`,
`Requirement`, `RegulatoryReference` belong to the **Practice** (via
`Tenant` and `ControlLibraryVersion`), never to a client." This is the
concrete database-enforced separation between "methodology" and "client
data" the milestone brief asks for — not a new design choice so much as
DATA_MODEL.md's existing statement, finally given columns and RLS
policies.

### R-41 — A new, separate reparenting-guard function keyed on `tenant_id` (`prevent_methodology_reparenting()`), not a reuse of Milestone 2's `prevent_master_data_reparenting()`

**Decision:** A new generic trigger function, structurally identical to
migration 0003's but checking `tenant_id` instead of `organisation_id`,
applied to all four methodology identity tables.
**Rationale:** The existing function is hard-coded to the column name
`organisation_id`; these tables don't have that column at all (R-40).
Rather than parameterizing one function over an arbitrary column name
(which Postgres trigger functions can't easily do without dynamic SQL —
itself a bigger complexity increase than a second small function),
duplicating the same three-line pattern under a new name was judged
clearer and consistent with how migration 0005 already introduced its
own new functions where the existing ones' shape didn't fit (R-38).

### R-42 — Control library versioning is NOT the client SCD2 pattern: a new library version means new `Control` rows, not new rows in a version table pointing back to a shared identity row

**Decision:** `ControlLibraryVersion` and `Control` together implement
the practice-owned version chain — there is no separate "Control
identity" table with a "Control version" table hanging off it the way
System/Processor/etc. work. A `Control` belongs to exactly one
`ControlLibraryVersion` via a plain `NOT NULL` FK; carrying a control's
intent forward into a new library version means creating a brand new
`Control` row (new `id`, new `control_library_version_id`, the same
human-readable `code`) with no formal link back to the row it succeeds.
**Rationale:** Milestone 4 instructions state directly: "do not reuse the
client SCD2 versioning pattern blindly for the control library." The
client pattern exists to answer "what did this client's System look like
on this date" for a single, ongoing entity; the control-library need is
different — "what was in Library v1.0 vs v2.0," where v1.0 and v2.0 are
two complete, independently-immutable snapshots, not a chain of
diffs against one canonical row. Treating each library version's
Controls as their own independent rows is what makes the
historical-reproducibility guarantee (R-45) trivial: v1.0's rows are
simply never touched by anything that happens to v2.0.
**Trade-off accepted:** there is no queryable "this is the same control,
evolved" relationship between a v1.0 Control and its v2.0 successor
beyond the shared `code` value (a human convention, not an FK). This was
judged acceptable: Milestone 4 instructions explicitly ask for *simple*
draft/published/retired semantics, not a full carry-forward workflow,
and nothing in DATA_MODEL.md §6 gives `Control` a `carried_forward_from_id`
column the way `ProcessingActivity`/`AIUseCase` have (DATA_MODEL.md §5.4,
§7). A future milestone could add such a column additively if the need
becomes concrete.

### R-43 — `Requirement` is not scoped to a `ControlLibraryVersion`, deliberately, so a Requirement (e.g. "R1") can be mapped from multiple library versions

**Decision:** `requirements` carries `tenant_id` but no
`control_library_version_id` — a `Requirement` is Practice-owned
reference content that exists independently of any one library version,
and is connected to specific library versions only indirectly, through
whichever `Control` rows happen to be mapped to it via
`ControlRequirement` at any point in time.
**Rationale:** DATA_MODEL.md §6's field list for `Requirement` names no
such column, and the milestone's own historical-reproducibility scenario
requires it: "Library v1.0 (R1, C1, C2)... later Library v2.0 (R1, C1,
C2, C3...)" describes the *same* R1 participating in both versions' story
— it is the mapping (R-42's new `Control` rows + fresh `ControlRequirement`
rows) that changes per version, not the Requirement's own identity.
**Consequence, recorded openly:** because `Requirement`'s own descriptive
fields (`title`, `description`) are not gated by any `ControlLibraryVersion`
status, editing a `Requirement` after a library version that references it
has been published is possible (blocked only by the `active`/`retired`
status enum, not a publish-immutability trigger — R-44). This is a
deliberate scope boundary, not an oversight: the milestone's published-
immutability guarantee is about the library's *Control set and mappings*
(R-45's six questions are all answerable without it), not about freezing
every word of the underlying regulatory prose language it cites. A future
milestone could add stricter Requirement versioning if a real need
surfaces.

### R-44 — Published-immutability enforcement applies to `ControlLibraryVersion`, `Control`, and `ControlRequirement` only — not to `RegulatoryReference`/`Requirement`/`RequirementRegulatoryReference`

**Decision:** `RegulatoryReference` and `Requirement` use a simple
`active`/`retired` status (mirroring, but not reusing, `master_data_status`
— see enums.ts) with ordinary UPDATE allowed while `active`, no
publish-style locking. `RequirementRegulatoryReference` (their junction)
is insert/delete-only with no version-status gate at all. Only
`ControlLibraryVersion.status` transitions, `Control` mutations, and
`ControlRequirement` mutations are gated by the draft/published/retired
lifecycle (migration 0007 §4-6).
**Rationale:** direct consequence of R-43 — `RequirementRegulatoryReference`
connects two entities that are neither one library-version-scoped, so
there is no `ControlLibraryVersion` for a trigger to consult. Milestone 4
instructions ask for immutability of "published methodology" specifically
in the context of what an Engagement pins to (`ControlLibraryVersion`) —
that is the object whose content must not silently change underneath a
historical Engagement, and it is fully covered by gating `Control`/
`ControlRequirement` (everything reachable by joining from a
`ControlLibraryVersion`).

### R-45 — Deliberately simple, hand-written status-transition trigger for `ControlLibraryVersion`, not a workflow/state-machine table

**Decision:** One `BEFORE UPDATE` PL/pgSQL function
(`prevent_control_library_version_tampering()`) encodes all transition
rules directly as `IF`/`RAISE EXCEPTION` branches: `draft -> published`
allowed (auto-stamps `published_at`); `published -> retired` allowed;
every other transition blocked; any edit to descriptive fields blocked
once `published` or `retired`.
**Rationale:** Milestone 4 instructions explicitly ask to "keep transition
rules simple, document decisions rather than building sophisticated
workflow logic." A generic state-machine table (allowed-transitions
matrix, roles-per-transition, etc.) was considered and rejected as
exactly the kind of unrequested structure the brief warns against —
three explicit states with one legal forward path each are simple enough
to hand-code directly and remain fully auditable via the existing
`audit_log` mechanism (R-46) without any new tooling.

### R-46 — A new tenant-scoped audit-trigger function pair (`log_methodology_change()` / `log_methodology_relationship_change()`), not a reuse of Milestone 2/3's organisation-scoped ones

**Decision:** Two new `SECURITY DEFINER` trigger functions, structurally
parallel to migration 0003/0005's `log_master_data_change()` /
`log_processing_activity_relationship_change()`, but reading `NEW.tenant_id`
/`OLD.tenant_id` directly instead of resolving a tenant via a join through
`organisations`.
**Rationale:** the existing functions' one non-generic line
(`SELECT tenant_id INTO v_tenant_id FROM organisations WHERE id = NEW.organisation_id`)
only exists because organisation-scoped tables don't carry `tenant_id`
themselves. Every Milestone 4 table already carries `tenant_id` directly
(R-40), making that join both unnecessary and wrong (there is no
`organisation_id` column to join on). Reusing the existing audit-log
*architecture* (the `audit_log` table, its schema, its RLS, its
`SECURITY DEFINER`/`auth.uid()` attribution pattern) satisfies the
milestone's "reuse the existing audit-log architecture" instruction; a
new function for a genuinely different row shape is the same pattern
migration 0005 already established (R-38), not a second mechanism.

### R-47 — Read/write RLS asymmetry for methodology tables: `can_access_tenant()` for SELECT, the narrower `is_active_tenant_member()` for INSERT/UPDATE/DELETE

**Decision:** Any user with a legitimate foothold anywhere in the tenant
(tenant, organisation, or engagement membership) can read the
methodology tables; only users with an actual `TenantMembership` can
write to them.
**Rationale:** methodology content is practice governance — it defines
what every client engagement under the tenant is assessed against, so
authoring or changing it is deliberately held to a narrower bar than
ordinary engagement work, while still letting engagement consultants
read the methodology their own engagement runs against (`can_access_tenant`
already grants that, per its own migration-0001 doc comment: "anyone with
ANY legitimate foothold" may read the Tenant-level object). This is a new
application of existing helper functions, not a new authorization
mechanism (Milestone 4 instructions: "reuse the existing authorization
framework"). No prior milestone needed this particular read/write split
because no prior milestone had Tenant-scoped *content* tables — Milestone
1's own use of `can_access_tenant` was for the `Tenant` row and `audit_log`
only (read visibility), and Milestone 1's `roles`/`permissions` tables are
seeded data with no RLS write policy for `authenticated` at all. Recorded
as a genuinely new decision, not an extension of a settled precedent.

### R-48 — `Engagement.control_library_version_id` is wired up now, additively, superseding R-23's deferral

**Decision:** `engagements.control_library_version_id` (nullable) is
added in this milestone's migration, with a composite FK to
`control_library_versions(id, tenant_id)`, plus a dedicated trigger
(`prevent_engagement_control_library_pin_change()`) enforcing (a) the
pinned version must be `published` or `retired`, never `draft`, and
(b) the pin is immutable once set.
**Rationale:** R-23 (Milestone 1) deferred this column specifically
because `ControlLibraryVersion` didn't exist yet; DATA_MODEL.md §12 states
directly "an Engagement pins to one `control_library_version_id` at
creation." Now that the table exists, adding the column is the natural
completion of R-23's deferral, not a new speculative feature — and it is
exactly what the milestone's historical-reproducibility scenario needs to
answer "which library version does a given engagement use" (one of the
required six questions). Immutability-once-set mirrors the same
historical-reproducibility principle applied to the Engagement side of
the relationship: an engagement's own record of what it was assessed
against must not be silently rewritable any more than the library content
itself is.

---

## Milestone 5 — Assessment Engine (Session 8, 2026-09-01)

### R-49 — `Assessment.control_library_version_id` is a new, denormalized column — not in DATA_MODEL.md §6's literal field list, added for the same reason every prior milestone denormalized a scope/consistency column

**Decision:** `assessments` carries `control_library_version_id` directly
(NOT NULL), even though DATA_MODEL.md §6's Assessment row lists only
`engagement_id, assessment_type, period_label, status,
previous_assessment_id`.
**Rationale:** Milestone 5 instructions §1/§3 require an Assessment to be
"permanently associated with... Control Library Version" and require the
database — not application validation — to prevent an Assessment from
referencing a ControlLibraryVersion inconsistent with its Engagement
(§3), and instructions §6 require the same discipline one level deeper
for AssessmentControl ("CRITICAL... enforce this with database
constraints"). Both are naturally expressed as composite FKs, which
requires the value to be a real column on the referencing row — the same
reasoning `organisation_id`/`tenant_id` denormalization has followed on
every table since Milestone 1 (they aren't in DATA_MODEL.md's literal
field lists either, for the same reason). This is additive clarification,
not an invented feature: an Engagement's `control_library_version_id` (a
named DATA_MODEL.md field) already fixes what any of its Assessments must
use; this column just makes that fixed value provable at the database
layer rather than only inferable by joining through Engagement.

### R-50 — CRITICAL invariant (Milestone 5 instructions §6) proven entirely by two composite FKs, no trigger

**Decision:** `assessment_controls(control_id, control_library_version_id)
→ controls(id, control_library_version_id)` combined with
`assessment_controls(assessment_id, tenant_id, organisation_id,
engagement_id, control_library_version_id) → assessments(id, tenant_id,
organisation_id, engagement_id, control_library_version_id)` together
make it structurally impossible for an AssessmentControl's `control_id`
to belong to a different ControlLibraryVersion than its own Assessment's
— both FKs constrain the *same* `control_library_version_id` column value
on the `assessment_controls` row, so a row satisfying both FKs
simultaneously proves `control.control_library_version_id =
assessment.control_library_version_id` by construction.
**Rationale:** instructions §6 explicitly demand this be "database
constraints, not only application validation," and explicitly name it
CRITICAL. A trigger (the approach migration 0007 used for
`ControlRequirement`'s draft-mutable gate, where no such FK pairing was
available because `Requirement` isn't library-version-scoped — R-43/R-44)
was considered and rejected here: this invariant is a pure "two foreign
keys share a column" shape, exactly what composite FKs already exist to
prove throughout this project (Milestone 2's version-tenant consistency,
Milestone 3's triple FKs, Milestone 4's `controls_control_library_
version_tenant_fk`) — a trigger would duplicate logic a constraint
already expresses declaratively, and constraints are checked by Postgres
itself, not by application-adjacent PL/pgSQL that could in principle be
bypassed by a future migration forgetting to reattach it. Verified
directly (not only through the Vitest suite) via a standalone `psql`
transaction — see PROGRESS.md.

### R-51 — Assessment status stays exactly DATA_MODEL.md's two states (`draft`/`finalized`) — the milestone brief's four-state suggestion is not implemented

**Decision:** `assessment_status` is `draft`/`finalized` only. "In
progress" and "under review" work is simply an Assessment that is still
`draft`; no sub-state is tracked.
**Rationale:** Milestone 5 instructions §4 open with "Use the
lifecycle/status defined in DATA_MODEL.md," then only conditionally offer
a four-state example ("If the approved model supports states such
as..."). DATA_MODEL.md §6 fixes exactly two: "status (DRAFT|FINALIZED)."
The approved model does not support four states, so implementing them
would be exactly the "invent complex workflow" instructions §4's own next
sentence warns against ("do not invent complex workflow unless
required... document [a consequential workflow rule] rather than
silently creating one"). This continues the project's established
posture (Milestone 3's `lifecycle_status`, Milestone 4's
draft/published/retired) of implementing precisely what DATA_MODEL.md
names, adding states only when the milestone brief's own instructions
unconditionally require more than DATA_MODEL.md gives.

### R-52 — `AssessmentControl` carries no fields of its own beyond the junction — "assessment-specific state" (instructions §5) is `AssessmentResponse`'s job, not a new column here

**Decision:** `assessment_controls` has exactly the FK/scope columns
needed to identify which Control is in scope for which Assessment, plus
`created_at`/`created_by`. No status, no notes, no other per-inclusion
field.
**Rationale:** DATA_MODEL.md §6 defines `AssessmentControl` as a plain
junction — "Assessment × Control," no field list — and separately defines
`AssessmentResponse` with `assessment_control_id` as the entity that
"carries the system-suggestion/decision pattern." Instructions §5's "an
AssessmentControl should capture the assessment-specific state" is
satisfied by that relationship: the state lives one hop away, in the
entity DATA_MODEL.md already built for exactly this purpose, not
duplicated onto the junction. Adding state columns directly to
`AssessmentControl` would also have made the CRITICAL library-version
consistency FK (R-50) less clean, since `AssessmentResponse` already has
its own composite FK chain back through `AssessmentControl`.

### R-53 — `AssessmentResponse` is a mutable row (like Milestone 4's `Control` while draft), not an insert/delete-only junction fact

**Decision:** `assessment_responses` supports ordinary `UPDATE` (while
its Assessment is `draft`) rather than following the junction-table
insert/delete-only convention (DECISIONS.md R-35) used by every other
Milestone 3/4/5 junction table, including `AssessmentControl` itself.
**Rationale:** DATA_MODEL.md §6 gives `AssessmentResponse` substantive,
evolving content (`effectiveness_rating`, `system_suggested_rating`,
`decision_rating`, `decision_rationale`, `respondent_id`, `submitted_at`)
— an assessor working through a control genuinely revises their own
answer before submitting, and a reviewer subsequently records a decision
on the *same* row rather than creating a new one (there is no "decision"
junction entity in DATA_MODEL.md — `decision_rating`/`decision_rationale`
are columns on `AssessmentResponse` itself). This is the same shape as
Milestone 4's `Control` (freely editable while its ControlLibraryVersion
is `draft`, frozen once published) applied to the Assessment axis instead
— editable while the Assessment is `draft`, frozen once `finalized`
(migration 0009 §3). A true junction fact (which control is in scope)
stays insert/delete-only (`AssessmentControl`); a substantive result
record does not.

### R-54 — "Not yet assessed" is the *absence* of an `AssessmentResponse` row, not a row holding `effectiveness_rating = 'not_assessed'`

**Decision:** `assessment_responses` has `UNIQUE(assessment_control_id)`
(at most one response per control in scope) and is never auto-created
when an `AssessmentControl` is inserted. Instructions §13's four
completeness buckets are computed as: *included* = an `AssessmentControl`
row exists; *not yet assessed* = an `AssessmentControl` row exists with
no matching `AssessmentResponse` row (`'not_assessed'` submitted
explicitly is a deliberate, auditable variant of the same bucket, not a
different one); *assessed* = a response exists with
`effectiveness_rating IN ('not_implemented','partially_implemented',
'implemented')`; *marked N/A* = a response exists with
`effectiveness_rating = 'not_applicable'`.
**Rationale:** instructions §13 explicitly warn against "a simplistic
percentage that calls N/A compliant" and ask to "keep completeness
calculations at the data level and document any interpretation" when
DATA_MODEL.md doesn't already specify them (it doesn't). No dedicated
completeness view/materialized table was built — instructions §19
prioritize the domain/database/security layer over reporting surfaces,
and a completeness *calculation* is squarely reporting-shaped; the SQL
pattern above is documented here and exercised implicitly by
`tests/assessment-engine`'s tests (an `AssessmentControl` with no
response vs. one with a `not_applicable` response are both tested as
distinguishable states) rather than built as a first-class object this
milestone didn't ask for.

### R-55 — `ControlTest` RLS/write-authorization is dual-mode, branching on `assessment_id IS NULL`

**Decision:** When `assessment_id` is set, `control_tests` uses
`can_access_engagement`/symmetric read-write, matching
`Assessment`/`AssessmentResponse`. When `assessment_id` is `NULL`
(DATA_MODEL.md §6: "a test can also occur outside a formal assessment
cycle, e.g. continuous monitoring"), it uses `can_access_tenant` for read
and the narrower `is_active_tenant_member` for write, matching Milestone
4's `Control` (R-47) — because a standalone test has no client-engagement
context at all, only a Tenant-owned Control.
**Rationale:** DATA_MODEL.md's own nullable `assessment_id` already
establishes that `ControlTest` is genuinely two-shaped, not a single
client-engagement object like the other three new tables (instructions
§14's "all assessment objects must respect Tenant → Organisation →
Engagement boundaries" is satisfied for the assessment-scoped shape; the
standalone shape has no Organisation/Engagement to bound by, by design).
A single, uniform policy would have had to either deny standalone tests
to everyone with only tenant-level access (breaking continuous
monitoring, which DATA_MODEL.md explicitly wants supported) or grant
engagement-shaped access to content that has no engagement — neither is
correct, so the branch is a genuine requirement of the data shape, not
invented complexity.

### R-56 — Migration 0009 reuses migration 0007's `log_methodology_change()` / `log_methodology_relationship_change()` unchanged — no new audit-trigger function was written this milestone

**Decision:** Every new assessment-engine table (`assessments`,
`assessment_controls`, `assessment_responses`, `control_tests`)
denormalizes `tenant_id` directly (R-49 and the composite-FK discipline
throughout), so migration 0007's Milestone-4 audit functions — which read
`NEW.tenant_id`/`OLD.tenant_id` directly, with no join — apply unchanged.
**Rationale:** direct confirmation that Milestone 4's audit-function
design (R-46, chosen specifically because those tables carry `tenant_id`
directly rather than `organisation_id`) generalizes to a second, later
milestone's tables with the same shape — the alternative (migration
0003/0005's `log_master_data_change()` variant, which resolves tenant via
an `organisations` join from `NEW.organisation_id`) would also have
worked here since these tables carry `organisation_id` too, but reusing
the more precise, join-free function is both more efficient and a closer
fit, and avoids introducing a third variant when a second one already
covers this exact row shape. Satisfies instructions §16's "reuse the
existing audit-log architecture" more specifically than writing new
functions would have.

---

## Milestone 6 — Evidence & Document Management (Session 9, 2026-09-01)

### R-57 — `Document` is split into `Document` (logical identity) + `DocumentVersion` (immutable per-upload record) — DATA_MODEL.md's existing `Document` field list becomes `DocumentVersion`'s

**Decision:** DATA_MODEL.md §4 defines a single `Document` entity —
"storage_path, filename, mime_type, size, uploaded_by" — with no separate
version concept. This milestone introduces `documents` (a new,
identity-shaped table carrying `tenant_id`/`organisation_id`/
`engagement_id`/`title`/`document_type`/`owner_user_id`/`status`, none of
which DATA_MODEL.md's current entry names) and `document_versions`
(carrying DATA_MODEL.md's original five fields verbatim, plus
`version_number`, `checksum_sha256`, `uploaded_at`, `scan_status`).
**Rationale:** read literally, DATA_MODEL.md's `Document` field list
describes exactly one uploaded file, not a re-uploadable logical
document — there was no prior milestone that needed the distinction, so
none was built. Milestone 6's own CORE PRINCIPLE requires it outright
("Document → Document Version... A new file upload must create a new
version, never overwrite an existing one") and instructions §2 give the
explicit escape valve for exactly this situation: "If the architecture
uses slightly different names or a different approved structure, follow
the current repository documentation rather than inventing a competing
model." This is that — DATA_MODEL.md's existing field list is preserved
verbatim, just relocated to the table that structurally matches what it
was always describing, not replaced with a different, invented shape.

### R-58 — `Evidence.document_id` is implemented as `documentVersionId`, referencing `document_versions`, not `documents`

**Decision:** Evidence pins to one specific, immutable `DocumentVersion`
— not "whichever version of this Document is current."
**Rationale:** direct consequence of R-57 plus instructions §5/§8's own
historical-immutability requirement: "the system must preserve FY2026 →
Version 1 while allowing FY2027 → Version 2... uploading Version 2 must
never overwrite Version 1" only holds if Evidence points at a specific
version, not the logical Document (which would silently resolve to
whatever is newest). DATA_MODEL.md's field name `document_id` is kept in
spirit (a required reference to "the document this evidence is") but
implemented against the table that now actually carries that immutable
identity, per R-57.

### R-59 — Evidence review lifecycle fields (`review_status`, `reviewed_by`, `reviewed_at`, `review_rationale`, `valid_until`, `description`) are additive — DATA_MODEL.md's current Evidence field list does not yet name them

**Decision:** `evidence` carries all six fields beyond DATA_MODEL.md
§4's exact list (`client_org_id`→`organisationId`, `engagement_id`,
`document_id`→`documentVersionId`, `title`, `evidence_type`,
`quality_rating`, `visibility`, `collected_at`).
**Rationale:** Milestone 6 instructions §5/§13 require an evidence review
workflow unconditionally ("It should be possible to capture... review
status, reviewer, review date... reviewer notes"; "the evidence layer
should record who reviewed it, when, what decision was made, and any
required rationale") — DATA_MODEL.md's field list simply predates this
requirement, the same underspecification pattern R-57 already resolved
for `Document`. `review_status` uses exactly instructions §13's four
named states (pending_review/accepted/rejected/expired), not an invented
workflow. `valid_until` is a single nullable expiry timestamp (§5's
"validity/expiry information where defined"), not a renewal mechanism.

### R-60 — `EvidenceLink` uses per-subject-type nullable FK columns + a CHECK constraint, not DATA_MODEL.md's literal `(subject_type, subject_id)` polymorphic pair

**Decision:** `evidence_links` has `assessment_response_id` and
`control_test_id` (each nullable, each a real, independently-FK'd
column), a `subject_type` enum recording which is populated, and a CHECK
constraint (`evidence_links_subject_matches_type_check`) enforcing
exactly one is set consistent with `subject_type`. No bare
`subject_id uuid` column exists.
**Rationale:** Postgres foreign keys target one specific table; a literal
`(text, uuid)` pair can never carry a real FK, so it could never prove
tenant/organisation/engagement consistency at the database layer.
Milestone 6 instructions §7 explicitly require exactly this trade-off:
"do NOT rely on the application layer alone to enforce the subject's
tenant/organisation/engagement boundary... do not create a completely
generic polymorphic relationship if the approved model provides a
safer/stronger approach... this is a security-critical area." This
milestone implements only the two subject types the brief itself asks
for (instructions §6: AssessmentResponse, ControlTest); DATA_MODEL.md
§4's other named subject types (Finding, RemediationAction, DPIA,
ApplicabilityDetermination, ProcessingActivity) don't have tables yet
(instructions §19) and would each add one more nullable column + one more
CHECK branch when they do — the same pattern, not a rewrite.

### R-61 — The CRITICAL EvidenceLink subject-consistency invariant is proven by composite FKs (2-3 per subject type), mirroring R-50's approach for AssessmentControl, not a trigger

**Decision:** For `assessment_response_id`: one 4-column FK
`(assessment_response_id, tenant_id, organisation_id, engagement_id) →
assessment_responses(...)`, always active because a CHECK constraint
(`evidence_links_assessment_response_requires_engagement_check`)
guarantees `engagement_id` is never null when this subject type is used
(AssessmentResponse is always engagement-scoped — Milestone 5). For
`control_test_id`: three FKs mirroring `ControlTest`'s own dual-shaped
scoping (tenant always active; organisation and engagement each active
whenever this link's own values are set).
**Rationale:** same reasoning as R-50 (Milestone 5) — this is a "two (or
three) foreign keys share a column" shape Postgres constraints already
express declaratively; a trigger would duplicate what a constraint
proves more simply and unconditionally. The three-FK split for
`control_test_id` (rather than one combined FK, which is what
`assessment_response_id` gets) exists because `ControlTest`'s own
`organisation_id`/`engagement_id` are nullable (the "continuous
monitoring" shape — DECISIONS.md R-55), so a single always-active
combined FK isn't available the way it is for the always-fully-scoped
`AssessmentResponse`. Verified directly via a standalone `psql`
transaction in addition to the Vitest suite — see PROGRESS.md.

### R-62 — Evidence can never be linked to a fully standalone (no-organisation) ControlTest — an accepted, documented consequence, not a gap

**Decision:** No corrective constraint was added to loosen this;
`evidence_links.organisation_id` is `NOT NULL` and `evidence_links_
control_test_organisation_fk` requires it to match `control_tests.
organisation_id` exactly, which a fully standalone ControlTest
(Milestone 5's Tenant-only "continuous monitoring" shape) never has.
**Rationale:** DATA_MODEL.md §4 states Evidence's `client_org_id` is
"always required" — Evidence is definitionally client-scoped, so it
cannot evidence a purely practice-level activity with no client context
at all. This was verified as an intentional consequence of R-61's FK
design (not stumbled into) and is exercised directly by a test
(`consistency.test.ts`). A `ControlTest` that has no `assessment_id` but
does carry a real `organisation_id`/`engagement_id` (client-side
continuous monitoring) remains linkable — only the fully standalone,
Tenant-only shape is excluded.

### R-63 — `EvidenceLink` insert/delete is locked once its subject's Assessment is finalized — a new trigger, extending Milestone 5's finalization guarantee one hop further than DATA_MODEL.md names explicitly

**Decision:** `enforce_evidence_link_draft_mutable()` (migration 0011
§5) blocks creating or removing an `EvidenceLink` whose subject
(`AssessmentResponse`, or a `ControlTest` with a non-null
`assessment_id`) belongs to a `finalized` Assessment. A `ControlTest`
with no `assessment_id` is never locked, matching Milestone 5's own
posture for it.
**Rationale:** Milestone 6 instructions §8 state "changing... must not
silently rewrite the historical evidence relationship" — the
*relationship* (which Evidence supports which finalized result) is what
must stay historically stable, not only the underlying file content
(R-57's `DocumentVersion` immutability) or the `AssessmentResponse` row
itself (Milestone 5's own lock). Without this trigger, someone could add
or remove what evidence a finalized assessment result is attributed to
after the fact — a real historical-integrity gap the milestone's own
scenario (§8) implies must not exist, even though DATA_MODEL.md doesn't
spell out `EvidenceLink`'s own lifecycle explicitly. This is the same
`enforce_X_draft_mutable` trigger pattern used throughout (Milestone
4/5), applied to a new table, not a new mechanism.

### R-64 — Evidence's CONSULTANT_INTERNAL/CLIENT_VISIBLE `visibility` column is stored but deliberately NOT an RLS condition

**Decision:** `evidence.visibility` exists and defaults to the more
restrictive `consultant_internal`; no RLS policy in this migration reads
it. Enforcement of "a client-side role can never see CONSULTANT_INTERNAL
evidence" remains at the application/permission layer.
**Rationale:** SECURITY.md §2 already states this explicitly and
predates this milestone: "RLS policies are a poor fit for... the
consultant-internal/client-visible split" — object-level visibility is
named there as a permission-layer concern, checked "on every read
regardless of the reader's role," distinct from RLS's job (the Tenant/
Organisation/Engagement boundary, which milestone instructions §16's own
10-item test list is entirely about — visibility enforcement is notably
absent from that list). Milestone 6 instructions §12 ask to "preserve the
existing visibility model," not build a second one; SECURITY.md never
describes a `client_org_id IS NULL` / `users.client_org_id` RLS check for
this purpose, and inventing one now — however feasible — would be
exactly the "second competing authorization mechanism" every milestone
since Milestone 1 has been told not to build. The column's presence
satisfies instructions §12's "the database should support the visibility
distinction... security must not depend merely on hiding a UI field" —
support, not enforce.

### R-65 — Storage architecture actually exercised this milestone: DB-layer object-key/hash metadata only, no real Supabase Storage integration, no signed-URL code

**Decision:** `document_versions.storage_path` is a plain object-key
string (e.g. `tenants/<id>/documents/<id>/<hash-prefix>`), never a public
URL; no file bytes are ever stored in Postgres or written to any
filesystem/bucket; no signed-URL-minting code, no Storage SDK calls, no
new API route exists anywhere in this milestone's changes. "Testing the
authorization model" (instructions §9) means proving that unauthorized
callers cannot even `SELECT` the row carrying a `storage_path` — the
gate that would sit in front of any future signed-URL-minting code —
which `tests/evidence/tenant-isolation.test.ts` exercises directly (RLS
blocks reading `document_versions` cross-tenant; the actual signed-URL
issuance step SECURITY.md §5 describes is UI/API-layer work this
milestone doesn't build, per instructions §20's "no polished UI").
**Rationale:** D-03 (data residency) remains unresolved (DECISIONS.md),
so no real Supabase Storage project exists to provision against —
instructions §9's own fallback ("implement the database/storage
abstraction and test the authorization model using a local/test-
compatible private storage mechanism... do not upload real client
documents") is followed exactly. No synthetic or real file content is
ever written to disk or any storage service in this milestone's tests —
"file content" is a short in-memory string, hashed with Node's `crypto`
module the same way a real upload pipeline would hash real bytes,
discarded after each test. See PROGRESS.md's explicit statement of what
was and was not tested (instructions §23).

## Milestone 7 — Risk, Findings & Remediation

### R-66 — Additive fields on Risk/Finding/RemediationAction/ValidationRecord not literally named in DATA_MODEL.md §8's own field lists

**Decision:** Several columns were added because the milestone's own
required scenario (§10) or a stated relationship (§1, §9) cannot be
built without them, even though DATA_MODEL.md §8's prose doesn't list
them field-by-field: `risks.assessment_response_id` (nullable — §1's
"Assessment Response → Risk" relationship needs a real FK, not prose);
`risks.previous_risk_id` (nullable, self-referential — needed to make a
Risk "historically reproducible" while still letting a later assessment
"recalculate" it, §4/§9, mirroring `document_versions.previous_version_
id`/`assessment_responses`' own precedent for a superseding-record
chain); `findings.owner_id` (§5 lists "owner" explicitly in prose, absent
from the literal field list); `remediation_actions.description`,
`remediation_actions.priority` (nullable), `remediation_actions.
completed_at` (nullable — §6/§10 require recording *when* a remediation
was completed, not only that its `status` reached `completed`);
`validation_records.rationale` (§8 names "rationale/notes" in prose).
**Rationale:** Milestone 7 instructions §2 say "use the exact approved
fields where already defined... if implementation reveals a genuine
schema ambiguity, document it in DECISIONS.md before making a
consequential choice" — this is that documentation. None of these
fields contradict an existing DATA_MODEL.md field; each is additive and
required either by an explicitly named relationship (§1) or by the
historical scenario itself (§10), the same posture as every additive
field recorded in prior milestones' own R-entries (e.g. R-51/R-55/R-60).

### R-67 — RiskScoringModel: Tenant-scoped, append-only, frozen-by-reference — mirrors ControlLibraryVersion's shape, not a new mechanism

**Decision:** `risk_scoring_models` is scoped to `tenant_id` only (never
`organisation_id`/`engagement_id` — it is practice methodology, like
`Control`/`ControlLibraryVersion`), carries `is_active`
(default true) rather than a draft/published/retired lifecycle, and is
closed out by a `BEFORE INSERT` trigger (`close_out_previous_active_
risk_scoring_model`) that flips the prior active row's `is_active` to
false for that tenant — no `UPDATE`/`DELETE` grant exists at all, so an
existing row's `matrix_definition` can never be edited or removed.
`risks.risk_scoring_model_id` is `NOT NULL` and frozen by the reparenting
guard, so a Risk's scoring model can never be silently swapped after
creation.
**Rationale:** Milestone 7 instructions §4 require the scoring
configuration to be "frozen/pinned for historical reproducibility (per
M4/M5 precedent)" and explicitly names the reproducibility test (§11).
`ControlLibraryVersion`'s draft/published/retired states exist because a
*library* has an authoring phase before it's usable; a scoring *model*
has no equivalent authoring workflow named anywhere in DATA_MODEL.md or
this milestone's instructions, so inventing one would violate
instructions §16 ("do not invent complex workflow if architecture
doesn't define one"). The simpler single-flag close-out — new version
in, old version's mutability window closes immediately, matching
`ProcessingActivityVersion`'s and `assessment_controls`' own append-only/
insert-only posture — achieves the identical guarantee (an existing
`RiskScoringModel` row's content never changes once superseded) with
less machinery. Read/write asymmetry (`can_access_tenant` SELECT /
`is_active_tenant_member` INSERT) is the same Tenant-content pattern
established for `Control`/`ControlLibraryVersion` in R-47 — reused
unchanged, not reinvented.

### R-68 — EvidenceLink extended to two more subject types via two more nullable FK columns, not a schema change to the pattern itself

**Decision:** `evidence_links` gained `remediation_action_id` and
`validation_record_id` (both nullable), each with its own conditionally-
active composite FK and NO-DUPE unique constraint, and the CHECK
constraint `subject_matches_type_check` was extended from 2 branches to
4. Both new subject types are always fully engagement-scoped (unlike
`ControlTest`'s dual shape), so both new FKs are always 4-column
(tenant+organisation+engagement+id), with no conditional-shape branching
needed.
**Rationale:** Milestone 6 established this exact per-subject-type-
nullable-column shape (R-60) specifically because a real foreign key can
only target one table; Milestone 7 instructions §7 explicitly require
"Remediation completed → Evidence submitted" and §8 requires evidence
linkage on `ValidationRecord` itself ("evidence linkage" is named in the
required field list) — both are new evidence-attachment points the same
mechanism already handles by construction. Extending the existing enum/
CHECK/FK triple is the minimal change; building a second, more generic
polymorphic mechanism for just these two new cases would be exactly the
"unrestricted polymorphic relationship" instructions §13 forbids where
explicit FKs remain practical, which they do here.

### R-69 — ValidationRecord's mutability was corrected mid-milestone: decision fields are permanently frozen, but the reassessment-trigger columns may be set exactly once, later

**Decision:** `validation_records` grants `SELECT, INSERT, UPDATE` (not
`SELECT, INSERT` only). A `BEFORE UPDATE` trigger,
`prevent_validation_record_tampering()`, unconditionally blocks any
change to `remediation_action_id`/`tenant_id`/`organisation_id`/
`engagement_id`/`validated_by`/`validated_at`/`outcome`/`rationale` —
the actual validation decision, which is corrected only by creating a
*new* ValidationRecord, never edited in place — but allows
`triggers_control_test_id`/`triggers_assessment_response_id` to
transition exactly once, from `NULL` to a non-null value.
**Rationale:** The first draft of this milestone modeled
`ValidationRecord` as fully immutable end-to-end (matching `audit_log`'s
own posture), reasoning that "an explicit event/record" (§8) should
never be updated at all. That directly contradicted the realistic
workflow the milestone's own required historical scenario describes
(§10): a consultant records the accept/reject decision *first*, and only
*later* performs and links the actual reassessment — the reassessment
target cannot be known at the moment the validation decision is made,
because the new ControlTest/AssessmentResponse it points to may not
exist yet. Discovered via `tests/risk-remediation/historical-scenario.
test.ts` actually failing against a fully-immutable design, not by
inspection. The fix mirrors Milestone 6's own precedent exactly:
`document_versions.scan_status` is frozen except one narrow pending→
terminal transition (R-59-adjacent); here, two columns are frozen except
one narrow NULL→value transition each. Every other field — the actual
decision being validated — remains permanently frozen, preserving §16's
finalized-record protection for the part of the record instructions §9
actually calls immutable ("never mutate historical finalized
AssessmentResponses"); the trigger columns are not that historical
record, they are a forward-pointing cross-reference to one.

### R-70 — Reassessment-trigger FKs on ValidationRecord are scoped to `organisation_id` only, deliberately not `engagement_id`

**Decision:** `validation_records_triggers_control_test_scope_fk` and
`validation_records_triggers_assessment_response_scope_fk` are 2-column
FKs (`(triggers_*_id, organisation_id)`), not 4-column
(`tenant_id`+`organisation_id`+`engagement_id`+id) FKs like every other
composite FK in this schema.
**Rationale:** Discovered as a genuine design bug via `historical-
scenario.test.ts` (§10) actually failing, not a test bug: the project's
own established pattern since Milestone 2 (the FY2026/FY2027 worked
example named explicitly in this milestone's own §10 scenario) is that
each annual assessment cycle is a *separate Engagement* of the same
Organisation. A `ValidationRecord` created in the FY2026 Engagement
(where the remediation was raised) routinely points to a reassessment
that happens in the *FY2027* Engagement — the two rows can never share
an `engagement_id` by the architecture's own design, so a 4-column
engagement-scoped FK would make the required scenario permanently
unsatisfiable, not merely awkward. Organisation-scoping still proves
tenant consistency transitively (an Organisation belongs to exactly one
Tenant), so cross-tenant reference remains impossible — the FK still
enforces everything instructions §12/§14 actually require ("cross-tenant
remediation relationships rejected... cross-organisation remediation
relationships rejected"), just not a same-engagement constraint nothing
in the architecture asks for. Required a new `assessment_responses_id_
organisation_id_key` unique constraint (`control_tests` already had the
equivalent 2-column unique from Milestone 6).

### R-71 — `RemediationAction.status = 'evidence_submitted'` is NOT enforced at the database layer to require a linked Evidence row to exist

**Decision:** No CHECK constraint, trigger, or FK requires an
`evidence_links` row referencing a `RemediationAction` before that
RemediationAction's `status` column can be set to `'evidence_submitted'`
(or any other status). The status column is a plain enum; any value can
be set at any time by an authorized writer, subject only to the ordinary
RLS/reparenting-guard rules every other mutable field on this table
follows.
**Rationale:** DATA_MODEL.md §8 itself frames the Remediation lifecycle
("Open → In Progress → Evidence Submitted → Validated → Closed") as an
application-layer state machine, not a database-enforced one — no
milestone instruction (§6/§7) asks for a trigger enforcing status-
transition preconditions, and inventing one now would be exactly the
"elaborate project management" instructions §6 explicitly warns against
building. The milestone's real, non-negotiable guarantee — §7's CRITICAL
SEMANTIC RULE that `status = completed` is never treated as proof of
control effectiveness — is preserved by construction: nothing in this
schema derives a Risk/Finding/AssessmentResponse change from
`remediation_actions.status` at all; that determination remains a
separate, explicit `ValidationRecord` created by a human, exactly as
required. Enforcing "evidence must exist first" at the DB layer would
add a workflow constraint the architecture never asked for without
strengthening that actual guarantee.

## Milestone 8 — Maturity

### R-72 — `MaturityAssessment` is an additive header/grouping entity — DATA_MODEL.md §9's own table names no such row

**Decision:** A new `maturity_assessments` table anchors one Maturity
computation "run" — one finalized source `Assessment`, one pinned
`MaturityScoringMethodology`, one finalization event — that its
`MaturityScore` rows (per-domain and the single overall row) hang off of
via a composite FK. Milestone 8 instructions §2 explicitly name
`MaturityAssessment` as one of the three approved entities to implement;
DATA_MODEL.md §9's literal table has no such row — `MaturityScore`
itself already carries `engagement_id`/`assessment_id`/`computed_at`
directly, and its own prose already describes "a computed, versioned
snapshot: per-domain scores AND an overall weighted score for a given
Assessment/period" as one coherent unit.
**Rationale:** Without a header row, "once a MaturityAssessment is
finalized... its score/domain results/methodology version/source
assessment context must not silently change" (instructions §12) would
require locking an *ungrouped set* of `MaturityScore` rows together —
fragile, and a break from this project's own composite-FK-first
philosophy (every other milestone gives a "this is one coherent,
lockable unit" concept its own row: `Assessment` for `AssessmentControl`/
`AssessmentResponse`, `ControlLibraryVersion` for `Control`). This is the
same posture as every other additive-but-necessary entity already on
record (`EvidenceLink`, R-60; `ValidationRecord`'s reassessment-trigger
columns, R-69) — implement what the architecture's own described
behavior structurally requires, document it, never silently invent an
unrelated scoring architecture (instructions §2's own warning).

### R-73 — `MaturityScoringMethodology`: the same append-only/Tenant-scoped/pinned-by-reference shape as `RiskScoringModel`, applied to Maturity — not a new mechanism

**Decision:** `maturity_scoring_methodologies` is Tenant-scoped, carries
`is_active` closed out by a `BEFORE INSERT` trigger identical in shape to
`risk_scoring_models`' own (Milestone 7, R-67), and stores a `definition`
jsonb column the Maturity computation reads (a rating-to-domain-score
map, plus level thresholds) rather than any hard-coded scoring constants
anywhere in application code. `maturity_assessments.maturity_scoring_
methodology_id` is `NOT NULL` and frozen by the reparenting guard.
**Rationale:** Milestone 8 instructions §6 (CRITICAL) forbid hard-coding
scoring values "unless DATA_MODEL.md or an existing approved decision
explicitly specifies those values," and instruct: "if the scoring
methodology is not yet finalized, implement the data structures required
to support a configurable scoring methodology and use synthetic test
configuration." DATA_MODEL.md §9 names no such table explicitly, but
instructions §9 anticipate exactly this: "if a configurable maturity
scoring model already exists in DATA_MODEL.md, use it. If not, implement
only the minimum versioning structure required to make historical
reproducibility possible." `RiskScoringModel` is the closest already-
approved precedent for precisely this shape (a versioned, pinned,
append-only scoring configuration) — reusing its mechanism rather than
inventing a new one satisfies both instructions §9 and this project's
standing rule against parallel authorization/versioning mechanisms
(reaffirmed every milestone since Milestone 4). This milestone's own
tests use a clearly synthetic `definition` (helpers.ts's default
`rating_scores`/`levels` shape) — never presented as PRIMUS's final
proprietary methodology, per instructions §16.

### R-74 — `MaturityDomain` deliberately carries no versioning/append-only lifecycle of its own — a plain, Tenant-scoped, mutable-except-tenant_id row

**Decision:** `maturity_domains` has ordinary mutable `name`/
`description`/`code`/`is_active` fields (only `tenant_id` is frozen by a
reparenting guard); it does not get `ControlLibraryVersion`'s draft/
published/retired lifecycle or `RiskScoringModel`'s append-only posture.
A domain's `name`/`description` remaining editable does not retroactively
rewrite any already-computed `MaturityScore`, because a score references
the domain by id only (DATA_MODEL.md §9's own `computed_from_control_
test_ids` field already establishes "frozen reference to a frozen row,"
not "frozen copy of the referenced row's content" — the same posture
applies here) — a **known, accepted limitation**, not an oversight: if a
domain is later renamed, a historical score's *displayed* domain label
(via a live JOIN) reflects the current name, not the name at computation
time. This is distinct from the score's actual numeric result, which
never changes.
**Rationale:** Milestone 8 instructions §4 explicitly warn against this
exact failure mode in the other direction: "do NOT invent a large
production domain framework if the architecture has not yet finalized
the actual domains." DATA_MODEL.md §9 names no lifecycle for
`MaturityDomain` at all (only for `MaturityScore`, which is the row
instructions §12's finalization guarantee actually protects). Inventing
a full versioned-domain-taxonomy mechanism here — to close the one
narrow display-label gap above — would be exactly the over-engineered
framework instructions §4 forbid, for a domain taxonomy this milestone
is explicitly told is still synthetic/test-only and will be redesigned
later as its own product/methodology exercise (instructions §16). The
gap is real, narrow, and recorded here rather than silently built
around.

### R-75 — `MaturityDomainWeight`'s append-only close-out is scoped per (engagement, domain), not per Tenant — DATA_MODEL.md §9's own literal instruction, applied precisely

**Decision:** `close_out_previous_active_maturity_domain_weight()`
scopes its "close out the previous active row" logic to `WHERE
engagement_id = NEW.engagement_id AND maturity_domain_id = NEW.
maturity_domain_id` — narrower than `RiskScoringModel`'s/
`MaturityScoringMethodology`'s own per-Tenant close-out, matching the
narrower scope DATA_MODEL.md §9 itself specifies for this table: "it is
engagement-scoped (one weight per engagement+domain)."
**Rationale:** `MaturityDomainWeight` is client engagement data (unlike
`MaturityDomain`/`MaturityScoringMethodology`, which are Tenant-owned
practice content) — DATA_MODEL.md §9's own sentence is explicit about
both the scope ("one weight per engagement+domain") and the immutability
rule ("never edited after the engagement's MaturityScore rows have been
computed from it... a re-weighting is a change for the *next* engagement/
period"). Scoping the close-out per (engagement, domain) rather than
globally per Tenant is not a design choice this milestone made freely —
it is DATA_MODEL.md's own literal specification, implemented with the
identical mechanism (BEFORE INSERT, SECURITY DEFINER, flip prior active
row false) already proven twice (Milestone 2's SCD2 tables, Milestone
7's `RiskScoringModel`).

### R-76 — `MaturityAssessment.status` reuses the exact `draft`/`finalized` vocabulary and two-trigger reparenting+finalization pattern `Assessment` established, as its own distinct enum type

**Decision:** `maturity_assessment_status` is a new Postgres enum with
the same two values as `assessment_status` (Milestone 5), not a reused
reference to that type. `maturity_assessments` gets two triggers, the
same split `Assessment` itself uses (Milestone 5, migration 0009):
`prevent_maturity_assessment_reparenting` (BEFORE UPDATE, always active,
freezes `engagement_id`/`organisation_id`/`tenant_id`/`assessment_id`/
`maturity_scoring_methodology_id`) and `enforce_maturity_assessment_
finalization` (BEFORE UPDATE, blocks every field once `status =
'finalized'` — "not even a no-op," `assessments_prevent_finalized_
tampering`'s own exact wording — and auto-stamps `finalized_at` on the
one legitimate `draft` → `finalized` transition, mirroring `control_
library_versions.published_at`, Milestone 4).
**Rationale:** Milestone 8 instructions §12: "if the current architecture
defines only a simple finalized state, implement that rather than
inventing a complex workflow." `Assessment`'s own two-state model is
exactly that already-approved "simple finalized state" — DATA_MODEL.md
names it for `Assessment` directly (§6) and this milestone's own
instructions frame Maturity as consuming `Assessment`'s output, so
reusing its exact vocabulary (not inventing a `computed`/`reviewed`/
`published`/`archived` scheme) keeps the two entities' lifecycles legible
together. A separate Postgres enum type (rather than literally sharing
`assessment_status`) keeps `MaturityAssessment.status` and `Assessment.
status` independently alterable in some later milestone without a
migration having to touch both tables at once — a low-cost, standard
practice already used for e.g. `regulatory_content_status` vs. `master_
data_status` (R-40, Milestone 4), not evidence of two different
concepts.

### R-77 — `MaturityScore` is required to insert only while its parent `MaturityAssessment` is still draft — an insert-gate trigger, the same shape `AssessmentControl`'s finalization guard uses

**Decision:** `enforce_maturity_score_draft_mutable()` (BEFORE INSERT)
resolves the parent `MaturityAssessment`'s `status` and rejects the
insert if already `'finalized'` — combined with `MaturityScore` carrying
no UPDATE/DELETE grant at all (full immutability from the moment of
creation, DATA_MODEL.md §9's own "never directly user-editable"), this
makes a `MaturityAssessment`'s entire set of scores permanently closed
the instant it is finalized, not merely each existing row individually
frozen.
**Rationale:** Without this gate, nothing would stop a stray extra
`MaturityScore` row from being inserted against an already-finalized
`MaturityAssessment` after the fact — a real historical-integrity gap
instructions §12's "once finalized... its score/domain results... must
not silently change" implies must not exist, the same reasoning Milestone
5's `enforce_assessment_control_draft_mutable` (migration 0009) already
established for a structurally identical situation (insert/delete-only
child rows whose mutability is gated by a parent's finalization state,
not by their own grants). Reused pattern, not a new mechanism.

### R-78 — The two "at most one score per (assessment, domain-or-overall)" rules needed two different constraint types — an ordinary UNIQUE plus a partial UNIQUE INDEX — because Postgres treats NULL as distinct from NULL

**Decision:** `maturity_scores_maturity_assessment_id_maturity_domain_id_key`
(an ordinary Drizzle `unique()`, declared in the generated schema
migration) enforces "at most one row per (MaturityAssessment, non-null
domain)." A second, hand-written `CREATE UNIQUE INDEX ... WHERE
maturity_domain_id IS NULL` (migration 0015) separately enforces "at most
one overall (domain-null) row per MaturityAssessment" — a plain UNIQUE
constraint cannot express this half at all, since Postgres's default
UNIQUE semantics treat every NULL as distinct from every other NULL,
so two overall rows would never collide on an ordinary constraint.
**Rationale:** DATA_MODEL.md §9's own field list makes `maturity_domain_
id` "nullable for the overall row" load-bearing, not incidental — a
`MaturityAssessment` with two "overall" rows would be exactly as broken
as one with two rows for the same domain, and instructions §13's "no
unrestricted... relationships where explicit constraints are practical"
extends naturally to uniqueness, not only foreign keys. The
partial-index half necessarily lives in the hand-written security
migration (0015), not the generated schema migration (0014) — Drizzle's
schema builder has no declarative partial-unique-constraint primitive,
the same reason every migration since 0001 keeps RLS/triggers/
cross-module rules in a hand-written follow-up file (R-02).

### R-79 — `computed_from_risk_ids`/`computed_from_validation_record_ids` are plain `uuid[]` traceability arrays, matching DATA_MODEL.md's own `computed_from_control_test_ids` shape exactly — deliberately NOT foreign-key-enforced, and NOT yet mathematically factored into any score

**Decision:** Two additive array columns on `maturity_assessments` record
which `Risk`/`ValidationRecord` rows were available and consulted at
computation time — proof a signal was consumed, never a copy of its
content, and never a second copy of the `Risk`/`ValidationRecord` tables
themselves. Postgres cannot attach a `FOREIGN KEY` to an individual
element of an array column, so — like DATA_MODEL.md's own literal
`computed_from_control_test_ids` field, which carries the identical
limitation — a nonexistent or wrong-tenant id can currently be stored in
either array without being rejected at the database layer; this is
demonstrated directly, not merely asserted, in `tests/maturity/
consistency.test.ts`. Separately: this milestone's own computed
`MaturityScore` values (§10's historical scenario included) are derived
*only* from finalized `AssessmentResponse.effectiveness_rating` via the
pinned methodology's `rating_scores` map — nothing in this schema, its
triggers, or its tests derives a numeric score contribution from a
Risk's rating or a ValidationRecord's outcome.
**Rationale:** Milestone 8 instructions §7 require Maturity to be
"capable of consuming signals from... Risk [residual risk]...
Remediation/Validation [validated remediation outcomes]... without
duplicating these objects into Maturity tables" — a plain id-array is
the minimal structure satisfying "capable of consuming" and "without
duplicating," and is the same shape DATA_MODEL.md's own field already
uses for `ControlTest`, so extending it to two more source types (rather
than inventing a junction-table mechanism, which would be its own
"unrelated scoring architecture," instructions §2) is the smaller,
already-precedented change. Instructions §10/§11 (CRITICAL) explicitly
forbid inventing the mathematical relationship between Risk/Validation
and a maturity score ("Risk and maturity may interact, but they are
conceptually different... if the architecture has not yet specified the
exact mathematical relationship, preserve the inputs and document the
open methodology decision") — this is that open decision, explicitly
preserved rather than silently resolved. A future milestone that defines
the real PRIMUS methodology may choose to formalize these into proper
junction tables with real FKs once the actual mathematical relationship
is approved; nothing here forecloses that.

### R-80 — `RemediationAction.status`/`ValidationRecord.outcome` still do not automatically alter any Maturity signal — reaffirmed, not re-litigated, this milestone

**Decision:** No trigger, FK, or generated column anywhere in this
migration reads `remediation_actions.status` or `validation_records.
outcome` to derive a `MaturityScore`, a `MaturityAssessment`, or any
other value. A `MaturityAssessment` is created, and its scores computed,
only by an explicit application/consultant action referencing a
finalized `Assessment` — never as a side effect of a remediation or
validation event.
**Rationale:** Milestone 7's R-71 already established that `Remediation
Action.status` transitions are an application-layer state machine with
no automatic downstream effects; Milestone 8 instructions §11 (CRITICAL)
restate the same rule specifically for Maturity ("do not award maturity
points merely because Remediation.status = validated... do not create
automatic maturity jumps unless explicitly specified"). Recorded here
explicitly, rather than left merely implicit in "no trigger exists for
this," because instructions §11 name it as a CRITICAL rule this
milestone's own historical scenario (§8) is required to demonstrate —
DECISIONS.md is where every such CRITICAL invariant this project has
built gets a citable record (R-71's own precedent).

## Milestone 8A — Historical Maturity Integrity Hardening

### R-81 — `MaturityScore` snapshots the referenced `MaturityDomain`'s `name`/`code`/`description` at computation time, rather than versioning `MaturityDomain` itself

**Decision:** Three new nullable columns on `maturity_scores`
(`domain_name_snapshot`, `domain_code_snapshot`, `domain_description_
snapshot`) are populated once, automatically, by a `BEFORE INSERT`
trigger (`snapshot_maturity_domain_definition()`, migration 0017) that
copies the referenced `MaturityDomain` row's current `name`/`code`/
`description` at the exact moment a `MaturityScore` is created —
unconditionally overwriting any value the application attempts to pass,
the same "trigger sets it, the application never sets it directly"
posture already used for `control_library_versions.published_at` and
`maturity_assessments.finalized_at`. `MaturityDomain` itself remains
exactly as designed in Milestone 8 (R-74) — ordinarily mutable, no
versioning/append-only lifecycle. A new CHECK (`maturity_scores_domain_
snapshot_presence_check`) requires the snapshot to be present if and
only if `maturity_domain_id` is set, enforced structurally by the
trigger, not merely trusted.
**Alternatives considered:**
- **(A) Version `MaturityDomain` itself**, giving it the same identity/
  version split `ControlLibraryVersion` uses (a stable domain identity
  row plus append-only version rows `MaturityScore` would pin to,
  analogous to `Control`/`control_library_version_id`). Rejected as
  disproportionate to the actual gap: R-74 already recorded, in Milestone
  8 itself, the deliberate decision NOT to version `MaturityDomain`
  ("inventing one would be exactly the 'large production domain
  framework' instructions §4 warn against") — that reasoning still holds
  under Milestone 8A's own explicit "prefer the smallest solution" and
  "do not redesign the maturity engine" instructions. Versioning the
  domain would also require migrating every existing consumer
  (`MaturityDomainWeight`, `MaturityDomainControlMapping`) to a two-table
  identity/version pattern, none of which actually need historical
  reproducibility themselves (`MaturityDomainWeight` is already
  append-only and pinned by id from `MaturityScore`; `MaturityDomain
  ControlMapping` only affects *future* computations, per its own
  existing file comment) — solving a problem only `MaturityScore`
  actually has by restructuring three tables instead of one.
- **(C) Reconstruct history from `audit_log` alone** (no new columns;
  read `maturity_domains`' `field_changes` history and resolve "what was
  this domain's definition at time T" via a replay query). Rejected: this
  pushes the actual enforcement to *application-layer replay logic*,
  directly against Milestone 8A instructions §5's "do not rely
  exclusively on TypeScript/application logic... use the simplest robust
  [database] mechanism" — a snapshot column the database itself populates
  and permanently freezes is strictly simpler and more directly
  database-enforced than a temporal-query reconstruction a caller could
  get wrong or skip.
**Rationale — why the smallest, least disruptive solution:** every other
question the required historical invariant asks (methodology/version,
weight, score, computed_at, source Assessment) was already answerable
from the existing Milestone 8 schema (R-72 through R-80) — only the
domain's own name/code/description were reachable solely via a live JOIN
to a mutable row. A trigger-populated snapshot on the one row that
actually needs point-in-time reproducibility (`MaturityScore`, already
fully immutable post-creation — no UPDATE/DELETE grant at all) closes
that exact gap with: one additive schema migration (three nullable
columns + one CHECK, no table restructuring), one additive trigger
migration (no change to any existing trigger, policy, or grant), zero
changes to `MaturityScoringMethodology` versioning, `MaturityDomain
Weight` versioning, `MaturityScore` immutability, or `MaturityAssessment`
finalization — every mechanism instructions §4 explicitly said to
preserve remains byte-for-byte unchanged. `MaturityDomainControlMapping`
needed no equivalent treatment: it only ever influences *future*
computations (already noted in its own file comment since Milestone 8),
and `MaturityScore.computed_from_control_test_ids` already independently
preserves exactly which `ControlTest` rows fed a historical score,
regardless of how the domain-to-control mapping changes later.

### R-82 — Historical rows created before this migration cannot recover their true point-in-time domain definition; the additive backfill uses the domain's current definition as the best available substitute

**Decision:** Migration 0017's backfill (`UPDATE maturity_scores ...
WHERE domain_name_snapshot IS NULL`) populates the snapshot for any
pre-existing, domain-scoped `MaturityScore` row using the referenced
`MaturityDomain`'s definition *as of the migration running*, not
necessarily the definition genuinely in effect at that row's own
original `computed_at`. It touches only the three new, previously-NULL
snapshot columns — no historical `score`, `maturity_level`,
`computed_at`, or any other field is altered.
**Rationale:** No environment this project has ever run in carries real,
persisted `MaturityScore` data — D-03 (data residency) remains
unresolved, no Supabase project has ever been provisioned, and
`scripts/reset-test-db.ts` always starts every test run from an empty
database — so this backfill is a documented no-op in every environment
this project has actually exercised, included for real-deployment
readiness per Milestone 8A instructions §8's "if backfill is necessary,
explain exactly how it works," not because backfill was actually needed
or exercised here. A more thorough reconstruction (replaying `audit_log.
field_changes` to resolve each historical row's domain definition as of
its own `computed_at`) is possible in principle but was not built: it is
meaningfully heavier engineering for a scenario with zero real rows to
apply it to today, and can be added later, by a future migration, without
disturbing anything this migration does — the additive columns and
trigger already in place would simply gain a more accurate one-time
backfill pass whenever real historical data actually exists to backfill.

## Slice A1 — Application Foundation (Authentication + Session Resolution + Authorization + Application Shell)

None of the three decisions below contradicts or overrides any approved
architecture document — each is a straightforward implementation choice
within the bounds ARCHITECTURE.md/SECURITY.md already set, recorded here
per this project's own established convention rather than escalated,
consistent with the great majority of the R-NN log to date.

### R-83 — The application authorization service independently re-implements the membership-lookup logic migration 0001's SQL functions already contain, rather than calling them

**Decision:** `lib/authorization/service.ts`'s `isActiveTenantMember` /
`isActiveOrganisationMember` / `isActiveEngagementMember` /
`canAccessOrganisation` / `canAccessEngagement` / `canAccessTenant` are
plain Drizzle queries against `tenant_memberships` /
`organisation_memberships` / `engagement_memberships` — the same tables
and the same active-membership/status logic as `is_active_tenant_member`
/ `is_active_organisation_member` / `is_active_engagement_member` /
`can_access_organisation` / `can_access_engagement` / `can_access_tenant`
(migration 0001) — but written independently in TypeScript, not by
calling those SQL functions from the application layer.
**Rationale:** SECURITY.md §2's own stated reason for having two
authorization layers is that they are independently implemented and
must independently agree: "if they ever disagree, that disagreement is
itself a bug to fix immediately, not a signal to relax either layer."
Having the application layer literally delegate to the same SQL
functions RLS itself calls would collapse two layers into one
(a single implementation, invoked twice) rather than the two
independently-reasoned checks SECURITY.md §2/R-07 actually describe.
The literal logic (active-status membership lookups, the same fallback
shape — org-wide-or-any-engagement-under-it for organisations,
engagement-or-org-wide for engagements) is deliberately identical
between the two implementations, because it is the same real business
rule; only the mechanism (TypeScript query vs. SQL function) differs.
One consequence, confirmed directly during Slice A1 implementation
(not merely assumed): `can_access_organisation`/`can_access_tenant`
(migration 0001) do **not** grant a pure `TenantMembership` holder
(e.g. Platform Administrator with no client-specific membership at all)
implicit read access to every client organisation's row — SECURITY.md
§3's own explicit rule ("Practice staff do not get implicit cross-client
access within their own tenant") — so `canAccessOrganisation` in
`lib/authorization/service.ts` deliberately does **not** fall back to
tenant-wide membership either, matching the real, already-approved RLS
behavior rather than a more permissive reading PRODUCT_UX_BLUEPRINT.md's
own screen-inventory prose might otherwise suggest. `canAccessTenant`
is implemented only as far as this slice actually needs it (tenant-wide
membership only, no "any accessible organisation under this tenant"
fallback) — no screen in Slice A1 needs the broader form (Methodology/
Administration are out of scope, instructions §19); it is a narrower,
honestly-incomplete mirror of `can_access_tenant`'s SQL definition, and
is documented as such in the code rather than either silently
implemented in full ahead of a need or silently left inconsistent with
its own docstring.

### R-84 — The authorization service checks membership existence only — no `Role`/`Permission`/`RolePermission` fine-grained action check is built in Slice A1

**Decision:** `requireEngagementAccess`/`requireOrganisationAccess`/
`requireTenantAccess` answer "does this user have ANY active membership
granting access to this scope," not "does this user's specific Role
grant the specific action being attempted." The one mutation this slice
performs (`AssessmentResponse` update) is gated by engagement access
plus the database's own finalization trigger (Milestone 5) — nothing
in this slice checks, for example, "does this user's Role include a
`assessment_response.write` permission."
**Rationale:** PRODUCT_UX_BLUEPRINT.md §22 (Backend/Domain Gaps) already
flagged the seeded `Permission` catalogue as "only 8 illustrative rows,
not the full fine-grained set" ARCHITECTURE.md/SECURITY.md's own prose
describes (`db/seed/roles.ts`'s own comment: "not an exhaustive
catalogue... enough to prove RolePermission works end to end") — there
is no real fine-grained permission data yet to check against. Building
a `Role`/`Permission`-based gate now would mean checking against
placeholder data, which is worse than not checking at all (a false
sense of granular control). PHASE A instructions §19 also explicitly
scope this slice to shell + navigation + the one vertical slice, not a
general-purpose action-permission framework. This is a genuine,
consciously-scoped limitation, not an oversight — recorded here and in
PROGRESS.md's "Known limitations," to be closed by whichever future
slice actually needs a role-specific write gate (e.g. "only a
Consultant, not a Client Contributor, may finalize an Assessment").

### R-85 — The application's own database connection cannot yet use a production-shaped, RLS-only-capable role — a continuation of D-03's already-recorded limitation, now load-bearing for real application code, not only test/tooling code

**Decision:** `lib/db/request-client.ts`'s connection pool reads
`DATABASE_URL` exactly as every migration/seed script has since
Milestone 1 — in every environment this project has actually run in,
that resolves to the local Postgres superuser, not a Supabase-
provisioned `authenticator` role (a `LOGIN` role restricted to `SET
ROLE anon/authenticated/service_role` and nothing else, which is what a
real deployed Supabase project would provide). Every function in that
module still unconditionally executes `SET LOCAL ROLE authenticated`/
`anon` (+ the `request.jwt.claim.sub` GUC) before running a single
domain query, so RLS is genuinely, independently re-checked on every
request this slice's application code issues — this does not weaken
enforcement for the actual code paths built.
**Rationale:** No Supabase project has ever been provisioned for this
repository — there is no `authenticator` role to connect as. This was
originally a Milestone-1-era limitation affecting migration/seed/test
tooling; Slice A1 is the first point real, user-facing application code
inherits the same limitation, so it is re-recorded here specifically
for that reason, not because the underlying fact has changed. The
connection's *ceiling* privilege (what the connecting role could
theoretically do if this module's own `SET LOCAL ROLE` discipline were
ever bypassed by a future code change) is broader than a production
`authenticator` role would allow — a real, tracked production-readiness
gap (PROGRESS.md), closed automatically once a real Supabase project is
provisioned and `DATABASE_URL` is repointed at its `authenticator`
connection string, requiring no code change to `lib/db/request-client.ts`
itself.

**Updated (Session 17, 2026-09-01):** D-03 (data residency) is now
RESOLVED — production will use Supabase in the AWS Mumbai region
(`ap-south-1`). This settles *where* the eventual production project
will live; it does not itself provision that project. This function's
own limitation is therefore still fully open exactly as described
above — it closes only once a real `ap-south-1` project actually exists
and `DATABASE_URL` is repointed at it, which remains separate, future
work (see D-03's own entry above for the full decision).

### R-86 — `organisations` never had an audit trigger; closed via a minimal, hand-written migration reusing the existing mechanism unchanged

**Decision:** Migration `0018_organisation_audit.sql` adds exactly one
`CREATE TRIGGER organisations_audit_log AFTER INSERT OR UPDATE ON
"organisations" ... EXECUTE FUNCTION public.log_methodology_change()` —
no new table, column, or function. `engagements` carries the identical
gap but is deliberately left untouched, since Slice B1 does not create
or update any `engagements` row (out of scope, PHASE B instructions
§18); it is left for whichever future slice builds engagement creation/
editing.
**Rationale:** Grepping every migration file (0000-0017) for a trigger
on `"organisations"` finds only `organisations_prevent_reparenting`
(migration 0001) — `organisations` has had no audit trigger since
Milestone 1, unnoticed until Slice B1's own instruction §10 ("organisation
creation must be auditable using the existing audit mechanism... do not
create a second audit system") required one to actually exist. Reusing
`log_methodology_change()` (introduced migration 0007, unchanged since,
already proven on `regulatory_references`/`requirements`/
`control_library_versions`/`controls`) needed no new mechanism —
`organisations` already has the `tenant_id`/`id` columns that function
requires. `AFTER INSERT OR UPDATE` (not INSERT-only) matches the
established convention for every other ordinarily-mutable entity, so no
further migration is needed once a future slice adds organisation
editing (deferred here, R-88 below). Hand-written migrations are never
added to `drizzle/migrations/meta/_journal.json` (confirmed by
inspection — only drizzle-kit-generated migrations are tracked there),
so 0018 needed no journal/snapshot entry, matching the project's
existing hand-written-migration convention (DECISIONS.md R-02).

### R-87 — Organisation creation succeeds without `.returning()`; the id is generated application-side, because Postgres RLS re-checks a `RETURNING` row against the table's own SELECT policy, not only the INSERT policy's `WITH CHECK`

**Decision:** `createOrganisation` (`lib/domain/organisations.ts`)
generates the new organisation's `id` with `randomUUID()` and inserts
it explicitly, with no `.returning()` clause on the `INSERT`.
**Rationale:** Discovered directly during Slice B1 implementation, not
assumed: an `INSERT ... RETURNING id` run as a fully-authorized tenant
member (satisfying `organisations_insert`'s `WITH CHECK
(is_active_tenant_member(tenant_id))` — confirmed independently true)
still fails with "new row violates row-level security policy for table
\"organisations\"" — because Postgres additionally requires a
`RETURNING` row to satisfy the table's own `SELECT` row-security
policy, and `organisations_select` (`can_access_organisation`) requires
organisation- or engagement-level membership, which nobody has yet on a
row that was just created. The identical `INSERT` without `RETURNING`
succeeds (confirmed directly). Generating the id in application code
sidesteps the read-back entirely — no RLS change, no service-role use,
and no weakening of either policy was needed to fix this; it was purely
a matter of not asking Postgres to read back a row through a stricter
lens than the write itself required.

### R-88 — Organisation creation does not grant the creator any membership on the organisation it creates; a bare TenantMembership can create an organisation but cannot immediately view its detail page — a real, documented consequence of the already-approved authorization model, not a bug introduced by Slice B1, and not fixed by weakening or bypassing it

**Decision:** `createOrganisation` does not insert any
`organisation_memberships` row for the creator. Immediately after
creation, the creator's own session cannot read the new organisation
back via `getOrganisationDetail`/`listAccessibleOrganisations` — both
correctly, consistently throw/omit it, exactly as they would for any
other organisation the caller has no organisation- or engagement-level
membership on. The Organisation detail page
(`app/(shell)/organisations/[organisationId]/page.tsx`) handles this
honestly: a request carrying the create action's own `?created=1&name=`
redirect parameters (set only by `createOrganisationAction` on its own
successful redirect, and never treated as authoritative — the page does
not use them to grant, infer, or reveal any actual row access) renders
a plain confirmation panel explaining the organisation was created and
is not yet visible, instead of the ordinary not-found page; any other
request — including one to the very same URL without those parameters,
or for a genuinely nonexistent id — still gets the identical "not
found" response SECURITY.md §13 requires. No RLS policy, no
`canAccessOrganisation`/`can_access_organisation`, and no GRANT was
touched to make this work.
**Rationale:** `organisations_select`'s `can_access_organisation`
(migration 0001, re-confirmed by direct SQL inspection during this
slice) requires organisation-wide or engagement-level membership —
by design, matching SECURITY.md §3's "no implicit cross-client access"
and already relied on and tested in Slice A1 (R-83). A bare
TenantMembership — the correct, narrowest existing authorization for
*creating* an organisation (`is_active_tenant_member`, matching
`organisations_insert`'s own `WITH CHECK`, see `requireTenantMembership`)
— was never intended by that same model to also grant *viewing* one.
The only way to make an immediate detail-page view work would be to
either (a) grant the creator an `organisation_memberships` row at
creation time — but `organisation_memberships` carries no `INSERT`
policy for the `authenticated` role at all (confirmed by direct
inspection of `pg_policy`), so this is not achievable without a new RLS
policy (a migration, requiring its own instructions-§17 stop-and-report,
and itself a form of membership-management functionality PHASE B
instructions §18 explicitly excludes from Slice B1); or (b) read the row
back via a service-role/RLS-bypassing connection — explicitly forbidden
by instructions §15 without first stopping and reporting. Neither is
Slice B1's to do; both are natural fits for whichever future slice
builds engagement creation (which already legitimately grants the
practice member real, principled access to a client organisation by
opening an engagement under it) or organisation membership management.
Recorded here, in the code, and in PROGRESS.md's "Known limitations"
rather than silently working around it. A related, narrower consequence
of the same fact: `createOrganisation`'s own soft duplicate-name check
(also RLS-scoped, by the same instructions-§15 constraint) can only
ever see organisations the calling user already has read access to —
it cannot detect a name collision with an organisation the caller
cannot see, including, structurally, any organisation the caller has
*just* created and not yet been granted access to. This is tested
directly (`tests/app/organisations.test.ts`) rather than left as an
untested assumption.

**Superseded (Slice B2, Session 15):** option (a) above — a new
`organisation_memberships` INSERT policy — is exactly what Slice B2's
own brief asked for and migration 0019 adds. `createOrganisation` now
grants the creator that membership in the same transaction; see R-89
below. This entry is left as-is (not rewritten) as the historical record
of the original finding and the reasoning that ruled out a quick fix at
the time; `tests/app/organisations.test.ts`'s corresponding test was
updated in Slice B2 to assert the new, correct behavior.

### R-89 — `organisation_memberships`/`engagement_memberships` never had an INSERT policy or GRANT for `authenticated`; closed via one narrow migration adding both, mirroring the existing organisation/engagement creation rules exactly

**Decision:** Migration `0019_organisation_engagement_membership_
onboarding.sql` adds: (1) four small `SECURITY DEFINER` resolver
functions (`organisation_tenant_id`, `engagement_tenant_id`,
`engagement_organisation_id`, `user_tenant_id`) that each return a
single UUID, needed because `organisation_memberships`/`engagement_
memberships` don't carry `tenant_id` directly and an ordinary subquery
against `organisations`/`engagements`/`users` would itself be blocked
by those tables' own SELECT policies for a row created moments earlier
in the same transaction (the same RLS/RETURNING interaction R-87
found, generalized); (2) `organisation_memberships_insert`, `WITH CHECK
(is_active_tenant_member(organisation_tenant_id(organisation_id)) AND
user_tenant_id(user_id) = organisation_tenant_id(organisation_id))` —
the exact rule `organisations_insert` already uses for creating the
organisation itself, plus a same-tenant guard on the *target* user;
(3) `engagement_memberships_insert`, the same shape mirroring
`engagements_insert`'s own tenant-or-organisation-member rule; (4) the
matching `GRANT INSERT` for `authenticated` on both tables (previously
`SELECT`-only, confirmed by direct inspection of migration 0001 and of
`information_schema.role_table_grants`); (5) an `engagements_audit_log`
trigger reusing `log_methodology_change()` unchanged (the same
Milestone-1-era gap R-86 found for `organisations`, generalized to
`engagements` — Slice B2 is the first slice to write `engagements` rows
via application code); and (6) a new `log_membership_change()` function
(the same audit shape as `log_methodology_change()`, adapted to resolve
`tenant_id` via the resolver functions above since neither membership
table has the column directly) plus its own two audit triggers.
Deliberately does NOT touch `tenant_memberships` (no INSERT policy
added — nothing in Slice B2 creates one) and does NOT add UPDATE/DELETE
policies on either membership table (Slice B2 only grants membership,
never edits or revokes it — instructions §23 explicitly forbid a
"role-management console").
**Rationale:** Confirmed by direct inspection (`pg_policy`,
`information_schema.role_table_grants`) before writing any code: as of
migration 0001, a membership row on either table could only ever be
created by a superuser/migration/seed script — never by ordinary
authenticated application traffic. This is the structural cause of
R-88's finding, not merely a symptom of it. PHASE B2 instructions §2F
explicitly anticipate exactly this: "If a schema/policy change is
genuinely required, document exactly why before making it" — this is
that documentation. The migration is deliberately the narrowest
possible fix: it grants no capability beyond "the same set of people
who may already create an Organisation/Engagement may also grant
membership on what they created, to users within the same tenant" —
mechanically identical to the existing `organisations_insert`/
`engagements_insert` rules, not a new, more permissive authorization
concept. Verified directly against real PostgreSQL, independent of any
application code, before writing `lib/domain/organisations.ts`'s or
`lib/domain/engagements.ts`'s callers (see PROGRESS.md's testing
section) — including the specific cross-tenant attacks instructions §5
names ("Organisation A → membership for a User from Tenant B,"
"Tenant A → Organisation B membership").

### R-90 — The organisation-scope onboarding role remains `Client Administrator` (R-88's finding); the engagement-scope onboarding role is `Engagement Manager` — a materially better fit, not a comparable interpretive stretch

**Decision:** `lib/domain/organisations.ts`'s `createOrganisation`
grants the creator's auto-membership using role `Client Administrator`
(scope `organisation`) — the same choice already reasoned about, though
not yet acted on, when R-88 was written. `lib/domain/engagements.ts`'s
`createEngagement` grants the creator's auto-membership using role
`Engagement Manager` (scope `engagement`).
**Rationale:** PHASE B2 instructions §6: "If multiple existing roles
are possible, choose the narrowest role appropriate to an organisation
administrator/consultant workflow. Document the choice... only if it
represents a consequential interpretation." The two choices are not
equally consequential. Every seeded `organisation`-scope role (`Client
Administrator`, `Privacy Officer`, `CXO / Executive Viewer` —
`db/seed/roles.ts`) is described as client-side; there is still no
seeded PRIMUS-practice-facing organisation-scope role at all, so
`Client Administrator` is chosen because its description — "Manages the
client organisation's own users and access on the platform" — is
functionally exactly what this grant is for (administering who has
access to this organisation), even though the person holding it here is
a PRIMUS consultant during onboarding, not (yet) a real client-side
user. This remains a genuine, consequential interpretation, unresolved
by this slice — closing it properly means either adding a real
PRIMUS-facing organisation-scope role to the seed catalogue or deciding
`organisation`-scope grants to practice staff should not happen at all
(and access should instead always flow through `EngagementMembership`),
neither of which this slice's "no new role hierarchy" / "no new DB
roles" constraint permits deciding unilaterally. By contrast,
`Engagement Manager` ("Owns delivery of one or more engagements:
scoping, staffing, timeline, client relationship, final report
sign-off") is an unambiguous, well-fitting match for "the person who
just opened this engagement" — recorded here for completeness, not
because it required a judgment call.

### R-91 — Deferred: adding an existing user other than the creator to an OrganisationMembership, and discovering an organisation a different tenant colleague created

**Decision:** Slice B2 builds only the creator's own auto-grant (R-89/
R-90) — no UI or Server Action lets one user grant `OrganisationMembership`
to a *different* existing user, even though migration 0019's own RLS
policy already permits it (any active tenant member may grant
membership on any organisation under their tenant, to any same-tenant
user — not restricted to self-grants). `lib/domain/organisations.ts`
exposes no `grantOrganisationMembership`-style function taking an
arbitrary target user; only `createOrganisation`'s own internal,
self-targeted grant exists.
**Rationale:** PHASE B2 instructions §4's "If another user's membership
is required, allow selection only from existing users..." is a
conditional, not a mandate — and instructions §23 explicitly forbid "a
role-management console." The literal target workflow (§3) only
requires the *creator's* own access to work end-to-end; the RLS policy
is intentionally already broad enough for a future slice to add this
UI on top with zero further schema/policy work, but building that UI
now risks exactly the scope creep §23 warns against. A direct,
un-worked-around consequence of deferring this: a Tenant A consultant
who did **not** create a given organisation, and holds no
`EngagementMembership` under it either, still has no way to discover or
reach that organisation at all (it appears in neither their
Organisations list nor any URL they'd know) — the RLS-visibility
constraint R-88 first identified is closed only for the creator, not
for colleagues. This is a real, user-facing limitation, deliberately
left open rather than solved with a broader "browse my tenant's
organisations" read capability, which would itself require weakening
`organisations_select`/`canAccessOrganisation` (forbidden — instructions
§17) or adding a parallel, less-restrictive read path (a materially
larger, more consequential decision than this slice's own narrow
scope). Recorded here and in PROGRESS.md's "Known limitations" /
"Deferred membership decisions" rather than silently built around;
naturally closed by whichever future slice builds real organisation
membership administration.

### R-92 — Transactional safety for the two-insert onboarding operations (Organisation + OrganisationMembership; Engagement + EngagementMembership) is provided entirely by `withRequestDb`'s existing BEGIN/COMMIT/ROLLBACK wrapper — no new transaction API was added

**Decision:** `createOrganisation` and `createEngagement` each perform
two `INSERT`s (the entity, then its creator's membership row)
sequentially, inside the same JavaScript function, with no `try/catch`
between them and no explicit `db.transaction(...)` call.
**Rationale:** `lib/db/request-client.ts`'s `withRequestDb` already
wraps its entire callback in one real Postgres transaction — `BEGIN`
before the callback runs, `COMMIT` only if it returns without throwing,
`ROLLBACK` on any thrown error, regardless of which statement inside
the callback threw (established in Slice A1, unchanged since). A
thrown error from either `INSERT` — a duplicate name, an RLS
violation, a unique-constraint violation, a missing role — therefore
already rolls back the *whole* operation, including whichever earlier
statement in the same call already succeeded. PHASE B2 instructions
§10/§11 ask for "an appropriate database transaction... do not fake
transactionality in application code" — this uses a real one, already
built and already relied upon, rather than introducing a second,
parallel transaction mechanism for no added correctness. Verified
directly: `tests/app/engagement-onboarding.test.ts`'s "No orphaned
onboarding records" test confirms a rejected `createEngagement` call
(invalid methodology, caught *before* either `INSERT` runs) leaves no
row behind; the "Engagement creation success" test confirms a
successful call leaves *both* rows present together, never just one.
Engineering a THIRD-statement-style failure specifically between the
two `INSERT`s (to prove the second one rolling back the first, not
merely "nothing was attempted at all") was judged not worth the risk of
mutating shared, cross-test-file seed data (e.g. temporarily renaming a
global `roles` row) purely to manufacture a failure point — the
guarantee itself follows directly from `withRequestDb`'s already-tested
mechanics, not from anything new this slice adds.

### R-93 — Slice C1 does not build a "Finalize Assessment" action; the workspace only correctly respects an assessment that is already finalized

**Decision:** No Server Action, domain function, or UI control in Slice
C1 transitions `assessments.status` from `draft` to `finalized`. The
workspace correctly *renders* a finalized assessment as fully read-only
(no editable form for the response, rationale, or a new ControlTest is
rendered at all — matching the server's own unconditional rejection,
not merely a disabled button), and every write path
(`updateAssessmentResponse`, `createControlTest`) correctly rejects a
write against an already-finalized assessment. Finalization itself, for
this slice, only ever happens via direct database action (a fixture, or
a future slice) outside the application.
**Rationale:** PHASE C's own brief never lists a "Finalize" route,
Server Action, or button anywhere in its routing/UI-states sections —
§16 ("Finalization") only describes the two *states* the workspace must
correctly handle (draft/finalized), not a transition control between
them. PRODUCT_UX_BLUEPRINT.md §7's own Assessment Workspace entry is
more explicit about why: "finalization is a narrower, named permission
(Engagement Manager, per PRODUCT_SPEC.md §2) — the UI must gate the
'Finalize' action separately from the 'Save response' action." Slice
A1/B1's own DECISIONS.md R-84 already established, and this slice
continues, that no fine-grained Role/Permission action check is built
on top of plain membership checks — the seeded `Permission` catalogue
remains "only 8 illustrative rows" (PRODUCT_UX_BLUEPRINT.md §22), with
nothing resembling a real "may finalize" permission to check.
Implementing a "Finalize" action now would mean either building it
against placeholder permission data (a false sense of granular control,
the exact concern R-84 already raised) or silently falling back to
plain engagement-membership-any-role, which is a real, consequential
weakening relative to what PRODUCT_UX_BLUEPRINT.md's own design
intends. Deferred, not silently decided: a future slice adding real
finalization needs a genuine "who may finalize" authorization answer
first, which is a decision this slice's own scope does not ask for.
