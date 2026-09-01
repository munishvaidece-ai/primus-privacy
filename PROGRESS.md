# PRIMUS PRIVACY — Progress Log

Status: 2026-09-01 — Session 3 (architecture validation continued: fresh
consistency pass over the Session 2 resolution; still no application code).

## Session 3 — Continued Architecture Validation (2026-09-01)

**What happened:** resumed from the Session 2 state (working tree clean,
two commits already on `claude/primus-privacy-architecture-39p3gh`) to
finish the requested consistency work, rather than redo D-01/D-02 from
scratch. Re-read all five architecture documents from disk (not from
memory) and checked them line by line against each other and against the
FY2026→FY2027 scenario, rather than re-asserting the Session 2 report's
conclusions unverified. This found and fixed six real inconsistencies:

1. `DATA_MODEL.md` §1 used `client_id` in the general naming convention
   while every entity table elsewhere used `client_org_id` — fixed to
   match (and to also name `tenant_id` explicitly as the second
   tenant-scoping column, per §2/§12).
2. `ARCHITECTURE.md` §3's layers diagram still described the
   Authorization/Policy layer as resolving only `EngagementMembership`,
   left over from before the Session 2 Tenant/Organisation/Engagement
   membership model — fixed.
3. `SECURITY.md` §14's threat table named only `EngagementMembership` in
   the privilege-escalation mitigation row — fixed to name all three
   membership scopes.
4. **A genuine, if minor, gap against this session's explicit "historical
   data cannot be silently rewritten by current-state changes" check:**
   `RiskScoringModel` and `MaturityDomainWeight` were described as
   "versioned"/"configurable" without ever stating the append-only /
   frozen-per-engagement discipline already applied to
   `ControlLibraryVersion` and the D-02 master-data mechanism. An in-place
   edit to either would have silently changed the documented basis for
   already-scored risks or already-computed maturity snapshots. Closed by
   making both explicitly append-only/frozen (DATA_MODEL.md §8–§9,
   DECISIONS.md R-16) — `Risk` and `MaturityScore` already stored
   computed-once values, so no other structural change was needed, only
   the explicit rule.
5. `PRODUCT_SPEC.md` (not one of the five named documents, but checked for
   overall consistency) used "tenant" informally to mean "client" in
   several places predating the Session 2 `Tenant` entity, which now
   conflicts with the resolved model — fixed §2/§4/§5 wording.
6. `README.md` and `ROADMAP.md` (same) still described D-01/D-02 as open
   items shaping the first migration, and used "tenant" loosely in two
   more places — fixed.

No new DECISION REQUIRED items were raised — the one gap found (#4) was
closable by engineering judgment (applying a pattern the schema already
uses elsewhere, consistently), not a new product/business ambiguity.

No database migrations, application scaffolding, or code were created —
this session remained architecture validation only, per explicit
instruction.

## Session 2 — Architecture Validation (2026-09-01)

**What happened:** the product owner reviewed the Session 1 report and
issued explicit direction resolving both blocking decisions:

- **D-01 (tenancy):** multi-tenant from Day 1 via a new `Tenant` entity;
  exactly one `Tenant` row in the MVP deployment; no white-label,
  multi-practice admin UI, billing, or branding functionality built now.
- **D-02 (data-landscape persistence):** a client-level master-data tier
  (Business Units, Data Principal Categories, Personal Data Elements,
  Purposes, Systems, Data Stores, Processors) versioned via
  Slowly-Changing-Dimension Type 2, referenced by version-pinned junctions
  from engagement-scoped assessment objects (Processing Activity, Data
  Flow, Assessment, Evidence, Risk, Finding, Remediation, DPIA, AI Use
  Case, Maturity Assessment, Quality Review).

Both are now marked **RESOLVED** in `DECISIONS.md` (with the original
framing kept for record), and `DATA_MODEL.md`, `ARCHITECTURE.md`, and
`SECURITY.md` were updated to reflect the resulting model. No database
migrations, application scaffolding, or code were created — this session
remained architecture validation only, per explicit instruction.

**Architecture consistency review** — performed against the updated
model, as required before this session could report the architecture
ready for implementation:

| # | Check | Result |
|---|---|---|
| 1 | Every entity relationship still makes sense | Pass — `Tenant` added as a clean new outer layer; `Organisation` simplified to client-only; master/engagement split is a clarification of §5, not a contradiction of §2–§4 or §6–§10, which are unchanged. |
| 2 | Tenant isolation works with the new Practice/Tenant layer | Pass — `tenant_id` on `User`/`Organisation`, checked at both RLS and application layers, as the outermost of three nested boundaries (SECURITY.md §3). |
| 3 | Engagement isolation works | Pass — unchanged from Session 1: `EngagementMembership` remains the primary content-access boundary; engagements do not see each other. |
| 4 | Historical assessment state is preserved | Pass — confirmed by the FY2026/FY2027 worked example (DATA_MODEL.md §5.5): FY2026's `ProcessingActivity` row and its version-pinned junctions are untouched by FY2027's carry-forward, master-data edits, or the processor swap. |
| 5 | Processing Activity remains the central privacy object | Pass — unchanged; still the hub every Data-Landscape junction connects through, now engagement-scoped with a `carried_forward_from_id` chain rather than a mutable cross-engagement row. |
| 6 | ROPA remains a view/workflow over Processing Activities, not a duplicated dataset | Pass — an engagement's ROPA is a query over that engagement's `ProcessingActivity` rows and their (now version-pinned) junctions; no new ROPA-specific table was introduced. |
| 7 | Data Inventory remains a view over the underlying Personal Data model | Pass, with a documented nuance (DATA_MODEL.md §5.5): "current" Data Inventory can be read two ways — the client-wide `PersonalDataElement` master taxonomy (engagement-independent), or the latest engagement's actual in-use elements (via its junctions) — both are queries, neither is a new duplicated table. |
| 8 | Processor Register remains a view over Processor objects and their engagement relationships | Pass — current register = `Processor` identity + current `ProcessorVersion`, joined to whichever engagements currently reference it via `ProcessingActivityProcessor`; history per engagement is the version-pinned junction, not a duplicated register. |
| 9 | Risk, Finding, and Remediation remain independently identifiable objects | Pass — unchanged; still engagement-scoped, first-class tables with their own junctions (§8 of DATA_MODEL.md untouched by this session). |
| 10 | Assessment results are versioned/historically preserved | Pass — unchanged mechanism (`Assessment.previous_assessment_id`, finalize-then-immutable `AssessmentResponse`); unaffected by the master-data change since Assessment was already engagement-scoped. |
| 11 | Maturity calculations are reproducible for a historical assessment | Pass — `MaturityScore` was already an immutable, timestamped snapshot with `computed_from_control_test_ids`; those control tests trace to a specific `Assessment`, which traces to specific version-pinned Data-Landscape facts as of that engagement — the full chain is now reproducible end-to-end, including the client-fact layer that was previously unaddressed. |
| 12 | Evidence remains securely scoped to the appropriate tenant/client/engagement | Pass, with one deliberate, documented change: `Evidence.engagement_id` is now nullable (`client_org_id` is the always-required scope) so evidence can attach to a master-data version directly (DECISIONS.md R-14) — tenant/client scoping is never optional, only the engagement association is. |
| 13 | Client-visible and consultant-internal information remains appropriately separated | Pass — the `visibility` mechanism (Notes, Evidence) is untouched by this session; it applies identically regardless of whether the subject is engagement-scoped or master data. |

All 13 checks pass against the model as written. This is a documentation-level
consistency review, not a runtime test — there is no running system yet
to test against; see "What Has Not Been Implemented" below.

## What Has Been Completed

**Session 1:**
- Repository inspected: confirmed genuinely empty at session start (no
  commits, no branches other than the working branch, no files besides
  `.git/`). Nothing pre-existing was at risk of being overwritten.
- Product, architecture, data model, security, roadmap, and decisions
  documented from the brief:
  - `PRODUCT_SPEC.md` — vision, users, core workflow, MVP / non-MVP scope.
  - `ARCHITECTURE.md` — layers, major components, tenancy model, security
    boundaries, data flow, external services, deployment model.
  - `DATA_MODEL.md` — full conceptual entity/relationship model, including
    junction tables and enums beyond the brief's initial entity list,
    with explicit cardinality and versioning/audit conventions.
  - `SECURITY.md` — authentication, authorization, tenant isolation,
    evidence/document security, audit logging, secrets, input validation,
    rate limiting, database constraints, backups, monitoring, threat
    considerations.
  - `ROADMAP.md` — MVP (one complete engagement workflow), Phase 2, Phase 3.
  - `DECISIONS.md` — 6 items marked **DECISION REQUIRED** (multi-practice
    tenancy, Data-Landscape persistence across engagements, data
    residency, individual data-principal PII/DSR scope, malware scanning,
    billing model), plus 9 recorded implementation decisions with
    rationale.

**Session 2:**
- D-01 and D-02 resolved per explicit product-owner direction and recorded
  in `DECISIONS.md`.
- `DATA_MODEL.md` §2 (Identity & Tenancy) and §5 (Data Landscape) rewritten
  to the two-tier (Tenant→Organisation→Engagement; client master data vs.
  engagement-scoped assessment objects) model, plus a worked example
  (§5.5) proving the mechanism against the product owner's FY2026/FY2027
  test scenario; §7, §11, §12, §13 updated for consistency.
- `ARCHITECTURE.md` §4 (Major Components) and §5 (Tenancy Model) rewritten;
  §6–§7, §10 updated for consistency.
- `SECURITY.md` §2 (Authorization) and §3 (Tenant Isolation) rewritten for
  the three-scope membership model (Tenant/Organisation/Engagement); §6
  updated.
- 13-point architecture consistency review performed and recorded above —
  all 13 pass against the documented model.
- 6 new recorded decisions added to `DECISIONS.md` (R-10 through R-15)
  covering the `Tenant` entity, the new membership scopes, the SCD2
  master-data mechanism, `AIUseCase` scoping, `Evidence.engagement_id`
  nullability, and the non-blocking Notice/Retention/Consent question.

**Session 3:**
- Re-verified (not re-asserted) the Session 2 resolution by re-reading all
  five architecture documents from disk and cross-checking entity
  names/relationships line by line, plus `PRODUCT_SPEC.md`, `README.md`,
  and `ROADMAP.md` for terminology drift against the new `Tenant` model.
- Found and fixed 6 inconsistencies (listed above under Session 3's own
  entry) — a naming slip, two stale pre-Session-2 wording leftovers, and
  one genuine historical-integrity gap (`RiskScoringModel`/
  `MaturityDomainWeight` now explicitly append-only/frozen-per-engagement).
- Added `DECISIONS.md` R-16 recording the gap and its fix.
- Re-confirmed the FY2026→FY2027 worked example (DATA_MODEL.md §5.5)
  against the exact scenario restated in this session's instructions —
  unchanged from Session 2's walk-through, still holds.
- No new DECISION REQUIRED items were needed.

## What Has Not Been Implemented

Everything else. Specifically, none of the following exist yet:

- No `package.json`, no Next.js project scaffold, no dependencies
  installed.
- No database schema, no migrations, no RLS policies.
- No authentication integration.
- No application code, no pages, no components, no API routes.
- No Supabase project has been provisioned or connected.
- No tests (none to run yet — none claimed).
- No CI/CD configuration.

This is by design for this session: the brief explicitly calls for
architecture and repository preparation only, with application code,
screens, and migrations deliberately withheld until the data model is
sound and open decisions are resolved.

## Current Architectural Status

- Conceptual data model is complete and internally consistent across the
  six documents (entity names and relationships match between
  `DATA_MODEL.md`, `ARCHITECTURE.md`, and `SECURITY.md`), now including the
  `Tenant` layer and the master/engagement-scoped data-landscape split.
- Technology stack is selected and justified (`ARCHITECTURE.md` §2):
  Next.js + TypeScript + PostgreSQL + Supabase + Tailwind + shadcn/ui +
  Vercel, with Drizzle proposed (not yet adopted/installed) for
  schema-as-code.
- **D-01 and D-02 are resolved** (Session 2) — the two items that were
  previously load-bearing for the first schema migration no longer block
  it.
- Four DECISION REQUIRED items remain open (`DECISIONS.md`): **D-03**
  (data residency) blocks provisioning the first real Supabase project but
  not further documentation/design work; **D-04** (individual
  data-principal PII/DSR scope) does not block the first migration (the
  master-data tier is category-level only, as already assumed) but should
  be resolved before any DSR-adjacent feature is designed; **D-05**
  (malware scanning) and **D-06** (billing model) are Phase 2/3 items,
  correctly deferred.
- The architecture is now considered **ready for the first migration**,
  covering `Tenant`, `Organisation`, `User`, `Role`/`Permission`,
  `TenantMembership`/`OrganisationMembership`/`EngagementMembership`, and
  `Engagement` — conditional on D-03 (data residency) being resolved
  before a real Supabase project is provisioned, since that decision picks
  the project's region, not its schema.

## Next Approved Implementation Step

None yet — this session remained architecture validation only, per
explicit instruction ("do not implement yet"). The recommended next step,
pending explicit go-ahead from the product owner, is:

1. Resolve D-03 (data residency) — required before provisioning a real
   Supabase project, not before further schema design.
2. Scaffold the Next.js + TypeScript project (no business logic yet).
3. Provision a Supabase project (region per the D-03 resolution) for
   local/staging development.
4. Write the first migration covering `DATA_MODEL.md` §2–§3 (Tenant
   through Engagement Structure) with RLS policies for the new
   Tenant→Organisation→Engagement layering, and prove tenant isolation
   *and* organisation isolation *and* engagement isolation with tests
   before building anything on top of it.
5. As a second migration (not the first, to keep each migration
   reviewable): the client master-data tier (§5.1) and its version-pinned
   junction pattern, proven against a scenario mirroring the FY2026/FY2027
   worked example (§5.5) before any UI is built on top of it.

No further work should proceed without confirmation from the product
owner.
