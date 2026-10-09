# AI Maturity Compass — Assessment, Governance & Value Realization Platform

An enterprise consulting prototype for **Primus Partners** to assess AI readiness and maturity across Indian
enterprises, MSMEs, GCCs, PSUs and government institutions.

It implements the full diagnostic from the source document
[`docs/source/AI readiness assessment.docx`](docs/source/AI%20readiness%20assessment.docx): **100 questions across 12
dimensions**, the weighted **AI Maturity Index**, the **AI Risk & Governance Control Maturity** score, the **AI Value
Realization Score**, the 15 quantitative indicators, an ROI calculator and the India-specific diagnostics.

> **Everything runs in the browser.** No backend, no paid service, no external AI call, no analytics. Data is kept in
> `localStorage` on the device. See [Limitations](#limitations).

## Run it

```bash
cd ai-maturity-compass
npm install

npm run dev          # development server → http://127.0.0.1:5173
npm run build        # type-check + production build → dist/
npm run preview      # serve the production build → http://127.0.0.1:4173   (alias: npm start)

npm run build:artifact  # single self-contained HTML page → dist-artifact/artifact.html (for a sandboxed viewer)

npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright, real Chromium, against the production build)
```

Requires Node 18+ (developed on Node 22). For `test:e2e`, Chromium is expected at `/opt/pw-browsers/chromium`
(override with `CHROMIUM_PATH=/path/to/chrome`); `pdftotext` (poppler) is used to read the generated PDF.

### Single-file build (no install needed to view)

`npm run build:artifact` bundles everything — JS, CSS, charts, PDF generator — into one HTML page
(`dist-artifact/artifact.html`, ~1.8 MB, no network requests). It is what was published as a Claude Artifact. In that build:
the router is in-memory (the viewer's URL is never rewritten), file exports go through the viewer's `downloads` capability
(the viewer asks you to confirm each save), the print button is hidden (print dialogs are unavailable), and if the viewer blocks
browser storage the app keeps working in memory and says so (changes then last until the page is closed). `e2e/artifact.spec.ts`
loads that page in a sandboxed iframe under a strict CSP to check all of this.

On first launch the app loads a clearly-labelled **illustrative demonstration assessment** (synthetic, fictional
organization). Use **New assessment** to start a blank one — the demo is never overwritten.

## What's in it

| Area | What it does |
|---|---|
| **Executive Overview** | Three principal scores, classification ladder, self-reported vs verified, coverage & evidence-confidence indicators, 12-dimension radar and comparison, maturity distribution, risk/control-gap heatmap, KPI cards, strengths, gaps and next actions. Every tile drills into its detail page. |
| **Assessments** | Create (wizard with draft/resume and sample profiles), open, duplicate, rename, delete (confirmed), submit, reopen, export/import JSON, reset demo data. |
| **Assessment Questionnaire** | All 100 source questions (IDs, wording, weights verbatim). One-at-a-time and compact-list modes, dimension navigation, search, filters, progress, autosave, save-and-exit, review screen before submission. Self-reported score, evidence reference, evidence status, assessor-verified score, observations, improvement notes, Not Applicable and Don't Know / Not Verified. |
| **Evidence & Verification** | Assessor workspace with filters (dimension, ID, verification status, criticality, missing evidence, N/A, DK/NV, awaiting), side-by-side self vs verified, review-completion tracking. Evidence is *verified* only when an assessor marks it **Accepted**. |
| **AI Maturity Analysis** | Index composition, dimension drill-down, **quantitative indicators** (15, with numerator/denominator/period/source/validation) and **India-specific diagnostics** (separate from the core index). |
| **Risk & Governance** | Control-maturity score (higher = stronger controls), component scores, critical-control deficiencies, **advisory maturity gate** with assessor confirm/override workflow, heatmap. |
| **Value Realization** | Six-component score, **ROI calculator**, provisional ROI bands, outcome KPIs, sustainability evidence, per-item scoring transparency. |
| **Recommendations & Roadmap** | Rule-generated, prioritized, editable recommendations (priority, owner, status, window, notes, custom initiatives) and a 0–6 / 6–12 / 12–24 month roadmap. Edits persist. |
| **Benchmarking** | Filters by sector, type, size, period and classification. Three provenance classes kept apart (illustrative synthetic · local assessments · externally supplied). Pooling and small-cohort warnings. JSON import for genuine data. |
| **Reports** | Client-facing **PDF** (vector charts, 12+ pages), **printable view**, and **CSV** exports (questionnaire, dimension scores, principal scores, indicators, recommendations, India diagnostics) + JSON export. |
| **Settings** | Assessor profile, per-assessment scoring policy (coverage threshold, emphasis factor, gates, quantitative bands, India composite), local-data management, methodology and limitations. |

## Scoring (single source of truth: `src/scoring/`)

All dashboards, charts, recommendations, reports and exports call `computeResults(assessment)`; no score is hardcoded.

* **AI Maturity Index** = Σ over dimensions `W_d × (Σ S_di ÷ (4 × N_d))`, `S` = applicable **assessor-verified** score (0–4),
  `N` = applicable verified questions. Bands (unrounded): 0–20 Nascent · >20–40 Exploring · >40–60 Emerging ·
  >60–80 Advanced · >80–100 Leading.
* **Not Applicable** leaves the denominator. **Don't Know / Not Verified** and blanks are *evidence gaps*, never zero.
* **Self-reported** and **verified** scores are computed independently, each with its own coverage; one never
  substitutes for the other.
* A dimension with no verified score is **unscored**. The index is then **provisional** and renormalized over the
  scored weight, with the limitation disclosed (and a configurable per-dimension coverage threshold).
* **Risk & Governance Control Maturity**: G01–G09 25% · R01–R09 25% · C01–C08 25% · D01–D10 (emphasizing D02/D06/D08/D09) 10% ·
  S04/S05/S09/S10 5% · F02–F05 10%. Higher is stronger. The D-emphasis factor (default 2×) is configurable because the
  source gives no number.
* **Value Realization**: financial 25% · productivity 20% · strategic impact 20% · adoption 15% (U02, U03, U04, U08, U10) ·
  measurement discipline 10% (V02–V08) · sustainability 10% (U09, U10, V07, V08, F01, F02). Missing data leaves a component
  unscored. ROI = `((Verified benefits − Total costs) ÷ Total costs) × 100`, banded with the **provisional** source
  thresholds (not industry benchmarks).
* **Gates** are advisory: a verified critical security/privacy/responsible-AI deficiency flags the classification for review
  and proposes a ceiling that only applies once an assessor confirms it.

Details and every interpretation made where the source is silent are in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).

## Project structure

```
ai-maturity-compass/
├── docs/
│   ├── METHODOLOGY.md            # scoring rules, interpretations, assumptions
│   └── source/AI readiness assessment.docx
├── scripts/extract_questions.py  # regenerates src/data/sourceSpec.generated.ts from the .docx
├── e2e/app.spec.ts               # Playwright end-to-end tests
├── src/
│   ├── data/                     # spec (dimensions, weights, bands), indicators, India diagnostics, option lists
│   │   └── sourceSpec.generated.ts   # 100 questions + scale + India items, extracted verbatim from the .docx
│   ├── domain/                   # zod schemas (types + storage validation) and factories
│   ├── scoring/                  # maturity · risk · value · gates · indicators/ROI · coverage · India ·
│   │                             # cross-checks · recommendations · review · results (aggregator)
│   ├── store/                    # zustand store, versioned localStorage persistence, demo + sample seeds
│   ├── benchmark/                # synthetic benchmark generator, cohort statistics
│   ├── export/                   # csv, pdf (jsPDF, vector charts), shared report narrative
│   ├── components/               # ui primitives, charts, layout, question editor, indicator/India panels
│   └── pages/                    # the 11 pages + wizard, review, printable report
└── public/
```

## Tests

* `npm test` — scoring engine (maturity, risk, value, gates, indicators, ROI, coverage, recommendations), the 100-question
  specification, storage/migration/corruption handling, store behaviour, CSV and PDF exports, benchmark data.
* `npm run test:e2e` — real-browser flows: first launch, every nav link, persistence across reload, wizard → answer →
  verify → dashboard response, evidence acceptance, roadmap edits, gate confirmation, CSV and PDF downloads (PDF text
  read with `pdftotext`), printable view, benchmarking, assessment management, settings, corrupt-storage recovery, and a
  scan asserting that **no enabled button or link is inert**.

## Limitations

* **Local, single-user prototype.** `localStorage` only: no authentication, no shared multi-user storage, no audit-grade
  access control, no server-side backup. "Reopen for authorized review" is not permission-enforced. Clearing browser data
  deletes assessments (use the JSON export).
* **Benchmarks are synthetic.** The demonstration dataset is generated pseudo-randomly; it is not real industry data and not a
  national ranking. External data can be imported with provenance, but the app cannot independently validate it.
* **Where the source is silent, interpretations are prototype choices** (clearly marked "prototype mapping"/"prototype default"
  in the UI and reports): the D-question emphasis factor, the question mapping for the productivity and business-impact
  value components, the quantitative scoring bands (adoption, hours saved), the critical-control gate list/threshold/ceiling,
  the coverage thresholds, and the cross-check heuristics. All are configurable per assessment where they affect scores.
* **ROI bands are provisional** thresholds from the source, not benchmarks.
* **India diagnostics are not legal advice.** They are scored separately, never enter the core index unless a supplementary
  composite is explicitly enabled, and require an assessment date.
* **No file upload.** Evidence is recorded as text references; the app does not store or scan documents.
* **PDF fonts**: the PDF uses built-in Latin fonts, so Indian-language text typed into notes renders as `?` in the PDF
  (the on-screen printable view renders it correctly). `₹` is written as `INR` in the PDF.
* **Charts**: Recharts 2.x (maintenance mode) is used for bar/histogram charts; the radar is a bespoke SVG.

## Recommended next steps for production

1. Server-side persistence (PostgreSQL), per-organization tenancy, SSO/MFA, role-based access (respondent / assessor /
   reviewer), immutable audit log, and encryption at rest — with data residency decided up front.
2. Evidence vault with malware scanning, hashing and retention rules; assessor workflow with sampling and sign-off.
3. A governed, versioned methodology service so weights, gates and bands are signed off and reproducible per report.
4. Real anonymized benchmark pipeline with minimum-cohort disclosure controls and a documented sector-adjustment
   methodology; replace the synthetic generator.
5. Legal review of the India diagnostics content, and expert validation of the quantitative bands and gate list.
6. Embedded-font PDF (Indian scripts), accessibility audit (WCAG 2.2 AA), and load/security testing.
