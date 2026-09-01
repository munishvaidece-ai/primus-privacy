# PRIMUS PRIVACY — Architecture

Status: Draft v0.3 — no code exists yet; this describes the target
architecture for controlled implementation. Session 2 (2026-09-01) adds
the `Tenant` layer (§4, §5) and the Client Master Data / engagement-scoped
split (§4, §5) resolving DECISIONS.md D-01 and D-02. Session 3 (2026-09-01)
fixes a stale `EngagementMembership`-only reference in the §3 layers
diagram, left over from the Session 2 rewrite.

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
│  │  - resolves user's Tenant/Organisation/Engagement       │   │
│  │    Membership(s) + Role + Permissions for the target    │   │
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
  (user, target tenant/organisation/engagement, action, object), resolves
  and unions whichever of the user's `TenantMembership`,
  `OrganisationMembership`, and `EngagementMembership` rows apply → `Role`
  → `Permission`s, plus any object-level exception (e.g. visibility =
  consultant-internal), and returns allow/deny. Every domain service call
  passes through this before touching data. RLS policies in Postgres
  provide a second, coarser layer (tenant/organisation/engagement scoping)
  so a bug in the application layer cannot leak data across tenants — see
  SECURITY.md for the layering rationale.
- **Engagement workspace** — engagement lifecycle, membership, business
  unit scoping.
- **Client Master Data service** — the client's persistent organisational
  facts: Business Units, Data Principal Categories, Personal Data
  Elements, Purposes, Systems, Data Stores, Processors/Subprocessors. Owns
  the identity+version (SCD2) mechanism described in DATA_MODEL.md §5.1 —
  every edit to a master record's compliance-meaningful fields inserts a
  new version row rather than mutating the current one. This service is
  the only place that resolves "what is the client's current state,"
  independent of any engagement.
- **Data Landscape (engagement) service** — Processing Activities, Data
  Flows, Retention Rules, Notices, and Consent Mechanisms for one
  engagement — connects to Client Master Data through version-pinned
  junctions (DATA_MODEL.md §5.3) rather than owning a copy of that data.
  Owns the "carry forward from prior engagement" action (§5.4) that starts
  a new engagement's Processing Activities from the prior engagement's,
  re-resolved against current master-data versions.
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

**Revised in Session 2 to resolve DECISIONS.md D-01**, per explicit
product-owner direction: multi-tenant from Day 1, single tenant in MVP.

- **Tenant** — the outermost isolation boundary, representing one
  consulting practice's entire deployment. A new `Tenant` table sits above
  `Organisation` (which now represents client organisations exclusively —
  it no longer doubles as "the practice's own record," see DATA_MODEL.md
  §2/DECISIONS.md R-10). **The MVP deployment contains exactly one Tenant
  row (PRIMUS).** Practice-side users (Platform Administrator, Practice
  Partner, Engagement Manager, Consultant, Auditor) belong to this tenant
  directly (`User.tenant_id`, `User.client_org_id = NULL`); the small
  number of genuinely practice-wide roles (Platform Administrator,
  Practice Partner) hold a `TenantMembership`, while the rest gain access
  to a given client's engagement only through an explicit
  `EngagementMembership`, never implicitly — this is unchanged from the
  original design, just now nested one level deeper.
  - **Deliberately not built in MVP**, per direction: white-label
    functionality (custom branding/theming per tenant), a multi-practice
    administration UI, tenant billing/subscription functionality, and
    tenant branding/custom domains. The `Tenant` table itself carries only
    the minimal columns needed for isolation (`id`, `name`, `status`,
    `created_at`) — nothing SaaS-specific is added ahead of a real Phase 3
    requirement for it.
  - **Why introduce the mechanism now if only one row exists:** RLS
    policies and the authorization layer are written against `tenant_id`
    from the first migration onward, so admitting a second practice later
    is a data-provisioning exercise (create a second `Tenant` row, onboard
    its users and clients under it), not a schema or security-model
    redesign. This is the concrete, minimal way to satisfy "must be
    possible to support additional practices... without redesigning the
    fundamental tenancy/security model" without building any Phase-3-only
    feature now.
- **Client organisation** — each client is an `Organisation` row, owned by
  exactly one `Tenant` (`Organisation.tenant_id`); this remains the
  primary tenant-scoped boundary for client data ownership within a
  practice. Client users belong to their own client organisation
  (`User.client_org_id`) and cannot see another client's data under any
  role, regardless of practice. The Client Administrator role's org-wide
  standing access (managing the client's own users) is granted via
  `OrganisationMembership` rather than requiring per-engagement grants
  (DATA_MODEL.md §2, DECISIONS.md R-11).
- **Business Unit** — a subdivision of a Client organisation, used to
  scope engagements or memberships to part of the client; also promoted
  to client-level master data (DATA_MODEL.md §5.1) so its own attributes
  can be tracked historically, while its use as a scope reference stays
  identity-based (DATA_MODEL.md §5.3).
- **Engagement** — the working boundary within a client for
  engagement-scoped assessment objects (Processing Activity, Data Flow,
  Assessment, Evidence, Risk, Finding, Remediation, DPIA, AI Use Case,
  Maturity Assessment, Quality Review — DATA_MODEL.md §5.2). Engagements
  are scoped to a client, which is scoped to a tenant — three nested
  isolation boundaries, all enforced at both the application and RLS
  layers (SECURITY.md §2–§3).
- **Client master data** — Business Units, Data Principal Categories,
  Personal Data Elements, Purposes, Systems, Data Stores, and Processors
  are scoped to the **client organisation**, not to any one engagement
  (DECISIONS.md D-02) — they sit at the same tenancy level as `Engagement`
  itself (both are direct children of `Organisation`), not nested inside
  it. See DATA_MODEL.md §5 for the full mechanism (identity + SCD2 version
  rows, version-pinned junctions from engagement-scoped objects) and §5.5
  for a worked example proving the mechanism answers both "current state"
  and "state as of a specific historical engagement" without overwriting
  history or duplicating the client's landscape per engagement.

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
4. Practice tenant ↔ practice tenant — enforced by `Tenant` scoping
   (`tenant_id`, present directly on `User`/`Organisation` and
   transitively on everything beneath them), the outermost boundary,
   checked in both RLS and the application authorization layer. Exactly
   one tenant exists in MVP, but the boundary is live from the first
   migration.
5. Client organisation ↔ client organisation (within a tenant) — enforced
   by `Organisation`/`Engagement` scoping present on essentially every
   table, checked in both RLS and the application authorization layer.
6. Consultant-internal ↔ client-visible — enforced by an explicit
   `visibility` attribute on notes/evidence/comments, checked server-side
   on every read, not filtered client-side.

## 7. Data Flow (typical request)

1. Browser calls a Server Action (e.g. "submit assessment response").
2. Next.js resolves the authenticated user from the Supabase session.
3. Authorization layer resolves the user's applicable Tenant/Organisation/
   Engagement membership(s), role(s), and permissions for the target
   request; denies if none grant it.
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
- Per DECISIONS.md D-01: the `Tenant` isolation mechanism is built now,
  but nothing else SaaS-shaped is — no white-label/custom-branding
  functionality, no multi-practice administration UI, no tenant
  billing/subscription functionality, no custom domains. These stay
  Phase 3 (ROADMAP.md) and are only built if and when a second practice is
  actually being onboarded.
- Per DECISIONS.md D-02: client master data is versioned in place (§5.1's
  identity+version pattern) rather than by duplicating the client's entire
  data landscape into a fresh copy every engagement — the cheaper
  mechanism that still preserves history.
