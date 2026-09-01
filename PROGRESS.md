# PRIMUS PRIVACY — Progress Log

Status: 2026-09-01 — Session 1 (architecture & repository preparation).

## What Has Been Completed

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
  `DATA_MODEL.md`, `ARCHITECTURE.md`, and `SECURITY.md`).
- Technology stack is selected and justified (`ARCHITECTURE.md` §2):
  Next.js + TypeScript + PostgreSQL + Supabase + Tailwind + shadcn/ui +
  Vercel, with Drizzle proposed (not yet adopted/installed) for
  schema-as-code.
- Two DECISION REQUIRED items are load-bearing for the very first schema
  migration and should be resolved before that migration is written:
  **D-02** (do Data-Landscape objects persist across engagements or get
  re-created per engagement) and **D-01** (single-practice vs.
  multi-practice tenancy) — both change the shape of the
  `Organisation`/`Engagement`/`ProcessingActivity` tables directly. The
  other four DECISION REQUIRED items (D-03 data residency, D-04
  individual-PII/DSR scope, D-05 malware scanning, D-06 billing) do not
  block early schema work but should be resolved before the areas they
  touch are built.

## Next Approved Implementation Step

None yet. Per the brief, this session ends at architecture and repository
preparation. The recommended next step, pending explicit go-ahead and
resolution of D-01/D-02 above, is:

1. Resolve D-01 and D-02 in `DECISIONS.md`.
2. Scaffold the Next.js + TypeScript project (no business logic yet).
3. Provision a Supabase project (region decided per D-03) for local/staging
   development.
4. Write the first migration covering §2–§3 of `DATA_MODEL.md` only
   (Identity & Tenancy, Engagement Structure) with RLS policies, and prove
   tenant isolation with a test before building anything on top of it.

No further work should proceed past step 1 without confirmation from the
product owner.
