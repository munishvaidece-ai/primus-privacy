# PRIMUS PRIVACY — Security Model

Status: Draft v0.3 — target design for controlled implementation. No
authentication, authorization, or storage code exists yet. Session 2
(2026-09-01) adds the `Tenant` isolation layer resolved in DECISIONS.md
D-01 to §2–§3. Session 3 (2026-09-01) extends §6's audit-log material-change
list to explicitly cover `ApplicabilityDetermination`, the methodology
entities, and the scoring-configuration entities (R-16), and fixes a stale
`EngagementMembership`-only reference in §14's threat table.

This platform stores client organisations' confidential compliance
posture, risk data, and evidence documents — treat every design decision
here as if a breach would mean real client harm, because it would.

## 1. Authentication

- **Supabase Auth** (email/password at MVP; SSO is a later-phase addition,
  see ROADMAP.md) issues sessions; Next.js server code resolves the
  authenticated user from the session on every request — never trusts a
  user id passed from the client.
- Password policy and session expiry follow Supabase Auth defaults,
  tightened for enterprise use (session TTL, forced re-auth for
  sensitive actions such as changing another user's role).
- MFA is a Phase 2 item for client-admin and all PRIMUS-side roles at
  minimum (see ROADMAP.md) — not in MVP, but the auth provider chosen
  supports it without a migration.
- Multi-tenant login must not allow a user to discover which
  organisations exist by email-enumeration side channels (generic error
  messages on login/reset flows).

## 2. Authorization Model

**Revised in Session 2** to add the `Tenant` layer resolved in DECISIONS.md
D-01. Authorization is enforced **server-side, on every read and write**,
never by omitting a button in the UI. Two layers, deliberately redundant:

1. **Application-layer policy check** — before any domain service touches
   data, it resolves and unions whichever of the caller's
   `TenantMembership`, `OrganisationMembership`, and `EngagementMembership`
   rows apply to the request → `Role` → `Permission`s, plus any
   object-level exception (chiefly the `visibility` attribute on
   Evidence/Notes). This is where the *business* authorization rules live —
   e.g. "only a role with `assessment_response.write` may edit a response,
   and only while `Assessment.status = DRAFT`," or "only a role with
   `master_data.system.write` may create a new `SystemVersion` for this
   client." Deny by default: no permission match ⇒ no access, not "no
   restriction found ⇒ allow."
2. **Database-layer RLS (Row-Level Security)** — every tenant-scoped table
   has an RLS policy keyed on the caller's tenant/organisation/engagement
   membership, enforced by Postgres itself. This exists specifically so a
   bug in the application layer (a missing `WHERE tenant_id = ?` or
   `WHERE engagement_id = ?`, a forgotten check) cannot leak data across
   tenants — RLS is the backstop, not the primary control, because RLS
   policies are a poor fit for the more dynamic parts of the model
   (role/permission matrices, the consultant-internal/client-visible
   split) but are an excellent fit for the one rule that must never fail:
   *this row belongs to that tenant (and, within it, that client
   organisation)*.

Both layers must independently deny access to another tenant's data; if
they ever disagree, that disagreement is itself a bug to fix immediately,
not a signal to relax either layer.

Permissions are **role + scope (tenant, organisation, or engagement) +
optionally object-level**, per the product brief:
- Role determines the default permission set for a user within whichever
  scope they hold membership in — most commonly an engagement, but
  practice-wide roles (Platform Administrator, Practice Partner) hold
  tenant-scoped membership, and Client Administrator typically holds
  organisation-scoped membership (DATA_MODEL.md §2, DECISIONS.md R-11).
- Engagement membership remains the primary, most granular access
  boundary for day-to-day compliance-content work — a PRIMUS consultant
  with no membership on Client X's engagement has no access to it,
  regardless of seniority or tenant-wide standing.
- Client master data (Business Units, Systems, Processors, etc. —
  DATA_MODEL.md §5.1) is client-scoped, not engagement-scoped, so its
  read/write permissions are checked against the caller's
  `OrganisationMembership` or **any** currently-active
  `EngagementMembership` for that client, whichever grants the relevant
  permission — there is no single "master data engagement" to require
  membership on.
- Object-level exceptions handle the cases role-level permission can't:
  most importantly, `visibility = CONSULTANT_INTERNAL` on a Note or piece
  of Evidence is checked on every read regardless of the reader's role —
  a client-side role can never see it, full stop, even if some other
  permission would otherwise grant read access to the containing record.

## 3. Tenant Isolation

Three nested isolation boundaries now exist (Tenant → Organisation →
Engagement), all enforced at both layers described in §2:

- **Tenant** — the outermost boundary. Every `User` and every
  `Organisation` carries `tenant_id`; every table beneath them inherits it
  transitively. RLS policies and the authorization layer both scope every
  query on `tenant_id` first. The MVP deployment provisions exactly one
  `Tenant` row (DECISIONS.md D-01); this boundary exists and is enforced
  from the first migration regardless, so that admitting a second practice
  in a future phase is a data-provisioning exercise, not a security-model
  change.
- **Client organisation, within a tenant** — every operational table
  carries `client_org_id` (directly, or transitively via `engagement_id`),
  the column both RLS policies and the application layer scope every query
  on next. Practice staff do not get implicit cross-client access within
  their own tenant — they get it only through an explicit
  `EngagementMembership` (or, for the narrow set of org-wide roles,
  `OrganisationMembership`) on a specific client, which is itself an
  auditable, revocable grant.
- **Engagement, within a client** — the narrowest boundary: a consultant
  staffed on Engagement A for Client X has no access to Engagement B for
  the same Client X unless separately granted membership — engagements are
  not automatically visible to each other, which is also what keeps a
  closed/historical engagement from being casually altered by unrelated
  staff. Client master data (§2, DATA_MODEL.md §5.1) sits at the
  client-organisation level rather than nested inside any one engagement's
  isolation boundary — by design, since it is meant to be visible
  consistently across a client's engagements, not siloed per engagement;
  what *is* protected per engagement is each engagement's own
  point-in-time record of which master-data version it relied on
  (DATA_MODEL.md §5.3), which is never altered by another engagement or by
  a later master-data edit.

## 4. Data Access Patterns

- All database access happens from server-only code (Server Actions /
  Route Handlers) using server-held credentials. No client-side Supabase
  client is used for privileged reads/writes against tenant data.
- Every domain-service query is written scoped by construction (the
  service function signature requires an `engagement_id`/`client_org_id`
  argument it filters on) rather than relying on a developer to remember
  to add a `WHERE` clause.
- List/detail endpoints return only fields the caller's role is permitted
  to see; sensitive fields (e.g. consultant override rationale on a risk
  rating, if marked internal) are dropped server-side, not hidden by the
  client.

## 5. Evidence / Document Security

Evidence documents are frequently the client's most sensitive material
(security assessments, contracts, system architecture, personal data
samples). Concretely:

- Files live in **private** Supabase Storage buckets — never a public
  bucket, never a predictable public path.
- The **only** way to read a file is a short-lived signed URL, minted by
  server code **after** the same authorization + visibility check used for
  everything else. Knowing or guessing a URL/UUID grants nothing without
  that server-issued signature — this directly satisfies "never expose
  files merely because a user knows a URL."
- Every signed-URL issuance is itself an auditable event (who accessed
  which evidence, when).
- Upload validation: allow-listed MIME types/extensions, size limits,
  filename sanitization before storage. Malware scanning of uploads is
  **not** in MVP (it requires additional infrastructure) — flagged as a
  deferred/DECISION REQUIRED item in DECISIONS.md, to be revisited once
  real client files are being handled in anger.
- Evidence carries the same `CONSULTANT_INTERNAL` / `CLIENT_VISIBLE`
  visibility attribute as Notes, checked on every access, not just at
  upload time.

## 6. Audit Logging

- `AuditLog` is append-only: the database role used by the application has
  `INSERT` but not `UPDATE`/`DELETE` on the table; no application code
  path exposes a way to alter or remove an entry.
- **Material changes** that generate an audit entry: create/update/delete
  on ProcessingActivity and every Data-Landscape object; every new
  master-data version row (a `SystemVersion`, `ProcessorVersion`, etc. —
  DATA_MODEL.md §5.1 — is exactly the kind of client-fact change this
  principle is meant to catch); ApplicabilityDetermination; Control,
  Requirement, RegulatoryReference, ControlLibraryVersion (practice-owned
  methodology changes are material too — see DATA_MODEL.md §6);
  Assessment, AssessmentResponse, ControlTest; RiskScoringModel (a new
  version, per DATA_MODEL.md §8 — never an in-place edit), Risk, Finding,
  RemediationAction, ValidationRecord; MaturityDomainWeight (per engagement,
  never edited retroactively — DATA_MODEL.md §9), DPIA, SDFScreeningDetail,
  AIUseCase; Evidence, Notice, RetentionRule, ConsentMechanism, DataFlow;
  Engagement and Client record changes; Role/Permission grants and
  Tenant/Organisation/Engagement membership changes. Read-only views,
  transient UI state, and unsaved drafts are not audited — this line is an
  engineering judgment, recorded (not "DECISION REQUIRED") in
  DECISIONS.md.
- Entries capture actor, tenant/engagement context, entity, action,
  field-level change where practical, timestamp, and — for any override of
  a system suggestion — the rationale field, since "consultant overrides
  with rationale" is itself a compliance-relevant fact.
- Audit log retention follows the engagement/client data retention policy
  (at minimum, retained for the life of the client relationship); no
  automatic purge is implemented without an explicit retention decision.

## 7. Secrets Handling

- Supabase service-role key, database connection strings, and any other
  server secret are stored only in Vercel/Supabase environment
  configuration — never committed to the repository, never referenced in
  client-bundled code, never logged.
- `.env*` files are git-ignored from the first commit that introduces
  configuration (this repository has none yet).
- Only the minimum credential needed is used per context: the browser only
  ever holds the anonymous/publishable Supabase key where a client SDK
  call is unavoidable (e.g. auth flows), never the service-role key.

## 8. Input Validation & Output Encoding

- All input crossing the server boundary (Server Actions, Route Handlers)
  is validated against an explicit schema (Zod) before touching the domain
  layer — reject unknown/malformed shapes rather than coercing them.
- Output is rendered through React's default escaping; any place raw HTML
  is ever needed (none identified yet) requires explicit sanitization and
  a documented reason.
- File uploads are validated for type/size before storage, independent of
  client-declared MIME type (checked server-side).

## 9. Rate Limiting

- Authentication endpoints (login, password reset) are rate-limited to
  blunt credential-stuffing/enumeration — a Supabase Auth built-in at MVP,
  revisited if abuse patterns require more.
- Evidence signed-URL issuance and any bulk-export endpoint are
  rate-limited per user to reduce the blast radius of a compromised
  session scraping data.
- General API rate limiting beyond this is deferred until real usage
  patterns exist to tune against (principle 13 — avoid unneeded
  complexity ahead of need).

## 10. Database Constraints & Integrity

- Real foreign keys everywhere a relationship exists (no
  application-only-enforced references).
- `CHECK` constraints for enumerated states (e.g. `Assessment.status`,
  `RemediationAction.status`) so an invalid state cannot be written even by
  a bug.
- `NOT NULL` on tenant-scoping columns — no operational row can exist
  without a resolvable tenant.
- Uniqueness constraints where the model requires them (e.g. one
  `MaturityScore` overall row per engagement+assessment).

## 11. Backups & Recovery

- Rely on Supabase's managed Postgres backups and point-in-time recovery
  for the production project; recovery procedure is documented once a
  production project exists (not yet).
- Staging and production never share a database, so a staging mistake
  cannot corrupt client data.

## 12. Monitoring & Alerting

- Structured server-side logging of authorization denials, failed auth
  attempts, and evidence access, distinct from general application logs.
- Error tracking/monitoring tool selection (e.g. Sentry) is a Phase 2
  decision, deferred until there's a running application to monitor —
  recorded, not urgent.

## 13. Secure Error Handling

- Server errors return generic messages to the client (no stack traces,
  no raw database error text, no internal identifiers beyond what the
  caller is already authorized to see); full detail goes to server-side
  logs only.
- Authorization failures return a uniform "not found/forbidden" style
  response rather than distinguishing "exists but you can't see it" from
  "doesn't exist," to avoid leaking the existence of other tenants' data
  through error-message differences.

## 14. Threat Considerations (working list, not exhaustive)

| Threat | Mitigation |
|---|---|
| Cross-tenant data leakage (app bug) | Two independent scoping layers (app + RLS); every table carries a tenant column. |
| IDOR on evidence files | No public buckets; signed URLs minted only after authorization check; short TTL. |
| Consultant-internal note/evidence shown to a client user | Explicit `visibility` field checked server-side on every read, independent of role-based read access to the containing record. |
| Privilege escalation via role/membership tampering | Role, TenantMembership, OrganisationMembership, and EngagementMembership changes all go through the same authorization checks as any other write, and are themselves audited — granting oneself or another user a broader membership requires a permission of its own, not just write access to the membership table. |
| A system-suggested value silently treated as a final legal/risk conclusion | Every suggestion field is paired with a required, separately-authored decision field; UI/reporting must always be able to show both. |
| SQL injection / injection generally | Parameterized queries only (ORM/typed query builder); no string-concatenated SQL. |
| Stale/guessable signed URLs | Short TTL, scoped to a single object, reissued per request rather than cached long-term. |
| Secret leakage via client bundle | Service-role key never referenced outside server-only modules; a bundler check/lint rule is a Phase 2 hardening item. |
| Session hijacking | Supabase Auth session handling defaults (HttpOnly cookies), HTTPS-only in every environment. |
