# PRIMUS PRIVACY — Progress Log

Status: 2026-09-02 — Slice P2A.1 (Close Remediation Self-Validation Gap)
COMPLETE (Session 34): a tightly-scoped follow-up security patch closing
the one remaining P0/P1 gap P2A's own final report flagged —
`RemediationAction.status = "validated"` was directly settable through
the ordinary `updateRemediationAction`, a second, narrower self-
validation surface distinct from `createValidationRecord` (already
closed by P2A). Confirmed, by direct inspection of
`validation-records.ts`'s own header and DATA_MODEL.md §8's five-value
lifecycle, that "validated" genuinely is the same consultant-validation
decision `ValidationRecord` creation makes explicit — not a conflict to
report, a real gap to close. Fixed with the smallest possible change:
`updateRemediationAction` now requires the same `validation.perform`
permission `createValidationRecord` already requires, but ONLY when the
submitted `status` is `"validated"` — no new permission, no new role, no
new lifecycle state, every other status value and every other field
(progress notes, due date, ownership, and `"closed"`) completely
unaffected. One new, minimal, hand-written migration (0032) adds the
matching RLS `WITH CHECK` condition to `remediation_actions_insert`/
`_update`, layered onto the existing broad `can_access_engagement`
check rather than replacing it. 6 new focused tests (extending
`tests/app/authorization-hardening.test.ts` to 32), covering all 8
required P2A.1 scenarios. 854 tests pass (67 files, same file count as
P2A — no new test file), typecheck/lint/build all clean, full DB suite
run twice with zero regressions. DECISIONS.md R-154 records the fix and
formally supersedes R-151's "left untouched" call for this one status
value. Per explicit instruction, STOP after P2A.1 — no P2B. Full details
in the "Close Remediation Self-Validation Gap" section below.

Status: 2026-09-02 — Slice P2A (Authorization & Confidentiality
Hardening) COMPLETE (Session 33): implementation-only hardening slice
closing four gaps a design-only discovery pass (P2 —
`P2_FIRST_CUSTOMER_WORKFLOW_DISCOVERY.md`, no code) had identified: (1)
Risk/Finding/ValidationRecord writes, and Evidence review, were gated
only by the broad `requireEngagementAccess` check, satisfied identically
by any `EngagementMembership`/`OrganisationMembership` holder including
every client-side role — most seriously, letting a client validate
(self-approve) its own remediation; (2) `evidence.visibility`
(`consultant_internal`/`client_visible`) has existed in the schema since
Milestone 6 but was never read by any query. Fixed with four new,
dedicated permissions (`validation.perform`, `risk.manage`,
`finding.manage`, `evidence.review`), granted only to Engagement Manager
and Consultant — the repository's own established dedicated-permission
pattern (D3's `scope.lock`, M2's `maturity.compute`), never a new Client
role or authorization framework. Evidence visibility is now auto-
computed at upload time from the uploader's own `evidence.review`
permission and enforced server-side on every read path, most critically
`getEvidenceDownloadUrl` (the only path returning retrievable file
bytes), gated BEFORE any signed URL is issued — a client cannot bypass
it by supplying a different, cross-tenant, or cross-engagement evidence
id. One new, minimal migration (0031) narrows exactly six RLS policies
(`risks_insert`/`_update`, `findings_insert`/`_update`,
`validation_records_insert`, `evidence_update`) to the matching
permissions — no SELECT policy touched, `evidence_select` included (see
DECISIONS.md R-153), and `remediation_actions`/`validation_records_
update` deliberately left alone (R-151) per the brief's own "do not
over-restrict client participation" / "do not invent additional
lifecycle states" instructions. Four existing Assessment/Risk/Finding/
Remediation workspace pages gained minimal, server-independently-
re-decided UI gating (hide, never merely disable, a now-forbidden
action) — no new UI, no new routes. 26 new focused tests
(`tests/app/authorization-hardening.test.ts`) plus three pre-existing
RLS positive-control tests updated to use a properly-permissioned actor
now that the policies they exercise are intentionally narrower (a plain
organisation-wide "Client Administrator" test fixture that previously
stood in for "any authorized user" genuinely no longer qualifies —
that is the fix, not a regression). 848 tests pass (67 files),
typecheck/lint/build all clean, every check run twice for stability,
zero unrelated regressions. Full details in the "Authorization &
Confidentiality Hardening" section below. Per explicit instruction, STOP
after P2A — no client invitation, Client Portal, Supabase Storage, DPDP
content, comments, notifications, or P2B without further explicit
direction.

Status: 2026-09-02 — Slice M2 (Maturity Implementation) COMPLETE
(Session 32): the calculation engine and application layer for
Maturity, closing the #1 gap D3's own closing review re-ranked to top
priority. Preceded by two design-only passes (M1, M1.1 — no code) that
inspected the pre-existing Milestone 8/8A persistence layer (already
fully built and tested — `MaturityScoringMethodology`, `MaturityDomain`,
`MaturityDomainWeight`, `MaturityDomainControlMapping`,
`MaturityAssessment`, `MaturityScore`), proposed a domain-weighted-mean
methodology, then corrected two parts of that proposal after deeper
inspection: (1) "delete draft and recompute" is not supported by the
schema's own grants, so the MVP operation is one atomic
compute-then-finalize action instead; (2) an unanswered eligible control
must make its domain `incomplete` and abort the WHOLE computation
(including the overall score), never silently excluded from the
denominator — the exact anti-gaming rule the M2 brief itself then
approved and required. A consultant with the new, DEDICATED
`maturity.compute` permission (Engagement Manager only, never a reuse of
`assessment.finalize`/`scope.lock`) can now, entirely from the running
application, on a finalized Assessment's own page: compute maturity
once (immutable from that point on — no recompute, no delete), see the
overall score/level and every domain's score/level, or see exactly why
computation was refused (which domain, how many eligible/answered/
unanswered controls). D3's own `applicability_decision` snapshot is the
sole eligibility source (`not_applicable` excluded, `applicable`/
`undecided` both eligible) — the live `EngagementScope` is never
re-read. `AssessmentResponse.effectiveness_rating`, mapped through the
pinned `MaturityScoringMethodology.definition.rating_scores`, is the
sole numeric input — ControlTest/Evidence/Risk/Finding/Remediation/
Validation are traceability/reporting-only, verified directly by
attaching all of them to a scored control and proving the score is
unaffected (reaffirms DECISIONS.md R-79/R-80, PRODUCT_SPEC.md Principle
8). Two small migrations only: a `UNIQUE(assessment_id)` constraint (one
`MaturityAssessment` per Assessment, sufficient because the atomic
compute-then-finalize action can never leave a durable partial row) and
narrowing the `maturity_assessments`/`maturity_scores` RLS write path
from the previously broad `can_access_engagement` to `maturity.compute`
— no other schema change; the entire persistence layer already existed.
R1's Engagement Report gained one minimal section (overall/domain
scores and levels, or an honest "not calculated" explanation) — no
analytics, no trend/comparison content. The reference-engagement
fixture now demonstrates a real, persisted maturity result (a second,
completed FY2025-26 Assessment period, reusing the same real, locked D3
Scope) alongside proof that the original, deliberately in-progress
FY2026-27 Assessment still cannot itself produce one — the Gap Matrix
(`REFERENCE_ENGAGEMENT.md`) Maturity row now reads YES/YES/YES/None.
844 tests pass (66 files, +22 new in `tests/app/maturity.test.ts`),
typecheck/lint/build all clean, every check run twice for stability,
zero regressions against the Slice D3 baseline of 65/822 (delta: +1
file, +22 tests, exactly the new suite, plus the pre-existing STAGE 14
reference-engagement test flipping from expected-MISSING to
expected-YES). Full details in the "Maturity Implementation" section
below and in `REFERENCE_ENGAGEMENT.md`. Per explicit instruction, STOP
after M2 — no Client Portal, trends, dashboards, comparison, AI, or any
other feature without further explicit direction.

## Close Remediation Self-Validation Gap (Session 34, 2026-09-02)

**Scope:** exactly what the P2A.1 brief instructed — a tightly-scoped
security hardening patch, not a Remediation lifecycle redesign. No new
lifecycle state, no new role, no Client Portal, no invitation/
provisioning, no Evidence/Maturity/Assessment change, no comments/
notifications.

**The gap:** P2A's own final report named it directly: `createValidation
Record` was correctly restricted to `validation.perform` (Engagement
Manager/Consultant only), but `RemediationAction.status = "validated"`
remained directly settable by ANY engagement/organisation member —
client-side roles included — through the ordinary, unrestricted
`updateRemediationAction`. DECISIONS.md R-151 had, at the time, named
this as a deliberate, accepted, out-of-scope limitation rather than
close it, per P2A's own "do not over-restrict client participation" /
"do not invent additional lifecycle states" instructions.

**Required first step — determine what "validated" actually means:**
inspected `db/schema/remediation-actions.ts` (status enum, DATA_MODEL.md
§8's own five-value lifecycle "Open → In Progress → Evidence Submitted →
Validated → Closed"), `db/schema/validation-records.ts` (`ValidationRecord`
— "the explicit consultant-validation step between 'evidence submitted'
and 'control reassessment'", its own header, verbatim), and DECISIONS.md
R-71 (status is a plain, application-layer-only state machine — no
database-enforced transition order, by design). Conclusion: "validated"
IS the same consultant-validation decision `ValidationRecord` creation
makes explicit — the P2A.1 brief's own "if the existing schema semantics
reveal that 'validated' is NOT actually intended to mean consultant
validation, STOP" condition does not apply; closing the gap is correct.

**The fix, smallest defensible:** `updateRemediationAction`
(`lib/domain/remediation.ts`) now calls the existing
`requireValidationPerformAccess` (the same function/permission
`createValidationRecord` already uses) whenever, and only whenever,
`input.status === "validated"`. No change to the function's existing
`requireEngagementAccess` call, no change to any other field, no change
to any other status value — a client retains complete, unrestricted
remediation participation: progress notes, description, due date,
ownership, and every status transition except this one, `"closed"`
included (per the brief's own "preserve all other legitimate client
remediation participation").

**RLS backstop:** migration 0032 (hand-written, smallest possible) adds
one additional `WITH CHECK` condition to `remediation_actions_insert`/
`_update` — `status <> 'validated' OR has_engagement_permission(...,
'validation.perform') OR has_organisation_permission(..., 'validation.
perform')` — layered onto (ANDed with) the existing, unchanged, broad
`can_access_engagement` check, not replacing it. `USING` (read-for-
update visibility) is untouched. Proven directly that a client cannot
bypass the application-layer block via direct SQL: both a forged UPDATE
setting an existing row's status to `'validated'` and a forged INSERT of
a brand-new row already carrying `status = 'validated'` are rejected by
RLS, while an ordinary direct-SQL write that doesn't touch `status`
(or sets it to anything else) still succeeds for a client.

**No new permission, no new role, no new lifecycle state:** reuses
`validation.perform`, seeded to Engagement Manager and Consultant only
since P2A (`db/seed/roles.ts`, unchanged this slice).

**Testing:** 6 new focused tests appended to the existing
`tests/app/authorization-hardening.test.ts` (26 → 32 tests total),
covering all 8 required P2A.1 scenarios: (1) a client can still perform
ordinary, non-"validated" remediation updates including "closed"; (2) a
client (both a Client Administrator and an Other-Client-Member persona)
cannot set `status = "validated"`, with the row's actual status
reconfirmed unchanged after each rejected attempt; (3) a client cannot
bypass via direct SQL/RLS — neither an UPDATE nor an INSERT forging
`status = 'validated'` succeeds, while an ordinary direct-SQL write that
doesn't touch `status` still does; (4) an Engagement Manager and a
Consultant can both perform the transition, with `completed_at`
confirmed stamped; (5)/(6) `createValidationRecord` and the full
validation workflow are completely unaffected by the new gate — still
works normally, and a client still cannot self-validate via that path
either; (7) tenant isolation remains intact — a different-tenant
consultant cannot validate this tenant's RemediationAction; (8) the
existing, unmodified `tests/app/remediation.test.ts` suite (which
already exercises a Consultant setting `status = "validated"`, per its
own pre-existing test) continues to pass unchanged — no test file
needed modification for this slice, only `lib/domain/remediation.ts`.
854 tests pass (67 files — same file count as P2A, no new test file,
+6 tests in the existing authorization-hardening suite),
typecheck/lint/build all clean, full DB suite run twice for stability,
zero regressions.

**Documentation:** DECISIONS.md R-154 records the fix and its full
reasoning, and formally supersedes R-151's "left untouched" call for
`RemediationAction.status = "validated"` specifically (R-151's other two
decisions — `validation_records_update` and general `remediation_
actions` writes remaining broad — are unaffected and still stand).
`REFERENCE_ENGAGEMENT.md` was not touched — its fixture's `leadUserId`
(Engagement Manager) and `secondUserId` (Consultant) both already hold
`validation.perform`, so its own remediation-status-setting calls are
unaffected by this narrower gate.

**Not built, deliberately, per the brief's own STOP condition:** no
Remediation lifecycle redesign, no new lifecycle state, no Client
Portal, no invitation/provisioning, no Evidence/Maturity/Assessment
change, no comments/notifications, no P2B.

## Authorization & Confidentiality Hardening (Session 33, 2026-09-02)

**Scope:** exactly what the P2A implementation brief instructed — on
top of a design-only discovery pass (P2 —
`P2_FIRST_CUSTOMER_WORKFLOW_DISCOVERY.md`, no code) that traced the
full first-customer workflow and flagged four authorization/
confidentiality gaps for a follow-up hardening slice. Explicitly NOT
built, per instruction: client invitation, client account provisioning,
Client Portal, dashboard, comments, notifications, production Supabase,
Storage migration, DPDP content, any new workflow feature, AI, or a new
role architecture.

**Gap 1 — Risk/Finding/Validation writes were authorized too broadly.**
`createRisk`/`updateRiskStatus`, `createFinding`/`updateFinding`, and
`createValidationRecord` were each gated only by the broad
`requireEngagementAccess` check — satisfied identically by ANY active
`EngagementMembership`/`OrganisationMembership` holder, client-side
roles included. Most seriously, this meant a client could call
`createValidationRecord` against its own `RemediationAction` and
self-approve its own remediation. Fixed with four new, dedicated
permissions — `validation.perform`, `risk.manage`, `finding.manage`,
`evidence.review` — added to `db/seed/roles.ts`'s `PERMISSIONS` array
and granted only to Engagement Manager and Consultant (a brand-new
`ROLE_PERMISSIONS` entry — Consultant previously had zero seeded
permissions at all). No client-side role holds any of the four. See
DECISIONS.md R-150.

**Gap 2 — Finding/Risk consultant/client boundary.** Resolved as part
of Gap 1: PRODUCT_UX_BLUEPRINT.md §8's own pre-existing, already-
approved Permission Matrix gives every client-side role CV(-only)/no-
write for Risk/Finding/Validation, and Reviewer (Auditor) read-only —
`risk.manage`/`finding.manage`/`validation.perform` granted exactly per
that matrix, not a new boundary invented for this slice.

**Gap 3 — Evidence visibility existed in the schema but was never
enforced.** `evidence.visibility` (`consultant_internal`/
`client_visible`) has existed since Milestone 6 but no query anywhere
read it before this slice. Fixed in two parts: (1) `uploadEvidence`/
`createEvidenceForVersion` now auto-compute `visibility` from the
uploader's own `evidence.review` permission at insert time — never a
caller-supplied value; (2) every read path that can return
`consultant_internal` Evidence (`getEvidenceSummaryForControl`/
`ForRemediationAction`/`ForValidationRecord`/`ForValidationRecords`) now
takes an explicit `canSeeInternal: boolean` and excludes those rows
entirely, server-side, when the caller lacks it. `getEvidenceDownloadUrl`
independently re-checks the same permission against the specific
requested `evidenceId`, BEFORE calling `storage.createSignedUrl` —
proven directly (`tests/app/authorization-hardening.test.ts`) that a
client cannot retrieve consultant-internal evidence via its own correct
ID, a cross-tenant ID, or a cross-engagement ID. See DECISIONS.md R-152.

**Gap 4 — Evidence review authorship.** `reviewEvidence` (accept/
reject) is now gated by the same `evidence.review` permission — a
client can no longer review/accept-or-reject its own or anyone else's
uploaded evidence, while consultant/Engagement Manager review still
works unchanged.

**Deliberately NOT touched, and why (see DECISIONS.md R-151):**
`lib/domain/remediation.ts` — no permission check added anywhere in it;
a client retains full ability to provide remediation progress/
completion input and submit evidence directly against a
`RemediationAction`, per the brief's own explicit "do not over-restrict
client participation." `RemediationAction.status = "validated"`
(settable via the ordinary, unchanged `updateRemediationAction`) and
`validation_records_update` RLS remain untouched — a second, narrower,
theoretical self-validation surface distinct from the one this slice
closes (`ValidationRecord` creation) — left as a documented, accepted P1
limitation rather than inventing a new lifecycle state or restricting
client remediation writes generally, both explicitly out of scope.
`evidence_select` (and every other SELECT RLS policy) is also
deliberately untouched — see DECISIONS.md R-153 for the full three-part
reasoning (pre-existing SECURITY.md documentation, regression risk,
and the fact that the truly sensitive action — file-byte retrieval — is
already fully gated server-side).

**Migration 0031 (hand-written, smallest possible):** narrows exactly
six RLS policies — `risks_insert`/`_update`, `findings_insert`/`_update`,
`validation_records_insert`, `evidence_update` — from the broad
`can_access_engagement` to `has_engagement_permission(...) OR
has_organisation_permission(...)` against the matching new permission,
mirroring migration 0030's own `maturity.compute` narrowing exactly. No
new table, no new column, no membership-architecture change.

**UI gating (existing pages only, no new UI/routes):** the Assessment
workspace, Finding detail, Risk detail, and Remediation Action detail
pages each now compute the relevant `can*` result server-side (mirroring
the existing `canFinalize`/`canComputeMaturityResult` pattern) and hide
— never merely disable — a now-forbidden action: the evidence Accept/
Reject buttons and "Create Risk" form (Assessment workspace), "Edit
finding" (Finding detail, replaced with a read-only summary when
absent), "Save status" and "Create finding" (Risk detail), "Record a new
validation" (Remediation Action detail). Every domain function still
independently re-checks the same permission regardless of what the page
decided to render — the hiding is a UX courtesy, the check is the real
boundary.

**Security matrix (the 13 P2A Part 9 actions, current behavior):**

| Action | Engagement Manager | Consultant | Client Administrator | Other Client Member | Unauthorized |
|---|---|---|---|---|---|
| View client-visible evidence | Yes | Yes | Yes | Yes | No |
| View consultant-internal evidence | Yes | Yes | No | No | No |
| Upload evidence | Yes (→ consultant_internal) | Yes (→ consultant_internal) | Yes (→ client_visible) | Yes (→ client_visible) | No |
| Review (accept/reject) evidence | Yes | Yes | No | No | No |
| Create Risk | Yes | Yes | No | No | No |
| Edit Risk (status) | Yes | Yes | No | No | No |
| Create Finding | Yes | Yes | No | No | No |
| Edit Finding | Yes | Yes | No | No | No |
| Create Remediation | Yes* | Yes* | Yes* | Yes* | No |
| Edit Remediation (progress/status) | Yes* | Yes* | Yes* | Yes* | No |
| Validate Remediation | Yes | Yes | No | No | No |
| View Validation | Yes | Yes | Yes | Yes | No |
| Edit Validation | N/A — append-only, no UPDATE by any role | | | | |

*Remediation create/edit is deliberately unchanged by P2A (still the
broad, pre-existing `requireEngagementAccess`/`can_access_engagement`
check) — every engagement/organisation member, client-side roles
included, retains this access by design (R-151).

**Testing:** 26 new focused tests in
`tests/app/authorization-hardening.test.ts`, covering all 14 required
P2A Part 10 scenarios (self-validation blocked for both a Client
Administrator and an Other-Client-Member persona; unauthorized/
authorized Risk/Finding/Validation writes; consultant-internal evidence
invisible to a client via its own ID, a cross-tenant ID, and a
cross-engagement ID; client-visible evidence remains fully accessible;
RLS independently rejects a direct-SQL Risk insert from both a client
role and an outsider while still permitting one from a Consultant; a
same-tenant/different-engagement consultant cannot validate another
engagement's remediation; the full consultant workflow — risk → finding
→ remediation → evidence → review → validation — still completes end to
end). Three pre-existing RLS positive-control tests
(`tests/risk-remediation/tenant-isolation.test.ts`,
`tests/risk-remediation/audit.test.ts`,
`tests/evidence/tenant-isolation.test.ts`) were updated to perform their
"an authorized user CAN write" assertions as a Consultant instead of a
plain organisation-wide Client Administrator — that fixture genuinely no
longer qualifies as "authorized" under the new policies, which is
exactly the fix, not a regression. 848 tests pass (67 files),
typecheck/lint/build all clean, every check run twice for stability.

**Not built, deliberately, per the brief's own STOP condition:** client
invitation, client account provisioning, Client Portal, dashboard,
comments, notifications, production Supabase, Storage migration, DPDP
content, or P2B. `REFERENCE_ENGAGEMENT.md` was evaluated and found not
to need an update — both `leadUserId` (Engagement Manager) and
`secondUserId` (Consultant) in that fixture already hold every one of
the four new permissions, so its own Risk/Finding/Validation/Evidence
calls are unaffected.

## Maturity Implementation (Session 32, 2026-09-02)

**Scope:** exactly what the M2 implementation brief instructed — on top
of two design-only passes (M1, M1.1 — no code) that produced
`M1_MATURITY_DESIGN.md` and `M1.1_MATURITY_FORMULA_INTEGRITY.md`,
reviewed and approved (with the two corrections those documents
themselves surfaced) before any code was written. Explicitly NOT built,
per instruction: Client Portal, dashboards, trend/comparison analytics,
AI-generated commentary, custom/client-configurable formulas, control
weighting, risk-adjusted scoring, evidence-quality/confidence scoring,
a methodology-authoring UI, or an R1 redesign.

**Core finding, carried from M1/M1.1 and reconfirmed during
implementation:** the entire Maturity persistence layer (Milestone
8/8A) already existed, fully built and tested — no schema change was
needed for the calculation engine itself. What was missing was purely
the calculation engine and application layer: `lib/domain/maturity.ts`
did not exist before this slice.

**Lifecycle, the corrected design:** `computeAndFinalizeMaturityAssessment`
performs "insert `MaturityAssessment` as draft → insert every
`MaturityScore` → flip to finalized" inside ONE transaction, with every
validation/calculation completed in memory before the first write. No
separate `finalizeMaturityAssessment` action, no human-review draft
state, no delete/discard path — M1.1's own finding, reconfirmed:
`maturity_scores` has no UPDATE/DELETE grant at all, proven directly by
`tests/maturity/immutability.test.ts` rejecting a mutation even against
a still-draft score. Since the whole sequence is atomic, a failure
never leaves a partial row — there is nothing to discard. See
DECISIONS.md R-144.

**One MaturityAssessment per Assessment:** migration 0029 adds a plain
`UNIQUE(assessment_id)` constraint — safe as a non-partial form
specifically because of the atomicity above (a `draft` row can never
durably exist on its own). No supersession/versioning column was added;
none was required. See DECISIONS.md R-145.

**Control eligibility (D3 integration), the critical acceptance
criterion:** `AssessmentControl.applicability_decision` (D3's own
snapshot, frozen at Assessment creation) is the sole eligibility
source — `not_applicable` excluded, `applicable`/`undecided` both
eligible. The live `EngagementScope` is never read at compute time;
verified directly by revising a locked Scope with different decisions
AFTER maturity was already computed and proving the persisted result is
unaffected.

**The anti-gaming rule, the other critical acceptance criterion:** an
eligible control with no usable numeric rating (no response row, an
explicit `not_assessed`/`not_applicable` response rating, or a rating
the pinned methodology has no configured score for) makes its domain
`incomplete` — no `MaturityScore` row for that domain, and the entire
computation (including the overall score) is refused via
`IncompleteMaturityDataError`, carrying per-domain eligible/answered/
unanswered counts. Never excluded from the denominator, never treated
as zero, never computed from only the complete domains. A domain with
literally nothing to score (`no_mapped_controls`/`all_not_applicable`)
is a DIFFERENT, non-blocking outcome — excluded from the result, never
fabricated as zero, and never treated as "incomplete" either. See
DECISIONS.md R-146/R-147.

**Control score / domain score / overall score:** `AssessmentResponse.
effectiveness_rating`, mapped through the pinned
`MaturityScoringMethodology.definition.rating_scores` (never
hard-coded), is the sole numeric input. Domain score = round-half-up of
the arithmetic mean of its eligible controls' scores; overall score =
round-half-up of the domain-weighted mean (`MaturityDomainWeight`,
already-existing, never invented) over every scored domain. Levels
resolve from the pinned methodology's own `definition.levels`, never
hard-coded labels. A missing active methodology, a malformed
`rating_scores` map, or a missing weight for an otherwise-scorable
domain are each a distinct, named failure — never a fabricated score or
a silently-assumed weight of 0/1. See DECISIONS.md R-148.

**ControlTest/Evidence/Risk/Finding/Remediation/Validation have zero
mathematical effect** — reaffirms, not re-litigates, DECISIONS.md
R-79/R-80 and PRODUCT_SPEC.md Principle 8. Verified directly: a
contradictory FAILING ControlTest, uploaded Evidence, and a CRITICAL
residual-rated Risk were all attached to the same scored control in a
dedicated test, and the resulting maturity score is exactly what the
AssessmentResponse ratings alone imply.

**Authorization:** a new, DEDICATED `maturity.compute` permission
(Engagement Manager only) — deliberately NOT a reuse of
`assessment.finalize`/`scope.lock`, per explicit instruction, even
though all three currently resolve to the same role. Unlike D3's
`scope.lock`/`assessment.finalize` split, "compute" and "finalize" are
one atomic action for Maturity, so a single permission covers both — no
separate `maturity.finalize`. See DECISIONS.md R-149.

**Security:** migration 0030 narrows the `maturity_assessments`/
`maturity_scores` RLS write path from the previously broad
`can_access_engagement` (any active engagement member, migration 0015)
to `maturity.compute`, mirroring migration 0028's own `scope.lock`
narrowing exactly. SELECT policies are unchanged. Cross-tenant
Assessment ids, cross-tenant MaturityAssessment reads, unauthorized
roles (Consultant, Client Administrator), wrong engagement/organisation
combinations, direct-SQL tenant-isolation bypass attempts, and direct
mutation of an already-computed score were all directly, adversarially
tested and rejected.

**UI:** a minimal Maturity section added to the existing Assessment
page (only rendered once finalized) — compute button when authorized
and not yet computed, or the immutable result (overall/domain
scores/levels) once it exists, or the actionable "why not" explanation
on failure. No dashboard, no new route.

**R1 report:** one minimal section (overall score/level, per-domain
scores/levels, methodology name/version, or an honest "not calculated"
explanation when no result exists for the selected Assessment) plus one
Executive-Summary line — no analytics section, no trend content.

**Reference engagement:** a second, fully-answered, finalized
"FY2025-26 Annual DPDP Assessment" period was added (built and
finalized BEFORE the original in-progress "FY2026-27" period, so
`getEngagementReportData`'s own "most recent Assessment" selection is
unaffected), reusing the SAME real, locked D3 Scope — demonstrating
N/A exclusion (CHI-01/CHI-02), undecided-remains-eligible (ACC-02,
BRE-02), three sample domains, differentiated domain weighting (1/1/5,
chosen so the weighted overall score visibly differs from a naive
unweighted mean), and a real, persisted, immutable overall/domain
result (Overall 3/Defined; Governance & Accountability 5/Optimized;
Individual Rights & Transparency 4/Managed; Security & Data Lifecycle
3/Defined) — verified via the real read path
(`getMaturityAssessmentForAssessment`), not raw SQL. The original,
deliberately in-progress FY2026-27 Assessment is proven to still be
unable to produce a maturity result of its own (refused at the
finalization precondition, since it stays `draft` throughout). The Gap
Matrix (`REFERENCE_ENGAGEMENT.md`) Maturity row now reads YES/YES/YES/
None.

**Testing:** 844 tests pass (66 files: +22 new in
`tests/app/maturity.test.ts`, covering compute lifecycle, D3 control
eligibility, the anti-gaming rule, methodology/weighting validation,
ControlTest/Evidence/Risk non-effect, historical integrity, and
authorization/security; 7 pre-existing `tests/maturity/*.test.ts` files
updated for the new one-per-Assessment constraint — each `it()` that
previously shared one Assessment fixture across multiple
MaturityAssessment creations now builds its own distinct Assessment,
preserving each test's own original intent; `tests/app/engagement-
report.test.ts` updated for the new report page; the pre-existing
`reference-engagement.test.ts` STAGE 14 rewritten from expected-MISSING
to expected-YES). Typecheck/lint/build all clean, every check run twice
for stability, zero regressions against the Slice D3 baseline of
65/822.

**Files:** `lib/domain/maturity.ts` (new), `db/schema/maturity-
assessments.ts` (modified — new unique constraint), `db/seed/roles.ts`
(modified — `maturity.compute`), `lib/authorization/service.ts`
(modified — `canComputeMaturity`/`requireMaturityComputeAccess`),
`lib/domain/reports.ts` + `lib/reports/engagement-report-pdf.ts`
(modified — R1 extension), the Assessment page/actions (modified — UI),
`drizzle/migrations/0029_maturity_compute.sql` +
`0030_maturity_compute_security.sql` (new).

## Applicability & Scope (Session 31, 2026-09-02)

**Scope:** exactly what the D3 implementation brief instructed — on top
of a design/discovery pass (its own prior turn, no code) that inspected
the existing Regulatory Content/Control Library, Engagement, Data
Landscape, Assessment, Evidence/Risk, and Authorization model, and
produced a design proposal covering scope definition, applicability
level, the Applicability-vs-Assessment relationship, N/A semantics,
historical versioning, authorization, and a minimum data model/UX
proposal — reviewed and approved with three explicit changes before any
code was written: (1) do NOT build ProcessingActivity×Control
traceability this slice (documented as a future extension only); (2) do
NOT modify the existing polymorphic `EvidenceLink` mechanism this slice;
(3) create a DEDICATED `scope.lock` permission rather than reusing
`assessment.finalize`. Explicitly NOT built, per instruction: Maturity,
Client Portal, AI/automated legal interpretation, automatic N/A
decisions, a separate approval/review workflow, a PA×Control matrix UI,
a visual flow diagram, or an R1 redesign.

**Core architectural finding, carried from the design phase and
re-confirmed during implementation:** RegulatoryReference-level
applicability (DATA_MODEL.md §4's own, already-specified
`ApplicabilityDetermination`) cannot reliably drive Control-level
Assessment scope, because `RegulatoryReference -> Requirement -> Control`
is M:N (`ControlRequirement`) — a finding `lib/domain/assessments.ts`'s
own pre-existing docstring (Slice C7.1, R-113) had already independently
reached before D3 existed. Control-level applicability
(`EngagementScopeControl`, new) is therefore the one mechanism that
actually integrates with Assessment; `ApplicabilityDetermination`
remains exactly as documented, serving its own narrative/report-facing
purpose only. See DECISIONS.md R-138.

**Assessment integration, the critical acceptance criterion:**
`AssessmentControl` membership is never filtered — every Control in the
pinned library still becomes a row, unconditionally, exactly as Slice
C7.1 originally built it. `createAssessment` additionally snapshots the
Engagement's currently LOCKED `EngagementScope`, per Control, onto each
new `AssessmentControl` row at creation time; if no locked Scope exists,
every row keeps its default (`undecided`, nulls) — no explicit
"applicable" decision is ever fabricated. Verified directly: revising
Scope, or flipping a decision, after Assessment creation never changes
that Assessment's own already-created snapshot — for a still-draft
Assessment AND a since-finalized one, both. See DECISIONS.md R-139.

**The tri-state, the critical semantic requirement:** `undecided` /
`applicable` / `not_applicable` is a genuine three-value enum, never a
boolean — every Control gets a real, explicit `EngagementScopeControl`
row the moment a Scope is created (mirroring `createAssessment`'s own
population pattern), so "not yet reviewed" is always a queryable fact,
never inferred from an absent row. `not_applicable` requires a
rationale, enforced by a database CHECK constraint, not merely the
application layer. See DECISIONS.md R-140.

**Lifecycle:** draft (freely editable) → locked (permanently immutable
— both the Scope header and every Control/RegulatoryReference decision
under it, enforced by dedicated database triggers mirroring Assessment
finalization's own trigger family) → a revision opens a NEW
`EngagementScope` (`previous_scope_version_id` set), carrying forward
the prior version's own decisions as its starting point (a considered
extension beyond the literal brief — DECISIONS.md R-143) rather than
resetting to blank; the old, locked version is never touched. No
"reopen" action exists.

**Authorization:** a genuinely new, DEDICATED `scope.lock` permission
(`db/seed/roles.ts`, granted to Engagement Manager only), deliberately
NOT a reuse of `assessment.finalize` even though both resolve to the
same role today — per explicit instruction, the two actions must stay
independently controllable (DECISIONS.md R-141). Proposing/editing a
draft Scope requires real `EngagementMembership`
(`requireEngagementMembershipAccess`, new) — narrower than the broad
`requireEngagementAccess` every other engagement-scoped write in this
codebase uses, specifically to exclude client-side, Organisation-scoped
roles (Client Administrator, Privacy Officer, CXO/Executive Viewer) from
the write path, per the brief's own explicit "no client-side write
access" requirement; this does not fully close the separate,
pre-existing, already-documented gap that client-side, Engagement-scoped
roles (Business Owner/IT-CISO/Procurement/Legal) would still pass this
narrower check too — the identical limitation `updateAssessmentResponse`
already has today, out of this slice's own scope to fully close
(DECISIONS.md R-142).

**Tenant isolation & methodology compatibility:** every write re-derives
the authoritative engagement/organisation from the target row itself,
never a caller-supplied id; a Control from another tenant's library, or
the wrong library version, is rejected by composite FKs mirroring
`assessment_controls_control_library_version_fk` exactly — verified
directly with a raw-SQL insert attempt, not merely the domain layer.

**Database:** two new tables (`engagement_scopes`,
`engagement_scope_controls`), DATA_MODEL.md §4's own
`applicability_determinations`/`applicability_determination_regulatory_
references` (implemented for the first time, unchanged from its
existing spec), and five new nullable snapshot columns on the
pre-existing `assessment_controls` table
(`applicability_decision`/`applicability_rationale`/
`applicability_decided_by`/`applicability_decided_at`/
`engagement_scope_control_id`) — migrations 0027 (schema) and 0028
(RLS/triggers/audit/grants), mirroring the Assessment Engine's own
migration 0008/0009 shape throughout.

**UI:** `/organisations/[id]/engagements/[id]/scope` (version history,
"Start Scope") and `/scope/[scopeId]` (Framework determinations,
Controls with an explicit Undecided/Applicable/Not Applicable badge on
every row, "Lock scope", "Create new revision") — the smallest coherent
experience, using the existing shadcn/ui-style components and
Server-Action pattern established since Slice B1/D1/D2, no new design
system, no PA×Control matrix, no visual flow diagram.

**Tests:** `tests/app/applicability-scope.test.ts` (new, 16 tests) —
Scope lifecycle, applicability semantics (including the mandatory-
rationale and tri-state requirements), authorization (Consultant/
Engagement Manager/client-side/cross-tenant), methodology compatibility,
and the Assessment-snapshot acceptance criterion (draft AND finalized)
— plus the reference-engagement fixture itself now exercising the full
Scope path as its own real, non-test-only "production" use, and
`tests/app/reference-engagement.test.ts`'s own STAGE 4 upgraded from
MISSING-proving to YES-proving assertions.

## Data Landscape / Processing Activities (Session 30, 2026-09-02)

**Scope:** exactly what the D2 brief instructed — the minimum viable
Data Landscape / Processing Activities / ROPA capability, on top of the
EXACT existing master-data (Milestone 2) and Processing Activity /
version-pinned-junction (Milestone 3) schema, preserving both entity
families' ownership model (Organisation-level master data vs.
Engagement-level Processing Activities), their SCD2 versioning, and
their existing RLS/authorization boundary unchanged. Explicitly NOT
built, per instruction: Applicability/Scope, Maturity, Client Portal, a
visual data-flow diagram, a second ROPA data model, a second PDF/report
subsystem, or a new permission.

**Inspection findings (§3), before any code was written:** (A) the full
database schema for both master data and Processing Activities/
junctions already existed and was correct (Milestones 2/3 — identity +
SCD2 version tables, `one_current_key` partial unique indexes,
`close_out_previous_*_version` triggers, composite FKs proving
organisation/engagement/version consistency, full RLS and audit
logging). (B) zero application layer existed for any of it — confirmed
by a repository-wide grep of `lib/domain/*.ts` and `app/` for any
processing-activity/master-data-touching code, finding none beyond the
raw-SQL test fixture helpers. (C) everything was reachable only through
raw SQL (`tests/master-data/helpers.ts`, `tests/processing-activity/
helpers.ts`, and the reference-engagement fixture's own pre-D2
construction). (D) exactly a domain module for each scope, plus UI at
the two routes PRODUCT_UX_BLUEPRINT.md §14 already specified, were
missing. (E) organisation vs. engagement ownership, (F) what's
versioned, and (G) what an engagement pins/snapshots were all already
answered unambiguously by DATA_MODEL.md §5.1-§5.4 and the schema itself
— see DECISIONS.md R-133.

**Ownership, derived from the repository:** Business Unit/Data
Principal Category/Personal Data Element/Purpose/System/Data Store/
Processor = Organisation-level master data (`lib/domain/master-data.ts`).
Processing Activity + its six junctions = Engagement-level
(`lib/domain/processing-activities.ts`). Two domain modules because the
schema itself draws that boundary — see DECISIONS.md R-133.

**Versioning, the existing SCD2 mechanism, unchanged:** no second
versioning mechanism was built. Master-data "editing" always inserts a
new version row via the six categories' already-existing `close_out_
previous_*_version` triggers; a Processing Activity's link to master
data pins both the identity id and the specific version id current at
link time (migration 0004, already built). Verified directly:
`createSystemVersion` after a link was made leaves the Processing
Activity's own resolved read unchanged while the System's own current
list correctly reflects the new version; `carryForwardProcessingActivity`
re-resolves every link to each entity's then-current version in the new
engagement without touching the source engagement's row.

**Authorization:** no new permission. `requireOrganisationAccess`
(master data) and `requireEngagementAccess` (Processing Activities) —
the same broad checks migrations 0003/0005's own RLS already used for
these exact tables, and the shape PRODUCT_UX_BLUEPRINT.md §8's
Permission Matrix specifies for these two rows. See DECISIONS.md R-134.

**Tenant isolation:** every write function re-derives the authoritative
organisation/engagement from the target row itself, never a
caller-supplied id; verified directly at both the application layer
(`NotFoundOrForbiddenError`) and RLS (direct raw cross-tenant `SELECT`
independently returns zero rows) — matching Slice D1's own testing
discipline.

**ROPA:** `listRopaEntries` — a read view over Processing Activities and
their six junctions, never a new persisted table (DECISIONS.md R-135),
matching `db/schema/processing-activities.ts`'s own pre-existing header
comment. No new export/PDF subsystem — R1 unchanged.

**UI:** `/organisations/[id]/master-data/[category]` (one tabbed screen
across all seven categories — list, add, and, for the six versioned
ones, "edit" that creates a new version, plus retire) and
`/organisations/[id]/engagements/[id]/data-landscape` (Processing
Activity list, create, detail with all six relationship-link sections
and a carry-forward action, and the `/ropa` sub-route) — the smallest
coherent experience, using the existing shadcn/ui-style components and
Server-Action pattern established since Slice B1/D1, no new design
system.

**Tests:** `tests/app/data-landscape.test.ts` (new, 26 tests) —
master-data CRUD/versioning/authorization/tenant-isolation (12),
Processing Activity CRUD/relationships/versioning/carry-forward/
authorization/tenant-isolation/ROPA (14) — plus the reference-engagement
fixture itself now exercising the full Data Landscape path as its own
real, non-test-only "production" use, and `tests/app/reference-
engagement.test.ts`'s own STAGE 3 upgraded from PARTIAL-proving to
YES-proving assertions. Full regression (`npx vitest run`, the complete
combined application + database suite) run twice: 64 files / 784 tests,
stable both times, zero regressions against Slice D1's own 63/758
baseline. `tsc --noEmit`, `eslint .`, and `next build` all clean, each
run twice.

## Control Library Authoring (Session 29, 2026-09-02)

**Scope:** exactly what the D1 brief instructed — the minimum viable
internal Control Library Authoring capability, on top of the EXACT
existing Regulatory Content & Control Library model (Milestone 4,
migrations 0006/0007), preserving its ownership model, its draft/
published/retired lifecycle, and its publish-immutability guarantees
unchanged. Explicitly NOT built, per instruction: Data Landscape, ROPA,
Applicability/Scope, Maturity, Client Portal, Billing, SSO, MFA, AI,
notifications, dashboards, a custom report builder, a methodology admin
UI beyond the smallest coherent authoring experience, malware scanning,
workflow automation, white-labeling, multi-framework UI, or any
"advanced" methodology workflow (comparison views, approval chains,
etc.) beyond the one linear lifecycle already documented.

**Inspection (§1) findings, before any code was written:** direct
reading of migration 0007 (the Milestone-4 security layer) confirmed
the ENTIRE lifecycle this slice needed already existed at the database
level: `prevent_control_library_version_tampering` (the draft →
published → retired transition trigger, auto-stamping `published_at`),
`enforce_control_draft_mutable`/`enforce_control_requirement_draft_
mutable` (the triggers that make a published version's Controls and
associations genuinely immutable), `prevent_methodology_reparenting`/
`prevent_engagement_control_library_pin_change` (the two immutable-once-
set guards), and `log_methodology_change`/`log_methodology_relationship_
change` (audit-log triggers covering every write this slice makes,
automatically — no new audit code was written). DECISIONS.md R-42/R-43
(read fresh) settled §2's ownership question directly: methodology is
Tenant/practice-owned (every table carries `tenant_id`, never
`organisation_id`), and Requirements are deliberately NOT re-created
per library version — shared, tenant-wide reference content a Control
from any version may map to over time. This governed the one
architecturally consequential decision in this slice: `clone
ControlLibraryVersion` (§4's "create a new version from an existing
published version") copies Controls into fresh rows but reuses the
exact same Requirement rows, never duplicating them (DECISIONS.md
R-132) — preserving an existing, documented decision rather than
inventing a competing one.

**Authorization (§7):** a new `methodology.manage` permission
(`db/seed/roles.ts`), NOT a generic admin bypass — resolved from
PRODUCT_UX_BLUEPRINT.md §8's own Permission Matrix, whose "Methodology"
capability row maps its "Tenant" column (full R,C,E,F) to exactly
"Platform Administrator, Practice Partner" in the same document's own
legend (DECISIONS.md R-130, which also explains why this reading was
preferred over §5 row 20's own single-persona "Platform Administrator"
label). `hasTenantPermission`/`canManageMethodology`/
`requireMethodologyManageAccess` (new, `lib/authorization/service.ts`)
mirror `hasEngagementPermission`/`hasOrganisationPermission`'s exact
existing shape, one scope up — the first tenant-scope permission check
in this codebase. Enforced in BOTH layers per instruction: every domain
write function re-derives the authoritative tenant from the target row
itself (never a caller-supplied id) and calls
`requireMethodologyManageAccess`; migration 0026 additionally narrows
all six methodology tables' write RLS policies from "any active Tenant
member" to "a Tenant member whose Role grants `methodology.manage`" —
the same narrowing precedent Slice C7.3 established for
`assessment.finalize`. Read access is deliberately left at the
existing, broader `can_access_tenant` boundary — a documented, narrow
scope limit, not an oversight (DECISIONS.md R-131): this slice's actual
ask is authoring (write), and PRODUCT_UX_BLUEPRINT.md's own broader
"Consultant: R" read aspiration for Methodology is recorded as a real,
non-blocking gap for a future slice to close.

**Domain module (`lib/domain/control-library.ts`, new):**
`createRegulatoryReference`/`createRequirement` (always-editable,
non-lifecycle-gated content, DECISIONS.md R-44), `createControlLibrary
Version`/`createControl`/`updateControl`/`deleteControl`/
`associateControlRequirement`/`dissociateControlRequirement` (all
draft-only, pre-checked for clean errors with migration 0007's own
triggers as the real, unconditional backstop), `publishControlLibrary
Version` (re-loads the authoritative version, re-authorizes, re-
verifies draft, and publishes transactionally — steps validating
control/association integrity collapse into "already guaranteed by
construction," documented in the function's own docstring rather than
re-invented), and `cloneControlLibraryVersion` (the new-version-from-
published-source path, DECISIONS.md R-132). A real, hard `DELETE` is
supported for a draft Control (unlike most entities in this codebase)
because it is provably safe by construction: a draft-version Control
can never yet have any Assessment/Risk reference, since an Assessment
can only pin to a published/retired version.

**Migration (`drizzle/migrations/0026_control_library_authoring.sql`,
new):** no new table, no new column — confirmed unnecessary by
inspection, not assumed. Adds `has_tenant_permission` (mirroring
migration 0024's `has_engagement_permission`/`has_organisation_
permission`) and narrows the six methodology tables' write policies as
described above. SELECT policies are unchanged.

**UI (`app/(shell)/methodology/**`, new):** the smallest coherent
authoring experience per instruction — `/methodology` (a two-link
landing, Control Library + Regulatory Content), `/methodology/
control-library` (list, create), `/methodology/control-library/
[versionId]` (metadata, controls table, Publish confirmation mirroring
the Assessment workspace's own Finalize control, "Create New Version"
when published), `/methodology/control-library/[versionId]/controls/
new` and `/controls/[controlId]` (create/edit/delete, requirement
association management), `/methodology/regulatory-content`
(references/requirements, simple always-available create forms). Every
write action is additionally gated server-side by
`canManageMethodology` — the UI's own conditional rendering is a
convenience, never the authorization boundary, per instruction. The
"Methodology" nav link (`components/shell/nav.tsx`) is now shown to
every signed-in user, matching how "Organisations" is already shown —
the real gate is each page's own server-side check.

**Reference-engagement fixture refactor (§11):** `tests/app/reference-
engagement-fixture.ts`'s demo Control Library construction now calls
the real domain functions above (via `withRequestDb(leadUserId, ...)`,
the same "Ananya Krishnan" Practice Partner persona who already held
the right Role) instead of the raw-SQL fixture helpers it used before
this slice — the minimal refactor instructions §11 asked for, not a
rewrite of the rest of the fixture. `REFERENCE_ENGAGEMENT.md`'s own
Gap Matrix DPDP Controls row moved from `PARTIAL` to `YES`/`YES`/`YES`/
`None`, re-verified against real evidence (a live domain-layer read,
not a raw query) rather than "artificially improved," per instruction.

**Tests (`tests/app/control-library-authoring.test.ts`, new, 25
tests):** real PostgreSQL, real domain functions, no mocked
authorization — authorization (6: Practice Partner and Platform
Administrator both succeed; a Tenant member with a permission-less
custom Role fails; an Engagement-Manager-only user with no
TenantMembership at all fails; a Client Administrator fails; cross-
tenant authoring fails), draft lifecycle (5: create/edit, requirement
association plus idempotent re-association, cross-tenant association
rejected, duplicate code/label guards, empty-input guards), publishing
(4: valid draft publishes, zero-Control version can still publish — no
invented minimum, double-publish rejected, published Controls/
associations immutable at the domain layer), a dedicated raw-SQL
immutability check independent of the domain layer, versioning (3:
clone produces a draft with copied Controls/associations reusing the
same Requirements, the published source is provably untouched
afterward, cloning a still-draft source is rejected), the Assessment-
integrity acceptance criterion (1, the scenario described above), and
tenant isolation (3: a direct raw-SQL RLS check — note the narrowed
UPDATE policy's own USING clause makes an unauthorized UPDATE affect
zero rows rather than throw, unlike the INSERT case, which does throw —
a genuine RLS-shape finding this slice's own testing made; a cross-
tenant read-isolation check; an anonymous-caller check). Full
regression: 758 tests pass (63 files), run twice for stability, zero
regressions against the Reference Engagement Dataset baseline of
733/62.

**Documentation.** DECISIONS.md R-130 through R-132 (permission-role
resolution; the deliberate read-access scope limit; the clone-reuses-
Requirements decision, itself a restatement of the already-existing
R-42/R-43). `REFERENCE_ENGAGEMENT.md` updated: new "Control Library
Authoring (Slice D1)" section, Gap Matrix row corrected with evidence,
"End-to-end status" and "Highest-priority gaps" both re-ranked now that
this gap is closed.

No Data Landscape, Processing Activities/ROPA, Applicability/Scope,
Maturity, Client Portal, Billing, SSO, MFA, AI, notifications,
dashboards, custom report builder, malware scanning, workflow
automation, white-labeling, multi-framework UI, or advanced methodology
workflow. STOP after D1 per explicit instruction.

## Reference Engagement Dataset (Session 28, 2026-09-02)

**Scope:** exactly what the brief instructed — inspect first (no code
until the inspection in §1 was complete), build one fictional reference
engagement end to end, identify exactly where the application currently
supports the requested workflow and where gaps remain, and report a
Gap Matrix — not a new product feature, and explicitly not permission to
build Client Portal/Billing/SSO/MFA/AI/notifications/dashboards/a
custom report builder/a methodology admin UI/malware scanning/advanced
workflow automation/white-labeling/multi-framework support.

**Inspection (§1) findings, before any code was written:** direct
`grep`/file-existence checks across `lib/domain/*`, `app/(shell)/**`,
`db/schema/*`, and every migration confirmed: real, tested application
code exists for Organisation, Engagement, Engagement Membership,
Assessment, Assessment Response, Control Test, Evidence, Risk, Finding,
Remediation, Validation, and the R1 Engagement Report; ZERO application
code (no domain module, no route) exists for Data Landscape/ROPA,
Regulatory Content/Control Library authoring, or Maturity, despite each
having real, well-designed database schema from Milestones 2/3/4/8/8A;
`ApplicabilityDetermination` (DATA_MODEL.md §4) has no schema at all.
This matches `package.json`'s own description of those milestones as
"database foundation... only. No product UI yet" and ROADMAP.md's own
phase sequencing — an existing, self-consistent finding this session
only had to confirm and demonstrate concretely, not discover from
scratch.

**Fixture construction — two deliberately distinct layers** (see
`REFERENCE_ENGAGEMENT.md` for the full content list and DECISIONS.md
R-128 for why this lives as a Vitest test file rather than a standalone
script): raw SQL, via the existing `asFixtureSetup` superuser-connection
pattern every prior test suite already uses, for the identity/bootstrap
layer (Tenant, two Users — this product has no sign-up flow) and for
the two areas with schema but no application layer; real domain
functions, via `withRequestDb`, for every stage the application layer
actually implements — `createOrganisation`, `createEngagement`,
`addEngagementMember`, `createAssessment`, `updateAssessmentResponse`,
`createControlTest`, `uploadEvidence`, `createRisk`/`updateRiskStatus`,
`createFinding`/`updateFinding`, `createRemediationAction`/
`updateRemediationAction`, `createValidationRecord`,
`getEngagementReportData`/`renderEngagementReportPdf` — the exact
function a real Server Action would call, with the exact authorization
checks a real user would go through, nothing bypassed or mocked.

**Two small, in-place additions to existing test-helper files** (not a
new abstraction): `tests/master-data/helpers.ts` gained
`insertPurposeVersion`/`insertPersonalDataElementVersion`/
`insertDataPrincipalCategoryVersion` — mirroring
`insertSystemVersion`/`insertProcessorVersion`/`insertDataStoreVersion`'s
exact existing shape, needed only because the Milestone 2 test suite
itself never needed named Purpose/PersonalDataElement/
DataPrincipalCategory content and so never built these three helpers.

**Demo Control Library:** 25 original controls (never a statutory
quotation, never attributed to a specific DPDP Act/Rules section) across
the 12 categories the brief names, each mapped to one of 12
Requirements citing one clearly-labeled illustrative RegulatoryReference.
The library's own version label states plainly it is "SAMPLE — for
demonstration only, not an official or verified regulatory framework."
Published through the real, trigger-enforced publish workflow (migration
0007) — re-verified live this session by attempting a raw edit to a
published Control and confirming the pre-existing immutability trigger
still rejects it, exactly as it would for a real consultant.

**Data Landscape / ROPA:** the ten Processing Activities the brief
itself names, each linked through the real version-pinned junction
tables (Milestone 3) to a realistic subset of newly-created master data
(3 Business Units, 4 Systems, 3 Data Stores, 3 Processors — one
deliberately without a DPA, feeding a real Finding below — 10 Purposes,
8 Personal Data Elements, 4 Data Principal Categories).

**Assessment through Report — the confirmed-working loop:** one
`annual` Assessment (kept `draft`, never finalized, per instruction),
25 auto-populated AssessmentControls, 18 responded (a realistic
implemented/partially_implemented/not_implemented/not_applicable
mixture) with 7 deliberately left unresponded, 6 ControlTests across 5
methodologies and all 3 results, 9 Evidence items exercising all 4
`EvidenceLink` subject types, 6 Risks (all 3 non-closed statuses), 7
Findings (severities low→critical), 8 RemediationActions across 2
different owners (all 3 statuses), 2 ValidationRecords (one accepted,
one rejected — the rejected remediation was then manually reopened as
a separate, explicit action, never automatic). The R1 Engagement Report
was generated for real against this fixture, producing an 11-page PDF —
manually inspected page-by-page (`pdftoppm`), not merely asserted
against extracted text — confirming it correctly omits Maturity and
ROPA/Data Landscape sections even though this reference Engagement has
real data sitting in the database for both, exactly as R1's own design
requires.

**A real bug found and fixed in R1's own PDF renderer** (DECISIONS.md
R-127): this fixture's much larger, more realistic content (a
25-control demo library, several multi-line control titles) reproduced
a defect R1's own smaller test fixture never triggered — a table row
whose tallest cell wrapped onto 3 lines right at the bottom margin
could have pdfkit silently paginate mid-row, corrupting every later
cell's position. `lib/reports/engagement-report-pdf.ts`'s `table()`
function now measures each row's real height before drawing it and
paginates first if it wouldn't fit, rather than checking a fixed
threshold and letting pdfkit decide mid-row. Found only by this
session's own mandatory manual/visual PDF inspection — a garbled row
is invisible to pure text-extraction assertions, since every word is
still present, just mispositioned. This is the ONLY change made to
Slice R1 itself this session, per the brief's own "do not modify R1
unless an actual defect is discovered" instruction; re-verified by
re-rendering and re-inspecting both this fixture's PDF and R1's own,
with neither test regressing.

**Gap Matrix and full end-to-end findings:** `REFERENCE_ENGAGEMENT.md`
(new) — the 16-row Database/Application/End-to-End/Gap table, the
full fixture content inventory, and the ranked highest-priority-gaps
list.

**Tests:** `tests/app/reference-engagement.test.ts` (new, 16 tests) —
one per workflow stage, each asserting the real, database-verified
WORKS/PARTIAL/MISSING outcome (not inferred from a table existing):
real query failures proving `applicability_determinations` doesn't
exist; real `repoFileExists()` checks proving no `lib/domain/
processing-activities.ts`/`maturity.ts`/`control-library.ts` module and
no corresponding app route exist; real domain-function return values
for every stage that does work. Full regression: 733 tests pass (62
files), run twice for stability, zero regressions against the R1
baseline of 717/61.

No Client Portal, Billing, SSO, MFA, AI features, notifications,
dashboards, custom report builder, methodology admin UI, malware
scanning, advanced workflow automation, white-labeling, or multi-
framework support — none was built, per explicit instruction; each is
recorded in the Gap Matrix where it belongs instead.

## Slice R1 — Basic Engagement Report (Session 27, 2026-09-02)
(Session 27): PRIMUS can now generate one real, professional,
client-facing PDF Engagement Report directly from live governance-loop
data, closing the MVP Gap Review's own recommended next slice. A new
`Reports` section on the Engagement detail page links to
`.../reports` — a Route Handler (`app/.../reports/route.ts`, mirroring
the Evidence-download route's exact GET-returns-binary shape from
Slice C2) that authorizes via the same `requireEngagementAccess` every
other Engagement screen uses (DECISIONS.md R-125 — no new
report-specific permission was invented), loads one coherent snapshot
of data (`getEngagementReportData`, new `lib/domain/reports.ts`), and
renders it to PDF (`renderEngagementReportPdf`, new
`lib/reports/engagement-report-pdf.ts`, built on a newly-added `pdfkit`
dependency, chosen and verified as a mature, minimal, pure-JS
dependency with no headless browser or native compile step —
DECISIONS.md R-121). Every section reuses this codebase's own existing
read models (`getEngagementDetail`, `getAssessmentDetail`,
`listRisksForEngagement`, `listFindingsForEngagement`,
`listRemediationActionsForEngagement`, and two small new
engagement-wide list functions added to their existing peer modules —
`listValidationRecordsForEngagement` in `validation.ts`,
`getEvidenceSummaryForEngagement` in `evidence.ts`, both mirroring the
identical shape their per-Finding/per-RemediationAction siblings
already use) — no new report-only query set, no snapshot table. The
Engagement's most recently created Assessment is selected automatically
(`created_at DESC, id DESC`, the user's own explicit, precise
instruction — DECISIONS.md R-122), with no picker UI, and its type/
period/status/ID are shown on the cover, the Assessment Results header,
and the Appendix. Draft and finalized Assessments are both reportable —
no finalization requirement was invented (DECISIONS.md R-124). No new
database table: report generation is audited via a direct `audit_log`
write, reusing the exact `getEvidenceDownloadUrl` (Slice C2) precedent
rather than designing the `generated_reports` table PRODUCT_UX_
BLUEPRINT.md itself calls only a speculative "candidate" (DECISIONS.md
R-123). Evidence is summarized as metadata only — no storage path, no
signed URL, tested directly. No Maturity section, no ROPA/Data
Landscape section, no AI narrative, no charts, per explicit instruction.
This slice's own mandatory manual inspection of the actual generated
PDF (not just unit tests) found and fixed a real pdfkit pagination bug —
a footer positioned just past the printable area was silently forcing
an extra, near-blank page after every section (DECISIONS.md R-126),
now fixed and covered by a tightened, exact page-count test. 717 tests
pass (61 files, +26 new in `tests/app/engagement-report.test.ts`,
including real PDF-structure verification via `pdfjs-dist`, a new
dev-only dependency), run twice for stability, zero regressions. Full
details in the "Slice R1" section below. STOP after R1 per explicit
instruction — no DPDP content authoring, real Storage provisioning,
Data Landscape, ROPA, Maturity, Client Portal, C7.4, or C7.5 without
further explicit direction.

## Slice R1 — Basic Engagement Report (Session 27, 2026-09-02)

**Scope:** exactly what the R1 brief instructed — one strong,
exportable, client-facing Engagement Report generated from the live
governance-loop data that already exists, following the brief's own
five-critical-semantics-before-coding discipline. Of the five, four
were resolved directly from repository evidence without asking:

- **Output format — PDF.** PRODUCT_UX_BLUEPRINT.md §5 row 18 ("Generate
  PDF/export") and §15's Server/API Boundary table ("Route Handler —
  returns a binary/PDF stream") both say so explicitly.
- **Audited — yes, via a direct `audit_log` write, no new table.**
  PRODUCT_UX_BLUEPRINT.md §7 frames `generated_reports` as a mere
  "candidate... not yet designed," while separately requiring the
  *event* itself be audited — the exact situation Slice C2's
  `getEvidenceDownloadUrl` already solved once (DECISIONS.md R-123).
- **Draft vs. finalized eligibility — both allowed.** PRODUCT_SPEC.md
  §5 and PRODUCT_UX_BLUEPRINT.md §7 both describe the report as a
  live/point-in-time artifact, with no finalization gate documented
  anywhere (DECISIONS.md R-124).
- **Exact contents — the brief's own default 10-section structure**
  (Cover, Executive Summary, Engagement Overview, Assessment Results,
  Risk Register, Findings, Remediation, Validation, Evidence Summary,
  Appendix), since PRODUCT_UX_BLUEPRINT.md specifies no different one.

The fifth — **which Assessment to report on, given an Engagement can
have more than one** — was genuinely ambiguous and put to the user
directly via `AskUserQuestion` rather than guessed at. The user chose
"most recent," specifying the exact deterministic ordering
(`created_at DESC, id DESC`) and requiring the selected Assessment's
type/period/status/ID be clearly shown in the report, with no picker UI
in this slice (DECISIONS.md R-122) — implemented exactly as specified.

Explicitly NOT built this slice, per instruction: a dashboard, an
analytics platform, cross-client reporting, scheduled/emailed reports,
report history, a template marketplace, a custom report builder/
designer, AI-generated narrative, charts (none were judged genuinely
useful for this MVP), PowerPoint/Excel/multiple export formats, Client
Portal, ROPA/Data Landscape, Maturity, C7.4, C7.5.

**Data aggregation (`lib/domain/reports.ts`, new).**
`getEngagementReportData(db, userId, {organisationId, engagementId})`
is the report's one coherent read: loads the Engagement
(`getEngagementDetail`, cross-checking the caller-supplied
`organisationId` against the Engagement's own authoritative one — never
trusting the browser, mirroring `finalizeAssessment`'s identical
posture), selects the most recent Assessment
(`ORDER BY created_at DESC, id DESC LIMIT 1`, a new small query — throws
`NoAssessmentForEngagementError` if the Engagement has none yet), loads
that Assessment's full detail (`getAssessmentDetail`, reused unchanged),
then reads Risks/Findings/RemediationActions/ValidationRecords/Evidence
for the whole Engagement. Two small new list functions were added,
each mirroring an existing sibling's exact shape rather than being
designed fresh: `listValidationRecordsForEngagement`
(`lib/domain/validation.ts`, alongside the existing per-RemediationAction
`listValidationRecordsForRemediation`) and
`getEvidenceSummaryForEngagement` (`lib/domain/evidence.ts`, alongside
the existing per-Control/per-RemediationAction/per-ValidationRecord
`getEvidenceSummaryFor*` functions — this one starts `FROM evidence`
directly rather than `FROM evidence_links`, since one Evidence row is
one report line regardless of how many subjects it happens to be linked
to). Every sub-read still independently re-authorizes via its own
existing `requireEngagementAccess` call — the same defense-in-depth
posture every prior slice has used, not weakened here for convenience.
Queries run sequentially, not via `Promise.all`, matching every other
multi-read domain function's style against the one shared
`PoolClient` `withRequestDb` provides per request.

**PDF rendering (`lib/reports/engagement-report-pdf.ts`, new).**
`renderEngagementReportPdf(data, meta)` is a pure function — no
database access, no I/O of its own — from `EngagementReportData` to an
in-memory PDF `Buffer`, built with `pdfkit` (new dependency, chosen and
verified against instructions §17's "mature, minimal dependency...
works reliably in the existing Vercel serverless architecture" bar:
pure JavaScript throughout, no headless browser, no native compilation
— DECISIONS.md R-121). Visual identity reuses the existing UI's own
Tailwind palette (slate for structure/text, blue-600 as the one accent)
rather than inventing a new one, per instructions §15/§16. Produces the
brief's own 10-section default structure; every enum/status value is
rendered exactly as the schema stores it (no relabeling table), matching
how every existing screen already displays these same values. This
slice's own mandatory manual/visual inspection of the actual generated
PDF (instructions §36 — not just unit tests) caught a real pdfkit
pagination bug: a footer Y-position placed just past pdfkit's own
printable-area boundary was silently treated as page overflow, forcing
a spurious near-blank page after every section (19 pages instead of 10)
— fixed, re-verified by re-rendering and re-inspecting the demonstration
PDF page-by-page, and locked in by tightening the test's page-count
assertion from a loose bound to an exact `toBe(10)` plus a per-page
non-empty-content check (DECISIONS.md R-126).

**Route Handler (`app/(shell)/organisations/[organisationId]/
engagements/[engagementId]/reports/route.ts`, new).** A plain GET,
mirroring the Evidence-download route's exact shape (Slice C2) so the
Engagement page's "Generate Engagement Report" entry point is a compact
`<a>` link needing no client-side JavaScript: authenticate → load report
data (which independently authorizes) → render PDF → write one
`audit_log` row (`entity_type: "engagement"`, `reason:
"engagement_report_generated"`, `field_changes` naming only which
Assessment was selected — never any Risk/Finding/Remediation/Evidence
content, per instructions §31's confidentiality requirement) → return
the PDF as `application/pdf` with `Content-Disposition: attachment`.
`NotFoundOrForbiddenError` → 404; `NoAssessmentForEngagementError` → a
clean 400; anything else → a generic 500, full detail server-logged
only (never the report's own content).

**UI entry point.** A new "Reports" section on the Engagement detail
page (`app/.../engagements/[engagementId]/page.tsx`), placed after
Remediation and before Members: shows which Assessment will be reported
on and a "Generate Engagement Report (PDF)" link when the Engagement
has at least one Assessment, or an explanatory note when it does not.
No separate `/reports` page, no report list, no history — the route
itself is the whole feature surface, per instructions §37's explicit
"do not build... report history."

**Tests (`tests/app/engagement-report.test.ts`, new, 26 tests).** Real
PostgreSQL, real domain functions, no mocked authorization — 5
authorization scenarios (active member succeeds for both an Engagement
Manager and a plain Consultant, an unrelated tenant member is rejected,
a cross-tenant actor is rejected, an anonymous caller is rejected) plus
a forged-`organisationId` check; a draft-vs-finalized state check (the
same Assessment, reported on both before and after finalizing, both
succeeding); most-recent-Assessment selection including a genuine
`created_at`/`id` tie-break scenario (two Assessments forced to the
identical `created_at`, asserting the tie-break `id DESC` ordering
actually decides the winner) and a zero-Assessment
`NoAssessmentForEngagementError` check; 8 data-correctness checks against
a real, deliberately varied fixture (multiple control-response states
including "not yet responded," a Risk with both inherent and residual
ratings, a Finding, two RemediationActions, a ValidationRecord, two
Evidence items) verifying every field the report surfaces matches the
real underlying rows, including that Evidence rows carry no
`storagePath`/`url`/`signedUrl` field; 2 isolation checks (canary
Risk/Finding/Evidence rows planted on a sibling Engagement in the same
Organisation, asserted absent from the report); 4 output checks against
the actual rendered PDF bytes, parsed back into real per-page text via
`pdfjs-dist` (new dev-only dependency — chosen specifically because
instructions §27 forbids "just string-search[ing]" the raw buffer;
zero runtime dependencies of its own, used only for text extraction,
never its canvas-rendering path) — exact page count, the selected
Assessment's type/period/status/ID all present verbatim, real fixture
content present (title strings compared via a whitespace/hyphen-
normalizing helper to tolerate pdfkit's own legitimate table-cell word
wrapping), and confirmation that no storage path, signed URL, or
cross-Engagement canary content ever appears in the rendered bytes.
Per instructions §36, a real deterministic-fixture PDF was also written
to disk and manually inspected page-by-page (via `pdftoppm`, installed
for this purpose) — the pagination bug above was found this way, not
by the automated assertions alone. Full regression: 717 tests pass (61
files), run twice for stability, zero regressions against the C7.3
baseline of 691/60.

**Documentation.** DECISIONS.md R-121 through R-126 (PDF library choice
and test-verification library choice; Assessment-selection semantics as
specified by the user; no new `generated_reports` table; draft/
finalized eligibility; no new report-specific permission; the real
pagination bug found and fixed).

No Maturity, ROPA/Data Landscape, AI narrative, charts, dashboard,
analytics platform, cross-client reporting, scheduled/emailed reports,
report history, template marketplace, custom report builder, PowerPoint/
Excel/multiple export formats, Client Portal, C7.4, or C7.5. STOP after
R1 per explicit instruction.

## Slice C7.3 — Assessment Finalization (Session 26, 2026-09-01)

**Scope:** exactly what the C7.3 brief instructed — a clear,
enforceable lifecycle boundary between an editable Assessment and a
finalized one. Explicitly NOT built this slice, per instruction:
Maturity, Reporting, Client Portal, evidence download, Engagement
editing, ROPA/Data Landscape, AI, billing, reopening (unless the model
required it — it doesn't), Assessment comparison, previous-assessment
workflows, a new approval/sign-off workflow, notifications/email,
digital signatures.

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`, every
Assessment-adjacent schema file, migrations 0008/0009/0011 in full,
the existing Assessment domain module/workspace/Server Actions, the
existing role/permission model (`hasEngagementPermission`,
`requireEngagementMembershipManageAccess`, C7.2's own authorization
helpers), and existing Assessment/audit tests fresh from disk before
writing anything, per instruction.
(Session 26): establishes the real, enforceable lifecycle boundary
between an editable and a finalized Assessment. `finalizeAssessment`
(new, `lib/domain/assessments.ts`) is the one, terminal `draft →
finalized` transition, gated on a new `assessment.finalize` permission
(`canFinalizeAssessment`, `lib/authorization/service.ts`) — a genuinely
new, distinct permission (not `engagement.manage`), granted to
Engagement Manager, resolved from PRODUCT_UX_BLUEPRINT.md §8's own
explicit "Engagement Manager additionally gets finalize/membership-
manage" (DECISIONS.md R-117). No new immutability mechanism was built —
direct, fresh inspection of migrations 0009/0011 confirmed Assessment,
AssessmentControl, AssessmentResponse, ControlTest, and EvidenceLink
were already fully frozen by Milestone 5/6's own existing triggers the
moment `status` becomes `finalized`, dormant only because nothing ever
set that status before this slice (DECISIONS.md R-118). Migration 0025
narrows the pre-existing, previously-unused `assessments_update` RLS
policy so only an `assessment.finalize` holder may perform the
transition — closing a real, live gap this slice's own testing
confirmed (any engagement member could otherwise raw-SQL flip the
status). No completeness requirement, no reopening path, and no new
`finalized_at`/`finalized_by` columns — none is documented anywhere in
the product's own specification, and `updated_at`/`updated_by` already
serve as a permanent record of who/when by construction, since the
finalizing transition is guaranteed to be the row's own last update
ever (DECISIONS.md R-119). Risk/Finding/Remediation/Validation all
remain fully editable after finalization, tested directly end to end —
no trigger anywhere connects Assessment finalization to any of them.
This slice's own testing also caught and fixed a real, narrow,
pre-existing bug: `unlinkEvidence` failed to translate a `.delete()`-
time trigger exception into a clean error (DECISIONS.md R-120). 691
tests pass (60 files, +24 new in
`tests/app/assessment-finalization.test.ts`), run twice for stability,
zero regressions. Per explicit instruction, no Maturity, Reporting,
Client Portal, evidence download, Engagement editing, ROPA, AI,
billing, reopening, comparison, previous-assessment workflows, new
approval/sign-off, notifications, or digital signatures. Full details
in the "Slice C7.3" section below. STOP after C7.3 per explicit
instruction.

## Slice C7.3 — Assessment Finalization (Session 26, 2026-09-01)

**Scope:** exactly what the C7.3 brief instructed — a clear,
enforceable lifecycle boundary between an editable Assessment and a
finalized one. Explicitly NOT built this slice, per instruction:
Maturity, Reporting, Client Portal, evidence download, Engagement
editing, ROPA/Data Landscape, AI, billing, reopening (unless the model
required it — it doesn't), Assessment comparison, previous-assessment
workflows, a new approval/sign-off workflow, notifications/email,
digital signatures.

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`, every
Assessment-adjacent schema file, migrations 0008/0009/0011 in full,
the existing Assessment domain module/workspace/Server Actions, the
existing role/permission model (`hasEngagementPermission`,
`requireEngagementMembershipManageAccess`, C7.2's own authorization
helpers), and existing Assessment/audit tests fresh from disk before
writing anything, per instruction.

### 1. Existing Assessment lifecycle model discovered

`assessments.status`: exactly two values, `draft`/`finalized`
(`assessment_status` enum) — no four-state draft/in-progress/under-
review/finalized workflow exists anywhere, confirmed by DATA_MODEL.md
§6's own explicit clarification ("'in progress' is simply an Assessment
that is still DRAFT"). `previous_assessment_id` exists but is read/
written by no application code anywhere (before or after this slice).
Milestone 5/6's own security migrations (0009/0011) already carry five
triggers that together fully freeze every Assessment-owned record the
instant `status = 'finalized'`:
`assessments_prevent_finalized_tampering` (the Assessment row itself —
ANY update, even a no-op, once already finalized),
`assessment_controls_enforce_draft_mutable` (INSERT/DELETE),
`assessment_responses_enforce_draft_mutable` (INSERT/UPDATE/DELETE),
`control_tests_enforce_draft_mutable` (INSERT/UPDATE/DELETE, only when
`assessment_id IS NOT NULL`), and `enforce_evidence_link_draft_mutable`
(INSERT/DELETE, for `assessment_response`/`control_test` subjects) —
all re-verified fresh by direct migration inspection this slice, not
assumed from a prior report. Before this slice, no application code
anywhere ever issued an UPDATE against `assessments` at all — these
triggers had existed, fully built and RLS-enabled, entirely dormant,
since Milestone 5.

### 2. Finalization authority

PRODUCT_UX_BLUEPRINT.md §8's own permission-mapping table: "Engagement
Manager additionally gets finalize/membership-manage" — an explicit,
unambiguous statement. `membership.manage` already received its own
dedicated permission key in Slice C7.2; the identical treatment is
applied here for "finalize" (DECISIONS.md R-117) rather than folding it
into the existing, differently-scoped `engagement.manage`. `db/seed/
roles.ts` gains one new permission row, `assessment.finalize`, granted
to Engagement Manager (and Platform Administrator, matching that role's
existing "holds every permission" pattern) — additive seed data only,
no schema change.

### 3. Completeness / semantics / metadata / reopening

No completeness precondition is documented anywhere — grepped fresh
across every product document, confirmed absent — so none is enforced;
an Assessment with zero recorded responses can be finalized exactly as
validly as a fully-answered one, tested directly. DATA_MODEL.md §6 and
PRODUCT_SPEC.md principle 6 both explicitly frame finalization as
one-way ("corrections create a new assessment period rather than
rewriting history") — no reopening path was built, matching the
documented model rather than going beyond it. No `finalized_at`/
`finalized_by` columns were added — `updated_at`/`updated_by`, set on
this exact transition, already serve that purpose permanently, since
`assessments_prevent_finalized_tampering` guarantees this transition is
the row's own last update ever; `audit_log` independently records the
same fact a second way (DECISIONS.md R-119).

### 4. The transition itself

`finalizeAssessment` (`lib/domain/assessments.ts`): Browser → Server
Action (`finalizeAssessmentAction`, added to the existing Assessment
workspace's own `actions.ts`) → authenticate → load the authoritative
Assessment → derive its Engagement/Organisation → `requireAssessment
FinalizeAccess` → pre-check current status (a clean
`AssessmentFinalizedError` if already finalized, reusing the existing
error class rather than inventing a parallel one) → the one UPDATE →
audit (existing `assessments_audit_log` trigger, unchanged) → redirect.
No browser-supplied `status`, tenant/organisation/engagement id, or
actor id is ever trusted — every value is re-derived from the
Assessment's own authoritative row or the caller's own session.

### 5. RLS narrowing — migration 0025

The pre-existing `assessments_update` policy (`WITH CHECK
(can_access_engagement(...))` alone, unused by any application code
since Milestone 5) is narrowed: transitioning a row's `status` to
`finalized` additionally requires `assessment.finalize` (via the
identical `has_engagement_permission`/`has_organisation_permission`
mechanism Slice C7.2 already built, applied to the new permission key).
This closes a real, live gap this slice's own testing confirmed: before
this migration, any engagement member could raw-SQL flip an
Assessment's status, bypassing the new application-layer check
entirely (DECISIONS.md R-118). No GRANT change (UPDATE was already
granted since migration 0009); no new audit trigger (the existing one
already fires on UPDATE).

### 6. Downstream continuity, proven not assumed

A dedicated test builds a full Risk→Finding→Remediation→Validation
chain from a real Assessment, finalizes the Assessment, then performs a
genuine update/create on all four downstream layers — every one
succeeds. A second test independently confirms, by direct
`information_schema.triggers` inspection, that no trigger anywhere
references Assessment finalization for `risks`/`findings`/
`remediation_actions`/`validation_records`.

### 7. A real bug found and fixed: `unlinkEvidence`'s error translation

Direct testing this slice — attempting to unlink evidence from a
finalized Assessment's control, the exact scenario `unlinkEvidence`'s
own pre-existing docstring already described but had never actually
been exercised against, since nothing could reach `finalized` before
this slice — found that drizzle-orm's node-postgres driver wraps a
`.delete()` failure's real Postgres message on `err.cause`, not
`err.message` itself, unlike the `.insert()`/`.update()` failures this
project's other, identically-shaped catches translate correctly. Fixed
with a small, narrowly-scoped `errorMessageIncludes` helper checking
both (DECISIONS.md R-120) — without this fix, a consultant would have
seen a raw database error instead of the same clean
`AssessmentFinalizedError` every other write path already shows.

### 8. UI

The existing Assessment workspace page already disabled every edit
form (response, control test, evidence upload/review/unlink) once
`status = 'finalized'` — built proactively in Slices C1/C2, long before
finalization was ever reachable. This slice adds: the Finalize control
itself (a `<details>` reveal with an explicit, permanent-consequence
warning, gated server-side on `canFinalizeAssessment` and re-checked
independently by the Server Action regardless of what the page
rendered) and an updated finalized-state banner naming exactly what's
locked. No new route — everything lives on the existing workspace URL.

### 9. Test results

`tests/app/assessment-finalization.test.ts` (new, 24 tests) — 24/24
passing standalone, covering happy path, authorization (including
Client Administrator, who does NOT hold `assessment.finalize`),
tenant/organisation/engagement forgery, state-transition idempotency,
immutability for all five protected record types (both via the real
domain functions and direct raw SQL), downstream continuity, audit
attribution, revoked-member access loss, and two standalone raw-SQL
security invariants. Full `tests/app` — 321/321 passing (15 files), no
regressions (including `evidence.test.ts`, unaffected by the
`unlinkEvidence` fix). Full `npm run test:db` — **60 test files, 691
tests, all passing**, run twice for stability, identical both times.
`npm run typecheck` clean. `npx eslint .` clean. `npm run build`
succeeds. Browser bundle grepped for service-role/database-credential
strings — none found.

### 10. What was NOT built (explicit STOP boundaries honored)

No reopening, no Assessment comparison, no previous-assessment
carry-forward UI, no new approval/sign-off workflow beyond the single
Finalize action, no notifications/email, no digital signatures, no
Maturity, no Reporting, no Client Portal, no evidence download, no
Engagement editing, no ROPA, no AI, no billing.

### 11. Recommended next slice

Per the C7 review's own ordered sequence, C7.1/C7.2/C7.3 together close
every P0 gap the review identified in the core Assessment→Risk→
Finding→Remediation→Validation loop — the loop is now genuinely
reachable and enforceable end to end by a real consultant without any
database script. The remaining C7.x items the review named
(C7.4 — Evidence Download reachability, C7.5 — Engagement Editing) are
smaller, non-P0 polish; beyond those, the C7 review's own broader
finding (Data Landscape/ROPA/Client Master Data/Reports/Client Portal
still absent relative to the full original MVP definition) remains the
larger, still-open sequencing question for the user to decide. This
report does not preempt that choice.

## Slice C7.2 — Engagement Membership Management (Session 25, 2026-09-01)

**Scope:** exactly what the C7.2 brief instructed — the second P0 fix
the C7 review identified: Engagement → Members → Add existing user →
assign engagement role → revoke membership, managing EXISTING
authenticated users only. Explicitly NOT built this slice, per
instruction: Client Portal, Assessment finalization, evidence download,
Engagement editing, Maturity, Reporting, ROPA/Data Landscape, AI,
billing, invitation/email workflows, user registration, organisation-
wide user administration.

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`,
`db/schema/{users,organisations,engagements,memberships,roles}.ts`,
the authorization service, `lib/domain/{roles,organisations,
engagements}.ts`, every membership-related RLS policy (migrations
0001, 0019), existing membership tests
(`tests/app/engagement-onboarding.test.ts`,
`tests/rls/membership-boundaries.test.ts`), the Organisation and
Engagement detail pages, existing Server Actions, and the audit
triggers on the membership tables fresh from disk before writing
anything, per instruction.

### 1. Existing membership architecture discovered

Three parallel membership tables (`tenant_memberships`,
`organisation_memberships`, `engagement_memberships`, migration 0000):
each a plain `user_id`/scope-id/`role_id`/`status` junction, with a
**partial unique index on the active row per (user, scope)** — "at most
one ACTIVE membership per user per scope, but a revoke-then-regrant is
a new row, never an overwrite." `status` is `membership_status`
(`active`/`revoked` only) — confirms soft deactivation, not hard
delete, as the model's own intended lifecycle (instructions §4). Before
this slice, `engagement_memberships` had a SELECT policy (migration
0001) and an INSERT policy scoped to engagement-creation-time
onboarding only (migration 0019) — no UPDATE policy at all. `users`
(migration 0000): `tenant_id` NOT NULL, exactly one home tenant per
user (no multi-tenant users); `client_org_id` nullable — NULL for
PRIMUS-side (tenant-wide) users, set for client-side users belonging to
exactly one client Organisation. `roles.scope` ∈ {tenant, organisation,
engagement} — a role is only ever meant to be granted via the
membership table matching its own scope (`roles.ts`'s own schema
comment). `db/seed/roles.ts` already grants `membership.manage` to
Engagement Manager (engagement-scope) and Client Administrator
(organisation-scope) — the single most consequential discovery this
slice made, since it directly answers instructions §3's authorization
question without needing a STOP.

### 2. Membership-management authorization rule

`canManageEngagementMembership` (new, `lib/authorization/service.ts`):
the caller holds `membership.manage` via an active EngagementMembership
on this specific engagement, OR via an active OrganisationMembership on
the engagement's own organisation. The first fine-grained Role/
Permission check in this codebase — resolved from the repository's own
already-seeded grant, not invented (DECISIONS.md R-114). Migration 0024
extends the RLS layer to match: the existing `engagement_memberships_
insert` policy gains an additive OR-clause (permission-based), and a
brand-new UPDATE policy (previously absent) is gated on the permission
check alone.

### 3. Eligible-user rule

A candidate is eligible for Engagement E (tenant T, organisation O) if:
same tenant (`users.tenant_id = T`), account `status = 'active'`, and
either `client_org_id IS NULL` (a PRIMUS-side, tenant-wide consultant —
eligible for any engagement in the practice, preserving the existing,
intended cross-organisation consultant-staffing architecture per
SECURITY.md §3) or `client_org_id = O` (a client-side user belonging to
this exact client organisation — never another one). Resolved entirely
from `users.tenant_id`/`users.client_org_id`'s own documented meaning
(`users.ts`'s own file comment), never invented, and never requiring a
pre-existing OrganisationMembership (DATA_MODEL.md §2 names no such
dependency between the three independent membership M2M
relationships).

### 4. A real gap this slice's own testing discovered: candidate/revoked-member visibility

Not assumed from a prior report — found by running the tests: `users_
select`'s own RLS policy (`id = auth.uid() OR shares_membership_
scope(id)`, migration 0001) makes a candidate user who shares no
membership with the caller — precisely the case this feature exists to
solve — invisible to an ordinary query. The identical mechanism also
makes a REVOKED member's own identity disappear from an ordinary roster
JOIN, since `shares_membership_scope` requires both sides' membership
to be active. Fixed with three new, narrowly-gated SECURITY DEFINER
functions (`eligible_engagement_members`, `resolve_membership_
candidate`, `engagement_membership_roster`, migration 0024) — the same
resolver-function pattern this codebase already uses twice (migrations
0001, 0019), each independently re-checking the caller's own
authorization internally before returning any row, never a widening of
`users_select` itself (DECISIONS.md R-115).

### 5. Add-member / Revoke workflows

`addEngagementMember`: Browser → Server Action
(`addEngagementMemberAction`, new `engagements/[engagementId]/
actions.ts`) → authenticate → load the authoritative Engagement →
`requireEngagementMembershipManageAccess` → validate the role (must be
`scope = 'engagement'`, rejecting a Tenant- or Organisation-scoped role
id with a clean error) → validate the target user's eligibility via
`resolve_membership_candidate` → duplicate pre-check → insert → audit
(existing `engagement_memberships_audit_log` trigger) → redirect.
`revokeEngagementMember`: loads the membership row → derives its
Engagement → `requireEngagementMembershipManageAccess` → a plain
`status = 'revoked'` UPDATE (idempotent if already revoked) → the same
existing audit trigger (already fires on UPDATE too, confirmed —
migration 0019). Neither trusts a browser-supplied `organisationId`
beyond cross-checking it against the Engagement's own authoritative
row.

### 6. Role assignment

Only `Role` rows with `scope = 'engagement'` may be assigned — server-
validated (`InvalidEngagementRoleError`), never trusting a browser-
supplied role id; the Add Member form's own dropdown is sourced from
`listEngagementRoles` (roles filtered to `scope = 'engagement'` only),
so a Tenant- or Organisation-scoped role never even appears as an
option.

### 7. Self-protection

No invariant ("at least one manager," "cannot revoke self," "cannot
revoke another manager") exists anywhere in DATA_MODEL.md/SECURITY.md/
PRODUCT_SPEC.md/PRODUCT_UX_BLUEPRINT.md/DECISIONS.md — grepped fresh
this slice, confirmed absent. Per instructions §8's own explicit
fallback, none is invented: any authorized manager may revoke any
member, including themselves, tested directly (DECISIONS.md R-116). No
"change role" feature was built — the brief's own workflow shape lists
only Add and Revoke.

### 8. Duplicate handling

The existing partial unique index
(`engagement_memberships_active_user_engagement_key`) already makes a
second ACTIVE membership for the same (user, engagement) pair database-
impossible; `addEngagementMember` pre-checks it for a clean
`DuplicateMembershipError`, then also catches the constraint violation
as a fallback. A revoked-then-re-added membership succeeds as a genuine
new row, leaving the earlier revoked row's own history untouched —
tested directly.

### 9. Database inspection

`psql \d+ engagement_memberships` confirmed: the new additive INSERT
OR-clause, the new UPDATE policy, the new `engagement_memberships_
prevent_reparenting` trigger, and the pre-existing `engagement_
memberships_audit_log` trigger (unchanged, already covers UPDATE) —
all exactly as designed. GRANTs confirmed: `authenticated` now has
INSERT/SELECT/UPDATE (still no DELETE) on `engagement_memberships`;
`organisation_memberships` remains untouched (INSERT/SELECT only, no
UPDATE) — confirming no organisation-membership administration was
built, per instruction §18. All three new SECURITY DEFINER functions'
EXECUTE grants confirmed correct (`authenticated`/`service_role` only).

### 10. Test results

`tests/app/engagement-membership.test.ts` (new, 30 tests) — 30/30
passing standalone, covering all 19 required scenarios (authorization,
tenant isolation, eligibility, roles, duplicates, revoke, access,
audit) plus eligibility-list correctness, idempotent revoke,
self-revocation, the reparenting guard, and roster visibility across
revoked members. Full `tests/app` — 297/297 passing (14 files),
including the pre-existing `engagement-onboarding.test.ts` (26/26
unchanged) — confirming migration 0024's additive RLS extension broke
nothing. Full `npm run test:db` — **59 test files, 667 tests, all
passing**, run twice for stability with identical counts both times.
`npm run typecheck` clean. `npx eslint .` clean. `npm run build`
succeeds. Browser bundle grepped for service-role/database-credential
strings — none found (this slice adds no client-side code or new env
var usage).

### 11. What was NOT built (explicit STOP boundaries honored)

No invitation/email workflow, no user registration, no organisation-
wide user-administration UI (only what eligibility resolution strictly
needed, reusing the existing `organisation_memberships` table, never a
new admin screen for it), no Client Portal, no Assessment finalization,
no evidence download, no Engagement editing, no Maturity, no Reporting,
no ROPA, no AI, no billing, no "change member role" feature.

### 12. Recommended next slice

Per the C7 review's own ordered sequence: **C7.3 — Assessment
Finalization**, gated on the caller's `Engagement Manager` role — the
data for this already exists on every `engagement_memberships` row
(confirmed by the C7 review itself) and this slice's own new
`hasEngagementPermission` mechanism is directly reusable for it. This
report does not preempt the user's own choice of which C7.x slice to
authorize next.

## Slice C7.1 — Assessment Creation & Control Population (Session 24, 2026-09-01)

**Scope:** exactly what the C7.1 brief instructed — the single P0 fix
the C7 review identified: Organisation → Engagement → Create Assessment
→ Assessment automatically populated with the Engagement's pinned
Control Library → Assessment Workspace → Responses/Tests/Evidence →
Risk → Finding → Remediation → Validation, all reachable through the
real application, no fixture/database-script intervention. Explicitly
NOT built this slice, per instruction: engagement membership management
(C7.2), Assessment finalization (C7.3), evidence download (C7.4),
engagement editing (C7.5), Client Portal, Reporting, Maturity, Data
Landscape/ROPA, AI, billing.

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`,
`db/schema/{assessments,assessment-controls,engagements,control-library}.ts`,
the existing Assessment/Engagement domain functions, the authorization
service, the Assessment workspace routes, the existing assessment
tests, migrations 0008/0009 (Assessment Engine + its security layer),
and the Control Library lifecycle fresh from disk before writing
anything, per instruction — not relying on the C7 review's own prior
report for anything beyond "where to look."

### 1. Existing Assessment/AssessmentControl architecture discovered

`assessments` (DATA_MODEL.md §6, migration 0008): `engagement_id`,
denormalized `organisation_id`/`tenant_id`, `control_library_version_id`
(NOT NULL — an Assessment cannot be created at all for an Engagement
with no pinned library, since the composite FK requires the Engagement's
own `(id, control_library_version_id)` pair to already exist),
`assessment_type` (the existing 5-value enum: control_readiness/
annual/dpia/sdf_screening/third_party), `period_label` (plain text, no
format constraint in the schema), `status` (draft/finalized, defaults
draft), `previous_assessment_id` (nullable, self-referential, never
read or written by any existing application code). `assessment_controls`
(migration 0008): a plain, insert/delete-only junction, carrying no
state of its own beyond which Control is in scope, protected by two
composite FKs (`assessment_controls_assessment_scope_fk` proving the
row's own tenant/organisation/engagement/library-version all match its
Assessment's; `assessment_controls_control_library_version_fk` proving
the referenced Control genuinely belongs to that same library version)
that together make a cross-tenant or cross-library AssessmentControl
database-impossible to insert, by construction — confirmed fresh via
`psql` and a dedicated raw-SQL test this slice, not assumed from a
prior report. No genuine discrepancy was found between DATA_MODEL.md
and the actual schema.

### 2. The five sub-questions (instructions §2), answered from the repo

**A. Assessment creation:** the schema already supports creation,
draft status (default), assessment type (existing 5-value enum),
period label (plain text), previous-assessment linkage (column exists,
never used by any code), and control-library pinning (a NOT NULL
composite FK to the Engagement's own pin) — nothing missing at the
schema level; only the application function was missing.

**B. AssessmentControl population:** resolved definitively — every
Control in the Engagement's pinned ControlLibraryVersion becomes an
AssessmentControl. No applicability mechanism exists to exclude
controls (`ApplicabilityDetermination` is `[NOT YET BUILT]`, and even
if built has no documented relationship to Control/AssessmentControl
at all — it concerns RegulatoryReference applicability, a different
question). No manual-selection mechanism is documented anywhere.
PRODUCT_UX_BLUEPRINT.md §12 step 4 independently confirms this exact
shape ("AssessmentControl scoped from the pinned library"). See
DECISIONS.md R-113.

**C. Assessment type:** the existing enum used exactly — no new type
added, all 5 values offered in the creation form's dropdown (dpia/
sdf_screening included as legitimate enum values, even though their
own specialized DPIA/SDFScreeningDetail workflows remain unbuilt —
DATA_MODEL.md §7 already frames these types as "specializations of
Assessment," not disconnected modules, so offering the type value
itself invents nothing).

**D. Period label:** no format/validation rule is named anywhere in
the schema or product documents beyond "text, required" — the form
requires a non-empty string (1-100 characters), no date-format
invented.

**E. Previous assessment:** left entirely alone — no application code
anywhere (before or after this slice) reads or writes this column, so
this slice's own creation form does not expose it, per instruction not
to invent carry-forward/correction-selection semantics the repository
doesn't already define.

### 3. Assessment creation authorization

`assessments_insert`'s own RLS `WITH CHECK` (migration 0009) is
`can_access_engagement(engagement_id, organisation_id)` — the exact
same rule `requireEngagementAccess` already implements and every other
`create*` function in this codebase (Risk/Finding/RemediationAction/
ValidationRecord) already uses. This was not an undefined permission
model requiring a STOP — the schema already encodes the answer, and
`createAssessment` uses it unchanged, inventing no new role or
narrower gate.

### 4. Creation workflow

`lib/domain/assessments.ts`'s `createAssessment`: Browser → Server
Action (`createAssessmentAction`, new file `assessments/actions.ts`) →
authenticate → `requireEngagementAccess` (derived from the Engagement's
own row, never the browser's claim) → validate (Zod at the Server
Action layer, this function's own TypeScript input type as the second
layer) → load the authoritative Engagement row → derive tenant/
organisation/pinned-library server-side → reject cleanly if no library
is pinned (`NoControlLibraryPinnedError`) → insert `assessments` →
batch-insert `assessment_controls` for every Control in the pinned
library (one query to read the Control set, one batched INSERT to
write it — never one insert per Control) → both inserts in the SAME
`withRequestDb` transaction (mirrors `createRemediationAction`'s own
two-insert shape) → audit (existing `assessments_audit_log`/
`assessment_controls_audit_log` triggers — no new audit mechanism) →
redirect to the new Assessment's own workspace route.

### 5. Assessment form

A minimal form at `.../assessments/new`: Assessment Type (select, all
5 existing enum values), Period (text input, required). No methodology
selector — the pinned control library is shown read-only, sourced from
the Engagement. If the Engagement has no library pinned, the form is
replaced entirely by an explanatory message (no submit path that would
only fail server-side). Reachable from a "Create Assessment" button
always visible on the Assessments list page (both populated and empty
states) and from the Engagement detail page's own empty-state message
— never a URL the user has to construct.

### 6. Library-version integrity / AssessmentControl security

No new consistency mechanism was added. `assessments_engagement_
control_library_version_fk` and `assessment_controls_assessment_
scope_fk`/`assessment_controls_control_library_version_fk` (all
migration 0008, pre-existing) already make it database-impossible for
an Assessment to disagree with its Engagement's pin, or for an
AssessmentControl to reference a Control outside the Assessment's own
pinned library version — re-verified fresh via `psql \d+` and two
dedicated raw-SQL security tests this slice (a cross-library Control
reference, and a forged-scope AssessmentControl), both rejected with
the exact expected constraint names. No new migration was required —
confirmed by a fresh `reset-test-db.ts` run still applying exactly 24
migration files, the same count as before this slice.

### 7. Historical control-set / snapshot integrity

Verified directly: an Assessment's AssessmentControls are materialized
once, at creation, from the pinned library version's Control set as it
exists at that moment; nothing anywhere in the codebase re-joins
against `controls` for an already-created Assessment. A dedicated test
creates a baseline Assessment against Library v1 (3 controls), then
creates a wholly separate Library v2 (4 new Control rows, since a new
library version's controls are new rows per DECISIONS.md R-42, not a
mutation of v1's own frozen set) and a second Assessment against a
second Engagement pinned to v2 — confirms the original Assessment's
control set is completely unaffected (still exactly its original 3,
never acquiring the 4th), while the new Assessment correctly gets all
4 of v2's own controls.

### 8. Test results

`tests/app/assessment-creation.test.ts` (new, 22 tests) — 22/22 passing
standalone, covering creation, population, security (tenant/
organisation/engagement isolation, anonymous rejection, cross-library
rejection, forged-scope AssessmentControl rejection), transactionality
(a manually-reproduced failed-population scenario proving no orphan
Assessment survives a rolled-back transaction), historical/snapshot
integrity, workspace reachability, and audit attribution. Full
`tests/app` — 267/267 passing (13 files, no regressions). Full `npm
run test:db` (fresh reset + entire suite) — **58 test files, 637
tests, all passing**, run twice for stability with identical counts
both times. `npm run typecheck` clean. `npx eslint .` clean, zero
warnings. `npm run build` succeeds — the new `.../assessments/new`
route compiles and appears in the route manifest alongside every
existing route.

### 9. What was NOT built (explicit STOP boundaries honored)

No engagement membership management, no Assessment finalization, no
evidence download extension, no Engagement editing, no Maturity, no
Client Portal, no Reporting, no Data Landscape/ROPA, no AI, no
billing — none of these appear anywhere in this slice's diff. The
`previous_assessment_id` field remains entirely unexposed in the UI
(§2E above). No duplicate-Assessment check was added (the schema
permits duplicates; none of the product documents require blocking
them).

### 10. Recommended next slice

Per the C7 review's own ordered sequence: **C7.2 — Engagement
membership management**, the second P0 finding (no way to add a second
user to an Engagement or Organisation without a database script) —
still open, still blocking any real multi-person or client-involving
engagement. This report does not preempt the user's own choice of
which C7.x slice to authorize next.

## Slice C6 — Validation (Session 23, 2026-09-01)

**Scope:** exactly what PHASE C — VALIDATION / Slice C6 instructed —
turn the existing (Milestone 7, database-only) ValidationRecord model
into a real, traceable consultant workflow: RemediationAction → Create
Validation → authenticate → authorize → validate → persist → audit →
show Validation, embedded in the RemediationAction detail page. No
Maturity, Client Portal, Reporting, or AI UI anywhere in this slice's
changes. No reassessment-linking UI (`triggers_control_test_id`/
`triggers_assessment_response_id` remain read-only, per
PRODUCT_UX_BLUEPRINT.md's own "later link reassessment" framing —
DECISIONS.md R-111). No standalone Validation route (blueprint's own
"not a top-level screen" — DECISIONS.md R-112). No automatic
`remediation_actions.status` transition on validation (DECISIONS.md
R-108).

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`, the
ValidationRecord/RemediationAction/Finding/Risk/Assessment/Evidence
schemas, the existing authorization service, the Remediation domain
(`lib/domain/remediation.ts`), the Evidence domain
(`lib/domain/evidence.ts`), the RemediationAction detail page, existing
UI components, existing tests, and every relevant migration fresh from
disk before writing anything, per instruction.

### 1. Existing Validation architecture discovered

`validation_records` (DATA_MODEL.md §8, migrations 0012/0013):
`remediation_action_id` (the ONLY subject FK — attached to
RemediationAction alone, never directly to Finding/Risk/Assessment),
`tenant_id`/`organisation_id`/`engagement_id` (denormalized from the
owning RemediationAction), `validated_by` (found unprotected — item
15), `validated_at` (timestamptz, defaults `now()`), `outcome`
(`validation_outcome` enum: `accepted`/`rejected` only — no third
value), `rationale` (additive text, nullable), `triggers_control_test_id`/
`triggers_assessment_response_id` (two nullable FKs implementing the
single conceptual "reassessment trigger" DATA_MODEL.md describes — a
real FK can only target one table; at most one may be set, and only
when `outcome = 'accepted'`, both enforced by CHECK constraints),
`created_at`/`created_by`. Every decision field
(`remediation_action_id`/`tenant_id`/`organisation_id`/`engagement_id`/
`validated_by`/`validated_at`/`outcome`/`rationale`) is frozen after
creation by the existing `prevent_validation_record_tampering` trigger
(migration 0013, BEFORE UPDATE) — the sole exception is the two
reassessment-trigger columns, each settable exactly once from NULL.
Nothing in migration 0012/0013 connects `validation_records` to
`remediation_actions.status` — grepped directly, confirmed absent (item
6/DECISIONS.md R-108). No genuine discrepancy was found between
DATA_MODEL.md and the actual schema.

### 2. The 10 critical semantic questions (instructions §3), answered from the repo

1. **What does a ValidationRecord attach to?** RemediationAction only —
   `remediation_action_id` is its one subject FK; no direct Finding/Risk/
   Assessment column exists.
2. **What makes a RemediationAction "considered validated"?** Nothing
   automatic at the database level — no trigger, no generated column,
   no view computes this from `validation_records`. It is purely a
   human read of the history a consultant chooses to act on via a
   separate, explicit `updateRemediationAction` status change.
3. **Does the record carry the final decision, or is it derived
   later?** The record itself is the final decision — `outcome` is set
   at creation and immutable afterward; nothing derives it from
   elsewhere.
4. **How does Evidence relate to Validation?** Only indirectly via
   EvidenceLink's `validation_record` subject type (item 5) — no direct
   column on `validation_records` itself.
5. **Is the record mutable at all?** No, except the two
   once-settable reassessment-trigger columns (item 1).
6. **Are multiple validations per RemediationAction expected?** Yes —
   nothing limits a RemediationAction to one ValidationRecord;
   PRODUCT_UX_BLUEPRINT.md itself frames correction as "record a new
   validation," not "edit the existing one."
7. **Does creating a ValidationRecord change RemediationAction.status?**
   No — no trigger connects them (item 1/DECISIONS.md R-108).
8. **Is validation self-only or does it need a validator picker?**
   Self-only, matching `respondentId`/`testerId`/`ownerUserId`'s
   identical established pattern (re-verified by grep before writing
   any code).
9. **Is closure a separate concept or implied by status?** Implied
   only — `remediation_action_status`'s `closed` value is the only
   representation; no separate "closure" table/column/event exists.
10. **Is there a standalone Validation screen in the UX blueprint?**
    No — row #16 explicitly says "not a top-level screen."

No STOP condition was triggered for any of these — each resolved
unambiguously from direct schema/migration/blueprint inspection.

### 3. Validation creation workflow

`lib/domain/validation.ts`'s `createValidationRecord`: Browser → Server
Action (`createValidationRecordAction`, added to the RemediationAction
detail page's own `actions.ts`) → authenticate → look up the
RemediationAction's own authoritative row → `requireEngagementAccess` →
validate (`outcome` is one of the two real enum values; `rationale`
required if `outcome = 'rejected'`, reusing Slice C2's
`ReviewRationaleRequiredError` precedent as
`ValidationRationaleRequiredError`) → insert `validation_records`
(`validatedBy` always the acting user; `validatedAt`/`outcome`/
`rationale` as given; the two reassessment-trigger columns always left
NULL — item 4 below) → PostgreSQL (one transaction, one insert) → RLS →
audit (existing `validation_records_audit_log` trigger — no new audit
mechanism) → `revalidatePath`/redirect back to the RemediationAction
detail page. Mirrors `createRemediationAction`'s (Slice C5) exact
shape: only `remediationActionId` identifies the source context;
tenant/organisation/engagement scope is always re-derived server-side
from the RemediationAction's own authoritative row, never trusted from
the caller (instructions §4/§10).

### 4. Reassessment-trigger columns: not set by this slice

`createValidationRecord` never sets `triggers_control_test_id`/
`triggers_assessment_response_id` — PRODUCT_UX_BLUEPRINT.md's own
"later link reassessment" language marks this as intentionally future
work, and instructions §12 forbid inventing auto-reopen/cascade
behavior beyond what's explicit (DECISIONS.md R-111). The
RemediationAction detail page's validation-history list does show,
read-only, whether a record has either column set ("Reassessment
recorded against this validation"), honestly reflecting the current
row rather than assuming it's always empty — but nothing in this
slice's UI can set them.

### 5. Evidence ↔ ValidationRecord relationship

`evidence_links` has carried a genuine, fully-built `validation_record`
subject type (column, CHECK-constraint branch, composite scope FK)
since Milestone 7 — the fourth and final EvidenceLink subject type this
schema defines, alongside `assessment_response`/`control_test`
(Slice C2) and `remediation_action` (Slice C5). `lib/domain/
evidence.ts`'s `LinkTarget` union and `resolveLinkSubject` were
extended with this fourth case (DECISIONS.md R-110); the two
`evidenceLinks.insert()` call sites (`uploadEvidence`/
`createEvidenceForVersion`) now pass `validationRecordId` through. New
read functions `getEvidenceSummaryForValidationRecord` (single record)
and `getEvidenceSummaryForValidationRecords` (batched, `inArray`) mirror
`getEvidenceSummaryForRemediationAction`'s exact shape — the batched
variant exists specifically so the RemediationAction detail page's full
validation-history-plus-evidence render issues one query total, not one
per record (instructions §32, no N+1). Assessment finalization is
structurally not applicable (ValidationRecord has no Assessment
relationship at all), so the `validation_record` branch returns
`assessmentStatus: null`, identical to the `remediation_action`
branch's own established conclusion. The RemediationAction detail
page's Validation section shows each history record's own evidence
inline, plus a per-record "Add evidence to this validation" form
(`uploadValidationEvidenceAction`) — only reachable once the record
already exists, since `evidence_links_validation_record_scope_fk`
requires a real `validation_record_id`.

### 6. Validator (`validated_by`) tenant-scoping — migration 0023

Direct inspection found `validation_records.validated_by` in the exact
same unprotected shape `risks.owner_id`/`findings.owner_id`/
`remediation_actions.owner_id` were in before their own fixes — a
plain `validated_by → users(id)` FK, no tenant consistency check.
Migration `0023_validation_record_validator_tenant_scoping.sql` applies
the identical fix a fourth time: drops the plain FK, adds a composite
`validation_records_validated_by_tenant_fk (validated_by, tenant_id) →
users(id, tenant_id)`, reusing the same `users_id_tenant_id_key`
constraint migration 0020 already added — no new supporting constraint,
no RLS/GRANT/audit-trigger change, no other table touched
(DECISIONS.md R-107). `db/schema/validation-records.ts` was updated to
match. Applied and verified via `psql \d+ validation_records` — the new
FK is present, the old plain FK is gone, `evidence_links_validation_
record_scope_fk` still correctly references the table. **Correction to
the record:** Slice C5's own PROGRESS.md/DATA_MODEL.md entries describe
`remediation_actions.owner_id`'s fix as "the third and... final
instance of this pattern." That was inaccurate — this is a fourth
instance. The C5 entries are left as originally written (never silently
rewritten); this slice's own DATA_MODEL.md and DECISIONS.md entries
carry the honest forward correction instead.

### 7. Historical integrity (instructions §21) — the primary C6 requirement

Directly tested (`tests/app/validation.test.ts`, "21/28" test): a
ValidationRecord (`V1`) is created against a RemediationAction; the
RemediationAction's own `status`/`title` are then changed via direct
SQL, well after `V1` was recorded; a full snapshot of `V1` taken before
and after that state change is asserted byte-for-byte identical. A
second test confirms a *rejected* ValidationRecord's `outcome` cannot
later be silently flipped to `accepted` via direct SQL. Both rely on
the pre-existing `prevent_validation_record_tampering` trigger
(migration 0013) — this slice added no new immutability mechanism,
only proved the existing one holds under the exact "create, then change
other things, then verify the record is unchanged" scenario the
instructions describe.

### 8. Remediation-status test (instructions §29) — no silent mutation

A dedicated test creates a ValidationRecord and asserts
`remediation_actions.status` is byte-identical before and after —
then, independently, queries `information_schema.triggers` for every
trigger on `remediation_actions` and asserts none matches
`/validat/i`, the definitive schema-level proof rather than an
inference from one row's behavior.

### 9. Multiple-validation test (instructions §27)

A dedicated test creates a rejected `V1` followed by an accepted `V2`
against the same RemediationAction, then confirms both remain fully
queryable via `listValidationRecordsForRemediation` (full history,
most recent first) and `getValidationRecordDetail` (each individually,
with its own correct `outcome`) — never collapsed, never overwritten.

### 10. Security tests (instructions §25) — 17 scenarios

All 17 implemented in `tests/app/validation.test.ts`, mirroring
`tests/app/remediation.test.ts`'s exact numbering/style: cross-tenant
read (1), cross-organisation read same tenant (2), cross-engagement
read same organisation (3), the same three for create (4-6), anonymous
access rejected for SELECT and INSERT (7), unauthorized (no
membership) create (8) and read (9), cross-tenant validator rejected on
INSERT (10) and UPDATE (10b), migration-0023 safety for NULL/same-
tenant validators (11b), self-validation-only proven structurally (11),
forged-scope raw INSERT rejected by RLS (12), forged-scope
Server-Action-shaped call rejected even with a real id (13), the
RemediationAction relationship cannot cross a tenant boundary via raw
SQL (14), the full chain stays tenant-safe end-to-end (15), no
status-linking trigger exists (16), and audit attribution identifies
the acting user (17).

### 11. Evidence linking verification (instructions §24)

A dedicated test uploads Evidence against Tenant A's own
ValidationRecord (succeeds) and then attempts the identical upload
against Tenant B's ValidationRecord using a Tenant A actor (rejected
with `NotFoundOrForbiddenError`, resolved inside `resolveLinkSubject`'s
tenant check before any insert is attempted).

### 12. Traceability test (instructions §26)

A dedicated test builds a fresh Assessment → Control → Risk → Finding →
Remediation → Validation → Evidence chain end-to-end through the real
domain functions, confirms every hop's detail read surfaces the next
(RemediationAction detail's own `validationRecords` includes the new
record; the ValidationRecord's own detail surfaces its source
RemediationAction and its own directly-linked Evidence), and confirms
Tenant B cannot traverse any part of it — not the ValidationRecord
detail, not the RemediationAction detail, and its own Evidence summary
for the ValidationRecord comes back empty rather than erroring for a
nonexistent-looking id.

### 13. Direct database inspection (instructions §30/§36)

`psql \d+ validation_records` confirmed: the new composite validator FK
present, the old plain FK gone, the `validation_records_remediation_
action_scope_fk`/`triggers_control_test_scope_fk`/`triggers_assessment_
response_scope_fk` composite FKs unchanged, RLS policies
(`validation_records_select`/`_insert`/`_update`) unchanged, GRANTs
unchanged (`authenticated` has INSERT/SELECT/UPDATE only — no DELETE),
`validation_records_prevent_tampering`/`validation_records_audit_log`
triggers unchanged. `evidence_links`'s `validation_record_id` CHECK
branch and its own composite scope FK confirmed present and correct.

A standalone raw-SQL attack demonstration, run OUTSIDE the vitest
suite against the same reset test database (a genuine `SET LOCAL ROLE
authenticated` + `set_config('request.jwt.claim.sub', ...)` session,
the identical mechanism the RLS test harness itself uses — never a
superuser bypass), attempted four real attacks using real fixture data
pulled from the database: (1) a cross-tenant `validated_by` INSERT —
rejected with `validation_records_validated_by_tenant_fk`; (2) a
cross-tenant ValidationRecord creation via forged scope columns —
rejected with `validation_records_remediation_action_scope_fk`; (3) a
plain cross-tenant SELECT — zero rows returned (RLS); (4) a
cross-tenant EvidenceLink pointed at another tenant's
`validation_record_id` — rejected with `evidence_links_validation_
record_scope_fk`. All four rejected exactly as expected.

### 14. Test results

`tests/app/validation.test.ts` — 33/33 passing standalone. Full
`tests/app` — 245/245 passing (12 files). Full `npm run test:db` (fresh
reset + entire suite) — **57 test files, 615 tests, all passing**, run
twice for stability with identical counts both times. `npm run
typecheck` clean. `npx eslint .` clean, zero warnings. `npm run build`
succeeds — production build compiles, all routes generate correctly,
including the extended RemediationAction detail route.

### 15. What was NOT built (explicit STOP boundaries honored)

No Maturity, no Client Portal, no Reporting, no AI — none of those four
appear anywhere in this slice's diff. No standalone Validation route
(DECISIONS.md R-112). No reassessment-linking UI (DECISIONS.md R-111).
No automatic RemediationAction status transition on validation
(DECISIONS.md R-108). No validator/user picker or directory — self-
validation-only preserved exactly as it already existed. No new
immutability mechanism — the existing Milestone-7 tampering trigger is
the entire enforcement, verified rather than duplicated.

## Slice C5 — Remediation Actions (Session 22, 2026-09-01)

**Scope:** exactly what PHASE C — REMEDIATION / Slice C5 instructed —
turn an existing Finding into a structured, traceable
RemediationAction, using the EXACT existing RemediationAction/
RemediationFinding/RemediationRisk/RemediationControl/ValidationRecord
model built (database-only) in Milestone 7 (migrations 0012/0013). No
Validation, Maturity, Client Portal, Reporting, or AI UI — none of
those exist anywhere in this slice's changes; any existing
`ValidationRecord` is displayed read-only, never created or approved.
No junction redesign — the one migration this slice made (0022)
hardens an existing column's referential integrity, the third and
(for this schema) final instance of an already twice-approved pattern.

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`, the
RemediationAction/Finding/Risk/Assessment/Evidence/ValidationRecord
schemas, the existing authorization service, the Finding domain
(`lib/domain/findings.ts`), the Risk domain (`lib/domain/risks.ts`),
the Assessment workspace, the Evidence implementation, existing UI
components, existing tests, and every relevant migration fresh from
disk before writing anything, per instruction.

### 1. Existing Remediation architecture discovered

`remediation_actions` (DATA_MODEL.md §8): `engagement_id`/
`organisation_id`/`tenant_id` (engagement-scoped, like `Risk`/
`Finding`), `title`, `description` (additive), `owner_id`, `due_date`
(a `date` column, not timestamp), `priority` (additive,
`remediation_priority` enum: low/medium/high/critical — the same
four-point scale `risk_rating`/`finding_severity` use, nullable),
`status` (`remediation_action_status`: DATA_MODEL.md §8's own verbatim
five-value set open/in_progress/evidence_submitted/validated/closed),
`completed_at` (additive, nullable timestamp, no trigger sets it — a
plain application-set column). `remediation_findings`/
`remediation_risks`/`remediation_controls` are plain insert/delete-only
junctions (RemediationAction N ←→ N Finding/Risk/Control —
DATA_MODEL.md §11). `validation_records` (read fully, though Validation
itself is out of scope) confirms `ValidationRecord.remediation_action_id`
is the one FK pointing back at `remediation_actions`, and that its
decision fields are permanently frozen after creation (a Milestone 7
trigger, unaffected by this slice). No genuine discrepancy was found
between DATA_MODEL.md and the actual schema. One consequential fact,
not a discrepancy, shaped this slice's most significant addition:
unlike Risk/Finding, `evidence_links` already has a fully-built
`remediation_action` subject type at the database layer (item 12/
DECISIONS.md R-106) — a genuine, direct Evidence relationship, not an
indirect one.

### 2. Remediation schema used

Used exactly as built — no field renamed, added, or repurposed beyond
the migration 0022 hardening (item 15). `remediation_findings`/
`remediation_risks`/`remediation_controls` are all real, but this
slice's own UI only ever creates a `remediation_findings` link at
creation time (instructions §4's own literal "Finding → Create
Remediation Action" framing) — `remediation_risks`/
`remediation_controls` are not populated by this slice (known
limitation, item 31).

### 3. Finding → Remediation relationship

Many-to-many via the EXISTING `remediation_findings` junction
(DATA_MODEL.md §8/§11: "RemediationAction N ←→ N Finding"). No
artificial "one RemediationAction per Finding" rule was imposed
(instructions §6) — nothing in the schema requires one.
`remediation_findings_finding_scope_fk`/`remediation_findings_
remediation_action_scope_fk` (migration 0012) already structurally
prove, by construction, that a RemediationFinding row's `finding_id`
and `remediation_action_id` share the exact same tenant/organisation/
engagement — a RemediationAction cannot be associated with a
cross-tenant/cross-organisation/cross-engagement Finding (instructions
§5) with no schema change needed for this part; directly re-verified
via `psql` (item 22) and a dedicated raw-SQL test (item 18, test 14).

### 4. Risk → Finding → Remediation traceability

Resolved by composing EXISTING functions at the page level, one layer
deeper than Finding detail's own composition (never duplicated data):
`getRemediationActionDetail` returns the RemediationAction's own fields
plus its linked source Finding(s); the RemediationAction detail PAGE
then calls the EXISTING `getFindingDetail` (Slice C4) with the primary
source Finding's id, which itself calls `getRiskDetail` (Slice C3),
which calls `getControlTestsForControl`/`getEvidenceSummaryForControl`
(Slices C1/C2) — the identical chain Finding detail already performs,
extended one more hop. No new read path, no copied Finding/Risk/
Assessment/Evidence metadata anywhere on `remediation_actions` itself.

### 5. Remediation creation workflow

`lib/domain/remediation.ts`'s `createRemediationAction`: Browser →
Server Action (`createRemediationActionAction`, added to the Finding
detail page's own `actions.ts`) → authenticate → `requireEngagementAccess`
→ validate → `createRemediationAction` → PostgreSQL (one transaction,
two inserts: `remediation_actions` then `remediation_findings`) → RLS →
audit (existing `remediation_actions_audit_log`/`remediation_findings_
audit_log` triggers — no new audit mechanism). Mirrors `createFinding`'s
(Slice C4) exact shape: only `findingId` identifies the source context;
tenant/organisation/engagement scope is always re-derived server-side
from the Finding's own authoritative row, never trusted from the caller
(instructions §4/§16).

### 6. Remediation list

New route, `/organisations/[organisationId]/engagements/[engagementId]/remediation`
— a real-data table (title, source finding, priority, status, owner,
due date), one batched query (`listRemediationActionsForEngagement`),
no dashboard, no chart, no analytics (instructions §12/§14). Linked
from the Engagement detail page ("Remediation" section, mirroring the
existing "Findings"/"Risks"/"Assessments" sections) and from the
Finding detail page's own Remediation section ("View all engagement
remediation").

### 7. Remediation detail

New route, `/organisations/[organisationId]/engagements/[engagementId]/remediation/[remediationActionId]`
— identity, a genuine edit form (title/description/priority/status/
due_date/owner, instructions §11), source Finding(s) with clickable
navigation, source Risk/Assessment/Control (via item 4's composition),
relevant ControlTests, indirect Evidence (from the source assessment
response), DIRECT Evidence submitted against the remediation action
itself with an upload form (item 12), and any existing ValidationRecord
shown read-only with a plain, non-interactive note when none exists yet
(instructions §11/§23's own explicit "show its current relationship/
state accurately... do NOT build Validation actions").

### 8. Status

Uses the existing `remediation_action_status` enum exactly (open/
in_progress/evidence_submitted/validated/closed) — no new state, and a
dedicated `remediationStatusTone` badge-tone function (its own distinct
five-value set, not confused with `risk_status`/`finding_status`).
`updateRemediationAction` accepts any of the five values with no
enforced transition order — DECISIONS.md R-71 (Milestone 7) already
established the whole field is deliberately application-layer-
optional, not a database state machine (instructions §24: "do not
invent workflow rules... if the existing status is simply mutable,
preserve that").

### 9. Priority

Uses the existing `remediation_priority` enum exactly (identical
four-point scale to `risk_rating`/`finding_severity` — `riskRatingTone`
is reused directly, no separate tone function needed). Never
automatically copied from the source Finding's severity or the
ultimate source Risk's rating at the domain layer (DECISIONS.md R-105)
— an independent, optional (nullable) field the consultant sets
explicitly; the creation form's own `<select>` offers "Not set" as the
default, with no UI-convenience default value copied in either (unlike
Finding's own severity default from Risk in Slice C4 — the schema's own
nullability here made an unset default the more honest choice).

### 10. Owner

Mirrors Risk's/Finding's self-only design (instructions §9): the only
assignment mechanism is `assignOwnerToSelf` at creation and
`ownerAction` (`keep`/`assign_self`/`unassign`) on edit — never an
arbitrary target user, no user-directory, no invitations, no
membership-administration UI, no owner picker (instructions §9's own
explicit list of what NOT to build). The database now independently
rejects a cross-tenant owner too (item 15/DECISIONS.md R-104) — not
only application-layer discipline.

### 11. Due date

`due_date` (a `date` column) is validated server-side (`YYYY-MM-DD`
format, `InvalidRemediationInputError` on a malformed value) and
displayed plainly on list/detail. No automated reminders, no
notifications, no Task/Notification functionality, no invented
business-deadline enforcement beyond the schema's own plain nullable
column (instructions §10's own explicit prohibitions).

### 12. Evidence relationship

The one place this slice's traceability chain is DIRECT rather than
indirect (unlike Risk/Finding, which have no Evidence relationship in
the approved schema at all): `evidence_links` has carried a genuine
`remediation_action` subject type since Milestone 7
(`evidence_links_remediation_action_scope_fk`, the CHECK-constraint
branch, the `remediation_action_id` column) — the application layer
simply hadn't reached it yet (Slice C2's own explicit scope limitation).
`lib/domain/evidence.ts` was extended (DECISIONS.md R-106): `LinkTarget`
gained a `remediation_action` case, `resolveLinkSubject` gained a
matching branch (re-deriving the RemediationAction's own tenant/
organisation/engagement from its authoritative row, never trusting the
caller), and a new `getEvidenceSummaryForRemediationAction` read
function mirrors `getEvidenceSummaryForControl`'s exact shape. This is
the SAME Evidence/EvidenceLink architecture throughout — no second
attachment system, no duplicated `storage_path`/document metadata/
checksum, no exposed storage path (instructions §22's own explicit
prohibitions); the RemediationAction detail page's own upload form
reuses the EXISTING `uploadEvidence` domain function unchanged beyond
this new link-target case.

### 13. Authorization

Reuses the existing centralized authorization service exactly —
`requireEngagementAccess` is the sole primitive this slice needed; no
new function was added to `lib/authorization/service.ts`. Every
function in `lib/domain/remediation.ts` re-derives tenant/organisation/
engagement scope from the database itself before any read or write.

### 14. RLS

Unchanged and unweakened on `remediation_actions`/`remediation_findings`
— migration 0013's existing forced-RLS policies remain exactly as they
were; directly re-confirmed via `psql \d+` this session (item 22), not
only read from the migration file.

### 15. Owner tenant-scoping mechanism

Migration `0022_remediation_action_owner_tenant_scoping.sql`: drops
`remediation_actions_owner_id_users_id_fk`, adds
`remediation_actions_owner_id_tenant_fk (owner_id, tenant_id) →
users(id, tenant_id)`, reusing migration 0020's own
`users_id_tenant_id_key` unique constraint — no new unique constraint
(instructions §18's own explicit "do not create redundant unique
constraints"). Verified per instructions §18's own checklist: existing
NULL owners remain valid (test 11b); existing same-tenant owners remain
valid (test 11b); no historical row required unsafe backfill (this
application never created a cross-tenant-owner row in the first place);
INSERT rejects a cross-tenant owner (test 10); UPDATE independently
rejects one too (test 10b) — plus a standalone raw-`psql` attack
demonstration outside the automated suite entirely, run against real
fixture data as a genuine engagement member, confirmed rejected with
`remediation_actions_owner_id_tenant_fk` (instructions §35).

### 16. Audit

Relies on the existing audit architecture exactly — migration 0013's
`remediation_actions_audit_log` (AFTER INSERT OR UPDATE) and
`remediation_findings_audit_log` (AFTER INSERT OR DELETE) triggers
already cover every write this slice performs; no new trigger, no
second audit log. Directly verified live against real `audit_log` rows
(item 18, test 17) that both creation and update produce
correctly-attributed entries (`actor_user_id` = the acting user), with
`field_changes` capturing real before/after values (e.g. `priority`) —
owner/status/priority/due-date changes are all captured by the same
generic `to_jsonb(NEW)` payload, since they are all just fields on the
same row this trigger already logs in full.

### 17. Finalized-assessment behavior

Deliberately NOT blocked, for the same reason and by the same direct
verification method as Risk/Finding (DECISIONS.md R-98/R-103/R-105): no
trigger on `remediation_actions`/`remediation_findings` references
Assessment finalization at all — confirmed both by successfully
creating a RemediationAction from a Finding sourced from an
already-finalized Assessment's Risk, and by a dedicated test querying
`information_schema.triggers` directly.

### 18. Security tests

`tests/app/remediation.test.ts`, 17 numbered database/application
security scenarios (PHASE C5 instructions §25), all passing, real
PostgreSQL, no mocked authorization: tenant/organisation/engagement
read isolation (1-3); tenant/organisation/engagement create-boundary
enforcement against another scope's Finding (4-6); anonymous access
rejected (7); unauthorized create/update rejected (8-9); cross-tenant
owner rejected by the database (10, and 10b for UPDATE specifically);
cross-tenant owner rejected through the application, i.e. no code path
accepts one at all (11, plus 11b's migration-safety verification);
direct malicious RLS attack (12); forged browser-supplied scope ids
rejected even with a real id (13); the Finding source relationship
cannot cross a tenant boundary (14); the full Risk → Finding →
Remediation chain stays tenant-safe (15); finalized-assessment behavior
matches the database (16); audit attribution identifies the acting
user (17).

### 19. Owner security tests

Covered within the same numbered list (items 10/10b/11/11b) plus a
standalone, non-vitest `psql` demonstration (item 15) — matching PHASE
C5 instructions §26's own exact scenario: same-tenant owner succeeds;
cross-tenant owner via direct SQL fails (INSERT and UPDATE both); a
cross-tenant owner is unreachable through the application at all (no
`ownerId` parameter exists to even attempt one).

### 20. Traceability tests

A dedicated end-to-end test constructs the exact scenario instructions
§27 describe — Assessment A → Control C1 → Response → Risk R1 →
Finding F1 → Remediation Rm1 — plus Evidence at two points (indirect,
from the assessment response; direct, submitted against the
remediation action itself) — and resolves the ENTIRE chain using only
the real functions the RemediationAction detail page itself calls
(`getRemediationActionDetail` → `getFindingDetail` → `getRiskDetail` →
`getControlTestsForControl`/`getEvidenceSummaryForControl`/
`getEvidenceSummaryForRemediationAction`), confirming both Evidence
paths are reachable; then confirms Tenant B cannot traverse any part of
that exact chain, including the direct Evidence path.

### 21. Update tests

`updateRemediationAction`'s title/description/priority/status/due_date/
owner (assign_self, then unassign) are all exercised together, with
explicit verification that `completed_at` is set exactly once on first
entering a terminal status (`validated`/`closed`) and never cleared or
re-stamped when status later moves away and back; an empty-title update
is rejected; an unauthorized user's update attempt is rejected
(security test 9); every update produces a correctly-attributed audit
entry with real before/after `field_changes` (security test 17). Only
fields the schema actually supports were tested — no `rationale` field
exists to test (DECISIONS.md R-105).

### 22. Database inspection

Directly queried via `psql` (not only read from the migration file) for
`remediation_actions`/`remediation_findings`/`remediation_risks`/
`remediation_controls`/`evidence_links`: forced RLS enabled on all
four RemediationAction-side tables; `_select`/`_insert`(/`_update` on
`remediation_actions`,/`_delete` on the three junctions) policies
present, all scoped through `can_access_engagement`;
`remediation_actions_prevent_reparenting`/the `_audit_log` triggers
confirmed present exactly as migration 0013 defines them; `GRANT`s to
`authenticated` confirmed as `INSERT, SELECT, UPDATE` on
`remediation_actions` (no `DELETE` — never hard-deleted) and `DELETE,
INSERT, SELECT` on all three junctions; `remediation_actions_owner_id_
tenant_fk` confirmed present and the old plain
`remediation_actions_owner_id_users_id_fk` confirmed gone;
`evidence_links`' own `remediation_action_id` column, CHECK-constraint
branch, and `evidence_links_remediation_action_scope_fk` all directly
confirmed already present and unchanged (this slice's Evidence
extension is application-layer only).

### 23. Performance/query approach

`listRemediationActionsForEngagement`/`listRemediationActionsForFinding`/
`getRemediationActionDetail` are each one to a small, fixed number of
batched queries (`LEFT JOIN`s, not one query per remediation action) —
no N+1. Traceability resolution reuses the Finding/Risk/Assessment/
Evidence layer's own already-efficient functions rather than adding a
new, parallel read path. No search engine, cache layer, microservice,
or separate API backend was introduced — PostgreSQL remains the sole
read/write store (instructions §31).

### 24. Exact C5 tests

`tests/app/remediation.test.ts` (30 tests): RemediationAction creation
success (with/without owner assignment and priority/due date, with an
invalid due-date format, against a nonexistent Finding, with an empty
title, against a finalized Assessment's Finding); `updateRemediationAction`
(all six supported fields including both owner actions, and the
`completed_at` one-time-set behavior; empty-title rejection); the 17
security scenarios plus the 10b/11b owner-hardening additions (item
18/19); the full traceability scenario with both direct and indirect
Evidence (item 20); and `listRemediationActionsForEngagement`/
`listRemediationActionsForFinding` read-function scoping.

### 25. Exact full-suite count/results

```
npm run test:db   # fresh reset + full 8-directory suite incl. tests/app: 582/582 passing
npm run test:db   # run again for stability: 582/582 passing, identical results
```
(552 tests carried forward from Slice C4 + 30 new in
`tests/app/remediation.test.ts` = 582.)

### 26. Typecheck/lint/build

```
npm run typecheck   # clean
npx eslint .         # clean
npm run build        # succeeds; both new Remediation routes correctly reported
                      # dynamic (server-rendered on demand), none prerendered
```

### 27. Files changed

- `drizzle/migrations/0022_remediation_action_owner_tenant_scoping.sql` (new)
- `db/schema/remediation-actions.ts` (`ownerId`'s plain `.references()`
  removed; composite `ownerTenantFk` added, mirroring `risks.ts`'s/
  `findings.ts`'s Slices C3.1/C4 fixes)
- `lib/domain/remediation.ts` (new) — `createRemediationAction`,
  `updateRemediationAction`, `listRemediationActionsForEngagement`,
  `listRemediationActionsForFinding`, `getRemediationActionDetail`,
  `InvalidRemediationInputError`
- `lib/domain/evidence.ts` (extended — `LinkTarget`/`resolveLinkSubject`
  gained a `remediation_action` case; new
  `getEvidenceSummaryForRemediationAction`)
- `components/ui/badge.tsx` (`remediationStatusTone` added;
  `remediation_priority` reuses the existing `riskRatingTone` directly)
- `app/(shell)/.../engagements/[engagementId]/findings/actions.ts`
  (extended — `createRemediationActionAction`)
- `app/(shell)/.../engagements/[engagementId]/findings/[findingId]/page.tsx`
  (Remediation Actions section added)
- `app/(shell)/.../engagements/[engagementId]/page.tsx` ("Remediation"
  section added, mirroring existing sections)
- `app/(shell)/.../engagements/[engagementId]/remediation/page.tsx`
  (new — Remediation list)
- `app/(shell)/.../engagements/[engagementId]/remediation/actions.ts`
  (new — `updateRemediationActionAction`, `uploadRemediationEvidenceAction`)
- `app/(shell)/.../engagements/[engagementId]/remediation/[remediationActionId]/page.tsx`
  (new — Remediation detail/edit)
- `tests/app/remediation.test.ts` (new, 30 tests)
- `DATA_MODEL.md` (Slice C5 addendum, `RemediationAction.owner_id`)
- `DECISIONS.md` (R-104, R-105, R-106)
- `PROGRESS.md` (this entry)

### 28. Dependencies changed

None.

### 29. Schema changes

One: migration `0022_remediation_action_owner_tenant_scoping.sql` —
directly instructed by the brief itself (§3/§9/§18), explained fully
before applying, reuses the existing `users_id_tenant_id_key`
constraint, no RLS/GRANT/trigger touched.

### 30. Historical-row impact

None — no production data exists (no production Supabase project is
provisioned, per D-03's own still-current status); against the fresh
test database, zero constraint violations occurred applying the
migration, and the full pre-existing suite passed unmodified
afterward. Every NULL-owner row is structurally unaffected (skipped FK
check); every non-null-owner row this application has ever created was
already same-tenant by construction, so none could violate the new
constraint.

### 31. Known limitations

1. `remediation_risks`/`remediation_controls` junctions are not used by
   this slice's UI — only `remediation_findings` (instructions' own §4
   framing: RemediationActions are created FROM a Finding in this
   slice, never directly from a Risk or Control).
2. No standalone, non-Finding-context RemediationAction creation UI —
   every RemediationAction this slice's UI can create is driven from a
   Finding's own detail page, mirroring Slice C4's identical
   Finding-from-Risk-context-only limitation.
3. Evidence submitted directly against a RemediationAction can be
   uploaded but not reviewed (accept/reject) from the RemediationAction
   detail page — review remains available from wherever the Evidence
   was originally surfaced in the Assessment workspace; building a
   parallel review action here was judged out of this slice's own
   explicit scope (upload/submission, not a QA workflow).
4. Carries forward every prior slice's own recorded limitation
   (DECISIONS.md R-85/D-03, R-95): no real Supabase Auth/Storage
   backend is reachable from this environment.

### 32. Deferred Validation functionality

Nothing was implemented — per explicit instruction (§23), Validation
remains entirely unbuilt: no `ValidationRecord` creation, no validation
approval/rejection UI, no evidence-submission-triggers-validation
workflow, no remediation closure workflow, no automatic remediation
completion, no validator assignment. The RemediationAction detail page
shows any EXISTING `ValidationRecord` read-only (outcome, validator,
timestamp, rationale) and, when none exists, a plain, non-interactive
note that Validation is a future stage — never a button or link
implying functionality that doesn't exist.

### 33. Deferred decisions

- Building `RemediationRisk`/`RemediationControl` UI (linking a
  RemediationAction directly to a Risk or Control, not only via its
  source Finding).
- A standalone, non-Finding-context RemediationAction creation
  workflow.
- Evidence review (accept/reject) directly from the RemediationAction
  detail page.
- Validation itself — the next slice, per the brief's own chain.

### 34. Recommended C6

Per explicit instruction, no recommendation is pressed — the user's own
brief states "we will review C5 before continuing" and forbids
proceeding to Validation/Maturity/Client Portal/Reporting/AI in this
session. The natural next candidate, per the brief's own chain
("Assessment → ... → Finding → Remediation Action → later Validation"),
is Validation — `validation_records` already exists, database-only,
from Milestone 7, and this slice's own detail page already resolves and
displays it read-only, ready for a future slice to add the one
consultant-driven write action DATA_MODEL.md §8 describes. This report
does not preempt that choice.

### 35. Git status

All Slice C5 work is committed on `claude/primus-privacy-architecture-39p3gh`.

### 36. Remote synchronization

Pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies).

---

## Slice C4 — Findings Management (Session 21, 2026-09-01)

**Scope:** exactly what PHASE C — FINDINGS / Slice C4 instructed — turn
an existing Risk into a structured, traceable Finding, using the EXACT
existing Finding/FindingRisk/FindingControl/FindingProcessingActivity
model built (database-only) in Milestone 7 (migrations 0012/0013). No
Remediation, Validation, Maturity, Client Portal, Reporting, or AI UI —
none of those exist anywhere in this slice's changes. No new domain
table, no junction redesign — the one migration this slice made
(0021) only hardens an existing column's referential integrity,
exactly mirroring an already-approved precedent (Slice C3.1); it does
not add or redesign any relationship.

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`, the
Finding/Risk/Assessment/AssessmentResponse/ControlTest/Evidence/
EvidenceLink schemas, the existing authorization service, the Risk
domain (`lib/domain/risks.ts`), the Assessment workspace, existing UI
components, existing tests, and every relevant migration fresh from
disk before writing anything, per instruction.

### 1. Existing Finding architecture discovered

`findings` (DATA_MODEL.md §8): `engagement_id`/`organisation_id`/
`tenant_id` (engagement-scoped, like `Risk`), `title`, `description`,
`severity` (`finding_severity` enum: low/medium/high/critical — the
identical four-point scale `risk_rating` uses), `status`
(`finding_status` enum: open/in_progress/resolved/accepted — a
DIFFERENT value set from `risk_status`, not to be confused), `owner_id`
(additive, DECISIONS.md — same established concept as
`RemediationAction.owner_id`). `finding_risks`/`finding_controls`/
`finding_processing_activities` are plain insert/delete-only junctions
(Finding N ←→ N Risk/Control/ProcessingActivity — DATA_MODEL.md §11).
No `assessment_response_id`-style direct additive FK exists on
`findings` the way one does on `risks` — the ONLY relationship a
Finding has to anything is via these three junctions. Two consequential
architectural facts, not schema discrepancies, shaped the design (no
STOP was warranted for either — see items 2/13 below): Finding has no
direct Evidence relationship in the approved schema at all (same
situation R-96/item-2-of-Slice-C3 already found for Risk), and
`findings.owner_id` was found unprotected the same way `risks.owner_id`
was before Slice C3.1 (item 9/DECISIONS.md R-102).

### 2. Finding schema used

Used exactly as built — no field renamed, added, or repurposed beyond
the migration 0021 hardening (item 9). `evidence_links`' CHECK
constraint was directly re-confirmed to have no `finding` subject type
— Finding cannot be, and was not made to be, a direct EvidenceLink
subject. ARCHITECTURE.md's own looser prose ("findings linking risks,
controls, processing activities and evidence") is not read as a mandate
to add one — DATA_MODEL.md §8's own explicit Evidence-attachment
sentence already excludes both Risk and Finding, the same resolution
Slice C3 already applied to this identical tension for Risk.

### 3. Risk → Finding relationship

Many-to-many via the EXISTING `finding_risks` junction (DATA_MODEL.md
§8/§11: "Finding N ←→ N Risk") — one Risk may have many Findings, and
(structurally, though this slice's own UI only ever creates one link
per Finding at creation time) one Finding could reference multiple
Risks. No artificial "one Finding per Risk" rule was imposed
(instructions §21) — nothing in the schema requires one.
`finding_risks_risk_scope_fk`/`finding_risks_finding_scope_fk`
(migration 0012) already structurally prove, by construction, that a
FindingRisk row's `risk_id` and `finding_id` share the exact same
tenant/organisation/engagement — a Finding cannot reference a
cross-tenant/cross-organisation/cross-engagement Risk (instructions
§12) with no schema change needed for this part; directly re-verified
via `psql` (item 20) and a dedicated raw-SQL test (item 17, test 11).

### 4. Finding creation workflow

`lib/domain/findings.ts`'s `createFinding`: Browser → Server Action
(`createFindingAction`, added to the Risk detail page's own
`actions.ts`) → authenticate → `requireEngagementAccess` → validate →
`createFinding` → PostgreSQL (one transaction, two inserts: `findings`
then `finding_risks`) → RLS → audit (existing `findings_audit_log`/
`finding_risks_audit_log` triggers — no new audit mechanism). Mirrors
`createRisk`'s (Slice C3) exact shape: only `riskId` identifies the
source context; tenant/organisation/engagement scope is always
re-derived server-side from the Risk's own authoritative row, never
trusted from the caller (instructions §4/§15).

### 5. Source traceability

Finding → Risk → Assessment → Control → Assessment Response is resolved
by composing EXISTING functions at the page level (never duplicated
data, instructions §5): `getFindingDetail` returns the Finding's own
fields plus its linked source Risk(s) (via `finding_risks`); the Finding
detail PAGE then calls the EXISTING `getRiskDetail` (Slice C3) with the
primary source Risk's id to get the full Risk → Assessment → Control →
AssessmentResponse chain, and from THAT result further calls the
EXISTING `getControlTestsForControl`/`getEvidenceSummaryForControl` —
the identical composition the Risk detail page itself already performs,
one layer deeper. No new read path, no copied Risk/Assessment/Evidence
metadata anywhere on `findings` itself.

### 6. Evidence traceability

Same conclusion as item 2/5: Finding has no direct Evidence relationship
in the approved schema, so none was invented. Evidence is reached only
indirectly, through the reused functions in item 5 — a Finding
"references authoritative Evidence" (instructions §11) by resolving to
the exact same `EvidenceLink`/`Evidence` rows the Assessment workspace
and Risk detail page already show, never a copy of `storage_path`,
document metadata, checksum, or any other Evidence field.

### 7. Finding status

Uses the existing `finding_status` enum exactly (open/in_progress/
resolved/accepted) — no new state, and deliberately not confused with
`risk_status`'s different value set (a dedicated `findingStatusTone`
badge-tone function was added rather than reusing `riskStatusTone`, for
exactly this reason — see item 15).

### 8. Finding severity

Uses the existing `finding_severity` enum exactly (identical four-point
scale to `risk_rating` — `riskRatingTone` is reused directly for it, no
separate tone function needed). Never automatically copied from the
source Risk's own rating at the domain layer (DECISIONS.md R-103) — the
Finding creation form's own `<select>` merely *defaults* to the source
Risk's `inherent_rating` as a UI convenience, explicitly labeled as such
("Defaults to this risk's inherent rating — not automatically linked;
change as needed") and never enforced; `createFinding` only ever
persists whatever the consultant actually submits.

### 9. Finding ownership

Mirrors Risk's self-only design (instructions §10) but, unlike Risk
(owner fixed at creation only), Finding's owner can also be changed
post-creation via `updateFinding`'s `ownerAction` (`keep`/`assign_self`/
`unassign`) — still only ever the caller's own id, or cleared entirely;
no arbitrary target user, no user-directory, no owner picker, no
membership-administration UI (instructions §10's own explicit list of
what NOT to build). A genuine database gap was found and proactively
closed using the exact mechanism instructions §10 named:
`findings.owner_id` was a plain `→ users(id)` FK, identical to
`risks.owner_id`'s pre-C3.1 shape; migration 0021 applies the same
composite-FK fix (`findings_owner_id_tenant_fk`), reusing C3.1's own
supporting `users_id_tenant_id_key` unique constraint (DECISIONS.md
R-102). `remediation_actions.owner_id` has the identical unprotected
shape and was deliberately left untouched — out of C4's scope,
recorded as a known limitation for a future Remediation slice.

### 10. Finding list

New route, `/organisations/[organisationId]/engagements/[engagementId]/findings`
— a real-data table (title, source risk, severity, status, owner), one
batched query (`listFindingsForEngagement`), no dashboard, no chart, no
analytics (instructions §6). Linked from the Engagement detail page
("Findings" section, mirroring the existing "Risks"/"Assessments"
sections) and from the Risk detail page's own Findings section ("View
all engagement findings").

### 11. Finding detail

New route, `/organisations/[organisationId]/engagements/[engagementId]/findings/[findingId]`
— identity, description, a genuine edit form (title/description/
severity/status/owner, instructions §20/§26), source Risk(s) with
clickable navigation back to Risk detail, source Assessment/Control
(via item 5's composition), relevant ControlTests/Evidence, and a
plain, non-interactive text note that Remediation/Validation are not
yet part of this application (instructions §22's own explicit "label it
clearly as unavailable... do not create remediation tasks/owners/
due-date workflows/validation/closure workflows").

### 12. Assessment workspace integration

Not touched — per instructions §19's own preferred flow ("Assessment →
Risk → Findings → Create Finding"), the Finding entry point lives on
the Risk detail page (added in Slice C3), not the Assessment workspace
itself. The Assessment workspace, Evidence UI, and Risk creation UI
(Slices C1/C2/C3) are all unmodified by this slice beyond the two-line
"Findings" section added to the Engagement detail page (item 10),
matching instructions §19's own "do not redesign existing C1/C2/C3
screens unnecessarily."

### 13. Authorization

Reuses the existing centralized authorization service exactly —
`requireEngagementAccess` is the sole primitive this slice needed; no
new function was added to `lib/authorization/service.ts`. Every
function in `lib/domain/findings.ts` re-derives tenant/organisation/
engagement scope from the database itself before any read or write.

### 14. RLS

Unchanged and unweakened on `findings`/`finding_risks` — migration
0013's existing forced-RLS policies remain exactly as they were;
directly re-confirmed via `psql \d+` this session (item 20), not only
read from the migration file.

### 15. Audit

Relies on the existing audit architecture exactly — migration 0013's
`findings_audit_log` (AFTER INSERT OR UPDATE) and `finding_risks_audit_log`
(AFTER INSERT OR DELETE) triggers already cover every write this slice
performs; no new trigger, no second audit log. Directly verified live
against real `audit_log` rows (item 17, test 14) that both Finding
creation and Finding update produce a correctly-attributed entry
(`actor_user_id` = the acting user), with `field_changes` capturing the
real before/after values for an updated field (e.g. `severity`).

### 16. Finalized-assessment behavior

Deliberately NOT blocked, for the same reason and by the same direct
verification method as Risk (DECISIONS.md R-98/R-103): no trigger on
`findings`/`finding_risks` references Assessment finalization at all —
confirmed both by successfully creating a Finding from an
already-finalized Assessment's Risk, and by a dedicated test querying
`information_schema.triggers` directly for `findings`/`finding_risks`
and asserting no trigger name matches `finaliz`.

### 17. Security tests

`tests/app/findings.test.ts`, 14 numbered database/application security
scenarios (PHASE C4 instructions §24), all passing, real PostgreSQL, no
mocked authorization:
1. Tenant A cannot read Tenant B's Finding.
2. Organisation A cannot read Organisation A2's Finding (same tenant).
3. Engagement A cannot read Engagement A3's Finding (same organisation).
4. A user authorized only for their own tenant cannot create a Finding
   against another tenant's Risk (the concrete reading of "Risk A
   cannot create a Finding against Risk B" given `createFinding`'s own
   single-`riskId` shape).
5. Unauthorized user (no membership) cannot create a Finding.
6. Unauthorized user (no membership) cannot update a Finding.
7. Anonymous access (SELECT and INSERT) is rejected.
8. Browser-supplied forged organisation/engagement ids cannot cross a
   boundary even paired with a real Finding id.
9. Cross-tenant Finding owner is rejected by the database
   (`findings_owner_id_tenant_fk`, item 9/DECISIONS.md R-102).
10. A direct, malicious raw INSERT with forged tenant/organisation/
    engagement is rejected by RLS.
11. A Finding's source Risk relationship cannot cross a tenant boundary
    — a raw `finding_risks` INSERT pairing a legitimate Finding with
    another tenant's Risk is rejected by `finding_risks_risk_scope_fk`.
12. Cross-tenant Evidence cannot be surfaced through a Finding's
    traceability read path — RLS-filtered even when the real id is
    known.
13. Finalized-assessment behavior matches the approved database rules
    (item 16).
14. Audit attribution identifies the acting user for both creation and
    update (item 15).

### 18. Traceability tests

A dedicated end-to-end test constructs the exact scenario instructions
§25 describe — Assessment A → Control C1 → Response → Risk R1 → Finding
F1 → Evidence E1 — and resolves the ENTIRE chain using only the real
functions the Finding detail page itself calls (`getFindingDetail` →
`getRiskDetail` → `getControlTestsForControl` →
`getEvidenceSummaryForControl`), confirming Evidence is reachable at the
end of the chain; then confirms Tenant B cannot traverse any part of
that exact chain (both `getFindingDetail` and `getRiskDetail`, using the
chain's own real ids, correctly reject a Tenant B caller).

### 19. Update tests

`updateFinding`'s title/description/severity/status/owner (assign_self,
then unassign) are all exercised together in one test and confirmed
persisted correctly; an empty-title update is rejected
(`InvalidFindingInputError`); an unauthorized user's update attempt is
rejected (security test 6); every update produces a correctly-attributed
audit entry with real before/after `field_changes` (security test 14).
Only fields the schema actually supports were tested — no `rationale`
field exists to test (DECISIONS.md R-103).

### 20. Database inspection

Directly queried via `psql` (not only read from the migration file) for
`findings`/`finding_risks`/`finding_controls`/
`finding_processing_activities`: forced RLS enabled on all four;
`_select`/`_insert`(/`_update` on `findings`,/`_delete` on the three
junctions) policies present, all scoped through `can_access_engagement`;
`findings_prevent_reparenting`/the `_audit_log` triggers confirmed
present exactly as migration 0013 defines them; `GRANT`s to
`authenticated` confirmed as `INSERT, SELECT, UPDATE` on `findings` (no
`DELETE` — never hard-deleted) and `DELETE, INSERT, SELECT` on all three
junctions (no `UPDATE` — a link is created or removed, never mutated);
`findings_owner_id_tenant_fk` confirmed present and the old plain
`findings_owner_id_users_id_fk` confirmed gone.

### 21. Performance/query approach

`listFindingsForEngagement`/`listFindingsForRisk`/`getFindingDetail` are
each one to a small, fixed number of batched queries (`LEFT JOIN`s, not
one query per finding) — no N+1. Traceability resolution reuses the
Risk/Assessment/Evidence layer's own already-efficient functions rather
than adding a new, parallel read path. No search engine, cache layer,
microservice, or separate API backend was introduced — PostgreSQL
remains the sole read/write store (instructions §29).

### 22. Exact C4 tests

`tests/app/findings.test.ts` (24 tests): Finding creation success (with
and without self-assignment, against a nonexistent Risk, with an empty
title, against a finalized Assessment's Risk); `updateFinding` (all
five supported fields, including both owner actions; empty-title
rejection); the 14 security scenarios (item 17); the full traceability
scenario (item 18); and `listFindingsForEngagement`/`listFindingsForRisk`
read-function scoping.

### 23. Exact full-suite count/results

```
npm run test:db   # fresh reset + full 8-directory suite incl. tests/app: 552/552 passing
npm run test:db   # run again for stability: 552/552 passing, identical results
```
(528 tests carried forward from Slice C3.1 + 24 new in
`tests/app/findings.test.ts` = 552.)

### 24. Typecheck/lint/build

```
npm run typecheck   # clean
npx eslint .         # clean
npm run build        # succeeds; both new Findings routes correctly reported
                      # dynamic (server-rendered on demand), none prerendered
```

### 25. Files changed

- `drizzle/migrations/0021_finding_owner_tenant_scoping.sql` (new)
- `db/schema/findings.ts` (`ownerId`'s plain `.references()` removed;
  composite `ownerTenantFk` added, mirroring `risks.ts`'s Slice C3.1 fix)
- `lib/domain/findings.ts` (new) — `createFinding`, `updateFinding`,
  `listFindingsForEngagement`, `listFindingsForRisk`, `getFindingDetail`,
  `InvalidFindingInputError`
- `components/ui/badge.tsx` (`findingStatusTone` added; `finding_severity`
  reuses the existing `riskRatingTone` directly, no new function needed)
- `app/(shell)/.../engagements/[engagementId]/risks/actions.ts`
  (extended — `createFindingAction`)
- `app/(shell)/.../engagements/[engagementId]/risks/[riskId]/page.tsx`
  (Findings section added: list + create form)
- `app/(shell)/.../engagements/[engagementId]/page.tsx` ("Findings"
  section added, mirroring the existing "Risks"/"Assessments" sections)
- `app/(shell)/.../engagements/[engagementId]/findings/page.tsx` (new —
  Finding list)
- `app/(shell)/.../engagements/[engagementId]/findings/actions.ts` (new
  — `updateFindingAction`)
- `app/(shell)/.../engagements/[engagementId]/findings/[findingId]/page.tsx`
  (new — Finding detail/edit)
- `tests/app/findings.test.ts` (new, 24 tests)
- `DECISIONS.md` (R-102, R-103)
- `PROGRESS.md` (this entry)

### 26. Dependencies changed

None.

### 27. Schema changes

One: migration `0021_finding_owner_tenant_scoping.sql` — replaces
`findings.owner_id`'s plain `→ users(id)` FK with a composite
`(owner_id, tenant_id) → users(id, tenant_id)` FK, reusing migration
0020's own `users_id_tenant_id_key` unique constraint (no new unique
constraint needed). No RLS, GRANT, audit trigger, or unrelated table
was touched. Explained fully before applying (DECISIONS.md R-102);
applied to a freshly-reset test database with zero constraint
violations, then the full pre-existing suite passed unmodified — no
historical row was affected (every existing non-null-owner Finding was
already same-tenant by construction, since `createFinding` never sets
`owner_id` to anything but the acting user's own id).

### 28. Known limitations

1. `remediation_actions.owner_id` has the identical unprotected shape
   `risks`/`findings`' `owner_id` had before their own fixes — out of
   C4's own scope (Remediation is explicitly forbidden this slice);
   deferred to whichever future slice builds Remediation, using this
   same, now twice-established pattern.
2. Finding has no direct Evidence relationship in the approved schema —
   traceability is indirect only, via the reused Risk/Assessment
   functions (item 5/6); this mirrors Risk's own identical limitation
   from Slice C3, not a new gap.
3. `finding_controls`/`finding_processing_activities` junctions are not
   used by this slice's UI — only `finding_risks` (instructions'
   own §3 framing: Findings are created FROM a Risk in this slice,
   never directly from a Control or ProcessingActivity).
4. No standalone, non-Risk-context Finding creation UI — every Finding
   this slice's UI can create is driven from a Risk's own detail page,
   mirroring Slice C3's identical Risk-from-Assessment-context-only
   limitation.
5. Carries forward every prior slice's own recorded limitation
   (DECISIONS.md R-85/D-03, R-95): no real Supabase Auth/Storage
   backend is reachable from this environment.

### 29. Deferred decisions

- Closing `remediation_actions.owner_id`'s identical tenant-scoping gap
  (item 28.1) — belongs to a future Remediation slice.
- Building `FindingControl`/`FindingProcessingActivity` UI (linking a
  Finding directly to a Control or ProcessingActivity, not only via its
  source Risk).
- A standalone, non-Risk-context Finding creation workflow.

### 30. Recommended C5

Per explicit instruction, no recommendation is pressed — the user's own
brief states "we will review C4 before continuing" and forbids
proceeding to Remediation/Validation/Maturity/Client Portal/Reporting/AI
in this session. The natural next candidate, per the brief's own chain
("Assessment → ... → Risk → Finding → later Remediation → later
Validation"), is Remediation — the schema and its junctions already
exist, database-only, from Milestone 7, the same pattern this slice and
Slice C3 both just followed; it would also be the natural place to close
`remediation_actions.owner_id`'s identical, already-flagged gap (item
28.1) in the same pass, if the user directs it. This report does not
preempt that choice.

### 31. Git status

All Slice C4 work is committed on `claude/primus-privacy-architecture-39p3gh`.

### 32. Remote synchronization

Pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies).

---

## Slice C3.1 — Risk Security Hardening (Session 20, 2026-09-01)

**Scope:** exactly what Slice C3.1 instructed — close the `risks.
owner_id` tenant-scoping gap Slice C3's own final report identified and
recorded (DECISIONS.md R-99), and nothing else. No Findings,
Remediation, Validation, Maturity, Reporting, Client Portal, or AI. No
scoring calculator was added — `lib/domain/risks.ts`'s existing
likelihood/impact/rating/residual-triad recording and RiskScoringModel
association are untouched.

Read `DATA_MODEL.md`'s Risk section, `SECURITY.md`, DECISIONS.md R-99
and every other Risk-related decision, the actual `risks`/`users`/
`tenant_memberships`/`organisation_memberships`/`engagement_
memberships` schemas, the existing authorization service, `lib/domain/
risks.ts`, `tests/app/risks.test.ts`, the relevant RLS policies, the
existing membership FKs, and the existing audit triggers fresh from
disk before writing anything, per instruction.

### 1. The correct owner model, determined from the existing architecture

`users.tenant_id` (NOT NULL — DATA_MODEL.md §2: every user has exactly
one home tenant) is the correct scoping key, not any membership table:
a `tenant_memberships`/`organisation_memberships`/`engagement_
memberships` row is revocable, optional, and potentially many-per-user
— the question a Risk owner FK needs answered is the single,
always-present fact "which tenant does this user actually belong to,"
which `users.tenant_id` already states directly. This is also exactly
the fact `lib/domain/risks.ts`'s existing self-assignment design already
relied on implicitly: `requireEngagementAccess` only ever succeeds for
a caller whose own membership chain resolves to the Risk's tenant, so
`owner_id = callingUserId` was always same-tenant in practice — this
slice makes that a database-enforced guarantee instead of an
application-only convention.

### 2. Database enforcement — the composite FK

Migration `0020_risk_owner_tenant_scoping.sql` (new):
1. `ALTER TABLE users ADD CONSTRAINT users_id_tenant_id_key UNIQUE (id, tenant_id);`
   — `id` is already globally unique (primary key); this adds no new
   restriction on `users` itself, it only makes `(id, tenant_id))`
   independently referenceable, exactly as Postgres requires for a
   composite FK.
2. `ALTER TABLE risks DROP CONSTRAINT risks_owner_id_users_id_fk;`
   `ALTER TABLE risks ADD CONSTRAINT risks_owner_id_tenant_fk FOREIGN KEY (owner_id, tenant_id) REFERENCES users(id, tenant_id);`
   — the old plain FK is dropped (not kept alongside the new one),
   mirroring `risk_scoring_model_id`'s own existing precedent (never
   given a redundant plain FK either — only the composite
   `risks_risk_scoring_model_tenant_fk`). `owner_id` remains nullable;
   a multi-column FK with any NULL member is skipped entirely under
   Postgres's default MATCH SIMPLE semantics, so no existing NULL-owner
   Risk row is affected.

This is the exact same `(id, tenant_id)` unique-key + composite-FK
pattern this codebase already uses for every other tenant-scoped
reference from client-engagement data to Practice/tenant content
(`risk_scoring_models_id_tenant_id_key` backing `risks_risk_scoring_
model_tenant_fk` is the closest direct precedent, migrations 0012/
0013) — not a new relationship, new user table, new role system, or
new membership model (instructions §2 explicitly forbid all four).

### 3. Preferred database enforcement — no genuine schema gap blocked this

Instructions §3 asked to STOP and explain if no appropriate unique key
existed for a composite FK. None was needed: `users.id` (primary key)
plus the new `UNIQUE (id, tenant_id)` constraint is exactly the shape
every other tenant-scoped composite FK in this codebase already uses —
no blocking gap, no STOP condition reached.

### 4. Product question — self-assignment preserved, nothing broader added

`lib/domain/risks.ts`'s `createRisk` is completely unchanged by this
slice — `assignOwnerToSelf: boolean` remains the only owner-assignment
mechanism; there is still no `ownerId` parameter accepting an arbitrary
target user anywhere in this application. No user directory, owner
picker, membership-administration screen, or cross-user assignment UI
was introduced (instructions §4's own explicit list of what NOT to
build).

### 5. RLS

Verified directly, not assumed: Tenant A cannot assign a Tenant B user
as Risk owner (rejected on INSERT); Tenant A cannot update a Risk's
owner to a Tenant B user (rejected on UPDATE, not only INSERT); a
direct malicious SQL attack combining a forged engagement/organisation
scope with a cross-tenant owner is independently rejected by RLS *and*
the new FK; existing RLS policies on `risks` (`risks_select`/`risks_
insert`/`risks_update`, all still `can_access_engagement`-scoped) are
byte-for-byte unchanged — re-confirmed via direct `psql \d+` inspection
(item 11 below), not only inferred from the migration file. Nothing was
weakened.

### 6. Domain layer

Unchanged, per instruction §6 — `createRisk` continues to derive the
owner from the authenticated user (`assignOwnerToSelf` → `userId`),
never from browser input. `requireEngagementAccess` already rejects any
caller whose own tenant doesn't resolve to the Risk's engagement/
organisation before an insert is even attempted, so "if the
authenticated user's tenant does not match the Risk's tenant, reject
the operation" was already true before this slice and remains true
now — the new FK is an additional, independent database-level
guarantee on top of that existing application-layer check, not a
replacement for it.

### 7. Audit

Verified directly against real `audit_log` rows this session (not
merely inferred from reading the trigger function): the existing
`risks_audit_log` trigger (`log_methodology_change()`, AFTER INSERT OR
UPDATE) already captures the actual `owner_id` value via its generic
`to_jsonb(NEW)` `field_changes` payload — confirmed by querying
`audit_log` for real Risk rows created with a non-null `owner_id` and
seeing that value present in `field_changes->'owner_id'`. Owner
assignment was therefore already audited by the existing, generic
mechanism; no second audit system was created, per instruction §7's own
explicit prohibition. A write REJECTED by the new FK never reaches the
trigger at all (the whole statement aborts), so no audit_log row is
ever created for a rejected cross-tenant attempt either — consistent
with how every other constraint-rejected write in this project behaves.

### 8. Tests

`tests/app/risks.test.ts` — test "13." (originally the C3
"[DOCUMENTED GAP]" test) was rewritten to prove the gap is now CLOSED
(the same raw cross-tenant INSERT that used to succeed now rejects with
`risks_owner_id_tenant_fk`), and a new `describe("Risk owner tenant
scoping (Slice C3.1)")` block adds 6 further focused tests against real
PostgreSQL:
1. Same-tenant owner is accepted.
2. Cross-tenant owner is rejected by the database on INSERT.
2b. Cross-tenant owner is also rejected on UPDATE (not just INSERT).
3. The application layer never accepts an arbitrary owner — `createRisk`'s
   own input type only supports self-assignment (structural/compile-time
   guarantee, demonstrated at runtime via a same-tenant self-assign).
4. Anonymous owner assignment is rejected.
5. Unauthorized user (no membership) cannot modify a Risk's owner via a
   direct UPDATE — RLS blocks it independently of the new FK (0 rows
   affected).
6. A direct SQL attack forging engagement/organisation scope together
   with a cross-tenant owner is rejected by both RLS and the new FK.

Instructions §8 items 7-10 (existing Risk creation, existing status
update, historical `risk_scoring_model_id` immutability, existing
tenant/org/engagement isolation all still work) are the pre-existing
Slice C3 tests earlier in the same file, run unmodified against the
post-migration schema — this full suite passing (see item 12) IS that
regression proof, not separately repeated.

### 9. No scoring calculator

Untouched, per explicit instruction. `lib/domain/risks.ts`'s
`createRisk`/`updateRiskStatus`/read functions are byte-for-byte
identical to Slice C3 except for doc-comment updates describing the new
FK (item 2). No `matrix_definition` lookup, no computed rating, no new
scoring logic anywhere.

### 10. Schema change — explanation before applying

A schema migration WAS genuinely required (no existing unique key
covered `(id, tenant_id)` on `users`) — explained fully in item 2/
DECISIONS.md R-101 before writing it: what changed (one new UNIQUE
constraint on `users`, one FK swap on `risks`), why it is necessary
(the only way to make `owner_id` database-enforced tenant-scoped
without a new table/role/membership model), and how historical rows
remain valid (nullable FK skipped entirely for NULL owners; every
existing non-null owner was already same-tenant by construction, so no
row can violate the new constraint — verified by applying the migration
to a freshly-seeded test database and confirming zero constraint
violations during application, then re-running the full existing test
suite without any fixture changes needed for this reason).

### 11. Database inspection

Directly queried via `psql` after implementation (not only read from
the migration file): `users` now shows `users_id_tenant_id_key UNIQUE
CONSTRAINT, btree (id, tenant_id)`; `risks` now shows
`risks_owner_id_tenant_fk FOREIGN KEY (owner_id, tenant_id) REFERENCES
users(id, tenant_id)` and no longer shows the old
`risks_owner_id_users_id_fk`; `risks`' RLS policies
(`risks_select`/`risks_insert`/`risks_update`), triggers
(`risks_audit_log`/`risks_prevent_reparenting`), and GRANTs
(`authenticated`: `INSERT, SELECT, UPDATE`, unchanged) are all
confirmed byte-for-byte identical to before this slice; `users`' own
GRANTs (`authenticated`: `SELECT, UPDATE`; `service_role`: `INSERT,
SELECT, UPDATE`) are likewise unchanged.

### 12. Full regression

```
npm run typecheck   # clean
npx eslint .         # clean
npm run build        # succeeds; route set unchanged (no UI change this slice)
npx tsx scripts/reset-test-db.ts   # fresh migration incl. 0020, applies cleanly
npx vitest run tests/app/risks.test.ts   # 35/35 passing (28 existing + 1 rewritten + 6 new)
npx vitest run tests/app                 # 158/158 passing (9 files)
npm run test:db      # fresh reset + full suite: 528/528 passing
npm run test:db      # run again for stability: 528/528 passing, identical results
```
(521 tests carried forward from Slice C3 + 7 net new in
`tests/app/risks.test.ts` — item 8's rewritten test 13 plus 6 new
tests = 528.)

### 13. Files changed

- `drizzle/migrations/0020_risk_owner_tenant_scoping.sql` (new)
- `db/schema/users.ts` (`idTenantUnique` added)
- `db/schema/risks.ts` (`ownerId`'s plain `.references()` removed;
  composite `ownerTenantFk` added, mirroring `riskScoringModelTenantFk`)
- `tests/app/risks.test.ts` (test "13." rewritten; new "Risk owner
  tenant scoping (Slice C3.1)" describe block, 6 tests; shared-pool
  `afterAll` consolidated to one top-level call)
- `DATA_MODEL.md` (§8's Risk implementation-clarification prose
  extended — the schema change, accurately described)
- `DECISIONS.md` (R-101)
- `PROGRESS.md` (this entry)

### 14. Dependencies changed

None.

### 15. Known limitations

Carries forward Slice C3's own remaining limitations unchanged (no
RiskScoringModel-authoring UI, no scoring calculator, no full Risk edit
form beyond status, no standalone non-assessment-context Risk creation,
no `risk_processing_activities` UI, no real Supabase Auth/Storage
backend reachable from this environment) — none of those are this
slice's concern, and none were touched.

### 16. Deferred decisions

None new — this slice fully closed the one item Slice C3's own
"Deferred decisions" list named for it (closing the `risks.owner_id`
tenant-scoping gap). Every other Slice C3 deferral remains open and
unchanged.

### 17. Recommended C4

Unchanged from Slice C3's own recommendation — not pressed, per
explicit instruction (STOP after C3.1). Findings remains the most
natural next candidate (same schema/UI pattern this project just
followed twice), among the options Slice C3's own report already
named.

### 18. Git status

All Slice C3.1 work is committed on `claude/primus-privacy-architecture-39p3gh`.

### 19. Remote synchronization

Pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies).

---

## Slice C3 — Risk Engine (Session 19, 2026-09-01)

**Scope:** exactly what PHASE C — RISK / Slice C3 instructed — turn
Assessment results into a structured, traceable Risk workflow using the
EXISTING Risk/RiskScoringModel/RiskControl/RiskProcessingActivity model
built (database-only) in Milestone 7 (migrations 0012/0013). No
Findings, Remediation, Validation, Maturity, Client Portal, Reporting,
or AI UI — none of those exist anywhere in this slice's changes. No new
domain table, no new migration (confirmed after direct inspection —
migration 0013 already carried every RLS policy, GRANT, trigger, and
audit hook this slice's writes needed, the same finding Slices C1/C2
made for their own tables).

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`, every
Risk/RiskScoringModel/RiskControl/Assessment/AssessmentControl/
AssessmentResponse/ControlTest/Evidence/EvidenceLink schema file, both
Risk migrations' exact triggers/policies/grants, the existing
authorization service, the existing Assessment workspace, the existing
Evidence implementation, existing tests (including
`tests/risk-remediation/*`, Milestone 7's own DB-only test suite), and
`package.json` fresh from disk before writing anything, per instruction.

### 1. Existing Risk architecture discovered

`risks` (DATA_MODEL.md §8): `engagement_id`/`organisation_id`/
`tenant_id` (engagement-scoped client data, like `Assessment`),
`assessment_response_id` (nullable — an additive FK from Milestone 7,
DECISIONS.md R-66, making the brief's own "Assessment Response → Risk"
prose relationship a real foreign key), `title`, `description`,
`likelihood`/`impact` (1-5, CHECK-constrained), `inherent_rating`
(`risk_rating` enum: low/medium/high/critical), `residual_likelihood`/
`residual_impact`/`residual_rating` (all nullable), `risk_scoring_
model_id` (NOT NULL, immutable after creation), `status` (`risk_status`
enum: open/mitigating/accepted/closed), `owner_id`, `previous_risk_id`
(nullable self-reference, for a deliberate re-score chain). `risk_
controls`/`risk_processing_activities` are plain insert/delete-only
junctions (Risk × Control, Risk × ProcessingActivity — DATA_MODEL.md
§11's "Risk N ←→ N Control"). `risk_scoring_models` is Tenant-scoped,
append-only practice content (mirrors `ControlLibraryVersion`'s shape
exactly — DECISIONS.md R-67): `matrix_definition` (JSONB), `is_active`
(a BEFORE INSERT trigger closes out the prior active row per tenant).
No genuine discrepancy was found between DATA_MODEL.md and the actual
schema — nothing to stop and report on that front. Two real,
consequential findings ARE recorded (not schema discrepancies, but
architectural facts this slice had to design around): no Risk-scoring
calculator exists anywhere in this codebase (DECISIONS.md R-96), and no
database trigger ties Risk to Assessment finalization at all
(DECISIONS.md R-98).

### 2. Risk schema used

Used exactly as built — no field renamed, no field added, no field
repurposed. `EvidenceLink` was NOT extended with a `risk` subject type
(confirmed by direct inspection of `evidence_links`' CHECK constraint:
only `assessment_response`/`control_test`/`remediation_action`/
`validation_record` are valid) — Risk has no direct Evidence
relationship in the approved schema at all; see item 7 below for how
traceability is nonetheless satisfied without inventing one.

### 3. Risk creation workflow

`lib/domain/risks.ts`'s `createRisk`: Browser → Server Action
(`createRiskAction`, in the existing Assessment workspace's own
`actions.ts`) → authenticate → `requireEngagementAccess` → validate →
`createRisk` → PostgreSQL (one transaction, two inserts: `risks` then
`risk_controls`) → RLS → audit (via the existing `risks_audit_log`/
`risk_controls_audit_log` triggers — no new audit mechanism). Mirrors
`createControlTest`'s (Slice C1) exact shape: only `assessmentId`/
`controlId` identify the source context; tenant/organisation/
engagement scope, the AssessmentResponse (if one exists), and the
active RiskScoringModel are ALL re-derived server-side, never trusted
from the caller (instructions §15). The `assessment_controls` row
lookup that proves the Control is in scope for the Assessment is the
same "proof by construction via composite FK" mechanism `createControlTest`
already established. Both inserts share one `withRequestDb` transaction
— no cross-system compensating cleanup is needed (unlike Evidence's
Storage+Postgres split in Slice C2), since a failure in either rolls
both back together.

### 4. Risk scoring architecture

No calculator, no algorithm, no hard-coded thresholds (DECISIONS.md
R-96) — `likelihood`/`impact`/`inherentRating` and the optional
residual triad are recorded exactly as the consultant enters them.
`risk_scoring_model_id` is always the tenant's own single currently-
`is_active` `RiskScoringModel` row, resolved server-side — never a
caller-supplied value (instructions §15's "do not accept browser-
supplied scoring-model identifiers without validation" is satisfied by
never accepting one at all). If no active model exists for the tenant,
`NoActiveRiskScoringModelError` is thrown and no Risk is created
(DECISIONS.md R-97) — no default matrix is invented, no
RiskScoringModel-authoring UI was built this slice (mirrors the
existing, still-true absence of a `ControlLibraryVersion`-authoring
UI).

### 5. Historical scoring integrity

Fully inherited from Milestone 7, unmodified: `risks_prevent_
reparenting` (migration 0013) makes `risk_scoring_model_id` immutable
after creation; a re-score under a newer model requires creating a NEW
Risk row via `previous_risk_id`, never an in-place edit. This slice
adds no new mechanism — `tests/app/risks.test.ts`'s own historical-
scenario test proves the exact worked example instructions §29
describes (Risk R1 under Model v1, then Model v2 created and made
active, R1 still resolves to v1) through the real application
functions, not only the pre-existing DB-level test
(`tests/risk-remediation/risk-scoring-versioning.test.ts`, Milestone 7,
still passing unchanged).

### 6. Risk source traceability

`risk_controls` (always exactly one row per Risk, created at Risk-
creation time) gives the source Control(s); `risks.assessment_
response_id` (nullable) gives the source AssessmentResponse, from which
the source Assessment is resolved via `assessment_controls` →
`assessments` (`getRiskDetail`). No duplicate relationship was created
— both are the EXISTING relationships DATA_MODEL.md §8/§11 already
name. `risk_processing_activities` (Risk × ProcessingActivity, the
other junction DATA_MODEL.md §11 names) is deliberately NOT built this
slice — PHASE C3 instructions §4's own enumerated traceability list
names Assessment/AssessmentControl/AssessmentResponse/ControlTest/
Evidence only, never ProcessingActivity, even though
PRODUCT_UX_BLUEPRINT.md's own broader Risk Register row (#13) mentions
"link control/PA" — this slice follows its own brief's narrower,
explicit scope rather than the blueprint's fuller eventual vision;
recorded as a known limitation (item 28), not a blueprint contradiction
requiring a documentation change.

### 7. Evidence traceability

Risk has no direct Evidence relationship in the approved schema (item
2 above) — `getRiskDetail`'s caller (the Risk detail page) resolves
Evidence by reusing the EXISTING `getControlTestsForControl`/
`getEvidenceSummaryForControl` functions (`lib/domain/assessments.ts`/
`lib/domain/evidence.ts`, unchanged) with the Risk's own resolved
source Assessment/Control/AssessmentResponse ids — the identical
functions the Assessment workspace itself already calls. No Evidence
metadata is copied onto `risks`; no duplicate storage/file relationship
was created (instructions §17).

### 8. Risk ownership

`assignOwnerToSelf` is the only assignment mechanism — `owner_id` is
either the calling user's own id or `NULL`; no code path anywhere
accepts an arbitrary target user (instructions §13's "do not build a
user-directory or invitation system," mirroring DECISIONS.md R-91's
identical precedent). Displayed on Risk list/detail via a `LEFT JOIN`
to `users`. A genuine database-level gap was found and recorded rather
than silently patched: `risks.owner_id` has no composite FK tying the
owner's tenant to the Risk's own, so a raw SQL route (bypassing this
application) is not independently rejected — DECISIONS.md R-99, proven
directly by a dedicated "[DOCUMENTED GAP]" test.

### 9. Risk status

Uses the existing `risk_status` enum exactly (open/mitigating/
accepted/closed) — no new state. `updateRiskStatus` is the one
supported post-creation edit; title/description/likelihood/impact/
ratings/owner are not editable after creation in this slice (a
minimal, professional form, not a full risk-register edit screen —
recorded as a known limitation).

### 10. Assessment workspace integration

The existing Assessment workspace
(`.../assessments/[assessmentId]/page.tsx`) gained a "Risks" section
under the currently-selected control, alongside the existing Evidence
section: a compact list of Risks already linked to this control
(`listRisksForControl`, scoped by the same `(engagementId, controlId)`
pair `risk_controls` actually stores), and a create-Risk form
(title/description/likelihood/impact/inherent rating/optional residual
triad/self-assign-to-me). Not gated behind `!finalized` (item 5/
DECISIONS.md R-98) — the only section in this workspace that remains
fully available on a finalized assessment. No redesign of the existing
workspace beyond this one addition.

### 11. Risk list

New route, `/organisations/[organisationId]/engagements/[engagementId]/risks`
— a real-data table (title, source control, inherent rating, residual
rating, status, owner), one batched query
(`listRisksForEngagement`), no dashboard, no chart, no analytics
(instructions §9). Linked from the Engagement detail page ("Risks"
section, mirroring the existing "Assessments" section) and from the
Assessment workspace's own Risks section ("View all engagement
risks").

### 12. Risk detail

New route, `/organisations/[organisationId]/engagements/[engagementId]/risks/[riskId]`
— identity, description, scoring (likelihood/impact/inherent rating,
residual triad if recorded, the pinned scoring methodology's name/
version), status (with the one status-update form), owner, source
Assessment/Control/AssessmentResponse (clickable back to the Assessment
workspace, landing on the exact source control — instructions §18),
relevant ControlTests, and relevant Evidence (via item 7's reused
functions). A plain, non-interactive text note states that Findings/
Remediation/Validation are not yet part of this application — never a
link or button implying functionality that doesn't exist (instructions
§8's own explicit caution).

### 13. Authorization

Reuses the existing centralized authorization service exactly —
`requireEngagementAccess` is the sole primitive this slice needed; no
new function was added to `lib/authorization/service.ts`. Every
function in `lib/domain/risks.ts` re-derives tenant/organisation/
engagement scope from the database itself before any read or write —
a browser-supplied id that does not match what the database
independently confirms is always rejected with
`NotFoundOrForbiddenError`.

### 14. RLS

Unchanged and unweakened — migration 0013's existing forced-RLS
policies on `risks`/`risk_controls`/`risk_scoring_models` remain
exactly as they were; directly re-confirmed via `psql \d+` this session
(see item 25 below), not only read from the migration file.

### 15. Audit

Relies on the existing audit architecture exactly — migration 0013's
`risks_audit_log` (AFTER INSERT OR UPDATE) and `risk_controls_audit_log`
(AFTER INSERT OR DELETE) triggers already cover every write this slice
performs; no new trigger, no second audit log.

### 16. Finalized-assessment behavior

Deliberately NOT blocked — see item 5/DECISIONS.md R-98 for the full
reasoning. Directly verified two ways: `tests/app/risks.test.ts`
creates a Risk from an already-finalized Assessment's control and
succeeds; a separate test queries `information_schema.triggers` for
`risks`/`risk_controls` directly and asserts no trigger name matches
`finaliz` (case-insensitive), rather than only trusting the absence
noticed while reading the migration file.

### 17. Performance/query approach

`listRisksForEngagement`/`listRisksForControl`/`getRiskDetail` are each
one to a small, fixed number of batched queries (`LEFT JOIN`s, not one
query per risk) — no N+1. `getRiskDetail`'s Evidence/ControlTest
resolution reuses the Assessment workspace's own already-efficient
functions rather than adding a new, parallel read path. No search
engine introduced — PostgreSQL is sufficient at this data volume
(instructions §25).

### 18. UI states

No risks (empty-state copy on both list and per-control section);
Risk creation (validated form, server-side error surfaced via the
existing `?error=` query-flag pattern); validation error (`InvalidRiskInputError`
messages surfaced the same way); unauthorized (`NotFoundOrForbiddenError`
→ generic "you do not have access" message, never a stack trace or
raw database error); not found (`getRiskDetail` → Next.js `notFound()`);
database failure (caught, logged server-side only, generic user-facing
message — instructions §17/§26 shared pattern with every prior slice);
finalized-assessment restriction (deliberately absent for Risk — the
section stays fully available, matching item 10/16); missing Evidence/
ControlTest/scoring information (each renders an honest "not yet
recorded"/"no control tests recorded"/"no evidence linked yet" message,
never a silent blank or a fabricated placeholder value).

### 19. Security tests

`tests/app/risks.test.ts`, 15 numbered database/application security
scenarios (PHASE C3 instructions §27), all passing, real PostgreSQL, no
mocked authorization:
1. Tenant A cannot read Tenant B's Risk.
2. Organisation A cannot read Organisation A2's Risk (same tenant).
3. Engagement A cannot read Engagement A3's Risk (same organisation).
4. A Risk stays correctly attached to the Assessment it actually came
   from, never conflated with a different Assessment sharing the same
   Control (the concrete, faithful reading of "Assessment A cannot
   access Risk from Assessment B" given Risk's own actual schema — see
   item 2: Risk has no direct `assessment_id` column).
5. Unauthorized user (no membership) cannot create a Risk.
6. Unauthorized user (no membership) cannot update a Risk's status.
7. A cross-tenant Control cannot be used to create a Risk (no matching
   `assessment_controls` row can exist).
8. Cross-tenant Evidence cannot be surfaced through a Risk's
   traceability read path — RLS-filtered even when the real id is
   known.
9. Browser-supplied organisation/engagement ids cannot cross a boundary
   even paired with a real Risk id.
10. A cross-tenant RiskScoringModel cannot be referenced — `createRisk`
    never accepts a caller-supplied model id at all (compile-time
    fact), and a raw SQL attempt is independently rejected by
    `risks_risk_scoring_model_tenant_fk`.
11. Anonymous access (SELECT and INSERT) is rejected.
12. A direct, malicious raw INSERT with forged tenant/organisation/
    engagement is rejected by RLS.
13. **[DOCUMENTED GAP, not a passing "protected" assertion]** the
    database does NOT independently prevent a cross-tenant `owner_id` —
    only the application's own self-assignment-only design does
    (DECISIONS.md R-99); the test proves the raw INSERT succeeds,
    rather than asserting a protection that does not exist.
14. Historical scoring configuration cannot be silently replaced (item
    5's historical scenario, run through the application layer).
15. Finalized-assessment behavior matches the approved database rules
    (item 16).

### 20. Scoring tests

Covered within the same file: valid likelihood/impact (1-5) accepted
and stored unchanged (no computed value); out-of-range likelihood
rejected by `InvalidRiskInputError` before any database write; a
partial residual triad (some but not all of likelihood/impact/rating)
rejected; a full residual triad accepted and stored; the created Risk's
`risk_scoring_model_id` always matches the tenant's actual currently-
active model (verified against a live query, not a hard-coded
expectation — this was itself a bug this session's own debugging pass
had to fix, since an earlier test in the same file changes which model
is active); the historical-scenario test (item 5) proves the pin
survives a newer model becoming active.

### 21. Historical scenario result

Constructed and verified exactly as instructions §29 describe:
Assessment A → Control C1 → Response = `partially_implemented` → Risk
R1 → RiskScoringModel v1.0. RiskScoringModel v2.0 is then created
(active for the tenant). A second Risk, R2, created afterward against a
different control, correctly pins to v2.0. R1's own
`risk_scoring_model_id` is confirmed unchanged (still v1.0) — current
configuration never silently rewrites historical Risk, matching the
existing `risks_prevent_reparenting` trigger's own guarantee, exercised
here through the real `createRisk` application function rather than
only a raw SQL fixture.

### 22. Exact application tests

`tests/app/risks.test.ts` (28 tests): Risk creation success (with and
without an existing AssessmentResponse, with a full/partial residual
triad, with an out-of-range value, against a Control not in the
Assessment's scope, against a finalized Assessment, with no active
scoring model); `updateRiskStatus` success; the 15 security scenarios
(item 19); `listRisksForEngagement`/`listRisksForControl` scoping and
ordering; `getRiskDetail`'s full resolution (scoring model, source
control(s), source assessment, source assessment response); and the
Evidence-traceability composition test (item 7, using the exact
functions the Risk detail page itself calls).

### 23. Exact full-suite count/results

```
npm run test:db   # fresh reset + full 8-directory suite incl. tests/app: 521/521 passing
npm run test:db   # run again for stability: 521/521 passing, identical results
```
(493 tests carried forward from Slice C2 + 28 new in
`tests/app/risks.test.ts` = 521.)

### 24. Typecheck/lint/build

```
npm run typecheck   # clean
npx eslint .         # clean (after fixing two react/no-unescaped-entities
                      # errors on the new "control's" apostrophes)
npm run build        # succeeds; both new Risk routes correctly reported
                      # dynamic (server-rendered on demand), none prerendered
```

### 25. Database inspection

Directly queried via `psql` (not only read from the migration file)
for `risks`/`risk_controls`/`risk_scoring_models`: forced RLS enabled
on all three; `_select`/`_insert`(/`_update` on `risks`,/`_delete` on
`risk_controls`) policies present, all scoped through
`can_access_engagement` (`risk_scoring_models` through the
`can_access_tenant`/`is_active_tenant_member` read/write asymmetry);
`risks_prevent_reparenting`/`risk_scoring_models_close_out_previous`/
the `_audit_log` triggers confirmed present, exactly as migration 0013
defines them; `GRANT`s to `authenticated` confirmed as `INSERT, SELECT,
UPDATE` on `risks` (no `DELETE` — never hard-deleted), `DELETE, INSERT,
SELECT` on `risk_controls` (no `UPDATE` — a link is created or removed,
never mutated), `INSERT, SELECT` on `risk_scoring_models` (append-only
— no `UPDATE`/`DELETE` at all); `risks_risk_scoring_model_tenant_fk`
confirmed present; `risks.owner_id`'s foreign key confirmed to be the
single-column `risks_owner_id_users_id_fk` only — directly confirming
item 8/DECISIONS.md R-99's documented gap, not merely inferred from
reading the schema file.

### 26. Files changed

- `lib/domain/risks.ts` (new) — `createRisk`, `updateRiskStatus`,
  `listRisksForEngagement`, `listRisksForControl`, `getRiskDetail`,
  `NoActiveRiskScoringModelError`, `InvalidRiskInputError`
- `components/ui/badge.tsx` (`riskRatingTone`/`riskStatusTone` added,
  deliberately kept separate from the existing `statusTone` — see the
  new functions' own doc comments for the naming-collision reasoning)
- `app/(shell)/.../assessments/[assessmentId]/actions.ts` (extended —
  `createRiskAction`)
- `app/(shell)/.../assessments/[assessmentId]/page.tsx` (Risks section
  added under the selected control)
- `app/(shell)/.../engagements/[engagementId]/page.tsx` ("Risks"
  section added, mirroring the existing "Assessments" section)
- `app/(shell)/.../engagements/[engagementId]/risks/page.tsx` (new —
  Risk list)
- `app/(shell)/.../engagements/[engagementId]/risks/actions.ts` (new —
  `updateRiskStatusAction`)
- `app/(shell)/.../engagements/[engagementId]/risks/[riskId]/page.tsx`
  (new — Risk detail)
- `tests/app/risks.test.ts` (new, 28 tests)
- `tests/app/helpers.ts` (re-exports `createRiskScoringModel`,
  `createRisk as createRiskFixture`, `linkRiskControl` from
  `tests/risk-remediation/helpers.ts`)
- `DECISIONS.md` (R-96 through R-100)
- `PROGRESS.md` (this entry)

No `drizzle/migrations/*` change — confirmed unnecessary after direct
inspection (items 1/25 above). No `DATA_MODEL.md` change — no new field
or entity; the one prose/schema tension found (item "risk creation
form," R-100's "rationale" field) was resolved by omission, per
instructions §7's own literal override, not by editing DATA_MODEL.md.

### 27. Dependencies changed

None. No `package.json` change this slice.

### 28. Known limitations

1. No RiskScoringModel-authoring UI exists — a fresh tenant with no
   active scoring model cannot create any Risk until one is created
   directly in the database (DECISIONS.md R-97), mirroring the
   existing, still-true absence of a ControlLibraryVersion-authoring
   UI.
2. No Risk-scoring calculator exists — `inherentRating`/
   `residualRating` are consultant judgment calls, not computed values
   (DECISIONS.md R-96).
3. `risks.owner_id` carries no tenant-scoping FK — a real, documented
   database-level gap; only this application's own self-assignment-only
   design prevents cross-tenant owner assignment in practice
   (DECISIONS.md R-99).
4. No Risk edit form beyond status — title/description/likelihood/
   impact/ratings/owner are not editable after creation.
5. No standalone, non-assessment-context Risk creation UI — every Risk
   this slice's UI can create is driven from an Assessment control's
   own context (instructions §3's own literal framing); a Risk
   identified "through other means" (risks.ts's own comment) remains
   reachable only via direct database action, mirroring Slice C2's
   identical Evidence-upload limitation.
6. `risk_processing_activities` (Risk × ProcessingActivity) is not
   built this slice — instructions §4's own traceability list does not
   name ProcessingActivity, unlike PRODUCT_UX_BLUEPRINT.md's fuller
   eventual Risk Register vision (row #13, "link control/PA").
7. Carries forward every prior slice's own recorded limitation
   (DECISIONS.md R-85/D-03, R-95): no real Supabase Auth/Storage
   backend is reachable from this environment.

### 29. Deferred decisions

- Building a RiskScoringModel-authoring screen (Practice/methodology
  administration — out of this slice's own scope).
- Building an actual Risk-scoring calculator, once a real, approved
  `matrix_definition` JSON convention and lookup algorithm are decided
  by a product/methodology decision (mirrors Maturity's own identical,
  already-documented deferral — PRODUCT_UX_BLUEPRINT.md §21).
- Closing the `risks.owner_id` tenant-scoping gap (DECISIONS.md R-99) —
  would require a schema change (a composite FK), out of this slice's
  approved scope.
- A full Risk edit form beyond status.
- Standalone, non-assessment-context Risk creation.

### 30. Recommended C4

Per explicit instruction, no recommendation is pressed — the user's own
brief states "we will review C3 before continuing" and forbids
proceeding to Findings/Remediation/Validation/Maturity/Client Portal/
Reporting/AI in this session. The natural next candidates, left open by
this slice's own chain (Assessment → ... → Risk → later Finding → later
Remediation → later Validation) and its own known limitations, are: (a)
Findings (the schema and its junctions already exist, database-only,
from Milestone 7 — the same pattern this slice just followed for Risk);
(b) resolving the RiskScoringModel-authoring gap; (c) whichever slice
the user's own roadmap names next. This report does not preempt that
choice.

### 31. Git status

All Slice C3 work is committed on `claude/primus-privacy-architecture-39p3gh`.

### 32. Remote synchronization

Pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies).

---

## Slice C2 — Secure Evidence Storage + Evidence Review (Session 18, 2026-09-01)

**Scope:** exactly what PHASE C / Slice C2 instructed — turn the
existing Evidence/Document/DocumentVersion/EvidenceLink data model into
a real, secure, file-based evidence workflow: private Supabase Storage
(abstracted behind a real/local adapter, since no production project
exists), server-side upload validation and SHA-256 checksums, the
existing Document/DocumentVersion versioning model (new upload = new
version, never an overwrite), Evidence pinned to a specific
DocumentVersion, EvidenceLink to AssessmentResponse/ControlTest, the
existing four-state review lifecycle, short-lived signed-URL
download/view, and an Evidence area added to the existing Assessment
workspace. No Risk, Findings, Remediation, Maturity, Client Portal,
Reporting, AI UI, and no C3 — none of those exist anywhere in this
slice's changes. No new domain table, no new migration (migration 0011
already carried every INSERT/UPDATE policy, GRANT, and audit trigger
this slice's writes needed — confirmed by direct inspection, matching
Slice C1's identical finding for the assessment-engine tables).

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`, the
Evidence/EvidenceLink/Document/DocumentVersion/Assessment/
AssessmentControl/ControlTest schemas, the existing authorization
service, the existing Assessment workspace, the existing Evidence
summary implementation, existing tests, `package.json`, environment
configuration, and the existing Supabase integration code fresh from
disk before writing anything, per instruction.

### 1. Storage architecture

`lib/storage/evidence-storage.ts` is the single storage abstraction
point. It reuses the EXISTING server-side Supabase integration
(`lib/supabase/server.ts`'s `createSupabaseServerClient`, built in
Slice A1 for Auth) rather than a second Supabase client architecture —
Storage calls run through the SAME authenticated-user session, never a
service-role client. An `EvidenceStorageAdapter` interface
(`upload`/`createSignedUrl`/`remove`) has two implementations, selected
by `getEvidenceStorageAdapter()` using the exact same
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` presence
check `lib/supabase/server.ts` already uses:
`SupabaseEvidenceStorageAdapter` (real, production-shaped) once those
env vars are real values, and `LocalEvidenceStorageAdapter` (real file
I/O against a git-ignored `.local-storage/evidence/` directory, real
SHA-256 checksums, a deliberately fake `local-evidence-storage://`
"signed URL" scheme) otherwise — the same "real once configured,
local/test until then" shape `lib/db/request-client.ts` already
established for the database connection (DECISIONS.md D-03/R-85).

### 2. Environment separation

Local dev/testing uses the local adapter automatically (no env vars
set). Production, once a real Supabase project exists, uses the real
adapter automatically the moment `NEXT_PUBLIC_SUPABASE_URL`/
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are set to that project's real values —
no code branch, no separate deployment path. No credential (service
role key, DB password, storage secret) is hard-coded anywhere in this
slice's code; `.env.example`'s existing placeholder entries
(`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) already document what production needs
and required no changes.

### 3. Mumbai residency implementation

Not re-implemented here — D-03 (resolved Session 17) already commits
to Supabase, AWS Mumbai (`ap-south-1`), for PostgreSQL, Storage, and
Auth in the same production project. This slice's storage code makes
no region-specific choice of its own: whichever Supabase project the
production env vars point to (Mumbai, per D-03) is what
`SupabaseEvidenceStorageAdapter` uses. Not a claim that the DPDP Act
itself requires India-only hosting — PRIMUS's own stronger-than-required
posture, per D-03's own text.

### 4. Bucket configuration

`supabase/storage-policies.sql` (new, written but explicitly **not
applied** to any project — instructions §34 forbid provisioning
production or creating a real bucket without approval): defines a
single, private `evidence` bucket (`public = false`) plus narrow
RLS-style Storage policies restricting `SELECT`/`INSERT` to
`authenticated` users whose claimed `organisationId` path segment
(extracted via `storage.foldername(name)[4]`) passes the existing
`public.can_access_organisation()` function — never a broad
"authenticated can read everything" policy (instructions §20). No
anonymous `SELECT`/`INSERT`, no public bucket, no service-role use in
browser code.

### 5. Object-key convention

`tenants/{tenantId}/organisations/{organisationId}/documents/{documentId}/{documentVersionId}`
— identifiers only, never a filename, person's name, email, or
free-form client name (the original filename stays in PostgreSQL, on
`document_versions.original_filename`, metadata only). A refinement
over Milestone 6's own illustrative example (DECISIONS.md R-65:
`tenants/<id>/documents/<id>/<hash-prefix>`) — see DECISIONS.md R-94
for the full reasoning.

### 6. Upload architecture

`lib/domain/evidence.ts`'s `uploadEvidence` (PHASE C2 instructions
§7): authenticate → `requireEngagementAccess` → validate the file
server-side → resolve and validate the EvidenceLink target (rejecting
a finalized Assessment's subject BEFORE any storage write, so no
orphan is even possible for that path) → upload the object to Storage
FIRST (with an application-generated id, avoiding an RLS/RETURNING
race, the same pattern every domain function since Slice B1 uses) →
only then insert Document/DocumentVersion/Evidence/EvidenceLink, all
within the SAME `withRequestDb` transaction the caller already opened.
Storage and Postgres are two different systems, so a true
cross-system transaction is impossible (instructions §7); the
`catch` block's explicit compensating cleanup (`storage.remove()`)
prevents a rolled-back database write from leaving a permanently
orphaned Storage object behind. `addDocumentVersion` (new version on
an existing Document) follows the identical upload-then-insert-then-
compensate shape.

### 7. File validation

`validateEvidenceFile` (server-side, in `lib/domain/evidence.ts`):
presence, non-empty size, a 25MB maximum, MIME type checked against a
closed allow-list (PDF/PNG/JPEG/DOC/DOCX/XLS/XLSX/plain text), and the
filename's own extension checked against that specific MIME type's
required extension(s) — never trusting a browser-supplied MIME type
alone (instructions §8). No elaborate content-inspection engine
(instructions §8's own explicit exclusion).

### 8. Checksum implementation

`sha256Buffer()` computes a real SHA-256 over the actual uploaded
bytes, server-side, both for the value stored on
`document_versions.checksum_sha256` and as the return value both
storage adapters produce from the same bytes they just wrote — never
trusting a browser-supplied checksum (instructions §10).

### 9. Document/version behavior

Every upload creates a brand-new `DocumentVersion` row; no code path
anywhere in this slice ever `UPDATE`s an existing version's file
metadata, and migration 0011's `document_versions_prevent_tampering`
trigger is the real, unconditional backstop regardless. `addDocumentVersion`
adds v2/v3/... to an existing logical `Document` without touching any
prior version or any Evidence row already pinned to it.

### 10. Evidence creation

Evidence is always created with an explicit `document_version_id` —
either the version just uploaded (`uploadEvidence`) or an
already-existing one (`createEvidenceForVersion`, for attaching a
version created moments earlier via `addDocumentVersion` without
re-uploading). No code path lets Evidence "float" to a document's
latest version; it is pinned to the exact version at creation and
stays there.

### 11. EvidenceLink behavior

Uses the existing `EvidenceLink` model exactly as it is — no new
generic polymorphic system. `resolveLinkSubject` supports linking to
either an `AssessmentResponse` or a `ControlTest`, re-deriving the
subject's own tenant/organisation/engagement and Assessment
finalization status from the database on every call (never trusting
the caller's own ids as proof of relationship). `unlinkEvidence`
removes an `EvidenceLink` row without touching the underlying Evidence
or DocumentVersion.

### 12. Evidence review lifecycle

`reviewEvidence` writes only the two existing consultant-decision
states (`accepted`/`rejected`) — `pending_review` is the row's own
default at creation, and `expired` is a separate, time-based state
this slice builds no transition for (no expiry-sweep job exists
anywhere in this project). Rejecting without a rationale is refused
server-side, not merely required on the form. Reviewer id
(`reviewed_by`) and timestamp (`reviewed_at`) are populated
server-side from the authenticated session, never trusted from the
caller. See DECISIONS.md's new entry: review is deliberately **not**
blocked by Assessment finalization, matching the database's own
existing behavior exactly (only `EvidenceLink` insert/delete is
locked).

### 13. Signed URL architecture

`getEvidenceDownloadUrl` (PHASE C2 instructions §17): authenticate →
`requireEngagementAccess` → re-derive the Evidence row and its
DocumentVersion's `storage_path` server-side (never accepting a
browser-supplied path) → issue a short-lived (300-second) signed URL →
return it directly, never persisted to PostgreSQL. Exposed to the
browser only via a plain GET Route Handler
(`.../evidence/[evidenceId]/download/route.ts`) that immediately
redirects to the signed URL — never returned as JSON for a client to
store, never exposes `storage_path` itself.

### 14. Authorization

Reuses the existing centralized authorization service exactly —
`requireEngagementAccess` is the sole authorization primitive this
slice needed (every evidence operation in this slice's UI is
engagement-scoped); no new function was added to
`lib/authorization/service.ts`. Every write/read function in
`lib/domain/evidence.ts` re-derives tenant/organisation/engagement
scope from the database itself (`resolveEngagementScope`,
`resolveLinkSubject`, and inline row lookups before every mutation) —
a browser-supplied `organisationId`/`engagementId`/`documentId`/
`documentVersionId`/`evidenceId` that does not match what the database
independently confirms is always rejected with
`NotFoundOrForbiddenError`, regardless of the caller's legitimate
access elsewhere.

### 15. RLS

Unchanged and unweakened — migration 0011's existing forced-RLS
policies on `documents`/`document_versions`/`evidence`/
`evidence_links` (`can_access_engagement`/`can_access_organisation`,
scoped by `engagement_id`/`organisation_id`) remain exactly as they
were; directly re-confirmed via `psql \d+` this session (see "Exact
database inspection" below) rather than only read from the migration
file.

### 16. Storage policies

`supabase/storage-policies.sql` (see item 4) — written, narrowly
scoped, **not applied to any real project**, and consequently **not
independently verified against real Supabase Storage** (DECISIONS.md
R-95). Storage authorization is documented as an ADDITIONAL layer on
top of, never a replacement for, database RLS and application
authorization.

### 17. Audit

Evidence write paths rely on the existing audit architecture exactly —
migration 0011's `documents_audit_log`/`document_versions_audit_log`/
`evidence_audit_log`/`evidence_links_audit_log` triggers already cover
Document/DocumentVersion/Evidence creation and EvidenceLink creation/
removal; no second audit log, no new trigger. One addition:
`getEvidenceDownloadUrl` writes a direct `audit_log` row
(`entity_type: 'evidence'`, `action: 'insert'`,
`reason: 'evidence_signed_url_issued'`) for every signed-URL issuance —
satisfying SECURITY.md §5's own already-approved requirement ("Every
signed-URL issuance is itself an auditable event"), the one place in
this project's history a Server Action/domain function writes directly
to `audit_log` rather than relying on a trigger, because issuing a URL
is not itself a row mutation any trigger could observe. Documented
here rather than silently expanded, per instructions §21.

### 18. Finalized-assessment behavior

New Evidence upload/creation against a finalized Assessment's subject
is rejected before any storage write (`resolveLinkSubject`'s
`assessmentStatus === "finalized"` check, backed by the database's own
`evidence_links_enforce_draft_mutable` trigger as the real,
unconditional enforcement). `unlinkEvidence` against a finalized
subject is rejected by the same database trigger. Evidence *review*
(accept/reject) is deliberately not blocked by finalization — see item
12 and the new DECISIONS.md entry for the full reasoning.

### 19. Malware-scanning limitation

D-05 remains explicitly unresolved. Every new `DocumentVersion` row's
`scan_status` is left at its column default (`'pending'`) — no code in
this slice ever transitions it to `'clean'` or any other value. No
scanner, real or fake, exists anywhere in this codebase. This is a
documented, known limitation, not silently glossed over.

### 20. Historical versioning test

`tests/app/evidence.test.ts`'s "Historical versioning" test exercises
the exact scenario instructions §27 specifies: Document D1/V1 →
Evidence E1 (linked to a ControlTest) is created; DocumentVersion V2 is
then added to D1; the test then confirms — all via the real, running
functions, not a hand-rolled query — that E1's own
`document_version_id` still points at V1 (never silently moved to
V2), V1's own row (checksum, filename, storage bytes on disk) is
byte-for-byte unchanged, V2 has its own independent identity/checksum/
storage object, V2 can be used to create an entirely new, independent
Evidence record (E2) without disturbing E1, and a Document-level
metadata change does not alter E1's pinned version.

### 21. Storage security tests

`tests/app/evidence-storage.test.ts` (8 tests, all passing) exercises
the `LocalEvidenceStorageAdapter` directly: object-key shape (no PII,
no filename), a real upload writing real bytes with a real matching
SHA-256, a signed-URL request for a never-uploaded key failing (mirrors
a real 404), signed-URL expiry encoding (not-yet-expired vs. already-
expired), `remove` genuinely deleting the object (a subsequent
signed-URL request then fails), idempotent `remove` on a
never-uploaded key, and adapter-instance caching. Instructions §26
items 18-22 (real Supabase bucket privacy, real public-URL rejection,
a real signed URL working, real signed-URL expiry against Supabase's
own infrastructure, revoked access not remaining available) are
**explicitly not executable in this environment** — no production (or
any real) Supabase project exists and this environment's own network
egress to `supabase.co` is blocked (confirmed since Slice A1). Reported
here per instructions §26's own "explicitly report that instead of
substituting a false claim," not silently skipped.

### 22. Database security tests

`tests/app/evidence.test.ts`, tests 1-10 (all passing, real PostgreSQL,
no mocked authorization): Tenant A cannot read Tenant B's Document/
DocumentVersion (1/2) or Evidence (3); Tenant A cannot create Evidence
or EvidenceLink under Tenant B (4/5); Organisation A cannot access
Organisation A2's Evidence, same tenant (6); Engagement A cannot access
Engagement A2's Evidence, same organisation (7); Evidence belonging to
another organisation cannot be linked to Assessment A's subject (8); a
historical DocumentVersion cannot be modified via a direct, raw UPDATE
(9); a finalized Assessment's EvidenceLink relationships respect
database locking via a direct, raw INSERT attempt (10).

### 23. Application tests

`tests/app/evidence.test.ts`, tests 11-16 (all passing): anonymous
upload rejected via a raw INSERT as `anon` (11); anonymous download/
read rejected (12); a user with no membership at all cannot upload
evidence (13); an unauthorized user cannot obtain a signed URL (14);
a browser-supplied `organisationId` claiming a different real
organisation than the engagement's own is rejected, not silently
trusted (15); there is no code path anywhere that accepts a
browser-supplied storage path/object key — every read resolves it
server-side from the authorized Evidence row (16). Item 17 (service-
role credentials never reach the browser bundle) is a build-inspection
check, not a vitest test — see item "Files changed"/build inspection
below.

Also covered in the same file, beyond the required security list:
upload success (Document + DocumentVersion v1, pending scan status,
Evidence + EvidenceLink, real file on disk with matching checksum);
`addDocumentVersion`; `createEvidenceForVersion`; review accept (with
reviewer/timestamp attribution) and reject (rationale required and
stored); `unlinkEvidence`; `getEvidenceDownloadUrl` (signed URL +
expiry + the audit_log row it writes); summary/version-list reads; and
the failure/cleanup scenarios in instructions §29 — invalid file (no
filename), oversized file, unsupported MIME type, MIME/extension
mismatch, duplicate upload (two independent Documents, never
deduplicated), and the finalized-assessment-upload-rejected-before-any-
storage-write case.

### 24. Exact full-suite count/results

```
npm run test:db   # fresh reset + full 8-directory suite incl. tests/app: 493/493 passing
npm run test:db   # run again for stability: 493/493 passing, identical results
```
(456 tests carried forward from Slice C1 + 8 new in
`tests/app/evidence-storage.test.ts` + 29 new in
`tests/app/evidence.test.ts` = 493.)

### 25. Typecheck/lint/build

```
npm run typecheck   # clean
npx eslint .         # clean
npm run build        # succeeds; the new download Route Handler correctly reported dynamic (0 B, server-rendered on demand)
```

### 26. Exact database inspection

Directly queried via `psql` (not only read from the migration file)
for `documents`/`document_versions`/`evidence`/`evidence_links`:
forced RLS enabled on all four; `_select`/`_insert`/`_update` (and
`evidence_links`' additional `_delete`) policies present, all scoped
through `can_access_engagement`/`can_access_organisation`; the exact
immutability/audit triggers confirmed present
(`documents_prevent_reparenting`, `document_versions_assign_version_number`,
`document_versions_prevent_tampering`,
`evidence_prevent_reparenting`,
`evidence_links_enforce_draft_mutable`, and an `_audit_log` trigger on
each table); `GRANT`s to the `authenticated` role confirmed as
`INSERT, SELECT, UPDATE` on `documents`/`document_versions`/`evidence`
(deliberately no `DELETE` — matching their own never-hard-deleted
posture) and `DELETE, INSERT, SELECT` on `evidence_links` (deliberately
no `UPDATE` — a link is created or removed, never mutated in place).

### 27. Browser-bundle credential inspection

`.next/static` (the production build's client bundle) was directly
searched for `SUPABASE_SERVICE_ROLE_KEY`, `service_role`,
`DATABASE_URL`, and `DB_PASSWORD` — no occurrences. `lib/` and `app/`
were also searched directly for any reference to
`SUPABASE_SERVICE_ROLE_KEY` — none exist anywhere in this project's own
code (the service-role credential is not used by anything this slice,
or any prior slice, built).

### 28. Files changed

- `lib/storage/evidence-storage.ts` (new) — the storage adapter module
- `lib/domain/evidence.ts` (new) — the Evidence domain module
  (`uploadEvidence`, `addDocumentVersion`, `createEvidenceForVersion`,
  `unlinkEvidence`, `reviewEvidence`, `getEvidenceDownloadUrl`,
  `getEvidenceSummaryForControl` moved and enhanced from
  `lib/domain/assessments.ts`, `listDocumentVersionsForDocument`)
- `lib/domain/assessments.ts` (`getEvidenceSummaryForControl` and its
  now-unused imports removed, replaced with a comment pointing to the
  new location)
- `supabase/storage-policies.sql` (new, unapplied — see items 4/16)
- `app/(shell)/.../assessments/[assessmentId]/evidence/[evidenceId]/download/route.ts`
  (new — the signed-URL-redirect Route Handler)
- `app/(shell)/.../assessments/[assessmentId]/actions.ts` (extended —
  `uploadEvidenceAction`, `reviewEvidenceAction`, `unlinkEvidenceAction`)
- `app/(shell)/.../assessments/[assessmentId]/page.tsx` (Evidence
  section rewritten: upload form, review Accept/Reject UI, Unlink
  button, view/download link)
- `next.config.mjs` (`experimental.serverActions.bodySizeLimit: "26mb"`)
- `.gitignore` (`.local-storage/` added, git-ignored local storage root)
- `tests/app/evidence-storage.test.ts` (new, 8 tests)
- `tests/app/evidence.test.ts` (new, 29 tests)
- `tests/app/assessment-workspace.test.ts` (import path updated for the
  moved `getEvidenceSummaryForControl`; no behavior change, all 24
  tests still pass)
- `DECISIONS.md` (R-94, R-95, and two further entries — see item 26
  below)
- `PROGRESS.md` (this entry)

No `drizzle/migrations/*` change — confirmed unnecessary after direct
inspection (item 26 above / item "Storage architecture"). No
`DATA_MODEL.md` change — no new field or entity.

### 29. Dependencies changed

None. `@supabase/supabase-js`/`@supabase/ssr` were already present
(Slice A1); no `package.json` change this slice.

### 30. Known limitations

1. No production Supabase project is provisioned; no real Supabase
   Storage call (upload, signed URL, bucket privacy, public-URL
   rejection) has been exercised anywhere in this project
   (DECISIONS.md R-95).
2. `supabase/storage-policies.sql` is written but unapplied and
   unverified against a real bucket (DECISIONS.md R-95).
3. Malware scanning (D-05) remains unresolved; every upload's
   `scan_status` stays `'pending'`.
4. The full "successful Storage upload → a genuine mid-transaction
   database failure → confirmed compensating cleanup" path is not
   independently exercised end-to-end by an automated test — mirrors
   R-92's identical, already-documented conclusion (new DECISIONS.md
   entry this slice).
5. Evidence review is not blocked by Assessment finalization, by
   design, matching the database's own existing trigger behavior (new
   DECISIONS.md entry this slice) — only `EvidenceLink` insert/delete
   is locked.
6. No standalone, organisation-level (non-engagement-scoped) Evidence
   upload UI — this slice's UI is driven entirely from the Assessment
   workspace, matching Slice C1's own engagement-scoped framing;
   `engagement_id IS NULL` Evidence remains reachable only via direct
   database action, same as before this slice.
7. `expired` review status has no automated transition (no expiry-sweep
   job) — carried as a known, unbuilt state, matching instructions §14's
   own "no approvals workflow beyond this."
8. Carries forward Slice A1/B1/B2/C1's own recorded limitation
   (DECISIONS.md R-85/D-03): no real Supabase Auth backend is reachable
   from this environment.

### 31. Recommended C3

Per explicit instruction, no recommendation for what C3 should contain
is being pressed — the user's own brief already states "we will review
C2 before continuing" and forbids proceeding to C3 in this session. The
natural candidates left open by this slice's own known limitations are:
(a) a genuine Supabase project provisioning step (outside this
session's own bounds), after which the real storage adapter and
`supabase/storage-policies.sql` can finally be verified against real
infrastructure; (b) D-05 (malware scanning) resolution; (c) whichever
Phase C slice the user's own roadmap names next. This report does not
preempt that choice.

### 32. Git status

All Slice C2 work is committed on `claude/primus-privacy-architecture-39p3gh`.

### 33. Remote synchronization

Pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies).

---

## D-03 Resolution — Data Residency (Session 17, 2026-09-01)

**What happened:** the product owner resolved DECISIONS.md's
previously-open D-03 ("Is there a hard requirement... that client
evidence and personal-data-adjacent metadata be hosted in an India
Supabase region?"). Full decision text, rationale, and the DPDP
clarification are recorded in DECISIONS.md D-03 (moved from "DECISION
REQUIRED items (still open)" into "Resolved blocking decisions,"
alongside D-01/D-02, in numeric order). This session recorded that
decision only — no other work was performed.

**Decision, summarized** (see DECISIONS.md D-03 for the complete text):
Supabase, AWS Mumbai region `ap-south-1` — PostgreSQL, Storage, and
Auth all in the same production project; other regional processing
uses Mumbai where supported; no production client documents until that
project exists. Explicitly **not** a claim that the DPDP Act requires
India-only hosting — the Act permits the Central Government to restrict
transfers to specified countries/territories, and no such notification
currently exists; PRIMUS is choosing India-region residency as its own,
stronger-than-legally-required posture.

**Explicitly not done this session** (per instruction): the production
Supabase project was not provisioned; Supabase Storage was not
implemented; the database schema was not modified; C2 was not started.
`lib/db/request-client.ts`'s own documented limitation (DECISIONS.md
R-85 — `DATABASE_URL` still points at a local Postgres superuser, not a
real Supabase `authenticator` role) is unchanged by this decision; a
brief "Updated" note was appended to R-85 pointing at D-03's resolution
without altering R-85's own still-accurate substance, matching this
project's established practice of appending rather than rewriting
(the same practice already used for R-88's own supersession note in
Slice B2).

**Remaining production-readiness controls** (explicitly not addressed
by region selection alone, per D-03's own text): private storage,
signed URLs, Row-Level Security actually running in the production
project (already built at the schema level, Milestones 1-9), production
authentication configuration, the existing `audit_log` mechanism
actually receiving real production traffic, encryption at rest/in
transit, malware/content scanning on uploads (D-05, still open),
retention/deletion policy and enforcement, a Data Processing Agreement/
equivalent processor contractual control with Supabase, tested backup/
recovery, production monitoring, and an exercised incident-response
plan. None of these are newly introduced by this session; all were
already implicitly required for production go-live and are now
explicitly enumerated against D-03's own entry so they aren't mistaken
for "handled" by having picked a region.

### Consistency check (performed after the documentation update)

- Confirmed D-03 is the only "DECISION REQUIRED" item touched — D-04
  (data-principal PII), D-05 (malware scanning), and D-06 (billing)
  remain open, unchanged, and correctly still listed under "DECISION
  REQUIRED items (still open)".
- Confirmed D-03's entry was placed in numeric order (D-01, D-02, D-03)
  within "Resolved blocking decisions", matching D-01/D-02's own
  existing format (`### D-0N — RESOLVED — <title>`, a **Decision**
  paragraph, and an *Original framing (for record)* footer preserving
  the original open question verbatim) — not left out of order or in a
  differently-shaped entry.
- Confirmed DECISIONS.md's own top status line was updated to reflect
  D-03 as resolved (previously read "D-03/D-05 remain open"; now
  correctly lists only D-04/D-05/D-06 as open).
- Grepped every remaining `D-03` reference in DECISIONS.md (R-24, the
  Milestone 6/8A inline mentions, R-85): R-24 and the Milestone 6/8A
  mentions are accurate, dated historical statements of the project's
  state *at that session* and were deliberately left unchanged, per
  this project's established practice of not rewriting history; R-85 —
  the one still-current, forward-facing reference — received the
  appended "Updated (Session 17)" note above rather than a rewrite.
- Grepped SECURITY.md, ARCHITECTURE.md, and DATA_MODEL.md for `D-03`/
  "data residency"/"Mumbai"/"ap-south" — no references exist in any of
  them, so no inconsistency was introduced or left behind by not
  updating those files (also consistent with the explicit instruction
  to update only DECISIONS.md and PROGRESS.md this session).
- Confirmed no code, schema, migration, or dependency file was touched
  (`git status` shows only `DECISIONS.md`/`PROGRESS.md` modified).

### Git status / remote synchronization status

Committed on `claude/primus-privacy-architecture-39p3gh` and pushed to
`origin`, with local and remote `HEAD` confirmed matching (see the
commit this entry accompanies). No commits are queued or pending push.

---

## Slice C1 — Assessment Workspace + Control Assessment (Session 16, 2026-09-01)

**Scope:** exactly what PHASE C / Slice C1 instructed — turn the
existing Assessment Engine into a usable consultant workspace:
Engagement → Assessment → Controls → Control detail → Assessment
Response → Rationale → Control Test → Evidence summary → Save → Audit.
No Risk UI, Findings UI, Remediation UI, Maturity UI, client portal,
reporting, AI, Evidence upload, or dashboards — none of those exist
anywhere in this slice's changes. No new domain table, no new migration
(confirmed after inspection — see below).

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`, every
Assessment/Control-Library/Requirement/Evidence/ControlTest schema
file, migrations 0007/0009/0011's exact RLS policies and triggers, the
existing authorization service, the existing `lib/domain/
assessments.ts`/`lib/domain/engagements.ts`, existing app routes/UI
components, and existing tests fresh from disk before writing anything,
per instruction.

### 1. Assessment list architecture

`lib/domain/assessments.ts`'s new `listAssessmentsForEngagement` — one
batched `GROUP BY` query (assessment × control-library-version LEFT
JOIN assessment_controls LEFT JOIN assessment_responses), not one query
per assessment. Progress is the exact read model
PRODUCT_UX_BLUEPRINT.md §7 already specifies verbatim: "'N of M
controls responded' is a COUNT/COALESCE over existing rows, not a
stored percentage column" — "responded" means a response row exists at
all (any rating, including an explicitly-recorded `not_assessed`), not
this slice's own invented interpretation, so no DECISIONS.md entry was
needed for it. Rendered at a new route,
`/organisations/[organisationId]/engagements/[engagementId]/
assessments` — the engagement detail page's own inline assessment list
(Slice A1) was simplified to a summary + link to this new page, rather
than duplicating the progress-computation logic on two pages;
`getEngagementDetail`'s own return shape (and its existing tests) were
left unchanged.

### 2. Assessment workspace architecture

The existing route,
`/organisations/[organisationId]/engagements/[engagementId]/
assessments/[assessmentId]`, is rewritten from Slice A1's minimal
one-card-per-control vertical slice into the real workspace: a
left-hand control sidebar (search/filter/completion indicator) and a
main area for whichever control is currently selected (`?control=`
query param). `getAssessmentDetail` fetches the assessment header plus
every control row's own identity and current response in ONE further
query — no per-control follow-up query for the sidebar. Selecting a
control lazily fetches exactly that control's own Requirements/
ControlTests/Evidence (three more queries, only for the one selected
control) — never eagerly for every control.

### 3. Control navigation

Previous/Next links, computed from the already-fetched control-row
array's own order (no extra query), preserving the current search/
filter query string. Search/filter (instructions §22) is applied
in-memory over the already-fetched, PostgreSQL-sourced, bounded-size
control list — not a second, filtered SQL query — since progress must
always reflect the *unfiltered* whole and a real Assessment's control
count (tens to a few hundred) doesn't need a dedicated search engine
(instructions §20's own "do not introduce a search engine"). Documented
inline in `lib/domain/assessments.ts` and the workspace page.

### 4. Control/Requirement display

Control identity (code/title/description/type) comes from the same
single query as the sidebar — no extra fetch. Requirements come from
the existing `ControlRequirement` junction (`getControlRequirements`),
each with its own primary `RegulatoryReference` (citation/title/
framework) via `requirements.primary_regulatory_reference_id` — no new
relationship table. Secondary regulatory citations
(`requirement_regulatory_references`) exist but are not shown —
instructions §8 name only the `Requirement → RegulatoryReference` path,
and this keeps the slice from expanding beyond what was asked.

### 5. AssessmentResponse workflow

`updateAssessmentResponse` (Slice A1) is functionally unchanged — same
authorization/validation/mutation shape, same finalization pre-check
plus the real database trigger as backstop. Only its Server Action's
redirect target changed, to preserve the workspace's current control
selection and search/filter state (`returnTo`, validated to be within
this same assessment's own workspace path — open-redirect hygiene, not
a security boundary, since the destination re-authorizes independently
regardless of how it was reached) instead of always bouncing to the
bare assessment URL.

### 6. Rationale workflow

`decision_rationale` is edited in the same form/Server Action as the
effectiveness rating (matches DATA_MODEL.md's own AssessmentResponse
shape — one row, one form) — server-side Zod validation
(`max(4000)`), no new commentary field invented.

### 7. ControlTest workflow

New `createControlTest` (`lib/domain/assessments.ts`) — the same
Browser → Server Action → authenticate → authorize → validate → domain
function → PostgreSQL → RLS → audit shape as every other write path.
Confirms the target control is genuinely in scope for the assessment
(an `assessment_controls` row exists for that exact `(assessmentId,
controlId)` pair) before inserting — this single check also proves
"Control belongs to Assessment's pinned library version" (instructions
§18), since `assessment_controls`' own composite FKs make it
structurally impossible for such a row to exist otherwise. A clean
pre-check against a finalized Assessment gives a friendly error; the
existing `control_tests_enforce_draft_mutable` trigger (migration 0009)
remains the real, unconditional enforcement. No ControlTest editing
built (create + view only) — instructions §13 only ask for "create...
save... see the saved result," not editing.

### 8. Evidence summary

Read-only. `getEvidenceSummaryForControl` unions Evidence linked to the
selected control's own AssessmentResponse and to any of its
ControlTests (via the existing generic `EvidenceLink` junction — no new
relationship table), returning only `title`/`evidenceType`/
`reviewStatus`/`qualityRating` — `storage_path` (or any document
filename/mime-type/checksum field) is never selected anywhere in this
slice's code, confirmed by direct grep of the changed files. No upload,
no Supabase Storage, no signed URLs (instructions §27).

### 9. Progress calculation

See §1 above — the exact PRODUCT_UX_BLUEPRINT.md §7 read model, applied
identically at both the list level (`listAssessmentsForEngagement`) and
the single-assessment level (`getAssessmentDetail`, computed in memory
from the already-fetched control rows rather than a second aggregate
query).

### 10. Finalization behavior

The workspace renders zero editable form controls for a finalized
assessment — no response form, no rationale field, no "record control
test" form — matching the server's own unconditional rejection, not
merely a disabled button (instructions §16). Both write paths
(`updateAssessmentResponse`, `createControlTest`) still independently
re-check and reject server-side regardless of what the UI renders. No
"Finalize" action was built this slice — see DECISIONS.md R-93 for the
full reasoning (the brief does not ask for one, and the current
Role/Permission catalogue has no real "may finalize" permission to gate
it with, per the R-84 concern this slice deliberately does not
reopen).

### 11. Authorization

Reused entirely — no second authorization framework, no new
`lib/authorization/service.ts` function needed for this slice.
`requireEngagementAccess` (Slice A1) gates every client-engagement-data
read/write (Assessment/AssessmentControl/AssessmentResponse/
ControlTest), re-derived from each row's own authoritative database
values, never from a browser-supplied id. Requirement/RegulatoryReference/
Control/ControlLibraryVersion reads need no explicit application-layer
check of their own: they are Tenant-owned methodology content under
`can_access_tenant` (migration 0007), and a caller who has already
passed `requireEngagementAccess` on the Assessment structurally
satisfies `can_access_tenant` too (its own "any accessible organisation
under this tenant" fallback) — RLS itself is the correct read boundary
for practice-owned reference content, exactly as it already was before
this slice.

### 12. RLS

No new policy, GRANT, or trigger was added this slice — confirmed by
direct inspection (migration 0009 already fully covers
assessments/assessment_controls/assessment_responses/control_tests with
INSERT/UPDATE policies, GRANTs, and audit triggers for `authenticated`,
since Milestone 5). RLS/FORCE RLS confirmed still enabled on every
table this slice reads or writes (§30 below).

### 13. Audit

No new audit mechanism. Every material write this slice performs
(AssessmentResponse insert/update, ControlTest insert) is already
covered by migration 0009's existing triggers
(`assessment_responses_audit_log`, `control_tests_audit_log`, both
reusing `log_methodology_change()` unchanged) — verified directly by a
dedicated test asserting real `audit_log` rows with correct
`actor_user_id`/`entity_type`/`action`.

### 14. Performance/query approach

No N+1 anywhere in this slice's own code: the Assessment list is one
`GROUP BY` query; the workspace's sidebar is two queries total
(assessment header, then all control rows in one join); selecting a
control adds exactly three more queries (Requirements, ControlTests,
Evidence), only for that one control, never for the whole list. No
premature caching, no search engine introduced (instructions §20).

### 15. Accessibility/responsiveness

Every input/select/textarea has a real `<label htmlFor>`; the search
input is `type="search"`; error/status banners use `role="alert"`/
`role="status"`; the sidebar's completion indicator pairs a colour
(emerald/slate) with a `✓`/`—` glyph plus screen-reader-only text
("Responded"/"Not yet responded") — never colour-only; `aria-current`
marks the selected control in the sidebar; global visible focus rings
(Slice A1's `globals.css`) apply unchanged. Layout is a CSS grid
(`lg:grid-cols-[280px_1fr]`) that stacks to a single column below the
`lg` breakpoint — desktop-first, degrades gracefully, no separate
mobile experience built.

### 16. Exact security tests

All 12 required scenarios (instructions §19), each run against real
PostgreSQL with no mocked permission function — see
`tests/app/assessment-workspace.test.ts`:
1. Tenant A cannot view Tenant B's Assessment.
2. Organisation A1 cannot view Organisation A2's Assessment (same
   tenant).
3. Engagement A1 cannot view Engagement A1b's Assessment (same
   organisation, different engagement).
4. An unauthorized user (no membership at all) cannot update
   AssessmentResponse.
5. An unauthorized user cannot create ControlTest.
6. AssessmentResponse cannot be changed after finalization.
7. ControlTest cannot be created after finalization, where the
   database requires locking.
8. A cross-library Control cannot be attached to an Assessment pinned
   to a different library version (a raw, direct INSERT attempt,
   rejected by `assessment_controls`' own composite FKs).
9. Evidence from another organisation cannot appear in the workspace,
   even given its real id (RLS-filtered, not merely application-layer
   filtered).
10. Malicious browser-supplied ids cannot cross tenant/organisation/
    engagement boundaries — `updateAssessmentResponse` re-derives scope
    from the AssessmentControl's own row regardless of the caller's own
    legitimate access elsewhere.
11. Anonymous access is blocked (rejected at the GRANT layer —
    `assessments` grants nothing to `anon` at all).
12. A direct request that skips the application authorization layer
    entirely is still rejected by RLS.

### 17. Exact application tests

Assessment list (real progress/methodology); Assessment access; Control
display; Requirement mapping (including "no requirements mapped"); AssessmentResponse
display (respondent/submitted-at); AssessmentResponse update + rationale
update; ControlTest display (scoped to the correct control+assessment
only); ControlTest creation; Evidence summary; progress calculation
(explicitly verifying the "any response row counts, regardless of
rating value" read model); finalized state; audit attribution for both
AssessmentResponse and ControlTest writes.

### 18. Exact full-suite count/results

```
npm run test:db   # fresh reset + full 10-directory suite incl. tests/app: 456/456 passing
npm run test:db   # run again for stability: 456/456 passing, identical results
```
(432 tests carried forward from Slice B2 + 24 new in
`tests/app/assessment-workspace.test.ts` = 456.)

### 19. Typecheck/lint/build

```
npm run typecheck   # clean
npx eslint .         # clean
npm run build        # succeeds; both new/changed assessment routes correctly reported dynamic, none prerendered
```

### 20. Files changed

- `lib/domain/assessments.ts` (substantially extended: `listAssessmentsForEngagement`,
  `getControlRequirements`, `getControlTestsForControl`,
  `getEvidenceSummaryForControl`, `createControlTest`; `getAssessmentDetail`
  extended with progress/methodology-label/control-type/description/
  system-suggested-rating/respondent-email; `updateAssessmentResponse`
  unchanged in behavior)
- `components/ui/badge.tsx` (`statusTone` extended with ControlTest/Evidence-review status mappings)
- `app/(shell)/organisations/[organisationId]/engagements/[engagementId]/assessments/page.tsx` (new — Assessment list)
- `app/(shell)/organisations/[organisationId]/engagements/[engagementId]/assessments/[assessmentId]/page.tsx` (rewritten — the workspace)
- `app/(shell)/organisations/[organisationId]/engagements/[engagementId]/assessments/[assessmentId]/actions.ts` (extended — `createControlTestAction`; `updateAssessmentResponseAction`'s redirect now preserves workspace state)
- `app/(shell)/organisations/[organisationId]/engagements/[engagementId]/page.tsx` (assessment section simplified to a summary + link to the new list page)
- `tests/app/assessment-workspace.test.ts` (new, 24 tests)
- `tests/app/helpers.ts` (re-exports `createRegulatoryReference`, `createRequirement`, `linkControlRequirement`, `createControlTest`)
- `DECISIONS.md` (R-93)
- `PROGRESS.md` (this entry)

No `drizzle/migrations/*` change — confirmed unnecessary after direct
inspection (§1/§12 above). No `DATA_MODEL.md` change — no new field or
entity.

### 21. Dependencies changed

None. No `package.json` change this slice.

### 22. Known limitations

1. No "Finalize Assessment" action exists yet (DECISIONS.md R-93) — a
   future slice needs a real "who may finalize" authorization answer
   first.
2. Secondary regulatory-reference citations
   (`requirement_regulatory_references`) are not shown, only the
   primary one — instructions §8 name only the primary path.
3. ControlTest editing is not built — create + view only.
4. No Evidence upload/linking UI (explicitly out of scope, instructions
   §27) — the workspace only displays existing `EvidenceLink`
   relationships.
5. Carries forward Slice A1/B1/B2's own recorded limitation
   (DECISIONS.md R-85/D-03): no real Supabase Auth backend is reachable
   from this environment.

### 23. Deferred decisions

- Building the "Finalize Assessment" action and its real, narrower
  authorization rule (DECISIONS.md R-93).
- Showing secondary regulatory-reference citations per Requirement.
- ControlTest editing/deletion.
- Evidence upload, linking, and review-decision UI (a distinct future
  slice per instructions §27).

### 24. Recommended C2

With the assessment workspace now real and navigable end-to-end, the
natural next steps are either: (a) Evidence upload (Supabase Storage
integration, deferred by D-03/this slice's own §27 exclusion) so the
Evidence summary this slice already displays has something new to
link to; or (b) the deferred Finalize action, once a genuine
Role/Permission-based "may finalize" answer is decided. This report
does not preempt the user's own choice.

### 25. Git status

All Slice C1 work is committed on `claude/primus-privacy-architecture-39p3gh`.

### 26. Remote synchronization

Pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

## Slice B2 — Organisation Membership + Engagement Creation (Session 15, 2026-09-01)

**Scope:** exactly what PHASE B2 instructed — solve the onboarding
chain Slice B1 identified (Tenant → Organisation → OrganisationMembership
→ Engagement → EngagementMembership) through the existing membership
model. No client portal, no full engagement workspace, no assessment
workspace, no role-management console, no invitations/email/SSO/user
provisioning. No new domain table, no new role hierarchy — one narrow,
purely additive migration closing a real, confirmed schema/policy gap.

Read `DATA_MODEL.md`, `SECURITY.md`, `ARCHITECTURE.md`, `PRODUCT_SPEC.md`,
`PRODUCT_UX_BLUEPRINT.md`, `DECISIONS.md`, `PROGRESS.md`, the `users`/
`organisations`/`organisation_memberships`/`engagement_memberships`/
`engagements` schema files, every relevant RLS migration, the
authorization service, the existing organisation domain/actions/pages,
and the existing tests fresh from disk before writing anything, per
instruction. Did not assume the membership model — confirmed by direct
`pg_policy`/`information_schema.role_table_grants` inspection (see §1
below) before designing anything.

### 1. Existing membership architecture discovered

`organisation_memberships` and `engagement_memberships` had a `SELECT`
policy and `GRANT SELECT` for `authenticated` only — confirmed by direct
inspection of migration 0001 and of `pg_policy`/
`information_schema.role_table_grants` on a fresh database, before
writing any application code. Neither table had ever had an `INSERT`
policy or `GRANT INSERT`. This means, as the schema stood before this
slice, a membership row could only ever be created by a superuser/
migration/seed script — never by ordinary authenticated application
traffic. This is the structural root cause of Slice B1's own finding
(DECISIONS.md R-88): a bare TenantMembership is sufficient to create an
Organisation (`organisations_insert`'s `WITH CHECK`) but not to grant
anyone — including its own creator — real read access to it
(`organisations_select` requires organisation- or engagement-level
membership). `organisations_select`/`can_access_organisation` and
`engagements_select`/`can_access_engagement` were confirmed unchanged —
this slice does not touch either.

### 2. Design decision for organisation membership

Who can create OrganisationMembership: an active tenant member of the
organisation's own tenant, granting to a user who is themselves a
member of that same tenant — the exact rule `organisations_insert`
already uses for creating the organisation itself
(`is_active_tenant_member`), plus a same-tenant guard on the *target*
user (instructions §5's two "never allow" cases). Implemented as a new
RLS `WITH CHECK` policy (migration 0019, §5 below), not an
application-layer-only restriction — RLS remains the real backstop.
`createOrganisation` (`lib/domain/organisations.ts`) now calls this
policy implicitly by inserting the creator's own membership row
immediately after the organisation, in the same transaction (see §5,
§10). The role granted is `Client Administrator` — a consequential
interpretation (see §7, DECISIONS.md R-90) since no seeded
organisation-scope role is PRIMUS-practice-facing. **Deferred:**
granting membership to a user *other than* the creator — no UI/Server
Action was built for it, though the RLS policy itself already permits
it for a future slice (see §20, DECISIONS.md R-91).

### 3. Design decision for engagement membership

Who can create EngagementMembership: the exact same set of people who
may create an Engagement in the first place — a tenant member of the
engagement's own tenant, or an organisation-wide member of the
engagement's own organisation (mirrors `engagements_insert`'s own rule
exactly), plus the same same-tenant guard on the target user.
`createEngagement` (`lib/domain/engagements.ts`) grants the creator's
own membership immediately after the engagement, in the same
transaction. The role granted is `Engagement Manager` — a clean,
unambiguous fit (db/seed/roles.ts's own description), not a comparable
interpretive stretch to the organisation-scope choice (DECISIONS.md
R-90).

### 4. Engagement creation architecture

`/organisations/[organisationId]/engagements/new` — Browser → Server
Action (`createEngagementAction`) → authenticate → Zod-validate → 
`createEngagement` → authorize (`requireOrganisationAccess` — matches
how the page itself is gated — AND `requireEngagementCreateAccess`,
the correctly-scoped mirror of `engagements_insert`'s own rule, since
the first check alone is broader than what RLS would actually allow;
see the function's own docstring) → validate methodology → check for a
visible duplicate name → insert engagement (id generated
application-side, no `.returning()` — the same RLS/`RETURNING`
interaction R-87 found, applied uniformly) → insert the creator's
EngagementMembership → audit (automatic, via trigger) → redirect to the
new Engagement Detail page.

### 5. Transactional workflow

No new transaction API. `lib/db/request-client.ts`'s existing
`withRequestDb` already wraps its whole callback in one real Postgres
transaction (`BEGIN`/`COMMIT` on success/`ROLLBACK` on any thrown
error, unchanged since Slice A1) — `createOrganisation` and
`createEngagement` each perform their two `INSERT`s sequentially inside
that one callback, with no `try/catch` between them, so any failure
anywhere in either function rolls back everything, never leaving a
half-created onboarding state. See DECISIONS.md R-92 for the full
reasoning, including why an artificial third-statement failure was not
manufactured purely to demonstrate this (real, already-tested)
mechanism further.

### 6. Methodology/control-library selection

`createEngagement`'s `controlLibraryVersionId` input, if provided, is
validated against the SAME tenant as the organisation and against
`status IN ('published', 'retired')` — a clean, pre-check version of
exactly what migration 0007's `engagements_prevent_control_library_pin_
change` trigger already enforces at the database level regardless (the
trigger remains the real, unconditional enforcement; the pre-check only
turns its raw exception into a clean `InvalidMethodologyError`, the
same pattern Slice A1's `updateAssessmentResponse` established for
finalization). `listSelectableControlLibraryVersions` populates the
form's dropdown with only the caller's own tenant's published/retired
versions — never a draft, never another tenant's.

### 7. Authorization changes

`lib/authorization/service.ts` gained `getUserTenantId` (Slice B1) and
two new B2 additions: `canCreateEngagement`/`requireEngagementCreateAccess`
(tenant member OR organisation member of the target organisation — an
independently-implemented mirror of `engagements_insert`'s own RLS
rule, matching this project's two-layer model). No new authorization
*mechanism* — the existing TenantMembership → OrganisationMembership →
EngagementMembership hierarchy is used exactly as designed. `lib/domain/
roles.ts` (new, tiny) adds `getRoleIdByName` — resolves a fixed,
server-chosen role name to its id; never accepts a browser-supplied
role.

### 8. Route changes

New: `/organisations/[organisationId]/engagements/new` (page + Server
Action). No deeper routes — `/organisations/[organisationId]/
engagements/[engagementId]` (already existing since Slice A1) is
enhanced (§10 below), not replaced.

### 9. Organisation detail changes

`getOrganisationDetail` (`lib/domain/organisations.ts`) now also returns
`tenantId` (needed for the engagement-creation authorization/methodology
checks) and `members` (active `organisation_memberships` joined to
`users`/`roles` — readable because the caller already passed
`requireOrganisationAccess`, so fellow members share the caller's own
membership scope under `users_select`'s existing RLS). The page
(`app/(shell)/organisations/[organisationId]/page.tsx`) now shows a
Members section and a "Create Engagement" link, gated by
`canCreateEngagement`. Slice B1's own "not yet visible" fallback branch
(shown when a just-created organisation couldn't be read back) is now
dead code — since creation always grants real access — and was removed;
replaced with a simple, honest one-time success banner using the same
create-action redirect parameters.

### 10. Engagement detail changes

`getEngagementDetail` (`lib/domain/engagements.ts`) now also returns
`periodStart`/`periodEnd` and `currentUserRoleName` (the caller's own
engagement-scoped role, if they hold direct `EngagementMembership`; null
if they can see it only via organisation-wide membership — instructions
§14's "current authorised user context where appropriate"). The page
displays the period and a "Your role on this engagement: ..." line (or
an org-level-access note when null).

### 11. Audit behavior

All three material writes this slice performs are audited via triggers,
not application code — no second audit mechanism. `organisations_audit_
log` (Slice B1) continues to fire on the organisation insert.
`engagements_audit_log` (new, migration 0019, reusing
`log_methodology_change()` unchanged — `engagements` already carries
the `tenant_id`/`id` columns that function requires) fires on the
engagement insert. `organisation_memberships_audit_log`/
`engagement_memberships_audit_log` (new, migration 0019, using a new
`log_membership_change()` function — the same shape as
`log_methodology_change()`, adapted to resolve `tenant_id` via the new
resolver functions since neither membership table carries the column
directly) fire on each membership grant. All four are verified by a
dedicated test asserting real `audit_log` rows with correct
`actor_user_id`/`action`/`tenant_id`.

### 12. RLS behavior

Tenant/organisation/engagement isolation is preserved and extended, not
weakened, anywhere. Migration 0019's two new `INSERT` policies
(`organisation_memberships_insert`, `engagement_memberships_insert`)
are the only new *capability* added at the database level — both are
narrow mirrors of already-existing, already-approved rules
(`organisations_insert`/`engagements_insert`), not a new, more
permissive concept, and both were verified directly against real
PostgreSQL (including the specific cross-tenant/cross-user attacks
instructions §5 named) before any application code was written. No
`SELECT` policy was touched. `RLS`/`FORCE RLS` confirmed still enabled
on every touched table (§27 below).

### 13. Security tests

All 14 required scenarios (instructions §18), each run against real
PostgreSQL with no mocked permission function — see
`tests/app/engagement-onboarding.test.ts`:
1. Tenant A cannot create an engagement under Tenant B's organisation.
2. Tenant A cannot create OrganisationMembership in Tenant B.
3. Tenant A cannot create EngagementMembership in Tenant B.
4. Tenant A cannot read Tenant B's engagement.
5. An Organisation-A2 member cannot administer a different Tenant-A
   organisation (Org A) — organisation-level membership does not cross
   organisations, even within the same tenant.
6. An Organisation-A2 member cannot create an engagement under
   Organisation B.
7. A Tenant A user cannot be granted membership on a Tenant B
   organisation, even by a legitimate Tenant B administrator.
8. A browser-supplied `user_id` cannot cross the tenant boundary, even
   on the acting user's own legitimate organisation (isolates the
   second `WITH CHECK` clause specifically, distinct from #7).
9. An Engagement-A member cannot access Engagement B.
10. The engagement creator CAN access the engagement they just created.
11. An unauthorized role (no membership at all) cannot create an
    engagement.
12. An anonymous user cannot create an engagement.
13. An unauthorized role (no membership at all) cannot administer
    organisation membership.
14. A direct request that skips the application authorization layer
    entirely (a raw `engagements` INSERT under a different tenant's
    organisation) is still rejected by RLS.

### 14. Application tests

Organisation-membership auto-grant on creation (role, status,
attribution); organisation detail visibility for the creator (Slice B1's
own now-fixed test); engagement creation success (engagement +
membership both created, detail reads back correctly); methodology
selection (published accepted, retired accepted, draft rejected,
cross-tenant rejected, even if published); `listSelectableControlLibraryVersions`
scoping; duplicate engagement name (best-effort, RLS-scoped, same
documented limitation as organisations); no-orphaned-records on a
rejected creation; audit attribution for all three membership/entity
inserts; `canCreateEngagement` matching what `engagements_insert`
actually allows for a tenant member, an organisation member, and
neither.

### 15. Exact full-suite count/results

```
npm run test:db   # fresh reset + full 10-directory suite incl. tests/app: 432/432 passing
npm run test:db   # run again for stability: 432/432 passing, identical results
```
(406 tests carried forward from Slice B1 + 26 new in
`tests/app/engagement-onboarding.test.ts` = 432. Two pre-existing Slice
B1 tests in `tests/app/organisations.test.ts` were updated, not
removed, to assert the new, correct post-Slice-B2 behavior — see §9 and
DECISIONS.md's note appended to R-88.)

### 16. Typecheck/lint/build results

```
npm run typecheck   # clean
npx eslint .         # clean
npm run build        # succeeds; /organisations/[organisationId]/engagements/new correctly reported dynamic, none prerendered
```

### 17. Files changed

- `drizzle/migrations/0019_organisation_engagement_membership_onboarding.sql` (new)
- `lib/authorization/service.ts` (`canCreateEngagement`, `requireEngagementCreateAccess`)
- `lib/domain/roles.ts` (new — `getRoleIdByName`)
- `lib/domain/organisations.ts` (`createOrganisation` now also grants
  the creator's `organisation_memberships` row; `OrganisationDetail`
  gained `tenantId`/`members`)
- `lib/domain/engagements.ts` (new `createEngagement`,
  `listSelectableControlLibraryVersions`, `DuplicateEngagementError`,
  `InvalidMethodologyError`; `EngagementDetail` gained `periodStart`/
  `periodEnd`/`currentUserRoleName`)
- `app/(shell)/organisations/[organisationId]/engagements/new/page.tsx` (new)
- `app/(shell)/organisations/[organisationId]/engagements/new/actions.ts` (new)
- `app/(shell)/organisations/[organisationId]/page.tsx` (members
  section, gated Create Engagement link, simplified success banner —
  Slice B1's "not yet visible" fallback removed as dead code)
- `app/(shell)/organisations/[organisationId]/engagements/[engagementId]/page.tsx`
  (period, methodology, current-user-role display)
- `tests/app/engagement-onboarding.test.ts` (new, 26 tests)
- `tests/app/organisations.test.ts` (2 pre-existing tests updated to
  assert the new, correct post-Slice-B2 behavior)
- `tests/app/helpers.ts` (re-exports `retireControlLibraryVersion`)
- `DECISIONS.md` (R-89 through R-92; a superseded-note appended to R-88)
- `PROGRESS.md` (this entry)

No `DATA_MODEL.md` change — no new field or entity; the migration adds
policies/triggers/resolver functions, not schema.

### 18. Dependencies changed

None. No `package.json` change this slice.

### 19. Known limitations

1. Granting `OrganisationMembership` to a user other than the creator
   is not built (DECISIONS.md R-91) — the RLS policy already supports
   it; only the UI/Server Action is deferred.
2. A direct, unworked-around consequence of #1: a Tenant A consultant
   who did not create a given organisation, and has no
   `EngagementMembership` under it, has no way to discover or reach it
   (not in their Organisations list, no known URL) — closing this
   without weakening `organisations_select` is future work (DECISIONS.md
   R-91).
3. The duplicate-engagement-name check is best-effort and RLS-scoped —
   same documented limitation as Slice B1's organisation-name check.
4. Carries forward Slice A1/B1's own recorded limitation (DECISIONS.md
   R-85/D-03): no real Supabase Auth backend is reachable from this
   environment.

### 20. Deferred membership decisions

- Adding an existing user other than the creator to an
  `OrganisationMembership` or `EngagementMembership` (§19.1 above).
- Editing or revoking any membership (no UPDATE/DELETE policy was added
  to either membership table this slice — instructions §23 explicitly
  forbid a role-management console).
- A general "browse my tenant's organisations" directory/discovery
  capability (§19.2 above) — would require either weakening
  `organisations_select` or a new, parallel, less-restrictive read
  path; both are materially larger decisions than this slice's scope.
- Adding a real PRIMUS-practice-facing organisation-scope role to the
  seed catalogue (DECISIONS.md R-90) — `Client Administrator` remains a
  documented, imperfect placeholder for this slice's onboarding grant.

### 21. Recommended next slice

With the full onboarding chain now working end-to-end (Tenant →
Organisation → OrganisationMembership → Engagement →
EngagementMembership), the natural next steps are either: (a) the
deferred membership-administration UI (§20) — letting an existing org/
engagement member add colleagues, which would also close the
discoverability gap (§19.2); or (b) beginning Phase C's Assessment
workspace deepening, now that a real Engagement can be created and
reached end-to-end. This report does not preempt the user's own choice.

### 22. Git status

All Slice B2 work is committed on `claude/primus-privacy-architecture-39p3gh`.

### 23. Remote synchronization

Pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

## Slice B1 — Organisation Creation + Organisation Detail (Session 14, 2026-09-01)

**Scope:** exactly what PHASE B / Slice B1 instructed — turn the
read-only Organisations page into a real creation + detail workflow.
No engagement creation/editing, membership management, client
invitation, client portal, methodology configuration, or assessment
workspace — none of those exist anywhere in this slice's changes. No
new domain table, no schema change. One migration (`0018_organisation_
audit.sql`) — a single `CREATE TRIGGER` closing a pre-existing gap
(below), not a schema/domain change.

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`, the
existing `app/`/`db/schema/`/`tests/` structure, and migration 0001's
exact `organisations_insert`/`organisations_select` RLS policies fresh
from disk before writing anything, per instruction.

### 1. A pre-existing gap found and closed: `organisations` never had an audit trigger

Grepping every migration file (0000-0017) for a trigger on
`"organisations"` found only `organisations_prevent_reparenting`
(migration 0001) — no `organisations_audit_log` trigger has ever
existed, since Milestone 1, unnoticed until this slice's own
instruction §10 ("organisation creation must be auditable using the
existing audit mechanism... do not create a second audit system")
required one to actually exist. Closed via
`drizzle/migrations/0018_organisation_audit.sql` — one `CREATE TRIGGER
organisations_audit_log AFTER INSERT OR UPDATE ON "organisations" ...
EXECUTE FUNCTION public.log_methodology_change()`, reusing the exact
existing audit function (migration 0007, unchanged since) with no new
table, column, or function. Deliberately not also added to
`engagements`, which carries the identical gap — out of this slice's
scope (instructions §18); left for whichever future slice builds
engagement creation/editing. See DECISIONS.md R-86. Hand-written
migrations are never tracked in `drizzle/migrations/meta/_journal.json`
(confirmed by inspection), so 0018 needed no journal/snapshot entry,
matching this project's established hand-written-migration convention.

### 2. A real Postgres RLS/`RETURNING` interaction, discovered and fixed without weakening anything

The obvious implementation — `INSERT INTO organisations (...) VALUES
(...) RETURNING id` — fails with "new row violates row-level security
policy for table \"organisations\"" even for a fully-authorized tenant
member (`organisations_insert`'s `WITH CHECK` independently confirmed
true). Postgres additionally re-checks a `RETURNING` row against the
table's own `SELECT` policy (`organisations_select` /
`can_access_organisation`), which requires organisation- or
engagement-level membership nobody has yet on a brand-new row. Fixed by
generating the id application-side (`randomUUID()`) and inserting it
explicitly, with no `.returning()` clause — confirmed directly that the
identical `INSERT` without `RETURNING` succeeds. No RLS policy, GRANT,
or service-role connection was touched. See DECISIONS.md R-87.

### 3. A real, documented consequence of the already-approved authorization model: the creator cannot immediately view the organisation they just created

`organisations_select`/`can_access_organisation` (migration 0001, Slice
A1's own `canAccessOrganisation`, R-83) requires organisation- or
engagement-level membership — deliberately, matching SECURITY.md §3's
"no implicit cross-client access." A bare TenantMembership is the
correct, narrowest authorization for *creating* an organisation, but
was never intended to also grant *viewing* one. Confirmed directly:
immediately after creation, the creator's own session gets an identical
`NotFoundOrForbiddenError` from `getOrganisationDetail` as it would for
any organisation with no membership grant. Granting the creator an
`organisation_memberships` row to work around this is not achievable
within this slice's constraints: `organisation_memberships` has no
`INSERT` policy for the `authenticated` role at all (confirmed by
direct `pg_policy` inspection), so doing so would require a new RLS
policy (its own migration and stop-and-report per instructions §17),
and granting membership is itself membership-management functionality
instructions §18 explicitly excludes from this slice. Handled honestly
rather than worked around: the Organisation detail page renders a plain
"Organisation created" confirmation (driven only by the create action's
own redirect parameters — the organisation's real database id, and the
name the caller themselves typed — never by an unauthorized read)
instead of a bare not-found, for exactly the create-action's own
redirect; every other request to the same route, including the
identical URL without those parameters, still gets the SECURITY.md
§13-required identical "not found" response regardless of whether the
row is real, forbidden, or nonexistent. The same RLS-scoping applies to
the best-effort duplicate-name check: it can only see organisations the
caller already has read access to, and is tested as such. See
DECISIONS.md R-88 for the full reasoning and the recommended future
resolution (engagement creation, or organisation membership
management, whichever slice builds it, naturally closes this).

### What was implemented

- **`lib/authorization/service.ts`** — `getUserTenantId(db, userId)`
  (reads the authenticated user's own `users.tenant_id`, always
  readable via the existing `users_select` RLS policy's `id =
  auth.uid()` clause) and `requireTenantMembership(db, userId,
  tenantId)` — a new, narrow, separately-named check mirroring
  `organisations_insert`'s exact `is_active_tenant_member(tenant_id)`
  WITH CHECK, deliberately distinct from `requireTenantAccess`/
  `canAccessTenant` (whose own docstring already anticipates growing a
  broader org-fallback for an unrelated read-only screen — conflating
  the two would silently broaden who can create an organisation the
  moment that happens).
- **`lib/domain/organisations.ts`** — `createOrganisation(db, userId,
  input)`: derives `tenant_id` only from the authenticated user's own
  session (never from `input`, which carries no such field at all —
  there is no code path by which a browser-supplied tenant id could
  reach the INSERT), authorizes via `requireTenantMembership`, runs the
  best-effort RLS-scoped duplicate-name check, and inserts using an
  application-generated id (see §2 above). `DuplicateOrganisationError`
  (new). `getOrganisationDetail`/`OrganisationDetail` extended with
  `createdAt`.
- **`app/(shell)/organisations/new/page.tsx`** — the creation form.
  Pre-checks the same `requireTenantMembership` condition purely for
  UX (a consultant with no TenantMembership sees a clear message
  instead of a form that would only fail on submit — the actual
  security boundary is enforced server-side regardless) and
  `app/(shell)/organisations/new/actions.ts` — `createOrganisationAction`,
  the Server Action: authenticate → Zod-validate `name` (2-200 chars,
  trimmed; server-side, not solely a browser `minLength`/`maxLength`
  hint) → `createOrganisation` → catch `DuplicateOrganisationError`/
  `NotFoundOrForbiddenError`/generic errors into clean, non-leaking
  messages → redirect.
- **`app/(shell)/organisations/page.tsx`** — a "Create Organisation"
  link, shown only when the same `requireTenantMembership` pre-check
  passes.
- **`app/(shell)/organisations/[organisationId]/page.tsx`** — displays
  `createdAt`; renders the honest post-creation confirmation described
  in §3 above instead of a bare not-found for the create action's own
  redirect. Organisation editing was NOT built — instructions §9's own
  allowed path (no clearly-supported trivial editable field was judged
  to exist within this slice's tight scope; deferred).
- **`drizzle/migrations/0018_organisation_audit.sql`** — see §1 above.

### Testing performed (exact commands, run in this order)

```
npm run typecheck   # clean
npx eslint .         # clean
npm run build        # succeeds; /organisations/new correctly reported dynamic, none prerendered
npm run test:db      # fresh reset + full 9-directory suite incl. tests/app: 406/406 passing
npm run test:db      # run again for stability: 406/406 passing, identical results
```

Direct browser-bundle check (`grep -rl "SUPABASE_SERVICE_ROLE_KEY\|DATABASE_URL\|postgres://" .next/static` and a `service_role` count): no matches, consistent with Slice A1's own finding — no new client-side data exposure introduced.

### tests/app/organisations.test.ts (1 new file, 16 new tests)

Creation success (persisted with correct real column values — name,
status, tenant_id, created_by); organisation-scoping proof (2 tests);
the "creator cannot immediately view what they created" consequence,
tested directly rather than left as an assumption; the 8 required
security scenarios (Tenant A creates in Tenant A; Tenant A cannot
create in Tenant B — both via the structural absence of any
client-supplied-tenant path and a raw malicious INSERT attempt; Tenant
A cannot read Tenant B's organisations; unauthorized role — org-only,
engagement-only, and no-membership-at-all — cannot create, 3 tests;
anonymous cannot create; malicious client-supplied tenant_id cannot
change ownership; direct unauthorized DB access blocked by RLS; org
detail cannot be used to enumerate another tenant's organisation, with
an explicit assertion that the forbidden and nonexistent cases produce
byte-identical error messages); duplicate-name handling within the
caller's visible scope, and its explicit non-detection outside that
scope (2 tests); duplicate-name scoping is per-tenant; audit
attribution (verifying the new `organisations_audit_log` trigger writes
a real `audit_log` row, correctly attributed to the acting user and
tenant, `action = 'insert'`). All run against real PostgreSQL — no
mocked permission functions.

### Files changed

- `drizzle/migrations/0018_organisation_audit.sql` (new)
- `lib/authorization/service.ts` (`getUserTenantId`, `requireTenantMembership`)
- `lib/domain/organisations.ts` (`createOrganisation`, `DuplicateOrganisationError`, `OrganisationDetail.createdAt`)
- `app/(shell)/organisations/new/page.tsx` (new)
- `app/(shell)/organisations/new/actions.ts` (new)
- `app/(shell)/organisations/page.tsx` (Create Organisation link)
- `app/(shell)/organisations/[organisationId]/page.tsx` (`createdAt` display, post-creation confirmation)
- `tests/app/organisations.test.ts` (new)
- `DECISIONS.md` (R-86, R-87, R-88)
- `PROGRESS.md` (this entry)

No `DATA_MODEL.md` change — organisation creation uses only fields the
schema already defines.

### Known limitations (documented, not silently built around)

1. The creator of an organisation cannot immediately view its detail
   page or find it in their own Organisations list — see §3 above and
   DECISIONS.md R-88. Closed naturally once a future slice grants real
   organisation- or engagement-level access (e.g., Slice B2's
   engagement creation, which the tenant member can already perform
   under the new organisation via `engagements_insert`'s own
   tenant-membership fallback).
2. The duplicate-name check is best-effort and RLS-scoped to what the
   caller can already see — it will not catch every real duplicate,
   only ones visible to the caller. No database uniqueness constraint
   exists on `organisations.name` and none was added (instructions
   §17). See DECISIONS.md R-88.
3. Organisation editing was not built this slice (instructions §9's own
   allowed deferral).
4. Carries forward, unchanged, Slice A1's own recorded limitation
   (DECISIONS.md R-85 / D-03): no real Supabase Auth backend is
   reachable from this environment, so the actual network-call boundary
   remains untested end-to-end; every authorization decision downstream
   of a resolved `userId` is tested for real against real PostgreSQL.

### Recommended next application slice

With organisation creation proven end-to-end, Slice B2 — engagement
creation under an organisation — is the natural next step per
PRODUCT_UX_BLUEPRINT.md §23's own build sequence, and would also
naturally close this slice's §3 visibility limitation (a tenant member
opening an engagement gains real, principled access to the client
organisation it belongs to). This report does not preempt the user's
own choice of next slice.

### Git status / remote synchronization status

All Slice B1 work is committed on `claude/primus-privacy-architecture-39p3gh`
and pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

## Slice A1 — Application Foundation (Session 13, 2026-09-01)

**Scope:** exactly what PHASE A / Slice A1 instructed — authentication,
session resolution, a centralized authorization service, the first
application shell, and one real vertical slice (AssessmentResponse
update). No Evidence upload, Risk UI, Findings, Remediation, Maturity
UI, client portal, dashboards, reporting, AI, DPIA, SDF, or
notifications — none of those exist anywhere in this slice's changes.
No new domain table, no migration, no schema change — the existing
Milestones 1-8A domain model is used exactly as built.

Read `PRODUCT_SPEC.md`, `PRODUCT_UX_BLUEPRINT.md`, `ARCHITECTURE.md`,
`DATA_MODEL.md`, `SECURITY.md`, `DECISIONS.md`, `PROGRESS.md`,
`ROADMAP.md`, `package.json`, the existing `app/`/`db/schema/`/`tests/`
structure fresh from disk before writing anything, per instruction. Two
findings from that reading were decisive:
- No Supabase project has ever been provisioned for this repository
  (DECISIONS.md D-03, still unresolved) — no live Supabase Auth backend
  (cloud project, unreachable via this environment's network egress
  proxy; nor a local `supabase start` instance, since the Docker daemon
  itself is unavailable here) exists to authenticate against. This
  bounds what could be tested end-to-end (see "Testing performed" and
  "Known limitations" below) but does not change what was built: real,
  correct `@supabase/ssr`-based integration code, exactly matching the
  documented pattern, wired to the exact env vars `.env.example` already
  named.
- Migration 0001's own `can_access_organisation`/`can_access_tenant` SQL
  functions do **not** grant a pure `TenantMembership` holder implicit
  read access to every client organisation — confirmed by direct
  inspection of the existing RLS policies, not assumed — matching
  SECURITY.md §3's own explicit "no implicit cross-client access" rule.
  The new application-layer authorization service mirrors this exactly
  (DECISIONS.md R-83), rather than the broader reading
  PRODUCT_UX_BLUEPRINT.md's own screen-inventory prose might otherwise
  suggest.

### What was implemented

- **Stack additions** (`package.json`, all exact-pinned per this
  project's existing convention): `@supabase/ssr@0.12.5`,
  `@supabase/supabase-js@2.112.4` (Supabase Auth), `zod@3.24.4` (input
  validation, ARCHITECTURE.md §2), `server-only@0.0.1` (build-time
  guard against a server module being bundled into client JS),
  `tailwindcss@3.4.19`/`postcss@8.5.26`/`autoprefixer@10.5.4` (styling,
  ARCHITECTURE.md §2), `clsx@2.1.1`/`tailwind-merge@3.6.0`/
  `class-variance-authority@0.7.1` (the standard shadcn/ui class-
  composition helpers — a small, hand-written `Button`/`Badge` pair
  rather than the full shadcn CLI scaffold, which needs network access
  to their component registry and pulls in many Radix packages this
  slice doesn't need). No second backend framework, no second
  authentication provider, no second authorization system, no
  microservices.
- **Supabase Auth integration** (`lib/supabase/server.ts`,
  `lib/supabase/middleware.ts`, `middleware.ts`, `lib/auth/actions.ts`):
  the current `@supabase/ssr`-documented Next.js App Router pattern —
  a server client built from `next/headers`' `cookies()` for Server
  Components/Actions, a middleware-based session-refresh helper
  (re-validates against Supabase Auth on every request, not merely
  decoding a cookie), and `signIn`/`signOut` Server Actions. Login only
  (email/password); no social login, SSO, MFA, password reset UI,
  invitations, or account management, per instruction.
- **Session resolution** (`lib/auth/session.ts`): one reusable
  `getAuthenticatedUser()`/`requireAuthenticatedUser()` pair — every
  protected page/layout calls this, none reinvents it. Accepts an
  optional injectable Supabase-Auth-shaped client so its own control
  flow (not the third-party SDK) is what a unit test exercises (see
  "Testing performed").
- **Centralized authorization service** (`lib/authorization/service.ts`):
  `isActiveTenantMember`/`isActiveOrganisationMember`/
  `isActiveEngagementMember`/`canAccessOrganisation`/
  `canAccessEngagement`/`canAccessTenant` and their `require*Access`
  throwing variants (`NotFoundOrForbiddenError`) — real Drizzle queries
  against `tenant_memberships`/`organisation_memberships`/
  `engagement_memberships`, independently re-implementing (not calling)
  migration 0001's own SQL functions, per SECURITY.md §2/R-07's
  explicit two-independently-implemented-layers rationale (DECISIONS.md
  R-83). No new role/permission database; no fine-grained `Role`/
  `Permission`-based action check yet (DECISIONS.md R-84 — the seeded
  `Permission` catalogue is still only 8 illustrative rows, per
  `db/seed/roles.ts`'s own comment).
- **Request-scoped database access** (`lib/db/request-client.ts`):
  `withRequestDb(userId, fn)` opens one Postgres connection per request,
  executes `SET LOCAL ROLE authenticated`/`anon` + sets
  `request.jwt.claim.sub` (the exact mechanism `tests/rls/helpers.ts`'s
  `asUser`/`asAnon` have exercised since Milestone 1, and the same one
  Supabase's own request layer uses in production), then hands the
  caller a Drizzle instance scoped to that connection — every RLS policy
  written since Milestone 1 applies to every query this slice issues,
  unchanged, unweakened (DECISIONS.md R-85 records the one honest gap:
  no real Supabase project exists to connect as its production-shaped
  `authenticator` role, so `DATABASE_URL` still resolves to the local
  Postgres superuser, exactly like every migration/seed script since
  Milestone 1 — the `SET LOCAL ROLE` discipline is what actually
  enforces RLS for every code path built, not the connection's own
  ceiling privilege).
- **Domain read/write functions** (`lib/domain/organisations.ts`,
  `lib/domain/engagements.ts`, `lib/domain/assessments.ts`): real,
  typed Drizzle queries against the existing schema —
  `listAccessibleOrganisations` (relies on RLS's own filtering — no
  redundant application-layer list-filter, since there is no more
  specific question to ask of a plain list read than what RLS already
  answers), `getOrganisationDetail`, `getEngagementDetail`,
  `getAssessmentDetail`, and `updateAssessmentResponse` — the last of
  these is the vertical-slice write path, following instructions §14's
  exact ordering (authenticate → resolve session → derive engagement/
  organisation from the `AssessmentControl`'s own database row, never
  from browser-supplied ids → validate input → mutate → rely on RLS as
  backstop). A pre-check against `Assessment.status = 'finalized'`
  gives a clean, generic error; the database's own finalization trigger
  (Milestone 5's `enforce_assessment_response_draft_mutable`) is the
  actual, unconditional enforcement even if that pre-check were somehow
  bypassed — its raised Postgres error is caught and translated into
  the same clean `AssessmentFinalizedError`, never surfaced raw.
- **Application shell** (`app/(shell)/layout.tsx`,
  `components/shell/nav.tsx`, `components/shell/user-menu.tsx`): one
  `requireAuthenticatedUser()` call protects the entire route group;
  global nav shows only "Organisations" (Dashboard/Engagements-as-a-
  standalone-item/Methodology/Administration are real, planned
  destinations per PRODUCT_UX_BLUEPRINT.md §6 with no page built behind
  them yet — omitted rather than linked to a page that doesn't exist,
  per instruction §8's "only show items that are actually supported").
  Session indicator + logout (a plain Server Action form, works without
  client-side JavaScript).
- **Routing** (`app/login/`, `app/(shell)/organisations/`,
  `.../[organisationId]/`, `.../engagements/[engagementId]/`,
  `.../assessments/[assessmentId]/`): matches
  PRODUCT_UX_BLUEPRINT.md §14's route tree exactly for the segments this
  slice builds; every dynamic path segment is presentation only — every
  Server Action/data fetch behind it re-resolves the caller's actual
  membership server-side, so a crafted URL to an engagement the caller
  has no membership on fails identically to a genuinely nonexistent one
  (SECURITY.md §13).
- **Organisations / Organisation detail / Engagement detail / Assessment
  detail pages**: real PostgreSQL data only; empty/loading/error/
  unauthorized/not-found/finalized-locked states all implemented (see
  `app/(shell)/loading.tsx`, `app/(shell)/error.tsx`,
  `app/not-found.tsx`, and each page's own inline empty-state markup).
- **The AssessmentResponse vertical slice**
  (`.../assessments/[assessmentId]/page.tsx` + `actions.ts`): displays
  every `AssessmentControl` in scope with its Control's own code/title
  and current response; an authorized consultant edits via an inline
  form (effectiveness rating + rationale) posting to a Server Action —
  the browser never writes to Postgres directly. A finalized
  assessment renders every response as locked, read-only text, with no
  editable control rendered at all (not merely a disabled one) —
  matching, not merely hoping to match, the database's own unconditional
  rejection.
- **Accessibility baseline** (instructions §24): real `<label>`s on
  every form input, a global visible focus ring (`app/globals.css`),
  semantic `<button>`/`<a>`/`<form>` elements throughout, `role="alert"`
  on error messages, `role="status"` + visually-hidden text on the
  loading state, and status badges (`components/ui/badge.tsx`) that
  always pair colour with a visible text label — never colour alone.

### Testing performed (exact commands, run in this order)

1. `npm run typecheck` — clean, repeated after every file added.
2. `npx eslint .` — clean, repeated after every file added.
3. `npm run build` (`next build`) — **failed once**: Next.js attempted to
   statically prerender `/` and `/organisations` at build time, and both
   throw (by design) when `NEXT_PUBLIC_SUPABASE_URL`/
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset, since no Supabase project
   is configured in this environment. Diagnosed correctly as a route-
   segment-configuration gap, not a code bug: every route under
   `app/(shell)/` and the root `/` route depend on the caller's session
   and live database access and can never be correctly prerendered —
   fixed by adding `export const dynamic = "force-dynamic"` to
   `app/(shell)/layout.tsx` (cascades to every nested segment) and
   `app/page.tsx`. Re-ran — succeeded; every route under `/organisations`
   and `/login` and `/` correctly reported as `ƒ` (server-rendered on
   demand), none prerendered.
4. `npx tsc --noEmit` / `npx eslint .` re-run after the build fix —
   clean.
5. `npx vitest run tests/app` — **failed twice** before passing, both
   genuine test-infrastructure gaps, not application bugs:
   - Vitest has no built-in resolution for this project's own `@/*`
     tsconfig path alias (Next.js resolves it via its own webpack
     config; Vitest/Vite do not read `tsconfig.json`'s `paths`
     automatically) — fixed by adding the same alias to
     `vitest.config.ts`'s own `resolve.alias`.
   - The real `server-only` npm package (now an explicit dependency,
     see above) unconditionally throws unless the bundler applies
     Next.js's own special "server" resolve condition — a build-time-
     only guard with no runtime behavior of its own to test. Vitest has
     no such condition, so importing any module carrying `import
     "server-only"` always threw, regardless of correctness. Fixed with
     a documented test-only alias (`tests/shims/server-only.ts`, a
     no-op module) in `vitest.config.ts` — the real Next.js build
     (`npm run build`) continues to use the real npm package and its
     real enforcement; only the Vitest process is affected.
   - Also found and fixed during this pass (not build/tooling issues):
     `lib/auth/session.ts` originally wrapped `getAuthenticatedUser` in
     React's `cache()` for per-request memoization — `cache` does not
     exist in the plain `react@18.3.1` package this project pins (only
     in Next.js's own internal, patched React copy used during its own
     build, which is why `npm run build` itself never surfaced this).
     Removed rather than special-cased further — a minor, deliberate
     simplification (DECISIONS.md-adjacent, recorded in "Known
     limitations" below), not required for correctness.
6. Re-ran `npx vitest run tests/app` after both fixes — **20/20
   passing** (`session.test.ts` 5, `authorization.test.ts` 6,
   `assessments.test.ts` 9). One test-authoring bug found and fixed
   along the way: the required "direct malicious request" scenario
   (§21 item 6) initially reused an already-finalized Assessment from
   an earlier test in the same file, so Postgres's `BEFORE INSERT`
   finalization trigger fired before RLS's own `WITH CHECK` could —
   masking which mechanism actually rejected the write. Fixed by using
   a fresh, still-draft Assessment for that one scenario, isolating it
   to RLS's own tenant/engagement scoping specifically.
7. `npm run test:db` (fresh reset + full suite, now including
   `tests/app`) — **390/390 passing**. Run **twice** in full (fresh
   `reset-test-db` each time) to prove stability — 390/390 both times,
   identical results.
8. `rm -rf .next && npm run build` — re-verified clean after the
   `cache()` removal.
9. Browser-security checks (instructions §23), performed directly, not
   assumed: `grep`'d the built `.next/static` client bundle output for
   `SUPABASE_SERVICE_ROLE_KEY`/`DATABASE_URL`/`postgres://`/
   `service_role` — none found. Also confirmed **zero** `NEXT_PUBLIC_*`
   references exist anywhere in the client bundle at all, because this
   slice's login/logout flow is entirely Server-Action-based — no
   browser-side Supabase client is instantiated anywhere in Slice A1,
   so there is no client-side exposure surface for the public
   URL/anon key either, not merely no exposure of the *secret* values.
   Confirmed exactly one `"use client"` module exists in this slice
   (`app/(shell)/error.tsx`, required by Next.js for error boundaries)
   and it receives only a generic `Error` object and a `reset()`
   callback — no server/database data is ever serialized into it.
10. Direct git-status check confirming no `drizzle/migrations/**` or
    `db/schema/**` file was touched by this slice (instructions §22/§20)
    — none were.

### tests/app (3 new files, 20 new tests)

- `session.test.ts` (5 tests — Authentication, instructions §21): the
  required "unauthenticated protected-route test" (`getAuthenticatedUser`
  returns `null`; `requireAuthenticatedUser` throws Next.js's own
  `NEXT_REDIRECT` error targeting `/login` — asserted on the error's
  `digest`, not merely "it threw") and "authenticated session test"
  (`getAuthenticatedUser`/`requireAuthenticatedUser` correctly resolve
  and return a real user), plus a Supabase-error-reporting case. Uses a
  stand-in satisfying `SupabaseAuthClientLike` — stubs only the
  third-party Supabase SDK boundary (see "Known limitations" for
  exactly why), never any authorization logic.
- `authorization.test.ts` (6 tests — the exact six required scenarios,
  against real PostgreSQL): (1) Tenant A cannot access Tenant B's
  organisation; (2) Tenant A cannot access Tenant B's engagement;
  (3) Organisation A1 cannot access Organisation A2's engagement, same
  tenant; (4) a user without engagement access cannot update
  AssessmentResponse (and nothing is written); (5) a finalized
  assessment's response cannot be mutated by an otherwise-authorized
  user (and the response is provably unchanged); (6) a direct request
  that skips the application authorization layer entirely (a raw
  `INSERT` issued directly, bypassing `lib/domain/assessments.ts`) is
  still rejected — by RLS itself, proving the database backstop is
  real, not merely trusted because the application layer happens to
  check first.
- `assessments.test.ts` (9 tests — Application, instructions §21):
  `listAccessibleOrganisations`, `getOrganisationDetail` (success +
  not-found error state), `getEngagementDetail` (success + not-found
  error state), `getAssessmentDetail` (the control grid with the real
  Control's own code/title), `updateAssessmentResponse` (create, then
  an idempotent-by-control second update proving no duplicate row is
  created), and audit attribution (the resulting `audit_log` row is
  correctly attributed to the acting user).

### Files changed

- New: `middleware.ts`, `lib/supabase/server.ts`,
  `lib/supabase/middleware.ts`, `lib/auth/session.ts`,
  `lib/auth/actions.ts`, `lib/db/request-client.ts`,
  `lib/authorization/service.ts`, `lib/domain/organisations.ts`,
  `lib/domain/engagements.ts`, `lib/domain/assessments.ts`,
  `lib/utils.ts`, `components/ui/button.tsx`, `components/ui/badge.tsx`,
  `components/shell/nav.tsx`, `components/shell/user-menu.tsx`,
  `app/globals.css`, `app/login/page.tsx`, `app/not-found.tsx`,
  `app/(shell)/layout.tsx`, `app/(shell)/loading.tsx`,
  `app/(shell)/error.tsx`, `app/(shell)/organisations/page.tsx`,
  `app/(shell)/organisations/[organisationId]/page.tsx`,
  `app/(shell)/organisations/[organisationId]/engagements/
  [engagementId]/page.tsx`, `app/(shell)/organisations/
  [organisationId]/engagements/[engagementId]/assessments/
  [assessmentId]/page.tsx`, `.../assessments/[assessmentId]/actions.ts`,
  `tailwind.config.js`, `postcss.config.js`, `tests/app/helpers.ts`,
  `tests/app/session.test.ts`, `tests/app/authorization.test.ts`,
  `tests/app/assessments.test.ts`, `tests/shims/server-only.ts`.
- Modified: `app/layout.tsx` (imports `globals.css`), `app/page.tsx`
  (real redirect logic, `force-dynamic`), `package.json` (new
  dependencies, `test:app` script, `test:db` extended, description
  unchanged — this is application-layer work on top of an already-
  described domain foundation, not a new domain milestone),
  `.env.example` (clarifying comments — no new variables needed; the
  two Supabase public-config vars this slice actually uses were already
  documented), `vitest.config.ts` (path alias + the `server-only` test
  shim), `DECISIONS.md` (R-83 through R-85), `PROGRESS.md` (this entry).
- Unchanged: every `drizzle/migrations/**` and `db/schema/**` file —
  no migration, no schema change, confirmed via `git status` before
  committing. `DATA_MODEL.md` — no genuine domain clarification was
  required by this slice (it builds application code around the
  existing model, not a new domain concept).

### Known limitations (documented, not silently built around)

- **No live Supabase Auth backend is reachable from this environment**
  (DECISIONS.md D-03, still unresolved): neither a cloud Supabase
  project (network egress to `supabase.co`/`ghcr.io`/`registry-1.docker.io`
  is blocked by this environment's own proxy — confirmed directly, not
  assumed) nor a local `supabase start` instance (the Docker daemon
  itself is unavailable in this environment — confirmed via `docker
  info`). Consequence: the actual `supabase.auth.getUser()`/
  `signInWithPassword()`/`signOut()` network calls have never executed
  against a real backend anywhere in this project's history, and could
  not be exercised end-to-end in this slice. What *is* tested for real,
  against real PostgreSQL: every authorization decision this
  application makes, once a `userId` is in hand (`tests/app/
  authorization.test.ts`), and this module's own null/redirect control
  flow given a resolved-or-not session (`tests/app/session.test.ts`,
  via a stand-in satisfying the Supabase SDK's own minimal interface,
  not a stub of any authorization logic). A real login cannot be
  clicked through in this environment until real
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` values
  exist — an infrastructure/provisioning blocker (D-03), not a code gap.
- `getAuthenticatedUser` is called independently by the shell layout and
  by each leaf page (no per-request memoization) — a minor, deliberate
  simplification after `React.cache()` proved unavailable in this
  project's own pinned `react@18.3.1` (only present in Next.js's
  internal, patched React copy). Costs one extra `auth.getUser()` call
  per page render; correctness is unaffected. A future slice could
  reintroduce memoization via a different mechanism if this becomes a
  measured performance concern.
- The authorization service checks membership existence only, not
  fine-grained `Role`/`Permission` actions (DECISIONS.md R-84) — the
  seeded permission catalogue remains 8 illustrative rows
  (`db/seed/roles.ts`), not the full set ARCHITECTURE.md/SECURITY.md's
  own prose names. No screen in this slice needs a finer check than
  "does this user have engagement access at all" (the one mutation —
  AssessmentResponse update — has no separate "finalize" or role-
  specific gate to enforce yet).
- `canAccessTenant` (`lib/authorization/service.ts`) is intentionally
  narrower than migration 0001's own `can_access_tenant` SQL function —
  it checks tenant-wide membership only, not "any organisation
  accessible under this tenant" — because no screen in this slice
  needs the broader form (DECISIONS.md R-83).
- The application's database connection cannot yet use a production-
  shaped `authenticator` role (DECISIONS.md R-85) — a continuation of
  D-03, now load-bearing for real application code rather than only
  test/tooling code. RLS enforcement itself is unaffected (every query
  still runs under `SET LOCAL ROLE authenticated`/`anon`).
- No dev/demo seed data (organisations/engagements/assessments) was
  added beyond what the test suite itself creates — deliberately: a
  synthetic dev user cannot actually log in through the real
  application in this environment without a live Supabase project to
  issue it a session (the same D-03 gap above), so a seed script's
  practical value right now is limited. A reasonable, low-cost addition
  for the first environment with real Supabase credentials configured,
  deferred rather than built speculatively.
- No end-to-end/browser test (Playwright or similar) was written — the
  required test areas (instructions §21) are covered by direct tests of
  the actual Server Component/Server Action functions the real pages
  call (the standard, legitimate way to test Next.js Server Actions —
  they are plain exported async functions) plus `npm run build`'s own
  full compile of every route; spinning up real browser E2E
  infrastructure is a larger, separately-scoped investment better
  suited to a future slice, not silently skipped but not attempted
  here either.
- Every other Milestone 1-8A known limitation (D-03/D-04/D-05/D-06,
  storage/signed-URLs, malware scanning, the permission-catalogue
  completeness gap, etc.) remains exactly as previously documented and
  is unaffected by this slice.

### Recommended next application slice

With authentication, session resolution, authorization, the shell, and
one real vertical slice proven end-to-end, PRODUCT_UX_BLUEPRINT.md §23's
own build sequence (Phase B: Organisation/Engagement management
breadth — creation forms, membership management, Client Master Data
screens) is the natural next step; alternatively, deepening Phase C
(the full Assessment workspace — Control Test recording, Evidence
linkage) over the one AssessmentControl-row slice built here. Either
is a reasonable next slice; this report does not preempt the user's own
choice between them.

### Git status / remote synchronization status

All Slice A1 work is committed on `claude/primus-privacy-architecture-39p3gh`
and pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

## Milestone 8A — Historical Maturity Integrity Hardening (Session 12, 2026-09-01)

**Scope:** exactly what MILESTONE 8A instructed — close the historical-
integrity gap Milestone 8's own final report named (§16: "`MaturityDomain
.name`/`description` remain ordinarily mutable and are NOT versioned/
snapshotted onto historical `MaturityScore` rows"), and nothing else. No
new feature set, no UI, no DPIA/SDF, no reporting, no maturity-engine
redesign — none of those exist anywhere in this change.

### 1. Inspection and recommendation

Read `DATA_MODEL.md` §9, `DECISIONS.md` R-72 onward, and all six existing
Maturity schema files (`maturity-assessments.ts`, `maturity-domains.ts`,
`maturity-scores.ts`, `maturity-scoring-methodologies.ts`,
`maturity-domain-weights.ts`, `maturity-domain-control-mappings.ts`) plus
the existing `tests/maturity` suite fresh from disk before changing
anything, per instruction. Found: every other piece of the required
historical invariant (methodology/version, weight, score, computed_at,
source Assessment) was already answerable from the existing Milestone 8
schema (R-72 through R-80) — only a domain's own name/code/description
were reachable solely via a live `JOIN` to a `MaturityDomain` row R-74
deliberately left ordinarily mutable. Considered three approaches (see
DECISIONS.md R-81 for full reasoning):

- **(A) Version `MaturityDomain` itself** (an identity/version split like
  `ControlLibraryVersion`/`Control`) — rejected as disproportionate:
  Milestone 8's own R-74 already recorded the deliberate decision not to
  build this, and it would require restructuring three tables
  (`MaturityDomain`, `MaturityDomainWeight`, `MaturityDomainControl
  Mapping`) to fix a gap only `MaturityScore` actually has.
- **(B) Historical domain snapshot fields, chosen** — three columns on
  `MaturityScore` itself (the row that actually needs point-in-time
  reproducibility, and is already fully immutable post-creation),
  populated once by a database trigger.
- **(C) Reconstruct history from `audit_log` alone** — rejected: pushes
  enforcement to application-layer replay logic, against instructions
  §5's explicit "do not rely exclusively on TypeScript/application
  logic."

**Chosen solution: (B).** The smallest, least disruptive fix consistent
with the existing architecture — one additive schema migration, one
additive trigger migration, zero changes to any other Maturity mechanism.

### What was implemented

- **Schema** (`db/schema/maturity-scores.ts` extended): three new
  nullable columns — `domain_name_snapshot`, `domain_code_snapshot`,
  `domain_description_snapshot` (all `text`) — present only on a
  per-domain `MaturityScore` row, always `NULL` on the overall row. A new
  CHECK (`maturity_scores_domain_snapshot_presence_check`) enforces that
  presence-or-absence structurally: snapshot columns are non-null (name/
  code) if and only if `maturity_domain_id` is set (`description` is
  excluded from the non-null side, since `MaturityDomain.description`
  is itself nullable — a null snapshot there is a faithful copy).
- **Migration 0016** (`drizzle-kit` generated; collided with the existing
  hand-written `0015_maturity_security.sql`'s numbering, renamed to
  `0016_maturity_domain_snapshot.sql`, the same recurring renumbering
  ritual as every prior milestone): three `ALTER TABLE ... ADD COLUMN`
  statements plus the new CHECK. No statement-ordering fix or deferred-
  constraint issue — the CHECK references only pre-existing columns.
- **Migration 0017** (hand-written, per DECISIONS.md R-02):
  `snapshot_maturity_domain_definition()` — a `BEFORE INSERT` trigger on
  `maturity_scores` that, when `maturity_domain_id IS NOT NULL`, looks up
  the referenced `MaturityDomain` row and copies its current `name`/
  `code`/`description` into the three snapshot columns, **unconditionally
  overwriting** whatever value the application attempted to pass — the
  same "trigger sets it, the application never sets it directly" posture
  already used for `control_library_versions.published_at`/`maturity_
  assessments.finalized_at`; forces all three columns `NULL` for the
  overall row. Combined with `maturity_scores` already carrying no UPDATE
  grant at all (unchanged from Milestone 8), the snapshot becomes
  permanently frozen the instant it is written — no separate freeze
  trigger needed. A best-effort, additive backfill `UPDATE` (touches only
  the three new, previously-`NULL` columns; no historical `score`/
  `maturity_level`/`computed_at` is altered) — see "Backfill" below.
- **No RLS/policy/GRANT changes anywhere** — the new columns belong to an
  existing, already-fully-covered table; a row-level policy authorizes an
  entire row, not individual columns, and the table's existing
  `SELECT,INSERT`-only grant (no `UPDATE`/`DELETE`) already makes the new
  columns immutable post-creation with zero additional enforcement.

### Backfill (exactly how it works, per instruction §8)

For any pre-existing, domain-scoped `MaturityScore` row whose new
snapshot columns are still `NULL`, migration 0017's `UPDATE` copies the
referenced `MaturityDomain`'s **current** `name`/`code`/`description`
into the snapshot columns — the best available substitute, since the
domain's definition *at that row's own original `computed_at`* was never
captured before this migration existed and cannot be recovered with
certainty after the fact (a full `audit_log.field_changes` replay could
in principle do better, but was not built — disproportionate engineering
for a scenario with no real rows to apply it to; see DECISIONS.md R-82).
In practice this `UPDATE` is a no-op in every environment this project
has ever run in: D-03 (data residency) remains unresolved, no real
Supabase project exists, and `scripts/reset-test-db.ts` always starts
every test run from an empty database — there is no pre-existing
`MaturityScore` row anywhere for it to act on. Included for real-
deployment readiness, not because backfill was actually exercised.

### Testing performed (exact commands, run in this order)

1. `npm run typecheck` — clean, before and after both migrations and the
   new test file.
2. `npm run db:generate` — generated migration 0016; collided with
   `0015_maturity_security.sql`'s numbering — renamed to `0016_maturity_
   domain_snapshot.sql`, `meta/_journal.json`/`meta/0016_snapshot.json`
   fixed, re-ran `db:generate` to confirm "No schema changes, nothing to
   migrate."
3. `npx tsx scripts/reset-test-db.ts` (18 migration files, 0000-0017) —
   succeeded cleanly on the first attempt, both after 0016 alone and
   again after hand-writing 0017.
4. `npx vitest run tests/maturity` (all 7 pre-existing files) — all 64
   pre-existing tests still passing, unchanged, with the new trigger
   active — confirms the hardening is fully transparent/backward-
   compatible to every already-approved Milestone 8 behavior.
5. Wrote `tests/maturity/domain-snapshot-integrity.test.ts` (the required
   §3 scenario) and ran it standalone — **failed once**: a spoofed-
   snapshot test attempted to `INSERT` an extra `MaturityScore` into the
   already-finalized MA1, correctly rejected by the pre-existing insert-
   gate trigger (working as designed, not a bug) — fixed by creating a
   fresh, still-draft `MaturityAssessment` for that one test instead of
   reusing MA1. Re-ran — 8/8 passing.
6. `npm run lint` — clean.
7. `npm run test:db` (fresh reset + full suite: `tests/rls` +
   `tests/master-data` + `tests/processing-activity` + `tests/control-
   library` + `tests/assessment-engine` + `tests/evidence` + `tests/
   risk-remediation` + `tests/maturity`) — **370/370 passing**. Run
   **twice** in full (fresh `reset-test-db` each time) to prove
   stability — 370/370 both times, identical results.
8. `npm run build` (`next build`) — compiles successfully, no type or
   lint errors.
9. Direct `psql` inspection: `information_schema.columns` confirmed the
   three new nullable `text` columns; `pg_constraint` confirmed the new
   CHECK alongside the two pre-existing ones, unchanged;
   `information_schema.triggers` confirmed 3 triggers on `maturity_
   scores` (the pre-existing audit and insert-gate triggers, unchanged,
   plus the new snapshot trigger); `pg_class`/`pg_policies`/
   `information_schema.role_table_grants` confirmed RLS enable/force,
   both policies, and the `SELECT,INSERT`-only grant are byte-for-byte
   unchanged from Milestone 8. One standalone `psql` transaction (outside
   vitest, using `SAVEPOINT`s) reproduced, directly against the database:
   (a) a `MaturityScore`'s snapshot immediately after insert matches the
   domain's v1 definition; (b) after the live `MaturityDomain` row is
   renamed and its description revised, the historical `MaturityScore`'s
   snapshot is completely unchanged while a live `JOIN` to the same
   domain now shows the revised values — the divergence demonstrated
   side-by-side in one query; (c) the finalized `MaturityAssessment`
   (and by extension its `MaturityScore` rows) remains otherwise fully
   immutable, unaffected by this change.

### tests/maturity/domain-snapshot-integrity.test.ts (1 new file, 8 new tests)

The exact required §3 scenario — Governance (code GOV, "Original
definition") created; MaturityAssessment MA1 created, scored (Governance
= 3/Defined, plus the overall row), and finalized; the CURRENT Governance
domain then renamed to "Governance & Oversight" with description revised
to "Revised definition." Proves: MA1's score still reports the ORIGINAL
name/code/description; the live domain row genuinely did change (not a
coincidence); MA1's score/level remain 3/Defined; a live `JOIN` to the
current domain shows the revised values side-by-side with the frozen
snapshot, demonstrating the divergence directly; all 8 required
historical questions (domain, name/code, definition, methodology/
version, weight, score, computed_at, source Assessment) are answerable
in one query; the overall row never carries a domain snapshot; an
application attempt to set the snapshot directly is silently overwritten
by the trigger, never honored; the snapshot is immutable like every other
`MaturityScore` field (`asUser`, grant-level `permission denied`).

### Files changed

- New: `drizzle/migrations/0016_maturity_domain_snapshot.sql`,
  `drizzle/migrations/0017_maturity_domain_snapshot_security.sql`,
  `drizzle/migrations/meta/0016_snapshot.json`,
  `tests/maturity/domain-snapshot-integrity.test.ts`.
- Modified: `db/schema/maturity-scores.ts` (three new columns, one new
  CHECK), `drizzle/migrations/meta/_journal.json` (renumbering fix),
  `DATA_MODEL.md` (one additive implementation-clarification paragraph
  after §9), `DECISIONS.md` (R-81, R-82), `PROGRESS.md` (this entry).
- Unchanged: every other Milestone 8 schema/migration/test file;
  `MaturityScoringMethodology`, `MaturityDomainWeight`, `MaturityDomain
  ControlMapping`, `MaturityAssessment` — none touched; every RLS policy,
  grant, and pre-existing trigger — none touched; `ARCHITECTURE.md`,
  `SECURITY.md`, `PRODUCT_SPEC.md`, `ROADMAP.md`, `README.md`, and every
  migration/schema file from Milestones 1-8 (`0000`-`0015`).

### Remaining limitations

- The backfill (migration 0017 §2) can only use each domain's CURRENT
  definition for any row created before this migration — no real such
  row exists in any environment this project has run in, so this is
  currently a theoretical gap, not an observed one (DECISIONS.md R-82).
- `MaturityDomainControlMapping` still receives no equivalent
  point-in-time protection — deliberately: it only ever influences
  *future* computations (unchanged from Milestone 8's own reasoning),
  and `MaturityScore.computed_from_control_test_ids` already
  independently preserves exactly which `ControlTest` rows fed a
  historical score.
- The two Risk/Validation traceability arrays on `MaturityAssessment`
  (`computed_from_risk_ids`/`computed_from_validation_record_ids`,
  DECISIONS.md R-79) remain un-snapshotted and not per-element FK-
  enforced — out of scope for this narrowly-defined hardening pass,
  which targeted only the `MaturityDomain` limitation Milestone 8's own
  report named.
- Every other Milestone 8 known limitation (no scoring engine; no final
  PRIMUS domains/weights/levels/formulas; the open Risk-to-Maturity/
  Validation-to-Maturity mathematical relationship) remains unchanged
  and unaddressed, as instructed.

### Git status / remote synchronization status

All Milestone 8A work is committed on `claude/primus-privacy-architecture-39p3gh`
and pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

## Milestone 8 — Maturity (Session 11, 2026-09-01)

**Scope:** exactly what MILESTONE 8 instructed — `MaturityScoringMethodology`,
`MaturityDomain`, `MaturityDomainWeight`, `MaturityDomainControlMapping`,
`MaturityAssessment`, `MaturityScore`, per DATA_MODEL.md §9. No
Dashboards, Reporting, DPIA, AI, Continuous Compliance, or polished UI —
none of those exist anywhere in this milestone's changes. The core
principle instructions §1 states — Maturity is NOT compliance percentage,
NOT number of controls passed, NOT risk score, NOT number of findings
closed — governs every schema decision below; the numeric scores this
milestone's own tests write are computed in the test code itself (the
same "store and pin the configuration, don't build a calculator"
posture Milestone 7 established for RiskScoringModel), never derived
automatically from RemediationAction.status or ValidationRecord.outcome.

Read `DATA_MODEL.md` §9/§12, `DECISIONS.md` R-66 through R-71, and the
actual Milestone 5/6/7 code (`db/schema/assessments.ts`,
`db/schema/assessment-controls.ts`, `db/schema/control-tests.ts`,
`db/schema/risk-scoring-models.ts`, `db/schema/risks.ts`,
`db/schema/validation-records.ts`, migrations 0008-0013) fresh from disk
before writing anything, per instruction. One genuine schema ambiguity
was found and documented before making a consequential choice
(DECISIONS.md R-72, per instructions' own established practice): §9's
literal DATA_MODEL.md table names no `MaturityAssessment` row at all —
the milestone brief's own §2 explicitly requires implementing one
anyway, so it is added as an additive grouping/header entity the
architecture's own prose already implies but never separately names.

### What was implemented

- **Drizzle TS schema** (6 new files): `db/schema/maturity-scoring-
  methodologies.ts` (`MaturityScoringMethodology` — Tenant-scoped,
  append-only, `definition` jsonb, `is_active`, mirrors `RiskScoringModel`
  exactly); `db/schema/maturity-domains.ts` (`MaturityDomain` — Tenant-
  scoped, ordinarily mutable except `tenant_id`, no versioning framework
  invented); `db/schema/maturity-domain-weights.ts`
  (`MaturityDomainWeight` — engagement-scoped, append-only per
  (engagement, domain), `weight` numeric with a positive-value CHECK);
  `db/schema/maturity-domain-control-mappings.ts`
  (`MaturityDomainControlMapping` — Tenant-scoped junction, insert/
  delete only, mirrors `RiskControl`'s Control-half); `db/schema/
  maturity-assessments.ts` (`MaturityAssessment` — the additive header:
  `assessment_id` [NOT NULL, frozen], `maturity_scoring_methodology_id`
  [NOT NULL, frozen], `status` [draft/finalized], `finalized_at`
  [trigger-stamped], additive `computed_from_risk_ids`/`computed_from_
  validation_record_ids` uuid arrays); `db/schema/maturity-scores.ts`
  (`MaturityScore` — `maturity_domain_id` [nullable for the overall row],
  `maturity_domain_weight_id` [nullable, pinned], `score` [1-5 CHECK],
  additive `maturity_level`, `computed_from_control_test_ids` [DATA_
  MODEL.md's own literal traceability field]).
- **New enum**: `maturity_assessment_status` (draft/finalized — a
  separate Postgres type reusing `assessment_status`'s exact vocabulary,
  not a reference to it).
- **Migration 0014** (`drizzle-kit` generated; drizzle-kit's own
  numbering collided with the existing hand-written
  `0013_risk_findings_remediation_security.sql` — the same recurring
  renumbering ritual as every prior milestone, renamed to
  `0014_maturity.sql`): 6 new tables, 1 new enum, every composite FK/
  CHECK/UNIQUE described above. No statement-ordering fix or deferred-
  CHECK-constraint issue this time (every new UNIQUE lives on a brand-new
  table's own `CREATE TABLE`, not appended to a pre-existing one, so the
  R-39-class ordering bug this project has hit in every milestone since
  Milestone 3 simply had nothing to trigger it on).
- **Migration 0015** (hand-written, per DECISIONS.md R-02): a partial
  `UNIQUE INDEX` enforcing "at most one overall (domain-null)
  `MaturityScore` row per `MaturityAssessment`" (DECISIONS.md R-78 — a
  plain `UNIQUE` constraint cannot express this, since Postgres treats
  every `NULL` as distinct); audit-column FKs; reparenting guards
  (`MaturityDomain`'s covering `tenant_id` only; `MaturityAssessment`'s
  covering the scope quintuple — engagement/organisation/tenant/
  assessment/methodology); **two** append-only close-out triggers
  (`MaturityScoringMethodology`'s, per-Tenant, and `MaturityDomainWeight`'s,
  per-engagement-and-domain — DECISIONS.md R-75); `MaturityAssessment`'s
  finalization guard (`enforce_maturity_assessment_finalization`, mirrors
  `Assessment`'s own two-trigger reparenting+finalization split exactly
  — DECISIONS.md R-76); a `require_finalized_assessment_for_maturity`
  BEFORE INSERT trigger enforcing instructions §7's "finalized Assessment
  Responses" requirement at the database layer; a `MaturityScore` insert-
  gate trigger (`enforce_maturity_score_draft_mutable`, DECISIONS.md
  R-77) mirroring Milestone 5's `enforce_assessment_control_draft_
  mutable`; RLS enabled with `FORCE` on all 6 tables and 15 policies —
  `MaturityScoringMethodology`/`MaturityDomain` get the same
  `can_access_tenant`/`is_active_tenant_member` asymmetry as
  `RiskScoringModel`/`ControlLibraryVersion` (R-47); everything else
  uses symmetric `can_access_engagement` (or the Tenant-scoped-junction
  variant `MaturityDomainControlMapping` uses, mirroring `control_
  requirements`); `GRANT`/`REVOKE` statements —
  `MaturityScoringMethodology`/`MaturityDomainWeight`/`MaturityScore` all
  get `SELECT,INSERT` only, no `UPDATE`/`DELETE` ever; audit triggers
  reusing `log_methodology_change()`/`log_methodology_relationship_
  change()` **unchanged** for a fifth milestone in a row.
- **The CRITICAL semantic-separation invariant** (instructions §1/§10/
  §11): no trigger, FK, or generated column anywhere in this schema
  reads `remediation_actions.status` or `validation_records.outcome` to
  derive a `MaturityScore`/`MaturityAssessment` value; the two additive
  Risk/Validation traceability arrays on `MaturityAssessment` record that
  those signals were *available and considered*, never that they were
  *mathematically factored in* — the open Risk-to-Maturity/Validation-to-
  Maturity formula is explicitly preserved, not silently resolved
  (DECISIONS.md R-79/R-80). Verified via the Vitest suite AND a
  standalone `psql` transaction.
- **Historical reproducibility / methodology versioning** (instructions
  §9): `MaturityAssessment.maturity_scoring_methodology_id` is `NOT NULL`
  and frozen by the reparenting guard; `MaturityScoringMethodology` rows
  are never edited or deleted once superseded. Verified by `methodology-
  versioning.test.ts` — a MaturityAssessment computed under Methodology
  v1 resolves to v1's unchanged `definition` after Methodology v2 is
  introduced.
- **Finalized-maturity immutability** (instructions §12): once a
  `MaturityAssessment.status = 'finalized'`, no further UPDATE of any
  kind succeeds (not even a no-op); `MaturityScore` rows are fully
  immutable from the moment of creation (no UPDATE/DELETE grant at all)
  and cannot even be *inserted* once the parent is finalized.

### Testing performed (exact commands, run in this order)

1. `npm run typecheck` — clean, repeated after every schema/migration/
   test change.
2. `npm run db:generate` — generated migration 0014; collided with
   `0013_risk_findings_remediation_security.sql`'s numbering (the same
   recurring drizzle-kit issue as every prior milestone) — renamed to
   `0014_maturity.sql`, `meta/_journal.json`/`meta/0014_snapshot.json`
   fixed, re-ran `db:generate` to confirm "No schema changes, nothing to
   migrate."
3. Reviewed the generated SQL directly: no statement-ordering fix needed
   (see "What was implemented" above) — applied to a fresh database
   cleanly on the first attempt.
4. Hand-wrote migration 0015; applied to a fresh database — succeeded
   cleanly.
5. `npx vitest run tests/maturity` — ran the new suite. **Failed** on
   first run with five distinct bugs, all found by actually executing
   the tests, not by inspection:
   - Two test files (`immutability.test.ts`, `consistency.test.ts`) each
     called `pool.end()` in more than one `describe` block's `afterAll`
     — a genuine test-authoring bug (this project's own established
     convention, followed inconsistently here, is exactly one `pool.
     end()` call per file, in the last block only) — fixed by removing
     the duplicate calls.
   - `audit.test.ts`'s actor-attribution test attempted a raw INSERT into
     `maturity_domains` (Tenant-scoped content, requires `is_active_
     tenant_member`) using a user who only holds OrganisationMembership
     — a test-authoring bug, not a schema bug — fixed by switching the
     target to `maturity_assessments` (client engagement data, symmetric
     `can_access_engagement`).
   - `crud.test.ts` attempted to insert a `ControlTest` tied to an
     `assessment_id` *after* that Assessment had already been finalized
     in the same `beforeAll` — violates Milestone 5's own finalization-
     immutability guard (working as designed) — a test-ordering bug,
     fixed by creating the ControlTest before finalizing.
   - `methodology-versioning.test.ts` found a **genuine schema bug**:
     introducing Methodology v2 did not close out v1's `is_active` flag.
     Diagnosed correctly as a real omission, not a test bug — migration
     0015 defined the append-only close-out trigger for `MaturityDomain
     Weight` but never wrote the equivalent trigger for
     `MaturityScoringMethodology` itself (DECISIONS.md R-73 describes the
     mechanism as mirroring `RiskScoringModel`'s exactly; the trigger
     mirroring it was simply missing). **Fixed** by adding `close_out_
     previous_active_maturity_scoring_methodology()` (BEFORE INSERT,
     identical shape to `risk_scoring_models_close_out_previous`) to
     migration 0015, re-applied to a fresh database, re-verified.
   - `tenant-isolation.test.ts` had two bugs: (a) a test created an
     Assessment referencing a ControlLibraryVersion *before* pinning that
     library version to the Assessment's own Engagement, violating the
     `assessments_engagement_control_library_version_fk` composite FK
     (a test-ordering bug, fixed by reordering); (b) the "authorized user
     CAN write" positive-control test used an org-scoped user to write
     `MaturityDomain` (Tenant-scoped content), which correctly failed —
     fixed by adding a genuine TenantMembership-holding fixture user for
     that one positive-control assertion, rather than weakening the
     table's own read/write asymmetry.
6. Re-ran `npx vitest run tests/maturity` after all six fixes —
   **64/64 passing**.
7. `npx vitest run tests/rls tests/master-data tests/processing-activity
   tests/control-library tests/assessment-engine tests/evidence tests/
   risk-remediation` — all 298 pre-existing tests still passing against
   the post-Milestone-8 schema, **after** one necessary correction: the
   Milestone 7 historical-scenario suite's own check #8 ("no Maturity
   table exists anywhere in this schema") was written when Maturity did
   not yet exist and would now trivially and correctly fail once it does
   — the assertion was updated (not deleted, not weakened) to check the
   real invariant it always meant to protect: zero `MaturityAssessment`
   rows exist for that scenario's tenant, because nothing in it ever
   computed one. Documented here rather than silently patched.
8. `npm run test:db` (fresh reset + full suite: `tests/rls` +
   `tests/master-data` + `tests/processing-activity` + `tests/control-
   library` + `tests/assessment-engine` + `tests/evidence` + `tests/
   risk-remediation` + `tests/maturity`) — **362/362 passing**. Run
   **twice** in full (fresh `reset-test-db` each time) to prove
   stability — 362/362 both times, identical results.
9. `npm run lint` — clean.
10. `npm run build` (`next build`) — compiles successfully, static pages
    generated, no type or lint errors.
11. Direct `psql` inspection of the resulting database: `relrowsecurity`/
    `relforcerowsecurity` confirmed `t`/`t` on all 6 new tables;
    `pg_policies` confirmed all 15 new policies with the expected
    commands (including the `MaturityScoringMethodology`/`MaturityDomain`
    read/write asymmetry); `information_schema.role_table_grants`
    confirmed `authenticated` has exactly the intended privileges per
    table (`MaturityScoringMethodology`/`MaturityDomainWeight`/
    `MaturityScore`: `INSERT,SELECT` only) and `anon`/`PUBLIC` have none;
    `pg_constraint` confirmed all 40 FK/UNIQUE/CHECK constraints;
    `pg_indexes` confirmed the hand-written partial `UNIQUE INDEX`
    separately; `information_schema.triggers` confirmed 16 triggers
    present with correct timing/events, including both close-out
    triggers, the two-trigger `MaturityAssessment` reparenting+
    finalization split, the finalized-Assessment-required INSERT gate,
    and the `MaturityScore` insert-gate. One standalone `psql`
    transaction (outside vitest, using `SET ROLE authenticated` +
    `SAVEPOINT`s) reproduced, directly against the database: (a)
    introducing MethodologyV2 flips MethodologyV1's `is_active` false
    while its `definition` remains byte-for-byte unchanged; (b) the
    `authenticated` role gets `permission denied` attempting to UPDATE or
    DELETE MethodologyV1, proving the no-grant-at-all append-only
    enforcement directly, not merely by absence of a passing test; (c) a
    finalized `MaturityAssessment` rejects even a genuinely no-op UPDATE;
    (d) the finalized `MaturityAssessment` still resolves to Methodology
    v1.0's unchanged `definition` after v2 exists and is active —
    historical maturity/scoring configuration cannot be silently
    rewritten, demonstrated end-to-end.

### tests/maturity (7 new files, 64 new tests)

- `crud.test.ts` (6 tests): creation/read coverage for all six tables,
  including the required "control test must be created before its
  Assessment is finalized" ordering, and a finalize-after-scoring
  MaturityAssessment lifecycle.
- `methodology-versioning.test.ts` (5 tests): the required §9 test — a
  MaturityAssessment pins the active methodology at creation time;
  introducing v2 closes out v1 without altering v1's content; a
  MaturityAssessment created under v1 continues to resolve to v1 after
  v2 exists; v1 cannot be edited/deleted through any ordinary path even
  after being superseded; a MaturityAssessment's own methodology pin is
  itself frozen.
- `immutability.test.ts` (13 tests, four `describe` blocks):
  `MaturityDomain`'s reparenting guard (tenant_id frozen, ordinary fields
  freely editable); `MaturityDomainWeight`'s no-UPDATE/DELETE grant and
  append-only close-out behavior, plus its positive-weight CHECK;
  `MaturityAssessment`'s "cannot create from a non-finalized Assessment"
  precondition, its reparenting guard, the draft→finalized auto-stamp,
  the direct-`finalized_at`-write rejection, and full lock-out once
  finalized (including an attempted unfinalize and a no-op UPDATE);
  `MaturityScore`'s no-UPDATE/DELETE grant, its insert-gate once the
  parent is finalized, and its 1-5 score-range CHECK.
- `consistency.test.ts` (10 tests, four `describe` blocks): the §13
  referential-integrity suite — a MaturityAssessment's assessment_id must
  match its own engagement/organisation/tenant (cross-engagement
  rejected) and its methodology must be same-tenant (cross-tenant
  rejected); a MaturityScore's domain must be same-tenant and its pinned
  weight same-engagement (both rejected cross-scope); the weight-
  requires-domain CHECK; both "at most one score per domain/overall per
  assessment" uniqueness rules; MaturityDomainControlMapping's cross-
  tenant Control rejection; and the explicit, demonstrated limitation
  that the two traceability arrays are not FK-enforced per element
  (DECISIONS.md R-79).
- `historical-scenario.test.ts` (8 tests): the exact §8 ABC Financial
  FY2026/FY2027 scenario — Assessment A1 finalized (C1=Implemented,
  C2=Partially Implemented, C3=Not Implemented), Risk residual=High, one
  remediation validated, MaturityAssessment MA1 computed and finalized
  (domain/overall score 3/"Defined"); FY2027's Assessment A2
  (C3→Implemented), a new superseding Risk, MaturityAssessment MA2
  (domain/overall score 4/"Managed"); all 8 required checks: MA1
  unchanged; MA1 still linked to Assessment A1/FY2026; MA1's scores
  unchanged (exact row ids); MA2 is a distinct row linked to A2/FY2027;
  MA2's scores differ; MA1 cannot be rewritten (direct attempt rejected,
  audit history shows only insert+one finalize update); FY2026 maturity
  fully reconstructable in one query; MA1's methodology/version remains
  identifiable and unchanged.
- `tenant-isolation.test.ts` (14 tests): the §14 RLS suite — Tenant A can
  access its own maturity data; Tenant A blocked from Tenant B; Organisation
  A1 blocked from Organisation A2 (same tenant); engagement-scoped access
  proven exact; unauthorized reads/writes blocked; anonymous denied at the
  grant level for all 6 tables; cross-tenant source Assessment and
  methodology relationships both rejected by composite FK; a positive
  write case (via a genuine TenantMembership holder) proving the blocks
  are real; the MaturityScoringMethodology read/write asymmetry.
- `audit.test.ts` (8 tests): creation/material-update/finalization/
  methodology-association audit coverage for all 6 tables, a full
  historical-reconstruction-from-audit-log check, and `auth.uid()` actor
  attribution.

### Files changed

- New: `db/schema/maturity-scoring-methodologies.ts`,
  `db/schema/maturity-domains.ts`, `db/schema/maturity-domain-weights.ts`,
  `db/schema/maturity-domain-control-mappings.ts`,
  `db/schema/maturity-assessments.ts`, `db/schema/maturity-scores.ts`,
  `drizzle/migrations/0014_maturity.sql`,
  `drizzle/migrations/0015_maturity_security.sql`,
  `drizzle/migrations/meta/0014_snapshot.json`,
  `tests/maturity/helpers.ts`, `tests/maturity/crud.test.ts`,
  `tests/maturity/methodology-versioning.test.ts`,
  `tests/maturity/immutability.test.ts`,
  `tests/maturity/consistency.test.ts`,
  `tests/maturity/historical-scenario.test.ts`,
  `tests/maturity/tenant-isolation.test.ts`, `tests/maturity/audit.test.ts`.
- Modified: `db/schema/enums.ts` (new `maturity_assessment_status` enum),
  `db/schema/index.ts` (barrel exports), `package.json` (new
  `test:maturity` script, `test:db` extended, description bumped),
  `drizzle/migrations/meta/_journal.json` (renumbering fix),
  `tests/risk-remediation/historical-scenario.test.ts` (one assertion
  corrected — see "Testing performed" item 7), `DATA_MODEL.md` (one
  additive implementation-clarification paragraph after §9),
  `DECISIONS.md` (R-72 through R-80), `PROGRESS.md` (this entry).
- Unchanged: `ARCHITECTURE.md`, `SECURITY.md`, `PRODUCT_SPEC.md`,
  `ROADMAP.md`, `README.md`, and every migration/schema file from
  Milestones 1-7 (`0000`-`0013`, and every `db/schema/*.ts` file this
  milestone didn't touch, apart from the one enums.ts addition).

### Known limitations (documented, not silently built around)

- No Maturity scoring **engine** exists — this milestone builds and
  tests the data structures (methodology, domains, weights, mappings,
  assessments, scores) a future engine would read from and write to;
  every `MaturityScore` value in this milestone's own tests is written
  directly by test code simulating that future computation, not produced
  by any automatic calculation.
- `computed_from_risk_ids`/`computed_from_validation_record_ids` (and
  DATA_MODEL.md's own `computed_from_control_test_ids`) are plain
  `uuid[]` arrays with no per-element foreign key — Postgres cannot
  express that constraint on an array column. A nonexistent or wrong-
  tenant id can currently be stored in either array without rejection;
  demonstrated directly (not just noted) in `tests/maturity/
  consistency.test.ts`. Resolving this (e.g. real junction tables) is
  deferred to whichever future milestone defines the real mathematical
  relationship these arrays currently only preserve as an open question
  (DECISIONS.md R-79).
- `MaturityDomain.name`/`description` remain ordinarily mutable and are
  NOT versioned/snapshotted onto historical `MaturityScore` rows — a
  domain rename after the fact changes what a historical score's domain
  *label* resolves to via a live JOIN, though never the score's own
  numeric value (DECISIONS.md R-74). A deliberate economy decision,
  matching instructions §4's explicit "do NOT invent a large production
  domain framework."
- The exact mathematical relationship between Risk (residual rating),
  Validation outcomes, and a Maturity score remains an explicitly open,
  undecided methodology question (instructions §10/§11) — this
  milestone preserves the inputs (traceability arrays) without
  resolving it, per direct instruction.
- No final PRIMUS maturity domains, scoring weights, levels, formulas,
  benchmarks, or industry thresholds exist anywhere in this milestone —
  every domain/methodology/level created in this milestone's tests is
  explicitly named and commented as synthetic/test content only.
- Carried forward, unaddressed (out of scope this milestone): every
  Milestone 4-7 limitation already on record (published `Requirement`
  content not independently frozen by publish state; `Assessment`'s
  two-state status only; the storage-authorization-only testing scope
  for Evidence/DocumentVersion; the CONSULTANT_INTERNAL/CLIENT_VISIBLE
  `visibility` column not RLS-enforced; `RemediationAction.status`
  transitions not database-enforced).
- No UI of any kind was built (none was requested) — every table above
  was exercised exclusively through direct SQL/RLS-aware test clients.

### Explicitly deferred methodology decisions (instructions §17)

- The actual PRIMUS maturity domain taxonomy (which domains exist, what
  they're called, how many there are).
- The actual scoring formula/weights mapping AssessmentResponse ratings
  (and any other signal) to a domain score and an overall weighted score.
- The actual maturity-level labels/thresholds (this milestone's test
  methodology uses illustrative labels like "Ad Hoc"/"Developing"/
  "Defined"/"Managed"/"Optimized," explicitly as placeholders, not as a
  proposed final taxonomy).
- Whether/how Risk (residual rating) mathematically influences a Maturity
  score, and by how much.
- Whether/how a validated remediation outcome mathematically influences a
  Maturity score, and by how much.
- Industry benchmarks or peer-comparison thresholds — not represented in
  this schema at all yet.

### Recommended Milestone 9

With the CRITICAL Milestone 7/8 rule now enforced end-to-end (no
automatic maturity/risk change from remediation completion; no automatic
maturity value from any raw signal), the codebase has every entity
DATA_MODEL.md §1-§9 names, fully tested for historical reproducibility,
tenancy, and auditability. The natural next layer is either (a) DPIA/SDF
Screening (DATA_MODEL.md §7 — the two Assessment specializations
deferred since Milestone 5), or (b) the actual PRIMUS Maturity
methodology as a deliberate product/methodology design exercise (populate
real `MaturityScoringMethodology`/`MaturityDomain`/`MaturityDomainWeight`
content, still without building dashboards/reporting/UI) — the user's
own milestone brief frames this as a decision to make after reviewing
the Maturity architecture this milestone delivers, not one for this
report to preempt.

### Git status / remote synchronization status

All Milestone 8 work is committed on `claude/primus-privacy-architecture-39p3gh`
and pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

## Milestone 7 — Risk, Findings & Remediation (Session 10, 2026-09-01)

**Scope:** exactly what MILESTONE 7 instructed — `RiskScoringModel`,
`Risk`, `Finding`, `RemediationAction`, `ValidationRecord`, and their
junctions (`RiskControl`, `RiskProcessingActivity`, `FindingRisk`,
`FindingControl`, `FindingProcessingActivity`, `RemediationFinding`,
`RemediationRisk`, `RemediationControl`), per DATA_MODEL.md §8. No
Maturity, dashboards, reporting, DPIA, AI, Continuous Compliance, or
polished UI — none of those exist anywhere in this milestone's changes.
The core principle instructions §1 states — Assessment Result / Risk /
Finding / RemediationAction / ValidationRecord are four distinct object
kinds, never collapsed into one — governs every schema decision below;
nothing auto-creates a Finding from a failed control, and nothing
derives a Risk/Finding/AssessmentResponse change from a RemediationAction's
`status` column.

Read `DATA_MODEL.md` §8/§12, `DECISIONS.md` R-57 through R-65, and the
actual Milestone 4/5/6 code (`db/schema/control-library.ts`,
`db/schema/assessment-controls.ts`, `db/schema/control-tests.ts`,
`db/schema/evidence-links.ts`, migrations 0006-0011) fresh from disk
before writing anything, per instruction. Two design bugs were found
this milestone not by inspection but by the required historical scenario
(§10) actually failing against a first-draft schema, then correctly
diagnosed as genuine architecture flaws (not test bugs) and fixed —
see DECISIONS.md R-69/R-70 and "Testing performed" below.

### What was implemented

- **Drizzle TS schema** (9 new files): `db/schema/risk-scoring-models.ts`
  (`RiskScoringModel` — Tenant-scoped, append-only, `matrix_definition`
  jsonb, `is_active`); `db/schema/risks.ts` (`Risk` — `likelihood`/
  `impact` [CHECK 1-5], `inherent_rating`, nullable `residual_
  likelihood`/`residual_impact`/`residual_rating`, `risk_scoring_
  model_id` [NOT NULL, frozen], nullable `assessment_response_id`,
  nullable self-referencing `previous_risk_id`); `db/schema/risk-
  links.ts` (`RiskControl`, `RiskProcessingActivity`); `db/schema/
  findings.ts` (`Finding` — `severity`, `status`, `owner_id`);
  `db/schema/finding-links.ts` (`FindingRisk`, `FindingControl`,
  `FindingProcessingActivity`); `db/schema/remediation-actions.ts`
  (`RemediationAction` — exact DATA_MODEL.md 5-value status set
  [open/in_progress/evidence_submitted/validated/closed], `due_date`,
  nullable `priority`/`completed_at`); `db/schema/remediation-links.ts`
  (`RemediationFinding`, `RemediationRisk`, `RemediationControl`);
  `db/schema/validation-records.ts` (`ValidationRecord` — `outcome`,
  `validated_by`/`validated_at`, nullable `triggers_control_test_id`/
  `triggers_assessment_response_id` with a CHECK that at most one is set
  and only when `outcome = accepted`).
- **New enums**: `risk_rating` (low/medium/high/critical), `risk_status`
  (open/mitigating/accepted/closed), `finding_severity` (low/medium/
  high/critical), `finding_status` (open/in_progress/resolved/accepted),
  `remediation_action_status` (the exact DATA_MODEL.md 5-value set),
  `remediation_priority` (low/medium/high/critical), `validation_
  outcome` (accepted/rejected). `evidence_link_subject_type` extended
  with 2 new values (`remediation_action`, `validation_record`).
- **Extended existing schema files**: `db/schema/evidence-links.ts`
  (2 new nullable subject columns, `subject_matches_type_check` grown
  from 2 to 4 branches, 2 new composite FKs, 2 new NO-DUPE uniques —
  DECISIONS.md R-68); `db/schema/control-tests.ts` (new 4-column
  `idScopeUnique`); `db/schema/assessment-controls.ts` (new 2-column
  `idOrganisationUnique` on `assessmentResponses`, consumed by
  `ValidationRecord`'s reassessment-trigger FK — DECISIONS.md R-70).
- **Migration 0012** (`drizzle-kit` generated, then hand-fixed twice:
  the recurring new-UNIQUE-before-dependent-FK statement-ordering issue
  [Milestones 3/5/6 precedent], and removal of the auto-generated
  `evidence_links_subject_matches_type_check` CHECK — Postgres forbids
  using a same-transaction `ALTER TYPE ... ADD VALUE` inside a CHECK
  expression, so the CHECK was deferred to migration 0013 once the new
  enum values are safely committed [same restriction Milestone 6 first
  found]): 13 new tables, 8 enum changes, every composite FK/CHECK
  described below. Regenerated in full a second time after the R-70 FK
  redesign.
- **Migration 0013** (hand-written, per DECISIONS.md R-02): the deferred
  `evidence_links_subject_matches_type_check` (now 4 branches); audit-
  column FKs for all new tables; reparenting guards (`Risk`'s covering
  `engagement_id`/`organisation_id`/`tenant_id`/`risk_scoring_model_id`;
  `Finding`'s and `RemediationAction`'s covering the scope triple only);
  `RiskScoringModel`'s append-only close-out trigger (`close_out_
  previous_active_risk_scoring_model`, BEFORE INSERT, mirrors Milestone
  4's `ControlLibraryVersion` posture with a simpler single-flag
  mechanism — DECISIONS.md R-67); `ValidationRecord`'s tampering-guard
  trigger (`prevent_validation_record_tampering`, BEFORE UPDATE) —
  freezes every decision field permanently but allows the two
  reassessment-trigger columns to transition exactly once from NULL,
  mirroring Milestone 6's `document_versions.scan_status` one-time-
  transition pattern (DECISIONS.md R-69); RLS enabled with `FORCE` on
  all 13 new tables and 38 policies — `RiskScoringModel` gets the same
  `can_access_tenant`(SELECT)/`is_active_tenant_member`(INSERT)
  asymmetry as `ControlLibraryVersion` (R-47), with no UPDATE/DELETE
  policy at all; everything else uses symmetric `can_access_engagement`;
  `GRANT`/`REVOKE` statements — `RiskScoringModel` gets `SELECT,INSERT`
  only (no UPDATE/DELETE, ever); `ValidationRecord` gets `SELECT,INSERT,
  UPDATE` (no DELETE); audit triggers reusing Milestone 4's
  `log_methodology_change()`/`log_methodology_relationship_change()`
  **unchanged** for a fourth milestone in a row.
- **The CRITICAL semantic-separation invariant** (instructions §7):
  nothing in this schema derives a Risk/Finding/AssessmentResponse
  change from `remediation_actions.status` — the only mechanism that
  records "a reassessment happened" is a human explicitly creating a
  `ValidationRecord` and, later, explicitly setting its reassessment-
  trigger column to a real `ControlTest`/`AssessmentResponse` row it
  itself does not create. Verified via the Vitest suite AND a standalone
  `psql` transaction.
- **Risk scoring versioning** (instructions §4/§11): `Risk.risk_scoring_
  model_id` is `NOT NULL` and frozen by the reparenting guard;
  `RiskScoringModel` rows are never edited or deleted once superseded.
  Verified by `risk-scoring-versioning.test.ts` — a Risk scored under
  Model v1 resolves to v1's `matrix_definition` unchanged after Model v2
  is introduced.
- **EvidenceLink extended to 2 more subject types** (instructions §7/§8):
  `remediation_action`/`validation_record`, both always fully
  engagement-scoped (unlike `ControlTest`'s dual shape), so both new
  FKs are always the standard 4-column composite — DECISIONS.md R-68.

### Testing performed (exact commands, run in this order)

1. `npm run typecheck` — clean, repeated after every schema/migration
   change.
2. `npm run db:generate` — generated migration 0012; collided with
   `0011_evidence_document_management_security.sql`'s numbering (the
   same recurring drizzle-kit issue as every prior milestone) — renamed
   to `0012_risk_findings_remediation.sql`, `meta/_journal.json`/
   `meta/0012_snapshot.json` fixed, re-ran `db:generate` to confirm "No
   schema changes, nothing to migrate."
3. First apply attempt against a fresh database **failed**:
   `error: there is no unique constraint matching given keys for
   referenced table "control_tests"` — the original 4-column
   `triggers_control_test_id` FK needed a single 4-column unique
   `control_tests` didn't yet have (only three separate 2-column
   uniques existed from Milestone 6). Added a new 4-column `idScopeUnique`
   to `control_tests`, regenerated.
4. Reviewed the regenerated SQL and manually fixed the recurring
   statement-ordering issue (new UNIQUEs on `control_tests`/
   `assessment_responses` emitted after their dependent FKs) and removed
   the same-transaction enum-value-in-CHECK statement (deferred to
   migration 0013, per "What was implemented" above).
5. `npx tsx scripts/reset-test-db.ts` — succeeded cleanly; 14 migration
   files applied.
6. `npx vitest run tests/risk-remediation` — ran the new suite against
   the required §10 historical scenario. **Failed** on
   `historical-scenario.test.ts` check #9 ("future assessment can
   reassess the control"): `insert or update on table
   "validation_records" violates foreign key constraint
   "validation_records_triggers_assessment_response_scope_fk"`.
   Diagnosed as a genuine design bug, not a test bug — the FK required
   the ValidationRecord's own `engagement_id` to match the reassessment
   AssessmentResponse's `engagement_id`, but the scenario (correctly,
   per this project's own FY2026/FY2027-as-separate-Engagements
   precedent) creates the reassessment in a *new* Engagement. Fixed by
   redesigning both reassessment-trigger FKs to 2-column
   (`organisation_id`-only) — DECISIONS.md R-70. Added
   `assessment_responses_id_organisation_id_key`. Regenerated migration
   0012 in full, reapplying both prior fixes.
7. Re-ran `npx tsx scripts/reset-test-db.ts` + `npx vitest run
   tests/risk-remediation` — the historical scenario passed, but
   `immutability.test.ts` then surfaced the second design bug: the
   original `SELECT,INSERT`-only `ValidationRecord` grant made it
   impossible to ever set the reassessment-trigger columns the
   historical scenario itself requires setting *after* creation. Fixed
   by redesigning `ValidationRecord`'s mutability to the narrow
   one-time-transition pattern described above — DECISIONS.md R-69
   — adding the UPDATE grant/policy and the tampering-guard trigger.
8. Fixed two test-file bugs surfaced during this cycle: an `asUser`
   write-then-`asFixtureSetup`-verify pattern in `immutability.test.ts`
   that could never persist (`asUser`'s transaction always rolls back —
   switched the write itself to `asFixtureSetup`, the established
   mutation convention); a duplicated placeholder test block (copy-paste
   error), removed. Also cleaned up `tenant-isolation.test.ts`: replaced
   an inline `.catch()` fallback-creation pattern with a proper
   `scoringModelB` fixture in `beforeAll`, and a dynamic `await
   import(...)` with a static import.
9. `npx vitest run tests/rls tests/master-data tests/processing-activity
   tests/control-library tests/assessment-engine tests/evidence` — all
   234 pre-existing tests still passing against the post-Milestone-7
   schema (no regressions).
10. `npm run test:db` (fresh reset + full suite) — **298/298 passing**.
    Run **twice** in full (fresh `reset-test-db` each time) to prove
    stability — 298/298 both times, identical results.
11. `npm run lint` — clean.
12. `npm run build` (`next build`) — compiles successfully, static pages
    generated, no type or lint errors.
13. Direct `psql` inspection of the resulting database: `relrowsecurity`/
    `relforcerowsecurity` confirmed `t`/`t` on all 13 new tables;
    `pg_policies` confirmed all 38 new policies with the expected
    commands (including `RiskScoringModel`'s SELECT/INSERT-only
    asymmetry); `information_schema.role_table_grants` confirmed
    `authenticated` has exactly the intended privileges per table
    (`RiskScoringModel`: `INSERT,SELECT` only; `ValidationRecord`:
    `INSERT,SELECT,UPDATE` only) and `anon`/`PUBLIC` have none;
    `pg_constraint` confirmed all 68 FK/UNIQUE/CHECK constraints,
    including the corrected organisation-only reassessment-trigger FKs
    and both `ValidationRecord` CHECK constraints; `information_schema.
    triggers` confirmed 30 triggers present with correct timing/events
    (reparenting guards, `RiskScoringModel`'s close-out trigger,
    `ValidationRecord`'s tampering-guard trigger, and audit triggers,
    including `validation_records`'s now correctly showing AFTER
    INSERT/UPDATE). One standalone `psql` transaction (outside vitest,
    using `SAVEPOINT`s to isolate each case within a single rolled-back
    transaction) reproduced, directly against the database: (a) a
    cross-tenant `ValidationRecord`→`RemediationAction` insert rejected
    by `validation_records_remediation_action_scope_fk`; (b) a
    `rejected`-outcome `ValidationRecord` carrying a reassessment
    trigger rejected by `validation_records_only_accepted_triggers_
    reassessment_check`; (c) a correctly-scoped, `accepted`, no-trigger
    insert succeeding as a control case.

### tests/risk-remediation (7 new files, 64 new tests)

- `crud.test.ts` (10 tests): `RiskScoringModel`/`Risk`/`Finding`/
  `RemediationAction`/`ValidationRecord` creation; all junction links;
  Evidence linkable to both `RemediationAction` and `ValidationRecord`
  via the extended `EvidenceLink`.
- `risk-scoring-versioning.test.ts` (7 tests): the required §11 test —
  Model v1 created, a Risk scored under it, Model v2 introduced; the
  historical Risk's `risk_scoring_model_id` and the model it resolves to
  remain v1, unchanged; v1's `matrix_definition` itself is unreachable
  by UPDATE/DELETE.
- `immutability.test.ts` (12 tests, two `describe` blocks):
  `RiskScoringModel`'s no-UPDATE/no-DELETE grant (tested via `asUser`,
  not `asFixtureSetup`, so the grant restriction is genuinely exercised);
  `ValidationRecord`'s decision-field immutability and its one-time
  reassessment-trigger transition (both the successful once-only set and
  the rejected second attempt), plus its no-DELETE grant; `Risk`/
  `Finding`/`RemediationAction` reparenting guards, including
  confirmation that ordinary fields (title, status, likelihood, owner)
  remain freely editable.
- `consistency.test.ts` (7 tests): the §13 referential-integrity suite —
  a `Finding` referencing a `ProcessingActivity` must belong to the same
  Engagement as its Assessment context; cross-tenant `RiskControl`
  rejected; cross-engagement `RiskProcessingActivity` rejected;
  cross-tenant/cross-organisation remediation relationships rejected;
  a `ValidationRecord` cannot attach to another tenant's
  `RemediationAction`.
- `historical-scenario.test.ts` (9 tests): the exact §10 ABC Financial
  scenario — FY2026 Control C1 "Partially Implemented", Evidence
  "Processor register v1", Risk (Likelihood=4, Impact=4, High), Finding
  "Processor register incomplete", Remediation "Complete processor/
  subprocessor inventory" (Open → Completed), Evidence "Processor
  register v2", consultant Validation, all 10 required checks: FY2026
  AssessmentResponse unchanged; FY2026 Risk historically reproducible;
  FY2026 Finding historically identifiable; Remediation status/history
  recorded; Evidence v2 linkable to remediation/validation; Validation
  is a separate explicit record; no automatic change to the historical
  AssessmentResponse; no automatic maturity improvement (nothing in this
  schema even has a maturity field to improve); a future FY2027
  assessment can reassess the control; that future assessment may
  produce a different result.
- `tenant-isolation.test.ts` (12 tests): the §12/§14 RLS suite — Tenant A
  cannot read Tenant B risks; Organisation A cannot read Organisation B
  risks; Engagement A cannot read Engagement B findings/remediation;
  cross-tenant/cross-organisation remediation relationships rejected at
  the FK level; a `ValidationRecord` cannot attach to another tenant's
  `RemediationAction`; unauthorized read/write blocking; anonymous
  requests denied at the grant level.
- `audit.test.ts` (7 tests): `Risk` creation/scoring/status-change audit;
  `Finding` creation/severity-status-change audit; `RemediationAction`
  creation/assignment/status-change/completion audit; `ValidationRecord`
  creation/decision audit; `RiskControl` relationship audit
  (insert/delete); `auth.uid()` actor attribution confirmed throughout.

### Files changed

- New: `db/schema/risk-scoring-models.ts`, `db/schema/risks.ts`,
  `db/schema/risk-links.ts`, `db/schema/findings.ts`,
  `db/schema/finding-links.ts`, `db/schema/remediation-actions.ts`,
  `db/schema/remediation-links.ts`, `db/schema/validation-records.ts`,
  `drizzle/migrations/0012_risk_findings_remediation.sql`,
  `drizzle/migrations/0013_risk_findings_remediation_security.sql`,
  `drizzle/migrations/meta/0012_snapshot.json`,
  `tests/risk-remediation/helpers.ts`,
  `tests/risk-remediation/crud.test.ts`,
  `tests/risk-remediation/risk-scoring-versioning.test.ts`,
  `tests/risk-remediation/immutability.test.ts`,
  `tests/risk-remediation/consistency.test.ts`,
  `tests/risk-remediation/historical-scenario.test.ts`,
  `tests/risk-remediation/tenant-isolation.test.ts`,
  `tests/risk-remediation/audit.test.ts`.
- Modified: `db/schema/enums.ts` (new Milestone 7 enum block, plus 2 new
  `evidence_link_subject_type` values), `db/schema/evidence-links.ts`
  (2 new subject columns/FKs/uniques, 4-branch CHECK),
  `db/schema/control-tests.ts` (new 4-column `idScopeUnique`),
  `db/schema/assessment-controls.ts` (new 2-column `idOrganisationUnique`
  on `assessmentResponses`), `db/schema/index.ts` (barrel exports),
  `package.json` (new `test:risk-remediation` script, `test:db`
  extended, description bumped), `drizzle/migrations/meta/_journal.json`
  (renumbering fix), `DATA_MODEL.md` (one additive implementation-
  clarification paragraph after §8), `DECISIONS.md` (R-66 through R-71),
  `PROGRESS.md` (this entry).
- Unchanged: `ARCHITECTURE.md`, `SECURITY.md`, `PRODUCT_SPEC.md`,
  `ROADMAP.md`, `README.md`, and every migration/schema file from
  Milestones 1-6 (`0000`-`0011`, and every `db/schema/*.ts` file this
  milestone didn't touch).

### Known limitations (documented, not silently built around)

- `RemediationAction.status = 'evidence_submitted'` is not enforced at
  the database layer to require a linked Evidence row to exist —
  DATA_MODEL.md §8 itself frames the remediation lifecycle as an
  application-layer state machine, not a database-enforced one
  (DECISIONS.md R-71). The one guarantee the milestone actually requires
  non-negotiable — that `status` changes never themselves prove control
  effectiveness or change a Risk/Finding/AssessmentResponse/Maturity
  signal — is enforced by construction (nothing reads `status` to derive
  any of those).
- No Maturity engine or maturity field exists anywhere yet — "no
  automatic maturity improvement" (§10 check #8) is trivially true
  because nothing computes maturity at all this milestone, exactly as
  instructed (§17-19).
- `Risk.previous_risk_id` and `assessment_response_id` are additive
  fields (DECISIONS.md R-66) supporting the "risk recalculated if
  warranted" relationship named in instructions §1/§9 prose; no
  automatic recalculation trigger exists — a consultant creates a new
  `Risk` row and links it via `previous_risk_id` explicitly, mirroring
  every other "supersession is an explicit new row, never an automatic
  rewrite" pattern in this schema.
- Carried forward, unaddressed (out of scope this milestone): the
  Milestone 4/5/6 limitations already on record (published `Requirement`
  content not independently frozen by publish state; `Assessment`'s
  two-state status only; the storage-authorization-only testing scope
  for Evidence/DocumentVersion; the CONSULTANT_INTERNAL/CLIENT_VISIBLE
  `visibility` column not RLS-enforced).
- No UI of any kind was built (none was requested) — every table above
  was exercised exclusively through direct SQL/RLS-aware test clients.

### Recommended Milestone 8

DATA_MODEL.md §9 (Maturity) is the natural next layer: it reads exactly
the objects this milestone built (finalized `AssessmentResponse`,
`Risk.residual_rating`, `ValidationRecord.outcome`) without needing any
new evidence or remediation infrastructure — the CRITICAL rule this
milestone enforced by construction (no automatic maturity change) means
Milestone 8's own job is precisely to build the first explicit, reviewed
computation that *is* allowed to read these signals and produce a
Maturity score, keeping that computation itself as a versioned,
reproducible, non-silent artifact (the same discipline as
`ControlLibraryVersion`/`RiskScoringModel` before it).

### Git status / remote synchronization status

All Milestone 7 work is committed on `claude/primus-privacy-architecture-39p3gh`
and pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

## Milestone 6 — Evidence & Document Management (Session 9, 2026-09-01)

**Scope:** exactly what MILESTONE 6 instructed — `Document`,
`DocumentVersion`, `Evidence`, `EvidenceLink`, per DATA_MODEL.md §4,
connecting Evidence to the two Assessment Engine subject types the brief
names (`AssessmentResponse`, `ControlTest`). No Risk, Findings,
Remediation, Maturity, DPIA, AI, dashboards, reports, or document-upload
UI — none of those exist anywhere in this milestone's changes. No real
files, no real client documents, no real PII of any kind were ever
created, uploaded, or committed — every test uses short, synthetic,
in-memory "file content" hashed with Node's own `crypto` module.

Read `DATA_MODEL.md` §4/§12, `SECURITY.md` §2/§3/§5, `DECISIONS.md`
D-03/D-05, and the actual Milestone 4/5 code
(`db/schema/control-library.ts`, `db/schema/assessment-controls.ts`,
`db/schema/control-tests.ts`, migrations 0006-0009) fresh from disk
before writing anything, per instruction. Two reads were decisive: (1)
DATA_MODEL.md §4's `Document` field list — read literally, it describes
exactly one uploaded file, not a re-uploadable logical document, which is
why this milestone splits it into `Document`/`DocumentVersion` rather
than inventing a parallel structure (DECISIONS.md R-57); (2) SECURITY.md
§2's explicit statement that the CONSULTANT_INTERNAL/CLIENT_VISIBLE
distinction is an application-layer, not RLS-layer, control — followed
exactly as instructed ("preserve the existing visibility model"), not
re-architected (DECISIONS.md R-64).

### What was implemented

- **Drizzle TS schema** (3 new files: `db/schema/documents.ts`
  [`Document` + `DocumentVersion`], `db/schema/evidence.ts`,
  `db/schema/evidence-links.ts`): `documents` (12 columns: `tenant_id`,
  `organisation_id` [NOT NULL], `engagement_id` [nullable], `title`,
  `document_type`, `owner_user_id`, `status`, audit columns);
  `document_versions` (17 columns: `document_id`, denormalized
  `tenant_id`/`organisation_id`/`engagement_id`, trigger-assigned
  `version_number`, `storage_path`, `original_filename`, `mime_type`,
  `file_size_bytes`, `checksum_sha256`, `scan_status`, `uploaded_by`,
  `uploaded_at`, audit columns); `evidence` (20 columns: DATA_MODEL.md
  §4's exact fields plus the additive review-lifecycle fields —
  DECISIONS.md R-59); `evidence_links` (10 columns: `evidence_id`,
  denormalized scope columns, `subject_type`, nullable
  `assessment_response_id`/`control_test_id` — DECISIONS.md R-60).
- **New enums**: `document_status`, `document_type`,
  `document_version_scan_status` (a placeholder for the deferred D-05
  malware-scanning decision — nothing in this milestone runs a scanner),
  `evidence_type`, `evidence_quality_rating`, `evidence_visibility`,
  `evidence_review_status` (exactly instructions §13's four states),
  `evidence_link_subject_type`.
- **Extended two existing schema files** (`assessment-controls.ts`'s
  `assessmentResponses`, `control-tests.ts`) with new `UNIQUE`
  constraints — additive only, needed so `evidence_links` can
  composite-FK against them (DECISIONS.md R-61).
- **Migration 0010** (`drizzle-kit` generated, then hand-reordered — the
  same new-UNIQUE-before-dependent-FK statement-ordering issue found in
  Milestones 3/5 [R-39], caught and fixed before the file was ever
  applied): 4 new tables, 8 new enums, and every composite FK/CHECK
  constraint described below.
- **Migration 0011** (hand-written, per DECISIONS.md R-02): audit-column
  FKs; reparenting guards on `documents` and `evidence` (the latter
  including `document_version_id` — the pinned version is permanent,
  matching Milestone 5's `assessments.control_library_version_id`
  pattern); a `document_versions` version-number auto-assignment trigger
  (BEFORE INSERT, application never sets it directly); a
  `document_versions` full-immutability trigger — every field frozen
  after creation except `scan_status`, which may transition exactly once
  away from `pending` (instructions §4/§14); an `evidence_links`
  finalization-lock trigger extending Milestone 5's finalized-assessment
  guarantee one hop further (DECISIONS.md R-63); RLS enabled with `FORCE`
  on all 4 tables and 12 policies, all reusing `can_access_engagement`/
  `can_access_organisation` from migration 0001 unchanged — symmetric
  read/write, dual-shaped exactly like `Evidence` itself
  (engagement-scoped when `engagement_id` is set, organisation-level
  otherwise, never Tenant-only); `GRANT`/`REVOKE` statements —
  `document_versions` gets no `DELETE` grant at all, ever; audit triggers
  reusing Milestone 4's `log_methodology_change()`/`log_methodology_
  relationship_change()` **unchanged** for a third milestone in a row
  (DECISIONS.md R-56, confirmed again here).
- **The CRITICAL organisation-consistency invariant** (Milestone 6
  instructions §15's own example): `evidence(document_version_id,
  tenant_id, organisation_id) → document_versions(id, tenant_id,
  organisation_id)` makes "Evidence belongs to Organisation A; its linked
  DocumentVersion must belong to Organisation A" a structural
  impossibility to violate. Verified via the Vitest suite AND a
  standalone `psql` transaction outside the test framework.
- **The CRITICAL polymorphic-subject security invariant** (instructions
  §7, "security-critical area"): `EvidenceLink` uses per-subject-type
  nullable FK columns (`assessment_response_id`, `control_test_id`) plus
  a `CHECK` constraint tying `subject_type` to which one is populated —
  not DATA_MODEL.md's literal bare `(subject_type, subject_id)` pair,
  which could never carry a real FK at all (DECISIONS.md R-60/R-61).
  Verified via the Vitest suite AND a standalone `psql` transaction.
- **Storage architecture actually exercised** (instructions §9, D-03
  unresolved): `document_versions.storage_path` is a plain object-key
  string, never a public URL; no file bytes are ever written to
  PostgreSQL or any filesystem/bucket; no signed-URL code, no Storage SDK
  calls, no new API route exist anywhere in this milestone. "Testing the
  authorization model" means proving unauthorized callers cannot even
  `SELECT` the row carrying a `storage_path` — exercised directly (see
  "Testing performed"). See "Known limitations" for the explicit
  what-was/wasn't-tested statement instructions §23 requires.

### Testing performed (exact commands, run in this order)

1. `npm run typecheck` — clean, before and after the security migration
   was hand-written.
2. `npm run db:generate` — generated migration 0010; collided with
   existing `0009_assessment_engine_security.sql` (drizzle-kit's own
   numbering, the same recurring issue as Milestones 2-5) — renamed to
   `0010_evidence_document_management.sql`, `meta/0009_snapshot.json`
   renamed to `meta/0010_snapshot.json`, `meta/_journal.json`'s
   `idx`/`tag` fixed; re-ran `db:generate`, confirmed "No schema changes,
   nothing to migrate." Reviewed the generated SQL and found (and fixed,
   before ever applying it) the same statement-ordering issue R-39/the
   Milestone 5 report first found: the new `UNIQUE` constraints on
   `assessment_responses`/`control_tests` were emitted after the FKs that
   depend on them.
3. `npx tsx scripts/reset-test-db.ts` (fresh database, all 12 migration
   files applied in order) — succeeded cleanly after the reordering fix.
4. `npx vitest run tests/rls tests/master-data tests/processing-activity
   tests/control-library tests/assessment-engine` — all 175 pre-existing
   tests still passing against the post-Milestone-6 schema (no
   regressions).
5. `npx vitest run tests/evidence` — all 59 new tests passing.
6. `npm run test:db` (fresh reset + full suite: `tests/rls` +
   `tests/master-data` + `tests/processing-activity` +
   `tests/control-library` + `tests/assessment-engine` +
   `tests/evidence`) — **234/234 passing**. Run **twice** in full (fresh
   `reset-test-db` each time) to prove stability — 234/234 both times,
   identical results.
7. `npm run lint` — clean.
8. `npm run build` (`next build`) — compiles successfully, static pages
   generated, no type or lint errors.
9. Direct `psql` inspection of the resulting database: `relrowsecurity`/
   `relforcerowsecurity` confirmed `t`/`t` on all 4 new tables;
   `pg_policies` confirmed all 12 new policies with the expected
   commands; `information_schema.role_table_grants` confirmed
   `authenticated` has exactly the intended privileges per table (no
   `DELETE` grant anywhere, no `UPDATE`/`DELETE` grant at all on
   `document_versions` beyond the one `UPDATE` needed for `scan_status`)
   and `anon`/`PUBLIC` have none; `pg_constraint` confirmed every FK
   (including both CRITICAL invariants), `UNIQUE`, and `CHECK` constraint
   described above; `information_schema.triggers` confirmed all 14
   triggers present with correct timing/events; two standalone `psql`
   transactions (outside vitest) reproduced (a) the Evidence/
   DocumentVersion cross-organisation rejection and (b) the
   DocumentVersion storage-path immutability rejection, both directly
   against the database.

### tests/evidence (7 new files, 59 new tests)

- `crud.test.ts` (12 tests): Document creation (engagement-scoped and
  organisation-level); DocumentVersion upload with auto-assigned,
  monotonically-incrementing `version_number`; hash verification against
  independently-recomputed SHA-256; duplicate-upload detection (a query
  pattern, not a hard constraint — re-uploading identical content is
  still permitted as a legitimate "reconfirm current state" action, but
  creates a genuinely new, separately immutable version); Evidence
  creation pinned to a specific version; the full review lifecycle
  (reviewer, date, decision, rationale); EvidenceLink to both
  AssessmentResponse and ControlTest; duplicate-link prevention;
  delete-not-update semantics for link removal.
- `immutability.test.ts` (12 tests, two `describe` blocks):
  DocumentVersion immutability — storage_path, hash, version_number,
  uploaded_by/uploaded_at, filename, mime_type all rejected on UPDATE;
  the one legitimate `scan_status` transition (pending → clean/flagged,
  once only); no `DELETE` grant at all (tested via `asUser`, not
  `asFixtureSetup`, so the grant restriction is genuinely exercised, not
  bypassed by superuser fixture access). Document/Evidence reparenting
  guards, including confirmation that ordinary fields (title, status,
  review fields) remain freely editable.
- `historical-immutability.test.ts` (6 tests): the exact instructions §8
  scenario — Assessment A1/FY2026, Control C1, response "Partially
  Implemented", Evidence "Information Security Policy — Version 1",
  reviewer Consultant A, finalized; then FY2027's Version 2 upload to the
  *same* Document. Confirms Version 1/Version 2 are distinct rows with
  distinct hashes; Version 1's content is unchanged; FY2026's Evidence
  still resolves to Version 1; changing the Document's own current title
  doesn't rewrite Evidence's historical title or pin; a full one-query
  resolution of A1's evidence trail is unaffected by Version 2's
  existence; the EvidenceLink to the finalized assessment cannot be
  removed.
- `consistency.test.ts` (9 tests, two `describe` blocks): the CRITICAL
  Evidence→DocumentVersion organisation/engagement consistency suite
  (including the exact milestone example) and the CRITICAL EvidenceLink
  polymorphic-subject security suite — cross-tenant AssessmentResponse/
  ControlTest linking rejected even when the link's own scope columns are
  forged to match the wrong tenant; a `subject_type`/populated-column
  mismatch rejected by the `CHECK` constraint; linking to a fully
  standalone (no-organisation) ControlTest rejected (DECISIONS.md R-62).
- `finalization.test.ts` (4 tests, two `describe` blocks): an
  EvidenceLink to an AssessmentResponse can be created while draft,
  cannot once finalized; an existing link to a ControlTest cannot be
  removed once its Assessment is finalized; a link to a ControlTest with
  no `assessment_id` is never locked, regardless of any other
  assessment's state.
- `tenant-isolation.test.ts` (11 tests): the 10 required RLS scenarios —
  Tenant A own evidence; Tenant A blocked from Tenant B (Document,
  DocumentVersion, and Evidence listing); Organisation A blocked from
  Organisation B under the same tenant; Engagement-scoped access proven
  exact (no more, no less); unauthorized read/write blocking (0-rows-
  affected + unchanged-data confirmation); unauthorized cross-tenant
  EvidenceLink creation blocked even against a legitimate same-tenant
  subject; anonymous requests denied at the grant level for all three
  tables; RLS cannot be bypassed by querying `document_versions` directly
  (proven both by a direct SELECT and by confirming it's absent from an
  unfiltered listing); a positive write case proving the blocks are real.
- `audit.test.ts` (5 tests): Document/DocumentVersion creation audited;
  Evidence creation, review, and status changes (accepted → expired)
  audited; EvidenceLink creation/removal audited as insert/delete;
  `auth.uid()` attribution confirmed.

### Files changed

- New: `db/schema/documents.ts`, `db/schema/evidence.ts`,
  `db/schema/evidence-links.ts`,
  `drizzle/migrations/0010_evidence_document_management.sql`,
  `drizzle/migrations/0011_evidence_document_management_security.sql`,
  `drizzle/migrations/meta/0010_snapshot.json`,
  `tests/evidence/helpers.ts`, `tests/evidence/crud.test.ts`,
  `tests/evidence/immutability.test.ts`,
  `tests/evidence/historical-immutability.test.ts`,
  `tests/evidence/consistency.test.ts`,
  `tests/evidence/finalization.test.ts`,
  `tests/evidence/tenant-isolation.test.ts`, `tests/evidence/audit.test.ts`.
- Modified: `db/schema/enums.ts` (new Milestone 6 enum block),
  `db/schema/assessment-controls.ts` (new `UNIQUE(id, tenant_id,
  organisation_id, engagement_id)` on `assessmentResponses`),
  `db/schema/control-tests.ts` (three new `UNIQUE` constraints),
  `db/schema/index.ts` (barrel exports), `package.json` (new
  `test:evidence` script, `test:db` extended),
  `drizzle/migrations/meta/_journal.json` (renumbering fix),
  `DATA_MODEL.md` (one additive implementation-clarification paragraph
  after §4), `DECISIONS.md` (R-57 through R-65), `PROGRESS.md` (this
  entry).
- Unchanged: `ARCHITECTURE.md`, `SECURITY.md`, `PRODUCT_SPEC.md`,
  `ROADMAP.md`, `README.md`, and every migration/schema file from
  Milestones 1-5 (`0000`-`0009`, and every `db/schema/*.ts` file this
  milestone didn't touch).

### Known limitations (documented, not silently built around)

- **Explicit scope statement on storage (instructions §23):** this
  milestone tested the database-authorization layer only — that RLS
  correctly gates every row carrying storage metadata (`storage_path`,
  `checksum_sha256`, etc.), proven for both the "happy path" (an
  authorized user reads their own tenant's `document_versions`) and the
  negative path (cross-tenant/anonymous access denied, and RLS cannot be
  bypassed by querying `document_versions` directly). It did **not**
  test: real Supabase Storage bucket privacy, real signed-URL issuance or
  expiry, real upload MIME/size validation, or any actual file transfer —
  none of that code exists yet anywhere in the repository (no API
  routes, no Storage SDK integration), consistent with every milestone's
  "no UI/no application-layer code" scope and D-03's unresolved status.
  This is a real, currently-untested gap between "the database will
  correctly authorize a signed-URL request" and "a real signed URL is
  ever correctly issued or expires correctly" — the latter requires
  actual Supabase Storage provisioning, which cannot happen before D-03
  is resolved.
- Malware/content scanning (D-05) remains unimplemented — `scan_status`
  stays `pending` for every row in practice; this milestone only builds
  the column and its one-time-transition trigger for a future scanner to
  write into.
- Duplicate-upload "detection" is a documented query pattern
  (`WHERE document_id = ? AND checksum_sha256 = ?`), not a blocking
  constraint — re-uploading identical content remains legitimate.
- Carried forward from Milestone 4, still unaddressed (out of scope):
  published `Requirement` content is not independently frozen by a
  `ControlLibraryVersion`'s publish state — only the library's Control
  set and mappings are (DECISIONS.md R-43/R-44). Also carried forward
  from Milestone 5 (no change this milestone): `Assessment` uses exactly
  DATA_MODEL.md's two-state status; no completeness/percentage view was
  built.
- The CONSULTANT_INTERNAL/CLIENT_VISIBLE `visibility` column is stored
  but not RLS-enforced, matching SECURITY.md's existing, unchanged
  architecture (DECISIONS.md R-64) — enforcement remains an
  application-layer responsibility for a future milestone that builds
  the permission/role-matrix layer SECURITY.md §2 describes.
- No UI of any kind was built (none was requested) — every table above
  was exercised exclusively through direct SQL/RLS-aware test clients.

### Recommended Milestone 7

Risk, Finding, and RemediationAction (DATA_MODEL.md §8) are the natural
next layer: they consume `AssessmentResponse`/`ControlTest` results
(now evidenced) the same way this milestone's `EvidenceLink` does, and
DATA_MODEL.md §8's own `ValidationRecord` entity already anticipates
`Evidence` attaching to `RemediationAction` via the same `EvidenceLink`
mechanism built this milestone — no new evidence infrastructure would be
needed, only new subject types (one more nullable column + one more
`CHECK` branch each, per DECISIONS.md R-60's stated extension pattern).

### Git status / remote synchronization status

All Milestone 6 work is committed on `claude/primus-privacy-architecture-39p3gh`
and pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

## Milestone 5 — Assessment Engine (Session 8, 2026-09-01)

**Scope:** exactly what MILESTONE 5 instructed — `Assessment`,
`AssessmentControl`, `AssessmentResponse`, `ControlTest`, per
DATA_MODEL.md §6, connecting an Engagement (already pinned to a
ControlLibraryVersion — Milestone 4) through to individual test results.
No Risk, Findings, Remediation, Maturity, Evidence management workflow,
DPIA, AI, dashboards, or reports — none of those tables or workflows
exist anywhere in this schema. No UI beyond the unchanged placeholder
page.

Read `DATA_MODEL.md` §6/§11/§12, `db/schema/engagements.ts`,
`db/schema/control-library.ts`, and migrations 0006-0007 fresh from disk
before writing anything, per instruction. §6's exact field lists
(Assessment: `engagement_id, assessment_type, period_label, status,
previous_assessment_id`; AssessmentResponse: `assessment_control_id,
effectiveness_rating, system_suggested_rating, decision_rating,
decision_rationale, respondent_id, submitted_at`; ControlTest:
`control_id, assessment_id (nullable), methodology, sample_description,
result, tester_id, tested_at`) were followed exactly; DATA_MODEL.md
names no `control_library_version_id` column for `Assessment` — its
addition here is a denormalization for composite-FK proof, the same
discipline every prior milestone applied to its own scope columns (see
DECISIONS.md R-49).

### What was implemented

- **Drizzle TS schema** (3 new files: `db/schema/assessments.ts`,
  `db/schema/assessment-controls.ts` [`AssessmentControl` +
  `AssessmentResponse`], `db/schema/control-tests.ts`): `assessments`
  (13 columns: `engagement_id`, denormalized `organisation_id`/
  `tenant_id`/`control_library_version_id`, `assessment_type`,
  `period_label`, `status`, `previous_assessment_id`, audit columns),
  `assessment_controls` (junction: `assessment_id`, `control_id`,
  denormalized `tenant_id`/`organisation_id`/`engagement_id`/
  `control_library_version_id`), `assessment_responses` (`assessment_
  control_id`, `effectiveness_rating`, `system_suggested_rating`,
  `decision_rating`, `decision_rationale`, `respondent_id`,
  `submitted_at`, denormalized scope columns), `control_tests`
  (`control_id`, `tenant_id` always; `assessment_id`, `organisation_id`,
  `engagement_id` nullable together — DATA_MODEL.md §6's own "a test can
  also occur outside a formal assessment cycle"; `methodology`,
  `sample_description`, `result`, `tester_id`, `tested_at`).
- **Extended two existing schema files** (`engagements.ts`,
  `control-library.ts`'s `controls`) with new `UNIQUE(id,
  control_library_version_id)` constraints — additive only, needed so
  `assessments`/`assessment_controls` can composite-FK against them
  (DECISIONS.md R-49/R-50).
- **New enums**: `assessment_status` (`draft`/`finalized` — exactly
  DATA_MODEL.md §6's two states, not the four-state workflow the
  milestone brief only conditionally offered — DECISIONS.md R-51),
  `assessment_type` (the exact five values DATA_MODEL.md §6 names),
  `control_effectiveness_rating` (the exact five values Milestone 5
  instructions §7 require — never collapsed to a boolean — shared by
  `effectiveness_rating`/`system_suggested_rating`/`decision_rating`),
  `control_test_result` (`pass`/`fail`/`exception_noted`, an engineering
  judgment call matching Milestone 2/4's posture for undocumented
  domains).
- **Migration 0008** (`drizzle-kit` generated, then hand-reordered — see
  "Known limitations"/DECISIONS.md pattern from Milestone 3/R-39: the new
  `UNIQUE` constraints on `engagements`/`controls` were emitted after the
  new-table FKs that depend on them; moved before, caught and fixed
  before the file was ever applied anywhere): 4 new tables, 4 new enums,
  and every composite FK described below.
- **Migration 0009** (hand-written, per DECISIONS.md R-02): audit-column
  FKs; reparenting guards on `assessments` (blocking changes to
  `{engagement_id,organisation_id,tenant_id,control_library_version_id}`
  — the last one specifically so an Assessment's methodology pin can
  never silently drift), `assessment_responses`, and `control_tests`;
  finalization-immutability triggers — `assessments` itself (once
  `finalized`, no further `UPDATE` of any kind succeeds), `assessment_
  controls` (insert/delete blocked once its Assessment is finalized),
  `assessment_responses` (the exact "AssessmentResponse rows become
  read-only" guarantee DATA_MODEL.md §6 names, resolved via a two-level
  join through `assessment_controls`), and `control_tests` (locked only
  when `assessment_id IS NOT NULL` and that assessment is finalized —
  standalone/continuous-monitoring tests are never locked); RLS enabled
  with `FORCE` on all 4 tables and 13 policies — `assessments`/
  `assessment_controls`/`assessment_responses` reuse `can_access_
  engagement(uuid, uuid)` symmetrically (client engagement data, like
  Milestone 3's ProcessingActivity), while `control_tests` uses a genuine
  dual-mode policy branching on `assessment_id IS NULL`
  (`can_access_engagement` when set, `can_access_tenant`/
  `is_active_tenant_member` when not — DECISIONS.md R-55); `GRANT`/
  `REVOKE` statements matching; audit triggers reusing Milestone 4's
  `log_methodology_change()`/`log_methodology_relationship_change()`
  **unchanged** — no new audit function was needed since every new table
  already denormalizes `tenant_id` directly (DECISIONS.md R-56).
- **The CRITICAL invariant** (Milestone 5 instructions §6): proven
  entirely by two composite FKs, no trigger —
  `assessment_controls(control_id, control_library_version_id) →
  controls(id, control_library_version_id)` and
  `assessment_controls(assessment_id, tenant_id, organisation_id,
  engagement_id, control_library_version_id) → assessments(id,
  tenant_id, organisation_id, engagement_id, control_library_version_id)`
  together make "Assessment A on Library v1.0 cannot attach Control
  C-100 from Library v2.0" a structural impossibility (DECISIONS.md
  R-50). Verified via the Vitest suite AND a standalone `psql`
  transaction outside the test framework (see "Testing performed").
- **Assessment/Engagement consistency** (instructions §3): `assessments(
  engagement_id, control_library_version_id) → engagements(id,
  control_library_version_id)` makes it structurally impossible for an
  Assessment to disagree with its Engagement's pinned methodology
  version — combined with Milestone 4's existing immutable-once-set
  guard on `engagements.control_library_version_id`, this can never drift
  after the fact either.

### Testing performed (exact commands, run in this order)

1. `npm run typecheck` — clean, before and after the security migration
   was hand-written.
2. `npm run db:generate` — generated migration 0008; collided with
   existing `0007_control_library_security.sql` (drizzle-kit's own
   numbering, the same recurring issue as Milestones 2-4) — renamed to
   `0008_assessment_engine.sql`, `meta/0007_snapshot.json` renamed to
   `meta/0008_snapshot.json`, `meta/_journal.json`'s `idx`/`tag` fixed;
   re-ran `db:generate`, confirmed "No schema changes, nothing to
   migrate." Reviewed the generated SQL and found (and fixed, before
   ever applying it) the same statement-ordering issue Milestone 3's
   R-39 first found: the new `UNIQUE` constraints on `engagements`/
   `controls` were emitted after the FKs that depend on them.
3. `npx tsx scripts/reset-test-db.ts` (fresh database, all 10 migration
   files applied in order) — succeeded cleanly after the reordering fix.
4. `npx vitest run tests/rls tests/master-data tests/processing-activity
   tests/control-library` — all 123 pre-existing tests still passing
   against the post-Milestone-5 schema (no regressions).
5. `npx vitest run tests/assessment-engine` — all 52 new tests passing.
6. `npm run test:db` (fresh reset + full suite: `tests/rls` +
   `tests/master-data` + `tests/processing-activity` +
   `tests/control-library` + `tests/assessment-engine`) —
   **175/175 passing**. Run **twice** in full (fresh `reset-test-db` each
   time) to prove stability — 175/175 both times, identical results.
7. `npm run lint` — clean.
8. `npm run build` (`next build`) — compiles successfully, static pages
   generated, no type or lint errors.
9. Direct `psql` inspection of the resulting database: `relrowsecurity`/
   `relforcerowsecurity` confirmed `t`/`t` on all 4 new tables;
   `pg_policies` confirmed all 13 new policies with the expected
   commands; `information_schema.role_table_grants` confirmed
   `authenticated` has exactly the intended privileges per table and
   `anon`/`PUBLIC` have none; `pg_constraint` confirmed every FK
   (including the CRITICAL pair) and `UNIQUE` constraint described above;
   `information_schema.triggers` confirmed all 20 triggers (reparenting
   guards, finalization guards, and audit triggers) present with correct
   timing/events; two standalone `psql` transactions (outside vitest)
   reproduced (a) the CRITICAL cross-library-version rejection and (b)
   Milestone 4's own published-immutability rejection, both directly
   against the database.

### tests/assessment-engine (6 new files, 52 new tests)

- `crud.test.ts` (8 tests): Assessment creation with full scope
  association; AssessmentControl inclusion; all five
  `effectiveness_rating` states recorded (never a boolean); reviewer
  decision fields (`system_suggested_rating`/`decision_rating`/
  `decision_rationale`) alongside the assessor's own rating; at-most-one-
  response-per-control uniqueness; assessment-scoped and standalone
  ControlTest; junction delete-not-update semantics.
- `consistency.test.ts` (6 tests): an Assessment cannot be created for an
  unpinned Engagement; cannot reference a ControlLibraryVersion different
  from its Engagement's; CAN when matched; and the CRITICAL suite —
  Assessment A (Library v1.0) cannot attach Control C-100 (Library v2.0)
  even when the row's own `control_library_version_id` column is set to
  try to make either side look consistent; CAN attach a genuine Library
  v1.0 control.
- `finalization.test.ts` (10 tests): draft assessments freely editable;
  draft→finalized allowed; finalized assessments immutable (including a
  no-op field UPDATE); AssessmentControl insert/delete blocked once
  finalized; AssessmentResponse insert/update/delete blocked once
  finalized (with a persisted-value check proving nothing changed);
  assessment-scoped ControlTest locked once its assessment is finalized;
  standalone ControlTest never locked; full draft-state mutability
  confirmation.
- `historical-reproducibility.test.ts` (8 tests): the exact instructions
  §12 scenario — Library v1.0 (C1, C2); Engagement "ABC Financial —
  FY2026" pinned to v1.0; Assessment A1 with AssessmentControl C1,
  response "Partially Implemented" + synthetic rationale, and a synthetic
  ControlTest; Library v2.0 (C1, C2, C3) published afterward. Confirms
  A1 still resolves to Library v1.0 and its original Control C1 row; A1
  does NOT acquire C3; A1's response/rationale/test are byte-for-byte
  unchanged; an explicit attempt to attach v2.0's C3 to A1 is rejected by
  the database; and a full one-query resolution of A1's result set is
  unaffected by v2.0's existence.
- `tenant-isolation.test.ts` (15 tests): the 8 required RLS scenarios —
  Tenant A own assessment; Tenant A blocked from Tenant B; Organisation
  A blocked from Organisation B under the same tenant; AssessmentControl
  blocked cross-tenant (read and forged-insert, including a cross-tenant-
  control forgery caught by the library-version FK); unauthorized read
  (unaffiliated user, anonymous request) and write (0-rows-affected +
  unchanged-data confirmation) blocking; a positive write case proving
  the blocks are real. A second `describe` block exercises
  `control_tests`' dual-mode isolation specifically: a TenantMembership
  holder can read/write standalone tests, an organisation-scoped user
  cannot write standalone tests but CAN read/write engagement-scoped
  ones, and Tenant B is blocked from both shapes.
- `audit.test.ts` (5 tests): Assessment creation + finalization (status
  transition) audited; AssessmentControl inclusion audited; response and
  rationale changes audited; ControlTest creation/modification audited;
  `auth.uid()` attribution confirmed.

### Files changed

- New: `db/schema/assessments.ts`, `db/schema/assessment-controls.ts`,
  `db/schema/control-tests.ts`,
  `drizzle/migrations/0008_assessment_engine.sql`,
  `drizzle/migrations/0009_assessment_engine_security.sql`,
  `drizzle/migrations/meta/0008_snapshot.json`,
  `tests/assessment-engine/helpers.ts`,
  `tests/assessment-engine/crud.test.ts`,
  `tests/assessment-engine/consistency.test.ts`,
  `tests/assessment-engine/finalization.test.ts`,
  `tests/assessment-engine/historical-reproducibility.test.ts`,
  `tests/assessment-engine/tenant-isolation.test.ts`,
  `tests/assessment-engine/audit.test.ts`.
- Modified: `db/schema/enums.ts` (new Milestone 5 enum block),
  `db/schema/engagements.ts` (new `UNIQUE(id, control_library_version_id)`
  constraint), `db/schema/control-library.ts` (new `UNIQUE(id,
  control_library_version_id)` constraint on `controls`),
  `db/schema/index.ts` (barrel exports), `package.json` (new
  `test:assessment-engine` script, `test:db` extended),
  `drizzle/migrations/meta/_journal.json` (renumbering fix),
  `DATA_MODEL.md` (one additive implementation-clarification paragraph
  after §6), `DECISIONS.md` (R-49 through R-56), `PROGRESS.md` (this
  entry).
- Unchanged: `ARCHITECTURE.md`, `SECURITY.md`, `PRODUCT_SPEC.md`,
  `ROADMAP.md`, `README.md`, and every migration/schema file from
  Milestones 1-4 (`0000`-`0007`, and every `db/schema/*.ts` file this
  milestone didn't touch).

### Known limitations (documented, not silently built around)

- Carried forward from Milestone 4, unaddressed this milestone (out of
  scope): published `Requirement` content is not independently frozen by
  a `ControlLibraryVersion`'s publish state — only the library's Control
  set and mappings are (DECISIONS.md R-43/R-44). This remains a
  deliberate, documented scope boundary, not an oversight or a change to
  the approved architecture.
- No completeness/percentage view or table was built — instructions §13
  explicitly warn against a simplistic percentage that treats N/A as
  compliant, and DATA_MODEL.md doesn't specify one; the four completeness
  buckets are documented as SQL patterns (DECISIONS.md R-54) and
  exercised by tests, not materialized as a first-class object.
- `ControlTest`'s "conclusion"/"exceptions" concepts (Milestone 5
  instructions §9) are captured via the `result` enum's `exception_noted`
  value plus the free-text `sample_description` field, not as separate
  columns DATA_MODEL.md doesn't name (DECISIONS.md, enums.ts).
- No transition-rule workflow beyond the two-state draft/finalized
  lifecycle exists for `Assessment` (DECISIONS.md R-51, matching the
  milestone's own conditional instruction and established project
  posture).
- No UI of any kind was built (none was requested) — every table above
  was exercised exclusively through direct SQL/RLS-aware test clients.

### Recommended Milestone 6

Evidence management is the natural next layer: DATA_MODEL.md §4 already
defines `Document`/`Evidence`/`EvidenceLink` (a polymorphic junction
naming `ControlTest`, `AssessmentResponse`, `Finding`,
`RemediationAction`, `DPIA`, `ApplicabilityDetermination`,
`ProcessingActivity` as subjects), and this milestone's `ControlTest`/
`AssessmentResponse` are two of `EvidenceLink`'s named subject types —
the Assessment Engine was built with no evidence columns precisely so
Evidence can attach onto it cleanly via that existing junction mechanism,
per Milestone 5 instructions §17's explicit deferral.

### Git status / remote synchronization status

All Milestone 5 work is committed on `claude/primus-privacy-architecture-39p3gh`
and pushed to `origin`, with local and remote `HEAD` confirmed matching
(see the commit this entry accompanies). No commits are queued or
pending push.

---

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
