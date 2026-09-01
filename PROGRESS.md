# PRIMUS PRIVACY — Progress Log

Status: 2026-09-01 — Milestone 4 COMPLETE (Session 7): Regulatory
Content & the Control Library — the practice-owned methodology layer
(RegulatoryReference, Requirement, ControlLibraryVersion, Control, and
their junctions), Tenant-scoped and structurally separate from client
engagement data, with database-enforced published-version immutability
and historical reproducibility, implemented, migrated, and tested against
real PostgreSQL 16. `Engagement.control_library_version_id` (deferred in
Milestone 1 — DECISIONS.md R-23) is wired up. No Assessments, Evidence,
Risk, Findings, Remediation, DPIA, AI, or reports; no product UI.
Milestones 1-3 (Sessions 4-6) and the architecture gate (Sessions 1-3)
passed before this milestone began.

## Milestone 4 — Regulatory Content & Control Library (Session 7, 2026-09-01)

**Scope:** exactly what MILESTONE 4 instructed — the practice-owned
methodology layer (`RegulatoryReference`, `Requirement`, `ControlLibraryVersion`,
`Control`) and their two junctions (`RequirementRegulatoryReference`,
`ControlRequirement`), per DATA_MODEL.md §6, plus wiring up
`Engagement.control_library_version_id` now that `ControlLibraryVersion`
exists. Strictly Tenant/Practice-scoped, never duplicated per client
Organisation. No `Assessment`, `AssessmentControl`, `AssessmentResponse`,
`ControlTest`, or anything downstream of them — none of those tables
exist anywhere in this schema. No legal-content scraping, no real
regulatory corpus, no AI-generated legal text, no legal-completeness or
legal-advice claims — every fixture in the test suite is synthetic and
clearly labeled as such. No product UI.

Read `DATA_MODEL.md` §6/§11/§12 and the actual Milestone 1-3 code
(`db/schema/tenants.ts`, `db/schema/engagements.ts`,
`db/schema/processing-activities.ts`, migrations 0000-0005) fresh from
disk before writing anything, per instruction. §12 was the decisive read:
it states directly that `Control`/`Requirement`/`RegulatoryReference`
belong to the Practice (Tenant), never a client, and that methodology
versioning is a *distinct* mechanism from the client SCD2 pattern
(§5.1) — both are load-bearing design constraints followed throughout,
not new decisions invented this session.

### What was implemented

- **Drizzle TS schema** (4 new files: `db/schema/regulatory-references.ts`,
  `db/schema/requirements.ts`, `db/schema/control-library.ts`,
  `db/schema/control-library-links.ts`): `regulatoryReferences`
  (`tenant_id`, `framework_name`, `citation`, `title`, `version`, `status`),
  `requirements` (`tenant_id`, `primary_regulatory_reference_id`, `title`,
  `description`, `status`), `controlLibraryVersions` (`tenant_id`,
  `version_label`, `status`, `published_at`), `controls` (`tenant_id`,
  `control_library_version_id`, `code`, `title`, `description`,
  `control_type`), and junctions `requirementRegulatoryReferences` /
  `controlRequirements` — 6 tables total, exactly matching DATA_MODEL.md
  §6's field list. All six carry `tenant_id` directly (not part of §6's
  original field list, which predates the Tenant/Practice split — see
  DATA_MODEL.md addendum, DECISIONS.md R-40).
- **Extended `db/schema/engagements.ts`** with the previously-deferred
  `control_library_version_id` column (nullable) and a composite FK to
  `control_library_versions(id, tenant_id)` (DECISIONS.md R-48,
  superseding R-23's deferral).
- **Migration 0006** (`drizzle-kit` generated from the TS schema; no
  statement-reordering was needed this time — every new `UNIQUE`
  constraint landed on a brand-new table, so drizzle-kit emitted them
  inline in `CREATE TABLE`, not as a later `ALTER TABLE` the way
  Milestone 3's collided with existing tables — reviewed and confirmed
  before use, not assumed safe by default): 6 new tables, 3 new enums
  (`regulatory_content_status`, `control_library_version_status`,
  `control_type`), the `engagements.control_library_version_id` column,
  and every composite FK described below.
- **Migration 0007** (hand-written, per DECISIONS.md R-02): audit-column
  FKs; a new `tenant_id`-keyed reparenting guard
  (`prevent_methodology_reparenting()`, DECISIONS.md R-41) on all four
  identity tables; a dedicated `engagements` trigger
  (`prevent_engagement_control_library_pin_change()`) blocking a pin to a
  `draft` version and blocking any change to an already-set pin; the
  `ControlLibraryVersion` status-transition/content-immutability trigger
  (`prevent_control_library_version_tampering()`, DECISIONS.md R-45); the
  `Control` and `ControlRequirement` draft-mutable guards
  (`enforce_control_draft_mutable()`, `enforce_control_requirement_draft_mutable()`)
  that are the actual mechanism making a *published* library's content
  immutable; RLS enabled with `FORCE` on all 6 tables and 21 policies,
  every one reusing Milestone 1's `can_access_tenant(uuid)` /
  `is_active_tenant_member(uuid)` unchanged (no second authorization
  framework) — with a deliberate read/write asymmetry: `SELECT` via the
  wider `can_access_tenant`, `INSERT`/`UPDATE`/`DELETE` via the narrower
  `is_active_tenant_member` (DECISIONS.md R-47); `GRANT`/`REVOKE`
  statements matching the policies (`anon` gets nothing); two new
  `SECURITY DEFINER` audit-trigger functions (`log_methodology_change()`,
  `log_methodology_relationship_change()`, DECISIONS.md R-46) reusing the
  existing `audit_log` table/attribution pattern, adapted to read
  `tenant_id` directly instead of joining through `organisations`.
- **Composite/triple-FK consistency**, the same discipline used since
  Milestone 2: `requirements(primary_regulatory_reference_id, tenant_id) →
  regulatory_references(id, tenant_id)`; `controls(control_library_version_id,
  tenant_id) → control_library_versions(id, tenant_id)`;
  `control_requirements`/`requirement_regulatory_references` each
  composite-FK against both sides of their mapping plus `tenant_id`;
  `engagements(control_library_version_id, tenant_id) →
  control_library_versions(id, tenant_id)`. Every FK proves tenant
  consistency by construction, no application-level check required.
- **Practice-owned versioning, not client SCD2** (DECISIONS.md R-42/R-43):
  a new `ControlLibraryVersion` gets its own new `Control` rows (same
  `code`, new `id`, new `control_library_version_id`) — no identity/version
  split, no carry-forward FK chain. `Requirement` is deliberately *not*
  scoped to a `ControlLibraryVersion`, so the same Requirement row is
  reachable from multiple library versions' mappings — this is what makes
  the historical-reproducibility scenario below meaningful rather than
  trivially true.
- **tests/control-library** (5 new files, 48 new tests, run against real
  PostgreSQL 16.13):
  - `crud.test.ts` (7 tests): RegulatoryReference/Requirement/Control
    CRUD, N:N Control↔Requirement mapping, duplicate-mapping prevention
    on both junctions, delete-not-update semantics for mappings.
  - `publishing-immutability.test.ts` (14 tests): every legal and illegal
    status transition (draft→published allowed + auto-stamps
    `published_at`; draft→retired blocked; published→draft blocked;
    published→retired allowed; retired→anything blocked); published
    content immutability on `ControlLibraryVersion` itself; `Control`
    INSERT/UPDATE/DELETE all blocked once its version is published;
    `control_library_version_id` immutability on `Control`; `ControlRequirement`
    INSERT/DELETE both blocked once published; confirmation that drafts
    remain freely editable/deletable throughout.
  - `historical-reproducibility.test.ts` (10 tests): the exact ABC
    Financial Services scenario — Library v1.0 (R1, C1, C2) published and
    pinned to an ABC Financial engagement; Library v2.0 (R1, C1, C2, C3,
    with C2's v2.0 mapping to R1 deliberately dropped and C3 added)
    published afterward. Six questions answered directly against the
    database: what's in v1.0; what's in v2.0 (and that its "C1"/"C2" are
    genuinely different rows from v1.0's); what v1.0's C1 maps to; how
    v2.0's mapping differs; which version the ABC Financial engagement is
    pinned to; and that v1.0's C1/C2/mappings/version row are byte-for-byte
    unchanged after v2.0 exists — plus one end-to-end join resolving an
    engagement's full pinned methodology in one query. A second `describe`
    block covers `Engagement.control_library_version_id` pinning rules
    directly: draft pin rejected, published/retired pin accepted, pin
    immutable once set (even to another published version).
  - `tenant-isolation.test.ts` (12 tests): Tenant A/Tenant B read
    isolation across all 6 tables; unaffiliated-user and anonymous-request
    blocking; write protection (INSERT/UPDATE blocked cross-tenant, with
    0-rows-affected + unchanged-data confirmation, not just a thrown
    error); the read/write authorization split itself — an organisation/
    engagement-scoped Tenant A user (no `TenantMembership`) can read but
    cannot write, while a genuine `TenantMembership` holder can do both
    (proving the block is real access control, not a broken pipe).
  - `audit.test.ts` (5 tests): creation, publish/retire transitions (each
    an `UPDATE` audit row), draft modification, mapping insert/delete, and
    `auth.uid()` attribution — all read back from the real `audit_log`
    table.
  - Direct raw-SQL confirmation (outside the test framework, per
    instruction to inspect the database directly rather than infer from
    application-level tests): a `psql` session publishing a
    `ControlLibraryVersion` and then attempting a `Control` INSERT against
    it, confirmed rejected with the exact trigger error text.

### Testing performed (exact commands, run in this order)

1. `npm run typecheck` — clean, both before and after the security
   migration was hand-written.
2. `npm run db:generate` — generated migration 0006; collided with
   existing `0005_processing_activity_security.sql` (drizzle-kit's own
   numbering, same recurring issue as Milestones 2-3) — renamed to
   `0006_control_library.sql`, `meta/0005_snapshot.json` renamed to
   `meta/0006_snapshot.json`, `meta/_journal.json`'s `idx`/`tag` fixed;
   re-ran `db:generate`, confirmed "No schema changes, nothing to
   migrate."
3. `npx tsx scripts/reset-test-db.ts` (fresh database, all 8 migration
   files applied in order) — succeeded cleanly, no manual reordering
   needed this time (see "What was implemented").
4. `npx vitest run tests/rls tests/master-data tests/processing-activity`
   — all 75 pre-existing tests still passing against the post-Milestone-4
   schema (no regressions).
5. `npx vitest run tests/control-library` — all 48 new tests passing.
6. `npm run test:db` (fresh reset + full suite: `tests/rls` +
   `tests/master-data` + `tests/processing-activity` +
   `tests/control-library`) — **123/123 passing**. Run **twice** in full
   (fresh `reset-test-db` each time) to prove stability — 123/123 both
   times, identical results.
7. `npm run lint` — clean.
8. `npm run build` (`next build`) — compiles successfully, static pages
   generated, no type or lint errors.
9. Direct `psql` inspection of the resulting database (not inferred from
   source): `relrowsecurity`/`relforcerowsecurity` confirmed `t`/`t` on
   all 6 new tables; `pg_policies` confirmed all 21 new policies with the
   expected commands/roles; `information_schema.role_table_grants`
   confirmed `authenticated` has exactly the intended privileges per
   table and `anon`/`PUBLIC` have none; `pg_constraint` confirmed every
   FK and `UNIQUE` constraint described above; `information_schema.triggers`
   confirmed all 25 triggers (reparenting guards, the pin guard, the
   version-tampering guard, the two draft-mutable guards, and the audit
   triggers) present with the correct timing/events; a standalone `psql`
   transaction (outside vitest) reproduced the published-immutability
   rejection directly.

### Files changed

- New: `db/schema/regulatory-references.ts`, `db/schema/requirements.ts`,
  `db/schema/control-library.ts`, `db/schema/control-library-links.ts`,
  `drizzle/migrations/0006_control_library.sql`,
  `drizzle/migrations/0007_control_library_security.sql`,
  `drizzle/migrations/meta/0006_snapshot.json`,
  `tests/control-library/helpers.ts`,
  `tests/control-library/crud.test.ts`,
  `tests/control-library/publishing-immutability.test.ts`,
  `tests/control-library/historical-reproducibility.test.ts`,
  `tests/control-library/tenant-isolation.test.ts`,
  `tests/control-library/audit.test.ts`.
- Modified: `db/schema/enums.ts` (new Milestone 4 enum block),
  `db/schema/engagements.ts` (new column + FK, comment update),
  `db/schema/index.ts` (barrel exports), `package.json` (new
  `test:control-library` script, `test:db` extended),
  `drizzle/migrations/meta/_journal.json` (renumbering fix),
  `DATA_MODEL.md` (one additive implementation-clarification paragraph
  after §6), `DECISIONS.md` (R-40 through R-48), `PROGRESS.md` (this
  entry).
- Unchanged: `ARCHITECTURE.md`, `SECURITY.md`, `PRODUCT_SPEC.md`,
  `ROADMAP.md`, `README.md`, and every migration/schema file from
  Milestones 1-3 (`0000`-`0005`, and every `db/schema/*.ts` file this
  milestone didn't touch).

### Known limitations (documented, not silently built around)

- A `Control` carried forward into a new library version has no formal
  FK chain back to its predecessor beyond a shared `code` value —
  DECISIONS.md R-42's accepted trade-off; DATA_MODEL.md §6 gives `Control`
  no `carried_forward_from_id` column, unlike `ProcessingActivity`/
  `AIUseCase`.
- `Requirement`'s own descriptive fields are not frozen by any
  `ControlLibraryVersion`'s publish state — only the library's Control set
  and mappings are (DECISIONS.md R-43/R-44). This is a deliberate scope
  boundary, not an oversight.
- No transition-rule constraint beyond the three-state
  draft/published/retired lifecycle exists for `ControlLibraryVersion` —
  no approval workflow, no per-transition role requirement beyond
  `is_active_tenant_member` (DECISIONS.md R-45, matching the milestone's
  explicit "keep it simple" instruction).
- No UI of any kind was built (none was requested) — every table above
  was exercised exclusively through direct SQL/RLS-aware test clients.

### Recommended Milestone 5

The Assessment Engine (`Assessment`, `AssessmentControl`, `AssessmentResponse`,
`ControlTest`) is the explicit next layer named in DATA_MODEL.md §6, and is
the natural next milestone: it is the first entity that actually
*consumes* both an `Engagement` (via `engagement_id`) and a pinned
`ControlLibraryVersion` (via `engagement.control_library_version_id`,
wired up this milestone) together, and DATA_MODEL.md §12's "Engagement/
assessment-instance versioning" section already describes its
`previous_assessment_id` chain in the same terms as this milestone's
methodology-versioning discussion — the two sections were clearly written
to be built in this order.

### Git status / remote synchronization status

All Milestone 4 work is committed on `claude/primus-privacy-architecture-39p3gh`
and pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

## Milestone 3 — Processing Activity & Version-Pinned Junction Layer (Session 6, 2026-09-01)

**Scope:** exactly what MILESTONE 3 instructed — the `ProcessingActivity`
table (engagement-scoped, tenant-isolated, organisation-consistent,
historically preservable, auditable), its carry-forward mechanism, and
the six version-pinned junctions connecting it to Milestone 2's master
data (Data Principal Category, Personal Data Element, Purpose, System,
Data Store, Processor — Business Unit is referenced directly, per
DATA_MODEL.md §5.3's own carve-out, not via a junction). No Controls,
Assessments, Evidence workflows, Risk, Findings, Remediation, DPIA, AI,
dashboards, or reports — none of those tables exist anywhere in this
schema. No ROPA/Data Inventory tables either — both remain, as instructed,
future queries over what's built here, not separate datasets. No product
UI beyond the unchanged Milestone-1 placeholder page.

Read `DATA_MODEL.md` §5.2-§5.5 and the actual Milestone 1-2 code
(`db/schema/engagements.ts`, the seven master-data schema files,
migrations 0000-0003) fresh from disk before writing anything, per
instruction — every mechanism below (denormalized scope columns,
composite-FK consistency, `can_access_*` RLS reuse, `SECURITY DEFINER`
audit triggers) is a direct, explicit extension of what Milestones 1-2
already established, not a new one invented from scratch.

### What was implemented

- **Drizzle TS schema** (`db/schema/processing-activities.ts`,
  `db/schema/processing-activity-links.ts`, 2 new files): `processingActivities`
  (14 columns: `engagement_id`, denormalized `organisation_id`/`tenant_id`,
  `name`, `description`, `business_unit_id`, `owner_user_id`,
  `lifecycle_status`, `lawful_basis`, `carried_forward_from_id`, audit
  columns) and six junction tables — `processingActivityDataPrincipalCategories`,
  `processingActivityPersonalDataElements`, `processingActivityPurposes`,
  `processingActivitySystems`, `processingActivityDataStores`,
  `processingActivityProcessors` — 7 tables total, exactly matching
  DATA_MODEL.md §5.2-§5.3's field list (Milestone 3 instructions §2's
  explicit warning against inventing speculative fields was followed —
  no fields beyond what DATA_MODEL.md and the milestone instructions
  themselves named).
- **Extended six existing Milestone 1-2 schema files** (`engagements.ts`
  and the six version-table files) with new `UNIQUE` constraints —
  additive only, no column or behavioral change — needed so the new
  junction tables' composite FKs can prove full consistency in one shot
  (DECISIONS.md R-34).
- **Migration 0004** (`drizzle-kit` generated from the TS schema, then
  hand-reordered — see "Known limitations"/DECISIONS.md R-39): all 7
  new tables, 2 new enums (`processing_activity_lifecycle_status`,
  `processing_activity_processor_role`), the composite FK
  `processing_activities(engagement_id, organisation_id, tenant_id) →
  engagements(id, organisation_id, tenant_id)` that makes
  "ProcessingActivity.{tenant_id,organisation_id} != Engagement's" a
  database-enforced impossibility, a self-referential composite FK for
  `carried_forward_from_id` (same organisation only), and — for every
  junction — a *triple* composite FK `(x_version_id, x_id,
  organisation_id) → x_versions(id, x_id, organisation_id)` proving the
  pinned version belongs to both the right master entity and the right
  organisation in one constraint.
- **Migration 0005** (hand-written, per DECISIONS.md R-02): audit-column
  FKs; a reparenting guard blocking `{engagement_id,organisation_id,
  tenant_id}` changes on `processing_activities` (not `business_unit_id`,
  which is an ordinary, legitimately-mutable business field —
  DECISIONS.md); RLS enabled with `FORCE` on all 7 tables and 21
  policies, every one reusing Milestone 1's `can_access_engagement(uuid,
  uuid)` unchanged (instruction §8: no second authorization framework);
  `GRANT`/`REVOKE` statements — junction tables get `SELECT, INSERT,
  DELETE` but no `UPDATE` for `authenticated` (relationship changes are
  delete-then-insert, never edited in place — DECISIONS.md R-35); the
  existing `log_master_data_change()` reused unchanged for
  `processing_activities`, plus one new `DELETE`-aware audit function
  (`log_processing_activity_relationship_change()`, DECISIONS.md R-38)
  for the six junctions.

### Migration names

- `0004_processing_activity.sql`
- `0005_processing_activity_security.sql`

(Milestones 1-2's `0000`-`0003` were **not modified** — instruction §15.
`drizzle/migrations/meta/_journal.json` and the matching snapshot were
renumbered from `0003`/idx 3 to `0004`/idx 4 immediately after
generation, resolving a filename collision with Milestone 2's
hand-written `0003` file, the same procedure used for the equivalent
Milestone 2 collision — `npx drizzle-kit generate` was re-run afterward
and reported "No schema changes, nothing to migrate.")

### Relationship summary

`Engagement` 1→N `ProcessingActivity` (`engagement_id` FK, composite-FK
guaranteed consistent with the engagement's own organisation/tenant).
`ProcessingActivity` 0..1→(self, across engagements) via
`carried_forward_from_id` (same organisation only). `ProcessingActivity`
N←→N each of the six master-data entities via its dedicated junction
table, each junction storing **both** the master identity id and the
specific pinned version id (DATA_MODEL.md §5.3). `ProcessingActivity.
business_unit_id` is a direct (non-version-pinned) reference to
`business_units.id`, matching DATA_MODEL.md §5.3's explicit Business
Unit carve-out. `ProcessingActivityProcessor` additionally carries a
`role` (`processor`/`joint_controller`); `ProcessingActivityPersonalDataElement`
additionally carries a per-link `sensitivity_note`. No polymorphic
foreign keys anywhere in this milestone (instruction §6) — every
relationship is an explicit, typed junction table.

### Tenant/Organisation/Engagement consistency enforcement

Database-enforced, not application-only (instruction §7):
`processing_activities`'s composite FK to `engagements(id,
organisation_id, tenant_id)` makes an inconsistent triple impossible to
insert, and the `processing_activities_prevent_reparenting` trigger
makes it impossible to *create* consistently and *then* silently drift —
verified directly (a superuser bypassing RLS entirely still cannot
insert a mismatched triple, and still cannot UPDATE
`engagement_id`/`organisation_id`/`tenant_id` on an existing row).

### RLS policy summary

21 policies (3 each across all 7 tables: `processing_activities` gets
SELECT/INSERT/UPDATE, the six junctions get SELECT/INSERT/DELETE — no
table has all four, matching each table's actual mutation model).
Every policy evaluates `public.can_access_engagement(engagement_id,
organisation_id)` — Milestone 1's function, called with the two columns
every Milestone-3 row carries directly, unchanged and unmodified
(instruction §8). `anon` has zero grants on any of the 7 tables
(verified directly, count = 0). Write protection verified directly, not
just SELECT: a Tenant B user's `INSERT`/`UPDATE` against Tenant A's
Processing Activity is rejected (RLS violation, or 0 rows affected since
the row isn't visible to them at all), and a direct `UPDATE` against a
junction table fails with "permission denied" before RLS is even
evaluated (no grant exists at all).

### Audit implementation

`processing_activities` reuses Milestone 2's `log_master_data_change()`
trigger (`AFTER INSERT OR UPDATE`) unchanged — creation, ordinary
modification, status change, and retirement (a status `UPDATE` to
`'retired'`) are all captured as ordinary audit entries; carry-forward is
captured on the new row's own creation entry (`field_changes` includes
`carried_forward_from_id`). The six junction tables get a new function,
`log_processing_activity_relationship_change()` (`AFTER INSERT OR
DELETE`), since `log_master_data_change()` reads `NEW`, which is null on
`DELETE` — "relationship changes" (instruction §9) are captured as an
`insert` entry when a link is created and a `delete` entry (with the
removed link's own data in `field_changes`) when one is removed. Both
functions remain `SECURITY DEFINER`, so audit entries are written
regardless of the calling role's own grants on `audit_log`, and every
entry is correctly attributed via `auth.uid()` — verified directly by a
`psql` walk-through before the automated suite and again by
`tests/processing-activity/audit.test.ts` afterward.

### Historical-state test result (instruction §5, items 1-8 — the required scenario)

Directly verified by `tests/processing-activity/carry-forward-scenario.test.ts`
against the exact ABC Financial Services PA-014 scenario from the
milestone instructions — **all 8 required demonstrations hold**:

1. **PA-014-E1 remains unchanged** after all FY2027 work — its name,
   engagement, and (unset) `carried_forward_from_id` are exactly as
   created.
2. **PA-014-E2 exists as a separate, distinct engagement-scoped record**
   — a different id, under `engagement2027`, not a mutated copy of
   PA-014-E1.
3. **PA-014-E2 correctly records `carried_forward_from_id = PA-014-E1`.**
4. **FY2026 resolves to the original master-data versions** — System
   owner `Digital Banking`/hosting `India`, Processor `XYZ Analytics`
   DPA `v1`.
5. **FY2027 resolves to the new master-data versions** — System owner
   `Technology`/hosting `Singapore`, Processor `ABC Analytics` DPA `v1`
   — and XYZ is confirmed no longer linked to PA-014-E2 at all (a
   genuine replacement, not a version bump on XYZ, per DATA_MODEL.md
   §5.5).
6. **Updating FY2027's relationships does not alter FY2026's** — a
   further Purpose-link change on PA-014-E2 (delete + re-insert with a
   new Purpose version) leaves PA-014-E1's own Purpose link completely
   untouched.
7. **A current-state query resolves the latest applicable master
   versions**, entirely independent of any engagement (`systems JOIN
   system_versions WHERE is_current`).
8. **A historical query reconstructs the FY2026 state exactly** — a
   single query joining PA-014-E1 through all three of its junctions
   returns System/Data Store/Processor values matching FY2026 precisely,
   plus the three Personal Data Element links (Name, PAN, Mobile)
   captured at the time.

### Carry-forward test result

Covered by the same test file (items 2-3, 5-6 above) plus
`tests/processing-activity/audit.test.ts`'s dedicated carry-forward audit
case: the new engagement-scoped row, its `carried_forward_from_id`
pointer, the re-resolution of System/Data Store to their now-current
versions, and the wholesale Processor replacement (not a version bump)
all verified directly against real data, not asserted from source
reading.

### Cross-tenant test result

`tests/processing-activity/tenant-org-isolation.test.ts` — a Tenant A
user can read their own tenant's Processing Activity; cannot read Tenant
B's (neither by direct id lookup nor via an unfiltered listing);
Organisation A1's member cannot read Organisation A2's Processing
Activity even under the same tenant; an engagement-scoped user's access
is exactly their `EngagementMembership`, no broader; an unaffiliated user
and a fully anonymous request are both blocked (the latter at the grant
level). Write protection verified separately (INSERT/UPDATE), not only
SELECT.

### Cross-organisation test result

`tests/processing-activity/version-consistency.test.ts` — a Processing
Activity cannot reference a master-data version belonging to another
organisation, verified against the **real, shipped** junction tables now
(not the Milestone 2 scratch-table stand-in, which this milestone
supersedes for this specific property): tested for both a superuser
bypassing RLS entirely and an authenticated user whose RLS `WITH CHECK`
would otherwise have allowed the write, proving the composite FK is
doing real, independent work. The same guarantee is separately confirmed
to hold across tenants (not merely across sibling organisations under one
tenant), and `ProcessingActivity` creation itself is confirmed to reject
an inconsistent `(engagement, organisation, tenant)` triple the same way.

### Full test count and exact results

All of the following were run against a real local PostgreSQL 16.13
database, reset from scratch before each full run — not type-only checks,
not mocked:

1. `npx tsc --noEmit` — **passed, zero errors**.
2. `npm run lint` (`eslint .`) — **passed, zero errors/warnings**.
3. `npx drizzle-kit generate` — succeeded (twice: once to produce
   `0004_processing_activity.sql`, once afterward, after the statement
   reordering and journal renumbering, to confirm "No schema changes,
   nothing to migrate").
4. `npx tsx scripts/apply-migrations.ts` — all 6 migration files applied
   successfully via `scripts/reset-test-db.ts` (fresh database each run)
   — only after fixing the statement-ordering issue in migration 0004
   (DECISIONS.md R-39); the first attempt failed cleanly with a clear
   Postgres error ("no unique constraint matching given keys"), was
   diagnosed, and was fixed before any test was written against it.
5. `npx next build` — **succeeded** (2 static routes — unchanged from
   Milestone 1/2, confirming no UI was added).
6. `npm run test:db` (`tsx scripts/reset-test-db.ts && vitest run
   tests/rls tests/master-data tests/processing-activity`) — **75/75
   tests passed**, run twice consecutively against a freshly reset
   database each time:

   ```
   ✓ tests/processing-activity/carry-forward-scenario.test.ts   (8 tests)
   ✓ tests/master-data/version-tenant-consistency.test.ts        (6 tests)
   ✓ tests/master-data/system-versioning.test.ts                 (7 tests)
   ✓ tests/processing-activity/audit.test.ts                     (6 tests)
   ✓ tests/processing-activity/tenant-org-isolation.test.ts     (10 tests)
   ✓ tests/master-data/entity-coverage.test.ts                   (6 tests)
   ✓ tests/processing-activity/version-consistency.test.ts       (5 tests)
   ✓ tests/rls/membership-boundaries.test.ts                     (7 tests)
   ✓ tests/master-data/tenant-org-isolation.test.ts               (6 tests)
   ✓ tests/rls/tenancy-consistency.test.ts                        (6 tests)
   ✓ tests/rls/tenant-isolation.test.ts                           (5 tests)
   ✓ tests/rls/engagement-access.test.ts                          (3 tests)
   Test Files  12 passed (12)
        Tests  75 passed (75)
   ```

   25 of these 75 are new this milestone (`tests/processing-activity/*`,
   4 files); the other 50 (`tests/rls`, `tests/master-data`) are
   Milestones 1-2's own suites, unmodified and still passing —
   confirming Milestone 3 didn't regress anything earlier.

   Unlike Milestones 1-2, **no test-writing bug was found this time** —
   the full suite passed on its first run. The one real defect this
   milestone surfaced (migration 0004's statement ordering, R-39) was
   caught at the *migration-application* step, before any test was
   written, by directly reviewing and applying the generated SQL against
   real Postgres first (per this project's now-established discipline of
   smoke-testing each mechanism by hand before writing the automated
   suite against it).

7. **Manual security inspection**, run directly against the test database
   (not inferred from source alone), per instruction §17:
   - `pg_class.relrowsecurity`/`relforcerowsecurity` — RLS enabled and
     `FORCE`d on all 7 new tables.
   - `pg_policies` — exactly 21 policies, matching the design (3 × 7).
   - `information_schema.role_table_grants` — `anon` has zero grants on
     any of the 7 tables; `authenticated` has exactly `SELECT, INSERT,
     DELETE` on `processing_activity_systems` (representative of all six
     junctions) — no `UPDATE`.
   - `pg_constraint` (`pg_get_constraintdef`) — all 6 FKs on
     `processing_activities` confirmed present with the exact expected
     definitions (engagement/org/tenant triple, business unit, carried-
     forward, owner, created/updated-by); the junction tables' triple
     composite FKs confirmed likewise.
   - `information_schema.triggers` — `processing_activities` has exactly
     3 triggers (reparenting guard + audit log's two events).
   - A direct `psql` attempt to `UPDATE processing_activity_systems ...
     WHERE false` as `authenticated` failed with "permission denied"
     before Postgres even evaluated the `WHERE` clause — confirming
     historical junction records cannot be rewritten at the privilege
     level, not merely discouraged by policy.

### Known limitations

1. **Same local-Postgres-plus-shim testing posture as Milestones 1-2**
   (DECISIONS.md R-24) — D-03 (data residency) is still open.
2. **No transition-rule enforcement on `lifecycle_status`** — any status
   may move to any other (DECISIONS.md R-32). DATA_MODEL.md doesn't
   specify transition rules, and the milestone instructions say to
   document rather than silently build workflow logic for them.
3. **`DataFlow` and `ProcessingActivityNotice` remain unbuilt**
   (DECISIONS.md R-36) — `Notice` doesn't exist yet, and `DataFlow` was
   not named in this milestone's scope.
4. **No engagement-closed-freezes-everything-downstream trigger** — a
   closed `Engagement`'s Processing Activities and junctions are not
   automatically locked against further writes by a database trigger;
   today that's an RLS/application-layer concern (a closed engagement's
   members would need to still hold access to write to it, which is a
   separate, not-yet-built permission question). Not required by this
   milestone's instructions; worth flagging for the Assessment Engine
   milestone, where "finalized means immutable" first becomes load-bearing
   (DATA_MODEL.md §6).
5. **Audit entries remain full-row JSON**, not field-level diffs — same
   limitation noted in Milestone 2's report, now also true of
   `processing_activities` and its junctions.
6. **No migration-history tracking table still** — six files deep now,
   still applied unconditionally in filename order by
   `scripts/apply-migrations.ts`.

### Next milestone

Per the STOP CONDITION: this milestone is complete and the session stops
here, before Controls/Assessment/Evidence/Risk/Findings/Remediation/UI.
Recommended next milestone (not started, pending review/approval):
**Milestone 4 — Regulatory Content & Control Library**, covering
DATA_MODEL.md §6's `RegulatoryReference`, `Requirement`,
`ControlLibraryVersion`, `Control`, and `ControlRequirement` — the
practice-owned, versioned methodology layer that `Engagement.
control_library_version_id` (deferred since Milestone 1, DECISIONS.md
R-23) was always going to need, and the prerequisite for the Assessment
Engine (`Assessment`, `AssessmentResponse`, `ControlTest`) after that.
This is a deliberate choice to build the methodology/regulatory layer
*before* Assessment, since Assessment references Control, not the other
way around.

## Milestone 2 — Client Master Data (Session 5, 2026-09-01)

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
