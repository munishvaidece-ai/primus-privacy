# PRIMUS PRIVACY — Architectural Decisions

Status: Draft v0.1. This log records material architectural decisions and
their rationale, in the order they were made. Items requiring a human
product/business decision that cannot be safely inferred from the brief are
marked **DECISION REQUIRED** and are not assumed — implementation should
not proceed past the point where a DECISION REQUIRED item would materially
change the shape of the work, without that decision being made.

---

## DECISION REQUIRED items

### D-01 — Is PRIMUS the only consulting practice this platform will ever serve?

**Question:** Is the platform single-practice (PRIMUS is always the one
operator, modeled as a singleton `Organisation` of type `PRACTICE`), or
must the architecture support multiple, mutually isolated consulting
practices (white-label / multi-practice SaaS) in the future?

**Why it matters:** if multi-practice is a real future requirement,
"Practice" needs to become its own tenancy dimension (practices isolated
from each other, not just clients isolated from each other), which changes
the `Organisation` model, the authorization layer, and the control-library
ownership model (§6/§12 of DATA_MODEL.md) materially. Retrofitting this
later is possible but costly; it's cheap to decide now.

**Current assumption (not yet confirmed):** single-practice. The data
model in DATA_MODEL.md is built this way. Flagged Phase 3 in ROADMAP.md,
pending this decision, if it turns out to be needed at all.

### D-02 — Do Data-Landscape objects persist across engagements, or are they engagement-local?

**Question:** For a returning client with multiple engagements over time
(PRODUCT_SPEC.md §5 example: FY2026 readiness, FY2027 annual assessment,
FY2027 DPIA programme), is `ProcessingActivity` (and everything connected to
it) a **living record** that carries forward and gets refreshed each
engagement, or a **snapshot re-created per engagement**?

**Why it matters:** this is the single biggest lever on both "one source of
truth" and "historical engagements must not be overwritten" — and those two
principles pull in different directions here. A living record risks a
later engagement's edit silently altering what an earlier, finalized
engagement's assessment was based on. A per-engagement snapshot risks
exactly the duplicated-data problem principle 1 warns against, and makes
"has this processing activity changed since last year" hard to answer.

**Recommended default (not yet confirmed):** engagement-scoped
`ProcessingActivity` rows, linked via `Engagement.previous_engagement_id`,
with an explicit "carry forward from prior engagement" action that copies
(not references) the prior engagement's data-landscape rows into the new
engagement as a starting point a consultant then edits. This keeps every
finalized engagement's picture immutable while still making
period-over-period comparison possible (diffing two engagements'
snapshots). This is what DATA_MODEL.md currently assumes; it is a
recommendation, not a decision, until confirmed.

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
