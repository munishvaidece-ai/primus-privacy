# PRIMUS PRIVACY — Architectural Decisions

Status: Draft v0.5 (Session 5 / Milestone 2, 2026-09-01: added R-25
through R-31, recording implementation decisions made while building the
Client Master Data database layer — see PROGRESS.md for the milestone
report. D-01/D-02 remain RESOLVED from Session 2; R-16 through R-24 from
Sessions 3-4 stand unchanged). This log records
material architectural decisions and
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
