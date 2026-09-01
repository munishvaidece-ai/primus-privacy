# PRIMUS PRIVACY — Progress Log

Status: 2026-09-01 — Milestone 2 COMPLETE (Session 5): Client Master Data
(the seven DATA_MODEL.md §5.1 entities, identity+SCD2-versioned)
implemented, migrated, and tested against real PostgreSQL 16. No
Processing Activity or anything downstream of it; no product UI.
Milestone 1 (Session 4) and the architecture gate (Sessions 1-3) passed
before this milestone began.

## Milestone 2 — Client Master Data (Session 5, 2026-09-01)

**Scope:** exactly what MILESTONE 2 instructed — the seven master-data
entities (Business Unit, Data Principal Category, Personal Data Element,
Purpose, System, Data Store, Processor) with the identity+SCD2 versioning
mechanism from DATA_MODEL.md §5.1. No Processing Activity, ROPA, Data
Flows, Controls, Assessments, Evidence workflows, Risk, Findings,
Remediation, DPIA, AI, dashboards, or reports — none of those tables, or
the junction tables that would connect them to this milestone's master
data, exist anywhere in this schema. No real personal data anywhere
(synthetic test fixtures only — `"ABC Financial Services"`, `"Customer
CRM"`, etc., matching the milestone's own worked examples).

Read `DATA_MODEL.md` §5.1-§5.5 and the actual Milestone 1 code
(`db/schema/*.ts`, `drizzle/migrations/0000-0001`) fresh from disk before
writing anything, per instruction — the identity+composite-FK+
denormalized-scoping-column pattern this milestone uses throughout is a
direct extension of Milestone 1's `organisations`/`engagements` pattern,
not a new one invented from scratch.

### What was implemented

- **Drizzle TS schema** (`db/schema/*.ts`, 7 new files): `businessUnits`
  (identity only — DATA_MODEL.md §5.1's explicit no-version-table
  carve-out); `dataPrincipalCategories`/`dataPrincipalCategoryVersions`;
  `personalDataElements`/`personalDataElementVersions`;
  `purposes`/`purposeVersions`; `systems`/`systemVersions`;
  `dataStores`/`dataStoreVersions`; `processors`/`processorVersions` — 13
  tables total.
- **Migration 0002** (`drizzle-kit` generated from the TS schema): all 13
  tables, 2 new Postgres enums (`master_data_status`,
  `data_sensitivity`), composite FKs from every version table to its
  identity table `(id, organisation_id)`, `DataStoreVersion.
  system_version_id`'s composite FK to `system_versions(id,
  organisation_id)`, `Processor.parent_processor_id`'s self-referential
  composite FK (keeping subprocessor chains within one organisation), and
  a partial unique index per version table enforcing "at most one current
  version per identity, ever" — SCD2's core invariant, database-enforced.
- **Migration 0003** (hand-written, per DECISIONS.md R-02): the
  `users(id)` audit-column FKs; one generic reparenting-guard trigger
  (`organisation_id` immutable after creation) reused across all 7
  identity tables (DECISIONS.md R-31); six explicit SCD2 close-out
  triggers, one per version table, that atomically supersede the previous
  current version — descriptive fields untouched, only `is_current`/
  `valid_to` change (DECISIONS.md R-26 explains why `BEFORE INSERT`, not
  `AFTER`); RLS enabled with `FORCE` on all 13 tables and 33 policies,
  every one reusing Milestone 1's `can_access_organisation()` helper
  unchanged (instruction §14: no second authorization mechanism); 13
  `GRANT`/`REVOKE` statements, including version tables getting no
  `UPDATE` grant at all for `authenticated` (DECISIONS.md R-27 — version
  rows are immutable at the privilege level, not just by RLS policy); and
  13 auto-audit triggers (one generic function, DECISIONS.md R-30) making
  master-data creation/modification/version-creation genuinely auditable
  now, not left as a promise for a future application layer.

### Migration names

- `0002_client_master_data.sql`
- `0003_client_master_data_security.sql`

(Milestone 1's `0000_identity_tenancy_engagement.sql` and
`0001_identity_tenancy_engagement_security.sql` were **not modified** —
instruction §19. `drizzle/migrations/meta/_journal.json` and the
matching snapshot file were renumbered from `0001`/idx 1 to `0002`/idx 2
immediately after generation, before any other work, to resolve a
filename collision with Milestone 1's hand-written `0001` file — `npx
drizzle-kit generate` was re-run afterward and reported "No schema
changes, nothing to migrate," confirming the renumbering left drizzle-kit's
own bookkeeping consistent.)

### Relationship summary

`Organisation` 1→N each of the 7 identity tables (`organisation_id` FK).
Each identity table 1→N its own version rows (`<entity>_id` FK), with a
composite FK `(< entity>_id, organisation_id) → identity(id,
organisation_id)` guaranteeing the denormalized `organisation_id` on
every version row can never drift from its identity row's real owner.
`DataStoreVersion.system_version_id` → `system_versions(id,
organisation_id)` (nullable — "may relate to a System," instruction §10).
`Processor.parent_processor_id` → `processors(id, organisation_id)`
(self-referential, nullable — subprocessor chain, DECISIONS.md R-03,
unchanged). `BusinessUnit.parent_business_unit_id` → `business_units.id`
(self-referential, nullable — the one hierarchy column DATA_MODEL.md §2
already specified, not a hierarchy *engine*). No junction tables to
`ProcessingActivity` exist — deliberately (instruction §12; see
DECISIONS.md R-28 for how the "cannot reference a version from another
organisation" property is proven anyway).

### RLS policy summary

33 new policies (21 across the 7 identity tables — SELECT/INSERT/UPDATE
each; 12 across the 6 version tables — SELECT/INSERT each, no UPDATE).
Every one evaluates `public.can_access_organisation(organisation_id)`
unchanged from Milestone 1 — reused, not reimplemented (instruction
§14). `anon` has zero grants on any of the 13 tables (verified directly
against `information_schema.role_table_grants`, count = 0). Version
tables additionally have no `UPDATE` grant for `authenticated` at the
privilege level (not just no RLS policy) — the only way a version row's
lifecycle columns ever change after creation is the `SECURITY DEFINER`
close-out trigger, verified directly: a raw `UPDATE system_versions SET
owner = ...` as an authenticated user fails with "permission denied"
before RLS is even reached.

### Authorization model

Unchanged from Milestone 1, reused as instructed (§14): the application
layer decides *what* a user should be allowed to do; RLS decides whether
a database operation crosses a security boundary. No second
authorization mechanism was introduced — every Milestone 2 policy calls
the exact same `can_access_organisation()` function Milestone 1's
`organisations`/`engagements` policies already used.

### Tests actually executed and exact results

All of the following were run against a real local PostgreSQL 16.13
database (`primus_privacy_test`), reset from scratch before each full
run — not type-only checks, not mocked:

1. `npx tsc --noEmit` — **passed, zero errors**.
2. `npm run lint` (`eslint .`) — **passed, zero errors/warnings**.
3. `npx drizzle-kit generate` — succeeded (twice: once to produce
   `0002_client_master_data.sql`, once afterward to confirm "No schema
   changes, nothing to migrate" after the journal renumbering).
4. `npx tsx scripts/apply-migrations.ts` — all 4 migration files (0000
   through 0003) applied successfully, via `scripts/reset-test-db.ts`
   (fresh database each run).
5. `npx next build` — **succeeded** (2 static routes — unchanged from
   Milestone 1, confirming no UI was added).
6. `npm run test:db` (`tsx scripts/reset-test-db.ts && vitest run
   tests/rls tests/master-data`) — **46/46 tests passed**, run twice
   consecutively against a freshly reset database each time:

   ```
   ✓ tests/master-data/version-tenant-consistency.test.ts  (6 tests)
   ✓ tests/master-data/system-versioning.test.ts            (7 tests)
   ✓ tests/master-data/entity-coverage.test.ts               (6 tests)
   ✓ tests/rls/membership-boundaries.test.ts                 (7 tests)
   ✓ tests/master-data/tenant-org-isolation.test.ts          (6 tests)
   ✓ tests/rls/tenancy-consistency.test.ts                   (6 tests)
   ✓ tests/rls/tenant-isolation.test.ts                      (5 tests)
   ✓ tests/rls/engagement-access.test.ts                     (3 tests)
   Test Files  8 passed (8)
        Tests  46 passed (46)
   ```

   All 46 tests actually execute SQL against Postgres; none merely
   inspect TypeScript types or source code (instruction §18).

   **Three genuine bugs were found and fixed by this suite while writing
   it — not merely passed around:**
   - **`CREATE TEMP TABLE ... REFERENCES <permanent table>`** — Postgres
     rejects a foreign key from a temporary table to a permanent one
     ("constraints on temporary tables may reference only temporary
     tables"). Fixed by using an ordinary table instead, created and
     rolled back within the test's own transaction (same cleanup
     guarantee `ON COMMIT DROP` would have given, via the transaction
     boundary instead) — DECISIONS.md R-28.
   - **A real timestamp-precision bug in the point-in-time versioning
     test**, caught two ways in sequence: first, creating both CRM
     versions inside one `asFixtureSetup` transaction gave them the
     *identical* timestamp, because Postgres's `now()` is frozen for an
     entire transaction, not evaluated fresh per statement — fixed by
     using separate transactions per version (which also just matches
     reality: real version-creation events are separate application
     actions). Second, after that fix, the boundary comparison still
     failed intermittently because `pg` returns `timestamptz` as a
     JavaScript `Date` (millisecond precision) while Postgres stores
     microseconds — round-tripping a version row's own boundary
     timestamp through JS could lose enough precision to flip a
     `<=`/`<` comparison exactly at the boundary. Fixed by capturing
     independent "as of" markers via fresh `SELECT now()` calls with a
     real 50ms wall-clock margin on each side, instead of reusing a
     version row's own timestamp — the realistic case anyway (a
     "what did this look like during FY2026" query picks an arbitrary
     moment, not the exact millisecond a row was inserted).
   - **A transaction-abort ordering bug** in the composite-FK consistency
     test: asserting an `INSERT` fails, then trying a second `INSERT` in
     the *same* Postgres transaction, doesn't work — a failed statement
     aborts the whole transaction until it ends, so the second command was
     always rejected regardless of its own correctness. Fixed by splitting
     into two independent tests, each with its own transaction.

7. **Manual security inspection**, run directly against the test database
   (not inferred from the SQL source alone), per instruction §21:
   - `information_schema.tables` — 24 tables total (11 from Milestone 1 +
     13 new), confirmed exactly.
   - `pg_class.relrowsecurity`/`relforcerowsecurity` — RLS enabled and
     `FORCE`d on all 13 new tables.
   - `pg_policies` — exactly 33 new policies, matching the design (21 +
     12).
   - `information_schema.role_table_grants` — `authenticated` has exactly
     `SELECT, INSERT` on every version table (no `UPDATE`); `anon` has
     zero grants on any of the 13 new tables.
   - `information_schema.triggers` — trigger counts per table match the
     design exactly (identity tables: reparenting-guard + audit-log = 2
     distinct triggers, showing as 3 rows because the audit-log trigger's
     `AFTER INSERT OR UPDATE` produces one information_schema row per
     event; version tables: close-out + audit-log = 2 triggers, 2 rows).
   - A direct `psql` smoke test confirmed the audit-log triggers actually
     write correct, attributed rows: creating a `System` and a
     `SystemVersion` as an authenticated user produced exactly two
     `audit_log` entries (`systems`/`insert`, `system_versions`/`insert`),
     both correctly attributed to the acting user via `auth.uid()`.

### Historical-state scenario result (instruction §4, the required test)

Directly verified, both by a manual `psql` walk-through before writing
the automated suite and by `tests/master-data/system-versioning.test.ts`
afterward — **all 5 required demonstrations hold**:

1. **Both versions remain queryable** — `SELECT * FROM system_versions
   WHERE system_id = ...` returns both rows, with their original
   `owner`/`hosting_environment` values intact.
2. **FY2026 still resolves to Version 1** — a point-in-time query "as of"
   a marker taken during the FY2026 window returns Version 1
   (`owner = 'Digital Banking'`, `hosting_environment = 'India'`).
3. **FY2027 resolves to Version 2** — the same query shape, marker taken
   during the FY2027 window, returns Version 2 (`owner = 'Technology'`,
   `hosting_environment = 'Singapore'`).
4. **Reading the current CRM state returns Version 2** — `systems JOIN
   system_versions ON is_current = true` resolves to Version 2.
5. **Changing Version 2 does not rewrite Version 1** — inserting a
   Version 3 leaves Version 1's own fields completely untouched, and
   Version 2's own fields (not just Version 1's) also stay untouched —
   only its `is_current`/`valid_to` bookkeeping columns change, because
   it was superseded, not edited. A direct `UPDATE system_versions SET
   owner = 'tampered'` against a historical version is rejected outright
   ("permission denied") — there is no grant path to it at all.

### Cross-tenant test result (instructions §13-§14, the required tests)

All required, directly verified by `tests/master-data/
tenant-org-isolation.test.ts` and `tests/master-data/
version-tenant-consistency.test.ts`:

- **Organisation A can access its own master data** — pass.
- **Organisation A cannot access Organisation B's master data, even
  under the same Tenant** — pass (both a direct-id lookup and an
  unfiltered listing were checked, to rule out a policy that only
  filters point lookups).
- **Tenant A cannot access Tenant B's master data** — pass.
- **A user without appropriate membership cannot access protected
  records** — pass, for both a provisioned-but-unaffiliated user and a
  fully anonymous request (denied at the `GRANT` level, before RLS is
  even evaluated).
- **An engagement cannot reference a version belonging to another
  Organisation/Tenant** — pass, proven via the scratch-table mechanism
  described above (DECISIONS.md R-28) plus the two real, already-shipped
  composite FKs (`DataStoreVersion.system_version_id`,
  `Processor.parent_processor_id`) that touch this same property
  directly.
- **Cross-tenant reads are blocked by RLS** — pass, covered by the same
  tests as the bullets above.

### Known limitations

1. **Same local-Postgres-plus-shim testing posture as Milestone 1**
   (DECISIONS.md R-24) — D-03 (data residency) is still open, so no real
   Supabase project exists. Nothing new here; the two real migrations are
   unmodified, Supabase-deployable SQL.
2. **No `ProcessingActivity` and no junction tables to it** — deliberate,
   per instruction §12. The composite-FK mechanism that will make those
   junctions safe is proven (DECISIONS.md R-28) but not yet wired to a
   real product table.
3. **`ProcessorVersion.dpa_document_id` is not implemented** — no
   Document/Evidence table exists yet to reference (DECISIONS.md R-29).
4. **Business Unit hierarchy is exactly the one column DATA_MODEL.md §2
   already specified** (`parent_business_unit_id`) — no cycle-prevention
   trigger, no depth limit, no hierarchy-aware query helpers. Not
   required by this milestone's instructions (§5: "do not yet build
   sophisticated organisational hierarchy"); would need attention before
   any UI tries to render a BU tree.
5. **Auto-audit triggers log the full new/changed row as JSON**
   (`to_jsonb(NEW)`, or an old/new pair for updates) rather than a
   field-level diff — informative enough to prove auditability works, but
   a real audit-log UI (a later milestone, explicitly out of scope here
   too) would likely want a tighter, field-level diff format.
6. **No migration-history tracking table still** — same limitation noted
   in Milestone 1's report; now four files deep, still applied
   unconditionally in filename order by `scripts/apply-migrations.ts`.
   Worth addressing before a fifth migration makes this a real risk.

### Next milestone

Per the STOP CONDITION: this milestone is complete and the session stops
here, before any Processing Activity work. Recommended next milestone
(not started, pending review/approval): **Milestone 3 — Processing
Activity & the Version-Pinned Junction Layer**, covering DATA_MODEL.md
§5.2-§5.4: the `ProcessingActivity` table itself (engagement-scoped, with
its `carried_forward_from_id` chain), the version-pinned junction tables
connecting it to this milestone's seven master-data entities
(`ProcessingActivitySystem`, `ProcessingActivityProcessor`, etc. —
DATA_MODEL.md §5.3), and the "carry forward into a new engagement" action
(§5.4) — at which point the scratch-table proof in this milestone's
`version-tenant-consistency.test.ts` can be replaced with real tests
against the real junction tables, and the FY2026→FY2027 worked example
from DATA_MODEL.md §5.5 (Processor XYZ replaced by Processor ABC, PA-014
reassessed) becomes fully testable end to end for the first time.

## Milestone 1 — Database Foundation (Session 4, 2026-09-01)

**Scope:** exactly what MILESTONE 1 instructed — Identity + Tenancy +
Engagement Structure only. No Processing Activity, Personal Data,
Systems, Processors, Controls, Assessments, Evidence, Risks, Findings,
Remediation, DPIA, AI, Reports, or Dashboards tables; no UI; no mock/demo
client data.

### What was implemented

- **Project scaffold** (did not exist before this milestone): `package.json`
  (Next.js 14.2.35, TypeScript, Drizzle ORM 0.45.2 / drizzle-kit 0.31.10,
  `pg`, Vitest, ESLint), `tsconfig.json`, `next.config.mjs`,
  `.eslintrc.json`, `.gitignore`, `.env.example`. `app/layout.tsx` +
  `app/page.tsx` are the minimum placeholder required for a valid Next.js
  App Router project — explicitly not product UI (both files say so in
  their own comments).
- **Drizzle TS schema** (`db/schema/*.ts`): `tenants`, `organisations`,
  `users`, `engagements`, `roles`, `permissions`, `role_permissions`,
  `tenant_memberships`, `organisation_memberships`,
  `engagement_memberships`, `audit_log` — 11 tables total.
- **Migration 0000** (`drizzle/migrations/0000_identity_tenancy_engagement.sql`,
  drizzle-kit generated from the TS schema): all 11 tables, 8 Postgres
  enums, the composite FK `engagements(organisation_id, tenant_id) →
  organisations(id, tenant_id)` that makes "Engagement.tenant_id =
  Organisation.tenant_id" a database-enforced invariant rather than a
  convention, and the three partial unique indexes preventing duplicate
  *active* memberships.
- **Migration 0001** (`drizzle/migrations/0001_identity_tenancy_engagement_security.sql`,
  hand-written per DECISIONS.md R-02): the `auth.users(id)` FK on `users`
  and the audit-column FKs to `users(id)` (added here rather than in the
  Drizzle TS schema to avoid a circular module import — see
  `db/schema/tenants.ts`); two reparenting-guard triggers; the
  `auth.users → public.users` provisioning trigger and an email-sync
  trigger; seven `SECURITY DEFINER` authorization helper functions; RLS
  enabled (with `FORCE` on every tenant-scoped table) and 17 policies
  across all 11 tables; table- and function-level `GRANT`/`REVOKE`
  statements enforcing `anon` has zero access and `audit_log` is
  append-only even against `service_role`.
- **`db/seed/roles.ts`**: seeds the 12 roles from PRODUCT_SPEC.md §2 and
  8 representative permissions (reference/taxonomy data, not application
  mock data — Milestone 1 instructions §12 explicitly distinguish the
  two). Idempotent.
- **`scripts/local-dev-auth-shim.sql`**, **`scripts/apply-migrations.ts`**,
  **`scripts/reset-test-db.ts`**: the local testing harness — see "Known
  limitations" below for exactly what the shim does and does not
  replicate from real Supabase.
- **`tests/rls/*`**: 21 automated tests across 4 files, described below.

### Migration names

- `0000_identity_tenancy_engagement.sql`
- `0001_identity_tenancy_engagement_security.sql`

### Tests executed and exact results

All of the following were actually run in this session, against a real
local PostgreSQL 16.13 database (`primus_privacy_test`) — not type-only
checks, not mocked:

1. `npx tsc --noEmit` — **passed, zero errors** (run twice: once after
   the schema files, once after the full test suite).
2. `npm run lint` (`eslint .`, `next/core-web-vitals` config) — **passed,
   zero errors/warnings**.
3. `npx drizzle-kit generate` — succeeded, produced `0000_...sql` from
   the TS schema without manual intervention.
4. `npx tsx scripts/apply-migrations.ts <test-db-url>` — **both migration
   files applied successfully**, run twice (fresh database each time, via
   `scripts/reset-test-db.ts`) with identical results — not flaky.
5. `npx next build` — **succeeded** ("Compiled successfully", 2 static
   routes generated) — confirms the scaffold itself is valid, though
   Milestone 1 does not depend on this.
6. `npm run test:rls` (`tsx scripts/reset-test-db.ts && vitest run
   tests/rls`) — **21/21 tests passed**, run twice consecutively against
   a freshly reset database each time:

   ```
   ✓ tests/rls/membership-boundaries.test.ts  (7 tests)
   ✓ tests/rls/tenancy-consistency.test.ts    (6 tests)
   ✓ tests/rls/tenant-isolation.test.ts       (5 tests)
   ✓ tests/rls/engagement-access.test.ts      (3 tests)
   Test Files  4 passed (4)
        Tests  21 passed (21)
   ```

   Mapped to Milestone 1 instructions §10's required tests:
   - **Test 1** (Tenant A user can access Tenant A data) —
     `tenant-isolation.test.ts`.
   - **Test 2** (Tenant A user cannot access Tenant B data) —
     `tenant-isolation.test.ts` (including an unfiltered-scan variant, to
     rule out a policy that only filters point lookups).
   - **Test 3** (an Organisation cannot be re-associated with a different
     Tenant) — `tenancy-consistency.test.ts`, checked against a
     superuser bypassing RLS *and* an authorized authenticated user, both
     blocked by the `organisations_prevent_reparenting` trigger; an
     ordinary (non-tenant-changing) update by the same user is proven to
     still succeed, ruling out an over-broad block.
   - **Test 4** (an Engagement belonging to Tenant A cannot be accessed
     by a Tenant B user) — `engagement-access.test.ts`, specifically
     using a Tenant B user who holds *real, active* membership on their
     own engagement, to prove legitimate access elsewhere doesn't leak
     across tenants.
   - **Test 5** (an Engagement cannot be created with an inconsistent
     Organisation/Tenant pair) — `tenancy-consistency.test.ts`, checked
     against a superuser bypassing RLS *and* an authenticated user whose
     RLS `WITH CHECK` would otherwise have permitted it — proving the
     composite FK is a real, independent second layer, not redundant
     with RLS.
   - **Test 6** (a user with no relevant membership cannot access
     protected records) — `tenant-isolation.test.ts`, both for a
     provisioned-but-unaffiliated user and for a fully anonymous request
     (which fails at the `GRANT` level before RLS is even evaluated).
   - **Test 7** (membership boundaries behave per the documented model) —
     `membership-boundaries.test.ts`: (a) `OrganisationMembership` grants
     access to every engagement under that org; (b) `EngagementMembership`
     grants access only to that one engagement, not its siblings; (c)
     `TenantMembership` alone does **not** grant organisation/engagement
     content access (but does grant visibility of the tenant row itself);
     (d) a revoked membership no longer grants access; (e) a duplicate
     *active* membership is rejected by the partial unique index, while
     re-granting after a revocation succeeds as a new row (history
     preserved, not overwritten).

   **A genuine bug was found and fixed by this test suite, not merely
   passed around:** the first full run failed one test (`Test 5c`) with
   `new row violates row-level security policy for table "engagements"`.
   Root cause: `can_access_engagement()` re-queried the `engagements`
   table itself to look up `organisation_id` from `p_engagement_id`, and
   that self-referential subquery cannot see a row still being inserted
   by the same `INSERT ... RETURNING` command (a documented Postgres RLS
   visibility limitation). Fixed by changing the function to accept
   `organisation_id` directly as a second argument — it's already a
   column of the row being checked, so no subquery was ever necessary.
   Recorded as a corrected implementation, not a workaround; see the
   migration file's own comment on `can_access_engagement`. Re-run twice
   after the fix: 21/21 passing both times.

### Manual security inspection performed (Milestone 1 instructions §11)

Run directly against the test database via `psql`, not inferred from the
SQL source alone:

- `pg_class.relrowsecurity` / `relforcerowsecurity` — confirmed RLS
  enabled on all 11 tables, `FORCE` set on the 8 tenant/scope-sensitive
  ones (`tenants`, `organisations`, `engagements`, `users`,
  `tenant_memberships`, `organisation_memberships`,
  `engagement_memberships`, `audit_log`).
- `pg_policies` — confirmed all 17 intended policies exist, correctly
  named and scoped to the `authenticated` role.
- `information_schema.role_table_grants` — confirmed `anon` has **zero**
  grants on any Milestone 1 table (an anonymous request fails with
  `permission denied` before RLS is even reached — verified in
  `tenant-isolation.test.ts`); confirmed `audit_log` grants are exactly
  `SELECT, INSERT` for `authenticated` and `service_role` with no
  `UPDATE`/`DELETE` for either — append-only holds even against
  `service_role`, which otherwise bypasses RLS entirely (`BYPASSRLS`).
  (The table-owning `postgres` role retains full privileges, as any
  database owner/superuser always does — this is the DBA/migration role,
  never the running application, and is outside RLS's threat model by
  design, same as in real Supabase's `postgres`/`supabase_admin`.)
- `information_schema.triggers` — confirmed all 4 triggers exist on the
  correct schema-qualified tables (`public.organisations`,
  `public.engagements`, `auth.users` ×2 — not `public.users`, which would
  have been a real bug).

### Known limitations

1. **No real Supabase project exists yet** (DECISIONS.md D-03, data
   residency, is still open). Tests run against local PostgreSQL 16.13
   with a hand-written `auth` schema/role shim
   (`scripts/local-dev-auth-shim.sql`) that reimplements `auth.uid()`
   exactly and stands up `anon`/`authenticated`/`service_role`. The
   actual migrations are unmodified Supabase-deployable SQL; only the
   shim is local-only (its file header says so explicitly, twice). Full
   verification against a real Supabase project — including PostgREST's
   JWT handling, connection pooling, and Storage — is still needed once
   D-03 is resolved. See DECISIONS.md R-24.
2. **Membership grants/revocations have no `authenticated`-role write
   path in this milestone's RLS** — only `service_role` (i.e.,
   server-only application code, after its own permission check) can
   INSERT/UPDATE a membership row. This is a deliberate scope decision
   (DECISIONS.md R-17), not an oversight; the server-side
   membership-granting service itself is a later milestone's work (no
   application code exists yet at all).
3. **Business Unit, `control_library_version_id`, and
   `EngagementMembership.business_unit_id`** are not in this schema —
   deliberately deferred (DECISIONS.md R-23), matching Milestone 1's
   explicit scope list.
4. **The permission catalogue is representative, not exhaustive** — 8
   permissions seeded, covering enough to prove `Role`/`Permission`/
   `RolePermission` work end to end. Building out the full permission
   catalogue is ongoing work across every future milestone, not a
   Milestone 1 deliverable (Milestone 1 instructions §3).
5. **`npm audit` reports vulnerabilities in transitive dev dependencies**
   (Next.js's Server Actions/Middleware/Image-Optimizer-related CVEs
   patched only in Next 15+; esbuild/vite/glob chains under
   drizzle-kit/vitest/tsx). `drizzle-orm`'s directly-relevant SQL-injection
   advisory was fixed by upgrading to the patched 0.45.2/0.31.10 pair
   before writing any schema code. The Next.js advisories are all in
   subsystems this milestone's placeholder page never exercises (no
   Server Actions, no Middleware, no Image Optimization, no rewrites) —
   upgrading Next's major version is a decision for whichever milestone
   first builds real application routes, not this DB-only one; tracked
   here rather than silently ignored.
6. **No migration-history tracking table** — `scripts/apply-migrations.ts`
   applies every `.sql` file in the directory in filename order,
   unconditionally; there's no ledger of "already applied" yet. Fine for
   a single milestone's two files; worth adding before a third migration
   makes re-running the whole set on an existing database a real risk.

### Next milestone

Per the STOP CONDITION: this milestone is complete and the session stops
here. Recommended next milestone (not started, pending review/approval):
**Milestone 2 — Client Master Data**, covering the seven master-data
entities from DATA_MODEL.md §5.1 (Business Unit, Data Principal Category,
Personal Data Element, Purpose, System, Data Store, Processor) with their
identity+SCD2-version-table mechanism, building on this milestone's
Tenant → Organisation → Engagement foundation and its `can_access_*`
helper functions.

## Session 3 — Continued Architecture Validation (2026-09-01)

**What happened:** resumed from the Session 2 state (working tree clean,
two commits already on `claude/primus-privacy-architecture-39p3gh`) to
finish the requested consistency work, rather than redo D-01/D-02 from
scratch. Re-read all five architecture documents from disk (not from
memory) and checked them line by line against each other and against the
FY2026→FY2027 scenario, rather than re-asserting the Session 2 report's
conclusions unverified. This found and fixed six real inconsistencies:

1. `DATA_MODEL.md` §1 used `client_id` in the general naming convention
   while every entity table elsewhere used `client_org_id` — fixed to
   match (and to also name `tenant_id` explicitly as the second
   tenant-scoping column, per §2/§12).
2. `ARCHITECTURE.md` §3's layers diagram still described the
   Authorization/Policy layer as resolving only `EngagementMembership`,
   left over from before the Session 2 Tenant/Organisation/Engagement
   membership model — fixed.
3. `SECURITY.md` §14's threat table named only `EngagementMembership` in
   the privilege-escalation mitigation row — fixed to name all three
   membership scopes.
4. **A genuine, if minor, gap against this session's explicit "historical
   data cannot be silently rewritten by current-state changes" check:**
   `RiskScoringModel` and `MaturityDomainWeight` were described as
   "versioned"/"configurable" without ever stating the append-only /
   frozen-per-engagement discipline already applied to
   `ControlLibraryVersion` and the D-02 master-data mechanism. An in-place
   edit to either would have silently changed the documented basis for
   already-scored risks or already-computed maturity snapshots. Closed by
   making both explicitly append-only/frozen (DATA_MODEL.md §8–§9,
   DECISIONS.md R-16) — `Risk` and `MaturityScore` already stored
   computed-once values, so no other structural change was needed, only
   the explicit rule.
5. `PRODUCT_SPEC.md` (not one of the five named documents, but checked for
   overall consistency) used "tenant" informally to mean "client" in
   several places predating the Session 2 `Tenant` entity, which now
   conflicts with the resolved model — fixed §2/§4/§5 wording.
6. `README.md` and `ROADMAP.md` (same) still described D-01/D-02 as open
   items shaping the first migration, and used "tenant" loosely in two
   more places — fixed.

No new DECISION REQUIRED items were raised — the one gap found (#4) was
closable by engineering judgment (applying a pattern the schema already
uses elsewhere, consistently), not a new product/business ambiguity.

No database migrations, application scaffolding, or code were created —
this session remained architecture validation only, per explicit
instruction.

## Session 2 — Architecture Validation (2026-09-01)

**What happened:** the product owner reviewed the Session 1 report and
issued explicit direction resolving both blocking decisions:

- **D-01 (tenancy):** multi-tenant from Day 1 via a new `Tenant` entity;
  exactly one `Tenant` row in the MVP deployment; no white-label,
  multi-practice admin UI, billing, or branding functionality built now.
- **D-02 (data-landscape persistence):** a client-level master-data tier
  (Business Units, Data Principal Categories, Personal Data Elements,
  Purposes, Systems, Data Stores, Processors) versioned via
  Slowly-Changing-Dimension Type 2, referenced by version-pinned junctions
  from engagement-scoped assessment objects (Processing Activity, Data
  Flow, Assessment, Evidence, Risk, Finding, Remediation, DPIA, AI Use
  Case, Maturity Assessment, Quality Review).

Both are now marked **RESOLVED** in `DECISIONS.md` (with the original
framing kept for record), and `DATA_MODEL.md`, `ARCHITECTURE.md`, and
`SECURITY.md` were updated to reflect the resulting model. No database
migrations, application scaffolding, or code were created — this session
remained architecture validation only, per explicit instruction.

**Architecture consistency review** — performed against the updated
model, as required before this session could report the architecture
ready for implementation:

| # | Check | Result |
|---|---|---|
| 1 | Every entity relationship still makes sense | Pass — `Tenant` added as a clean new outer layer; `Organisation` simplified to client-only; master/engagement split is a clarification of §5, not a contradiction of §2–§4 or §6–§10, which are unchanged. |
| 2 | Tenant isolation works with the new Practice/Tenant layer | Pass — `tenant_id` on `User`/`Organisation`, checked at both RLS and application layers, as the outermost of three nested boundaries (SECURITY.md §3). |
| 3 | Engagement isolation works | Pass — unchanged from Session 1: `EngagementMembership` remains the primary content-access boundary; engagements do not see each other. |
| 4 | Historical assessment state is preserved | Pass — confirmed by the FY2026/FY2027 worked example (DATA_MODEL.md §5.5): FY2026's `ProcessingActivity` row and its version-pinned junctions are untouched by FY2027's carry-forward, master-data edits, or the processor swap. |
| 5 | Processing Activity remains the central privacy object | Pass — unchanged; still the hub every Data-Landscape junction connects through, now engagement-scoped with a `carried_forward_from_id` chain rather than a mutable cross-engagement row. |
| 6 | ROPA remains a view/workflow over Processing Activities, not a duplicated dataset | Pass — an engagement's ROPA is a query over that engagement's `ProcessingActivity` rows and their (now version-pinned) junctions; no new ROPA-specific table was introduced. |
| 7 | Data Inventory remains a view over the underlying Personal Data model | Pass, with a documented nuance (DATA_MODEL.md §5.5): "current" Data Inventory can be read two ways — the client-wide `PersonalDataElement` master taxonomy (engagement-independent), or the latest engagement's actual in-use elements (via its junctions) — both are queries, neither is a new duplicated table. |
| 8 | Processor Register remains a view over Processor objects and their engagement relationships | Pass — current register = `Processor` identity + current `ProcessorVersion`, joined to whichever engagements currently reference it via `ProcessingActivityProcessor`; history per engagement is the version-pinned junction, not a duplicated register. |
| 9 | Risk, Finding, and Remediation remain independently identifiable objects | Pass — unchanged; still engagement-scoped, first-class tables with their own junctions (§8 of DATA_MODEL.md untouched by this session). |
| 10 | Assessment results are versioned/historically preserved | Pass — unchanged mechanism (`Assessment.previous_assessment_id`, finalize-then-immutable `AssessmentResponse`); unaffected by the master-data change since Assessment was already engagement-scoped. |
| 11 | Maturity calculations are reproducible for a historical assessment | Pass — `MaturityScore` was already an immutable, timestamped snapshot with `computed_from_control_test_ids`; those control tests trace to a specific `Assessment`, which traces to specific version-pinned Data-Landscape facts as of that engagement — the full chain is now reproducible end-to-end, including the client-fact layer that was previously unaddressed. |
| 12 | Evidence remains securely scoped to the appropriate tenant/client/engagement | Pass, with one deliberate, documented change: `Evidence.engagement_id` is now nullable (`client_org_id` is the always-required scope) so evidence can attach to a master-data version directly (DECISIONS.md R-14) — tenant/client scoping is never optional, only the engagement association is. |
| 13 | Client-visible and consultant-internal information remains appropriately separated | Pass — the `visibility` mechanism (Notes, Evidence) is untouched by this session; it applies identically regardless of whether the subject is engagement-scoped or master data. |

All 13 checks pass against the model as written. This is a documentation-level
consistency review, not a runtime test — there is no running system yet
to test against; see "What Has Not Been Implemented" below.

## What Has Been Completed

**Session 1:**
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

**Session 2:**
- D-01 and D-02 resolved per explicit product-owner direction and recorded
  in `DECISIONS.md`.
- `DATA_MODEL.md` §2 (Identity & Tenancy) and §5 (Data Landscape) rewritten
  to the two-tier (Tenant→Organisation→Engagement; client master data vs.
  engagement-scoped assessment objects) model, plus a worked example
  (§5.5) proving the mechanism against the product owner's FY2026/FY2027
  test scenario; §7, §11, §12, §13 updated for consistency.
- `ARCHITECTURE.md` §4 (Major Components) and §5 (Tenancy Model) rewritten;
  §6–§7, §10 updated for consistency.
- `SECURITY.md` §2 (Authorization) and §3 (Tenant Isolation) rewritten for
  the three-scope membership model (Tenant/Organisation/Engagement); §6
  updated.
- 13-point architecture consistency review performed and recorded above —
  all 13 pass against the documented model.
- 6 new recorded decisions added to `DECISIONS.md` (R-10 through R-15)
  covering the `Tenant` entity, the new membership scopes, the SCD2
  master-data mechanism, `AIUseCase` scoping, `Evidence.engagement_id`
  nullability, and the non-blocking Notice/Retention/Consent question.

**Session 3:**
- Re-verified (not re-asserted) the Session 2 resolution by re-reading all
  five architecture documents from disk and cross-checking entity
  names/relationships line by line, plus `PRODUCT_SPEC.md`, `README.md`,
  and `ROADMAP.md` for terminology drift against the new `Tenant` model.
- Found and fixed 6 inconsistencies (listed above under Session 3's own
  entry) — a naming slip, two stale pre-Session-2 wording leftovers, and
  one genuine historical-integrity gap (`RiskScoringModel`/
  `MaturityDomainWeight` now explicitly append-only/frozen-per-engagement).
- Added `DECISIONS.md` R-16 recording the gap and its fix.
- Re-confirmed the FY2026→FY2027 worked example (DATA_MODEL.md §5.5)
  against the exact scenario restated in this session's instructions —
  unchanged from Session 2's walk-through, still holds.
- No new DECISION REQUIRED items were needed.

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
  `DATA_MODEL.md`, `ARCHITECTURE.md`, and `SECURITY.md`), now including the
  `Tenant` layer and the master/engagement-scoped data-landscape split.
- Technology stack is selected and justified (`ARCHITECTURE.md` §2):
  Next.js + TypeScript + PostgreSQL + Supabase + Tailwind + shadcn/ui +
  Vercel, with Drizzle proposed (not yet adopted/installed) for
  schema-as-code.
- **D-01 and D-02 are resolved** (Session 2) — the two items that were
  previously load-bearing for the first schema migration no longer block
  it.
- Four DECISION REQUIRED items remain open (`DECISIONS.md`): **D-03**
  (data residency) blocks provisioning the first real Supabase project but
  not further documentation/design work; **D-04** (individual
  data-principal PII/DSR scope) does not block the first migration (the
  master-data tier is category-level only, as already assumed) but should
  be resolved before any DSR-adjacent feature is designed; **D-05**
  (malware scanning) and **D-06** (billing model) are Phase 2/3 items,
  correctly deferred.
- The architecture is now considered **ready for the first migration**,
  covering `Tenant`, `Organisation`, `User`, `Role`/`Permission`,
  `TenantMembership`/`OrganisationMembership`/`EngagementMembership`, and
  `Engagement` — conditional on D-03 (data residency) being resolved
  before a real Supabase project is provisioned, since that decision picks
  the project's region, not its schema.

## Next Approved Implementation Step

None yet — this session remained architecture validation only, per
explicit instruction ("do not implement yet"). The recommended next step,
pending explicit go-ahead from the product owner, is:

1. Resolve D-03 (data residency) — required before provisioning a real
   Supabase project, not before further schema design.
2. Scaffold the Next.js + TypeScript project (no business logic yet).
3. Provision a Supabase project (region per the D-03 resolution) for
   local/staging development.
4. Write the first migration covering `DATA_MODEL.md` §2–§3 (Tenant
   through Engagement Structure) with RLS policies for the new
   Tenant→Organisation→Engagement layering, and prove tenant isolation
   *and* organisation isolation *and* engagement isolation with tests
   before building anything on top of it.
5. As a second migration (not the first, to keep each migration
   reviewable): the client master-data tier (§5.1) and its version-pinned
   junction pattern, proven against a scenario mirroring the FY2026/FY2027
   worked example (§5.5) before any UI is built on top of it.

No further work should proceed without confirmation from the product
owner.
