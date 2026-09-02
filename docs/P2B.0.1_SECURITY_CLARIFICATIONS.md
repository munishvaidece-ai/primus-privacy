# P2B.0.1 — Final Security Clarification Before Implementation

Design/review exercise only. No application code, migration, schema, or
test file was created or modified — this document is the only file this
session wrote. All three questions were investigated against the real
repository at HEAD `a5f598d`, including one live, rolled-back
verification query against the real test PostgreSQL instance (§2 —
nothing committed, nothing left behind, transaction rolled back).

**One finding materially changes the P2B.0 contract and is reported
first, since it bears on all three questions:** the `users` table has
no reparenting guard. `GRANT SELECT, UPDATE ON "users" TO authenticated`
(migration 0001, unrestricted by column) combined with the
`users_update_self` RLS policy (`USING (id = auth.uid()) WITH CHECK (id
= auth.uid())` — checks row identity only, never which columns changed)
means **any authenticated user can, today, via a plain UPDATE
statement, change their own `tenant_id`, `client_org_id`, `email`, or
`status`** — confirmed live, not inferred (§2). This is a pre-existing,
foundational gap, not introduced by P2B — but P2B is the first feature
whose own correctness *depends* on `users.client_org_id` (and,
transitively, on `public.users.email`) being trustworthy, so it must be
closed as a prerequisite, not deferred.

---

## 1. Findings Summary

1. **`users` has no reparenting guard — confirmed exploitable live
   (§2).** Every other mutable table with tenant-scoping/identity
   columns in this codebase (`engagement_memberships`, `assessments`,
   `validation_records`, etc.) has an explicit `BEFORE UPDATE` trigger
   blocking exactly this class of change. `users` — the single most
   foundational table in the schema — does not. This is the load-bearing
   finding beneath both Question 1 and Question 2.
2. **No RLS policy or authorization function reads `client_org_id` at
   all**, apart from `addEngagementMember`'s own eligibility check and
   the two `SECURITY DEFINER` functions built for it (`eligible_
   engagement_members`, `resolve_membership_candidate`). `canAccess
   Organisation`/`canAccessEngagement`/`hasEngagementPermission`/
   `hasOrganisationPermission` never consult it. This means a practice-
   side user granted a client membership would be treated, by every
   *existing* authorization check, exactly like any other member of
   that scope — the risk is not a direct RLS bypass, it is identity-
   model ambiguity plus the tampering risk in Finding 1.
3. **`public.users.email` is a synced copy, not an authoritative
   identity source — and, per Finding 1, is not even reliably synced
   given the missing reparenting guard.** Comparing an acceptance
   request's claimed identity against `public.users.email` (as the
   original P2B design implicitly assumed, §6 of the design doc) is
   unsafe. The authoritative source is the session's own Supabase-Auth-
   verified identity (`auth.uid()`, and the email Supabase Auth itself
   associates with that id) — this must be read fresh, not from the
   mutable copy.
4. **This codebase's existing error-logging discipline never logs raw
   request payloads, only the caught `Error` object** (`console.error
   ("xAction failed", err)`, confirmed across every existing Server
   Action) — a real, reusable precedent for token-leakage avoidance
   (§4), provided no thrown error's own `.message` is ever constructed
   to include the raw token.
5. **`document_versions.checksum_sha256` is already captured, openly,
   in `audit_log.field_changes`** via the existing generic `to_jsonb
   (NEW)` trigger mechanism, with no prior concern raised — a directly
   reusable precedent confirming a stored *hash* (never the raw secret
   it was derived from) is safe to audit openly.

---

## 2. Practice-Side / Client Identity Analysis (Question 1)

### 2a. Live verification (rolled back, no lasting change)

```sql
BEGIN;
-- practice-side user, home tenant = Tenant A
INSERT INTO auth.users (id, email, raw_app_meta_data)
VALUES (gen_random_uuid(), 'verify@example.test',
        jsonb_build_object('tenant_id', '<tenant_A>'));
-- BEFORE: tenant_id = Tenant A, client_org_id = null

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<that user id>', true);
UPDATE users SET tenant_id = '<tenant_B>', client_org_id = '<org_B>'
WHERE id = auth.uid();
-- AFTER: tenant_id = Tenant B, client_org_id = Org B  — SUCCEEDED

ROLLBACK;
```

Result, verbatim from the live run: the UPDATE succeeded — the user's
own `tenant_id` moved from Tenant A to a **completely unrelated Tenant
B**, and `client_org_id` was set to an organisation under that
different tenant, entirely via ordinary `authenticated`-role SQL, no
application code, no elevated privilege. Rolled back immediately;
nothing persisted.

### 2b. Tracing every requested path

- **`client_org_id`** — write-once by design intent (`handle_new_auth_
  user`, migration 0001) but **not enforced** at the RLS/GRANT layer
  (§2a). Read only by `addEngagementMember`'s eligibility logic and its
  two supporting `SECURITY DEFINER` functions — nowhere else.
- **TenantMembership / OrganisationMembership / EngagementMembership**
  — none of these tables, nor any authorization function that reads
  them, ever consult `users.client_org_id` or `users.tenant_id`
  directly. Authorization is entirely membership-table-driven.
- **`canAccessOrganisation` / `canAccessEngagement`** — read only the
  membership tables (§ traced fully in `lib/authorization/service.ts`,
  re-confirmed this session). Zero reference to `client_org_id`.
- **Every relevant RLS policy** (`organisations_select`,
  `engagements_select`, `organisation_memberships_*`, `engagement_
  memberships_*`) — same conclusion: membership-table-driven, never
  `users.client_org_id`.
- **Practice-side vs. client-side roles** — distinguished **only** by a
  source-code comment in `db/seed/roles.ts` (`// PRIMUS-side` / `//
  Client-side`), never a queryable column on `roles` — already noted in
  the P2B design doc (§9) for a different reason (the role-allowlist
  question); the same absence of a real database distinction applies
  here too.
- **Ownership / `owner_id` semantics** (`risks.owner_id`, `findings.
  owner_id`, `remediation_actions.owner_id`) — all use the composite
  `(id, tenant_id)` tenant-scoping FK pattern (DECISIONS.md R-104 et
  seq.), never `client_org_id`. Unaffected either way.
- **Audit attribution** (`audit_log.actor_user_id`) — a bare user id;
  never annotated with `client_org_id`. Unaffected.
- **Code that assumes `client_org_id IS NULL` ⇒ practice-side:**
  exactly one place — `addEngagementMember`'s/`listEligibleUsersForEngagement`'s
  own eligibility rule and `eligible_engagement_members`/`resolve_
  membership_candidate` (migration 0024). No other function anywhere
  makes this assumption.
- **Code that assumes `client_org_id IS NOT NULL` ⇒ client-side:** the
  same functions, the same single place, symmetric conclusion.

### 2c. Determination: **B — creates a real ambiguity, compounded by Finding 1 into a genuine, if narrow, escalation path. Resolved as C for P2B: explicitly prohibited.**

Two independent problems, not one:

1. **Semantic ambiguity (present even if Finding 1 were already fixed):**
   nothing in SECURITY.md's own person-to-client mental model ("Client
   Administrator... manages the client organisation's own users") nor
   in any existing test/fixture anticipates one human simultaneously
   holding practice-wide standing (or membership on unrelated other
   clients' engagements) **and** a client-side administrative role
   (`membership.manage` + `user.manage`, if the assigned role is Client
   Administrator) over a *different* client's own roster. This is not
   a normal "consultant staffed across multiple clients" case (already
   normal and intended, SECURITY.md §3) — it is a PRIMUS staff member
   holding a client's own identity, which no document blesses.
2. **A real, Finding-1-dependent escalation path:** a malicious
   existing client-side user of Organisation A could self-UPDATE their
   own `client_org_id` (per §2a) to `NULL` (impersonating practice-side)
   or directly to Organisation B's id, then pass whatever "is this
   acceptor eligible" check `accept_invitation()` performs — defeating
   exactly the reverse-case protection the business requirement
   demands.

**Recommendation:**
- **A practice-side user (`client_org_id IS NULL` at the moment of
  acceptance) MAY NOT accept an invitation carrying a client-side
  role.** `accept_invitation()` must check this explicitly and reject
  with the same generic, non-enumerating message every other invalid-
  acceptance case uses (never a distinguishing "you're PRIMUS staff"
  message). A legitimate cross-role scenario (rare, and not needed for
  a first customer) is handled the way every other "add someone who
  already has an account" case already is — an explicit, reviewed
  `addEngagementMember`/its org-scope P2B.2 counterpart call by a
  manager, never a self-service invitation-acceptance shortcut.
- **The reverse case — a client user of Organisation A must never
  accept an invitation for Organisation B — is confirmed as the correct
  rule (already recommended in P2B.0), but is only as reliable as the
  `client_org_id` column itself.** It is not reliable today (§2a).
- **`RECOMMENDATION CHANGED` — required prerequisite, not optional:**
  before `accept_invitation()` can safely trust `users.client_org_id`
  (or `users.tenant_id`) for *any* decision, a `BEFORE UPDATE` guard
  trigger on `users` must block changes to `id`, `tenant_id`, `client_
  org_id`, `email`, and `status` via the ordinary `authenticated`-role
  UPDATE path — mirroring `prevent_engagement_membership_reparenting`'s
  exact, already-established shape (block specific dangerous columns,
  leave `display_name`/`updated_at` self-editable). This closes Finding
  1 fully, including its unexercised-today secondary consequence (a
  suspended user could currently self-reactivate via the same gap, once
  user-suspension is ever built — confirmed via grep that no code path
  sets `status = 'suspended'` today, so this particular consequence is
  latent, not yet live, but the same fix closes it too). This is a
  small, single-trigger migration, independently reviewable, and should
  land **before or as the very first step of P2B.1** — it is a
  precondition for P2B's own correctness, not scope creep.

---

## 3. `email_confirm = true` Analysis (Question 2)

- **Does the invitation token provide sufficient proof of control of
  the invited email address?** Yes, and by the same mechanism ordinary
  email verification itself uses — a secret, single-use value delivered
  only to that address, redeemed by whoever can act on it. This is not
  a weaker substitute; it is the identical primitive.
- **Does accepting the invitation substitute for ordinary email
  verification? Yes — and this substitution is sound, not merely
  convenient**, provided `email_confirm: true` is set **only** inside
  the one code path that has *already* validated the token (§ Phase 1
  of the acceptance flow) and **never** as a default anywhere else this
  codebase's Admin API usage might later grow to. Requiring a *second*,
  separate Supabase-native verification email on top of an
  already-token-verified invitation link would be redundant friction,
  not additional security.
- **Does the application currently have any email-verification
  assumptions to respect?** None found. `lib/auth/session.ts`'s
  `getAuthenticatedUser` checks only that `data.user` exists — no
  `email_confirmed_at` check anywhere. `handle_new_auth_user` fires
  unconditionally on `auth.users` INSERT regardless of confirmation
  state. So `email_confirm: true` overrides no existing internal check
  — its only effect is on whether Supabase Auth's *own* login flow
  requires a confirmation step, a real Supabase **project-level
  setting** this repository cannot verify without a provisioned project
  (DECISIONS.md D-03 — the same recurring limitation).
- **Would `email_confirm = true` create a security issue?** No, under
  the two conditions above (token already validated; never a general
  default). The account's *email* is fixed to `invited_email` by
  construction (it is the literal parameter passed to `createUser`,
  never anything the browser supplies) — there is no "confirm your
  email" free-text field to trick in the first place.
- **Could a forwarded invitation be used by another person?**
  Structurally, yes, for a brand-new account: whoever possesses the
  link can set the password and control the resulting account from
  that point on, since nothing yet proves *inbox* control beyond
  *link* possession at creation time. This is an accepted, inherent
  property of every link-based invitation/reset flow industry-wide
  (identical exposure to a forwarded password-reset link) — not a P2B-
  specific defect, and not solvable by adding friction to the flow
  itself. Mitigated by TTL, single-use, and organizational trust that
  the actual recipient is the one who clicks it (§ Recovery, below, for
  the case where the wrong person accepts before the mistake is
  caught).
- **What happens if the inviter mistypes the email address?** Either
  the link goes nowhere (harmless — expires, resend after correcting)
  or an unintended real mailbox receives it (a business-process risk,
  remedied by the existing revoke capability if caught before
  acceptance, or by the existing `revokeEngagementMember`/its org-scope
  counterpart on the resulting membership if caught after). No new
  mechanism is needed for this case.
- **Should the acceptance flow require re-entering the invited email?**
  **No, for either branch.** For an existing user, the only trustworthy
  check is the session's own verified email — a free-text re-entry
  field is weaker (self-reported, unverifiable) and adds nothing. For a
  new user, the email is fixed by construction; there is nothing for
  them to "confirm" that they could change.
- **Should the comparison be case-insensitive?** Yes — canonicalize
  (lower-case, trim) `invited_email` at storage time **and** re-
  canonicalize both sides identically at comparison time, rather than
  assuming the stored form and the session's own form are already in
  the same case.
- **`RECOMMENDATION CHANGED` — the comparison target itself.** P2B.0's
  contract said "compare the authenticated user's email... with
  `invited_email`" without specifying *which* stored copy of "the
  authenticated user's email" to trust. Given Finding 1 (§2), this must
  explicitly be the session's own Supabase-Auth-verified identity —
  `auth.uid()` resolved fresh, with the email read from `auth.users`
  (via a narrow `SECURITY DEFINER` lookup, the same privileged-read
  pattern this codebase already uses repeatedly) or from the session's
  own JWT email claim — **never `public.users.email`**, which is a
  synced copy, and, absent the Finding-1 fix, was not even a *reliably*
  synced one.
- **Should the token be invalidated when the Auth account is created,
  or only after membership creation succeeds?** **Only after
  membership creation succeeds — same transaction, same moment** (this
  matches the design doc's own Phase 3 shape and P2B.0's orphan-
  recovery answer; stated explicitly here because getting this wrong
  breaks that recovery story). If the token were consumed at Auth-
  account-creation time and the membership step then failed, the
  invitee would be left with a real account and no way to retry via the
  same link — exactly the "unnecessary account-management system" this
  design is meant to avoid building.

**Recommended MVP behavior, stated once:** `email_confirm: true`, set
only inside the already-token-validated acceptance path; identity
comparison always against the Supabase-Auth-authoritative email, never
the `public.users` copy; no re-entry field on either branch; the
`invitations` row transitions out of `pending` only on full,
transactional acceptance success. This is acceptable for a first-
customer production workflow because it matches the trust level of
every comparable industry invitation flow, adds no new unverifiable
input, and is not weaker than Supabase's own native verification for
the one case (new account) where verification is meaningful.

---

## 4. Raw Token / Link Handling Analysis (Question 3)

Checked against this codebase's own actual conventions (not
hypothetical ones):

| Surface | Finding | Rule |
|---|---|---|
| **Application logs** | Every existing Server Action logs only `console.error("<name>Action failed", err)` — never the parsed input (confirmed across every `app/(shell)/**/actions.ts` catch block) | The acceptance Server Action must follow the identical pattern; the raw token must never appear in any `Error` object's own `.message`, and the domain function must never `console.log`/`console.error` its own input |
| **Audit logs** | `audit_log.field_changes` uses the generic `to_jsonb(NEW)` trigger — would include `token_hash` automatically | **Acceptable** — a SHA-256 hash is not reversible to the raw token, directly precedented by `document_versions.checksum_sha256` already being captured the same way with no prior concern. The raw token column must never exist at all (it doesn't, per the design) |
| **Database** | Only `token_hash` is ever stored, per the existing design — confirmed still correct | No change |
| **Error messages** (surfaced to the user) | This codebase's own established discipline (SECURITY.md §13, `addEngagementMemberAction`'s own catch block) already returns only clean, generic messages for every domain error, never raw values | The acceptance handler must return one of a small set of generic strings ("This invitation link is no longer valid.") — never interpolate the token or any DB value into a user-facing message |
| **Server Action return values** | `createInvitation`'s return value legitimately carries the link/token **once**, to the authorized creator only | Must not be echoed back by any *other* function (`listInvitations` must never include it) |
| **URL / query parameters** | No existing convention distinguishes path segments from query params for security purposes — both appear equally in server access logs and browser history | Recommend a **path segment** (`/invitations/accept/[token]`), matching this app's own uniform existing convention for "an opaque id this whole page is about" (`/evidence/[evidenceId]/download` etc.) — a minor point; TTL + single-use + no full-URL logging are the real controls either way |
| **Browser history** | Inherent to any link-based flow | The acceptance page must issue a **server-side redirect to a token-free URL** immediately once the token has been validated and exchanged for a session — the same "don't let a one-time secret linger in the address bar" discipline every comparable flow uses |
| **Analytics / request tracing / exception telemetry** | None configured in this codebase today (SECURITY.md §12: monitoring tooling is an explicit, deferred Phase 2 decision) | Nothing to configure now; flag as a requirement **when** such tooling is added later — any future APM/analytics integration must be configured to scrub the token path segment/param by name before that integration ships |
| **Copied UI text** | New surface — the confirmation screen shown to the invitation's creator | Must display the link exactly **once**, with an explicit "this will not be shown again" notice — no persisted "view again" affordance anywhere in the UI, matching the "only the creation response ever carries it" rule above |
| **Tests / fixtures** | This codebase's existing test fixtures freely use real, deterministic values (`randomUUID()`-based emails, etc.) since the test database is disposable and never shared | Fine to use real raw tokens/hashes in test fixtures (`tests/app/helpers.ts`-style) — the leakage concern is about *production* secrets in *persistent* logs/storage, not disposable test-run data |

**Direct answers to the specific questions asked:**
- Path segment vs. query parameter: **path segment**, for the reason
  above — a minor preference, not a load-bearing control.
- Should the token ever appear in server-side logs: **never**, by the
  existing `console.error("...Action failed", err)`-only discipline.
- Should audit rows contain the token: **never the raw token; the hash
  is acceptable**, precedented by `checksum_sha256`.
- Should `createInvitation` return the complete URL or only the token:
  **the complete URL**, to the authorized caller's own response only,
  once.
- Should the UI display the link once only: **yes**, no persisted
  "view again."
- Does resend create a new token and revoke the old invitation:
  **yes**, confirmed (P2B.0, unchanged).
- Can the old token ever remain valid after resend: **no** — the
  revoke of the old row and the creation of the new row happen together
  (and are additionally, structurally enforced by the partial unique
  index on `pending` invitations per target, which would reject the new
  row if the old one were still `pending`).

---

## 5. Recommended Decisions (Consolidated)

| # | Question | Decision |
|---|---|---|
| 1 | Practice-side user + client role invitation | **Prohibited.** `accept_invitation()` rejects if the acceptor's `client_org_id IS NULL` at the moment of acceptance. |
| 1 | Client user of Org A accepting an Org B invitation | **Prohibited** (already agreed in P2B.0) — but not reliable until the Finding-1 fix ships. |
| 1 | `users` reparenting guard | **Required, as a prerequisite migration** (before/at the start of P2B.1) — block `id`/`tenant_id`/`client_org_id`/`email`/`status` changes via the ordinary `authenticated`-role UPDATE path. |
| 2 | `email_confirm: true` | **Confirmed correct**, scoped strictly to the already-token-validated acceptance path. |
| 2 | Identity comparison source | **`RECOMMENDATION CHANGED`** — compare against the Supabase-Auth-authoritative email (fresh `auth.users` read or JWT claim), never `public.users.email`. |
| 2 | Re-enter invited email at acceptance | **No**, for either branch. |
| 2 | Token invalidation timing | **Only on full Phase-3 (membership-creation) success** — confirmed, stated explicitly. |
| 3 | Token storage/handling | **Confirmed as originally designed** — hash-only storage, one-time display, path-segment URL, no logging of the raw value anywhere. |

---

## 6. Revised Final P2B Implementation Contract

### Identity

- **`auth.users`** — Supabase-managed; the sole source of truth for
  login credentials and the authoritative email.
- **`public.users`** — a 1:1 profile row, created only by `handle_new_
  auth_user` (unchanged). **After the Finding-1 fix ships**, `id`,
  `tenant_id`, `client_org_id`, `email`, and `status` are immutable via
  ordinary application/RLS access — only the trigger-driven email-sync
  path and (if ever built) an explicit, permission-gated admin action
  may change them.
- **`client_org_id` semantics:** `NULL` = practice-side; a real
  organisation id = client-side, bound to exactly that one organisation
  for the life of the account (write-once, now actually enforced).
  Invitation acceptance never changes this column — it is read, once,
  as an eligibility gate, never written by `accept_invitation()`.

### Invitation

- **Who can create:** a user holding `membership.manage` on the target
  scope (engagement, via `EngagementMembership`; or organisation, via a
  new `OrganisationMembership`-scope counterpart — P2B.2).
- **Who can see:** the same `membership.manage` check, full history
  (pending/accepted/revoked/computed-expired), no broader visibility.
- **Who can revoke:** the same check, mirroring `revokeEngagementMember`.
- **TTL:** 7 days from creation (fresh 7 days on resend).
- **Token storage:** SHA-256 hash only, ≥256-bit random source,
  generated application-side; the raw value exists only transiently, in
  the creation response and the emailed/shared link, never persisted.
- **Resend:** revoke-old + create-new, atomically enough that the old
  token can never remain valid (enforced structurally by the partial
  unique index on pending rows).
- **Expiry:** never a stored enum value — `invitation_status` is
  3-valued (`pending`/`accepted`/`revoked`); "expired" is always
  computed (`status = 'pending' AND expires_at < now()`).
- **Duplicate handling:** at most one `pending` row per
  `(organisation_id, engagement_id, invited_email)`, via a partial
  unique index; a second attempt is rejected or treated as an explicit
  resend, never silent.

### Existing-user acceptance

- **Eligibility:** the acceptor must (a) hold a session whose
  Supabase-Auth-authoritative email case-insensitively matches
  `invited_email`; (b) have `client_org_id` either equal to the
  invitation's `organisation_id`, **or** — only for a practice-side
  invitee being added via the *existing* staffing mechanism, never via
  this invitation path — not applicable at all (§ Decision 1: a
  practice-side acceptor is rejected outright, full stop).
- **Organisation matching:** exact equality only; no fallback, no
  "closest match."
- **`client_org_id` rule:** read-only during acceptance, never written;
  a mismatch is a hard rejection with a generic message.
- **Membership creation:** already-holds-this-exact-membership is a
  clean no-op; otherwise create the missing `OrganisationMembership`
  (always) and `EngagementMembership` (if the invitation is engagement-
  scoped) atomically.

### New-user acceptance

- **Supabase Admin API:** `auth.admin.createUser({ email: invited_
  email, password, email_confirm: true, app_metadata: { tenant_id:
  invitation.tenant_id, client_org_id: invitation.organisation_id } })`
  — every `app_metadata` value sourced from the already-validated
  `invitations` row, never from request input.
- **Email verification behavior:** the invitation token itself is the
  verification; `email_confirm: true` is set only here, never as a
  general default elsewhere in this codebase's future Admin API usage.
- **Account-creation vs. membership-creation transaction boundary:**
  two genuinely separate systems — the Admin API call (Supabase's own
  service, no shared Postgres transaction available) happens first and
  independently; the `invitations` row is **not** touched by that step.
  Membership creation (Phase 3, below) is the one atomic unit that
  actually consumes the invitation.

### Authorization

- **Application-level:** `createInvitation`/`listInvitations`/
  `revokeInvitation` gated by `membership.manage` (existing permission,
  extended per P2B.2's organisation-scope counterpart).
- **Database/RLS:** `invitations_select`/`_insert`/`_update` mirror the
  same `membership.manage` check; no broader `can_access_*` fallback.
- **`SECURITY DEFINER` boundaries:** `accept_invitation(token_hash)` —
  the sole function permitted to cross the "acceptor has no
  pre-existing membership" RLS threshold, re-validating token status,
  expiry, identity match, and (new, per this document) the practice-
  side/client-org eligibility rule, entirely internally; writes only
  values already present in the resolved `invitations` row. A narrower,
  `anon`-reachable companion (`get_invitation_preview`) returns only
  organisation/engagement name + invited email + expiry, for the
  pre-authentication landing page.

### Atomicity

- **Transaction A — Invitation creation:** one ordinary Postgres
  transaction (`createInvitation`), fully atomic, no cross-system step.
- **Transaction B — Existing-user acceptance:** one ordinary Postgres
  transaction, entirely inside `accept_invitation()` — fully atomic.
- **Transaction C — New Auth account provisioning:** **not a Postgres
  transaction at all** — a single Supabase Admin API call against a
  separate system. Cannot be made atomic with Transaction D by any
  mechanism this codebase has reason to build (no distributed-
  transaction coordinator). This is the one genuine cross-system seam.
- **Transaction D — Membership creation + invitation acceptance:** one
  ordinary Postgres transaction, `accept_invitation()`, run *after*
  Transaction C succeeds for a new user (or directly, for an existing
  user) — fully atomic: both memberships (or the one applicable one) and
  the `invitations` status flip happen together, or neither does.
- **The seam between C and D is exactly where the orphan-recovery rule
  applies** (§ Recovery, below) — it is the one place in this whole
  design that cannot be made transactionally atomic, by construction,
  not by oversight.

### Security

- **Token replay:** rejected by the `WHERE status = 'pending'` UPDATE
  clause inside `accept_invitation()`.
- **Forwarding:** mitigated, not eliminated, by the identity-match
  check (§ Existing-user) — for a new account, forwarding is an
  accepted residual risk shared with every link-based provisioning flow
  industry-wide.
- **Wrong email:** rejected by the same identity-match check, now
  correctly specified against the Supabase-Auth-authoritative source
  (§3, `RECOMMENDATION CHANGED`).
- **Cross-tenant acceptance:** rejected structurally — every scope
  value `accept_invitation()` writes comes from the `invitations` row,
  never the request; reliability of the `client_org_id`/`tenant_id`
  *read* additionally depends on the Finding-1 fix.
- **Role tampering:** rejected the same way — `role_id` is read from
  the invitation row only, validated against the fixed allowlist both
  at creation and again at acceptance.
- **Invitation enumeration:** the anon-reachable preview function
  returns an identical, generic shape for "doesn't exist"/"expired"/
  "already used"/"revoked" — never a distinguishing message.
- **Account enumeration:** unaffected by this design beyond the
  pre-existing, already-documented (§3 of the P2B design doc) gap that
  `public.users.email` carries no database-level uniqueness guarantee —
  not solved or worsened by P2B.
- **Token leakage:** closed per §4's table above — hash-only storage,
  no raw-token logging anywhere, one-time display, redirect-to-clean-URL
  after validation.

### Recovery

- **Failed membership creation** (Transaction D fails after Transaction
  C already succeeded): the invitation remains `pending` (Transaction D
  rolled back in full, including its own status-flip). The invitee (or
  the inviting manager) simply uses the **same link again** — this now
  routes through the existing-user branch automatically, since the
  Auth/`public.users` row already exists. No new "resume"/"repair" code
  path is needed.
- **Partially completed new-user provisioning:** by definition, this
  *is* the case above — "partially completed" means Transaction C
  succeeded and Transaction D did not. The Auth account is never
  auto-deleted (a second fallible cross-system operation is not an
  improvement over leaving a real account intact and retryable).
- **Retry behavior:** automatic on next click of the same link, bounded
  by the invitation's own remaining TTL; a repeated, persistent failure
  after retries is a manual-operations matter, resolved with the
  already-existing (P2B.2) membership-grant function against the now-
  ordinary existing user — not a new system.

### Email delivery boundary

Unchanged from P2B.0: domain logic and a transport interface are P2B's
own scope; the MVP transport is a manual/local stand-in (the link is
returned once to the authorized creator); a real provider integration
is an explicit, separate, later slice.

### Out of scope

Unchanged from P2B.0 (bulk invitations, SSO, SCIM, domain-wide auto-
provisioning, organisation-configurable policies, a client-role-
authoring UI, changing `client_org_id` after creation, a scheduled
expiry-sweep job, production email-provider integration) — **plus,
explicitly, for this clarification round:** building any general
"suspend/reactivate a user" feature (the Finding-1 fix only needs to
*block* self-service tampering with `status`; it does not need to add
the missing suspend/reactivate capability itself, which remains
unbuilt and out of scope here as it was before).

---

## 7. Remaining Open Decisions

All nine from P2B.0 stand as previously resolved, **except** Decision 1
(practice-side eligibility), which was explicitly left open in P2B.0
pending this deeper investigation and is now resolved above (§5, §6 —
prohibited). No decision from P2B.0 was reversed in the other
direction; two were sharpened (`RECOMMENDATION CHANGED` markers, §3 and
§6). One new, required item is added, and should be treated as
approval-required alongside the original four from P2B.0:

- **NEW: approve the `users` reparenting-guard fix as a required
  prerequisite migration**, landing before or as the first step of
  P2B.1 — this is the one item in this document that is not purely a
  product judgment call; it is a confirmed, live-verified security gap
  independent of P2B's own feature, and this review recommends treating
  it as blocking for P2B specifically (since P2B is the first feature
  whose correctness depends on the column it protects) even though its
  root cause predates P2B entirely.
