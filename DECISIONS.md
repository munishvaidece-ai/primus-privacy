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

### R-94 — Evidence file limits, allow-list, signed-URL lifetime, and object-key convention (Slice C2)

**Decision:** `lib/storage/evidence-storage.ts` fixes four concrete,
product-level values: a 25MB maximum file size; a closed MIME
allow-list covering PDF, PNG, JPEG, DOC/DOCX, XLS/XLSX, and plain text
(each mapped to its own required extension, so a mismatched
extension/MIME pair is rejected even for an otherwise-allowed type); a
300-second (5-minute) signed-URL lifetime; and the object-key path
`tenants/{tenantId}/organisations/{organisationId}/documents/{documentId}/{documentVersionId}`
— identifiers only, never a filename, person's name, email, or
free-form client name.
**Rationale:** PHASE C2 instructions §6/§9/§10/§17 each explicitly ask
for these to be documented as consequential choices, not silently
picked. 25MB is a deliberate MVP ceiling (instructions §9: "reasonable
MVP max size, not enterprise-scale") sized for real compliance
documents — policy PDFs, signed agreements, configuration exports,
screenshots — without inviting unbounded uploads;
`next.config.mjs`'s `experimental.serverActions.bodySizeLimit` was
raised from Next.js's 1MB default to `26mb` specifically to
accommodate it. The MIME allow-list is the realistic, closed set of
document types this product actually handles, not a general-purpose
file host, and is never trusted from the browser alone — extension
must independently match. 300 seconds follows SECURITY.md §5's own
already-approved requirement ("The only way to read a file is a
short-lived signed URL") — long enough for a browser to actually
fetch the file once issued, short enough that a leaked URL (browser
history, a proxy log) is not a durable access grant; never persisted
to PostgreSQL (instructions §17), only ever held in memory for the
single response returning it. The object-key convention refines
Milestone 6's own illustrative example (DECISIONS.md R-65:
`tenants/<id>/documents/<id>/<hash-prefix>`), which used a truncated
content hash as the leaf segment — replaced here with the
`documentVersionId` itself (deterministic and collision-proof by
construction, since it's already the version row's own primary key,
with no dependency on file content) and `organisationId` inserted into
the path so a real production Storage policy can scope access by
organisation-level path prefix, mirroring the same Tenant →
Organisation nesting every RLS policy in this project already
enforces at the database layer.

### R-95 — Storage-adapter selection (real vs. local) mirrors D-03/R-85's precedent; `supabase/storage-policies.sql` is written but not applied or independently verified

**Decision:** `getEvidenceStorageAdapter()` selects
`SupabaseEvidenceStorageAdapter` (using the existing, session-bound
`createSupabaseServerClient()` — never a service-role client, never a
second Supabase SDK instantiation) when
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are real
values, and `LocalEvidenceStorageAdapter` (real file I/O against a
git-ignored `.local-storage/evidence/` directory, real SHA-256
checksums, a deliberately fake `local-evidence-storage://` "signed
URL" scheme) otherwise. `supabase/storage-policies.sql` — the private
`evidence` bucket definition and its RLS-style Storage policies,
scoping object access by the `organisationId` path segment via the
existing `public.can_access_organisation()` function — is written and
committed, but is **not applied to any real Supabase project** and has
**not been verified against real Supabase Storage**.
**Rationale:** Mirrors `lib/db/request-client.ts`'s already-established
"real once configured, local/test until then" shape for the database
connection (D-03/R-85), applied here to Storage now that D-03 itself
picked a region but before any production project is provisioned.
Instructions §34 explicitly forbid provisioning a production Supabase
project or creating a real bucket without explicit approval, and §25
requires clearly distinguishing database tests, storage integration
tests, and production Supabase validation rather than substituting a
false claim — this environment's own network egress to `supabase.co`
remains blocked (confirmed in Slice A1), so no real Supabase Storage
call of any kind has been exercised this slice. `supabase/
storage-policies.sql` is deliberately narrow (per instructions §20:
"no broad 'authenticated can read everything'"), but its correctness
against a real bucket is unverified — recorded here, and in
PROGRESS.md's "Known limitations," as an honest gap rather than an
implicit claim of readiness.

### Evidence review is not blocked by assessment finalization; only EvidenceLink insert/delete is locked (Slice C2)

`reviewEvidence` (accept/reject a piece of Evidence) is deliberately
**not** given an application-level check against its subject's
Assessment finalization status, and no such check exists anywhere in
this slice's code. Direct inspection of migration 0011 confirms this
matches the database's own existing behavior exactly:
`evidence_links_enforce_draft_mutable` only fires on `evidence_links`
INSERT/DELETE (blocking new links to, or removal of links from, a
finalized subject), and neither `evidence`'s own
`prevent_evidence_reparenting` trigger nor any other trigger touches
`review_status`/`reviewed_by`/`reviewed_at`/`review_rationale`. A
reviewer may therefore still accept or reject Evidence already linked
to a finalized Assessment's response — reviewing evidence quality is a
distinct activity from mutating which subject an Evidence record is
attached to, and the schema this slice must respect (instructions §15:
"never bypass via Storage APIs," not "invent a new lock the database
doesn't have") was built with that same distinction already in place.
No DECISIONS.md change to the trigger itself was made or considered —
this entry only records the deliberate absence of an *additional,
invented* application-level lock beyond what the schema already
enforces.

### Compensating cleanup after a genuine mid-transaction database failure is not independently exercised by an automated test (Slice C2)

`uploadEvidence`'s and `addDocumentVersion`'s `catch` blocks (storage
object removal after a Storage upload succeeds but a subsequent
database write fails) are exercised for two of their three real
components — the removal primitive itself is directly tested
(`tests/app/evidence-storage.test.ts`: upload, then `remove`, then
confirm the object is genuinely gone), and the one path proven never
to reach a Storage write at all is tested end-to-end
(`tests/app/evidence.test.ts`'s finalized-assessment-upload-rejected
case, which fails at authorization/link-resolution before
`storage.upload()` is ever called) — but the full "successful Storage
upload → a genuine mid-transaction Postgres failure on one of the
subsequent inserts → confirmed compensating cleanup" integration is
not exercised together, end-to-end, by any automated test. This
mirrors R-92's identical, already-documented conclusion for Slice B2's
two-insert onboarding operations: engineering a safe, deterministic
mid-transaction database failure without corrupting shared,
cross-test-file fixture data was judged impractical for the same
reasons R-92 gives, not attempted, and recorded here rather than
silently left untested.

### R-96 — No Risk-scoring calculator was built; `inherentRating`/`residualRating` are recorded exactly as the consultant enters them (Slice C3)

**Decision:** `createRisk` (`lib/domain/risks.ts`) takes `likelihood`,
`impact`, `inherentRating`, and (optionally, all-or-nothing)
`residualLikelihood`/`residualImpact`/`residualRating` directly as
consultant input and stores them unchanged. Nothing in this slice reads
`risk_scoring_models.matrix_definition` to compute a rating from
likelihood × impact; the pinned model's name/version/matrix are
displayed on the Risk detail page as reference context only.
**Rationale:** `risk_scoring_models.ts`'s own comment states this was
deliberate through every milestone that has touched Risk scoring so
far: "this milestone stores and pins the configuration; it does not
implement an automatic scoring calculator" — and
PRODUCT_UX_BLUEPRINT.md §21 independently confirms no scoring engine
exists as of this session, listing only the Maturity computation
engine as an outstanding gap (Risk scoring is not listed as one).
Direct inspection of every `matrix_definition` value ever created in
this codebase (`tests/risk-remediation/helpers.ts`'s own default,
`{ scale: "1-5", grid: "likelihood x impact" }`, and every test
fixture's own ad hoc shape, including a bare `{}`) confirms no
consistent, structured JSON convention has ever actually been
established for this column — building a lookup function over it now
would mean inventing BOTH a scoring algorithm AND a JSON-shape
convention neither DATA_MODEL.md nor any prior milestone defines,
exactly what PHASE C3 instructions §5 forbid ("do not invent a new
scoring algorithm... do not put scoring logic in React components").
The Risk detail page's own UI copy states this limitation plainly
rather than implying a calculation happened.

### R-97 — Risk creation requires the tenant's own currently-active RiskScoringModel; none exists yet for any tenant, and this slice builds no RiskScoringModel-authoring UI (Slice C3)

**Decision:** `createRisk` always resolves `risk_scoring_model_id`
server-side to whichever `risk_scoring_models` row currently has
`is_active = true` for the caller's own tenant (migration 0013's
close-out trigger guarantees at most one). If none exists,
`NoActiveRiskScoringModelError` is thrown and no Risk is created — the
form does not silently fall back to a default matrix or an arbitrary
row. No screen anywhere in this application creates a
`RiskScoringModel`; that remains fixture/direct-database-only.
**Rationale:** `risk_scoring_models` is Practice-owned methodology
content (Tenant-scoped, like `ControlLibraryVersion`) — and this
application has never built authoring UI for its own direct analogue,
`ControlLibraryVersion` (`lib/domain/engagements.ts`'s
`listSelectableControlLibraryVersions` only ever *selects among*
already-published versions; nothing creates one from the UI). No seed
script populates a `RiskScoringModel` row for any tenant either.
Building a RiskScoringModel-creation screen was not asked for by this
slice's own brief (§3-§20 name only Risk creation/list/detail/
workspace-integration) and would be scope creep into a separate
"methodology administration" area; the honest alternative — silently
inventing a default matrix, or accepting a caller-supplied model id
(forbidden outright by instructions §15) — was rejected. This is a
real, product-facing limitation (a fresh tenant cannot create any Risk
until a `RiskScoringModel` exists) recorded here and in PROGRESS.md's
"Known limitations," not silently worked around.

### R-98 — Risk creation/editing is NOT blocked by Assessment finalization (Slice C3)

**Decision:** `createRisk`, `updateRiskStatus`, and the `risk_controls`
link they create carry no finalization check of any kind — a Risk can
be created from, and its status changed regardless of, an
already-finalized Assessment's control/response.
**Rationale:** PHASE C3 instructions §24 required determining this from
the existing model rather than inventing a rule, and, if genuinely
ambiguous, stopping to report it. It is not ambiguous: direct
inspection of migration 0013 (the only place Risk-related triggers are
defined) confirms no trigger on `risks`/`risk_controls` references
Assessment or its `status` at all — unlike `assessment_responses`/
`control_tests`/`evidence_links`, which migrations 0009/0011 each give
an explicit finalization-lock trigger. This absence is consistent with
DATA_MODEL.md §8's own framing and this project's own brief, which
both describe Risk as the *next* stage after an Assessment concludes
("Assessment → AssessmentResponse/ControlTest/Evidence → Risk → later
Finding...") — the common, expected case is a consultant identifying a
risk precisely because a (frequently already-finalized) assessment
found a control ineffective, not before. Blocking Risk creation on
finalization would make the entire downstream Risk/Finding/
Remediation/Validation chain this project's own roadmap describes
unusable against any completed assessment, contradicting the chain's
own purpose. Verified directly: `tests/app/risks.test.ts` creates a
Risk from `assessmentAFinalized` and confirms no trigger event fires;
a dedicated test also directly queries
`information_schema.triggers` for `risks`/`risk_controls` and asserts
none mention finalization.

### R-99 — Risk owner assignment is self-only; no user-directory/picker was built, and a real, undocumented-until-now database gap was found and recorded (Slice C3)

**Decision:** `createRisk`'s only owner-assignment mechanism is a
boolean `assignOwnerToSelf` — when true, `owner_id` is set to the
calling user's own id; there is no form field or code path anywhere in
this application that accepts an arbitrary target user. Separately,
direct inspection of `risks`' own foreign keys found that
`risks.owner_id` references `users(id)` only, with no composite FK
tying the owner's `tenant_id` to the Risk's own — meaning a raw SQL
`INSERT`/`UPDATE` naming any real user as owner, including one from a
different tenant, is NOT independently rejected by RLS or any FK; only
the application's own self-only design prevents it in practice.
**Rationale:** PHASE C3 instructions §13 require displaying and
server-side validating the owner while explicitly forbidding building
"a user-directory or invitation system" — self-assignment-only is the
narrowest mechanism that satisfies "ensure it belongs to an authorized
tenant/organisation context" and "do not permit cross-tenant user
assignment" by construction (the only assignable value is the caller's
own, already-authorized id), mirroring DECISIONS.md R-91's identical
precedent (Slice B2 deferring an arbitrary-user membership-grant UI for
the same reason). The database-level gap this uncovered is reported
here rather than silently patched: instructions §32 forbid changing the
Risk schema (or, by the same reasoning, `users`) merely to make this
easier, and a composite `(id, tenant_id)` unique constraint on `users`
plus a matching composite FK on `risks.owner_id` would itself be a
schema change outside this slice's approved scope — closing it is left
to a future, explicitly-scoped decision, not invented here. Directly
proven by `tests/app/risks.test.ts`'s dedicated "[DOCUMENTED GAP]"
test, which shows the raw cross-tenant-owner INSERT succeeding rather
than merely asserting it should fail.

### R-100 — "Rationale" is not an approved Risk field and was correctly omitted from the creation form, despite being named in the brief's own illustrative list (Slice C3)

**Decision:** The Risk creation form and `CreateRiskInput` type have no
"rationale" field. Only `title`, `description`, `likelihood`, `impact`,
`inherentRating`, the optional residual triad, and self-assignable
`ownerId` are accepted — every one of them a real column on `risks`
(`risks.ts`, DATA_MODEL.md §8).
**Rationale:** PHASE C3 instructions §7 list "rationale" among the
potential form inputs to consider, but its own final sentence overrides
that illustrative list: "only implement fields actually supported by
the approved model." Direct inspection of `db/schema/risks.ts` and
DATA_MODEL.md §8 confirms `risks` has no `rationale`/`decision_
rationale`-shaped column at all (unlike `assessment_responses.decision_
rationale`, which genuinely exists) — adding one would be exactly the
kind of casual, UI-convenience schema change instructions §32
prohibits without an explicit stop-and-report. No such column was
added; this entry records the discrepancy instructions §7 itself
anticipated rather than silently inventing the field.

### R-101 — `risks.owner_id` is now database-enforced tenant-scoped via a composite FK to `users(id, tenant_id)` — closes the gap R-99 found (Slice C3.1)

**Decision:** Migration 0020 adds `UNIQUE (id, tenant_id)` on `users`
(`users_id_tenant_id_key`) and replaces `risks`' plain `owner_id →
users(id)` foreign key with a composite `risks_owner_id_tenant_fk
(owner_id, tenant_id) → users(id, tenant_id)`. A raw INSERT or UPDATE
naming a real user from a *different* tenant than the Risk's own is now
independently rejected by Postgres itself — not only by
`lib/domain/risks.ts`'s own self-assignment-only application logic
(unchanged; still the only owner-assignment mechanism this application
exposes).
**Rationale:** Slice C3.1 instructions §2/§3 require the smallest
schema change that makes the existing owner semantics database-safe,
using `users.tenant_id` (or an equivalent already-existing tenant-scoped
key) — explicitly forbidding a new user table, a new role system, a new
membership model, or service-role privileges. `users.tenant_id` is the
correct key: it is NOT NULL (every user has exactly one home tenant,
DATA_MODEL.md §2) and is the exact fact `lib/domain/risks.ts`'s own
existing self-assignment design already relies on implicitly
(`requireEngagementAccess` only ever succeeds for a user whose own
membership chain resolves to the Risk's tenant, so `owner_id =
callingUserId` was always same-tenant in practice — this migration
makes that a database-enforced *guarantee* rather than an
application-only convention). The composite-FK-plus-supporting-unique-
constraint shape is not a new mechanism: it is the exact pattern
`risks_risk_scoring_model_tenant_fk`/`risk_scoring_models_id_tenant_id_
key` (migrations 0012/0013) already established for Practice-owned
content referenced from client-engagement data, applied here to `users`
instead. The old single-column FK was dropped rather than kept
alongside the new composite one, mirroring `risk_scoring_model_id`'s
own precedent (never given a redundant plain FK either) — keeping both
would suggest two independent constraints where only one, strictly
stronger one exists. No membership-table key (`tenant_memberships`,
etc.) was used instead: a membership row is revocable/optional/
many-per-user, and this question — "which tenant does this user
actually belong to" — is the single, always-present fact `users.
tenant_id` already states directly, not a question about current active
grants. No RLS policy, GRANT, or audit trigger was touched — the fix is
an independent, additional database-level constraint on top of the
existing two-layer authorization model (SECURITY.md §2), the same
"RLS is not weakened, a narrower backstop is added on top" posture used
everywhere else in this project. Directly verified that the existing
`risks_audit_log` trigger already captures every successful `owner_id`
value (insert or update) via its generic `to_jsonb(NEW)` field_changes
— confirmed live against real audit_log rows this session, not merely
inferred — so no new or second audit mechanism was needed (instructions
§7).

### R-102 — `findings.owner_id` is also now database-enforced tenant-scoped, discovered and closed proactively during Slice C4 (mirrors R-101)

**Decision:** Migration 0021 replaces `findings`' plain `owner_id →
users(id)` foreign key with a composite `findings_owner_id_tenant_fk
(owner_id, tenant_id) → users(id, tenant_id)`, reusing the
`users_id_tenant_id_key` unique constraint migration 0020 already
added — no second unique constraint was needed.
**Rationale:** PHASE C4 instructions §10 explicitly direct: "If Finding
has an owner: ... use the tenant-safe ownership mechanism established in
C3.1 ... do not allow cross-tenant ownership." Direct inspection of
`findings.owner_id` (migration 0012) found it in the exact same
unprotected shape `risks.owner_id` was in before Slice C3.1 — a plain
single-column FK with no tenant consistency check. Since C4 needed to
touch `findings.owner_id` anyway (Finding gets a genuine post-creation
owner edit, unlike Risk's status-only edit — see R-103), applying the
already-established, already-approved C3.1 fix here was the direct,
literal instruction, not a new decision requiring separate deliberation
— the "smallest possible additive migration" (C3.1's own instruction
language, still the right standard here) was one `DROP CONSTRAINT`/
`ADD CONSTRAINT` pair, since the supporting `UNIQUE (id, tenant_id)` on
`users` already exists. `remediation_actions.owner_id` has the
identical unprotected shape and was deliberately left untouched — it
belongs to a future Remediation slice, explicitly out of C4's scope
(instructions' own "DO NOT build Remediation"); recorded in PROGRESS.md
as a known limitation for whichever slice builds Remediation to
address using this same, now twice-established pattern.

### R-103 — Finding creation/editing is NOT blocked by Assessment finalization; Finding severity is never automatically copied from its source Risk; "rationale" is again correctly omitted (Slice C4)

**Decision:** Three Risk-slice precedents were re-applied to Finding,
each re-verified against Finding's own actual schema rather than
assumed to carry over automatically:
1. **Finalization:** `createFinding`/`updateFinding` carry no Assessment-
   finalization check. Direct inspection of migrations 0012/0013
   confirms no trigger on `findings`/`finding_risks` references
   Assessment or its `status` at all — the identical absence R-98
   already found for `risks`/`risk_controls`. `tests/app/findings.test.ts`
   directly queries `information_schema.triggers` to confirm this, the
   same verification method R-98/the C3.1 hardening pass established as
   this project's standard for proving a finalization rule (or its
   absence) rather than assuming a migration file was read completely.
2. **Severity:** `findings.severity` is an independently-stored column
   with no FK, trigger, or generated-column relationship to
   `risks.inherent_rating`/`risks.residual_rating` — direct inspection
   of `db/schema/findings.ts` and migrations 0012/0013 confirms nothing
   copies it. `createFinding` never reads the source Risk's own rating
   at all; only the Finding creation form's own `<select>` defaults to
   the source Risk's `inherent_rating` as a UI convenience (instructions
   §9's own "do not automatically copy... If it is independently
   stored, respect that" — the form default is not a copy in the
   domain-layer sense, since the consultant's own submitted value, not
   the Risk's, is what `createFinding` ever persists).
3. **"Rationale":** `db/schema/findings.ts`/DATA_MODEL.md §8 name no
   `rationale`-shaped column on `findings`, mirroring R-100's identical
   finding for `risks` — omitted from the Finding creation/edit forms
   for the same reason, not silently invented despite instructions
   §20's own illustrative list naming it as a possible example field.
**Rationale:** PHASE C4 instructions §13 require using the existing
model rather than inventing a finalization rule, and stopping only if
genuinely ambiguous; §9 require using authoritative domain logic if
severity is derived, or respecting independent storage if not; §20's
own final constraint ("DO NOT add fields unless the schema/product
specification supports them") governs over its own illustrative list,
exactly as it did for Risk in Slice C3 (R-100). None of these three
questions was ambiguous once the actual schema was inspected directly
— each resolves the same way its Slice C3 analogue did, for the same,
directly-verifiable reasons, so no STOP was warranted for any of them.

### R-104 — `remediation_actions.owner_id` is also now database-enforced tenant-scoped — the third and, for this project's current schema, final instance of the R-101/R-102 pattern (Slice C5)

**Decision:** Migration 0022 replaces `remediation_actions`' plain
`owner_id → users(id)` foreign key with a composite
`remediation_actions_owner_id_tenant_fk (owner_id, tenant_id) →
users(id, tenant_id)`, reusing the `users_id_tenant_id_key` unique
constraint migration 0020 already added — no third unique constraint
needed.
**Rationale:** Slice C4's own final report explicitly flagged this
exact column as carrying the identical unprotected shape
`risks.owner_id` had before Slice C3.1, deferred at the time as out of
Slice C4's own scope; Slice C5 instructions §3/§9/§18 explicitly
commission closing it now, using the same, by-now twice-established
mechanism, rather than leaving the direct inspection to discover it
fresh. Verified directly per instructions §18's own checklist before
and after applying: existing NULL-owner rows are unaffected (a
multi-column FK with a NULL member is skipped entirely under Postgres's
MATCH SIMPLE default); existing same-tenant-owner rows remain valid (no
row this application ever creates could violate the new constraint,
since `createRemediationAction`/`updateRemediationAction` only ever set
`owner_id` to the acting user's own id, already proven same-tenant by
`requireEngagementAccess`); INSERT and UPDATE are each independently
confirmed to reject a cross-tenant owner (`tests/app/remediation.test.ts`
tests 10/10b), plus one standalone raw-`psql` demonstration outside the
test suite, exactly as instructions §35 require. No RLS policy, GRANT,
or audit trigger was touched. This closes the pattern's only two
existing owner-shaped `users(id)` references (`risks.owner_id`,
`findings.owner_id`, `remediation_actions.owner_id`) — no fourth
instance remains anywhere in the current schema.

### R-105 — Remediation creation/editing is NOT blocked by Assessment finalization; priority is never automatically copied from Finding/Risk; status has no enforced transition order; "rationale" is again correctly omitted (Slice C5)

**Decision:** Four Risk/Finding-slice precedents were re-applied to
RemediationAction, each re-verified against its own actual schema
rather than assumed to carry over automatically:
1. **Finalization:** `createRemediationAction`/`updateRemediationAction`
   carry no Assessment-finalization check. Direct inspection of
   migrations 0012/0013 confirms no trigger on `remediation_actions`/
   `remediation_findings` references Assessment or its `status` at all
   — the identical absence R-98/R-103 already found for `risks`/
   `findings`. `tests/app/remediation.test.ts` directly queries
   `information_schema.triggers` to confirm this.
2. **Priority:** `remediation_actions.priority` is an independently-
   stored, nullable column with no FK, trigger, or generated-column
   relationship to `findings.severity`/`risks.inherent_rating` — direct
   inspection of `db/schema/remediation-actions.ts` and migrations
   0012/0013 confirms nothing copies it. `createRemediationAction`
   never reads the source Finding's/Risk's own severity/rating at all.
3. **Status transitions:** `updateRemediationAction` accepts any of the
   five existing `remediation_action_status` values with no enforced
   order — DECISIONS.md R-71 (Milestone 7) already established that
   `status = 'evidence_submitted'` is not database-enforced to require
   linked Evidence, i.e. the whole field is deliberately
   application-layer-optional, not a database state machine; inventing
   transition rules the repository itself doesn't define would
   contradict that already-approved posture (instructions §24's own
   "do not invent workflow rules... if the existing status is simply
   mutable, preserve that").
4. **"Rationale":** `db/schema/remediation-actions.ts`/DATA_MODEL.md §8
   name no `rationale`-shaped column on `remediation_actions`,
   mirroring R-100/R-103's identical finding for `risks`/`findings` —
   omitted from the creation/edit forms for the same reason.
**Rationale:** PHASE C5 instructions §20 require using the existing
model rather than inventing a finalization rule, stopping only if
genuinely ambiguous; §8 require using authoritative domain logic if
priority is derived, or respecting independent storage if not; §24
require using only transitions the repository already defines; §11/§20
(via §7 in Slice C3/C4's own precedent) govern which fields the
creation/edit forms may add. None of these four questions was
ambiguous once the actual schema was inspected directly — each
resolves the same way its Slice C3/C4 analogue did, for the same,
directly-verifiable reasons, so no STOP was warranted for any of them.

### R-106 — Evidence/EvidenceLink extended to support `remediation_action` as a link target — an already-approved database subject type, application-layer support simply hadn't been built yet (Slice C5)

**Decision:** `lib/domain/evidence.ts`'s `LinkTarget` union,
`resolveLinkSubject`, and the two `evidenceLinks` insert call sites
(`uploadEvidence`/`createEvidenceForVersion`) were extended with a
third case, `remediation_action`, alongside the existing
`assessment_response`/`control_test` cases from Slice C2. A new,
narrow read function, `getEvidenceSummaryForRemediationAction`, mirrors
`getEvidenceSummaryForControl`'s exact shape, scoped to
`evidence_links.remediation_action_id` instead.
**Rationale:** Unlike Risk/Finding (which have no direct Evidence
relationship in the approved schema at all — R-96/R-103's identical
finding), `evidence_links` has carried a genuine, fully-built
`remediation_action` subject type (column, CHECK-constraint branch,
composite scope FK) since Milestone 7 (migration 0012/0013) — DATA_
MODEL.md §8's own explicit sentence: "Evidence attaches to
RemediationAction and ValidationRecord via the same generic
EvidenceLink used everywhere else." Slice C2's own application-layer
`uploadEvidence`/`resolveLinkSubject` only ever implemented the
`assessment_response`/`control_test` cases its own brief scoped to,
leaving `remediation_action`/`validation_record` "structurally
unreachable" at the application layer (Slice C2's own code comment) —
not because the database lacked support, but because no prior slice's
brief asked for the application code to reach it. PHASE C5 instructions
§22 explicitly direct: "If Remediation has Evidence relationships in
the existing model: use the existing Evidence/EvidenceLink
architecture. Do not create another attachment system." Extending the
existing `LinkTarget` union and its one resolver function is that
literal instruction, not a new mechanism — the same per-subject-type-
nullable-column pattern this whole file already uses for the other two
cases, one more branch. `validation_record` remains unextended
(Validation is explicitly out of scope through Slice C5, instructions
§23) — only the `remediation_action` branch was added. Assessment
finalization is structurally not applicable to a `remediation_action`
subject (RemediationAction has no Assessment relationship at all), so
`ResolvedLinkSubject.assessmentStatus` was widened to `string | null`,
with `null` meaning "not applicable, never blocked" for this one
subject type — not a weakening of the existing finalization check for
`assessment_response`/`control_test`, which are unchanged.

### R-107 — `validation_records.validated_by` given the same tenant-scoping fix as `risks.owner_id`/`findings.owner_id`/`remediation_actions.owner_id` — a fourth instance, not a third-and-final one (Slice C6)

**Decision:** Migration `0023_validation_record_validator_tenant_scoping.sql`
drops `validation_records`' plain `validated_by → users(id)` FK and
replaces it with a composite `validation_records_validated_by_tenant_fk
(validated_by, tenant_id) → users(id, tenant_id)`, reusing the same
`users_id_tenant_id_key` unique constraint migration 0020 already
added — no new supporting constraint needed.
`db/schema/validation-records.ts` was updated to match (plain
`.references()` removed, a `validatorTenantFk` composite `foreignKey`
added to the table's extra-config block).
**Correction to the record:** Slice C5's own PROGRESS.md entry
describes `remediation_actions.owner_id`'s fix as "the third and, for
this project's current schema, final instance of this pattern." That
claim was made in good faith at the time but was incomplete — direct
inspection of `validation_records.validated_by` during Slice C6 found
it in the exact same unprotected shape. This is a fourth instance, not
a third-and-final one. Per this project's own "do not rewrite
historical decisions" posture, the C5 entry itself is left as written;
this note is the honest forward correction instead.
**Rationale:** Slice C6 instructions §23 explicitly direct: "If
ValidationRecord contains a validator/owner user id: verify
tenant-safe ownership... use the established (user_id, tenant_id) →
users(id, tenant_id) pattern where appropriate." `validated_by`
qualifies exactly. Safety argument (identical to R-101/R-102/R-104):
the column is nullable, so the new composite FK's NULL-member skip
(Postgres MATCH SIMPLE default) leaves every existing NULL-validator
row untouched; `lib/domain/validation.ts`'s own `createValidationRecord`
only ever sets `validatedBy` to the acting user (never a caller-
supplied target — see R-109), and `requireEngagementAccess` already
proved that user's tenant matches the RemediationAction's (and
therefore the ValidationRecord's) tenant before the write, so no row
this application creates can violate the new constraint and no
backfill is required. `validated_by` is additionally protected by the
pre-existing `validation_records_prevent_tampering` trigger (migration
0013), which independently rejects any UPDATE to `validated_by`
regardless of tenant — the new FK is a second, independent guarantee,
not a replacement. Both `tests/app/validation.test.ts` (application
layer) and a standalone raw-SQL demonstration (instructions §36, not
part of the vitest suite) confirmed a genuine cross-tenant `validated_by`
INSERT is rejected with this exact constraint name, and that a
cross-tenant UPDATE attempt is independently rejected by the tampering
trigger.

### R-108 — Creating a ValidationRecord never mutates `remediation_actions.status` — no invented status transition (Slice C6)

**Decision:** `createValidationRecord` (`lib/domain/validation.ts`)
writes only to `validation_records` and never touches
`remediation_actions.status`. Reflecting a validation outcome in the
RemediationAction's own status (e.g. moving it to `validated`/`closed`)
remains a separate, explicit action the consultant takes via the
existing (Slice C5) `updateRemediationAction`.
**Rationale:** Slice C6 instructions §11 (marked CRITICAL) forbid
auto-implementing a Validation→status transition "unless the
architecture explicitly requires it." Direct inspection of migration
0013 — grepping every trigger declared for `event_object_table =
'remediation_actions'` — found none referencing `validation_records`
at all; the only two triggers on `remediation_actions` are its own
audit-log trigger and (mirroring R-104) nothing else. This is the
definitive, database-level evidence that no such transition is part of
the approved architecture: inventing one in the application layer
would contradict the schema, not merely go beyond it.
`tests/app/validation.test.ts`'s test #29 asserts this directly (a
RemediationAction's `status` is read before and after
`createValidationRecord`, confirmed unchanged) and independently
queries `information_schema.triggers` to confirm no trigger name on
`remediation_actions` matches `/validat/i`.

### R-109 — Rejecting a ValidationRecord requires a rationale, reusing the Evidence-review precedent (Slice C2/C6)

**Decision:** `createValidationRecord` throws
`ValidationRationaleRequiredError` when `outcome = 'rejected'` and no
non-blank `rationale` was supplied — enforced server-side, not merely
as a form `required` attribute.
**Rationale:** This is not an invented workflow rule — it reuses the
identical precedent `reviewEvidence`/`ReviewRationaleRequiredError`
(Slice C2) already established in this exact codebase for the
structurally identical "reviewer rejects, must say why" decision.
Instructions §13 name "rationale" as an expected ValidationRecord
field; requiring it specifically on rejection (not on acceptance)
matches both the Evidence-review precedent and ordinary audit-trail
practice — an acceptance needs no justification beyond the decision
itself, a rejection does. `validatedBy` is always the acting user
(instructions §8's "preserve self-validation-only") — the same
self-only pattern `respondentId`/`testerId`/`ownerUserId` already use
throughout this codebase (verified by grep before writing this
module); `createValidationRecord`'s own input type has no
caller-assignable validator field at all.

### R-110 — Evidence/EvidenceLink extended to support `validation_record` as a link target — the fourth and final subject type (Slice C6)

**Decision:** `lib/domain/evidence.ts`'s `LinkTarget` union,
`resolveLinkSubject`, and the two `evidenceLinks` insert call sites
were extended with a fourth case, `validation_record`, alongside the
existing `assessment_response`/`control_test`/`remediation_action`
cases (Slices C2/C5). New read functions
`getEvidenceSummaryForValidationRecord` and its batched variant
`getEvidenceSummaryForValidationRecords` mirror
`getEvidenceSummaryForRemediationAction`'s exact shape, scoped to
`evidence_links.validation_record_id`.
**Rationale:** Mirrors R-106's identical reasoning one subject type
later. `evidence_links` has carried a genuine, fully-built
`validation_record` subject type (column, CHECK-constraint branch,
composite scope FK) since Milestone 7 — DATA_MODEL.md §8's own
sentence names it explicitly. Slice C5 left it "structurally
unreachable" at the application layer only because Validation itself
was out of scope through that slice; Slice C6 instructions §9 direct
using the existing EvidenceLink architecture, stopping only if
unsupported — it is fully supported, so no STOP was needed. Assessment
finalization is structurally not applicable (ValidationRecord has no
Assessment relationship), so `resolveLinkSubject`'s `validation_record`
branch returns `assessmentStatus: null`, identical to the
`remediation_action` branch's own conclusion. The batched
`getEvidenceSummaryForValidationRecords` (accepting an array of ids,
not just one) exists specifically so the RemediationAction detail page
— which renders the FULL validation history plus each record's own
evidence — issues one query for all of a RemediationAction's
ValidationRecords' evidence, never one query per record (instructions
§32, no N+1).

### R-111 — Reassessment-trigger UI (`triggers_control_test_id`/`triggers_assessment_response_id`) not built this slice (Slice C6)

**Decision:** `createValidationRecord` never sets either
reassessment-trigger column; the UI shows them read-only (when a future
mechanism ever sets them) but offers no way to set them from this
slice's own forms.
**Rationale:** PRODUCT_UX_BLUEPRINT.md row #16 itself frames this as
future work: "Validate (accepted/rejected) + rationale, later link
reassessment." Instructions §12 forbid inventing auto-reopen/cascade
behavior beyond what's explicit; nothing in this slice's brief asks
for a reassessment-linking form, and the blueprint's own "later"
language is the authoritative signal that it is intentionally
deferred, not merely omitted by oversight.

### R-112 — No standalone Validation list route; embedded in RemediationAction detail only (Slice C6)

**Decision:** No `/validation` or similar top-level/engagement-level
route was built. `listValidationRecordsForRemediation` and
`getValidationRecordDetail` exist as domain functions (used directly by
the RemediationAction detail page, and available for a future
standalone view if ever needed) but nothing routes to a bare
ValidationRecord URL yet.
**Rationale:** PRODUCT_UX_BLUEPRINT.md row #16's own explicit language:
"Validation panel (embedded in Remediation detail, not a top-level
screen)." Instructions §15 make engagement-level visibility conditional
on the UX blueprint actually requiring it — it explicitly does not.

### R-113 — Assessment creation: every Control in the pinned library becomes an AssessmentControl; authorization uses the existing coarse engagement-access rule (Slice C7.1)

**Decision:** `createAssessment` (`lib/domain/assessments.ts`), the fix
for the C7 review's own P0 finding (no function anywhere in the
codebase could ever create an Assessment), resolves the two open
questions the C7 review itself flagged as needing an answer before
implementation, both from direct repository inspection rather than
invented:
1. **Population mechanism:** every Control belonging to the Engagement's
   pinned `ControlLibraryVersion` becomes an `AssessmentControl`, in one
   batched insert, at Assessment-creation time. No applicability/
   exclusion mechanism exists anywhere in the schema to filter this set
   — `ApplicabilityDetermination` (DATA_MODEL.md §4) is `[NOT YET
   BUILT]` (no migration exists for it at all) and, even if it existed,
   has no documented relationship to `Control`/`AssessmentControl`
   anywhere in DATA_MODEL.md — it concerns which `RegulatoryReference`s
   apply, a different question entirely. No manual-control-selection
   mechanism is documented either. PRODUCT_UX_BLUEPRINT.md §12 step 4
   independently confirms this is the intended shape: "Controls are
   assessed — `AssessmentControl` scoped from the pinned library."
2. **Who may create an Assessment:** the existing `assessments_insert`
   RLS policy (migration 0009) already answers this —
   `WITH CHECK (can_access_engagement(engagement_id, organisation_id))`
   — the identical coarse rule `requireEngagementAccess` already
   implements and every other `create*` function in this codebase
   (Risk/Finding/RemediationAction/ValidationRecord) already uses. This
   is not an undefined permission model requiring a STOP — the schema
   itself already encodes the answer, and using anything narrower would
   be inventing a role the repository doesn't define.

`previous_assessment_id` is left unset by every Assessment this
function creates (no carry-forward/correction-linking UI is built this
slice — nothing in the codebase reads or writes this column before this
slice, so no existing selection semantics exist to preserve); no
uniqueness constraint on (engagement_id, assessment_type, period_label)
was added, since duplicates are permitted by the existing schema and no
product document requires blocking them.

**Rationale:** C7.1 instructions §2B/§5 explicitly require resolving
both questions from the actual repository before writing code, and
explicitly forbid inventing an applicability workflow or a new role —
STOP was the fallback only if the repository genuinely left either
question open; it does not. Both existing composite FK pairs
(`assessments_engagement_control_library_version_fk` +
`assessment_controls_assessment_scope_fk`/`assessment_controls_
control_library_version_fk`) already make the resulting AssessmentControl
set's tenant/organisation/engagement/library-version consistency
database-impossible to violate — re-verified fresh via direct `psql`
inspection and a dedicated raw-SQL security test this slice, no new
migration required.

### R-114 — Engagement membership management authorization: the existing, already-seeded `membership.manage` permission, read for the first time (Slice C7.2)

**Decision:** `addEngagementMember`/`revokeEngagementMember`
(`lib/domain/engagement-memberships.ts`) are gated on a new
`canManageEngagementMembership` check (`lib/authorization/service.ts`):
the caller holds `membership.manage` either via an active
`EngagementMembership` on the specific engagement (Engagement Manager)
or an active `OrganisationMembership` on the engagement's own
organisation (Client Administrator). Both are resolved through the
existing `Role`/`Permission`/`RolePermission` tables and
`db/seed/roles.ts`'s own already-seeded grant — no new permission, no
new role. This is the first fine-grained Role/Permission check in this
codebase; every prior slice's authorization was coarse engagement/
organisation/tenant membership only (`lib/authorization/service.ts`'s
own pre-C7.2 file comment explicitly named this as deferred "to the
slice that actually needs it").
**Migration 0024 necessity:** the pre-existing `engagement_memberships_
insert` RLS policy (migration 0019) was scoped to "the same set of
people who may create an Engagement" (tenant-wide or organisation-wide
membership) — sufficient for Slice B2's own self-onboarding-at-creation
flow, but NOT sufficient for this slice's realistic, everyday case: an
ordinary Engagement Manager who holds ONLY an `engagement_memberships`
row on their own single engagement (confirmed by direct inspection of
`createEngagement`, which grants no other membership) would be rejected
by RLS even after the application layer approved them. Migration 0024
adds a THIRD, additive OR-clause (permission-based) to the INSERT
policy — removing none of the existing ones — and a new UPDATE policy
(previously absent entirely) gated on the permission check alone (the
tenant-/organisation-wide fallback is deliberately NOT carried into
UPDATE — see the migration's own comment for why). A `prevent_
engagement_membership_reparenting` trigger (mirroring every other
mutable table's identical guard) ensures an authorized UPDATE can only
ever change `status`, never silently reassign `user_id`/`engagement_
id`/`role_id`.
**Rationale:** Instructions §3 explicitly require deriving the answer
from the repository rather than inventing one, with a STOP fallback
only if the repository genuinely doesn't answer it — it does:
`membership.manage`, seeded specifically for Engagement Manager and
Client Administrator since Milestone 1, is exactly the permission this
feature needs, confirmed independently by SECURITY.md §14's own threat
table ("granting oneself or another user a broader membership requires
a permission of its own, not just write access to the membership
table"). The RLS extension is additive only (verified: every existing
`tests/app/engagement-onboarding.test.ts` scenario, including its own
cross-tenant `engagement_memberships` INSERT rejection tests, still
passes unchanged) and deliberately narrower at the application layer
than the full RLS OR-clause (the pre-existing tenant-/organisation-wide
fallback remains, unchanged, for Slice B2's own unrelated purpose) —
consistent with SECURITY.md §2's own framing of RLS as the coarser
backstop and the application layer as where dynamic business rules
belong.

### R-115 — Eligible-user resolution requires bypassing `users_select`'s own RLS via new, narrowly-gated SECURITY DEFINER functions (Slice C7.2)

**Decision:** Three new SECURITY DEFINER SQL functions (migration
0024) — `eligible_engagement_members`, `resolve_membership_candidate`,
`engagement_membership_roster` — each re-checking the caller's own
authorization internally (via `has_engagement_permission`/
`has_organisation_permission`/`can_access_engagement`) before returning
any row. `lib/domain/engagement-memberships.ts` calls all three via
`db.execute(sql...)` rather than a plain Drizzle `.select()` against
`users`.
**Why this was necessary, not a stylistic choice:** direct testing this
slice discovered that `users_select`'s own RLS policy (migration 0001)
— `id = auth.uid() OR shares_membership_scope(id)` — makes a candidate
user who is NOT YET a member of anything shared with the caller
genuinely invisible to an ordinary query, even to an authorized
Engagement Manager. This is the exact, structural chicken-and-egg
problem this feature exists to solve ("find someone not yet connected,
in order to connect them") colliding with a correct, pre-existing,
unrelated RLS rule. A second, related instance: `shares_membership_
scope`'s engagement branch requires BOTH sides' membership to be
`status = 'active'`, so a revoked member's row silently disappears from
an ordinary roster JOIN too — contradicting this project's own
established "show status honestly, never collapse history" posture.
**Rationale:** the fix reuses the exact SECURITY DEFINER pattern
already established twice in this codebase (migration 0001's
`can_access_*` functions, migration 0019's `organisation_tenant_id`
family) for precisely this class of problem — never a second
authorization system, never a service-role bypass, never weakening
`users_select` itself (which would let any authenticated user browse
their whole tenant's user directory, a materially broader, unrelated
capability). Each function independently re-derives and re-checks the
same permission rule `lib/authorization/service.ts`'s own TypeScript
functions already enforce before ever calling it — an unauthorized
caller gets zero rows, never a different error that would leak whether
a candidate user exists.

### R-116 — Membership self-protection: no invariant exists, so none is invented (Slice C7.2)

**Decision:** `revokeEngagementMember` allows any authorized manager to
revoke any member, including themselves, and including the only other
remaining manager — no "last manager" protection, no self-revocation
block, no separate role-change feature (not requested by this slice's
own brief, which lists only Add and Revoke).
**Rationale:** instructions §8 explicitly direct deriving self-
protection semantics from the existing model, flagging a PRODUCT
DECISION REQUIRED only if the model is silent AND an existing invariant
would otherwise be violated — with an explicit fallback for the case
where no invariant exists at all: "preserve the simplest existing
model." A fresh grep this slice across DATA_MODEL.md, SECURITY.md,
PRODUCT_SPEC.md, PRODUCT_UX_BLUEPRINT.md, and DECISIONS.md for any
"last manager"/"at least one"/"cannot revoke" language found nothing.
No other membership table (`tenant_memberships`, `organisation_
memberships`) has any such protection either, anywhere in this
codebase's history. The simplest existing model — a plain, symmetric
permission check with no special-cased self/last-admin logic — is
therefore what this slice preserves, not a gap. This is a real,
deliberate, and now-documented behavior: a solo Engagement Manager
genuinely can revoke themselves down to zero managers on their own
engagement, tested directly (`tests/app/engagement-membership.test.ts`).

### R-117 — Finalization authority: a new, distinct `assessment.finalize` permission, granted to Engagement Manager (Slice C7.3)

**Decision:** `finalizeAssessment` (`lib/domain/assessments.ts`) is
gated on a new `canFinalizeAssessment` check
(`lib/authorization/service.ts`), mirroring `canManageEngagementMembership`'s
exact shape: the caller holds `assessment.finalize` via an active
EngagementMembership on the specific engagement or an active
OrganisationMembership on its organisation. `assessment.finalize` is a
genuinely new row in `db/seed/roles.ts`'s `PERMISSIONS` array, granted
to Engagement Manager (and, following the same "Platform Administrator
holds every permission" pattern already established for every other
permission in the catalogue, also to Platform Administrator) — additive
seed data only, no schema change (`permissions`/`role_permissions`
already existed since Milestone 1).
**Why a new permission rather than reusing `engagement.manage`:**
`engagement.manage`'s own seed description ("Edit an existing
engagement's details/status") is about the `Engagement` entity's own
fields — finalizing an `Assessment` is a different entity, a different,
far more consequential and irreversible action, and folding it into an
existing, differently-scoped permission would blur exactly the kind of
granularity PRODUCT_UX_BLUEPRINT.md §8's own permission-mapping table
already treats as distinct: "Engagement Manager additionally gets
finalize/membership-manage" names "finalize" and "membership-manage" as
two separate capabilities, the second of which (`membership.manage`,
Slice C7.2) already got its own dedicated permission key rather than
being folded into something broader — the identical treatment is
applied here to the first. SECURITY.md §2's own illustrative example
(`assessment_response.write`) independently confirms this
`<entity>.<action>` naming convention is the documented intended shape
of this system's permission catalogue, not an invention.
**Known, deliberate limitation carried from C7.2 unchanged:** like
`canManageEngagementMembership`, `canFinalizeAssessment` checks only
engagement-scope and organisation-scope permission, never tenant-scope
— Platform Administrator's own `assessment.finalize` grant is seeded
faithfully (matching its existing "holds everything" pattern) but is
currently dormant unless that user also happens to hold a narrower
engagement/organisation membership, since no `hasTenantPermission`
check exists anywhere in this codebase yet. This is not a new gap this
slice introduces — it is the exact same architectural boundary Slice
C7.2 already drew and documented, applied consistently rather than
solved here.

### R-118 — Assessment finalization builds no new immutability mechanism; migration 0025 only narrows who may perform the transition (Slice C7.3)

**Decision:** No new trigger was added anywhere. Direct, fresh
inspection of migrations 0009/0011 this slice confirmed `assessments_
prevent_finalized_tampering`, `assessment_controls_enforce_draft_
mutable`, `assessment_responses_enforce_draft_mutable`, `control_tests_
enforce_draft_mutable`, and `enforce_evidence_link_draft_mutable`
already fully and unconditionally freeze Assessment, AssessmentControl,
AssessmentResponse, ControlTest (when tied to the Assessment), and
EvidenceLink (for an assessment_response/control_test subject) the
moment `status` becomes `finalized` — built in Milestone 5/6, dormant
only because nothing ever set that status through the application
before this slice. Migration 0025's only change is a narrowing of the
pre-existing, previously-unused `assessments_update` RLS policy: its
`WITH CHECK` now additionally requires `assessment.finalize` when the
new row's `status` is `finalized` (the coarse `can_access_engagement`
clause remains, for the general case) — closing a real, live gap this
slice's own testing confirmed: before this migration, ANY engagement
member could raw-SQL flip an Assessment's `status` to `finalized`,
bypassing the new permission-gated application check entirely.
**Rationale:** matches SECURITY.md §2's two-layer model exactly — the
application layer decides the business rule (`assessment.finalize`);
RLS independently backstops it, narrowed rather than duplicated wholly.
Both raw-SQL security tests
(`tests/app/assessment-finalization.test.ts`) confirm the two layers
agree: an unauthorized role's raw UPDATE is rejected by RLS, and an
already-finalized row's raw UPDATE is rejected by the pre-existing
trigger, independently of each other.

### R-119 — No completeness requirement, no reopening, no new finalization-metadata columns — the existing model is preserved, not extended (Slice C7.3)

**Decision:** Finalization has no precondition beyond "the caller holds
`assessment.finalize` and the Assessment is currently `draft`" — an
Assessment with zero recorded responses may be finalized exactly as
validly as a fully-answered one, tested directly. No reopening path was
built. No `finalized_at`/`finalized_by` columns were added.
**Rationale:** none of PRODUCT_SPEC.md/PRODUCT_UX_BLUEPRINT.md/
DATA_MODEL.md documents any completeness precondition for finalization
— grepped fresh this slice, confirmed absent — and instructions §9
explicitly forbid inventing one "merely because it seems logical."
DATA_MODEL.md §6 and PRODUCT_SPEC.md principle 6 both explicitly
describe finalization as one-way ("corrections create a new assessment
period rather than rewriting history") — building a reopen path would
contradict the documented model, not merely go beyond it, so instead of
guessing at who-may-reopen semantics this is recorded as correctly
out of scope, matching the model as documented. `updated_at`/
`updated_by`, set on the finalizing transition, already serve as a
permanent, unambiguous "when/who finalized" record precisely because
`assessments_prevent_finalized_tampering` guarantees this transition is
the LAST update the row can ever receive — no dedicated column is
needed to answer a question the generic columns already answer
permanently by construction, and `audit_log` independently records the
same fact a second way.

### R-120 — Fixed a real, narrow bug in `unlinkEvidence`'s trigger-exception translation, discovered by this slice's own testing (Slice C7.3)

**Decision:** `lib/domain/evidence.ts`'s `unlinkEvidence` now checks
both `err.message` and `err.cause`'s message (`errorMessageIncludes`,
new small helper) before deciding whether a caught exception is the
finalization-immutability trigger, rather than `err.message` alone.
**Why:** direct testing this slice (attempting to unlink evidence from
a control whose Assessment had just been finalized — the exact scenario
this function's own pre-existing docstring already described but had
never actually been exercised against, since nothing could reach
`finalized` status before this slice) found that drizzle-orm's
node-postgres driver wraps a `.delete()` failure's real Postgres error
message on `err.cause`, not on `err.message` itself — unlike
`.insert()`/`.update()` failures, which this project's other,
identically-shaped catch blocks (`updateAssessmentResponse`,
`createControlTest`, `uploadEvidence`) translate correctly today,
confirmed by this slice's own passing tests for each of them. Without
this fix, a consultant attempting to unlink evidence from a finalized
assessment would see a raw, unfriendly database error rather than the
same clean `AssessmentFinalizedError` every other write path in this
application already shows — a real, user-facing regression this
slice's own testing caught before it could reach anyone. This is a
narrow, minimal fix (one function, one new small helper) — not a
broader audit or rewrite of every other catch block in the codebase.

### R-121 — Output format PDF, generated by `pdfkit`; PDF structure verified in tests via `pdfjs-dist` (Slice R1)

**Decision:** The Engagement Report is a PDF, generated server-side by
`pdfkit` (a new runtime dependency) inside a Route Handler that returns
a binary stream. `pdfjs-dist`'s legacy Node build (a new dev-only
dependency, used solely in `tests/app/engagement-report.test.ts`) parses
the generated bytes back into real per-page text for test assertions.
**Rationale:** the output format itself is not invented — PRODUCT_UX_
BLUEPRINT.md §5 row 18 ("Generate PDF/export") and §15's Server/API
Boundary table ("Route Handler — returns a binary/PDF stream") both say
PDF directly, so no STOP was needed there. The library choice is this
slice's own judgment call, made against instructions §17's explicit
bar ("prefer a mature, minimal dependency that works reliably in the
existing Next.js/Vercel architecture... not a large reporting
framework"): `pdfkit` is pure JavaScript end to end (its own
dependencies — fontkit, linebreak, png-js, fflate, @noble/hashes,
@noble/ciphers — are themselves pure JS, no native bindings), so it
needs no headless browser (ruling out Puppeteer/Playwright + HTML-to-
PDF) and no native compilation step (ruling out canvas-backed
alternatives, including `pdf-parse`'s own default dependency chain,
which pulls in `@napi-rs/canvas`) — verified directly in this
environment before adopting it (a throwaway smoke-test PDF was
generated and successfully parsed). `pdfjs-dist` was chosen for the
test-side verification specifically because instructions §27 forbids
"just string-search[ing]" the raw buffer — real PDF structure must be
inspected — and `pdfjs-dist` alone (not `pdf-parse`, which wraps it)
has zero runtime dependencies of its own and works for text extraction
without ever touching its optional canvas-rendering path.

### R-122 — Assessment selection: most recent by `created_at DESC, id DESC`, no picker UI (Slice R1)

**Decision:** When an Engagement has more than one Assessment, the
report always reports on the single most recently created one, selected
by `ORDER BY created_at DESC, id DESC LIMIT 1` — a genuinely total,
deterministic ordering (the `id` tie-break matters because `created_at`
alone is not guaranteed unique). The selected Assessment's type,
period, status, and ID are shown on the cover page, the Assessment
Results section header, and the Appendix. No Assessment-picker UI
exists in R1.
**Rationale:** this was the one genuinely ambiguous product semantic
this slice could not resolve from repository evidence alone
(instructions §21/§39 both flag it explicitly as a STOP candidate) — put
to the user directly rather than guessed at. The user's own answer
specified the exact ordering and display requirements verbatim; this
decision records that answer as the shipped behavior, not a
independently-derived one.

### R-123 — No `generated_reports` table; the audited event is a direct `audit_log` write, reusing the `getEvidenceDownloadUrl` (Slice C2) precedent (Slice R1)

**Decision:** No new table was added. The Route Handler writes one
`audit_log` row per report generated (`entity_type: "engagement"`,
`reason: "engagement_report_generated"`, `field_changes` carrying only
which Assessment was selected — never any Risk/Finding/Remediation/
Evidence content).
**Rationale:** PRODUCT_UX_BLUEPRINT.md §7's Reports section explicitly
frames a `generated_reports` table as "a candidate small addition, not
yet designed" — not a requirement — while separately stating plainly
that "report generation itself should be an audited event." Instructions
§25/§32 both require STOPping before adding a new reporting table unless
the repository explicitly requires one; it does not, so none was added.
The audited *event* is the actual requirement, and this codebase already
has exactly one precedent for a read-only action needing a direct
`audit_log` write (`getEvidenceDownloadUrl`, Slice C2, "because issuing
the URL is not itself a row mutation any trigger could observe") — the
identical situation applies here (rendering a PDF is not a row mutation
either), so the same mechanism was reused rather than a new one
designed.

### R-124 — Draft and finalized Assessments are both reportable; no finalization requirement was invented (Slice R1)

**Decision:** `getEngagementReportData` does not check, and does not
reject, a `draft`-status selected Assessment. Report generation behaves
identically regardless of the selected Assessment's status; the status
itself is surfaced verbatim in the report so the reader can see which
kind of artifact they are holding.
**Rationale:** PRODUCT_SPEC.md §5 describes the report as "generated
from live data" and PRODUCT_UX_BLUEPRINT.md §7 independently describes
it as "a point-in-time artifact over then-current data" — neither ties
report eligibility to finalization state, and instructions §19 requires
a STOP rather than assuming a gate that isn't documented. Tested
directly (`tests/app/engagement-report.test.ts` #6): report generation
was exercised against the same Assessment both before and after
finalizing it, with both attempts succeeding and only the reported
`status` field differing.

### R-125 — No engagement-report-specific permission; ordinary `requireEngagementAccess` gates report generation (Slice R1)

**Decision:** `getEngagementReportData` is gated by the same
`requireEngagementAccess` check every other read screen in this
application already uses — any active Engagement (or Organisation/
Tenant-wide) member may generate the report. No new `report.read`
permission was seeded.
**Rationale:** PRODUCT_UX_BLUEPRINT.md §7's own Authorization line
("report-read role, itself visibility-filtered per reader — a client
user generating 'their' report never sees a consultant-internal field
even inside the PDF") describes a distinction this codebase has no
structural basis for yet: there is no Client Portal, no report-facing
visibility filter, and Evidence's own `visibility` column (the one
consultant-internal/client-visible split that exists anywhere in this
schema) is explicitly out of scope for R1 per instructions §37's
"do not build... Client Portal" line. Building a narrower permission
now would gate on a distinction (consultant vs. client reader) that
does not yet exist anywhere else in the product, rather than
genuinely enforcing one — the honest, minimal choice is the same
access boundary the Engagement itself already has, matching every
other Engagement-scoped read (Risk Register, Findings, Remediation,
Validation) that also has no dedicated read permission today.

### R-126 — Real bug found and fixed: a footer position past the printable area silently forced a spurious blank page after every section (Slice R1)

**Decision:** `drawFooter()`'s Y position was moved from
`doc.page.height - PAGE_MARGIN + 18` (18pt *below* pdfkit's own
bottom-margin boundary) to `doc.page.height - PAGE_MARGIN - 14` (14pt
*above* it, safely inside the printable area).
**Why:** instructions §36's mandatory manual/visual inspection of the
real generated PDF (not just unit tests) found that every section
was followed by an extra, nearly blank page carrying only the footer
text at its top — nineteen pages total for content that should have
been ten. The automated tests alone did not catch this: `pdfjs-dist`
text extraction still found every string it looked for (just on an
extra page), and the original page-count assertion used a loose
`toBeGreaterThanOrEqual` bound that a few unexplained extra pages
still satisfied. Root cause: pdfkit treats an explicitly-positioned
`.text()` call whose Y coordinate falls beyond `page.height -
bottom margin` as page overflow and silently starts a new page before
drawing — the footer was being drawn deliberately in the margin
whitespace below that boundary, which pdfkit does not actually
support the way this code assumed. Fixed by keeping the footer's
position inside the printable area; verified by re-rendering the
demonstration PDF and re-inspecting it page-by-page, and by tightening
the test's page-count assertion from a loose bound to an exact `toBe
(10)` plus a per-page non-empty-content check, so a regression of this
exact shape fails automatically in the future. Recorded as a genuine
example of why instructions §36 requires inspecting the actual
artifact, not only asserting against extracted text.

### R-127 — Real bug found and fixed: a table row could split mid-row across a page boundary, corrupting later cells (Reference Engagement Dataset session)

**Decision:** `lib/reports/engagement-report-pdf.ts`'s `table()`
function now measures each row's real height (`doc.heightOfString`,
which has no side effect on the document cursor) BEFORE drawing it, and
starts a new page first if the row would not fit — rather than checking
only a fixed ~40pt threshold and letting pdfkit's own per-cell
auto-pagination decide mid-row.
**Why:** R1's own test fixture never produced a control/risk/finding
title long enough to wrap onto 3+ lines right at a page's bottom
margin, so this defect was latent and unfound. Building this session's
much larger, more realistic reference-engagement fixture (a 25-control
demo library, several multi-line control titles) reproduced it
immediately: the Assessment Results table's GRI-01 row's Control cell
wrapped onto 3 lines starting just above the OLD fixed threshold; that
cell's own `.text()` call then triggered pdfkit's own automatic
new-page behavior partway through drawing, but every LATER cell in that
same row (Type, Effectiveness, Rationale, Respondent) was still drawn
at the row's original, now-stale y-coordinate — landing at the wrong
position on the new page instead of flowing with the wrapped cell.
Found by this session's own mandatory manual/visual PDF inspection
(instructions §36 — a garbled row is invisible to a pure text-extraction
assertion, since the words are all still present, just mispositioned);
fixed, and re-verified by re-rendering both this reference-engagement
PDF and R1's own smaller PDF and re-inspecting both page-by-page —
neither pagination test regressed, and this exact defect shape (a row
split across pages) is now structurally prevented rather than merely
avoided by luck of the data being small.
**Scope note:** per the brief's own "Do not modify R1 unless an actual
defect is discovered" instruction, this is the ONLY change made to
Slice R1's own code this session — a real, reproducible rendering
defect, not a stylistic or speculative improvement.

### R-128 — No standalone seed script; the reference/demo dataset lives as a Vitest test file, reusing the existing `server-only` test-shim mechanism (Reference Engagement Dataset session)

**Decision:** `tests/app/reference-engagement-fixture.ts` (the builder)
and `tests/app/reference-engagement.test.ts` (the walkthrough) are the
whole mechanism — no `db/seed/reference-engagement.ts`-style standalone
`tsx` script was written.
**Rationale:** every `lib/domain/*` module begins with `import
"server-only"`, and the real `server-only` npm package (confirmed by
reading `node_modules/server-only/index.js` directly) unconditionally
throws when imported outside a Next.js/webpack bundle — a plain `tsx`
script cannot import a single real domain function, full stop. The
ONLY place in this repository real domain functions are ever exercised
outside the Next.js server itself is Vitest, via
`tests/shims/server-only.ts`'s alias (`vitest.config.ts`). Building a
second, parallel mechanism (e.g. a bespoke alias/loader hack for a
standalone script) would be exactly the "giant new abstraction merely
to support the fixture" instructions explicitly forbid; reusing the
existing, already-proven mechanism instead means this fixture is
simultaneously reproducible (`reset-test-db.ts` + a fresh run),
reset-cleanly (every run starts from an empty test database), and
"used in automated tests" (it IS an automated test) — all three
properties the brief asked for, satisfied by the repository's own
existing tooling rather than a new one. The direct, practical
consequence: this reference dataset lives only in the ephemeral test
database (`primus_privacy_test`), not in a long-lived dev database — an
honest limitation, not a shortcut, since no live browser walkthrough of
ANY feature in this repository is currently possible anyway (no real
Supabase Auth project has ever been provisioned, DECISIONS.md D-03), so
a persisted dev-database copy would not enable anything a Vitest-based
walkthrough doesn't already prove.

### R-129 — Maturity: zero rows written, even as a raw fixture (Reference Engagement Dataset session)

**Decision:** unlike Data Landscape/ROPA and the Control Library (both
populated via raw SQL, since instructions explicitly permit "a clearly
isolated fixture representation" for an area with real schema but no
application layer), this fixture writes NO `maturity_assessments`/
`maturity_scores` rows at all.
**Rationale:** direct inspection of this repository's own existing test
fixture helper for MaturityScore (`tests/maturity/helpers.ts`'s
`createMaturityScore`) found that `score` and `maturityLevel` are
direct, caller-supplied inputs — proof, from the repository's own code,
that no computation logic exists anywhere, not even at the database
trigger level. Any score this fixture invented would therefore be
arbitrary, fabricated data with no basis in the fixture's own
Assessment/Risk/Validation content — precisely what instructions §12
("do not build a new maturity engine... do not invent a score") and
this codebase's own established "no invented completion %" posture
(Slice R1, DECISIONS.md) both forbid. Recorded in the Gap Matrix
(`REFERENCE_ENGAGEMENT.md`) as Application Support: NO — the honest
finding, not softened by a fixture-only workaround.

### R-130 — Control Library Authoring: `methodology.manage` granted to Platform Administrator AND Practice Partner, resolved from PRODUCT_UX_BLUEPRINT.md §8's own Permission Matrix (Slice D1)

**Decision:** the new `methodology.manage` permission (`db/seed/
roles.ts`) is granted to both tenant-scope Roles — Platform
Administrator and Practice Partner — not Platform Administrator alone.
**Rationale:** two places in PRODUCT_UX_BLUEPRINT.md name the actor for
Methodology Admin screens, and they read differently at first glance.
§5's row 20 ("Methodology Admin — Control Library") names only
"Platform Administrator" as the Actor column's single illustrative
persona — but that column is consistently a single-persona label
throughout §5 even for capabilities multiple roles genuinely share
(e.g. row 19's Audit Log viewer names only "Consultant," while §8's own
Permission Matrix gives Tenant/Consultant/Reviewer all read access to
it). §8's Permission Matrix is the document's own dedicated, careful
reconciliation of "the brief's 6 requested columns" against "the
existing role model" — and it explicitly maps "Tenant" (the column
holding "R,C,E,F" — full read/create/edit/finalize — on the
"Methodology" capability row) to exactly "Platform Administrator,
Practice Partner" in its own legend table. Treated as the more
authoritative of the two for an exact "who gets what" question, per
this codebase's own established discipline of resolving such
tensions by finding the most specific, deliberately-reconciled source
rather than the first illustrative label encountered — and confirmed
independently by `db/seed/roles.ts`'s own pre-existing Platform
Administrator description ("control library and regulatory content
management"), which the Milestone 4 session already wrote before this
slice existed, without yet having any permission to attach it to.

### R-131 — Control Library read access left at the existing, broader `can_access_tenant` boundary — a documented, deliberate scope limit, not an oversight (Slice D1)

**Decision:** every read function in `lib/domain/control-library.ts`
is gated by `requireTenantAccess` (the pre-existing, application-layer
`canAccessTenant` check, which today resolves true only for a literal
`TenantMembership` holder — `lib/authorization/service.ts`'s own
docstring already anticipated, but never built, an engagement-
membership fallback: "no screen in Slice A1 needs tenant-level access
resolution (Methodology/Administration screens are out of scope);
added when that slice needs it"). This slice does NOT build that
fallback.
**Rationale:** PRODUCT_UX_BLUEPRINT.md §8's Permission Matrix envisions
broader read access — "Consultant"/"Reviewer" columns both get "R" on
Methodology — which today's `canAccessTenant` does not yet grant (an
engagement-scoped Consultant, with no `TenantMembership` row, is
denied `/methodology` entirely under this slice). This is a real,
known, DELIBERATELY left gap: instructions §12 forbid "advanced
methodology workflow" and broader scope creep, and this task's actual
ask is the AUTHORING capability specifically (§7: "so an authorised
PRIMUS user can create and maintain methodology content") — Platform
Administrator and Practice Partner, both of which already hold
`TenantMembership` today, so the write-authorization work this slice
exists for is unaffected either way. Broadening `canAccessTenant`
itself is a general-purpose, security-relevant function shared by every
current and future Tenant-scoped screen; changing its semantics as an
incidental side effect of a read-convenience improvement for one
screen was judged the wrong place to make that change. Recorded here,
not silently left implicit, so a future slice building out broader
Methodology read access (or Administration) knows exactly where the
gap is and why it wasn't closed here.

### R-132 — Cloning a published Control Library Version never duplicates Requirements/RegulatoryReferences, matching R-43's existing, documented model exactly (Slice D1)

**Decision:** `cloneControlLibraryVersion` creates new `Control` rows
(fresh ids, same `code`/`title`/`description`/`controlType`, in the new
draft `ControlLibraryVersion`) and new `ControlRequirement` mapping
rows pointing at the SAME existing `Requirement` rows the source
version's Controls were mapped to — it never creates a new
`Requirement` or `RegulatoryReference` row, and it adds no new
"lineage"/"carried-forward-from" column to any table.
**Rationale:** this is not a new design choice this slice made — it is
the ALREADY-DOCUMENTED model (DECISIONS.md R-42/R-43, Milestone 4):
"carrying a control's intent forward into a new library version means
creating a brand new Control row... with no formal link back to the
row it succeeds," and Requirement is "Practice-owned reference content
that exists independently of any one library version" specifically so
the same Requirement (e.g. "R1") can be mapped from multiple library
versions' worth of Controls over time. Inventing a `cloned_from_id`
column here, or duplicating Requirements per clone, would have directly
contradicted an existing, deliberate architectural decision instead of
building on it — instructions §4's own "if the current versioning
architecture expects cloning, implement cloning through the existing
domain model" was read as a direct instruction to preserve exactly
this, not to design a new lineage mechanism.

### R-133 — Master data is Organisation-level, Processing Activity is Engagement-level — two domain modules, not one, because the schema already draws that boundary (Slice D2)

**Decision:** `lib/domain/master-data.ts` (Business Unit, Data
Principal Category, Personal Data Element, Purpose, System, Data Store,
Processor) and `lib/domain/processing-activities.ts` (Processing
Activity + its six version-pinned junctions) are two separate domain
modules, not one.
**Rationale:** this is not a stylistic choice — it follows directly
from DATA_MODEL.md §5.1/§5.2 and the schema itself: every master-data
identity table carries `organisation_id` (never `engagement_id`) and is
explicitly documented as persisting across engagements; `processing_
activities` carries `engagement_id` NOT NULL with a composite FK to
`engagements`, is created fresh per engagement, and is never mutated by
a later one. Authorization follows the same split
(`requireOrganisationAccess` vs. `requireEngagementAccess`), matching
migrations 0003 and 0005's own RLS policies exactly. Merging the two
into one module would have blurred a distinction the repository's own
evidence — schema, DATA_MODEL.md, and the pre-existing RLS — already
drew deliberately.

### R-134 — No new permission for Data Landscape/Processing Activities — the existing broad organisation/engagement access model is already correct (Slice D2)

**Decision:** master-data writes are gated by `requireOrganisationAccess`
and Processing-Activity/junction writes by `requireEngagementAccess` —
the same PRE-EXISTING, broad checks (`canAccessOrganisation`/
`canAccessEngagement`) every other organisation-/engagement-scoped
domain module in this codebase already uses. No `data_landscape.manage`-
style permission was introduced.
**Rationale:** instructions §7 explicitly required determining this
from "the existing Permission Matrix and UX blueprint," not inventing a
permission by default. Three independent pieces of evidence agreed:
(1) migration 0003's master-data RLS policies and migration 0005's
Processing-Activity/junction RLS policies were ALREADY gated by the
plain `can_access_organisation`/`can_access_engagement` checks, with no
narrower permission — unlike Methodology (migration 0007's original
policies), which Slice D1 narrowed specifically BECAUSE it was
Tenant-scoped and the Permission Matrix named a distinct, narrower
"Tenant" audience for it. (2) PRODUCT_UX_BLUEPRINT.md §8's own
Permission Matrix rows for "Client Master Data" and "Processing
Activities / ROPA" show plain R/C/E by membership scope for Consultant,
Client Admin, and Client Contributor alike — no dedicated permission
column, in contrast to the "Methodology" row's own distinct Tenant-only
column. (3) `lib/authorization/service.ts`'s own `requireOrganisation
Access`/`requireEngagementAccess` already exist, independently
implemented per SECURITY.md §2's two-layer model, and are exactly what
every other organisation-/engagement-scoped write in this codebase
uses. Introducing a new permission here would have contradicted all
three, not merely been unnecessary — this is the D1 precedent's mirror
image: D1 needed a new permission because its own evidence pointed to
one; D2's evidence points the opposite way.

### R-135 — ROPA is a read view, never a new persisted table (Slice D2)

**Decision:** `listRopaEntries` (`lib/domain/processing-activities.ts`)
composes `ProcessingActivity` and its six junctions, resolved against
current-at-link-time master-data versions, into a structured read
result. No `ropa` table, no new PDF/reporting subsystem.
**Rationale:** instructions §10 explicitly forbade a separate ROPA data
model "unless the existing architecture explicitly requires it" — it
does not: `db/schema/processing-activities.ts`'s own pre-existing
header comment already states "ROPA is a future view/workflow over this
table and its junctions — not a separate dataset," written at Milestone
3, before this slice existed. Building a new persisted ROPA object
would have directly contradicted that standing architectural note.
Export/PDF was likewise left out — R1 (`lib/domain/reports.ts`) already
owns Engagement Report generation, and instructions §10 explicitly say
not to create a second one.

### R-136 — Carry-forward failures on individual relationships are skipped, not fatal to the whole action (Slice D2)

**Decision:** `carryForwardProcessingActivity` attempts to re-link
every one of the source activity's relationships into the new
engagement-scoped row; if a specific master-data entity has been
retired (no current version to resolve to) since the source engagement,
that ONE link is silently skipped rather than failing the entire
carry-forward.
**Rationale:** DATA_MODEL.md §5.4 itself describes carry-forward as a
starting point for renewed discovery work — "the consultant then edits
from there (adds/removes systems, swaps a processor, etc.) as the new
engagement's discovery work finds changes" — not an all-or-nothing
transaction that must reproduce every prior link exactly. A retired
master-data entity having no current version is exactly the kind of
change the next engagement is expected to discover and reconcile
manually; failing the whole carry-forward over one stale link would
have forced the consultant to lose the entire pre-populated activity
rather than review and complete it. Any OTHER error during carry-forward
(a genuine authorization or scope failure) still propagates and fails
the action — only the specific, expected "no current version" case is
treated as non-fatal.

### R-137 — Applicability/Scope's future integration point requires no schema change to this slice's own tables (Slice D2)

**Decision:** no placeholder column, table, or FK was added in
anticipation of a future `ApplicabilityDetermination` entity.
**Rationale:** instructions §16 required confirming the Data Landscape
model does not PREVENT a future Applicability/Scope layer, not
building speculative scaffolding for it (instructions §17: "do not add
speculative tables"). `ApplicabilityDetermination`
(DATA_MODEL.md §4) would reference `ProcessingActivity` by a plain FK
the same way `Risk`/`Finding` already do today — `processing_
activities.id` is a stable, already-composite-FK-protected primary key
requiring no change to support a future referencing table. This is
recorded as the integration point, not built.

### R-138 — RegulatoryReference-level applicability remains exactly as DATA_MODEL.md §4 specifies it; Control-level applicability is a new, second entity — never one entity doing both jobs (Slice D3)

**Decision:** `ApplicabilityDetermination` is implemented unchanged
from DATA_MODEL.md §4's own field list — engagement-scoped,
RegulatoryReference-level, `scope_description` free text. A NEW,
separate entity pair — `EngagementScope` (versioned header) and
`EngagementScopeControl` (one row per Control in the pinned library) —
is the ONE mechanism that integrates with Assessment.
**Rationale:** the D3 design proposal (reviewed and approved before
this implementation) found, and this implementation re-confirms, that
RegulatoryReference-level applicability cannot reliably drive
Control-level Assessment scope: `RegulatoryReference -> Requirement ->
Control` is M:N (`ControlRequirement`, migration 0006), so marking one
RegulatoryReference "not applicable" cannot cleanly cascade to "these
Controls are not applicable" without either an unreliable heuristic or
restructuring the existing methodology graph — neither acceptable.
`lib/domain/assessments.ts`'s own pre-existing docstring (Slice C7.1,
R-113) had already independently reached the identical conclusion
before D3 existed: "`ApplicabilityDetermination`... concerns which
RegulatoryReferences apply, a different question entirely [from
Control/AssessmentControl]." Two entities, not one overloaded with two
granularities, keeps each one's own meaning unambiguous.

### R-139 — AssessmentControl membership is never filtered by applicability; `createAssessment` snapshots the locked Scope's per-Control decision onto each row instead (Slice D3)

**Decision:** `createAssessment` (`lib/domain/assessments.ts`) is
extended, not restructured: it still creates exactly one
`AssessmentControl` per Control in the pinned `ControlLibraryVersion`,
unconditionally (R-113's own pre-existing behavior, unchanged). It
additionally looks up the Engagement's most recently LOCKED
`EngagementScope`, if any, and copies each Control's `applicability_
decision`/`rationale`/`decided_by`/`decided_at` — plus a pin to the
specific `EngagementScopeControl` row — onto the new `AssessmentControl`
row. If no locked Scope exists, every column keeps its default
(`'undecided'`, nulls) — existing Assessment-creation behavior for an
Engagement with no Scope is completely unaffected.
**Rationale:** the approved design's own Model 3 (snapshot-at-creation,
never filter membership): filtering membership would (a) require
editing `createAssessment`'s core population logic, an explicit
non-goal for this task ("Preserve this behaviour... DO NOT remove
AssessmentControl rows for N/A controls"), and (b) make an N/A control's
history *disappear* from the Assessment rather than being visibly
recorded as "excluded, and here is why" — worse for the "why is this
control applicable/not applicable" auditability requirement than
keeping the row and showing its snapshot. Snapshotting at creation
reuses the exact discipline `control_library_version_id` already uses
on the same table (R-49) — pin now, never re-derive later — which is
also what makes a later Maturity calculation's historical
reproducibility automatic for free, with no separate "as-of" logic
needed.

### R-140 — Applicability is a genuine tri-state (`undecided`/`applicable`/`not_applicable`); every Control gets a real row at Scope-creation time, never inferred from absence or a defaulted boolean (Slice D3)

**Decision:** `control_applicability_decision` (enums.ts) is a
three-value enum, not a boolean. `createEngagementScope` pre-populates
one `EngagementScopeControl` row per Control in the pinned library,
`decision = 'undecided'` by default — mirroring `createAssessment`'s own
"every Control becomes a row" population pattern one level up.
**Rationale:** an explicit implementation directive: "Do NOT allow
`applicable = true` to silently mean 'someone has explicitly decided
this Control is applicable'... Do NOT use `boolean DEFAULT true` if
doing so destroys the distinction between 'not yet decided' and
'explicitly applicable'." A boolean (or an absent row standing in for
"undecided") cannot represent three genuinely distinct states without
conflating at least two of them. Pre-populating every Control's row at
Scope-creation time (rather than only inserting a row once a decision is
made) means "nobody has reviewed this yet" is always a real, queryable,
auditable fact — never an inference from a missing row, which could
otherwise be confused with "this Control isn't part of this Scope at
all."

### R-141 — `scope.lock` is a new, dedicated permission — never a reuse of `assessment.finalize`, even though both resolve to Engagement Manager today (Slice D3)

**Decision:** a new `scope.lock` permission (`db/seed/roles.ts`),
granted only to Engagement Manager. `lockEngagementScope`
(`lib/domain/applicability.ts`) checks it via `requireScopeLockAccess`
— a distinct function from `requireAssessmentFinalizeAccess`, never a
call to it.
**Rationale:** an explicit implementation directive, reversing this
task's own initial D3 design recommendation (which had proposed reusing
`assessment.finalize`): "`assessment.finalize` means certification/
finalization of an Assessment. `scope.lock` means the Engagement's
applicability/scope determination is settled... they must remain
independently controllable." The two actions are conceptually distinct
governance events on different objects (Assessment vs. EngagementScope)
that merely happen to be granted to the same role today — collapsing
them into one permission would make it impossible to later grant one
without the other (e.g. a future role that may lock Scope but not
finalize Assessments, or vice versa) without a migration to un-collapse
them. No role currently seeded holds one without the other, matching
today's actual seed data exactly (`db/seed/roles.ts`'s own
`ROLE_PERMISSIONS["Engagement Manager"]` now lists both).

### R-142 — Proposing/editing a draft Scope requires real `EngagementMembership`, not the broader `requireEngagementAccess` every other engagement-scoped write in this codebase uses (Slice D3)

**Decision:** a new, narrower authorization primitive,
`requireEngagementMembershipAccess` (`lib/authorization/service.ts`),
wrapping the existing `isActiveEngagementMember` — used for
`createEngagementScope`/`reviseEngagementScope`/
`updateControlApplicability`/`createApplicabilityDetermination` instead
of the broader `requireEngagementAccess` every other write function in
this codebase (`createProcessingActivity`, `createRisk`, etc.) uses.
Reads (`listEngagementScopes`/`getEngagementScopeDetail`) remain on the
broad `requireEngagementAccess`, matching the existing read convention
everywhere else.
**Rationale:** `requireEngagementAccess`/`canAccessEngagement` passes
for anyone with mere Organisation-wide membership (the `can_access_
organisation` fallback), which would let a client-side, Organisation-
scoped role (Client Administrator, Privacy Officer, CXO/Executive
Viewer — none of which hold `EngagementMembership` in this codebase's
own seed/fixture convention) reach the Scope write path — directly
contradicting this task's own explicit "Client-side roles: No Scope
write access" requirement. This does NOT fully close the separate,
pre-existing, already-documented gap that client-side, Engagement-scoped
roles (Business Owner, IT/CISO, Procurement, Legal —
PRODUCT_UX_BLUEPRINT.md §8's "Client Contributor" grouping) would still
pass this narrower check too, since their own `Role.scope` is also
`'engagement'` — the identical limitation `updateAssessmentResponse`
already has today (no function anywhere in this codebase yet
distinguishes Client Contributor from Consultant at the domain layer;
PRODUCT_UX_BLUEPRINT.md §22's own flagged, NON-BLOCKING gap). Closing
that fully is a broader, codebase-wide Permission-Matrix-completion
effort, out of this focused slice's scope — recorded here, not silently
left undocumented, mirroring R-131's own precedent for the identical
kind of deliberate, flagged scope limit.

### R-143 — Revising a locked Scope carries forward its prior decisions as the new draft's starting point, rather than resetting every Control to undecided (Slice D3)

**Decision:** `reviseEngagementScope` copies every `EngagementScopeControl`
decision/rationale/decider and every `ApplicabilityDetermination` (with
its RegulatoryReference links) from the previous, now-locked
`EngagementScope` into the new draft version.
**Rationale:** a genuine, considered extension beyond the literal
implementation brief, which specified the revision mechanism
(`previous_scope_version_id`, old version immutable) without specifying
whether the new draft starts blank or carries forward prior content.
Starting from a blank slate would silently discard a consultant's prior
work on every revision — every single Control would read "undecided"
again even though 23 of them were already decided identically the
previous round — inviting exactly the kind of confusion the "why is
this control applicable" auditability requirement (implementation
directive §12) exists to prevent, and making a "revision" indistinguishable
from "start over." Carrying forward matches the same spirit as D2's own
carry-forward mechanism for Processing Activities (DATA_MODEL.md §5.4)
— continuity by default, with the consultant free to change any
individual decision on the new draft afterward.

### R-144 — Maturity is computed once, atomically, per finalized Assessment — no draft-review workflow, no `discardDraftMaturityAssessment` (Slice M2)

**Decision:** `computeAndFinalizeMaturityAssessment` (lib/domain/maturity.ts)
performs the entire "insert MaturityAssessment as draft → insert every
MaturityScore → flip to finalized" sequence inside ONE `withRequestDb`
transaction, with all validation and arithmetic completed in memory
before the first INSERT. There is no separate `finalizeMaturityAssessment`
action, no human-reviewed standing draft state, and no delete/discard
path for a draft.
**Rationale:** M1.1's own finding (M1.1_MATURITY_FORMULA_INTEGRITY.md §1),
reaffirmed by the M2 approval itself (§3): `maturity_scores` carries no
UPDATE/DELETE grant at all — proven directly, not merely inferred, by
`tests/maturity/immutability.test.ts` rejecting a mutation attempt
against a still-draft score — and `maturity_assessments` carries no
DELETE grant either (migration 0015). A "compute, review, then either
discard or finalize" workflow is therefore not supported by the existing
schema and cannot be built without a new migration granting DELETE,
which would reopen exactly the kind of "how would a discarded draft be
distinguished from a legitimate one for audit purposes" question the
existing immutability posture was built to avoid. Since the whole
sequence is one atomic transaction, a failure at any point rolls back
before anything is durably written — there is never an orphaned draft
row to discard in the first place, so no discard mechanism is needed.

### R-145 — One `MaturityAssessment` per Assessment, enforced by a plain `UNIQUE(assessment_id)` constraint (Slice M2)

**Decision:** Migration 0029 adds `maturity_assessments_assessment_id_key`
— a single, unconditional UNIQUE constraint, not a partial/status-scoped
one. `computeAndFinalizeMaturityAssessment` also pre-checks for an
existing row and throws `MaturityAlreadyComputedError` before attempting
the insert, so the database constraint is a backstop, not the primary
signal.
**Rationale:** R-144's atomicity is what makes the plain (non-partial)
form correct: since a `MaturityAssessment` row can never durably exist
in `draft` status (any failure before finalization rolls back the whole
transaction, including the header's own INSERT), "at most one row per
`assessment_id`, ever" and "at most one finalized/active row per
`assessment_id`" are the same guarantee — there is no daylight between
them for a partial index to need to close. No supersession/versioning
column (e.g. a `previous_maturity_assessment_id`, mirroring `Risk.
previous_risk_id` or D3's `EngagementScope.previous_scope_version_id`)
was added — the M2 approval explicitly says not to introduce one unless
absolutely required, and it is not: a corrected maturity result is
obtained by finalizing a genuinely new Assessment (a real reassessment),
never by superseding a MaturityAssessment in place.

### R-146 — Unanswered eligible controls make a domain `incomplete` and abort the entire computation — never excluded from the denominator, never zero, never silently partial (Slice M2)

**Decision:** `classifyDomainScore` (lib/domain/maturity.ts) requires
every eligible (`applicable` or `undecided`, D3) control mapped to a
domain to resolve to a real, configured numeric rating. If even one does
not, the domain is `incomplete`; `computeAndFinalizeMaturityAssessment`
then throws `IncompleteMaturityDataError` (carrying per-domain eligible/
answered/unanswered counts and ids) BEFORE any row is written, and no
partial or approximate result is ever persisted. This applies per
domain, and any one incomplete domain blocks the OVERALL score too —
never computed from only the complete domains.
**Rationale:** the M2 approval's own explicit anti-gaming requirement
(§6/§7), confirmed by M1.1's own finding that this repository's
pre-existing `finalizeAssessment` has no completeness precondition — an
Assessment can genuinely finalize with eligible controls still
unanswered, making this a real, reachable state, not a hypothetical.
Excluding unanswered controls from the denominator (M1's own original,
now-superseded formula) would let an organisation improve its maturity
score by leaving the hardest controls unanswered; treating an unanswered
control as a numeric zero would fabricate a value the pinned
methodology's own `rating_scores` never actually assigned to
"unanswered." Refusing outright is the only option that neither
rewards omission nor invents data.

### R-147 — `not_scorable` (no mapped controls, or every mapped control is D3 `not_applicable`) is a different outcome from `incomplete`, and never blocks anything (Slice M2)

**Decision:** `classifyDomainScore` returns a distinct `not_scorable`
outcome (with `reason: "no_mapped_controls" | "all_not_applicable"`)
for a domain that has nothing to score at all — as opposed to
`incomplete`, reserved for a domain that HAS eligible controls but at
least one lacks a rating. A `not_scorable` domain gets no `MaturityScore`
row (never a fabricated zero) but does NOT abort the computation or
block the overall score — it simply never enters either side of the
weighted-average fraction.
**Rationale:** the M2 approval's own explicit requirement (§8) to
distinguish these cases: a domain with nothing genuinely in scope for
this Assessment is not "missing information" the way an unanswered
eligible control is — there is no decision an assessor could still make
that would change the outcome, so refusing the whole computation over it
would be overcautious in a way R-146's refusal for real incompleteness
is not. "Which domains are `not_scorable`" is derived purely from
already-decided facts (`MaturityDomainControlMapping`, and D3's own
frozen `applicability_decision` snapshot), never from an assessor's
future action.

### R-148 — Missing methodology, missing rating configuration, or a missing domain weight are all distinct, named failures — never a fabricated score, weight-of-1, or weight-of-0 (Slice M2)

**Decision:** `NoActiveMaturityMethodologyError` (no active
`MaturityScoringMethodology` for the tenant), `InvalidMaturityMethodologyDefinitionError`
(the active methodology's `definition.rating_scores` is missing or
malformed), and `MissingMaturityDomainWeightError` (a domain that would
otherwise be `scored` has no active `MaturityDomainWeight` for this
engagement) are each raised before any write. A rating value with no
entry in the pinned methodology's own `rating_scores` map is folded into
the same `incomplete` bucket as an unanswered control (R-146) rather
than a separate top-level failure, since from the domain's perspective
the effect is identical — no usable numeric input exists for that
control — but it is tagged internally (`reason: "unconfigured_rating"`)
so the error can still name the real cause.
**Rationale:** the M2 approval's own explicit requirement (§9/§13/§24):
"do not silently assign a value... fail safely rather than silently
treating [a missing weight] as weight 0 or 1." The methodology resolution
itself mirrors `createRisk`'s own established `RiskScoringModel`
resolution exactly (the tenant's single `is_active` row) — not a
mechanism invented for Maturity.

### R-149 — `maturity.compute` is a new, dedicated permission covering BOTH compute and finalize as one action — never a reuse of `assessment.finalize`/`scope.lock`, and no separate `maturity.finalize` (Slice M2)

**Decision:** `requireMaturityComputeAccess`/`canComputeMaturity`
(lib/authorization/service.ts) gate `computeAndFinalizeMaturityAssessment`
via the single new `maturity.compute` permission, seeded only to
Engagement Manager (`db/seed/roles.ts`). Migration 0030 narrows the
`maturity_assessments`/`maturity_scores` RLS write path from the
previously broad `can_access_engagement` (any active engagement member,
migration 0015) to the same permission, mirroring migration 0028's own
`scope.lock` narrowing of `engagement_scopes_update`.
**Rationale:** the M2 approval's own explicit instruction (§20) — a
dedicated permission, independently controllable from `assessment.
finalize`/`scope.lock` even though all three currently share an owner,
the same reasoning R-141 already established for `scope.lock` itself.
Unlike `scope.lock` (a genuinely separate action from `assessment.
finalize`), M2 §3 treats "compute" and "finalize" as one atomic action
with no separate human-review step (R-144) — so, unlike D3's
`scope.lock`/`assessment.finalize` split, there is no second capability
here needing its own permission.

### R-150 — Four new dedicated permissions (`validation.perform`, `risk.manage`, `finding.manage`, `evidence.review`) close the P2 self-validation/over-broad-write gap — granted only to Engagement Manager and Consultant (Slice P2A)

**Decision:** `createValidationRecord`, `createRisk`/`updateRiskStatus`,
`createFinding`/`updateFinding`, and `reviewEvidence` each now require a
dedicated permission (`lib/authorization/service.ts`'s new
`requireValidationPerformAccess`/`requireRiskManageAccess`/
`requireFindingManageAccess`/`requireEvidenceReviewAccess`), replacing
the broad `requireEngagementAccess` check (satisfied identically by any
`EngagementMembership`/`OrganisationMembership`, client-side roles
included) each of these functions used before P2A. All four permissions
are seeded (`db/seed/roles.ts`) only to Engagement Manager and
Consultant — not Auditor (PRODUCT_UX_BLUEPRINT.md §8's own pre-existing,
approved Permission Matrix gives "Reviewer" read-only access across
every one of these rows, pending the separate, not-yet-built
`QualityReview` workflow) and not any client-side role (Business
Owner/IT-CISO/Procurement/Legal/Client Administrator/Privacy
Officer/CXO), matching that same matrix's CV(-only)/no-write columns for
Risk/Finding/Validation. Migration 0031 narrows the matching RLS write
path (`risks_insert`/`_update`, `findings_insert`/`_update`,
`validation_records_insert`, `evidence_update`) to the same permissions,
mirroring migration 0030's own `maturity.compute` narrowing exactly.
**Rationale:** P2 discovery's own explicit finding (P2_FIRST_CUSTOMER_
WORKFLOW_DISCOVERY.md) — every one of these writes was reachable by a
client-side `EngagementMembership`/`OrganisationMembership` holder
identically to a consultant, most seriously letting a client validate
(self-approve) its own remediation. The P2A brief's own load-bearing
requirement: "a client must NOT be able to self-validate its own
remediation," resolved with the repository's own established dedicated-
permission pattern (D3's `scope.lock`, M2's `maturity.compute`) rather
than a new authorization framework or a new Client role.

### R-151 — `validation_records_update`, `RemediationAction.status = "validated"`, and Remediation writes generally are deliberately left untouched (Slice P2A)

> **Superseded in part by R-154 (Slice P2A.1):** the `RemediationAction.
> status = "validated"` portion of this decision was revisited and
> closed as a direct P2A follow-up — see R-154. `validation_records_
> update` and general `remediation_actions` writes are unaffected and
> this decision's reasoning for those two still stands.

**Decision:** P2A does not narrow `validation_records_update` (no
domain code writes through it — it exists only for a future, narrow
reassessment-trigger transition per its own migration 0013 comment;
`createValidationRecord`'s INSERT is the actual, and only, self-
validation vector, and that is what R-150 closes). It also does not
touch `remediation_actions_insert`/`_update` RLS, nor add a permission
check to `lib/domain/remediation.ts` at all — `updateRemediationAction`
still accepts `status = "validated"` from anyone with ordinary
engagement access, a second, narrower theoretical self-validation
surface distinct from `ValidationRecord` creation.
**Rationale:** the P2A brief's own explicit Part 4 instruction: "Do not
over-restrict client participation... CLIENT: provide remediation
information / evidence / completion input... Do not invent additional
lifecycle states." Closing `RemediationAction.status = "validated"` too
would require either inventing a new lifecycle state (a status a client
CAN set that isn't literally the string `"validated"`) or removing
client write access to `remediation_actions` generally, both explicitly
out of scope. This is a deliberate, documented, accepted P1 limitation
(mirroring D3's own R-142 precedent of naming a gap rather than silently
expanding scope) — not an oversight. See PROGRESS.md's "Known
limitations" for the tracked follow-up.

### R-152 — Evidence visibility (`consultant_internal`/`client_visible`) is now enforced server-side, auto-computed at upload time from the uploader's own `evidence.review` permission — never a client-supplied value (Slice P2A)

**Decision:** `uploadEvidence`/`createEvidenceForVersion` compute
`visibility` themselves — `consultant_internal` if the uploading user
holds `evidence.review` (i.e. is engagement/consultant staff),
`client_visible` otherwise — rather than accepting it as caller input.
Every read path that can return `consultant_internal` Evidence now
takes an explicit `canSeeInternal: boolean` parameter, computed once per
caller via `canReviewEvidence` and threaded through
(`getEvidenceSummaryForControl`/`ForRemediationAction`/
`ForValidationRecord`/`ForValidationRecords`), excluding
`consultant_internal` rows entirely from the returned set for a caller
who lacks it — never merely hidden by the UI. `getEvidenceDownloadUrl`
independently re-checks the same permission against the specific
`evidenceId` requested, BEFORE any signed URL is issued — the load-
bearing check, since it is the only path that returns retrievable file
bytes; a client cannot bypass it by supplying a different (correct)
evidence id, cross-tenant id, or cross-engagement id (all three
independently tested, `tests/app/authorization-hardening.test.ts`).
`evidence.review` is reused, not duplicated, as the read-side "may see
consultant_internal Evidence" signal — the same permission that lets
someone accept/reject an internal item is the one that lets them see it.
**Rationale:** the P2A brief's own Part 5, marked critical: "Do NOT
merely hide a UI element. Authorization must be enforced server-side. A
client must not be able to retrieve consultant-internal evidence by
changing an ID or URL." `evidence.visibility` has existed in the schema
since Milestone 6 but was never read by any query before this slice
(P2 discovery's own finding) — this closes that gap without adding a
new column or changing the enum.

### R-153 — `evidence_select` (and every other Evidence/Risk/Finding/RemediationAction SELECT RLS policy) is deliberately NOT narrowed by P2A (Slice P2A)

**Decision:** Migration 0031 narrows only `risks_insert`/`_update`,
`findings_insert`/`_update`, `validation_records_insert`, and
`evidence_update`. No SELECT policy is touched — `evidence_select`
included, which stays the same broad `can_access_engagement`/
`can_access_organisation` check it has always had. Evidence visibility
(R-152) is enforced at the application layer only.
**Rationale:** three independent reasons, each sufficient on its own:
(1) `db/schema/evidence.ts`'s own pre-existing schema comment already
documents `visibility` as deliberately not an RLS condition, a
Milestone-6-era decision this slice inherits rather than reverses; (2) a
broad SELECT-policy change carries meaningfully higher regression risk
than an INSERT/UPDATE narrowing — dozens of pre-existing tests across
`tests/evidence/`, `tests/app/evidence.test.ts`, and every Risk/Finding/
Remediation detail page read Evidence rows, and SELECT is the one policy
every one of them depends on; (3) the actually sensitive action — real
file-byte retrieval — runs entirely through `getEvidenceDownloadUrl`,
which R-152 already gates server-side before any signed URL is issued,
independently satisfying the P2A brief's own specific "cannot bypass by
changing ID" requirement without touching SELECT RLS at all. This is
consistent with the brief's own Part 7 instruction ("Do not weaken
existing SELECT policies") read together with Part 15's "use the
smallest migration possible" — RLS remains the backstop for every write
this slice narrows; it was never asked to become the mechanism for
visibility filtering specifically.

### R-154 — `RemediationAction.status = "validated"` now requires `validation.perform`, closing the second self-validation surface R-151 had deliberately left open (Slice P2A.1)

**Decision:** `updateRemediationAction` (`lib/domain/remediation.ts`) now
calls `requireValidationPerformAccess` whenever `input.status ===
"validated"`, in addition to its existing, unchanged
`requireEngagementAccess` check — the same `validation.perform`
permission `createValidationRecord` already requires (R-150), not a new
permission. Migration 0032 adds the matching RLS backstop: one extra
`WITH CHECK` condition on `remediation_actions_insert`/`_update` —
`status <> 'validated' OR has_engagement_permission(..., 'validation.
perform') OR has_organisation_permission(..., 'validation.perform')` —
layered onto the existing, unchanged, broad `can_access_engagement`
check rather than replacing it. Every other status value
(`open`/`in_progress`/`evidence_submitted`/`closed`), and every other
column on this table, is completely unaffected — a client retains full,
ordinary remediation participation, `"closed"` included.
**Rationale:** this is a direct, explicit follow-up (P2A.1) to P2A's own
final report, which flagged `RemediationAction.status = "validated"` as
a second, narrower self-validation surface distinct from the
`ValidationRecord`-creation vector P2A itself closed (R-150), and which
R-151 had at the time deliberately left untouched. Re-inspecting the
schema's own semantics resolved the P2A.1 brief's own "if the existing
schema semantics reveal that 'validated' is NOT actually intended to
mean consultant validation, STOP" condition: `validation-records.ts`'s
own header names `ValidationRecord` "the explicit consultant-validation
step between 'evidence submitted' and 'control reassessment'", and
DATA_MODEL.md §8's own five-value lifecycle name ("Open → In Progress →
Evidence Submitted → Validated → Closed") uses "Validated" as exactly
that same decision — so the two ARE the same concept under two
different names, and closing the gap is the correct action, not a
conflict to report. R-71's own established doctrine (`status` is a
plain, unconstrained application-layer state machine, not a database
state machine) is preserved for every value except this one: the fix
adds a permission requirement on a specific enum VALUE, not a general
lifecycle/transition constraint, and invents no new status. This
supersedes R-151's "deliberately left untouched" call for `status =
"validated"` specifically; R-151's OTHER decisions (`validation_records_
update` and general `remediation_actions` writes remain untouched)
still stand unchanged.
