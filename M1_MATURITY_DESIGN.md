# PRIMUS PRIVACY — M1: Maturity Design & Discovery

Design/discovery only. No application code, migration, schema change,
UI, or test requiring implementation was written for this document. All
claims below are traced to specific files/lines in the repository as it
stands after Slice D3 (commit `8e80001`).

---

## 1. Executive Summary

Milestone 8/8A already built the **entire persistence layer** for
Maturity — `MaturityScoringMethodology`, `MaturityDomain`,
`MaturityDomainWeight`, `MaturityDomainControlMapping`,
`MaturityAssessment`, `MaturityScore` — fully schema'd, RLS'd,
trigger-guarded for immutability, and covered by 7 test files (60
tests) that exercise CRUD, audit, tenant isolation, methodology
versioning, domain-snapshot integrity, and — critically — a full
**worked historical scenario** that computes real numbers by hand
(`tests/maturity/historical-scenario.test.ts`). What has never existed,
at any layer, is the calculation engine: no domain module, no route, no
formula. This is confirmed directly by the fixture helper itself
(`tests/maturity/helpers.ts`'s `createMaturityScore` takes `score`/
`maturityLevel` as bare caller-supplied numbers) and by
`REFERENCE_ENGAGEMENT.md`'s own Gap Matrix (`Maturity | YES | NO | NO`).

The historical-scenario test is the single most important artifact in
this inspection: it is not merely a fixture, it is a **worked
example of the intended formula**, written by a prior session and
carried as an acceptance test ever since — `(implemented=5,
partially_implemented=3, not_implemented=1) / 3 = 3 → "Defined"`. This
document treats that worked example as authoritative evidence of intent
(not an assumption of mine) and formalizes it into a complete, D3-aware
methodology.

**Recommended methodology, in one sentence:** for each finalized
Assessment, compute one score per `MaturityDomain` as the rounded mean
of the pinned methodology's `rating_scores` value for every
domain-mapped, in-scope, actually-answered `AssessmentResponse`, then
compute one overall score as the domain scores' weighted mean using
each engagement's pinned `MaturityDomainWeight`s — writing the result,
once, into the *existing* `MaturityAssessment`/`MaturityScore` tables,
with zero schema changes.

---

## 2. Existing Repository Intent

Every meaningful reference to Maturity found by direct search, with its
status:

| File | Section | What it says | Status |
|---|---|---|---|
| `PRODUCT_SPEC.md:71` | §3 workflow | `...Validation → Maturity → Reporting → Continuous Compliance` | Explicit requirement (ordering) |
| `PRODUCT_SPEC.md:104-107` | §3 step 8 | "Gaps become Findings, which drive Remediation Actions, which — once evidenced and consultant-validated — trigger Control Reassessment, **which is what actually moves the Maturity score. Marking a remediation "done" never moves maturity by itself.**" | **Explicit requirement** — directly answers Part 8 below; not my invention |
| `PRODUCT_SPEC.md:139` | §4 Principle 10 | "Risk scoring and maturity weighting are configurable data, not hard-coded logic." | Explicit requirement |
| `PRODUCT_SPEC.md:172` | §5 Non-MVP | "Maturity scoring derived from control results via **configurable domain weighting**" | Explicit requirement (confirms domain-weighted model) |
| `PRODUCT_SPEC.md:186` | §5 Non-MVP | "Cross-engagement / cross-period maturity comparison **dashboards**" listed as Non-MVP | Explicit scope boundary |
| `DATA_MODEL.md:601-684` | §9 Maturity | Full entity table + narrative (see §3 below) | **Design decision**, largely implemented |
| `ARCHITECTURE.md:65-69` | Domain layer | "business rules (e.g. ... "maturity only recalculates from a control reassessment")" | Explicit requirement — recompute is a controlled, non-automatic action |
| `ARCHITECTURE.md:141-142` | Component list | "Maturity engine — **pure computation** over current control results and configurable domain weights; produces a versioned `MaturityScore` per assessment period; never writable directly by a user action." | Explicit requirement |
| `ROADMAP.md:33-34` | Phase list | "Maturity Engine — MaturityDomain, MaturityDomainWeight, MaturityScore, computed only from accepted validations/control..." | Explicit requirement (built) |
| `ROADMAP.md:52` | Later phase | "Cross-engagement / cross-period maturity comparison dashboards" — Phase 2 | Explicit scope boundary |
| `DECISIONS.md` R-72–R-82 | Milestone 8/8A | Full implementation record of every table above | Implementation detail (see §3) |
| `DECISIONS.md` R-79 | Milestone 8 | Computed **only** from `AssessmentResponse.effectiveness_rating` via the pinned methodology's `rating_scores` map; Risk/Validation ids are captured for traceability, **"nothing... derives a numeric score contribution from a Risk's rating or a ValidationRecord's outcome"** | Explicit requirement — CRITICAL, reaffirmed twice |
| `DECISIONS.md` R-80 | Milestone 8 | "do not award maturity points merely because Remediation.status = validated... do not create automatic maturity jumps" | Explicit requirement — CRITICAL |
| `PRODUCT_UX_BLUEPRINT.md:98,220,226,239,409-428,495,506-507,542,604-606,817,836,904,965` | Various | Screen inventory, Permission Matrix, visibility rules, gap list (see §16/§10 below) | Design decisions + one flagged gap |
| `tests/maturity/historical-scenario.test.ts` | Whole file | A hand-computed worked example: two Assessments (FY2026/FY2027), real ratings, real arithmetic, real rounding | **The closest thing to an authoritative formula the repository has** — a test, not a spec, but written to demonstrate "the same way a future Maturity engine would" (its own header comment) |
| `tests/maturity/helpers.ts:44-77` | `createMaturityScoringMethodology` | Default test `definition`: `{"rating_scores":{"implemented":5,"partially_implemented":3,"not_implemented":1,"not_applicable":null,"not_assessed":null},"levels":[{"min":1,"max":1.99,"label":"Ad Hoc"},...,{"min":5,"max":5,"label":"Optimized"}]}` | Illustrative test data, explicitly disclaimed as non-authoritative — but the *shape* is real, tested infrastructure |
| `REFERENCE_ENGAGEMENT.md:413,447-461` | Gap Matrix | `Maturity: YES/NO/NO`; ranked #1 remaining gap; explicitly notes D3's own applicability integration point | Current, accurate status |

**Does the repository already define an authoritative maturity
formula? No.** Every schema field, every trigger, every RLS policy
needed to *store* a formula's output exists and is fully tested. The
formula itself — what number goes into `score` — has never been
written as application code anywhere. `DECISIONS.md` R-79 and
`PRODUCT_UX_BLUEPRINT.md:965` both say this explicitly, in nearly
identical words, from two different milestones. This document is the
"product/methodology decision" `PRODUCT_UX_BLUEPRINT.md:965` says must
happen before that formula is written: *"this must be resolved by a
product/methodology decision, not invented by whoever builds the UI."*

The historical-scenario test is not a formula either — but it is a
**worked example of what the maintainers of this repository expected the
formula to look like**, and the recommendation in §19 below formalizes
exactly that example rather than inventing something new.

---

## 3. Maturity Object

**Options evaluated:**

**A. Engagement-level.** Rejected. `MaturityAssessment.assessment_id`
is `NOT NULL` with a `require_finalized_assessment_for_maturity` guard
(`maturity-assessments.ts:53-58`) — the schema already anchors Maturity
to one specific Assessment, not the Engagement as a whole. An
Engagement can have many Assessments (and, per §13, many
`MaturityAssessment`s); "Engagement maturity" is not one row anywhere,
it would be "the latest `MaturityAssessment`'s result for this
Engagement" — a *read*, not a distinct object.

**B. Assessment-level. RECOMMENDED — already the built model.**
`MaturityAssessment` 1:1-pins one finalized `Assessment`
(`assessment_id`, `require_finalized_assessment_for_maturity` trigger).
This is not a choice this document is making; it is the schema that
already exists. Historical reproducibility is automatic: an
`Assessment`'s own `AssessmentControl`/`AssessmentResponse` rows are
already frozen at finalization (Milestone 5/6/9 triggers), and once a
`MaturityAssessment` built from them is itself finalized, its own rows
are permanently frozen too (`maturity_scores` has no UPDATE/DELETE
grant at all; `enforce_maturity_score_draft_mutable` blocks INSERT
against a finalized parent). If the Scope, Control Library, or
`AssessmentResponse`s later change, the historical `MaturityAssessment`
is provably unaffected — this is exactly D3's own already-proven
"snapshot, never re-derive" pattern one level up, and Milestone 8A
(`domain_name_snapshot` etc.) exists specifically to close the one gap
that pattern would otherwise have left open.

**C. Scope-level.** Rejected. `EngagementScope` has no `assessment_id`
of its own and can outlive or precede any particular Assessment (D3
§4); anchoring Maturity to it would break the "official = finalized
Assessment" boundary `PRODUCT_UX_BLUEPRINT.md:542` requires for
client-visibility, and would need a new persisted entity the schema
does not have and nothing in the repository asks for.

**D. Organisation-level.** Rejected outright — no document, schema
comment, or test anywhere treats Maturity as spanning Engagements.
Cross-engagement comparison is explicitly `PRODUCT_SPEC.md:186`/
`ROADMAP.md:52` Non-MVP/Phase-2, a *read-side* concern (§13), not a
reason to change the object maturity is computed on.

**No new persisted entity is introduced or required.**

---

## 4. Control Scoring

Analysis of `control_effectiveness_rating` (`db/schema/enums.ts:174-180`):
`not_assessed | not_applicable | not_implemented | partially_implemented
| implemented`. Also relevant: `assessment-controls.ts:146-150`'s own
documented convention that "not yet assessed" is normally the *absence*
of an `AssessmentResponse` row for an `AssessmentControl`, not a row
carrying the literal `not_assessed` value — both cases must be handled
identically for Maturity purposes (there is no reliable way to force a
respondent to write an explicit `not_assessed` row instead of leaving
one absent, and no reason the two should score differently).

| Assessment Response | Maturity Treatment | Included in denominator? | Score contribution | Rationale |
|---|---|---|---|---|
| *(no `AssessmentResponse` row at all)* | Same as `not_assessed` below | **No** (excluded from the score; counted separately as a coverage gap) | none | Matches the existing test-fixture default (`rating_scores.not_assessed: null`, `tests/maturity/helpers.ts:62`) — an unscored control is a documentation gap, not evidence of poor maturity, so it must not silently *drag the score down* either. Coverage (§14) makes the gap visible instead of arithmetic making it punitive. |
| `not_assessed` | Excluded | **No** | none | Same as above — an explicit `not_assessed` row and an absent row must be treated identically; nothing in this codebase distinguishes them semantically. |
| `not_applicable` (assessor's own call, independent of D3 Scope) | Excluded | **No** | none | Mirrors the existing test-fixture's `rating_scores.not_applicable: null` exactly (`tests/maturity/helpers.ts:61`) — an assessor-level N/A is the same signal as a Scope-level N/A (§5), just asserted at a different point in the workflow; excluding both, the same way, keeps one consistent rule instead of two. |
| `not_implemented` | Scored | Yes | Configurable, default `1` (methodology `rating_scores.not_implemented`) | Lowest non-excluded rung — a real, applicable control the client has not implemented. |
| `partially_implemented` | Scored | Yes | Configurable, default `3` | Midpoint on the 1–5 scale — deliberately not `2.5`/`50%`: `MaturityScore.score` is a Postgres `integer` (`maturity-scores.ts:86`), so every configured value must itself be an integer 1–5; `3` is the schema's own already-tested default (`historical-scenario.test.ts:109`), not an assumption made here. |
| `implemented` | Scored | Yes | Configurable, default `5` | Top of the scale. |

**None of these mappings is hard-coded.** They live entirely in
`MaturityScoringMethodology.definition.rating_scores`
(`maturity-scoring-methodologies.ts:43-47`), a Tenant-scoped, versioned,
append-only jsonb document — exactly the "configurable data, not
hard-coded logic" `PRODUCT_SPEC.md:139` requires. The values above are
the *recommended default*, carried over unchanged from the existing
test fixture (not invented fresh), not a fixed rule the engine enforces.
The engine's only fixed rule is the **mechanism**: a rating whose
configured value is `null` (or absent from the map) is excluded from
both the numerator and the denominator; every other rating contributes
its configured integer value.

---

## 5. Scope Semantics

D3 (`AssessmentControl.applicability_decision`, `db/schema/
assessment-controls.ts:37-46`) is the authoritative, *frozen-per-Assessment*
signal — never the live `EngagementScope`. This section states the exact
per-`AssessmentControl` rule the compute engine must apply, addressing
each of the brief's five explicit requirements:

| `applicability_decision` (D3 snapshot) | Effect on Maturity |
|---|---|
| `not_applicable` | **Excluded** from the domain's denominator entirely — regardless of whether an `AssessmentResponse` also exists for it. *(Requirement 1: an explicit N/A must not reduce maturity — excluding it, rather than scoring it `1`, is what prevents that.)* |
| `undecided` | **Included** in the denominator, scored exactly like `applicable` — its `AssessmentResponse` (if any) is read normally per §4's table. *(Requirements 2 and 3: undecided is never silently reclassified as N/A, and it never disappears from the denominator — it is treated as "presumed in scope until a human says otherwise," the same default-inclusive posture D3 itself established for `AssessmentControl.applicable` defaulting to `undecided` rather than `true`, DECISIONS.md R-140.)* |
| `applicable` | Included, scored normally. |

**Requirement 4 (Scope must not be able to inflate maturity by
excluding difficult controls):** addressed structurally, not
arithmetically. `EngagementScopeControl.rationale` is mandatory for
`not_applicable` (D3, DB-enforced CHECK) and `EngagementScope` locking
requires the dedicated `scope.lock` permission (Engagement Manager) —
marking controls N/A is already a deliberate, rationale-bearing,
governance-gated act, not a free toggle. On top of that existing
gate, §14/§15 below require every maturity result to be reported
*alongside* its own not-applicable count and rationale list — a score
built on a suspiciously large N/A set is visibly so, every time it is
shown, never hidden behind a single clean percentage.

**Requirement 5 (historical Assessment maturity must use the
Assessment's own snapshot, never the current Scope):** already true by
construction — the compute engine reads `AssessmentControl.
applicability_decision` (frozen at Assessment-creation time, D3 §6),
never `EngagementScopeControl.decision` (the live, possibly-since-revised
row) directly. This is not a new rule for Maturity to invent; it is D3's
own snapshot existing for exactly this purpose.

**Requirement 6 (no locked Scope at Assessment creation):** in that
case every `AssessmentControl.applicability_decision` defaults to
`'undecided'` (D3's own documented no-Scope behavior,
`lib/domain/assessments.ts`'s `createAssessment`) — which, per the row
above, is treated exactly like `applicable`. **An Assessment created
before D3 existed, or for an Engagement that never used Scope at all,
computes Maturity exactly as if every control were in scope** — the
correct behavior, since "no Scope" must never be silently confused
with "everything is N/A."

---

## 6. Assessment State

**Maturity can be *computed* only from a finalized Assessment** — this
is not a new rule, it is `require_finalized_assessment_for_maturity`
(`maturity-assessments.ts:53-58`), already enforced at the database
layer. There is no "draft Assessment maturity" object anywhere in the
schema, and none is recommended: `AssessmentResponse` rows on a draft
Assessment are still ordinarily mutable (Milestone 5), so any number
computed from them would be contradicting the very next edit a
Consultant makes — "provisional maturity" would be a number with no
stable meaning, and nothing in `DATA_MODEL.md`/`PRODUCT_UX_BLUEPRINT.md`
asks for one.

**`MaturityAssessment` itself does still have its own `draft`/
`finalized` two-state lifecycle** (`maturity_assessment_status`,
mirroring `Assessment`'s own shape, R-76) — this is the "provisional vs.
official" distinction the brief asks for, and it already exists:

- **`draft` `MaturityAssessment`** — the compute action's own output,
  immediately after running: real scores, computed from a real
  finalized Assessment, but still internal-only. A Consultant can review
  it (and, per §12, *discard and recompute* it — see below) before
  committing to it.
- **`finalized` `MaturityAssessment`** — permanently locked (no further
  UPDATE at all, R-76's trigger) and the only state
  `PRODUCT_UX_BLUEPRINT.md:542` allows a client to ever see ("Client
  sees a maturity result only once its `MaturityAssessment.status =
  'finalized'` — never a draft/in-progress computation").

**One nuance the schema does not yet resolve, and this document
recommends explicitly:** unlike `Assessment` (whose `AssessmentControl`/
`AssessmentResponse` rows are mutable in place while draft),
`MaturityScore` has **no UPDATE grant at all**, draft or finalized
(`maturity-scores.ts:17-30`) — a draft `MaturityAssessment`'s scores are
therefore *insert-only*, not edit-in-place. Recomputing a still-draft
`MaturityAssessment` (e.g. because the Consultant fixed a
miscategorized `AssessmentResponse` before finalizing) is not possible
by editing existing rows — the correct action, matching the "immutable
snapshot" posture throughout this schema, is to **discard the draft
`MaturityAssessment` row entirely (a plain `DELETE`, permitted only
while `status='draft'` — no trigger currently blocks this, since no
finalization has happened yet) and create a new one**. See §7/§12/§18.

**R1's own draft/finalized support:** R1 already reports on either a
draft or a finalized `Assessment` (`getEngagementReportData`'s
`selectMostRecentAssessmentId`, no status filter). The same posture is
recommended for a future Maturity section in R1: show the maturity
result if one exists for the reported Assessment, draft or finalized,
but the PDF must visibly label a draft result as **"Provisional — not
yet finalized"**, never presented with the same visual weight as a
finalized one. This is a reporting-layer rule, not a computation rule;
§15 elaborates.

---

## 7. Control Testing

Three models were named in the brief; the repository's own worked
example already answers this decisively.

**Model A — AssessmentResponse alone determines maturity. RECOMMENDED.**
Every score in `historical-scenario.test.ts` is derived purely from
`effectiveness_rating` (`implemented`/`partially_implemented`/
`not_implemented`). The scenario's own `ControlTest.result` values
(`pass`/`exception_noted`/`fail`) never numerically diverge the score
from what the `AssessmentResponse` alone would produce — C2's response
is `partially_implemented` (scores `3`) regardless of its `ControlTest`
reading `exception_noted` rather than `pass`; nothing in the schema, a
trigger, or this test derives a different number from that test result.
`computed_from_control_test_ids` (`maturity-scores.ts:88`) exists
purely for **traceability** — "these are the specific tests that were
available when this score was computed" — never as an input to the
arithmetic.

**Model B — ControlTest validates/challenges but never auto-alters the
response.** This is the *procedural* companion to Model A, not a
distinct scoring model: a `ControlTest` that contradicts its
`AssessmentResponse` (a `fail` result under an `implemented` response)
is a finding for the Consultant to act on — by manually editing the
`AssessmentResponse` itself (an ordinary, already-existing, fully
audited action while the Assessment is still draft) — never by any
automatic mechanism reaching into the score. This is the model this
document recommends adopting **explicitly and by name**, so a future
implementer does not have to re-derive it from the test data: **the
Maturity engine reads `AssessmentResponse.effectiveness_rating` only;
`ControlTest` rows fill `computed_from_control_test_ids` for
traceability and are never otherwise touched by the computation.**

**Model C — ControlTest result directly changes maturity.** Rejected.
This would create exactly the "hidden scoring behavior consultants
cannot explain" the brief warns against — a client asking "why is this
control scored 3?" would need to be told to check *two* different
tables whose relationship the engine, not a human, decided. It also has
no support anywhere in the existing schema or tests.

This preserves the separation the brief asks for cleanly:
self-assessment (`AssessmentResponse`) is the score's only input;
independent testing (`ControlTest`) is evidence/traceability; the
Evidence layer proper is §8, below.

---

## 8. Evidence

`Evidence`/`EvidenceLink` carry `quality_rating` (`strong`/`adequate`/
`weak`) and `review_status` (`pending_review`/`accepted`/`rejected`/
`expired`) — real, existing fields (`db/schema/enums.ts:243-249,263-273`).
Nothing in `DATA_MODEL.md` §9, `DECISIONS.md`, or the maturity schema
itself ties either field to a numeric maturity contribution — no
"evidence quality score" concept exists to reuse, and inventing one
here would be exactly the kind of scoring architecture the brief
explicitly says not to invent unless the repository already supports
it.

**Recommendation: Evidence affects reporting/confidence only — it has
no numeric maturity impact.** Specifically:

- The score itself is computed the same way whether a given
  `AssessmentResponse`/`ControlTest` has zero or many linked `Evidence`
  rows.
- A derived, **report-only, non-persisted** statistic — *evidence
  coverage*: the percentage of scored (i.e. counted-in-the-denominator,
  §4) controls that have at least one `EvidenceLink` — is computed live
  whenever a `MaturityAssessment`'s result is displayed or reported,
  reading `evidence_links`/`assessment_responses` (both already frozen
  once the underlying `Assessment` is finalized, so this stays
  reproducible without persisting anything new).
- This directly satisfies "prefer a transparent model where evidence
  supports the credibility of the assessment rather than becoming an
  arbitrary multiplier" — a score with 40% evidence coverage is *shown
  as such*, never silently discounted or boosted by that number.

No schema change. Evidence coverage is a read/report concern (§15),
computed the same way `getEvidenceSummaryForEngagement` already reads
`EvidenceLink`, not a new persisted field.

---

## 9. Risk / Findings / Remediation / Validation

`PRODUCT_SPEC.md:104-107` already states this section's answer in full,
verbatim, as an existing product principle — not something this
document is deciding fresh:

> "Gaps become **Findings**, which drive **Remediation Actions**, which
> — once evidenced and consultant-**validated** — trigger **Control
> Reassessment**, which is what actually moves the **Maturity** score.
> Marking a remediation "done" never moves maturity by itself."

`DECISIONS.md` R-79/R-80 (Milestone 8, reaffirming Milestone 7's R-71)
independently confirm this at the schema level: no trigger, FK, or
generated column anywhere reads `Risk.residual_rating`,
`RemediationAction.status`, or `ValidationRecord.outcome` to derive
any Maturity value, and none should be added.

**The clean semantic boundary, stated explicitly:**

| Concern | Object | Lives in |
|---|---|---|
| Control maturity | "How effectively is this control implemented, right now, per the last finalized Assessment" | `MaturityScore` (this document) |
| Risk exposure | "How much residual exposure does this gap represent" | `Risk` register — independently scored via `RiskScoringModel`, never re-expressed as a maturity point |
| Remediation progress | "Is the fix in progress / done / evidenced" | `RemediationAction.status` — a state machine with no downstream numeric effect (R-71/R-80) |
| Validation outcome | "Did the consultant independently confirm the fix" | `ValidationRecord.outcome` — the ONE thing with a real, existing effect: an `accepted` outcome triggers a **control reassessment** (a genuinely new `AssessmentResponse`/`ControlTest` in a later Assessment — Milestone 7's own required scenario, `PRODUCT_UX_BLUEPRINT.md:670-672`) |

**The one real path from Remediation/Validation to Maturity, stated
precisely, so it is never mistaken for a direct score edit:**
`ValidationRecord(outcome=accepted)` → a **new** `AssessmentResponse`
recorded against the (re-)assessed control, in a *later* `Assessment`
→ that later `Assessment` is finalized → a **new** `MaturityAssessment`
is computed from it. Every step is an explicit, already-audited human
action; nothing is automatic; the improved rating only ever reaches
Maturity by going through a brand-new computation, never by patching an
old one.

**No double-counting risk exists** under this design, because the same
underlying weakness is never scored twice: only §4's `AssessmentResponse`
value is arithmetic input. A `Not Implemented` control that produces a
`Risk`, a `Finding`, and a `RemediationAction` is still counted exactly
**once** in the maturity denominator/numerator (as one `AssessmentControl`
with rating `not_implemented`) — the other three objects exist, are
reported (§15), and drive their own separate workflows, but none of them
independently subtracts from the score a second, third, or fourth time.

**How they should instead appear in the report, since they do not
affect the numeric score:** as parallel, clearly-separated **governance
signals** next to the maturity number (§15) — an open Finding count, a
residual-Risk distribution, remediation-in-progress counts, recent
validation outcomes — giving the full picture a bare percentage cannot,
without ever blending into the arithmetic that produced that percentage.

---

## 10. Weighting

**Recommendation: (E) Domain/category weighting across domains,
combined with equal weighting of controls *within* a domain — because
this is what the existing schema already builds, not a new design
choice.**

- **Across domains:** `MaturityDomainWeight` (`weight numeric(5,2) >
  0`, one active row per engagement+domain, append-only/pinned — R-75)
  is a first-class, fully-tested, engagement-configurable mechanism.
  This is Option E, already built; there is nothing left to decide here
  except *how* the compute engine consumes it (§19).
- **Within a domain:** `MaturityDomainControlMapping` (a plain
  `MaturityDomain × Control` junction, `maturity-domain-control-mappings.ts`)
  carries **no weight column of its own**. Every control mapped to a
  domain therefore contributes equally to that domain's own score —
  confirmed directly by the historical-scenario test's own arithmetic
  (`(5+3+1)/3`, a plain mean, not a weighted one).

Options A (equal weighting of every applicable control, ignoring
domains entirely), B (Requirement weighting), C (per-Control weighting),
D (RegulatoryReference weighting), and F (Risk-based weighting) were all
considered and rejected — not because they are unreasonable in the
abstract, but because none of them has any supporting schema, and
`MaturityDomainWeight`/`MaturityDomainControlMapping` already give this
product a working, tested, two-level weighting scheme that a first MVP
should use rather than replace. Introducing per-control or
Requirement-level weighting now would need new schema, contradicting
§17's own "no new tables merely for convenience" principle, for a
sophistication nothing in the repository asks for.

---

## 11. Maturity Scale

**This is not an open design choice — `MaturityScore.score` is already
a Postgres `integer` column with `CHECK (score BETWEEN 1 AND 5)`**
(`maturity-scores.ts:86,101`), and `DATA_MODEL.md:608,644` independently
and repeatedly specifies "1–5 scale" as the approved model. A
0–100/percentage scale, or a 0–5 scale, would both directly contradict
an existing, enforced database constraint — recommending either would
not be a defensible alternative, it would be proposing a migration this
task is explicitly forbidden from making.

**Recommended scale (formalizing the existing test-fixture default,
`tests/maturity/helpers.ts:64-69`, itself explicitly disclaimed there as
"clearly synthetic test configuration," so treated here as a
*reasonable starting default*, not a fixed rule):**

| Score | Label | Interpretation |
|---|---|---|
| 1 | Ad Hoc | Controls largely undocumented/inconsistent |
| 2 | Developing | Some controls exist; coverage and consistency are incomplete |
| 3 | Defined | Controls are documented and generally applied |
| 4 | Managed | Controls are consistently applied and monitored |
| 5 | Optimized | Controls are consistently applied, monitored, and continuously improved |

**Rounding rule (a genuine decision, not yet demonstrated by the
existing tests, made explicit here):** compute the raw mean as a
real-valued number, then round to the **nearest integer, ties rounding
up** (`round-half-up`: 4.5 → 5, 2.5 → 3), then clamp to `[1, 5]`, then
resolve `maturity_level` from the pinned methodology's `levels` array
using **the already-rounded integer**, never the pre-rounding raw
value. Round-half-up is preferred over round-half-to-even (banker's
rounding) for one reason: it is trivially explainable to a client in
one sentence, which round-half-to-even is not, and nothing here needs
banker's rounding's specific bias-avoidance property (this is not a
sum of many independent roundings). Rounding the score *before* looking
up the level (rather than classifying the raw value directly) is
recommended specifically so `score` and `maturity_level` can never
visibly disagree — a raw `4.99` rounds to `5` and is classified as
`5`/"Optimized," never stored as `5` while simultaneously read out as
"Managed" from a stale pre-rounding lookup.

**Boundary behavior:** every methodology's `levels` array must cover
`[1,5]` with no gaps (an integer score of exactly `1` and exactly `5`
must both resolve to a label) — a validation concern for whoever builds
`MaturityScoringMethodology` authoring tooling (out of this document's
scope), not a runtime concern for the compute engine, which only ever
looks up an already-guaranteed-valid integer.

---

## 12. Domain / Category Scores

**Recommendation: overall + control-library domains — via the
already-built `MaturityDomain`/`MaturityDomainControlMapping`, not a
new taxonomy.**

`MaturityDomain` (`db/schema/maturity-domains.ts`) is explicitly its
own, Tenant-owned, purpose-built maturity taxonomy — DATA_MODEL.md §9's
own example set ("Governance," "Data Management," "Third-Party Risk")
is deliberately *not* drawn from the Control Library's existing
categories (RegulatoryReference/Requirement), and `maturity-domains.ts`'s
own header comment says exactly this: a `MaturityDomain` is a
"configurable scoring domain," distinct from — and mapped onto — the
Control Library via `MaturityDomainControlMapping`, not a relabeling of
`RegulatoryReference` or a business/process grouping invented fresh for
this document.

- **Overall + Regulatory References** and **overall + business/process
  categories** were considered and rejected: neither has *any* schema
  support (no `MaturityScore` field references `RegulatoryReference` or
  any process taxonomy at all), and building either would mean
  inventing a second Control→grouping mechanism alongside the one
  Milestone 8 already built and fully tested — exactly the "new
  taxonomy solely for maturity" the brief warns against, doubled.
- **Only overall, no domain breakdown** was considered and rejected:
  `MaturityScore.maturity_domain_id` being nullable specifically *for
  the overall row* (`DATA_MODEL.md:608`, `maturity-scores.ts:74-76`)
  is the schema's own explicit statement that per-domain rows are the
  norm and the overall row is the exception, not the reverse.

The domain grouping a future report/UI shows is therefore always: read
`MaturityDomainControlMapping` for the Tenant, resolve each Control's
`MaturityDomain`(s), and use exactly that grouping — never a
recomputed or alternative taxonomy.

---

## 13. Historical Integrity

The governing principle, restated precisely for each listed trigger:
**"Historical client-facing results must be reproducible from the
Assessment's own historical facts"** means a **finalized**
`MaturityAssessment`'s own `MaturityScore` rows never change, ever, for
any reason — this is already a hard database guarantee (no UPDATE/DELETE
grant on `maturity_scores`; `enforce_maturity_score_draft_mutable`
blocks INSERT once the parent is finalized; `MaturityAssessment` itself
gets the same finalization-tampering trigger `Assessment` has, R-76). No
event below can violate that, by construction — the question this
section actually needs to answer is narrower: **can a DRAFT
`MaturityAssessment` (not yet finalized) be affected, and should a NEW
`MaturityAssessment` computation be needed?**

| Event, after an Assessment is created | Effect on an existing (already-computed) `MaturityAssessment`, draft | Effect on an existing (already-computed) `MaturityAssessment`, finalized |
|---|---|---|
| `EngagementScope` is revised | None — the underlying `AssessmentControl.applicability_decision` snapshot (§5) never changes, so a recomputation from the same Assessment would produce the identical result | None (finalized, immutable regardless) |
| `EngagementScope` is locked again | Same as above | Same as above |
| A new `ControlLibraryVersion` is published | None — `Assessment.control_library_version_id` is itself immutable once the Assessment is created (Milestone 5); a new library version cannot retroactively add/remove `AssessmentControl` rows | None |
| Controls change (in a *different*, unpublished-yet library version) | None — irrelevant to an already-created `AssessmentControl` set | None |
| `AssessmentResponse`s change (while the *source* Assessment is still draft) | **Would** change the result of a *new* computation — but the existing draft `MaturityAssessment`'s own rows do not auto-update (no UPDATE grant); it is now stale. Recommended action: discard (delete) the stale draft `MaturityAssessment` and recompute (§6/§18). | Not applicable — an `AssessmentResponse` cannot change once its own Assessment is finalized (existing trigger) |
| `ControlTest`s are added | No numeric effect either way (§7) — `computed_from_control_test_ids` on a *new* computation would simply capture more tests; an existing draft's array is unaffected until recomputed | None |
| Evidence is added | No numeric effect (§8) | None |
| Risks/Findings change | No numeric effect (§9) | None |
| Remediation changes | No numeric effect unless it results in a **new, later** Assessment being finalized — which produces a wholly **new** `MaturityAssessment`, never an edit to this one (§9) | None |
| Validation occurs | Same as Remediation, above | None |

**Net rule for implementation:** the only event that can make an
existing `MaturityAssessment` "wrong" is an edit to the *same, still-draft*
source Assessment's `AssessmentResponse`s after the `MaturityAssessment`
was computed from it — and the correct response is never a silent
recompute, but an explicit discard-and-recompute the Consultant
triggers, because a `MaturityAssessment` result is defined as "what this
Assessment's facts produced at computation time," a definition that
should never be allowed to be true anymore without the Consultant
being the one to make it true again.

---

## 14. Multiple Assessments

**Design only — no comparison feature is being specified for
implementation, per the brief.**

**What makes two `MaturityScore` results genuinely comparable:**

1. **Same `MaturityScoringMethodology` (id, not merely version label).**
   Two scores computed under different `rating_scores`/`levels`
   definitions are not the same measurement — comparing them would be
   comparing apples scored on different rulers. `MaturityAssessment.
   maturity_scoring_methodology_id` already records exactly which one
   was used (pinned, append-only, R-73), so "were these two comparable"
   is a plain equality check on that column, not something that needs
   inventing.
2. **Same `MaturityDomain` set (by id) for any per-domain comparison.**
   `MaturityScore.maturity_domain_id` plus the Milestone 8A domain
   snapshot columns (`domain_name_snapshot` etc.) together let a future
   comparison view show "this domain, then vs. now" even if the live
   `MaturityDomain` row's name has since changed — reading the snapshot,
   never the live row, exactly as `PRODUCT_UX_BLUEPRINT.md:410-414`
   already specifies.
3. **`ControlLibraryVersion` need not be identical** for the *overall*
   score to be meaningfully comparable across periods — a library
   legitimately evolves between FY2026 and FY2027 (D1's own versioning
   model). What must be comparable is the *methodology and domain
   taxonomy*, not the exact control set each score was computed over;
   this mirrors how `historical-scenario.test.ts` itself compares MA1
   (FY2026) against MA2 (FY2027) — same library version in that
   particular scenario, but nothing in the schema *requires* that,
   only that both scores share the same methodology/domain identity.
4. **Newly added/removed Controls affect domain scores, not
   comparability itself.** If FY2027 adds a fourth mapped Control to a
   domain that only had three in FY2026, the two domain scores are
   still comparable numbers on the same 1–5 scale under the same
   methodology — they simply represent averages over different-sized,
   evolving control sets, which is an accurate reflection of a real
   engagement's own growth, not a data-integrity problem to solve.
5. **Existing `Assessment` fields are sufficient for future comparison
   tooling**, with one caveat: `assessment_type`/`period_label` already
   let a future screen order/group Assessments; `previous_assessment_id`
   exists but — per `lib/domain/assessments.ts`'s own docstring, quoted
   in the D2/D3 sessions' own inspection — is **never read or written
   by any application code today**. A future comparison feature would
   need to either (a) start populating it (an application-layer change
   only, no schema change), or (b) simply order by `period_label`/
   `created_at`, which is already sufficient for the "FY2026 vs FY2027"
   shape every existing test and document uses. This document does not
   resolve which; it is a real, minor open question for whichever
   future slice actually builds comparison (§22).

---

## 15. Edge Cases

| # | Case | Semantics |
|---|---|---|
| 1 | No Assessment exists for the Engagement | `MaturityAssessment` creation is impossible (`require_finalized_assessment_for_maturity`) — the compute action is simply not offered; not a Maturity-specific edge case, an Assessment one. |
| 2 | Assessment with zero `AssessmentControl` rows (empty `ControlLibraryVersion` at creation, already a real, valid, tested Assessment state) | No domain can have any eligible controls; per the "no fabricated score" rule (§4/§19), the compute action must refuse with a clear, explicit error — **not** silently create a `MaturityAssessment` with zero `MaturityScore` rows, and **not** invent a score. |
| 3 | Every control `not_assessed` (or has no response) | Every control is excluded from every domain's denominator (§4) → same outcome as #2: nothing to compute, explicit refusal, not a fabricated `1` or a silent skip. |
| 4 | Every control `not_applicable` (assessor-level, or via D3 Scope) | Same as #3 — nothing eligible, explicit refusal. This is the direct, concrete instance of Requirement 4 (§5): a Scope that excludes everything cannot produce a "perfect" or "empty" score either way — it produces *no score at all*, which is the only honest outcome. |
| 5 | Every control `undecided` (D3 Scope), but each has a real `AssessmentResponse` | Computed normally — `undecided` never blocks scoring (§5); this is the ordinary case for any Assessment created before a Scope was ever locked. |
| 6 | A mixture of applicable and N/A controls | Computed normally over the eligible subset; the excluded N/A controls, and their rationale, are reported alongside the score (§5, §16) — never invisible. |
| 7 | Exactly one applicable, scored control in a domain | The domain's score is that one control's own rating value, rounded — mathematically identical to a mean of one element; no special-casing needed. |
| 8 | Draft Assessment | Cannot be used to create a `MaturityAssessment` at all (§6) — the compute action is simply unavailable until the Assessment is finalized. |
| 9 | Finalized Assessment | The normal, expected case this whole document designs for. |
| 10 | Assessment created before D3's Scope existed | `applicability_decision` defaults to `'undecided'` on every row (§5) — scored exactly as if Scope had never been a concept, which is correct. |
| 11 | Assessment with no Evidence anywhere | Computes normally (§8 — Evidence has no scoring effect); reported evidence coverage is `0%`, shown plainly, never blocking or altering the score. |
| 12 | Evidence exists but no `ControlTest`s | Computes normally (§7); `computed_from_control_test_ids` on every `MaturityScore` row is an empty array — a real, honest value, not an error. |
| 13 | Findings exist but no Remediation yet | No scoring effect (§9); the report's separate governance-signal section shows the open Finding count as-is. |
| 14 | Validated Remediation exists | No *direct* scoring effect on the current `MaturityAssessment` (§9) — its only effect is indirect, via a reassessment that would feed a **future** `MaturityAssessment`, never this one retroactively. |

---

## 16. Reporting

R1 is not modified by this document (explicit non-goal). This section
identifies the future integration point only.

**Numeric maturity** (the part §19's formula produces):

- Overall score (1–5) + resolved `maturity_level` label.
- Per-domain scores (1–5) + labels, using the Milestone 8A domain
  snapshot fields so a historical report never drifts if a domain is
  later renamed.
- The `MaturityAssessment.status` (draft/finalized) — a draft result
  must render as **"Provisional"**, visually distinct, never presented
  with a finalized result's own confidence (§6).

**Supporting governance signals** (never blended into the numeric
score — always a clearly separate section):

- Response distribution (count of `implemented`/`partially_implemented`/
  `not_implemented`/`not_applicable`/unassessed, per domain and
  overall).
- N/A count, with each `EngagementScopeControl.rationale` (D3) —
  directly answers "why is this control not applicable" for every
  excluded control, satisfying the "explainable to a client"
  requirement.
- Undecided count — a genuine transparency signal: "this many controls
  have not yet had a Scope decision made."
- Evidence coverage % (§8, computed live, not persisted).
- Control-testing coverage % (share of scored controls with at least
  one `ControlTest`).
- Top weaknesses — the lowest-rated scored controls, plainly listed
  (no invented "risk of X" language; the existing `Finding`/`Risk`
  objects already do that, linked separately below).
- Risk/Finding summary — counts by rating/severity/status, read from
  the existing `Risk`/`Finding` domain functions R1 already has
  precedent for reading, not duplicated into Maturity's own tables.
- Remediation status — counts by `RemediationAction.status`.

This mirrors R1's own existing separation of concerns exactly
(`EngagementReportData`'s `risks`/`findings`/`remediationActions`/
`validationRecords`/`evidenceItems` are already independent arrays
alongside `selectedAssessment` — a future `maturity` field would be one
more sibling of that same shape, not a redesign of the interface).

---

## 17. Security / Authorization

**No maturity-*read* permission is required beyond what already
exists.** `requireEngagementAccess` (the same broad check every other
engagement-scoped read in this codebase uses — Risk, Finding, Data
Landscape, Scope) is sufficient and consistent; `PRODUCT_UX_BLUEPRINT.md
:506`'s "Maturity view" row shows no narrower grant than plain
engagement/organisation access for any internal role, and client
visibility is already correctly gated by `MaturityAssessment.status =
'finalized'` alone (`:542`) — a status check, not a new permission.

**One new, dedicated permission is recommended for the *compute/finalize*
action — proposed, not implemented:** `maturity.compute` (or
`maturity.finalize` — naming is an open decision, §22), granted to
**Engagement Manager only**, mirroring the exact precedent this
codebase has now established twice: `assessment.finalize` (Slice C7.3)
and `scope.lock` (Slice D3) are both narrow, dedicated, single-role
permissions gating an irreversible "this consultant-tier judgment is now
official" action, deliberately never reused for each other even though
they currently resolve to the same role (D3, DECISIONS.md R-141's own
reasoning). `PRODUCT_UX_BLUEPRINT.md:507`'s own "Maturity compute/
finalize | ... C,F (Engagement Manager)" row independently confirms
Engagement Manager as the intended holder — this recommendation is not
inventing a new role shape, it is extending an already-stated intent
with the one missing permission key.

**Why not reuse `assessment.finalize` or `scope.lock`?** Same reasoning
D3 already established for keeping `scope.lock` separate from
`assessment.finalize`: computing/finalizing Maturity is a conceptually
distinct governance event on a distinct object (`MaturityAssessment`,
not `Assessment` or `EngagementScope`), and collapsing it into either
existing permission would make it impossible to later grant one without
the others without a further migration.

**No accidental privilege-escalation path exists:** the compute action
only ever *reads* already-access-checked `AssessmentResponse`/
`AssessmentControl`/`EngagementScopeControl` rows (themselves protected
by their own existing RLS) and *writes* rows scoped by the same
`engagement_id`/`organisation_id`/`tenant_id` triple every other write
in this codebase uses — it introduces no new read path into data the
caller could not already reach.

---

## 18. Data Model Impact

**Recommendation: (A) pure derived calculation — reading exclusively
from already-existing tables, writing exclusively into already-existing
tables. No schema change of any kind.**

Evaluated against the brief's own four options:

- **(A) Pure derived calculation from existing Assessment facts.**
  This *is* the recommendation, for the read side: `AssessmentControl`,
  `AssessmentResponse`, `MaturityDomainControlMapping`,
  `MaturityDomainWeight`, and `MaturityScoringMethodology.definition`
  are the entire input set, and every one of them already exists,
  fully built, since Milestone 5/8.
- **(B) Snapshot score stored on Assessment.** Rejected as redundant —
  `MaturityScore`/`MaturityAssessment` already *are* exactly this
  snapshot, one level removed via a clean FK rather than new columns
  bolted onto `assessments`. Adding a second snapshot location would
  create two sources of truth for the same fact.
- **(C) Separate maturity result table.** Already built — this is
  `maturity_assessments`/`maturity_scores`. Nothing further is needed.
- **(D) Methodology-versioned maturity configuration.** Already built —
  this is `maturity_scoring_methodologies`. Nothing further is needed.

**The historical-reproducibility principle is fully preserved with zero
new persistence**, because every fact the formula reads is *already*
either immutable-once-finalized (`AssessmentResponse`,
`AssessmentControl.applicability_decision`) or itself
append-only/pinned-by-id (`MaturityDomainWeight`,
`MaturityScoringMethodology`) — the calculation has nothing volatile to
protect against that the existing schema does not already freeze.

The only genuinely new artifact this design implies is **application
code** (a domain module) that reads the above and writes into
`maturity_assessments`/`maturity_scores` exactly as `tests/maturity/
helpers.ts`'s fixture builders already do by hand — see §21.

---

## 19. Recommended MVP Methodology

1. **Maturity object:** one `MaturityAssessment` per finalized
   `Assessment` (§3) — already the built model.
2. **Inputs:** the target `Assessment`'s `AssessmentControl` rows (with
   their `applicability_decision` snapshot and any `AssessmentResponse`),
   the Tenant's `MaturityDomainControlMapping`s, the Engagement's active
   `MaturityDomainWeight`s, and the Tenant's active
   `MaturityScoringMethodology.definition`.
3. **Control response mapping:** `rating_scores[effectiveness_rating]`
   from the pinned methodology; a `null`/absent mapping (default:
   `not_applicable`, `not_assessed`, and an absent response row) excludes
   the control from both numerator and denominator (§4).
4. **Scope treatment:** `applicability_decision = 'not_applicable'`
   excludes; `'undecided'`/`'applicable'` both include, scored per (3)
   (§5).
5. **Denominator:** per domain, the count of that domain's mapped
   Controls that are present as `AssessmentControl`s in this Assessment,
   not Scope-excluded, and have a scorable response (§4/§5).
6. **Weighting:** equal weight per control within a domain (plain mean);
   `MaturityDomainWeight.weight` across domains for the overall score,
   normalized by the sum of weights actually used — **not** assumed to
   sum to any fixed total (§10).
7. **Control testing treatment:** no numeric effect; `computed_from_
   control_test_ids` records which `ControlTest` rows existed at
   computation time (§7).
8. **Evidence treatment:** no numeric effect; evidence coverage is a
   derived, report-only statistic (§8).
9. **Risk treatment:** no numeric effect; `computed_from_risk_ids`
   records which `Risk` rows were considered (§9).
10. **Finding treatment:** no numeric effect; reported separately (§9).
11. **Remediation treatment:** no numeric effect; only a **future**
    reassessment (a new Assessment) can change a **future**
    `MaturityAssessment` (§9).
12. **Validation treatment:** no numeric effect on the current
    computation; `computed_from_validation_record_ids` records which
    `ValidationRecord` rows were considered; the only real effect is the
    indirect reassessment path (§9).
13. **Overall formula, explicitly:**

    ```
    For each MaturityDomain D mapped to at least one eligible control:
      eligible(D) = { AssessmentControl ac :
                        ac.control mapped to D
                        AND ac.applicability_decision != 'not_applicable'
                        AND ac has an AssessmentResponse
                        AND response.effectiveness_rating maps to a
                            non-null value in rating_scores }

      raw(D)   = mean( rating_scores[response.effectiveness_rating]
                        for ac in eligible(D) )          -- undefined if eligible(D) is empty
      score(D) = round_half_up( raw(D) ), clamped to [1,5]
      level(D) = methodology.levels bucket containing score(D)

    domains_scored = { D : eligible(D) is non-empty }
    IF domains_scored is empty:
      refuse to compute — no MaturityAssessment is created (edge case §15 #2/#3/#4)

    raw(overall)   = Σ( score(D) * weight(D) for D in domains_scored )
                     / Σ( weight(D) for D in domains_scored )
    score(overall) = round_half_up( raw(overall) ), clamped to [1,5]
    level(overall) = methodology.levels bucket containing score(overall)
    ```

    One `MaturityScore` row is written per `D in domains_scored`
    (`maturity_domain_id = D.id`, pinning the specific active
    `MaturityDomainWeight` row used), plus exactly one overall row
    (`maturity_domain_id = NULL`). A domain with no eligible controls
    gets **no row at all** — not a fabricated score, not a `NULL` score
    (the column is `NOT NULL`) — consistent with §15's edge-case table.

14. **Maturity levels:** the 1–5 / Ad Hoc–Optimized scale in §11,
    recommended as the default `MaturityScoringMethodology.definition`,
    remaining fully Tenant-configurable.
15. **Rounding:** round-half-up, then classify (§11).
16. **Draft/finalized semantics:** compute always produces a *draft*
    `MaturityAssessment`; an explicit second action finalizes it
    (`maturity.compute`-permission-gated, §17); a stale draft is
    discarded and recomputed, never edited (§6/§13).
17. **Historical semantics:** finalized `MaturityAssessment`s are
    immutable by existing construction; nothing in this formula or its
    inputs can retroactively alter one (§13).
18. **Comparison semantics:** two results are comparable when they share
    the same `maturity_scoring_methodology_id`; domain identity is
    compared via the frozen domain snapshot fields, not the live
    `MaturityDomain` row (§14). Not implemented this slice.
19. **Edge-case semantics:** as tabulated in §15, in full.

---

## 20. Alternatives Considered

**1. Recommended — Domain-weighted mean of configurable per-rating
scores (§19), computed once per finalized Assessment.**
*Formula:* as in §19. *Advantages:* uses 100% of the already-built
schema with zero new tables; matches the repository's own worked
example exactly; fully configurable per Tenant without code changes;
every number is traceable to a specific, frozen input set.
*Disadvantages:* domain/weight configuration quality is entirely the
Tenant's own responsibility — a poorly-mapped `MaturityDomainControlMapping`
set produces a poorly-grounded score (a governance problem, not an
engine flaw). *Complexity:* low — one read-heavy, side-effect-free
domain function. *Auditability:* high — every score row carries its own
`computed_from_*` traceability arrays and pinned config ids.
*Gaming risk:* the only lever a Tenant/consultant has is marking
controls N/A, which is rationale-gated and always visibly reported
(§5/§15) — low, and structurally mitigated rather than merely
discouraged. *Fit for MVP:* exact fit — this is the "smallest
methodology the existing, already-tested schema is designed to support."

**2. Simple unweighted mean of all applicable controls (no domain
grouping at all — i.e. Option A weighting, ignoring `MaturityDomain`
entirely, one flat overall score only).**
*Formula:* `score = round(mean(rating_scores[r] for every eligible
AssessmentControl))`, no per-domain rows. *Advantages:* simpler to
explain in one sentence; no dependency on Tenants correctly maintaining
`MaturityDomainControlMapping`. *Disadvantages:* discards
`MaturityDomain`/`MaturityDomainWeight` entirely — two fully-built,
fully-tested tables would sit permanently unused, contradicting
`PRODUCT_SPEC.md:172`'s explicit "configurable domain weighting"
requirement and `MaturityScore.maturity_domain_id`'s own
nullable-for-the-exception design (§12). *Complexity:* lower than
Option 1, marginally. *Auditability:* good, but coarser — a client
cannot see *which area* is weak, only an overall number.
*Gaming risk:* identical to Option 1. *Fit for MVP:* rejected — it is
simpler only by throwing away product-required, already-built
functionality, not by being a better fit for what this repository
actually specifies.

**3. Risk-adjusted maturity (residual `Risk` rating factored
mathematically into the score, e.g. a penalty for each open high/critical
Risk).**
*Formula:* some `score' = score - f(open_risks)` variant.
*Advantages:* would make a "gamed" high score (from a thin Scope or
generous ratings) harder to sustain if real Risk exposure remains high.
*Disadvantages:* directly contradicts `DECISIONS.md` R-79 ("nothing...
derives a numeric score contribution from a Risk's rating") and
`ARCHITECTURE.md`'s explicit "maturity only recalculates from a control
reassessment" business rule — this is not a close call, it is
reversing an existing, twice-stated, CRITICAL architectural decision
with no repository evidence supporting the change. *Complexity:*
meaningfully higher — a second, unapproved formula with its own edge
cases (which Risks, at what weight, computed when). *Auditability:*
worse — "why is my score lower than my control ratings alone would
suggest" is exactly the "hidden scoring behavior" the brief warns
against. *Gaming risk:* arguably lower, but at the cost of
explainability. *Fit for MVP:* rejected outright — out of scope for
this repository's current architecture, not merely a worse MVP choice.

**Recommendation: Option 1 (§19), unambiguously** — it is the only one
of the three that uses the schema Milestone 8 already built, matches
the only worked example the repository provides, and violates no
existing CRITICAL rule.

---

## 21. Implementation Blueprint

**REQUIRED FOR MVP**

- **Domain functions** (new file, `lib/domain/maturity.ts`, mirroring
  `lib/domain/assessments.ts`'s/`lib/domain/applicability.ts`'s shape):
  - `computeMaturityAssessment(db, userId, { assessmentId })` —
    implements §19's algorithm; requires the target `Assessment` to be
    `finalized`; creates one `MaturityAssessment` (`status='draft'`) and
    its `MaturityScore` rows in one transaction; refuses (a named error
    class) if zero domains are scorable.
  - `finalizeMaturityAssessment(db, userId, { maturityAssessmentId })`
    — the one `draft -> finalized` transition, gated by the new
    permission (§17).
  - `discardDraftMaturityAssessment(db, userId, { maturityAssessmentId })`
    — deletes a still-draft `MaturityAssessment` and its `MaturityScore`
    rows (§6/§13), refusing if already finalized.
  - `getMaturityAssessmentDetail`/`listMaturityAssessmentsForEngagement`
    — read functions, gated by the existing broad `requireEngagementAccess`.
- **Schema changes:** none (§18).
- **Migration:** none, **unless** the new `maturity.compute`/
  `maturity.finalize` permission key requires one — it does not: new
  `Permission`/`RolePermission` rows are seed data
  (`db/seed/roles.ts`), the identical precedent D1's `methodology.manage`
  and D3's `scope.lock` both already established; no migration SQL is
  needed for a new permission *key*, only for a new RLS *policy*
  referencing it if any table's write policy needs narrowing — and no
  table here has a pre-existing broad policy to narrow (`maturity_scores`/
  `maturity_assessments` currently have no write policy tied to
  Maturity-specific permissions at all, since nothing writes them yet;
  the RLS policies for these tables would need authoring for the first
  time, mirroring `engagement_scopes_update`'s exact shape from D3 —
  this IS a migration, scoped narrowly to RLS/permission-check policies
  on already-existing tables, not new tables/columns).
- **Authorization:** `requireMaturityComputeAccess`/`canComputeMaturity`
  in `lib/authorization/service.ts`, mirroring
  `requireScopeLockAccess`/`canLockScope` exactly (§17).
- **Routes/UI:** `/organisations/[id]/engagements/[id]/maturity`
  (overview: latest finalized result, "Compute Maturity" action if none
  exists/is stale) and a detail view showing per-domain + overall
  scores, response distribution, N/A/undecided counts with rationale,
  evidence/testing coverage — the smallest coherent screen, no trend
  dashboard (Should-Have, §13).
- **Report integration:** extend `EngagementReportData` with an
  optional `maturity` field (§16); R1's PDF renderer gets one new
  section, following its existing per-section pattern — not a redesign.
- **Tests:** a new `tests/app/maturity.test.ts` (real PostgreSQL,
  mirroring D3's own test file shape) covering: the formula itself
  against several worked scenarios (including re-deriving the exact
  historical-scenario numbers as a regression check), every edge case
  in §15, authorization (Engagement Manager can compute/finalize,
  Consultant cannot, client-side cannot), tenant isolation, and the
  historical-integrity acceptance criterion (revise Scope/edit a draft
  Assessment's responses *after* a `MaturityAssessment` exists, prove
  the existing one is untouched — mirroring D3's own Assessment-snapshot
  test exactly, one level up).
- **Fixture changes:** the reference-engagement fixture would gain one
  real, finalized `MaturityAssessment` for ABC Fintech, built through
  the new domain layer — mirroring exactly how D1/D2/D3 each replaced
  their own raw-SQL fixture construction.
- **Documentation:** `DATA_MODEL.md` §9 gets an "implementation
  clarification" paragraph (matching every prior milestone's own
  pattern) recording the formula as now-implemented, not redesigned;
  `DECISIONS.md` gets the formula's own decision records (the domain
  object, the rounding rule, the N/A/undecided treatment, the new
  permission); `PROGRESS.md`/`REFERENCE_ENGAGEMENT.md` updated the same
  way every prior slice's own implementation was recorded.

**DEFERRED / FUTURE**

- Cross-engagement/cross-period Maturity trend view and dashboards
  (`PRODUCT_SPEC.md:186`, `ROADMAP.md:52` — explicitly Should-Have/Phase 2).
- Populating/reading `Assessment.previous_assessment_id` for a real
  "compare to last period" feature (§14).
- `QualityReview`/Auditor sign-off workflow touching Maturity results.
- Any UI for authoring `MaturityScoringMethodology`/`MaturityDomain`/
  `MaturityDomainControlMapping` beyond what raw SQL/a future
  Methodology-admin slice provides (mirroring D1's own Control Library
  Authoring precedent — a distinct, separately-scoped slice).
- Persisting evidence/testing coverage as stored columns (kept
  derived/report-only, §8, unless a future, concrete need for
  historical coverage trending emerges).
- A Client Portal Maturity view (depends on the still-unbuilt Client
  Portal generally).

---

## 22. Explicit Open Decisions

Recorded here rather than silently resolved, for product sign-off
before implementation:

1. **New permission key naming:** `maturity.compute` vs.
   `maturity.finalize` vs. two separate permissions for "compute a
   draft" and "finalize it" (mirroring how `Assessment` itself splits
   ordinary access from `assessment.finalize`, but Maturity's own
   "compute" is closer to Assessment's own *creation*, which uses only
   plain engagement access, not a dedicated permission — an argument for
   gating only *finalize*, not *compute*, narrowly). This document
   leans toward **gating only `finalizeMaturityAssessment` on a
   dedicated permission, and leaving `computeMaturityAssessment` (which
   only ever produces an internal-only draft) on plain
   `requireEngagementAccess`** — symmetric with how `createAssessment`
   itself needs no dedicated permission, only `finalizeAssessment` does
   — but flags this as worth explicit confirmation before implementation,
   since `PRODUCT_UX_BLUEPRINT.md:507`'s own row bundles "compute/finalize"
   together under one cell.
2. **Rounding convention:** round-half-up is recommended (§11); nothing
   in the repository's own test data disambiguates this from
   round-half-to-even, since no existing example lands exactly on a
   `.5` boundary.
3. **Default `MaturityScoringMethodology`/`MaturityDomain` set**: this
   document recommends carrying the existing test fixture's scale
   (§11) forward as the *default*, but the actual production domain
   taxonomy (e.g. does PRIMUS want "Governance," "Data Management,"
   "Third-Party Risk" as its real launch domains, or a DPDP-specific
   set mapped from the 12 demo control categories?) is a genuine
   methodology/content decision for the practice, not an engineering
   one, and is explicitly out of this document's scope.
4. **`Assessment.previous_assessment_id` population** (§14): whether a
   future comparison feature should start writing it, or rely on
   `period_label`/`created_at` ordering alone.
5. **Discard-vs-recompute UX** for a stale draft `MaturityAssessment`
   (§6/§13): this document recommends explicit delete-then-recompute;
   an alternative (a `superseded` status value added to
   `maturity_assessment_status`) was considered and set aside as an
   unnecessary third state for what is, functionally, "this row was a
   mistake, not a historical fact" — but is worth confirming, since it
   is a genuine (small) schema question, unlike everything else in this
   document.

---

## 23. Final Recommendation

Adopt §19's methodology exactly as specified: a domain-weighted mean of
a fully Tenant-configurable per-rating score map, computed once per
finalized `Assessment` into the *already-built* `MaturityAssessment`/
`MaturityScore` tables, with D3's `AssessmentControl.applicability_decision`
snapshot as the sole scope-exclusion signal (`not_applicable` only),
`AssessmentResponse.effectiveness_rating` as the sole numeric input,
and Risk/Finding/Remediation/Validation/Evidence/ControlTest all
retained purely as traceable, reportable, non-arithmetic signals — a
formalization of the repository's own worked example (§2), not a new
invention. No schema change is required beyond narrow RLS/permission
policies for the one new dedicated permission (§17/§21); no new
persisted entity is required anywhere (§3/§18).

---

**M1 STATUS: DESIGN COMPLETE — AWAITING PRODUCT APPROVAL**
