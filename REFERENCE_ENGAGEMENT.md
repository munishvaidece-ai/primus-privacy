# PRIMUS PRIVACY — Reference/Demo Engagement Dataset

**Status:** built and verified (Session 28, 2026-09-02). One fictional,
end-to-end consulting engagement — **ABC Fintech Private Limited** /
**DPDP Compliance Assessment — FY 2026–27** — built through this
repository's real application code wherever real application code
exists, and through a clearly-isolated raw fixture only where it does
not (Regulatory Content & Control Library authoring, Data Landscape/
ROPA). This document is the honest record of what worked, what didn't,
and why — not a marketing description of the fixture.

This is **not a new product feature**. No `lib/domain/*` module, app
route, or migration changed the product's own capabilities; every gap
this document names was already true of the product before this slice —
this exercise only made each gap concrete, testable, and visible in one
place, using the fixture builders below.

## Where this lives

- `tests/app/reference-engagement-fixture.ts` — the builder
  (`buildReferenceEngagement()`). Two layers, kept deliberately
  distinct: raw SQL (via `asFixtureSetup`, a superuser connection) for
  the identity/bootstrap layer no application code can create at all
  (Tenant, Users — this product has no sign-up flow) and for the two
  areas with real database schema but zero application layer (Control
  Library/regulatory content, Data Landscape/ROPA); real domain
  functions (via `withRequestDb`) for everything the application layer
  actually implements (Organisation, Engagement, Engagement Membership,
  Assessment, Assessment Response, Control Test, Evidence, Risk,
  Finding, Remediation, Validation, Engagement Report).
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
  RegulatoryReference. Published through the real trigger-enforced
  publish workflow (migration 0007) — re-verified live by attempting a
  raw edit to a published Control and confirming the pre-existing
  immutability trigger rejects it.
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
| DPDP Controls (Regulatory Content & Control Library) | YES | NO | NO | Real publish/versioning workflow, genuinely trigger-enforced (re-verified live this session). No domain module, no `/methodology` route — a consultant cannot author a control library from the running application today; the only way this content was created here is the exact raw-SQL pattern every control-library test fixture already used. |
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
Organisation creation through Assessment → Control Testing → Evidence →
Risk → Finding → Remediation → Validation → Engagement Report
**entirely inside PRIMUS** — the exact governance loop C7.1–C7.3 and R1
closed, re-confirmed here against a substantially larger, more varied
fixture than any single prior slice's own tests used (25 controls, 6
risks, 7 findings, 8 remediation actions, 9 evidence items — R1's own
test fixture, by contrast, used 3/1/1/2/2).

They **cannot**, from inside the running application: build a Data
Landscape/ROPA record of the client's processing activities, author or
maintain the DPDP control library/regulatory content the Assessment is
measured against, record a formal Applicability/Scope determination, or
compute a Maturity score. Every one of these gaps was already true
before this slice — this exercise is what makes each one concrete,
testable, and no longer merely suspected.

## Highest-priority gaps for a first real consulting engagement

Ranked by what most blocks PRIMUS from delivering a complete first real
engagement, given the loop itself (Assessment → Risk → Finding →
Remediation → Validation → Report) already works end to end:

1. **DPDP Control Library authoring.** Every real engagement needs its
   own control library content before an Assessment can exist at all —
   today that content can only be typed in by a developer running raw
   SQL. This blocks starting a second, different real engagement more
   completely than any other gap on this list.
2. **Data Landscape / ROPA.** The brief's own workflow, and DATA_MODEL.md
   §5, treat this as the natural first-conversation deliverable with a
   client (what data do you process, where, why) — the schema is ready
   and well-designed; only the application layer is missing.
3. **Applicability / Scope.** Genuinely unbuilt at the schema level, not
   just the application level — the smallest of the three in raw
   effort (one new table plus a junction), but the one with no existing
   database foundation to build on at all.
4. **Maturity.** The one area where even the *scoring model* has never
   been designed (no algorithm, no domain reasoning) — the largest,
   least-defined gap, and correctly the one this task's own instructions
   forbid starting without further explicit direction.
5. **Client Portal.** Deliberately last — nothing above depends on it,
   and PRODUCT_SPEC.md/PRODUCT_UX_BLUEPRINT.md both treat it as a later
   phase once the consultant-side loop is solid, which it now is.

See `PROGRESS.md`'s "Reference Engagement Dataset" section and
`DECISIONS.md` R-127 (a real PDF-renderer bug this exercise found and
fixed) for the full session record.
