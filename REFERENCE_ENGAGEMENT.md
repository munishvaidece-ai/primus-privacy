# PRIMUS PRIVACY — Reference/Demo Engagement Dataset

**Status:** built and verified (Session 28, 2026-09-02), Control
Library Authoring added (Session 29, 2026-09-02 — Slice D1). One
fictional, end-to-end consulting engagement — **ABC Fintech Private
Limited** / **DPDP Compliance Assessment — FY 2026–27** — built through
this repository's real application code wherever real application code
exists, and through a clearly-isolated raw fixture only where it does
not (Data Landscape/ROPA — Regulatory Content & Control Library
authoring moved from the raw-fixture side to the real-application side
in Slice D1, see below). This document is the honest record of what
worked, what didn't, and why — not a marketing description of the
fixture.

Session 28 (the original exercise) was **not a new product feature** —
no code changed the product's own capabilities, only demonstrated and
documented its existing gaps. Session 29 (Slice D1) **is** a real,
focused product slice: it built the Control Library Authoring
capability the Session 28 exercise found missing, closing exactly the
one gap this document's own "highest-priority gaps" ranking named
first. Every OTHER gap this document names remains exactly as Session
28 found it — this slice was deliberately scoped to Control Library
Authoring alone, per explicit instruction.

## Where this lives

- `lib/domain/control-library.ts` (new, Slice D1) — the Control Library
  Authoring domain module: create/edit/delete Controls, create
  Regulatory References/Requirements, associate Controls with
  Requirements, publish a draft version, and clone a published version
  into a new draft. See `DECISIONS.md` for the full authorization/
  versioning/tenant-isolation reasoning.
- `app/(shell)/methodology/**` (new, Slice D1) — the Methodology UI:
  `/methodology`, `/methodology/control-library` (list, create,
  version detail, controls, publish, clone), `/methodology/
  regulatory-content` (references/requirements).
- `tests/app/reference-engagement-fixture.ts` — the builder
  (`buildReferenceEngagement()`). Two layers, kept deliberately
  distinct: raw SQL (via `asFixtureSetup`, a superuser connection) for
  the identity/bootstrap layer no application code can create at all
  (Tenant, Users — this product has no sign-up flow) and for the one
  remaining area with real database schema but zero application layer
  (Data Landscape/ROPA); real domain functions (via `withRequestDb`)
  for everything the application layer actually implements
  (Organisation, Engagement, Engagement Membership, Regulatory
  Reference, Requirement, Control Library Version, Control, Control-
  Requirement association, Assessment, Assessment Response, Control
  Test, Evidence, Risk, Finding, Remediation, Validation, Engagement
  Report). Since Slice D1, the demo Control Library itself is built
  entirely through the real domain layer — see "Control Library
  Authoring (Slice D1)" below.
- `tests/app/reference-engagement.test.ts` — the walkthrough: builds
  the fixture once, then asserts each of the 16 stages below against
  real PostgreSQL, real domain-function return values, and (for the
  final stage) the actual generated PDF's real, parsed text.
- Run it: `npx tsx scripts/reset-test-db.ts && npx vitest run
  tests/app/reference-engagement.test.ts` (or via `npm run test:app`/
  `npm run test:db`, which include it automatically). Fully reproducible
  — every run starts from a freshly reset, empty test database.

### Why a Vitest test file, not a standalone seed script

Every `lib/domain/*` module begins with `import "server-only"`. The
real `server-only` npm package unconditionally throws when imported
outside a Next.js/webpack bundle (confirmed by reading
`node_modules/server-only/index.js` directly) — a plain `tsx` script
cannot import a single domain function. The only place in this
repository real domain functions are ever exercised outside the actual
Next.js server is Vitest, via `tests/shims/server-only.ts`'s alias
(`vitest.config.ts`). Rather than inventing a second mechanism for this
fixture, it reuses that exact, pre-existing one — which also means it
satisfies "run repeatedly / reset cleanly / used in automated tests"
for free, with the repository's own existing tooling, not a new one.

## What the fixture contains

- **Tenant:** "PRIMUS Reference Demo Practice (Synthetic Data)" — two
  users, "Ananya Krishnan" (lead, becomes Engagement Manager by the
  same auto-onboarding grant every real Engagement creator gets) and
  "Rohan Verma" (a second Consultant, added through the real
  membership-management path, Slice C7.2).
- **Organisation:** "ABC Fintech Private Limited" (fictional; created
  via the real `createOrganisation` domain function).
- **Engagement:** "DPDP Compliance Assessment — FY 2026–27",
  `annual_assessment`, period 2026-04-01 – 2027-03-31 (created via the
  real `createEngagement` domain function).
- **Control Library:** "DPDP Demo Control Library v1.0" — clearly
  labeled SAMPLE/DEMO, never an official or verified regulatory
  framework; 25 original controls (never a statutory quotation) across
  the 12 categories named in the brief, each linked to one of 12
  Requirements, each citing one clearly-labeled illustrative
  RegulatoryReference. Since Slice D1, built entirely through the real
  `lib/domain/control-library.ts` domain functions — `createRegulatory
  Reference`, `createRequirement`, `createControlLibraryVersion`,
  `createControl`, `associateControlRequirement`, `publishControlLibrary
  Version` — the exact functions a real Practice Partner would call
  from `/methodology`, not raw SQL. Published through the real, trigger-
  enforced publish workflow (migration 0007) — re-verified live by
  attempting both a domain-layer edit and a raw SQL edit of a published
  Control and confirming both independently reject it.
- **Data Landscape / ROPA:** 3 Business Units, 4 Systems, 3 Data
  Stores, 3 Processors (one deliberately without a DPA, matching a real
  Finding below), 10 Purposes, 8 Personal Data Elements, 4 Data
  Principal Categories, and the ten Processing Activities the brief
  itself names (Customer onboarding, KYC verification, Customer account
  management, Transaction processing, Customer support, Marketing
  communications, Employee HR administration, Recruitment, Vendor
  management, Grievance handling), each linked to a realistic subset of
  the master data above through the real version-pinned junction
  tables.
- **Assessment:** one, `annual`, kept `draft` (not finalized) — 25
  AssessmentControls auto-populated from the pinned library.
- **Assessment Responses:** 18 of 25 controls responded (a realistic
  mixture of `implemented`/`partially_implemented`/`not_implemented`/
  `not_applicable`), 7 deliberately left unresponded.
- **Control Tests:** 6, across 5 methodologies (Policy review,
  Configuration review ×2, Evidence review, Interview, Sample testing),
  results `pass`/`fail`/`exception_noted` all exercised.
- **Evidence:** 9 items, all four `EvidenceLink` subject types
  exercised (`assessment_response`, `control_test`,
  `remediation_action`, `validation_record`); every title ends
  `(SAMPLE)`, every file's own content states plainly it is a synthetic
  demo document, not a real one.
- **Risks:** 6, inherent ratings low→critical, statuses
  open/mitigating/accepted all exercised.
- **Findings:** 7, severities low→critical, statuses
  open/in_progress/accepted all exercised, all traceable to a source
  Risk.
- **Remediation Actions:** 8, across two different owners, priorities
  low→critical, statuses open/in_progress/closed all exercised.
- **Validation Records:** 2 — one `accepted` (a genuinely closed,
  verified remediation), one `rejected` (deletion evidence incomplete;
  the RemediationAction was then manually reopened as a separate,
  explicit action — never automatic, matching this codebase's own
  documented posture).
- **Engagement Report:** generated for real (Slice R1) — an 11-page PDF
  reflecting every figure above, manually inspected page-by-page
  (`pdftoppm`).

## Control Library Authoring (Slice D1)

The one gap this document's own "highest-priority gaps" ranking (below)
named first — resolved in a dedicated, focused product slice, not as
part of extending the reference dataset further.

**Ownership, preserved unchanged:** Tenant/practice-owned (verified by
direct inspection — every methodology table carries `tenant_id`
directly, migration 0007 — never `organisation_id`). No new ownership
model was invented.

**Lifecycle, the existing one, not a new one:** Draft → add/edit
Controls → associate Requirements → Publish → immutable. Correction
path: Published → "Create New Version" (clones Controls + associations
into a new draft, never duplicates Requirements/RegulatoryReferences,
DECISIONS.md R-43) → Edit → Publish. Every transition rule (draft ⇄
published ⇄ retired, what may/may not change at each state) was
already fully built and enforced at the database layer since Milestone
4 (migration 0007) — this slice's own domain functions
(`lib/domain/control-library.ts`) are the first authorized front door
onto writes the database already knew how to accept or reject; no
second versioning mechanism was created.

**Authorization:** a new `methodology.manage` permission (not a
generic "admin" bypass), granted to Platform Administrator and Practice
Partner — resolved from PRODUCT_UX_BLUEPRINT.md §8's own Permission
Matrix (the "Methodology" row's "Tenant" column = full Read/Create/
Edit/Finalize, mapped by the same table's own legend to exactly those
two roles) rather than invented. Enforced in both layers: the
application/domain layer (`requireMethodologyManageAccess`) and RLS
(migration 0026's `has_tenant_permission` resolver, narrowing the six
methodology tables' write policies from "any Tenant member" to "a
Tenant member whose Role grants `methodology.manage`" — the same
narrowing precedent Slice C7.3 established for `assessment.finalize`).
Read access is intentionally left at its existing, broader,
unnarrowed `can_access_tenant` RLS boundary — this slice's scope is
authoring (write), not read-tiering.

**Tenant isolation:** every write function re-derives the authoritative
tenant from the target row itself (never a caller-supplied id);
Tenant A cannot read, write, or associate against Tenant B's
methodology — verified directly at the RLS/database boundary
(`tests/app/control-library-authoring.test.ts`), not merely at the
application layer.

**Assessment compatibility, the critical acceptance criterion:**
verified directly — an existing Assessment created against a published
Control Library Version keeps its exact pinned version and its exact
already-populated `AssessmentControl` rows after a NEW version is
cloned from and published alongside it; the Engagement's own pin
remains immutable (a second pin attempt is rejected by the pre-existing
migration 0007 trigger); a cloned Control is a genuinely new row,
never reachable from the original Assessment.

**Tests:** `tests/app/control-library-authoring.test.ts` (new, 25
tests) — authorization (6: authorized/unauthorized/client-side/cross-
tenant), draft lifecycle (5), publishing (4), versioning (3),
Assessment integrity (1, the acceptance-criterion scenario above), and
tenant isolation (3, including two direct raw-SQL RLS checks and one
anonymous-caller check) — plus the reference-engagement fixture itself
now exercising the full authoring path as its own real, non-test-only
"production" use.

## Gap Matrix

Recorded from actually attempting each stage against real PostgreSQL —
never inferred from "a table exists." `Database Support` is marked YES
only where a real insert respecting every real constraint/trigger
succeeded (or, for Applicability/Scope, where a real query proved the
table doesn't exist at all).

| Workflow Stage | Database Support | Application Support | End-to-End Verified | Gap |
|---|---|---|---|---|
| Organisation | YES | YES | YES | None |
| Engagement | YES | YES | YES | None |
| Data Landscape (master data) | YES | NO | NO | No domain module, no UI. Real SCD2 schema (identity + version tables, "one current per identity") works correctly, exercised only via raw SQL fixture helpers, never a real user action. |
| ROPA / Processing Activities | YES | NO | NO | Same gap as Data Landscape — `ProcessingActivity` and its six version-pinned junction tables (Milestone 3) have no domain module and no route (`/data-landscape` does not exist in `app/`). |
| Applicability / Scope | NO | NO | NO | Not built at any layer. DATA_MODEL.md §4 documents `ApplicabilityDetermination`/`ApplicabilityDeterminationRegulatoryReference`; neither table exists — confirmed by a real query against it failing with "relation does not exist," not by inspection alone. |
| DPDP Controls (Regulatory Content & Control Library) | YES | **YES** | YES | **None (Slice D1).** `lib/domain/control-library.ts` + `/methodology/**` — a Platform Administrator/Practice Partner can create/edit/publish/clone the control library and author regulatory content entirely from the running application; verified directly against real PostgreSQL, including the Assessment-pinning acceptance criterion. |
| Assessment | YES | YES | YES | None |
| Control Testing | YES | YES | YES | None |
| Evidence | YES | YES | YES | None |
| Risk | YES | YES | YES | None |
| Findings | YES | YES | YES | None |
| Remediation | YES | YES | YES | None |
| Validation | YES | YES | YES | None |
| Maturity | YES | NO | NO | Storage/RLS/immutability real (Milestone 8/8A), but no calculation engine anywhere — confirmed from the repository's own test fixture helper (`tests/maturity/helpers.ts`'s `createMaturityScore`), which takes `score`/`maturityLevel` as direct caller-supplied inputs, proving no computation logic exists even at the database trigger level. This fixture deliberately writes zero Maturity rows — any score would be fabricated data. |
| Reporting | YES | YES | YES | None (Slice R1). Correctly omits Maturity and ROPA/Data Landscape sections even though this reference Engagement has real data for both — re-verified this session (report text contains no "maturity"/"data landscape"/"ROPA" section). |
| Client Portal | NO | NO | NO | Not built at any layer. Out of scope for this task and for R1 alike. |

## End-to-end status

A consultant using only the running application (no database script, no
developer intervention) can today take a real engagement from
**Organisation creation, through authoring the DPDP Control Library
itself, through Assessment → Control Testing → Evidence → Risk →
Finding → Remediation → Validation → Engagement Report — entirely
inside PRIMUS.** Slice D1 closed the one link in that chain that still
required a developer: a Platform Administrator or Practice Partner can
now draft, populate, and publish a real control library version (and
create the Regulatory References/Requirements it associates with)
before a Consultant ever opens an Assessment against it. Re-confirmed
here against a substantially larger, more varied fixture than any
single prior slice's own tests used (25 controls, 6 risks, 7 findings,
8 remediation actions, 9 evidence items).

They **still cannot**, from inside the running application: build a
Data Landscape/ROPA record of the client's processing activities,
record a formal Applicability/Scope determination, or compute a
Maturity score. Every one of these three remaining gaps was already
true before Session 28's exercise and remains true after Slice D1 —
deliberately: this slice's own instructions scoped it to Control
Library Authoring alone.

## Highest-priority gaps for a first real consulting engagement

Ranked by what most blocks PRIMUS from delivering a complete first real
engagement, given the loop itself (Control Library → Assessment → Risk
→ Finding → Remediation → Validation → Report) now works end to end,
Control Library Authoring having been resolved by Slice D1:

1. **Data Landscape / ROPA.** Now the top-ranked remaining gap. The
   brief's own workflow, and DATA_MODEL.md §5, treat this as the
   natural first-conversation deliverable with a client (what data do
   you process, where, why) — the schema is ready and well-designed;
   only the application layer is missing.
2. **Applicability / Scope.** Genuinely unbuilt at the schema level, not
   just the application level — the smallest in raw effort (one new
   table plus a junction), but the one with no existing database
   foundation to build on at all.
3. **Maturity.** The one area where even the *scoring model* has never
   been designed (no algorithm, no domain reasoning) — the largest,
   least-defined gap, and correctly the one this task's own instructions
   forbid starting without further explicit direction.
4. **Client Portal.** Deliberately last — nothing above depends on it,
   and PRODUCT_SPEC.md/PRODUCT_UX_BLUEPRINT.md both treat it as a later
   phase once the consultant-side loop is solid, which it now is.

See `PROGRESS.md`'s "Reference Engagement Dataset" and "Control Library
Authoring" sections, and `DECISIONS.md` R-127 through R-132, for the
full session record.
