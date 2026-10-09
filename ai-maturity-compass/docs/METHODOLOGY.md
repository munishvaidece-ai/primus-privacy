# Methodology and interpretation notes

Authoritative source: `docs/source/AI readiness assessment.docx`. Everything below is either *from the source* or an
explicit, labelled *prototype interpretation*. The scoring code lives in `src/scoring/`; `src/data/spec.ts` holds the
constants.

## 1. Questionnaire

100 questions, 12 dimensions, extracted programmatically (`scripts/extract_questions.py`) from the document's tables so
IDs and wording are verbatim. The script asserts: 100 unique IDs, per-dimension counts match the summary table, weights sum
to 100, five maturity levels, ten India diagnostics.

| # | Dimension | Qs | Weight |
|---|---|---|---|
| 1 | AI Strategy & Leadership (S01–S10) | 10 | 10% |
| 2 | Governance & Operating Model (G01–G09) | 9 | 10% |
| 3 | Data Readiness & Governance (D01–D10) | 10 | 12% |
| 4 | Technology & AI Infrastructure (T01–T09) | 9 | 10% |
| 5 | AI Adoption & Use Cases (U01–U10) | 10 | 12% |
| 6 | Talent, Skills & Workforce Readiness (H01–H09) | 9 | 8% |
| 7 | Responsible AI, Ethics & Trust (R01–R09) | 9 | 10% |
| 8 | Cybersecurity, Privacy & Operational Resilience (C01–C08) | 8 | 10% |
| 9 | AI Investments, ROI & Value Realization (V01–V08) | 8 | 8% |
| 10 | Innovation, R&D & Ecosystem (I01–I06) | 6 | 4% |
| 11 | Organizational Culture & Change Management (O01–O06) | 6 | 3% |
| 12 | AI Scaling, Monitoring & Future Readiness (F01–F06) | 6 | 3% |

Dimension display names follow the product brief; the source's slightly different table/heading names are preserved as
`sourceTableName` / `sourceHeading`.

Scale (verbatim): 0 Not initiated · 1 Ad hoc · 2 Emerging · 3 Established · 4 Advanced.

## 2. How a response counts

| State | Self basis | Verified basis |
|---|---|---|
| Scored 0–4 | counts | counts only if the *assessor* scored it |
| Not Applicable | excluded from denominator | excluded (assessor N/A, or self-declared N/A not yet reviewed — flagged "unconfirmed") |
| Don't Know / Not Verified | evidence gap | evidence gap (self DK, or assessor "not verified") |
| Blank / awaiting | pending | pending (assessor has not acted) |

Gaps and pending items are never averaged in as zeros; they lower **coverage** (`scored ÷ applicable`).

## 3. AI Maturity Index

`Index = Σ_d W_d × (Σ_i S_di ÷ (4 N_d))`. Dimension score = `mean/4 × 100`; contribution = `weight × score/100`.

* A dimension with `N_d = 0` is **unscored** (reason: no scores, or all N/A).
* If any dimension is unscored the index is **provisional**: `Σ contributions ÷ Σ eligible weights × 100`.
* A scored dimension below the configured coverage (default 70% of applicable questions) is **partial** ("limited coverage"),
  which also makes the index provisional.
* Classification boundaries use unrounded values: ≤20, >20–40, >40–60, >60–80, >80.
* The verified and self-reported indices are independent; their difference is reported but never substituted.

## 4. AI Risk & Governance Control Maturity

Components and weights are from the source (G 25, R 25, C 25, D 10, S-subset 5, F-subset 10). Within a component the score is
the weighted mean of its scored questions ÷ 4 × 100.

*Interpretation:* the source says Data governance should "emphasize" D02, D06, D08 and D09 but gives no factor. The prototype
uses weight 2× for those four inside the component (configurable 1×–3×).

Higher = stronger assessed controls. The score is never inverted.

### Advisory maturity gates

Source: *"Apply risk-based scoring gates. Organizations with severe deficiencies in AI security, privacy or responsible AI should
not receive the highest maturity classification purely because of strong adoption."*

*Interpretation (all configurable):* critical controls — security C01, C02, C03, C05, C06, C07; privacy C04, D09; responsible AI R02,
R03, R05, R06. A **verified** score ≤ 1 is a critical deficiency. Advisory ceiling: AI Emerging. The gate **flags** the classification
for review; the ceiling takes effect only when an assessor **confirms** it (or the assessor can override with a reason). Self-reported
deficiencies and unverified critical controls are listed as a watch list but do not trigger the gate.

## 5. AI Value Realization Score

Weights from the source. Each component is the mean (0–4) of its **available** items; items are questionnaire scores and
quantitative evidence.

| Component | Weight | Items | Mapping |
|---|---|---|---|
| Financial value delivered | 25% | verified AI ROI band | source |
| Productivity and efficiency gains | 20% | V04, V05, U09 + verified hours saved / employee / month | **prototype** (source names none) |
| Business and strategic impact | 20% | V05, V06 + assessor-rated outcome KPIs | **prototype** |
| AI adoption and utilization | 15% | U02, U03, U04, U08, U10 + adoption penetration | source |
| Value measurement discipline | 10% | V02–V08 | source |
| Value sustainability and scaling | 10% | U09, U10, V07, V08, F01, F02 + recurring-benefit evidence | source |

ROI = `((Verified AI Benefits − Total AI Costs) ÷ Total AI Costs) × 100`; zero/missing costs → undefined (never 0, never ∞).
Bands (source, **provisional, not industry benchmarks**): ≤0% → 0; >0–10% → 1; >10–25% → 2; >25–50% → 3; >50% → 4.

On the **verified basis** a quantitative item only counts when an assessor has marked it verified (ROI uses *verified* benefits only).
Prototype quantitative bands (lower bounds for scores 1–4): adoption penetration 5/20/40/60 %; hours saved 0.5/2/4/8.

## 6. Quantitative indicators

The 15 indicators and their "suggested measurement" are verbatim. Each captures numerator, denominator, units, reporting period,
data source, evidence note and a verified flag. Validation: no negatives, no zero/negative denominators, percentages cannot exceed
100% (numerator ≤ denominator), counts must be whole numbers, monthly rates need a period, growth needs a prior period that ends
before the current one and is of similar length, annual indicators warn when the period is not ~12 months, and indicators whose
annual periods differ are flagged so they are not combined.

Cross-checks (prototype heuristics, not benchmarks) flag when a score of 3+ coexists with a weak related indicator (e.g. U08 vs
adoption penetration) to prompt assessor follow-up.

## 7. India-specific diagnostics

Ten areas, wording verbatim. Applicability: applicable / not applicable / not assessed. Scored (self and verified) separately,
**never** in the core index. An optional supplementary composite `(1−w)·core + w·India` (default off, w ≤ 50%) can be displayed —
the core index is unchanged. An assessment-date field is provided; the section is labelled a diagnostic, not a legal opinion.

## 8. Evidence confidence

Four separate notions are never conflated: *referenced* (text entered), *reviewed* (assessor recorded any outcome), *accepted*
(assessor-verified evidence), *rejected / clarification required*. Prototype confidence label from the share of applicable questions
with accepted evidence: ≥75% high, ≥50% moderate, ≥25% low, otherwise very low.

## 9. Recommendations

Rule-based and transparent; ordered by (1) verified critical-control deficiencies, (2) unverified critical controls, (3) dimension
gaps weighted by `dimension weight × shortfall from Established`, (4) evidence/coverage gaps, (5) cross-check and measurement gaps,
(6) India gaps, (7) enhancement of strong dimensions (12–24 months). Texts come from a per-dimension library; no financial benefit is
quoted. User edits are stored as overrides keyed by stable recommendation ID and survive regeneration.

## 10. Benchmarking

Synthetic records use a seeded PRNG (`mulberry32`) with sector/size/type offsets; each record's index equals the weighted sum of its
dimension scores. Provenance classes are `synthetic_demo`, `local_assessment` and `external_supplied`; the UI compares against one at a
time. Local records exclude demo, draft and incompletely-scored assessments (with reasons shown).
