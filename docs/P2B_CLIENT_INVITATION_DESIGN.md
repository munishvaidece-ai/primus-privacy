# P2B — Client Invitation & Account Provisioning: Design

Discovery/design exercise per the P2B brief. No application code,
migrations, schema changes, UI, routes, or tests were created or
modified. Every claim below is traced to a specific file/function/
migration/test in the repository as it stands at HEAD `2cf4a37`
(post-P2A.1); where a claim is inference rather than direct observation,
it is marked as such.

---

## 1. Executive Summary

PRIMUS PRIVACY has no path today for a client user to obtain an account.
`addEngagementMember` (`lib/domain/engagement-memberships.ts`) attaches
an **existing** `users` row to an Engagement; nothing in this codebase
creates a new one. The only way a `public.users` row comes into being is
a trigger (`handle_new_auth_user`, migration 0001) that fires on
`auth.users` INSERT and requires `raw_app_meta_data.tenant_id` to already
be set — meaning the row's own creator (today: a raw SQL fixture insert
in tests, or manual Supabase Admin API use in a real deployment) already
knew which tenant/organisation the new user belongs to. This is not an
oversight to work around; migration 0001's own comment names the
intended mechanism directly: **"the intended flow is server-side
provisioning via the Supabase Admin API, which sets
`raw_app_meta_data.tenant_id` (and, for client-side users,
`client_org_id`) at account-creation time."** `.env.example` independently
confirms this intent, describing `SUPABASE_SERVICE_ROLE_KEY` as used
"ONLY by trusted server-side code (e.g. **the membership-grant
service**, migration runner)" — P2B is, almost verbatim, the feature
that env var was reserved for.

**The smallest sound design or fills that intended path**, rather than
inventing a new one: an `invitations` table (new — no existing document
names this entity), created by someone who already holds `membership.
manage` (the exact permission that already governs "who may add a
member to this Organisation/Engagement" today), naming a target email,
tenant, organisation, optionally an engagement, and a client-side role.
Acceptance is a Supabase-Auth-authenticated action: an existing user with
a matching email accepts directly (a new `OrganisationMembership`/
`EngagementMembership` row, no new `auth.users` row); a brand-new
invitee is provisioned via the Supabase Admin API — the first real use
of `SUPABASE_SERVICE_ROLE_KEY` and the first genuinely new kind of
server-side capability this codebase has built — with
`raw_app_meta_data.tenant_id`/`client_org_id` set from the invitation
itself, so `handle_new_auth_user`'s existing precondition is satisfied
by construction, unchanged.

**One finding materially reshapes the "textbook" invitation flow the
business problem statement describes:** `public.users.client_org_id` is
write-once — set only by `handle_new_auth_user` at row-creation time,
never updated by any function in this codebase (confirmed by exhaustive
grep). A client user's Organisation is fixed for the life of the
account. This means invitation ACCEPTANCE for a brand-new user is really
**account provisioning**, not merely "join a membership" — the
Organisation binding happens once, at Supabase Auth user-creation time,
via the same Admin API call that creates the row, not as a separate
later step. This also means an *existing* client-side user (`client_org_id`
already set) can never legitimately accept an invitation into a
*different* Organisation — that case must be rejected, not merely
discouraged, matching the schema's own structural constraint exactly
(§8).

**A second, categorical finding:** every RLS INSERT policy in this
codebase (`organisation_memberships_insert`, `engagement_memberships_
insert`) requires the CALLER to already hold some membership or
permission on the target scope. An invitee accepting their own,
first-ever invitation holds **none** of that — by definition, they are
not yet a member of anything. This is not a gap introduced by inviting
strangers; it is the same "how does a brand-new person cross the RLS
threshold at all" problem migration 0024 already solved once, for a
narrower case (`eligible_engagement_members`/`resolve_membership_
candidate`/`engagement_membership_roster` — three `SECURITY DEFINER`
functions that re-check authorization internally rather than relying on
the calling session's own RLS-visible membership). Invitation acceptance
needs the same pattern, applied to a genuinely new case: the acceptor's
authorization comes from possessing a valid, unexpired, unconsumed
invitation token bound to their own authenticated identity — not from
any pre-existing membership.

Sections 3-15 below document present state and design in the order the
brief requests; §16 walks the exact first-customer flow the business
problem describes against this design; §17 lists explicit non-goals;
§18 proposes implementation slices; §19 lists open decisions; §20
proposes the test strategy; §21 is the architectural-consistency check.

---

## 2. Current-State Findings — Files Inspected

Authentication/session: `lib/auth/session.ts`, `lib/auth/actions.ts`,
`lib/supabase/server.ts`, `lib/supabase/middleware.ts`,
`db/schema/users.ts`, `drizzle/migrations/0001_identity_tenancy_
engagement_security.sql` (§3 provisioning trigger, §4 authorization
helper functions), `scripts/local-dev-auth-shim.sql`, `.env.example`.

Membership model: `db/schema/memberships.ts`, `db/schema/roles.ts`,
`db/seed/roles.ts`, `lib/domain/organisations.ts`,
`lib/domain/engagements.ts`, `lib/domain/engagement-memberships.ts`,
`drizzle/migrations/0019_organisation_engagement_membership_
onboarding.sql`, `drizzle/migrations/0024_engagement_membership_
management.sql`.

Authorization service: `lib/authorization/service.ts` (full file, all
59 exported functions/classes).

Audit: `db/schema/audit-log.ts`, `db/schema/enums.ts`
(`auditActionEnum`), the `log_membership_change()`/
`log_methodology_change()` triggers (migrations 0001/0019),
`getEvidenceDownloadUrl`'s explicit audit insert (`lib/domain/
evidence.ts`, for the "access event with no literal row-type match"
precedent).

Request/DB layer: `lib/db/request-client.ts` (`withRequestDb`,
`RequestDb` type, `SET LOCAL ROLE`/`auth.uid()` mechanism).

Schema/migrations broadly: `db/schema/index.ts` (barrel export
convention), every RLS-defining migration from 0000 through 0032
(`grep`-scanned for `CREATE POLICY`, `SECURITY DEFINER`, membership/user
references), `db/schema/enums.ts` in full.

Tests: `tests/app/session.test.ts`, `tests/app/authorization.test.ts`,
`tests/app/engagement-membership.test.ts`, `tests/app/engagement-
onboarding.test.ts`, `tests/app/organisations.test.ts`, `tests/rls/
engagement-access.test.ts`, `tests/rls/membership-boundaries.test.ts`,
`tests/rls/tenancy-consistency.test.ts`, `tests/rls/tenant-isolation.
test.ts`, `tests/rls/helpers.ts` (`createUser`, `getOrCreateRole`,
`grantTenantMembership`/`grantOrganisationMembership`/
`grantEngagementMembership`), `tests/app/helpers.ts` (re-export/aliasing
conventions), `tests/app/authorization-hardening.test.ts` (P2A/P2A.1's
own precedent for a focused, real-PostgreSQL security-scenario suite).

Documentation: `DATA_MODEL.md` (§2 Identity & Tenancy, in full — no
`Invitation` entity named anywhere), `ARCHITECTURE.md` (§4 Major
Components, §6 Security Boundaries, §7 Data Flow), `SECURITY.md` (full
file — §1 Authentication, §2 Authorization Model, §6 Audit Logging, §7
Secrets Handling, §9 Rate Limiting, §13 Secure Error Handling, §14
Threat Considerations), `PRODUCT_SPEC.md` (role/permission references),
`PRODUCT_UX_BLUEPRINT.md` §8 (Permission Matrix, in full),
`ROADMAP.md` (in full — Phase 3's "Self-serve client onboarding" line,
§21), `DECISIONS.md` (D-03; R-02, R-88, R-91, R-98, R-104, R-107, R-114,
R-117, R-142, R-150 — the established patterns this design reuses),
`PROGRESS.md` (session history establishing "no invitation/email
workflow" as a repeatedly-confirmed, deliberate limitation through every
prior slice), `P2_FIRST_CUSTOMER_WORKFLOW_DISCOVERY.md` (in full — §3,
§4, §9, §19, §20 especially).

---

## 3. Current Authentication Model

**How Supabase Auth currently works:** `lib/supabase/server.ts` creates
one `@supabase/ssr` server client per request, using only the public
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` pair — this
client never bypasses RLS; it only resolves/refreshes the caller's own
session. `lib/auth/session.ts`'s `getAuthenticatedUser` always calls
`supabase.auth.getUser()` (re-validates against Supabase Auth, never
merely decodes a cookie). `lib/auth/actions.ts` implements exactly two
Server Actions: `signIn` (delegates to `supabase.auth.
signInWithPassword`, generic "Incorrect email or password" error
regardless of which is wrong — SECURITY.md §13's own enumeration-
avoidance rule, already established) and `signOut`. **There is no
sign-up/registration Server Action, route, or page anywhere in this
codebase** — `app/login/page.tsx` is the only public-facing auth
surface; `middleware.ts` only refreshes session cookies, it makes no
authorization decision.

**How a Supabase Auth user maps to `public.users`:** `db/schema/
users.ts`'s own comment states it plainly — `users.id` **is**
`auth.users.id` (a real FK, added via `ALTER TABLE` in migration
0001's raw SQL since Drizzle has no first-class handle on Supabase's
`auth` schema). No separate identity/mapping table exists; the
relationship is 1:1 by shared primary key.

**When the application user is created:** entirely via the
`handle_new_auth_user()` `SECURITY DEFINER` trigger function
(`AFTER INSERT ON auth.users`, migration 0001 §3), never by application
code directly. The trigger:
1. Reads `NEW.raw_app_meta_data ->> 'tenant_id'` — **required**; if
   absent, the trigger `RAISE EXCEPTION`s and the `auth.users` insert
   itself fails (not a silently-skipped profile row).
2. Reads `NEW.raw_app_meta_data ->> 'client_org_id'` — optional; null
   means a practice-side (PRIMUS) user.
3. Inserts one `public.users` row with `status = 'active'` unconditionally.

A second trigger (`handle_auth_user_email_change`, `AFTER UPDATE ON
auth.users`) keeps `public.users.email` synced if the Auth email ever
changes — the same table's own comment explains why this one field is a
deliberate, narrow exception to "don't duplicate Supabase Auth data":
"an email address is an identifier, not a credential."

**Email uniqueness:** **not enforced anywhere in this repository's own
schema.** `db/schema/users.ts` has no unique constraint on `email` (only
`(id, tenant_id)`, added in migration 0020 for an unrelated composite-FK
reason). `scripts/local-dev-auth-shim.sql`'s own stand-in `auth.users`
table likewise carries no unique constraint on `email`. In a real
deployed Supabase project, `auth.users.email` uniqueness is a product
guarantee of Supabase Auth itself (its own default configuration), not
something this repository's migrations assert — **this has never been
exercised against a real Supabase project** (DECISIONS.md D-03: no
project has ever been provisioned). This is a real, existing gap
inherited by P2B, not introduced by it: any invitation design that
"checks whether an email already has an account" is checking
`public.users.email`, a column with no uniqueness GUARANTEE at the
database layer in this repo today, only the (currently unverified) one
Supabase's own product provides upstream.

**Existing auth callbacks/signup/password-reset/verification flows:**
**none.** No `/signup`, `/reset-password`, `/verify-email`, or OAuth
callback route exists anywhere in `app/`. `lib/auth/actions.ts`'s own
header comment states this is deliberate scope, not an oversight:
"implement login/logout only — no social login, SSO, MFA, password
reset UI, invitations, or account management in this slice" (this
comment predates P2B and is exactly the gap P2B is asked to close for
the invitation piece specifically — not the others).

**Assumptions the current code makes about a user already existing:**
every domain function that operates on a `targetUserId`
(`addEngagementMember` chief among them) assumes the target `users` row
already exists and is independently resolvable (via `resolve_
membership_candidate`, a `SECURITY DEFINER` function specifically built
because ordinary RLS (`users_select`'s `shares_membership_scope`
clause) cannot see a user who shares no membership with the caller yet
— see §4). No function anywhere accepts a bare email address and
creates an account from it.

---

## 4. Current Membership Model

Three membership scopes (`db/schema/memberships.ts`), each a plain
`User × Scope × Role` junction with a revocable `status` (`active`/
`revoked` — `membershipStatusEnum`) and a **partial unique index on the
active row only** (`WHERE status = 'active'`) — a user can hold at most
one active membership per tenant/organisation/engagement at a time, but
a revoked-then-regranted membership is a new row, preserving history
rather than overwriting it.

| | TenantMembership | OrganisationMembership | EngagementMembership |
|---|---|---|---|
| **Purpose** | Practice-wide standing roles not naturally scoped to one engagement (Platform Administrator, Practice Partner) | Client-wide standing roles not naturally scoped to one engagement (primarily Client Administrator) | The primary, most-used authorization anchor — role on one specific Engagement |
| **Seeded roles that use it** | Platform Administrator, Practice Partner | Client Administrator, Privacy Officer, CXO/Executive Viewer | Engagement Manager, Consultant, Auditor, Business Owner, IT/CISO, Procurement, Legal |
| **Permissions checked via** | `hasTenantPermission` (`lib/authorization/service.ts`) | `hasOrganisationPermission` | `hasEngagementPermission` |
| **Uniqueness** | One active row per `(user_id, tenant_id)` | One active row per `(user_id, organisation_id)` | One active row per `(user_id, engagement_id)` |
| **Tenant isolation** | `tenant_id` is the row's own scope | `organisation_id` → `organisations.tenant_id` transitively | `engagement_id` → `engagements.tenant_id` transitively; migration 0024 additionally checks `user_tenant_id(user_id) = engagement_tenant_id(engagement_id)` directly on INSERT |
| **Lifecycle** | Active → Revoked (status column; no DELETE policy/grant anywhere) | Active → Revoked, same shape | Active → Revoked, same shape; migration 0024 adds a reparenting guard (`user_id`/`engagement_id`/`role_id` immutable after creation — revoke and re-grant instead) |
| **Who creates/revokes today** | No domain function creates one at all — `grantTenantMembership` exists only as a raw-SQL test fixture (`tests/rls/helpers.ts`) | Only `createOrganisation`'s own onboarding self-grant (`lib/domain/organisations.ts`) — **no function adds a SECOND organisation member post-creation; this is a real, confirmed gap** (exhaustive grep of `lib/domain/*.ts` for `organisationMemberships` writes: exactly one call site) | `createEngagement`'s onboarding self-grant, plus `addEngagementMember`/`revokeEngagementMember` (`lib/domain/engagement-memberships.ts`), gated by `membership.manage` |

**How OrganisationMembership and EngagementMembership interact:**
`canAccessOrganisation`/`canAccessEngagement` (`lib/authorization/
service.ts`) both fall back to the other: org-wide membership grants
access to every engagement under that org (the `Client Administrator`
"sees every engagement of its own client" case); any single engagement
membership grants access to that engagement's parent org (so a
consultant staffed on one engagement can reach the Organisation Detail
page, master data, etc.). `hasOrganisationPermission`/
`hasEngagementPermission` do **not** cross-fall-back this way — a
`membership.manage` grant via `OrganisationMembership` authorizes
Engagement-scope membership writes (`canManageEngagementMembership`
explicitly checks both), but the reverse (an Engagement-scope permission
authorizing an Organisation-scope write) has no precedent anywhere in
this codebase, because no function has ever needed to create
`OrganisationMembership` rows outside of `createOrganisation`'s own
onboarding grant.

**The write-once `client_org_id` fact (load-bearing for §8-9 below):**
`users.client_org_id` — nullable, set once by `handle_new_auth_user`,
**never updated by any function in `lib/domain/*.ts`** (confirmed:
zero `UPDATE users SET client_org_id` anywhere in application code).
`addEngagementMember`'s own eligibility check treats this as a hard
boundary: a client-side user (`client_org_id` set) is eligible **only**
for the one Organisation named at their creation; a practice-side user
(`client_org_id IS NULL`) is eligible for any Engagement under their own
Tenant. This is the schema's actual, structural definition of "which
Organisation a client user belongs to" — not a convention layered on
top by application code, a real database fact P2B must respect, not
work around.

---

## 5. Proposed Invitation Data Model

**A new `invitations` table is required.** No existing table can carry
this — `users` cannot represent an invitee who does not yet exist as a
Supabase Auth user, and `organisation_memberships`/`engagement_
memberships` require a real `user_id` (`NOT NULL` FK) that, for a
brand-new invitee, does not exist until the moment of acceptance.

Proposed fields, following this repository's own established
conventions (`uuid` PKs via `defaultRandom()`, `timestamptz` for every
timestamp, a `status` enum with a full-history append/status-transition
shape rather than mutable free-text, `created_by`/tenant-scoping columns
denormalized the same way `validation_records`/`remediation_actions`
already denormalize `tenant_id` for RLS):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `tenant_id` | `uuid NOT NULL` | The inviting practice — always derivable from `organisation_id`, denormalized here the same way `risks`/`findings`/`remediation_actions`/`validation_records` already denormalize it, for RLS and for the audit trigger (§14) |
| `organisation_id` | `uuid NOT NULL` | The client organisation this invitation grants access to |
| `engagement_id` | `uuid NULL` | Set for an engagement-scoped role invite (Business Owner/IT-CISO/Procurement/Legal); **NULL** for an organisation-scoped role invite (Client Administrator/Privacy Officer/CXO) — mirrors how `roles.scope` itself already distinguishes these, not a new concept |
| `invited_email` | `text NOT NULL` | Lower-cased/normalized before storage (see §8) — the binding identity, never re-derived from anything the acceptor supplies later |
| `role_id` | `uuid NOT NULL` FK → `roles.id` | The exact role to grant on acceptance — see §9 for the "which roles are invitable" constraint |
| `token_hash` | `text NOT NULL` | SHA-256 (or stronger) hash of the raw token — **never the raw token itself** (see §6) |
| `status` | new enum: `pending` / `accepted` / `revoked` / `expired` | See §5a below for why this four-value shape, not fewer |
| `expires_at` | `timestamptz NOT NULL` | Set at creation (see §6 for TTL) |
| `invited_by` | `uuid NOT NULL` FK → `users.id` | The inviter — always a real, resolved `users` row (the caller of `createInvitation`) |
| `accepted_by` | `uuid NULL` FK → `users.id` | Set only on acceptance — always equals the invitee's own resolved `users.id` (existing or newly-provisioned), never a caller-supplied value |
| `accepted_at` | `timestamptz NULL` | Set atomically with `accepted_by` and the resulting membership row(s) — §12 |
| `revoked_at` | `timestamptz NULL` | Set on explicit revocation |
| `revoked_by` | `uuid NULL` FK → `users.id` | Mirrors `accepted_by`'s shape |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

**Deliberately NOT included**, and why: a raw `token` column (§6 — only
the hash is ever persisted); an `updated_at` column (this row's own
lifecycle is a set of one-time, named timestamp fields — `accepted_at`/
`revoked_at` — following the same shape `validation_records` already
uses for its own append-only "decision, once made, is final" posture,
not a general-purpose mutable-row pattern); a `resend_count`/`last_
resent_at` pair (§10's recommendation is "resend = revoke + create a
new row," which needs no counter on this table — see §10).

### 5a. Lifecycle: `pending → {accepted | revoked | expired}`

Four states, not three or five:

- **`pending`** — created, not yet acted on. The only state from which
  acceptance is possible.
- **`accepted`** — terminal. `accepted_by`/`accepted_at` set, in the
  same transaction as the resulting membership row(s) (§12). An
  `invitations` row never transitions OUT of `accepted` — a mistaken
  acceptance is corrected by revoking the resulting membership (the
  EXISTING `revokeEngagementMember`/an equivalent for organisation-scope,
  §9's gap), never by mutating the invitation itself. This mirrors
  `validation_records`' own "a decision, once made, is frozen; a
  correction is a NEW record, never an edit" posture exactly.
- **`revoked`** — terminal. Set by an explicit inviter/manager action
  (§10) or superseded automatically by a resend (§10). `revoked_by`/
  `revoked_at` set.
- **`expired`** — **NOT a value ever written by application code.**
  Modeled as a *computed* state (`status = 'pending' AND expires_at <
  now()`), the same "don't invent a value nothing writes" discipline
  `RemediationAction.status = 'validated'`'s own recent P2A.1 fix
  reinforced (a status column value must correspond to something real
  that actually happens, not a state nothing transitions into). Every
  read path (`getInvitationStatus`, the acceptance flow's own first
  check) computes `pending-but-expired` the same way; **acceptance of
  an expired invitation is rejected by this computed check**, not by a
  separately-maintained stored value that could drift out of sync with
  `now()`. This also avoids needing a cron/sweep job — nothing in this
  codebase's roadmap schedules background jobs yet (confirmed: no
  `pg_cron`/scheduled-function reference anywhere in the migrations),
  and Evidence's own `expired` review-status value has the identical,
  already-accepted "no expiry-sweep job exists" limitation
  (`reviewEvidence`'s own docstring says so directly) — P2B follows the
  same precedent rather than introducing the first scheduled job in this
  codebase.

**Why not fewer/more states:** `pending`/`accepted`/`revoked` alone
would force "is this invitation still actionable" to be computed at
every call site from `status = 'pending' AND expires_at > now()` with no
single column to filter/index on for "show me expired invitations" in a
list view — a real, if minor, usability cost for the resend/revoke
management screen (§18's later UI slice). Storing `expired` as a
genuinely separate value the acceptance path could also read directly
avoids recomputing the comparison in two places, at the cost of needing
one clarifying rule (above) for who is allowed to ever write it (nobody
— it is filtered into existence at read time by a `WHERE`/`CASE`, not
inserted). This is presented as a considered choice, not asserted as
uniquely correct — see Open Decision §19.5.

---

## 6. Token / Security Model

**Raw token vs. hashed storage: hash only, unconditionally.** The
`invitations` table stores `token_hash` (SHA-256 of the raw token,
hex-encoded), never the raw token. This mirrors `document_versions.
checksum_sha256`'s own established use of the same primitive in this
codebase (a real precedent, not a new algorithm choice) and directly
satisfies SECURITY.md §5's evidence-signed-URL posture applied to a
structurally identical problem: "knowing or guessing a URL/UUID grants
nothing without [a server-side check]" — here, without the matching
hash existing in a `pending`, unexpired row.

**Entropy:** the raw token is a cryptographically random value with at
least 256 bits of entropy (`crypto.randomBytes(32)` in Node, or
equivalent), URL-safe-encoded (base64url) for inclusion in the
acceptance link — the same entropy budget Supabase's own session/PKCE
tokens use, well beyond what any realistic guessing/brute-force attack
against a rate-limited endpoint could exhaust.

**Generation:** application-side (Node's `crypto` module), the same
"generate the identifier ourselves, application-side" pattern this
codebase already uses uniformly for every other id (`randomUUID()` in
every `create*` domain function) — not delegated to a database default,
so the raw value is available to embed in the invitation email/link
exactly once, at creation time, and is never persisted anywhere in
recoverable form afterward.

**Expiration:** `expires_at` set at creation — **recommend 7 days**,
matching a common, unsurprising default for this kind of B2B invitation
(shorter than a typical password-reset link's hours-scale TTL is
appropriate here, since a genuine business invitation is expected to be
acted on within a work week, not within minutes) — not resolved
definitively here; see Open Decision §19.1.

**Single-use enforcement:** the `WHERE CHECK (status = 'pending')`
condition on the acceptance UPDATE (§12) is the enforcement mechanism —
an invitation whose `status` has already moved to `accepted`/`revoked`
cannot be re-accepted, full stop, at the database layer (not merely the
application layer) via the same RLS-`WITH CHECK`-on-a-specific-column-
value pattern P2A.1 just established for `RemediationAction.status =
'validated'` (migration 0032 — precedent directly reused, not invented
fresh).

**Replay prevention:** identical to single-use enforcement above — a
captured, already-consumed token hash matches a row whose `status` is no
longer `pending`, so a replayed acceptance request is rejected by the
same check, not a separate mechanism.

**Revocation:** an explicit `status → 'revoked'` transition (§10),
available to anyone who could have created the invitation
(`membership.manage` on the same scope) — mirrors `revokeEngagementMember`'s
own existing shape exactly (a status change, never a hard DELETE,
idempotent on an already-terminal row).

**Resend behavior — recommend "resend = revoke the old row (if still
`pending`) + create a genuinely new row with a new token/expiry," not
an in-place `token_hash` update.** Reasons: (a) it reuses `createInvitation`'s
own validation/audit path unchanged rather than needing a second,
parallel "regenerate token" code path; (b) it keeps `token_hash`
immutable after creation, consistent with every other "decision record"
table in this codebase never having its own identity-defining fields
mutated in place; (c) it means "does accepting one invitation invalidate
previous invitations" (the next question) has one uniform answer instead
of two different mechanisms to reconcile.

**Does accepting one invitation invalidate earlier ones to the same
email/scope? Yes — recommend enforcing this explicitly, not merely
relying on the unique-membership constraint to make a second acceptance
moot.** At most one `pending` invitation should exist per
`(organisation_id, engagement_id, invited_email)` at a time — enforced
by a partial unique index (`WHERE status = 'pending'`), the exact same
"partial unique index scoped to the live/active subset" pattern
`tenant_memberships_active_user_tenant_key`/`organisation_memberships_
active_user_org_key`/`engagement_memberships_active_user_engagement_key`
already establish for memberships themselves (§4) — not a new indexing
idea. A second `createInvitation` call for the same target while a
`pending` one already exists is therefore either rejected with a clean,
named error (mirroring `DuplicateMembershipError`'s own shape) or —
consistent with the resend recommendation above — treated as an
implicit resend (revoke the old, pending row, create a new one) at the
caller's explicit choice, never silently.

**Bound to the invited email — yes, strictly, and this is the single
most important anti-forwarding control.** Acceptance requires the
authenticated acceptor's own Supabase Auth `email` (for an existing
user) or the email supplied to the Admin API at provisioning time (for a
new user, itself taken directly from `invited_email`, never a
user-editable form field at acceptance time) to **case-insensitively
equal** `invited_email`. This is the direct, structural answer to
"protection against forwarding an invitation to another person": the
token alone is necessary but not sufficient — a forwarded link, opened
by someone whose own account (or freshly-created account) email does not
match `invited_email`, is rejected even though the token itself is
valid, unexpired, and unconsumed. (A new-user acceptance has no
"account" yet to check an email against until the Admin API call itself
creates one **with exactly `invited_email`** — see §9's exact sequencing,
where this check is structurally impossible to bypass rather than
merely enforced by a runtime comparison.)

**Token leakage — logs, URLs, analytics, browser history:** the raw
token necessarily appears in the acceptance URL's path/query (there is
no alternative delivery mechanism for a stateless, emailed link) — the
standard, accepted risk profile every password-reset/magic-link/
invitation system in the industry shares, mitigated by: (a) short TTL
(§ above); (b) single-use (above — a leaked-but-already-used token is
inert); (c) never logging the full request URL server-side (this
codebase's existing structured-logging posture, SECURITY.md §12,
already calls for "authorization denials... distinct from general
application logs," not full URLs); (d) the acceptance page itself
issuing an immediate server-side redirect to a token-free URL once the
token has been validated and exchanged for a session, so the raw token
does not linger in the browser's own address bar/history past the first
load (a standard SPA/SSR pattern, not novel to this design); (e) never
including the raw token in any client-side JavaScript bundle or
`NEXT_PUBLIC_`-prefixed value — it is read server-side only, from the
route's own path segment, in a Server Component/Route Handler.

---

## 7. Existing-User Flow

The invited email already belongs to a `public.users` row. Six cases,
each resolved from facts already established in §3-4:

| Case | Recommended handling | Why |
|---|---|---|
| Already authenticated (as the invited user), clicks the link | Accept immediately — validate token, confirm session email = `invited_email`, create membership (§12) | No further identity proof needed; the session is already server-validated |
| Unauthenticated existing user, clicks the link | Redirect to `/login?returnTo=/invitations/[token]` (or equivalent), then accept immediately post-login | Reuses the existing login flow unchanged (`lib/auth/actions.ts`'s `signIn`); no new auth mechanism needed |
| Already holds the exact membership this invitation would grant (same org, same engagement if scoped, active status) | **Accept as a no-op / clean "already a member" response** — mark the invitation `accepted` (for a clean audit trail and to free the partial-unique-pending-per-target slot) without inserting a duplicate membership row | The membership uniqueness constraints (§4) would reject a literal duplicate INSERT regardless; surfacing this as a friendly no-op rather than a raw constraint-violation error is the same "pre-check for a clean error" discipline `addEngagementMember`'s own `DuplicateMembershipError` already establishes |
| Belongs to the SAME Organisation already, invitation is for a NEW Engagement under it | **Accept normally** — this is exactly `addEngagementMember`'s own existing "client-side user eligible only for their own org's engagements" rule (§4), now reached via invitation instead of an existing-user Add-Member form. Only the new `EngagementMembership` row is created; no change to their existing `OrganisationMembership`/`client_org_id` |
| Belongs to a DIFFERENT Organisation in the same Tenant | **Reject, structurally, not just as a policy choice** — `users.client_org_id` is write-once (§4); this user's `client_org_id` already names a different org, and no function anywhere changes it. Present a clear, non-enumerating error ("This invitation cannot be accepted with this account.") rather than a raw constraint violation. Fixing this for real (letting a client genuinely move between organisations) is an explicit, separate future capability — not solved by P2B, see Open Decision §19.4 |
| Belongs to a DIFFERENT Tenant entirely | **Reject** — the same structural reason as above, plus SECURITY.md §3's own tenant-isolation posture (a user's `tenant_id` is likewise write-once, set at creation, never reassigned anywhere in this codebase) |

A PRIMUS-side existing user (`client_org_id IS NULL`) is a case this
design deliberately does **not** need to handle at all: §9's role
allowlist restricts invitations to client-side roles only, and a
practice-side user gaining engagement access is already fully solved by
the existing `addEngagementMember` — inventing an invitation path for
this case would duplicate a solved problem, not fill a gap.

---

## 8. New-User Flow

No `public.users`/`auth.users` row exists yet for `invited_email`.
Proposed sequence — the Admin API call and the `handle_new_auth_user`
trigger are the load-bearing steps; everything else is orchestration
around them:

1. Invitee opens the acceptance link; token is validated (hash lookup,
   `status = 'pending'`, `expires_at > now()`) — **before** anything
   about account creation is decided, so an invalid/expired/already-used
   token never reaches the account-creation step at all.
2. The acceptance page confirms no existing `public.users` row has
   `email = invited_email` (case-insensitive) — if one exists, this is
   actually the existing-user flow (§7), routed there instead.
3. The invitee supplies a password (the only new credential this flow
   introduces — Supabase Auth handles storage/hashing entirely; this
   codebase never sees or stores a password itself, matching `signIn`'s
   existing "delegates entirely to Supabase Auth — never compares a
   password itself" posture).
4. **Server-side only**, using the service-role Supabase Admin client
   (§21 — new capability): call `supabase.auth.admin.createUser` with
   `email: invited_email`, the supplied password, `email_confirm: true`
   (the invitation link itself IS the verification step — requiring a
   SECOND email-verification round-trip on top of an already-emailed,
   already-token-verified invitation link would be redundant, not
   additional security), and `app_metadata: { tenant_id, client_org_id:
   organisation_id }` — **set from the invitation row's own
   `tenant_id`/`organisation_id`, never from anything the browser
   submits**. This is the exact shape `handle_new_auth_user` (§3)
   already requires and has required since Milestone 1 — no trigger
   change needed.
5. The trigger fires synchronously (`AFTER INSERT ON auth.users`,
   same transaction as the Admin API's own insert, from Postgres's own
   perspective) and creates the matching `public.users` row —
   **automatically, unchanged, already-tested machinery** (`tests/rls/
   helpers.ts`'s `createUser` fixture exercises this identical path
   today, just via a raw SQL insert instead of the real Admin API).
6. The application resolves the newly-created `auth.users.id` (the
   Admin API's own response) as the invitee's `users.id` — this is now
   an ordinary, existing user, and the rest of acceptance (§12) proceeds
   identically to the existing-user flow.
7. Establish a session for the invitee (Supabase Auth's own
   `signInWithPassword` using the credentials just supplied, or an
   equivalent sign-in call) so they land inside the authenticated shell
   without a separate manual login step.

**Avoiding duplicate/orphaned users:** step 2's pre-check plus the
Admin API's own native "email already registered" rejection (Supabase
Auth enforces this upstream regardless of this repository's own
unenforced `public.users.email` — §3) together prevent a duplicate
`auth.users` row for the same email. An **orphan** (an `auth.users` row
created by step 4 whose subsequent membership-creation step, §12, then
fails) is the one genuine atomicity risk this flow introduces — see
§12's own explicit handling of this exact failure mode, since the Admin
API call and the membership INSERT cannot share one Postgres
transaction (they are two different systems).

---

## 9. Role Model — Who Can Invite, Which Roles Are Invitable

**Who can send an invitation: reuse `membership.manage`, unchanged —
do not introduce a new permission for this.** `membership.manage` is
already, precisely, "who may grant a new membership on this scope"
(`canManageEngagementMembership`'s own docstring: "the single rule
`addEngagementMember`/`revokeEngagementMember` both gate on"). Extending
it to also govern "who may invite someone who doesn't yet have an
account onto this scope" is the same authority, not a new one — a
`createInvitation` function should call the SAME `requireEngagementMembershipManageAccess`-shaped
check (or a parallel `requireOrganisationMembershipManageAccess`,
§9a below), never a new permission key.

Today `membership.manage` is held by exactly two roles: **Engagement
Manager** (engagement-scope) and **Client Administrator**
(organisation-scope) — `db/seed/roles.ts`, unchanged by any slice since
Milestone 1. Both are natural inviters: an Engagement Manager staffing a
brand-new engagement is the person who currently has no way to get the
client in at all; a Client Administrator, once one exists for an
organisation, is the natural person to invite their own colleagues.

**§9a — a real, structural gap this reuse surfaces:** `membership.
manage` currently governs `engagement_memberships` writes at BOTH the
engagement-scope and organisation-scope level (`canManageEngagementMembership`
checks both), but **no equivalent function or RLS policy exists for
`organisation_memberships` writes at all** — because, per §4, nothing
has ever needed to create a second `OrganisationMembership` row.
Inviting a client's very FIRST user (who needs an organisation-scoped
role — Client Administrator, typically) is exactly this missing case.
P2B's implementation therefore needs a new `canManageOrganisationMembership`/
`requireOrganisationMembershipManageAccess` pair (mirroring the
engagement-scope function's own shape exactly — an Engagement Manager
inviting into their own engagement's organisation should qualify via
`hasEngagementPermission(engagementId, 'membership.manage')`, the same
"engagement-scope permission also reaches the parent organisation for
this one purpose" fallback `canAccessOrganisation` already establishes
for plain access) and a matching new `organisation_memberships_insert`
RLS branch (today's policy, migration 0019, only covers the
onboarding-self-grant case at organisation-CREATION time — a second,
later grant via invitation acceptance needs its own branch, the same
way migration 0024 added a second branch to `engagement_memberships_
insert` for the identical reason). This is not optional plumbing — it
is the one piece of the existing authorization surface that does not
yet reach far enough for P2B's own stated business problem ("invitee...
correct OrganisationMembership... are created").

**Which roles can be assigned to an invited client: client-side roles
only, never a PRIMUS-side role.** The existing role catalogue has no
`is_client_facing`/similar column to check this at the database level
(a real, confirmed gap — `roles` distinguishes PRIMUS-side from
client-side purely by a source-code COMMENT in `db/seed/roles.ts`, never
a queryable attribute). Recommend the same pattern this codebase already
uses repeatedly for "the one correct value here, chosen in code, not
configurable" (`ORGANISATION_ONBOARDING_ROLE`/`ENGAGEMENT_ONBOARDING_
ROLE` constants in `lib/domain/organisations.ts`/`engagements.ts`): a
small, explicit, hardcoded allowlist —
`["Client Administrator", "Privacy Officer", "CXO / Executive Viewer"]`
for an organisation-scoped invite (`engagement_id IS NULL`), and
`["Business Owner", "IT/CISO", "Procurement", "Legal"]` for an
engagement-scoped invite — checked the same way `addEngagementMember`
already checks `role.scope === "engagement"` (reject with a clean, named
error, never silently coerced). This is a deliberate, explicit MVP
choice over adding a schema column now — see Open Decision §19.2 for
the alternative (`roles.is_client_facing boolean`) if the allowlist
proves unwieldy once more roles exist.

**Should the inviter's own role limit which target roles they may
assign?** Recommend **no additional restriction beyond the allowlist
above**, for MVP: both `membership.manage`-holding roles (Engagement
Manager, Client Administrator) may assign any role from the appropriate
allowlist for the scope they are inviting into — mirroring
`addEngagementMember`'s own existing behavior exactly (an Engagement
Manager may assign ANY engagement-scope role via the existing Add
Member form, including client-side ones, with no additional
per-role gate today). Introducing a finer-grained "Client Administrator
cannot promote a peer to Client Administrator" rule would be a genuinely
new authorization concept with no existing precedent to reuse — flagged
as a possible Phase 2 refinement (Open Decision §19.3), not built now.

---

## 10. Authorization Requirements — Per Operation

| Operation | Governing check | Notes |
|---|---|---|
| Create invitation | `membership.manage` on the target scope (engagement, or the new organisation-scope equivalent §9a) | Reuses the existing permission; role-allowlist check (§9) is an additional, independent validation, not a substitute |
| List invitations (for an org/engagement) | Same `membership.manage` check | Mirrors `listEngagementMembers`'s own posture — visible only to someone who could manage the roster, not to every engagement member (an invitation is a pending administrative action, not the kind of ordinary "who's on this engagement" information `listEngagementMembers` itself deliberately keeps open to any member) |
| View one invitation's details (by an authenticated manager, e.g. the management list's detail view) | Same `membership.manage` check | |
| View invitation status by TOKEN (the acceptance landing page, pre-authentication) | **No membership check — cannot have one, the viewer holds no membership yet.** Authorization here comes entirely from possessing the correct raw token, hashed and matched server-side, returning only the minimum needed to render the acceptance page (organisation/engagement NAME, invited email, expiry — never role details, never other invitations, never anything about the inviter beyond what's already visible in the emailed context) | The one deliberately anon-accessible read this feature introduces — see §21 |
| Revoke invitation | Same `membership.manage` check | Mirrors `revokeEngagementMember`'s exact shape (only the same class of person who could have created it) |
| Resend invitation | Same `membership.manage` check | Implemented as revoke-old + create-new (§6) — reuses both existing checks, not a third new one |
| Accept invitation | Token validity (§6) **+** email match (§6) **+**, for an existing user, an authenticated session; no `membership.manage` check — the acceptor is, by definition, not yet a manager of anything on this scope | The genuinely new authorization shape this feature introduces — token possession + email binding is the authorization, not a role check |

---

## 11. RLS / Database Security Model

**Tenant/organisation/engagement isolation on the `invitations` table
itself:** ordinary `SELECT`/`INSERT`/`UPDATE` policies scoped by
`tenant_id`/`organisation_id`/`engagement_id` via `has_organisation_
permission(..., 'membership.manage')`/`has_engagement_permission(...,
'membership.manage')` — the exact same shape migration 0031/0032 already
established for `risks`/`findings`/`validation_records`/`remediation_
actions` (P2A/P2A.1's own precedent, directly reused): `invitations_
select`/`invitations_insert`/`invitations_update` each require the
caller to hold `membership.manage` on the invitation's own scope. No
SELECT/INSERT/UPDATE policy grants access via plain `can_access_
engagement`/`can_access_organisation` the way most other tables do —
an invitation is closer in sensitivity/audience to a membership-
management action than to ordinary engagement content, and should be
invisible to an ordinary engagement/organisation member exactly as
§10's "list invitations" row above states.

**Who can INSERT invitations:** `has_organisation_permission(organisation_id,
'membership.manage') OR (engagement_id IS NOT NULL AND has_engagement_
permission(engagement_id, 'membership.manage'))` — mirrors §9's
application-layer rule exactly, both layers independently agreeing per
SECURITY.md §2's own requirement.

**Who can SELECT invitations:** the same `membership.manage` check —
**deliberately narrower than most SELECT policies in this codebase**
(most existing tables use the broad `can_access_engagement`/`can_
access_organisation` for SELECT even where writes are narrowly gated,
e.g. `evidence_select` remains broad under P2A/DECISIONS.md R-153's own
explicit reasoning). This IS a deliberate departure from that pattern,
justified because an invitation row (an unaccepted, pending grant of
access, plus the invited person's email address) is meaningfully more
sensitive than ordinary engagement content — an unrelated engagement
member has no legitimate need to browse who else is being invited.
Flagged explicitly as a considered choice, not an oversight — see Open
Decision §19.6 if a broader "any manager-adjacent role can view" shape
is preferred instead.

**Who can UPDATE/revoke invitations:** the same `membership.manage`
check, `WITH CHECK` additionally requiring `status IN ('revoked')` when
the actor is not the acceptance path itself (see below) — mirrors
`engagement_memberships_update`'s own "only the class of person who
could have granted this may also revoke it" shape (migration 0024).

**Does invite acceptance require a `SECURITY DEFINER` function? Yes —
this is the central, load-bearing design decision in this whole
document, and it is not optional.** As established in §1's second
finding: the acceptor holds no pre-existing membership on the target
scope, so no ordinary RLS policy shaped like every existing INSERT
policy in this codebase (which all require the caller to already hold
SOME membership/permission) can ever pass for them. The correct,
established pattern to solve exactly this class of problem already
exists in this codebase — migration 0024's `eligible_engagement_
members`/`resolve_membership_candidate`/`engagement_membership_roster`,
each a `SECURITY DEFINER` function that re-checks its OWN, narrower
authorization rule internally (never relying on the calling session's
RLS-visible membership) and returns only what that narrower rule
allows. Proposed: `accept_invitation(p_token_hash text)` — a
`SECURITY DEFINER` Postgres function that:
1. Looks up the `invitations` row by `token_hash` (bypassing the
   ordinary `invitations_select` policy by design — a `SECURITY
   DEFINER` function is exactly Postgres's own mechanism for "run this
   narrow, pre-vetted query as its own privileged identity, not as the
   calling session," the same reasoning every existing function in
   migration 0001/0019/0024/0030-0032 already documents for itself).
2. Validates `status = 'pending' AND expires_at > now()` internally —
   returns a clean "not valid" signal (never a raw constraint-violation
   error) otherwise.
3. Confirms the CALLING user's own resolved email
   (`auth.uid()` → `users.email`, or an explicitly-passed `auth.jwt()`
   claim) case-insensitively matches `invited_email` — the email-binding
   check from §6/§8, enforced INSIDE the trusted function, not merely by
   the calling application code (defense in depth: even if the
   application-layer check were somehow bypassed, this database-layer
   function independently refuses a mismatched email).
4. Inserts the `organisation_memberships`/`engagement_memberships`
   row(s) — this is the one, specific, narrow case where a `SECURITY
   DEFINER` function performs a WRITE most functions in this codebase
   only ever use for reads (`eligible_engagement_members` et al. are all
   read-only) — matching exactly how `handle_new_auth_user` itself
   (§3) is ALSO already a write-performing `SECURITY DEFINER` trigger
   function, so this is not a new category of privileged write in this
   codebase, only its second instance and its first one reachable via a
   direct application call rather than only a trigger.
5. Updates the `invitations` row itself to `status = 'accepted'`,
   `accepted_by = auth.uid()`, `accepted_at = now()` — same function,
   same transaction (§12).
6. Returns the created membership id(s) — nothing more; never returns
   other invitations, other rows, or any data the caller wasn't already
   entitled to as a direct result of their own acceptance.

**Preventing cross-tenant membership creation via a forged/tampered
request:** every value the function writes into the new membership
row(s) (`organisation_id`, `engagement_id`, `role_id`, `tenant_id`
transitively) is read from the **`invitations` row itself**, resolved
server-side inside the function — never accepted as a parameter from
the caller. The ONLY caller-supplied input to the whole function is the
token (hashed before lookup) and, implicitly, `auth.uid()` (which the
caller cannot spoof — it is Postgres's own `auth.uid()`, reading the
session's own JWT claim, the exact mechanism `local-dev-auth-shim.sql`'s
own header confirms is byte-for-byte identical to real Supabase
behavior). This structurally answers "how to prevent a malicious client
from changing organisation_id, engagement_id, role, invited_email, or
tenant_id" — none of those five fields are ever read from the request,
only from the already-validated database row the token resolved to.

**Preventing double-acceptance:** the function's own `UPDATE ...
WHERE id = v_invitation_id AND status = 'pending'` (checked via
`RETURNING`/row-count, the same "the UPDATE's own WHERE clause is the
real single-use enforcement, not merely a preceding SELECT" pattern
this codebase already uses for optimistic-concurrency-shaped checks
elsewhere) — a second, concurrent acceptance attempt for the same
token simply updates zero rows and the function reports failure,
without ever creating a second, duplicate membership. Combined with the
partial-unique-active-membership index (§4, already existing,
unrelated to this feature but an automatic second line of defense), a
genuine race is closed at two independent layers.

**`EXECUTE` grants:** `REVOKE EXECUTE ... FROM PUBLIC; GRANT EXECUTE ...
TO anon, authenticated, service_role;` — **`anon` is a deliberate,
new addition** to this grant list (every existing `SECURITY DEFINER`
function in this codebase grants only `authenticated, service_role`,
because every existing one is reached only from an already-authenticated
session). Acceptance for a BRAND-NEW user's very first action (before
they have a session at all, if the acceptance page's own "confirm
before redirecting to sign-up" step is implemented as an anon-role
read) may need an anon-reachable, narrower companion read function
(`get_invitation_preview(p_token_hash text)` — organisation/engagement
NAME and invited email only, never role details) — flagged explicitly
in §21 as the first anon-role database access this codebase would ever
grant in application code, requiring its own careful, minimal design
(never widen `invitations_select` itself to `anon` — only this one,
narrow, purpose-built function).

---

## 12. Atomic Acceptance Flow — Proposed Sequence

The brief's own suggested 10-step sequence is a reasonable starting
shape but conflates two genuinely different transactional boundaries
that this codebase's own architecture (§3, §11) makes structurally
distinct: the Supabase Admin API call (a separate SYSTEM, no shared
Postgres transaction available) and the database work (which CAN be one
atomic transaction, via the `SECURITY DEFINER` function above).
Corrected sequence:

**Phase 1 — validation (read-only, before any write, any system):**
1. Resolve the raw token from the URL; compute its hash.
2. Call `get_invitation_preview(hash)` (anon-reachable, §11) or —
   if the acceptor already has a session — the authenticated
   equivalent, to confirm the token is `pending` and unexpired. Reject
   immediately, with a generic message, otherwise (§13's own enumeration
   posture applies here too — never reveal WHY a token is invalid:
   expired vs. revoked vs. never-existed should look identical from the
   outside).

**Phase 2 — identity resolution (existing-user vs. new-user branch,
§7/§8):**
3a. **Existing user, not yet authenticated:** redirect through the
    existing login flow; land back on the acceptance handler
    authenticated.
3b. **Existing user, already authenticated:** proceed directly.
3c. **New user:** collect a password; call the Admin API
    (`auth.admin.createUser`, §8) — **this is the one step outside any
    Postgres transaction**, and therefore the one step whose failure
    mode needs explicit handling (see "Orphan handling" below); then
    sign the new user in.

**Phase 3 — atomic membership creation (ONE Postgres transaction, the
`accept_invitation` `SECURITY DEFINER` function, §11):**
4. Re-validate token status/expiry/email-match **inside** the function
   (never trust phase 1's earlier read — a time-of-check/time-of-use
   gap between phase 1 and phase 3 is possible, e.g. the invitation
   could be revoked by an admin in the interval; the function's own
   fresh check is the actual enforcement, phase 1 is only a UX
   short-circuit).
5. Insert the `OrganisationMembership` row (always) and, if `engagement_id
   IS NOT NULL`, the `EngagementMembership` row — same function, same
   transaction: **both memberships or neither**, never a partial grant.
6. Update the `invitations` row to `accepted`.
7. Return success (membership id(s)) or a clean failure — the whole
   function is one Postgres transaction; any failure inside it rolls
   back every write in this phase together, the same "one function,
   real atomicity, no separate transaction API needed" guarantee
   `withRequestDb`/every existing multi-insert domain function
   (`createEngagement`'s own onboarding grant, `createRisk`+`risk_
   controls`, etc.) already relies on.

**Phase 4 — non-transactional follow-up (best-effort, never blocks
success):**
8. Audit logging (§14 — largely automatic via the existing generic
   trigger, applied to the new `invitations` table the same way it
   already applies to memberships).

**Orphan handling (the one real gap the brief's own sequence doesn't
name):** if step 3c's Admin API call succeeds but Phase 3 then fails
(a race, a bug, a network partition between the two systems), the
result is a real `auth.users`/`public.users` row with **no membership
at all** — not silently broken (the trigger's own machinery is
unaffected), but a real, orphaned account. Recommend: (a) the
acceptance handler retries Phase 3 a small, bounded number of times
before surfacing a failure (transient DB errors are the realistic
failure mode, not a structural one, given step 4's own re-validation is
deterministic); (b) if it still fails, surface a clear "your account was
created but access to X could not be granted — contact your consultant"
message rather than a generic error, since the two are now genuinely
different outcomes the user needs to know about; (c) this is NOT
solved by "wrap both in one transaction" — that is not possible across
two separate systems (Postgres and Supabase Auth's own service) without
a distributed-transaction mechanism this codebase has no reason to
build for one feature. Flagged as Open Decision §19.7.

---

## 13. Audit Requirements

**Reuse the existing generic audit-trigger mechanism — do not build a
separate audit system**, per instruction and per this codebase's own
established discipline (P2A's own DECISIONS.md entries make the same
choice for evidence/risk/finding/validation events).

- **Invitation created / resent / revoked:** `log_membership_change()`'s
  own pattern (migration 0019) — `AFTER INSERT OR UPDATE ON
  invitations`, a near-identical trigger (or the SAME function, if
  `invitations` carries `tenant_id` as a plain column rather than
  needing a resolver — it does, per §5's schema) firing automatically on
  every INSERT (created) and UPDATE (resend's revoke-then-create is two
  separate INSERTs plus one UPDATE on the old row; a direct revoke is
  one UPDATE) — **this needs no new application-level audit-insert
  code at all**, the same "no new audit trigger needed" conclusion
  migration 0024's own comment already reached for `engagement_
  memberships_update`/revoke.
- **Invitation accepted:** the same trigger captures the `invitations`
  row's own `status → accepted` UPDATE automatically. The resulting
  `organisation_memberships`/`engagement_memberships` INSERT(s) are
  ALSO automatically captured by the existing, unmodified
  `organisation_memberships_audit_log`/`engagement_memberships_audit_log`
  triggers (migration 0019) — membership creation via invitation
  acceptance is audited by the exact same mechanism as membership
  creation via `addEngagementMember`, with zero new audit code, because
  the trigger fires on the TABLE, not on which code path performed the
  INSERT.
- **Invitation expired:** **not a discrete audited event**, consistent
  with §5a's "expired is computed, never written" design — there is no
  row transition to audit; a list/report view can always compute "which
  invitations are now expired" from `status`/`expires_at` at read time,
  the same way any other computed-state view in this codebase works.
- **Membership created as a result of invitation:** covered above
  (automatic, existing trigger) — no distinguishing "created via
  invitation" vs. "created via `addEngagementMember`" flag is proposed
  on the membership row itself; the `invitations` row's own `accepted_by`
  linking back to the same user id is sufficient provenance for anyone
  who needs to trace it, without adding a column to `organisation_
  memberships`/`engagement_memberships` that only this one creation path
  would ever populate.

---

## 14. Email Security / Enumeration

Direct application of SECURITY.md §1's own already-stated principle
("must not allow a user to discover which organisations exist by
email-enumeration side channels") and §13's ("avoid leaking existence...
through error-message differences") to three new surfaces P2B
introduces:

- **`createInvitation` for an email that already has an account, vs.
  one that doesn't:** the response to the INVITER (an authenticated,
  authorized manager) may safely differ — they are creating this
  relationship deliberately and already know the email they typed, so
  this is not an enumeration surface the same way an anonymous endpoint
  would be. What must NOT differ is any response visible to the
  INVITEE or to an unrelated third party.
- **Invitation-status/preview lookup by token (anon-reachable, §11):**
  must return an identical, generic shape for "token doesn't exist,"
  "token expired," and "token already accepted/revoked" — never a
  distinguishing message ("this invitation was already used" vs. "this
  link is invalid" leaks whether SOMEONE accepted it, i.e. whether an
  account was created). A single, generic "This invitation link is no
  longer valid." covers all three.
- **New-user acceptance vs. existing-user acceptance:** the acceptance
  page's OWN branching (password field shown or not) is necessarily
  visible to the invitee — but this is not an enumeration leak in the
  threat-model sense SECURITY.md §1 cares about, because the invitee
  already knows their own email was specifically invited (they received
  the email) — they are not an anonymous third party probing arbitrary
  addresses. What must still be avoided: the acceptance page must not
  reveal anything about OTHER users at the same organisation, or about
  organisations/engagements the token doesn't itself already name.

---

## 15. Edge Cases

| Case | Recommended handling |
|---|---|
| Duplicate invitation to same email/engagement | Rejected or treated as an implicit resend (§6/§10, caller's explicit choice via a distinct action, never silent) |
| Resend | Revoke-old + create-new (§6) |
| Expired invitation | Computed, not stored (§5a); acceptance rejected with the generic message (§14) |
| Revoked invitation | Acceptance rejected the same way (status check, §11) |
| Already-accepted invitation | Rejected by the same single-use check (§11); no distinguishing message from "expired"/"revoked" to an anonymous viewer (§14) |
| Invitation forwarded to another email | Rejected by the email-binding check (§6/§11) — the token alone is insufficient |
| User changes their Supabase Auth email between invitation and acceptance | The email-binding check (§11) runs at ACCEPTANCE time against the CURRENT session email, not a value cached at invitation-creation time — a changed email simply means the check now (correctly) fails, since it no longer matches `invited_email` |
| Engagement becomes inactive/closed before acceptance | Recommend: still acceptable — `engagements.status` has no bearing on `EngagementMembership` creation anywhere in this codebase today (mirrors §4's "not blocked by Assessment finalization" precedent set repeatedly across Risk/Finding/Remediation in P2A's own review) — flagged as a considered choice, not re-derived from a new rule |
| Organisation becomes inactive before acceptance | Same reasoning — `organisations.status` is not currently checked by any membership-creation path |
| Invited user already has the exact membership | Accept as a clean no-op (§7) |
| Inviter loses their own `membership.manage` access before acceptance | **Acceptance still succeeds** — `accept_invitation` (§11) checks the INVITEE's email/token validity, never the inviter's CURRENT standing; an invitation, once validly created, is not retroactively invalidated by the inviter's own later loss of access, mirroring how `createRisk`'s own audit trail is not invalidated by the creator later losing engagement access |
| Engagement membership (of some THIRD party, unrelated) revoked before this invitation's acceptance | No interaction — invitations are independent of each other and of unrelated memberships |
| Invitation accepted after the target engagement's access model otherwise changed (e.g. a permission grant removed from the target role) | Acceptance grants whatever the role currently is (`role_id`, resolved fresh at acceptance, not snapshotted) — if the role's own permission grants changed between invitation and acceptance, the newly-granted member gets the role's CURRENT permissions, the ordinary, already-existing behavior for every role-based grant in this codebase (roles are not versioned/pinned per-membership anywhere) |
| Concurrent acceptance attempts (same token, two requests) | Closed at two layers (§11): the function's own `WHERE status = 'pending'` on UPDATE, plus the pre-existing partial-unique-active-membership index |
| Concurrent invitation creation (same email/scope, two managers simultaneously) | Closed by the proposed partial unique index on `pending` invitations per `(organisation_id, engagement_id, invited_email)` (§6) — the second INSERT fails the constraint, caught and surfaced as a clean error the same way `DuplicateMembershipError` is today |
| Tenant isolation attacks (forged `organisation_id`/`tenant_id` in an acceptance request) | Structurally impossible — `accept_invitation` never reads these from the request, only from the already-resolved `invitations` row (§11) |
| Role tampering (forged `role_id` in an acceptance request) | Same answer — `role_id` is read from the `invitations` row, never the request |
| Token replay | Single-use enforcement (§6/§11) |
| Invitation URL copied/shared (not maliciously — e.g. pasted into a shared Slack channel by the invitee themselves) | Indistinguishable, by design, from "forwarded to another person" (§6) — the email-binding check is the only defense, and it is intentionally the same defense for both the malicious and the innocent-accident case, since the system cannot distinguish intent |

---

## 16. First-Customer Workflow — Re-Validated

The business problem's own flow, checked step by step against this
design:

1. **Consultant/Practice user selects an existing Organisation → selects
   an Engagement.** Unchanged — the existing `/organisations/[id]/
   engagements/[id]` pages, gated exactly as today.
2. **Invites a client by email.** New: a form (organisation-scope or
   engagement-scope, per §5) → `createInvitation`, gated by `membership.
   manage` (§9/§9a), from the role allowlist (§9).
3. **Invitee receives secure invitation.** Out of this design's own
   scope to specify the email-DELIVERY mechanism itself (§17 — no email
   provider integration is proposed here) — the invitation ROW and its
   token exist the moment `createInvitation` succeeds; sending the
   actual email is a thin, separate concern (any transactional-email
   provider, or, for a genuine first customer, even a manually-copied
   link while that integration is pending — the domain model does not
   require a specific delivery mechanism to be sound).
4. **Invitee creates/signs into their PRIMUS account.** §7 (existing
   user) or §8 (new user), branched automatically by whether
   `invited_email` already resolves to a `users` row.
5. **Invitation is accepted.** §12's atomic acceptance flow.
6. **Correct `OrganisationMembership` + `EngagementMembership` are
   created.** §12 step 5 — both, atomically, in the one `accept_
   invitation` transaction.
7. **Invite is consumed and cannot be reused.** §6/§11's single-use
   enforcement, at both the application layer (status check before
   attempting) and the database layer (the `WHERE status = 'pending'`
   UPDATE clause itself, re-checked by RLS/the function regardless of
   what the application layer already believed).

Every step of the requested flow is achievable with this design; no
step requires inventing a capability this section hasn't already
covered above.

---

## 17. Explicit Non-Goals

Out of scope for P2B, per the brief and per this design's own "smallest
sound capability" framing:

- **Bulk invitations** (CSV upload, multi-email single form) — one
  invitation per `createInvitation` call, matching every other
  `create*` function in this codebase's own single-row shape.
- **SSO** — SECURITY.md §1/ROADMAP.md Phase 2 item, unrelated to
  invitation-gated password-based provisioning.
- **SCIM** — no automated directory sync; a human invites a human.
- **Domain-wide auto-provisioning** ("anyone @clientdomain.com may
  self-register") — the opposite of the invitation model; would also
  reopen the very email-uniqueness gap §3 already flags as unverified.
- **Advanced identity management** (delegated admin roles beyond the
  existing `membership.manage`, custom role authoring at the client
  level, etc.).
- **Organisation-wide invitation policies** (e.g. "require 2FA before
  any invitation may be sent," configurable expiry per organisation) —
  a single, fixed policy (§6) for MVP.
- **Complex email template management** — a CMS/template-editor for
  invitation emails; a single, fixed transactional template is
  sufficient.
- **Magic-link authentication unrelated to invitations** (i.e. ongoing
  passwordless login as a general auth mechanism) — the invitation
  token is single-purpose (account provisioning / membership grant),
  never a general session-issuing mechanism reusable for ordinary login.
- **Enterprise IAM features** (SCIM, audit-export-to-SIEM,
  attribute-based access control) — none of this is needed for one real
  first customer.

---

## 18. Proposed Implementation Slices

Each independently reviewable, each leaving the application in a fully
working, fully tested state — mirroring how P2A/P2A.1 were themselves
sequenced as small, focused, separately-committed slices:

- **P2B.1 — Schema + invitation lifecycle.** The `invitations` table
  (§5), the new `invitation_status` enum, the partial unique index
  (§6), the reparenting/immutability guard trigger (mirroring migration
  0024's own `prevent_engagement_membership_reparenting` shape — `role_id`/
  `organisation_id`/`engagement_id`/`invited_email`/`tenant_id`
  immutable after creation), and the generic audit trigger (§13, likely
  free — reusing `log_membership_change()` if `invitations` carries
  `tenant_id` directly). No RLS beyond the bare minimum to compile; no
  domain functions yet. Smallest possible migration, per instruction.
- **P2B.2 — Invitation authorization / RLS.** `invitations_select`/
  `_insert`/`_update` policies (§11), the new `canManageOrganisationMembership`/
  `requireOrganisationMembershipManageAccess` pair (§9a) and its own
  matching `organisation_memberships_insert` RLS branch — this is
  arguably the highest-risk slice (a genuinely new RLS surface for
  `organisation_memberships`) and should be reviewed on its own, with
  the same 14-scenario-style focused test suite pattern P2A/P2A.1
  established.
- **P2B.3 — Invitation creation / revocation / resend.** `createInvitation`,
  `revokeInvitation`, `listInvitations` (§10) — ordinary, already-
  authenticated-session domain functions, no Supabase Admin API
  involvement yet. Fully testable against the real PostgreSQL test
  suite exactly like every existing domain function.
- **P2B.4 — Invitation acceptance (existing-user only).** `accept_
  invitation` (§11), wired for the case where `invited_email` already
  resolves to a `users` row — defers the Admin API/new-user branch to
  P2B.5, so this slice's own atomicity/security-boundary logic (the
  hardest part of this whole feature) can be built and fully tested
  against real PostgreSQL BEFORE the Admin-API integration (which
  cannot be exercised end-to-end in this dev environment, §20) is even
  touched.
- **P2B.5 — New-user provisioning.** The Supabase Admin API integration
  itself (§8) — the one slice that genuinely cannot be verified
  end-to-end without a real Supabase project (DECISIONS.md D-03),
  isolated here specifically so that limitation is contained to exactly
  one slice rather than blocking P2B.1-4.
- **P2B.6 — UI.** The invite-a-client form, the invitation management
  list (view/revoke/resend), and the acceptance landing page(s) —
  server-independently-re-decided visibility exactly like every P2A
  UI-gating change (hide, never merely disable, an unauthorized action).
- **P2B.7 — End-to-end real-PostgreSQL/security tests.** A dedicated
  focused suite (mirroring `tests/app/authorization-hardening.test.ts`'s
  own shape) covering every scenario §20 lists, plus a full-suite
  regression pass — even though most of it will already exist
  incrementally from P2B.1-6's own slice-local tests, per this
  repository's own established "focused tests per slice, full
  regression at the end" discipline.

---

## 19. Open Decisions Requiring Approval

1. **Invitation TTL.** §6 recommends 7 days; not definitively resolved
   here — a product/security judgment call.
2. **`roles.is_client_facing` (or similar) column vs. a hardcoded
   allowlist (§9).** Recommend the hardcoded allowlist for MVP,
   consistent with this codebase's existing pattern; revisit if it
   becomes unwieldy.
3. **Whether the inviter's own role should further restrict which
   target role they may assign** (e.g. "a Client Administrator cannot
   invite a peer Client Administrator") — §9 recommends no additional
   restriction for MVP, deferring this as a possible later refinement.
4. **What happens when a client genuinely needs to move to a different
   Organisation** (the write-once `client_org_id` constraint, §4/§7) —
   out of scope for P2B; a real, separate future capability if/when a
   real customer scenario needs it.
5. **The four-value `pending`/`accepted`/`revoked`/`expired` lifecycle
   shape** (§5a) vs. a simpler three-value one with `expired` always
   computed and never a distinct filter target — a genuine design
   trade-off, not asserted as uniquely correct.
6. **`invitations_select` scoped to `membership.manage` only** (§11,
   narrower than most SELECT policies in this codebase) — confirm this
   is the intended sensitivity level, versus the broader "any engagement/
   organisation member may see the roster of pending invitations" shape.
7. **Orphan-account handling on a Phase-3 (§12) failure** — the
   proposed retry-then-surface-a-distinct-error approach is a
   reasonable default, not a definitive resolution of "what should
   actually happen to that orphaned `auth.users` row" (manual cleanup?
   an automated reconciliation job — the first scheduled job this
   codebase would ever need, §5a's own point about avoiding that
   precedent elsewhere?).
8. **Invitation delivery mechanism** (§16 step 3) — genuinely
   unaddressed by this design on purpose; a transactional email
   provider needs its own selection/integration, out of scope for the
   data-model/authorization design this document covers.
9. **The Roadmap-Phase-3 framing question — see §21's own finding
   below.** Does the product owner intend P2B's invitation-gated
   provisioning to proceed now, notwithstanding ROADMAP.md's own
   "Self-serve client onboarding... Phase 3" line?

---

## 20. Test Strategy

Every scenario below should be exercised against real PostgreSQL,
following this codebase's own established discipline (no mocked
authorization anywhere in `tests/app/*`/`tests/rls/*` — P2A.1's
own 32-test `tests/app/authorization-hardening.test.ts` is the direct
structural precedent to extend or mirror in a new file).

- Authorized consultant (Engagement Manager, holding `membership.
  manage`) can create an invitation.
- An unauthorized user (a Consultant without `membership.manage`, a
  client-side Business Owner, an unrelated outsider) cannot create an
  invitation — both application-layer (`NotFoundOrForbiddenError`) and
  RLS-layer (direct-SQL `asUser` INSERT, expecting a `row-level
  security` rejection — mirroring P2A.1's own `[P2A.1-3]` test shape
  exactly).
- Cross-tenant invitation attempt (an inviter from Tenant B naming
  Tenant A's organisation) is rejected.
- Organisation mismatch (an engagement-scoped invitation whose
  `organisation_id` doesn't match the named `engagement_id`'s real
  parent) is rejected.
- Engagement mismatch (analogous, the reverse direction).
- Token replay (accept once successfully, attempt to accept the SAME
  token again — expect rejection, and expect the SECOND attempt to
  create zero additional membership rows, not merely to report an
  error).
- Expired token (an invitation whose `expires_at` is set in the past
  via direct fixture SQL) is rejected at acceptance.
- Revoked token is rejected at acceptance.
- Wrong email (an authenticated user whose OWN session email does not
  match `invited_email` attempts to accept) is rejected.
- Duplicate acceptance (concurrent — two simultaneous acceptance
  attempts for the same token) results in exactly one membership grant,
  never two, never a partial/inconsistent state.
- Concurrent invitation creation (two simultaneous `createInvitation`
  calls for the same email/scope) — exactly one `pending` row survives.
- Role tampering (a forged acceptance request attempting to pass a
  different `role_id`/`organisation_id`/`engagement_id` than the
  invitation's own row) has no effect — the resulting membership always
  matches the invitation's OWN stored values, never the request's.
- Membership creation atomicity — a forced failure partway through
  `accept_invitation` (e.g. a simulated constraint violation on the
  SECOND membership insert, for an engagement-scoped invitation) leaves
  NEITHER membership row behind, not just the first one.
- Existing-user acceptance (§7's six cases, each as its own test:
  authenticated match, unauthenticated-then-login, already-has-this-
  exact-membership no-op, same-org-new-engagement success, different-
  org rejection, different-tenant rejection).
- New-user acceptance (§8) — **cannot be exercised end-to-end against a
  real Supabase Admin API in this dev environment** (the same D-03
  limitation `tests/app/session.test.ts`'s own header already documents
  for ordinary login/session resolution). Recommend: stub the Admin-API
  SDK boundary itself (the same `SupabaseAuthClientLike`-style narrow
  interface `lib/auth/session.ts` already uses for its own tests) to
  verify this codebase's OWN orchestration logic (which `app_metadata`
  fields it passes, in what order, with what error handling), while
  testing everything downstream of "an `auth.users` row now exists with
  these `app_metadata` values" — i.e. the trigger firing, the
  membership creation, the invitation-status transition — for real,
  via the existing fixture-style direct `auth.users` INSERT this whole
  test suite already relies on (`tests/rls/helpers.ts`'s `createUser`).
- Tenant isolation — a comprehensive pass mirroring `tests/rls/tenant-
  isolation.test.ts`'s own existing shape, applied to the new
  `invitations` table specifically (Tenant B cannot SELECT/UPDATE/
  accept a Tenant A invitation under any circumstance).

---

## 21. Architectural Consistency Check

**No silent workarounds — every tension found below is reported, not
resolved by this document.**

1. **ROADMAP.md's own "Self-serve client onboarding... Phase 3" line**
   could be read as deferring exactly what P2B asks for. This design's
   own position (stated, not silently assumed): invitation-GATED
   provisioning (a specific person, at a specific email, explicitly
   invited by a specific already-authorized consultant, for a specific
   organisation/engagement/role) is a narrower, different capability
   than "self-serve onboarding" (open, undirected signup — new
   organisations, new tenants, potentially billing-adjacent, the actual
   subject of that ROADMAP.md line, which sits under "Multi-tenant SaaS
   maturity"). Migration 0001's own comment ("no self-service signup...
   the intended flow is server-side provisioning via the Supabase Admin
   API") and `.env.example`'s own "the membership-grant service" line
   both independently corroborate that THIS narrower capability was
   always the intended near-term path, distinct from the deferred
   Phase-3 item — but this reading is not something this document can
   unilaterally confirm on the product owner's behalf. **Flagged as
   Open Decision §19.9**, not silently resolved.
2. **`membership.manage` for organisation-scope invitations has no
   existing RLS-layer counterpart** (§9a) — this is not a conflict so
   much as a genuine, confirmed gap: the permission exists and is
   already seeded to the right role, but the matching `organisation_
   memberships_insert` policy branch for a POST-creation grant simply
   does not exist yet. P2B.2 (§18) is the slice that must add it; it is
   named here explicitly so it is not mistaken for already-existing
   infrastructure.
3. **The Supabase service-role Admin client is a wholly new category of
   server-side capability** (§8) — every existing server-side Supabase
   usage in this codebase (`lib/supabase/server.ts`, `middleware.ts`) is
   deliberately RLS-respecting (anon-key-based, session-scoped). P2B is
   the first slice to introduce a genuinely RLS-bypassing credential
   into application code (as opposed to test/migration tooling, which
   already uses a superuser Postgres connection today, §3). This is
   anticipated by `.env.example`'s own existing placeholder, not an
   architectural surprise, but the review rigor this new credential
   deserves (SECURITY.md §7's own "never reference this from a Server/
   Client Component that ships to the browser" already applies, and
   must be verified, not assumed, once real code exists) should not be
   understated.
4. **The first-ever `anon`-role read in application code** (§10/§11's
   token-preview lookup) — every existing anon-role capability in this
   codebase exists only in the test harness (`asAnon`, `tests/rls/
   helpers.ts`) or the login page itself (which performs no DB read at
   all before authentication). A real, narrow, purpose-built `SECURITY
   DEFINER` function reachable by `anon` is architecturally sound (the
   same pattern, applied to a genuinely pre-authentication use case) but
   is, again, a first for this codebase and should be reviewed as such,
   not assumed safe by analogy alone.
5. **`public.users.email` has no uniqueness guarantee in this
   repository's own schema** (§3) — a PRE-EXISTING gap, not introduced
   by P2B, but one P2B's own "does this email already have an account"
   check now depends on more directly than any prior slice has. Worth
   confirming, before P2B.5 (the first slice that actually calls a real
   Supabase Auth Admin API), that Supabase's own project-level email-
   uniqueness setting is configured as expected once a real project
   exists (DECISIONS.md D-03) — this document cannot verify that
   setting itself, since no project has ever been provisioned.

---

## 22. Confirmation

**No application code, migration, schema, or test file was created or
modified during this discovery exercise.** The only file this session
wrote is this document itself
(`docs/P2B_CLIENT_INVITATION_DESIGN.md`).

**P2B STATUS: DESIGN COMPLETE — AWAITING PRODUCT APPROVAL**
