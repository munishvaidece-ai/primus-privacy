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
  tables. Since Slice D2, built entirely through the real
  `lib/domain/master-data.ts`/`lib/domain/processing-activities.ts`
  domain functions — the exact functions a real consultant would call
  from `/organisations/[id]/master-data/[category]` and
  `/organisations/[id]/engagements/[id]/data-landscape` — not raw SQL.
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

## Data Landscape / Processing Activities / ROPA (Slice D2)

The gap this document's own "highest-priority gaps" ranking named first
after Slice D1 — resolved as its own focused slice, per the same
discipline as D1.

**Ownership, derived from the repository, not invented:** DATA_MODEL.md
§5.1/§5.2, the existing schema, and the existing SCD2 pattern together
draw one boundary, and it is preserved exactly: **Business Units,
Systems, Processors, Data Stores, Purposes, Personal Data Elements, and
Data Principal Categories are Organisation-level master data** —
persistent client facts, reusable across every engagement, six of the
seven versioned (SCD2: identity row + append-only version history,
Business Unit deliberately not — DATA_MODEL.md §5.1/§5.3's own
carve-out). **Processing Activity, and its six version-pinned junctions
to that master data, are Engagement-level** — created fresh per
engagement, never mutated by a later one, with `carried_forward_from_id`
as the explicit, non-destructive continuity mechanism across engagements
(DATA_MODEL.md §5.4). `lib/domain/master-data.ts` and
`lib/domain/processing-activities.ts` are two separate domain modules
precisely because the two entity families sit at two different scopes —
not a stylistic split.

**Versioning / historical integrity, the critical acceptance
criterion:** no second SCD2 mechanism was built. The six versioned
master-data entities keep using the exact identity+version+trigger model
migrations 0002/0003 already implemented (a version table has no UPDATE
grant at all — the only way to change what a version says is to create
a new one). A Processing Activity's link to a piece of master data pins
BOTH the identity id and the specific version id that was current at
the moment of linking (migration 0004's version-pinned junctions,
already built) — proven directly in this slice's own testing: changing
a System's current version *after* a Processing Activity has linked to
it leaves that Processing Activity's own resolved detail unchanged
(still showing the old version's name), while a fresh read of the
System's own master-data list correctly shows the new current version.
Carrying a Processing Activity forward into a new engagement creates a
new row and re-resolves every link to each entity's then-current
version, without touching the source engagement's row or its own pins —
also verified directly, reproducing DATA_MODEL.md §5.5's own worked
FY2026→FY2027 scenario.

**Authorization:** no new permission was introduced. Master data write
access is `requireOrganisationAccess` and Processing Activity/junction
write access is `requireEngagementAccess` — the SAME broad
organisation-/engagement-membership checks migrations 0003 and 0005's
own RLS policies already used for these exact tables (`can_access_
organisation`/`can_access_engagement`, no narrower permission), and the
same shape PRODUCT_UX_BLUEPRINT.md §8's Permission Matrix specifies for
"Client Master Data" and "Processing Activities / ROPA" (Consultant:
plain Read/Create/Edit via membership, no dedicated permission column —
unlike Methodology, which is genuinely Tenant-scoped and DID need
`methodology.manage` in Slice D1). Introducing a new permission here
would have been inventing a boundary the repository's own evidence does
not call for.

**Tenant isolation:** every write function re-derives the authoritative
organisation/engagement from the target row itself (never a
caller-supplied id); a forged `organisationId`/`engagementId`, or a
reference to another organisation's master data, is rejected. Verified
directly at both layers — the application layer (`NotFoundOrForbidden
Error`) and RLS (a direct raw cross-tenant `SELECT` against
`systems`/`processing_activities` independently returns zero rows).

**ROPA:** deliberately NOT a new persisted table — `listRopaEntries`
(`lib/domain/processing-activities.ts`) is a read view assembling
Processing Activities and their six junctions, resolved against master
data, matching `db/schema/processing-activities.ts`'s own pre-existing
header comment ("ROPA is a future view/workflow over this table and its
junctions — not a separate dataset"). No new PDF/export subsystem —
R1's Engagement Report is unchanged and untouched by this slice.

**Applicability/Scope, the explicit future integration point:** not
built here (out of scope by instruction), and nothing in this slice's
schema or domain layer blocks it. A future `ApplicabilityDetermination`
(DATA_MODEL.md §4) would reference `ProcessingActivity` the same way
`Risk`/`Finding` already do — no schema change to this slice's own
tables would be required.

**Tests:** `tests/app/data-landscape.test.ts` (new, 26 tests) —
master-data CRUD/versioning/authorization/tenant-isolation (12),
Processing Activity CRUD/relationships/versioning/carry-forward/
authorization/tenant-isolation/ROPA (14) — plus the reference-engagement
fixture itself now exercising the full Data Landscape path as its own
real, non-test-only "production" use, and `tests/app/reference-
engagement.test.ts`'s own STAGE 3 upgraded from PARTIAL-proving to
YES-proving assertions.

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
| Data Landscape (master data) | YES | **YES** | YES | **None (Slice D2).** `lib/domain/master-data.ts` + `/organisations/[id]/master-data/[category]` — a consultant can create/version/retire Business Units, Systems, Processors, Data Stores, Purposes, Personal Data Elements, and Data Principal Categories entirely from the running application; verified directly against real PostgreSQL, including that a new version never rewrites the old one. |
| ROPA / Processing Activities | YES | **YES** | YES | **None (Slice D2).** `lib/domain/processing-activities.ts` + `/organisations/[id]/engagements/[id]/data-landscape` (+ `/ropa`) — a consultant can create Processing Activities, link all six relationship categories, review the Data Landscape, open the ROPA view, and carry an activity forward into a new engagement, entirely from the running application; verified directly, including that carry-forward re-resolves to current master-data versions without touching the source engagement's rows. |
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
itself, through building the client's Data Landscape and Processing
Activities / ROPA, through Assessment → Control Testing → Evidence →
Risk → Finding → Remediation → Validation → Engagement Report —
entirely inside PRIMUS.** Slice D1 closed the control-library gap;
Slice D2 closes the Data Landscape/ROPA gap that became top-ranked once
D1 was done: a consultant can now maintain the client's reusable master
data (Business Units, Systems, Processors, Data Stores, Purposes,
Personal Data Elements, Data Principal Categories) and record/link/review
Processing Activities and their ROPA view, all before or during an
Assessment, with no developer intervention.

They **still cannot**, from inside the running application: record a
formal Applicability/Scope determination, or compute a Maturity score.
Both gaps were already true before Session 28's exercise and remain true
after Slice D2 — deliberately: this slice's own instructions scoped it
to Data Landscape/Processing Activities/ROPA alone, explicitly excluding
Applicability/Scope and Maturity.

## Highest-priority gaps for a first real consulting engagement

Ranked by what most blocks PRIMUS from delivering a complete first real
engagement, given the loop itself (Control Library → Data Landscape/ROPA
→ Assessment → Risk → Finding → Remediation → Validation → Report) now
works end to end, Control Library Authoring and Data Landscape/ROPA
having been resolved by Slices D1 and D2:

1. **Applicability / Scope.** Now the top-ranked remaining gap, and
   genuinely unbuilt at the schema level, not just the application
   level — the smallest in raw effort (one new table plus a junction),
   but the one with no existing database foundation to build on at all.
   Slice D2 confirmed the Data Landscape model does not block adding
   it: a future `ApplicabilityDetermination` would reference
   `ProcessingActivity` the same way `Risk`/`Finding` already do.
2. **Maturity.** The one area where even the *scoring model* has never
   been designed (no algorithm, no domain reasoning) — the largest,
   least-defined gap, and correctly the one this task's own instructions
   forbid starting without further explicit direction.
3. **Client Portal.** Deliberately last — nothing above depends on it,
   and PRODUCT_SPEC.md/PRODUCT_UX_BLUEPRINT.md both treat it as a later
   phase once the consultant-side loop is solid, which it now is.

See `PROGRESS.md`'s "Reference Engagement Dataset", "Control Library
Authoring", and "Data Landscape / Processing Activities" sections, and
`DECISIONS.md` R-127 through R-132 and the Slice D2 entries, for the
full session record.
