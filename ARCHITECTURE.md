# PRIMUS PRIVACY — Architecture

Status: Draft v0.1 — no code exists yet; this describes the target
architecture for controlled implementation.

## 1. Goals and Non-Goals

**Goals:** multi-tenant isolation that holds under load and under mistakes;
server-enforced authorization everywhere; one relational data model that
every view reads from; auditability; a stack the practice can actually
operate without a platform team.

**Non-goals (deliberate simplicity, principle 13):** no microservices, no
message bus, no separate search/analytics cluster, no bespoke auth system,
no AI/ML infrastructure in v1. If a simpler option meets the requirement,
it wins over a more "scalable" one we don't yet need.

## 2. Technology Stack and Rationale

| Layer | Choice | Rationale |
|---|---|---|
| Application framework | **Next.js (App Router) + TypeScript** | Single codebase for UI and server logic; React Server Components + Server Actions let us put authorization checks in server-only code paths by construction, which directly serves "strong server-side authorization" — a client component can request data but cannot itself decide it is allowed to see it. |
| Database | **PostgreSQL** | Mature relational engine with real foreign keys, check constraints, and native Row-Level Security (RLS) — needed for the "real relational data, not disconnected modules" and tenant-isolation requirements. JSONB is available for the few genuinely variable-shape fields (e.g. questionnaire payloads) without abandoning relational integrity elsewhere. |
| Backend-as-a-platform | **Supabase** | Managed Postgres with built-in Auth (JWT-based, row-level-security-aware), private object Storage with signed URLs, point-in-time recovery, and a migration workflow — gives us tenant-aware auth and secure file storage without operating that infrastructure ourselves, consistent with principle 13 (avoid unnecessary infrastructure). |
| Styling | **Tailwind CSS** | Utility CSS keeps styling co-located with markup and avoids a separate design-token build step; low operational overhead. |
| Component layer | **shadcn/ui** | Accessible, unstyled-by-default component primitives copied into the repo (not an opaque npm dependency), so they can be audited and modified — appropriate for an enterprise compliance product where every component is inspectable. |
| Hosting | **Vercel** | First-class Next.js deployment (edge/server functions, preview deployments per branch/PR), no bespoke CI/CD infrastructure to build. |
| Schema / migrations (proposed, not yet installed) | **Drizzle ORM** for typed schema-as-code and migrations, with hand-written SQL migrations for RLS policies (Drizzle does not model RLS well) | Typed queries reduce a class of bugs; RLS policies are security-critical and are easier to review as explicit SQL than generated from an ORM DSL. This is a recorded decision (DECISIONS.md) open to revisiting once real schema work starts. |
| Validation | **Zod** (proposed) | Runtime validation of all input at the server boundary (Server Actions / route handlers), shared with TypeScript types. |

No additional infrastructure (queues, caches, search engines, separate
microservices, container orchestration) is introduced without a specific,
documented reason tied to a real requirement we've hit — not a hypothetical
future one.

## 3. Application Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React Client Components)                          │
│  - renders data it is GIVEN; never decides authorization     │
└───────────────────────────┬───────────────────────────────────┘
                             │ Server Actions / fetch to Route Handlers
┌───────────────────────────▼───────────────────────────────────┐
│  Next.js Server (Server Components, Server Actions,           │
│  Route Handlers) — runs only on the server, never shipped to  │
│  the browser                                                  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Authentication context (Supabase session → user)       │   │
│  └───────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Authorization / Policy layer                           │   │
│  │  - resolves user's EngagementMembership + Role +       │   │
│  │    Permissions for the requested tenant/engagement     │   │
│  │  - denies by default                                   │   │
│  └───────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Domain / service layer (per bounded area: Engagement,  │   │
│  │  Data Landscape, Assessment Engine, Risk & Findings,    │   │
│  │  Remediation & Validation, Maturity, Evidence, Audit,   │   │
│  │  Reporting)                                             │   │
│  │  - Zod-validated input                                  │   │
│  │  - business rules (e.g. "finalized assessment is        │   │
│  │    immutable"; "maturity only recalculates from a       │   │
│  │    control reassessment")                                │   │
│  └───────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ Data access (typed queries; every query is tenant- and  │   │
│  │  engagement-scoped by construction, not by convention)   │   │
│  └───────────────────────────────────────────────────────┘   │
└───────────────────────────┬───────────────────────────────────┘
                             │ Postgres wire protocol (server-role
                             │ credentials, never shipped to browser)
┌───────────────────────────▼───────────────────────────────────┐
│  Supabase Postgres                                             │
│  - RLS policies as a tenant-isolation backstop                 │
│  - foreign keys / check constraints enforce data integrity     │
│  - append-only audit_log table (no UPDATE/DELETE grants)       │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  Supabase Storage (private buckets)                              │
│  - evidence/documents, never public                              │
│  - access only via short-lived signed URLs issued after a        │
│    server-side authorization check                               │
└─────────────────────────────────────────────────────────────────┘
```

The critical property this enforces: **a browser can never obtain a
database credential or an unscoped query.** Every read and write is
mediated by server code that has already resolved *who* is asking and
*what tenant/engagement context* they're asking within.

## 4. Major Components

- **Auth** — Supabase Auth (email/password + SSO in a later phase). Issues
  a session whose JWT carries the user id; all tenant/role resolution
  happens server-side against the database, not by trusting claims baked
  into the JWT beyond identity.
- **Authorization / Policy engine** — a server-only module that, given
  (user, engagement, action, object), resolves the user's
  `EngagementMembership` → `Role` → `Permission`s, plus any object-level
  exception (e.g. visibility = consultant-internal), and returns
  allow/deny. Every domain service call passes through this before touching
  data. RLS policies in Postgres provide a second, coarser layer (tenant/
  engagement scoping) so a bug in the application layer cannot leak data
  across tenants — see SECURITY.md for the layering rationale.
- **Engagement workspace** — engagement lifecycle, membership, business
  unit scoping.
- **Data Landscape service** — Processing Activities and everything that
  connects to them (data principals, personal data elements, purposes,
  systems, data stores, processors/subprocessors, data flows, retention,
  notices, consent mechanism).
- **Assessment engine** — regulatory reference/requirement/control library
  (versioned, separate from client data), assessments, assessment
  responses, control tests, and the DPIA/SDF-screening specializations of
  the same engine (see DATA_MODEL.md §7).
- **Risk & Findings service** — risk register with a configurable scoring
  model (a `RiskScoringModel` row, not code); findings linking risks,
  controls, processing activities and evidence.
- **Remediation & Validation service** — enforces the required sequence
  (remediation → evidence → consultant validation → control reassessment)
  as an explicit state machine, not an implicit convention.
- **Maturity engine** — pure computation over current control results and
  configurable domain weights; produces a versioned `MaturityScore` per
  assessment period; never writable directly by a user action.
- **Evidence / document service** — the only path to Supabase Storage;
  issues signed URLs after authorization + visibility checks; records every
  access.
- **Audit service** — appends to `audit_log` on every material write from
  the domain layer (not from client-supplied data); no application code
  path can update or delete an audit row.
- **Task & Notification service** — generic, polymorphic task assignment
  and in-app notification, reused across every workflow instead of a
  bespoke "reminder" mechanism per module.
- **Reporting** — server-side queries/aggregations over the live model,
  rendered per the requester's visibility scope; not a separately
  maintained reporting datastore.

## 5. Tenancy Model

- **Practice organisation** — PRIMUS itself, represented as a single
  `Organisation` row of type `PRACTICE`. Practice-side users
  (Administrator, Partner, Engagement Manager, Consultant, Auditor) belong
  to it as their home organisation, and gain access to a given client's
  engagement only through an explicit `EngagementMembership`, never
  implicitly.
- **Client organisation** — each client is an `Organisation` row of type
  `CLIENT`; this is the primary tenant boundary for data ownership. Client
  users belong to their own client organisation and cannot see another
  client's data under any role.
- **Business Unit** — an optional subdivision of a Client organisation,
  used to scope engagements or memberships to part of the client.
- **Engagement** — the working boundary within a client: almost every
  operational entity (Processing Activity, Assessment, Risk, Finding,
  Evidence, …) is scoped to an engagement, and engagements are scoped to a
  client. See DATA_MODEL.md §12 for the specific decision on whether
  Data-Landscape objects persist across engagements or are engagement-local
  (flagged DECISION REQUIRED).
- Whether the platform will ever host more than one consulting practice
  (white-label) is an open, materially architecture-affecting question —
  see DECISIONS.md.

## 6. Security Boundaries

See SECURITY.md for the full model. In architectural terms, the boundaries
are:

1. Browser ↔ Next.js server — untrusted input boundary; every request is
   re-authenticated and re-authorized server-side regardless of what the
   client believes it's allowed to do.
2. Next.js server ↔ Postgres — only server processes hold database
   credentials; RLS is enabled as defense-in-depth, not as the only
   control.
3. Next.js server ↔ Supabase Storage — evidence files are never
   public-bucket; access is always mediated by a signed URL minted after
   an authorization check, with a short TTL.
4. Client tenant ↔ client tenant — enforced by `Organisation`/`Engagement`
   scoping present on essentially every table, checked in both RLS and the
   application authorization layer.
5. Consultant-internal ↔ client-visible — enforced by an explicit
   `visibility` attribute on notes/evidence/comments, checked server-side
   on every read, not filtered client-side.

## 7. Data Flow (typical request)

1. Browser calls a Server Action (e.g. "submit assessment response").
2. Next.js resolves the authenticated user from the Supabase session.
3. Authorization layer resolves the user's membership/role/permissions for
   the target engagement; denies if absent.
4. Domain service validates input (Zod), applies business rules (e.g.
   "cannot edit a finalized assessment"), executes the write inside a
   transaction.
5. Audit service appends an `audit_log` row describing the change.
6. Postgres RLS policies re-validate tenant/engagement scoping as a second
   check on the same query.
7. Response returns only the fields the caller's role is allowed to see.

## 8. External Services

- **Supabase** (Postgres, Auth, Storage, backups) — the only external
  platform dependency in MVP.
- **Vercel** — hosting/deployment.
- No AI/LLM provider is integrated in MVP (principle 14: don't prematurely
  build AI). Any future AI feature (e.g. drafting assistance) is additive,
  clearly labeled as a suggestion, and subject to the same
  suggest/accept/modify/reject pattern already required for other system
  recommendations.
- No email/SMS provider yet (in-app notifications only in MVP); a transactional
  email provider is a Phase 2 addition, not introduced speculatively now.

## 9. Deployment Model

- **Environments:** local development, a staging Supabase project +
  Vercel preview deployments (per pull request), and a production Supabase
  project + Vercel production deployment. Environments do not share a
  database.
- **Migrations:** applied via versioned SQL migration files, run against
  staging first, then production, as a deliberate step — never generated
  ad hoc against a live database.
- **Secrets:** Supabase service-role key and any other server secret is
  stored in Vercel/Supabase environment configuration, never committed to
  the repository, and never referenced from client-side code (see
  SECURITY.md §7).
- **Data residency:** the Supabase project region is a decision with real
  legal weight for a DPDP-focused product and client contracts — flagged
  DECISION REQUIRED in DECISIONS.md; no region has been chosen yet.

## 10. Explicitly Avoided Complexity

- No microservice split — one Next.js application is sufficient at this
  scale and keeps the "one source of truth" principle easy to enforce (a
  service boundary is exactly where duplicated data tends to creep in).
- No separate reporting/analytics database — reports are queries over the
  primary schema.
- No custom-built authentication system.
- No premature multi-region or multi-database sharding.
- No AI infrastructure until a specific, scoped feature calls for it.
