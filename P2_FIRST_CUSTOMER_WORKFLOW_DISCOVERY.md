# P2 — First-Customer Workflow & Client Portal Discovery

Design/discovery exercise per the P2 brief. No application code, migrations,
schema changes, UI, routes, or implementation-requiring tests were created.
Every claim below is traced to a specific file/function/test in the
repository as it stands at HEAD `26755d1`; where a claim is inference
rather than direct observation, it is marked as such.

---

## 1. Executive Summary

**Can PRIMUS currently support a complete first customer engagement without
leaving the platform? No — but not for the reason a "no Client Portal
exists" headline would suggest.** The consultant-side workflow (Organisation
→ Master Data → Data Landscape/ROPA → Applicability & Scope → Assessment →
Evidence → Control Testing → Risk → Finding → Remediation → Validation →
Maturity → Report) is genuinely real, end to end, through the real
application/domain layer, proven by the reference-engagement fixture
(`tests/app/reference-engagement-fixture.ts`, exercised by
`tests/app/reference-engagement.test.ts`, 16/16 passing) and by 844 tests
overall. **The break is not "no client screens exist" — literally every
screen already renders for a client-side user, since there is only ONE set
of UI routes in this codebase (`app/(shell)/...`), gated by the same
authorization checks for everyone.** The real breaks are:

1. **There is no client invitation/self-service account-creation flow at
   all** (confirmed by direct inspection — see §3, §9). A client user's
   `users`/`OrganisationMembership`/`EngagementMembership` rows must be
   created by someone with direct database/backend access today; nothing in
   `lib/domain/*` creates a NEW user account and invites them. This is the
   single most concrete "cannot run a real engagement" blocker, and it is
   an application gap, not a Client Portal gap.
2. **Authorization does not distinguish "client action" from "consultant
   action" for almost anything except three dedicated permissions**
   (`assessment.finalize`, `scope.lock`, `maturity.compute`). Every other
   write — Evidence upload/review, Risk creation/scoring, Finding
   management, Remediation, Validation, Assessment Responses themselves —
   is gated only by the broad `requireEngagementAccess` check, which any
   `EngagementMembership` holder passes regardless of role. A client user
   granted engagement access today could accept/reject their own uploaded
   evidence, edit Risk ratings, or close a Finding — the same actions a
   Consultant performs. This is a real, verified authorization gap (§9),
   not a hypothetical.
3. **The existing UI is entirely consultant-shaped.** Every screen (the
   Assessment workspace in particular) is built for "a consultant working
   through a list of controls," not "a client understanding what is being
   asked of them and providing an answer." Nothing in the UI currently
   explains a control's requirement in plain language, flags what's
   incomplete FROM THE CLIENT'S OWN perspective, or separates "your
   action needed" from "consultant's own working notes."
4. **`Evidence.visibility` exists as a real column but is never read by
   any query** (verified: zero references to `visibility` anywhere in
   `lib/domain/evidence.ts` outside the schema import). The
   consultant-internal/client-visible distinction the data model already
   supports is not actually enforced anywhere — a real, silent gap between
   what PRODUCT_UX_BLUEPRINT.md's own permission matrix claims ("the
   existing `evidence.visibility` column already enforces server-side")
   and what the code actually does today.
5. **Production infrastructure is entirely unprovisioned** — no live
   Supabase project exists (local Postgres stands in for both database and
   auth), so Storage silently falls back to a local-filesystem stand-in
   whose "signed URL" is a fake, non-HTTP string. This is a genuine,
   separate, already-well-documented (DECISIONS.md D-03, R-85, R-95)
   production-infrastructure gap, distinct from the application-layer gaps
   above.
6. **The 25-control demo library is explicitly, deliberately, and
   consistently labeled SAMPLE/DEMO everywhere it appears** — never
   presented as an authoritative DPDP methodology. It is not production
   content by design, not by oversight (§19).

None of this means "start over" or "build a generic Client Portal." The
underlying domain model, RLS, and audit mechanisms are sound and reusable.
What is missing is a specific, small set of capabilities: (a) a real
invitation flow, (b) genuine client-vs-consultant write differentiation
for the handful of actions that actually need it, (c) a handful of
client-oriented read/write surfaces layered onto the EXISTING domain
functions (not a redesign), and (d) the already-known, already-tracked
production-infrastructure work. See §16 for what "Client Portal" should
actually mean given this evidence, and §20 for the recommended sequence.

---

## 2. Current End-to-End Workflow

Traced against the real reference-engagement fixture and the corresponding
domain modules. "Consultant action"/"Client action" state who the CURRENT
authorization model would let perform the step, not who SHOULD — that
distinction (§9) is exactly the point.

| Stage | Consultant action | Client action (today) | UI | Authorization | Persistence | Works? | Missing | Leaves PRIMUS? |
|---|---|---|---|---|---|---|---|---|
| 1. Organisation | Creates via `createOrganisation` | None (client cannot self-register an org) | `/organisations`, `/organisations/new` | `canCreateOrganisation`-shaped (tenant/org membership) | Real (`organisations` table) | YES | Client-side org creation | No |
| 2. Master Data | Consultant authors via `lib/domain/master-data.ts` | Same functions are callable by anyone with engagement/org access — no differentiation | `/organisations/[id]/master-data/[category]` | `requireEngagementAccess`/org-scoped, symmetric | Real, SCD2-versioned (`*_versions` tables) | YES (app layer) | Client-facing "review and confirm" framing; no distinct client read-only vs. consultant-edit posture | No |
| 3. Data Landscape | `lib/domain/processing-activities.ts` | Same, symmetric access | `/organisations/[id]/engagements/[id]/data-landscape` | `requireEngagementAccess`, symmetric | Real | YES | Client self-service framing | No |
| 4. Processing Activities | Consultant creates/links | Symmetric (no block) | Same as above | Symmetric | Real | YES | Owner/client-input workflow | No |
| 5. ROPA | Read view generated from Processing Activities (no persisted table — DECISIONS.md R-135) | Read-accessible | `/organisations/[id]/engagements/[id]/data-landscape/ropa` | `requireEngagementAccess` | Derived, real | YES | Export (no export function exists) | No (no export) |
| 6. Applicability & Scope | `lib/domain/applicability.ts` — propose/edit requires real `EngagementMembership`; lock requires `scope.lock` | Read-only (client-side roles hold only `OrganisationMembership`, so `requireEngagementMembershipAccess` correctly excludes them from writes) — but see §9 for the un-closed "Client Contributor" gap | `/organisations/[id]/engagements/[id]/scope` | Real, role-differentiated (D3) | Real | YES | Client input into applicability decisions (currently 100% consultant-driven) | No |
| 7. Control Library | Practice Partner/Platform Admin only (`methodology.manage`) | None — correctly, by design; practice-owned content | `/methodology/control-library` | Real, tenant-scoped | Real | YES | N/A — not a client-facing stage | No |
| 8. Assessment | `createAssessment`/`finalizeAssessment` (finalize needs `assessment.finalize`) | Symmetric access to respond (no distinct client role) | `/organisations/[id]/engagements/[id]/assessments/[id]` | `requireEngagementAccess` (broad); finalize is real, differentiated | Real | YES | Client-facing framing of "what's asked of you" (§4) | No |
| 9. Assessment Responses | `updateAssessmentResponse` | Same function, no differentiation | Same page | `requireEngagementAccess` | Real | YES | Distinguishing "client answers this" from "consultant answers this" per control | No |
| 10. Evidence | `uploadEvidence`/`reviewEvidence` | Same functions, no differentiation — a client can review/accept their own upload today | Same page | `requireEngagementAccess`; `visibility` column exists but unenforced (verified) | Real (local storage stand-in) | PARTIAL | Visibility enforcement; production storage; client-vs-consultant review split | No (app), YES (storage — no real Supabase project) |
| 11. Control Testing | `createControlTest` | Symmetric (no block) — realistically a consultant-only activity by nature, not by enforcement | Same page | `requireEngagementAccess` | Real | YES | N/A — not meaningfully client-facing | No |
| 12. Risks | `createRisk`/`updateRiskStatus` | Symmetric access | `/organisations/[id]/engagements/[id]/risks` | `requireEngagementAccess` | Real | YES | Client visibility framing (raw risk register is consultant-shaped) | No |
| 13. Findings | `createFinding`/`updateFinding` | Symmetric access | `/organisations/[id]/engagements/[id]/findings` | `requireEngagementAccess` | Real | YES | Client-facing "understand impact" framing | No |
| 14. Remediation | `createRemediationAction`/`updateRemediationAction` | Symmetric access | `/organisations/[id]/engagements/[id]/remediation` | `requireEngagementAccess` | Real | YES | Client-scoped "propose/update my remediation" workflow (§6) | No |
| 15. Validation | `createValidationRecord` (create/finalize; immutable once decided) | Symmetric access to CREATE (a client could technically "validate" their own remediation today — a real gap) | Same as Remediation page | `requireEngagementAccess` | Real | YES | Client visibility, not client write (this SHOULD be consultant/Auditor-only) | No |
| 16. Maturity | `computeAndFinalizeMaturityAssessment` (`maturity.compute`) | Read-only (no write path exists for non-holders) | Assessment page (M2) | Real, differentiated | Real | YES | Client visibility gating (currently unrestricted read for any engagement member) | No |
| 17. Engagement Report | `getEngagementReportData` + `renderEngagementReportPdf` | Symmetric read access | `/organisations/[id]/engagements/[id]/reports` | `requireEngagementAccess` | Real (generated on demand, not stored) | YES | Client-initiated generation is technically possible today (no block) — acceptable | No |

**Reading the table:** every stage has a real, working consultant path.
The recurring gap is not "missing functionality" — it's "missing
differentiation" (client vs. consultant) and "missing framing" (client-
comprehensible presentation of the same underlying data). Nothing forces
a user out of PRIMUS at any of these 17 stages today — the "leaves
PRIMUS" column is "No" throughout, because there is no client
communication/notification layer to leave FROM in the first place (§7);
the gap is invisible in this table precisely because nothing routes a
client into the product to begin with (§3's invitation-flow finding).

---

## 3. Actors & Roles

`db/seed/roles.ts` — 12 seeded roles, `Role.scope ∈ {tenant, organisation,
engagement}`:

| Role | Scope | Seeded permissions | What they can do today |
|---|---|---|---|
| Platform Administrator | tenant | `tenant.manage`, `organisation.create`, `organisation.manage`, `engagement.create`, `engagement.manage`, `membership.manage`, `user.manage`, `audit_log.read`, `assessment.finalize`, `methodology.manage` | Everything — the practice's own super-admin |
| Practice Partner | tenant | `organisation.create`, `engagement.create`, `engagement.manage`, `audit_log.read`, `methodology.manage` | Practice-wide oversight, methodology authoring |
| Engagement Manager | engagement | `engagement.manage`, `membership.manage`, `assessment.finalize`, `scope.lock`, `maturity.compute` | Owns delivery of an engagement — the ONLY role with the three "certifying" permissions |
| Consultant | engagement | **none seeded** | Full read/write on everything `requireEngagementAccess` gates (i.e., almost everything) via mere `EngagementMembership`, minus the three certifying actions |
| Auditor | engagement | **none seeded** | Same broad access as Consultant — `QualityReview` (a distinct review workflow) is `[NOT YET BUILT]`, so "Reviewer" has no narrower shape today than Consultant |
| Business Owner | engagement | **none seeded** | Identical broad access to Consultant/Auditor — nothing distinguishes a client-side "Business Owner" from a Consultant at the authorization layer |
| IT/CISO | engagement | **none seeded** | Same as above |
| Procurement | engagement | **none seeded** | Same as above |
| Legal | engagement | **none seeded** | Same as above |
| Client Administrator | organisation | `membership.manage`, `user.manage` | Manages the client org's own users/memberships; org-wide read via `canAccessOrganisation`; correctly excluded from Scope writes (D3's `requireEngagementMembershipAccess`) since it holds only `OrganisationMembership` |
| Privacy Officer | organisation | **none seeded** | Org-wide read/write wherever `requireEngagementAccess`'s org-membership fallback applies |
| CXO / Executive Viewer | organisation | **none seeded** | Same broad org-wide reach as Privacy Officer — nothing in the seed data narrows this to "read-only," despite the name |

**Which role represents the client's primary operational user?** —
**Client Administrator**, confirmed both by design (PRODUCT_UX_BLUEPRINT.md
§8's own explicit "Client Admin = Client Administrator" mapping) and by
what actually exists in code (the only client-side role with any seeded
permissions at all, and the only one D3 explicitly reasoned about and
excluded from a specific write path). No new role is required for that
purpose.

**The un-closed gap, stated precisely:** PRODUCT_UX_BLUEPRINT.md's own
"Client Contributor" grouping (Business Owner/IT-CISO/Procurement/Legal)
is a **read/write shape that exists only in the design document, not in
code.** These four roles carry zero seeded permissions and are
authorization-indistinguishable from Consultant/Auditor at every single
`requireEngagementAccess` call site verified in this session (Evidence,
Risk, Finding, Remediation, Validation — §9). D3's own `DECISIONS.md`
R-142 already named this precisely: "this does NOT fully solve the
separate, pre-existing, already-documented gap that client-side
Engagement-scoped roles... would still pass this check too." P2 confirms
that gap is real, current, and now touches five more domains (Evidence,
Risk, Finding, Remediation, Validation) beyond the one D3 itself flagged
(Scope).

**Consultant-only actions (by dedicated permission, verified real):**
`assessment.finalize`, `scope.lock`, `maturity.compute`, `methodology.manage`,
`membership.manage` (engagement-scope: Engagement Manager only).

**Client-only actions:** **none exist today.** No action in the current
codebase is gated to exclude Consultant/Engagement Manager while
permitting a client-side role.

**Shared (symmetric) actions:** everything else — Assessment Responses,
Evidence upload/review, Control Tests, Risk create/score/status, Finding
create/update, Remediation create/update, Validation create, ROPA/Master
Data read and write, Report generation.

**The invitation-flow gap:** no domain function in this codebase creates
a new `users` row and associates it with a role via anything resembling
an invitation email/link. `createUser` exists only as a raw test/seed
fixture helper (`tests/rls/helpers.ts`), never as an application domain
function callable from a Server Action. `addEngagementMember`
(`lib/domain/engagement-memberships.ts`) requires `targetUserId` to
already exist and resolves membership eligibility via
`resolve_membership_candidate` — it attaches an EXISTING user to an
engagement; it does not create one. This matches the reference-engagement
fixture's own explicit comment: "this product has no self-service sign-up
flow for Tenant/User provisioning." **A real client user cannot get an
account through PRIMUS today, full stop** — this is the load-bearing
finding behind §15's P0 ranking.

---

## 4. Client Journey

The brief's own example journey is a reasonable STARTING shape, but the
actual product model changes it in two ways: (a) "reviews scope" happens
BEFORE Assessment even exists (D3's Scope precedes Assessment creation in
the real fixture), and (b) there is no "engagement invitation" step to
derive FROM, because no invitation mechanism exists (§3). The realistic,
product-grounded journey:

| Step | Supported today? | Evidence |
|---|---|---|
| 1. Client receives engagement invitation | **NO** | No invitation domain function exists (§3) |
| 2. Logs in | PARTIAL | Login page/Supabase Auth session exist (`app/login/page.tsx`, `lib/auth/session.ts`), but the client has no account to log into without step 1 first happening out-of-band |
| 3. Sees assigned engagement(s) | YES (mechanically) | `/organisations` lists organisations the user can access via `canAccessOrganisation`/`canAccessEngagement`; no client-specific landing view exists — they see the same organisation/engagement list a Consultant sees |
| 4. Understands what is required | **NO** | Nothing in the UI explains "here is what PRIMUS needs from you" — the Assessment workspace is a flat control list with no client-oriented completeness framing (§4/§8) |
| 5. Reviews Scope | YES | `/organisations/[id]/engagements/[id]/scope` renders for any user with read access; D3's tri-state decisions are visible |
| 6. Provides/updates organisation information | YES (mechanically) | Master Data screens are real and symmetric-access; no client-specific "please confirm/update" framing |
| 7. Completes Assessment responses | YES (mechanically) | `updateAssessmentResponse` works for any engagement member; the UI does not distinguish "your control" from "consultant's control" |
| 8. Uploads evidence | YES (mechanically) | `uploadEvidence` works; no client-facing "what evidence is expected" surface |
| 9. Responds to clarification requests | **NO** | No clarification/comment mechanism exists anywhere in the domain model (§7) |
| 10. Reviews Findings | YES (mechanically) | Findings page renders for any engagement member; no client-framed "why this matters to you" |
| 11. Provides remediation information | YES (mechanically) | `createRemediationAction`/`updateRemediationAction` are symmetric-access |
| 12. Tracks remediation | YES | Remediation page is real |
| 13. Participates in validation | PARTIAL/dangerous | A client CAN currently create a ValidationRecord (§9) — this should be consultant/Auditor-only, not client-facing at all, per the domain's own intended "independent verification" purpose (DATA_MODEL.md, PRODUCT_SPEC.md Principle 6) |
| 14. Views final report | YES | Report generation/view is real and symmetric-access |

**Conclusion:** roughly two-thirds of the journey is mechanically
possible the moment a client account exists — the dominant blocker is
step 1 (no account creation path exists at all), not the downstream
steps. The two genuinely missing PRODUCT capabilities are clarification/
communication (step 9, §7) and client-comprehensible framing throughout
(§4, §8) — neither requires new domain tables, both require a thin
client-facing UI layer over what already exists.

---

## 5. Assessment Collaboration

**Is the existing Assessment workspace consultant-centric? Yes,
unambiguously.** Direct evidence from
`app/(shell)/.../assessments/[assessmentId]/page.tsx`:

- The page is one continuous "control list + detail panel" workspace with
  search/filter (`q`, `status`) built for someone triaging many controls
  quickly — a Consultant's mental model, not a client's ("what does THIS
  one thing ask of me").
- Every section (Mapped Requirements, Assessment Response, Control Tests,
  Evidence, Risks) renders identically for every viewer; there is no
  "this is what you (the client) need to do" framing, no separate "your
  outstanding items" view.
- The `EFFECTIVENESS_OPTIONS` select (`not_assessed`/`not_applicable`/
  `not_implemented`/`partially_implemented`/`implemented`) presents the
  SAME five-value compliance taxonomy a consultant would use, with no
  plain-language restatement of what a control actually asks in
  operational terms — the control's own `description` field IS shown, but
  nothing translates "the control" into "the question we're asking you."
- "See which controls remain incomplete" is possible only via the generic
  status filter (`Responded`/`Not yet responded`) — functional, but not
  framed as "your outstanding actions."

**What a real client would currently experience, step by step, exactly as
requested:**
- See controls assigned to them: **NO explicit assignment mechanism
  exists** — every control in scope is visible to every engagement member
  equally; there is no per-control "this is the client's to answer"
  concept anywhrere in the schema (`AssessmentControl` carries
  `applicability_decision`, not an assignee).
- Understand what each control asks: PARTIAL — the control's title/
  description render, but in the same terse, audit-shaped language a
  consultant would use.
- Provide a response / rationale: YES, works today (`updateAssessmentResponse`).
- Upload evidence: YES, works today (`uploadEvidence`).
- See evidence requirements: **NO** — nothing in the data model declares
  "this control requires evidence type X" (no such field exists on
  `Control` or `AssessmentControl`).
- Respond to consultant clarification: **NO** — no clarification/comment
  mechanism exists (§7).
- Know which controls remain incomplete: PARTIAL, via the generic status
  filter only.
- Know what requires their action specifically: **NO** — no assignment
  concept exists to derive this from.

**Minimum client-facing workflow required (NOT a redesign of the
Assessment Engine — an additive read/filter layer over it):**
1. A client-scoped read/write view over the EXACT SAME `AssessmentControl`/
   `AssessmentResponse` data, filtered to controls the client can act on
   (initially: all applicable/undecided controls in the engagement, since
   no assignment concept exists yet — see Open Decision in §21).
2. A completeness summary framed as "N of M items need your response" —
   derivable today from the exact same query `listAssessmentsForEngagement`
   already uses (`progress: {completed, total}`), just re-surfaced with
   client-oriented copy.
3. Authorization narrowing so a client role cannot ALSO perform
   consultant-only actions on the same page (Control Test creation, Risk
   creation from a control) — currently possible because of the symmetric-
   access gap (§9).

No change to `AssessmentControl`, `AssessmentResponse`, or the finalization
trigger family is needed or proposed.

---

## 6. Evidence Workflow

**Current, real mechanism** (`lib/domain/evidence.ts`, Milestone 6 + Slice
C2):
- **Upload:** `uploadEvidence` — validates file type/size (allow-listed
  MIME types, 25MB cap), uploads bytes via the storage adapter (§17),
  creates `Document`/`DocumentVersion`/`Evidence`/`EvidenceLink` rows,
  blocked if the target Assessment is already finalized
  (`AssessmentFinalizedError`).
- **Review:** `reviewEvidence` — sets `reviewStatus` to `accepted`/
  `rejected`; rejection REQUIRES a rationale (`ReviewRationaleRequiredError`,
  enforced server-side, not merely a UI `required` attribute).
- **Status:** `pending_review` → `accepted`/`rejected`; a fourth state
  `expired` exists in the enum but nothing in the current domain layer
  writes it (time-based expiry is not implemented — `validUntil` is a
  stored date, but nothing checks it against "now" to transition status).
- **Linking:** polymorphic `EvidenceLink` to `assessment_response` /
  `control_test` / `remediation_action` / `validation_record` — all four
  subject types are real and exercised (confirmed by the reference-
  engagement fixture).
- **Replacement:** **no explicit "replace evidence" action exists** — a
  rejected item stays rejected; a new upload is a NEW `Evidence`/
  `EvidenceLink` row, not a version bump of the rejected one. Functional
  as a workaround, not a designed "resubmit" flow.
- **Download:** real, via a signed-URL Route Handler
  (`.../evidence/[evidenceId]/download`), never a raw storage path exposed
  to the browser.
- **Auditability:** real — evidence-related writes flow through the same
  `audit_log` mechanism every other domain object uses (confirmed
  throughout D1-M2's own testing).

**What prevents this from being a production client workflow — split
precisely:**

**APPLICATION GAPS** (fixable in code, no infrastructure needed):
- `evidence.visibility` (`consultant_internal`/presumably a
  `client_visible` counterpart — confirmed as a real enum column) is
  **never read by any query** in `lib/domain/evidence.ts`. A client with
  engagement access sees every evidence item today, including anything a
  consultant intended as internal-only working notes. This directly
  contradicts PRODUCT_UX_BLUEPRINT.md §8's own claim that this column
  "already enforces server-side" — it does not, as currently wired.
- No "replace/resubmit" action for rejected evidence — workable via a
  fresh upload, but not designed as a client-facing resubmission flow.
- Review/accept-reject authorization is symmetric (§9) — a client could
  review their own upload today, which defeats the purpose of a review
  step entirely.
- No evidence-requirements metadata on Controls (§5) — a client cannot
  currently be told what to upload without a consultant telling them
  out-of-band.

**PRODUCTION INFRASTRUCTURE GAPS** (require a provisioned Supabase project,
not code changes to the domain layer):
- **Storage:** `getEvidenceStorageAdapter()` silently falls back to
  `LocalEvidenceStorageAdapter` (writes to `.local-storage/evidence/` on
  the server's own local filesystem) whenever
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset —
  which is the case in every environment this project has run in so far
  (DECISIONS.md D-03/R-95). This is **not** a bug; it is the documented,
  deliberate MVP posture — but it means every "evidence upload" this
  session, and every prior one, wrote to a container-local disk that
  disappears with the container, never to real, private, durable Storage.
- **Signed URLs:** the local adapter's "signed URL" is a fake
  `local-evidence-storage://` string — never a working HTTP link, verified
  directly by that class's own code and doc comment. A real client cannot
  download evidence through this adapter at all outside a test process.
- **Malware/content scanning:** explicitly deferred (D-05, open decision) —
  mitigated only by MIME-type/extension allow-listing today.
- **Storage RLS-equivalent policies:** written (`supabase/storage-policies.sql`)
  but never applied to any real bucket, because no real bucket exists yet
  (D-03, R-95).

**Bottom line:** the Evidence DOMAIN model and workflow logic are
production-shaped and mostly complete; what stands between it and a real
client is (a) wiring the already-existing `visibility` column into actual
queries, (b) narrowing review authorization away from the uploader, and
(c) provisioning the already-decided (D-03: Mumbai, `ap-south-1`) Supabase
project and pointing the adapter at it — no redesign.

---

## 7. Findings / Remediation Collaboration

**Current client-facing reality, traced through the actual domain
functions:**
- Sees a Finding: YES (`listFindingsForEngagement`, symmetric read).
- Understands its impact: PARTIAL — `severity`/`description` fields
  render; no client-oriented plain-language framing.
- Sees owner: YES — `Finding`/`RemediationAction` both carry owner fields,
  rendered in the UI.
- Sees remediation: YES.
- Proposes remediation: YES, mechanically (`createRemediationAction` is
  symmetric-access) — but nothing in the UI or domain layer distinguishes
  "client proposes" from "consultant assigns," so this reads as "anyone
  can create one," not a designed client-input step.
- Updates remediation status: YES, mechanically (`updateRemediationAction`
  is symmetric) — PRODUCT_UX_BLUEPRINT.md §8 itself flags the exact open
  question this surfaces: "exactly which RemediationAction fields a Client
  Contributor may edit (status subset, due-date acknowledgment, evidence-
  link only?)" is explicitly unresolved (its own R-71 cross-reference).
- Supplies remediation evidence: YES (`EvidenceLink` to
  `remediation_action` is a real, exercised subject type).
- Knows validation status: YES — visible on the Remediation/Validation
  read paths.

**Existing domain capabilities are sufficient; only a thin client-facing
authorization/framing layer is required** — the SAME conclusion as §5/§6.
The one place this section surfaces a genuinely dangerous gap rather than
a merely cosmetic one: **`createValidationRecord` is symmetric-access
today**, meaning a client user could create their own Validation record —
directly contradicting the domain's own stated purpose (an independent,
typically consultant/Auditor verification that a remediation genuinely
closed the gap). This should be a consultant/Auditor-only write, framed
as client-visible-READ-only in the UI and enforced server-side, not merely
hidden from a menu.

No redesign of Finding/Remediation/Validation is proposed or needed.

---

## 8. Communication / Tasks

Direct inspection: **no comment, task-assignment, clarification-request,
notification, or due-date-reminder mechanism exists anywhere in this
codebase.** `RemediationAction` carries a due-date FIELD (a stored date),
but nothing acts on it (no reminder, no overdue flag surfaced anywhere).
There is no `Comment`, `Task`, `Notification`, or `ClarificationRequest`
entity in `DATA_MODEL.md` or the schema.

**Where the workflow currently relies on leaving PRIMUS (necessarily, by
absence):**
- Email — the ONLY way a consultant could today tell a client "please
  respond to this control" or "please provide evidence for X" is manually,
  outside the product.
- Spreadsheets/WhatsApp — likely fallback for tracking "who owes what,"
  since PRIMUS has no assignment or due-date-surfacing concept at all
  (only raw data fields, never actioned).
- Manual reminders — entirely outside PRIMUS; nothing computes "this is
  overdue" today even though `RemediationAction.dueDate` exists as data.

**Ranked by likely value for a genuine first engagement (design judgment,
not implementation):**
1. **Clarification requests / comments on a specific item** (an Assessment
   Response, a Finding, a piece of Evidence) — highest value, because §5/§6
   both surface this as the one capability with NO workaround inside
   PRIMUS today (everything else at least has a symmetric-access
   workaround). A single, simple, polymorphic `Comment` entity (mirroring
   `EvidenceLink`'s own polymorphic-subject shape) would close this without
   inventing a new mechanism.
2. **Due-date surfacing / "what's overdue" summary** — `RemediationAction.
   dueDate` already exists; this is a READ-layer addition (a query, not a
   schema change) computing "days until/past due" for display — high value,
   low cost.
3. **Task assignment** (a formal "this item is assigned to this specific
   user") — medium value; today, "everyone with engagement access can see
   everything" is a workable (if imprecise) substitute for MVP, since a
   client-side engagement typically has few enough people that informal
   assignment (by role, e.g. "IT/CISO handles the SEC-* controls")
   suffices without a formal assignment column.
4. **Notifications** (email/in-app alerts on new comments, new findings,
   overdue items) — lowest MVP priority; requires an actual delivery
   mechanism (email service, or at minimum a durable in-app notification
   table + read/unread UI), meaningfully more infrastructure than #1-3.
   Not recommended for the first customer slice; a client checking the
   product periodically is an acceptable MVP posture.

**MVP requires (recommended): #1 (clarification/comments) and #2
(due-date surfacing) only.** #3 and #4 are explicitly P2/P3 (§15) — real
value, not MVP-blocking.

---

## 9. Client Permissions

**Do Client Administrator and Engagement Manager already provide
sufficient separation? Partially — for the three dedicated permissions
they gate (`scope.lock`/`assessment.finalize`/`maturity.compute`), yes.
For everything else, NO — verified directly, not inferred**, by grepping
every authorization call site in Evidence/Risk/Finding/Remediation/
Validation: every single write function in those five modules calls only
`requireEngagementAccess` (the broad, symmetric check), with zero
exceptions.

**Dangerous cases, evaluated one by one against the actual code:**

| Case | Currently possible? | Mechanism that prevents/allows it |
|---|---|---|
| Client accessing another engagement | **NO — correctly prevented** | RLS + `requireEngagementAccess`'s tenant/org/engagement scoping is real and independently, adversarially tested across every slice (D1-M2) |
| Client accessing another organisation | **NO — correctly prevented** | Same mechanism |
| Client modifying consultant-owned methodology | **NO — correctly prevented** | `methodology.manage` is a real, tenant-scoped permission; client-side roles hold no `TenantMembership` at all |
| Client modifying a finalized Assessment | **NO — correctly prevented** | `enforce_assessment_response_draft_mutable`/equivalent triggers (Milestone 5) block ANY write once `Assessment.status = 'finalized'`, for every role uniformly |
| Client changing Scope after lock | **NO — correctly prevented** | D3's lock-immutability triggers (migration 0028) block it for every role uniformly |
| **Client changing Findings** | **YES — a real, unresolved gap** | `updateFinding` uses only `requireEngagementAccess`; no role check exists |
| **Client changing Validation** | **YES — a real, unresolved gap, and the most concerning one** | `createValidationRecord` uses only `requireEngagementAccess`; a client could self-validate their own remediation |
| Client accessing evidence marked internal | **YES — a real, verified gap** | `evidence.visibility` is never read (§6) |
| Client reviewing/accepting their own evidence | **YES — a real gap** | `reviewEvidence` uses only `requireEngagementAccess` |
| Client creating/scoring a Risk | **YES — likely undesirable, moderate concern** | `createRisk` uses only `requireEngagementAccess`; risk scoring is normally a consultant judgment call, not a client self-assessment |

**Do not implement fixes here, per instruction — but the priority ordering
for §15 follows directly from this table:** Validation and Findings are
the two genuinely dangerous cases (a client could unilaterally certify
their own remediation, or alter a finding's status/severity); Evidence
visibility/review-authorship is a real but lower-severity gap (worst case
is premature disclosure of internal notes, not a false compliance
certification); Risk creation is the least urgent of the four (a
client-created Risk is visible and auditable, not a silent falsification).

---

## 10. Client Master Data

D2's Master Data (`lib/domain/master-data.ts`) is already SCD2-versioned
(`*_versions` tables, "new version row, never an edit to the current
row" — confirmed by DECISIONS.md and this session's own D2 review).

**How a client should, given the actual model:**
- **Review it:** already fully supported — read access is symmetric and
  real (`/organisations/[id]/master-data/[category]`).
- **Create it:** mechanically already possible (`createBusinessUnit`,
  `createSystem`, etc. are symmetric-access) — but this data (Business
  Units, Systems, Data Stores, Processors, Purposes, Personal Data
  Elements, Data Principal Categories) is realistically **consultant-
  authored FROM client-supplied information**, not client-self-service
  data entry, in a typical DPDP advisory engagement — the client tells
  the consultant "we have these three systems," the consultant records
  it. Full client self-service create/edit is not necessary for a first
  engagement; client REVIEW-AND-CONFIRM is the higher-value capability.
- **Update it / create new versions:** same reasoning — mechanically
  possible today, not necessary as a client-facing capability for MVP.
- **Understand historical versions:** no UI currently surfaces version
  history at all (current-row-only rendering) — a real, but low-priority,
  gap; SCD2 data exists in the database whether or not any UI shows it.
- **Distinguish organisation-level vs. engagement-specific data:** already
  structurally clear in the schema (Master Data is `OrganisationMembership`-
  scoped/tenant-owned-per-org; Processing Activities are
  `EngagementMembership`-scoped) — this distinction exists and is
  correctly enforced; it is simply not EXPLAINED anywhere in the UI copy.

**Is client self-service required for first customer? No.** A
"review-and-confirm" read surface (not full create/edit self-service) is
sufficient for a first engagement — matching how real DPDP advisory
engagements actually run (consultant-led data collection, client
verification), and avoiding building a data-entry UI nobody asked for
(the brief's own "avoid dashboard bloat" caution applies equally here).

---

## 11. ROPA / Data Landscape

Design-only, per instruction. Given §10's finding (consultant-authored
FROM client input is the realistic engagement shape, not client
self-service data entry):

- **Create Processing Activities:** not required for MVP client-facing
  capability — consultant-authored, as above.
- **Edit them:** same — not required for MVP.
- **Provide owners:** `ProcessingActivity.ownerUserId` already exists as a
  field; a client-side "confirm/set the owner" capability (narrow, single-
  field) is plausible P1 value but not P0.
- **Update data categories:** not required for MVP.
- **Review ROPA:** already fully supported (read access is real and
  symmetric).
- **Export ROPA:** **no export function exists at all** (confirmed by
  direct inspection — DECISIONS.md R-135 describes ROPA as "a read view,
  never a new persisted table," and no CSV/Excel/PDF export path exists
  anywhere in `lib/domain/processing-activities.ts`). A real gap for
  client self-service (a client will very plausibly want to hand their
  own ROPA to a regulator/auditor as a document), but not P0 for a
  consultant-led first engagement where the Engagement Report already
  produces a real, downloadable PDF (§17).
- **Respond to consultant questions:** same gap as §7/§8 — no
  clarification mechanism exists; a general-purpose Comment capability
  (§8) would cover this use case too, rather than a ROPA-specific one.

---

## 12. Consultant Workspace

What the Engagement Manager needs to operate an engagement efficiently —
separated into what already exists vs. what is genuinely missing:

**Already real and working:**
- Engagement overview (`/organisations/[id]/engagements/[id]` — the
  engagement detail page, with links into every sub-area).
- Assessment progress (`listAssessmentsForEngagement`'s own
  `progress: {completed, total}`, already rendered).
- Evidence review (the review action exists and works).
- Findings/Remediation/Validation views (all real).
- Maturity view/compute (M2, real).
- Report generation (R1, real).

**Missing, ranked must-have vs. nice-to-have:**

*Must have (P0/P1 — directly blocks efficient engagement operation):*
- **Client action tracking** — "what is the client waiting on us for, vs.
  what are we waiting on the client for" — does not exist today in any
  form; the closest proxy is the generic Assessment progress bar, which
  doesn't distinguish who owes the next action. This is the single
  highest-value missing consultant capability, and it is the SAME
  underlying capability §5's client-facing "your outstanding items" view
  needs — one read-layer addition serves both audiences.
- **A cross-engagement portfolio view** ("all my engagements, at a
  glance, with what's outstanding on each") — does not exist; today a
  Practice Partner/Engagement Manager must open each engagement
  individually. High value once more than one or two engagements exist
  simultaneously (which will be true almost immediately after the first
  real customer).

*Nice to have (P2/P3 — real value, not blocking):*
- Bulk actions (e.g., accept multiple evidence items at once).
- A consultant-facing activity feed / recent-changes view.
- Engagement-level health/status rollup beyond raw progress counts.

---

## 13. ABC Fintech First-Customer Walkthrough

Realistic scenario, walked as both parties, using the SAME entities the
real reference-engagement fixture already builds (ABC Fintech Private
Limited, DPDP compliance engagement). "Leaves PRIMUS" is marked wherever
the current product has no mechanism at all for the step.

| # | Who | What | Where | Persisted? | Other party sees | Next | Leaves PRIMUS? |
|---|---|---|---|---|---|---|---|
| 1 | Consultant | Creates Organisation "ABC Fintech Private Limited" | `/organisations/new` | Yes | — | Engagement creation | No |
| 2 | Consultant | Creates Engagement "DPDP Compliance Assessment — FY 2026-27", pins Control Library | `/organisations/[id]/engagements/new` | Yes | — | Invite the client | No |
| 3 | Consultant | **Wants to invite ABC Fintech's Privacy Officer** | — | **No mechanism exists** | — | Must create the client's user account by other means (direct DB/backend access) | **YES — hard stop** |
| 4 | (Out-of-band) | Client account somehow provisioned | — | Yes, but not through any Server Action a real consultant could click | — | Client can now attempt login | **YES — the entire invitation step happens outside PRIMUS today** |
| 5 | Client | Logs in via `/login` | `/login` | Session only | — | Sees `/organisations` | No (once account exists) |
| 6 | Client | Sees "ABC Fintech Private Limited" listed | `/organisations` | — | — | Opens the org/engagement | No |
| 7 | Consultant | Builds Master Data (Business Units, Systems, Processors, etc.) FROM client-supplied information | `/organisations/[id]/master-data/*` | Yes | Client can read it, but has no "confirm this is accurate" affordance beyond generic edit access | Data Landscape build-out | No |
| 8 | Consultant | Builds Processing Activities / ROPA | `/organisations/[id]/engagements/[id]/data-landscape` | Yes | Client can read it | Applicability & Scope | No |
| 9 | Consultant | Builds and locks Applicability & Scope | `/organisations/[id]/engagements/[id]/scope` | Yes | Client can read it (correctly excluded from writing it) | Assessment creation | No |
| 10 | Consultant | Creates the Assessment | `/organisations/[id]/engagements/[id]/assessments/new` | Yes | Client sees it appear | Client responds | No |
| 11 | Client | Opens the Assessment, tries to understand what's asked | Assessment workspace | — | Consultant sees the same page | Client answers controls | No, but the experience is consultant-shaped (§5) |
| 12 | Client | Responds to a control, uploads evidence | Assessment workspace | Yes | Consultant sees the response/evidence appear | Consultant reviews evidence | No |
| 13 | Consultant | Reviews evidence, rejects one item with a rationale | Assessment workspace | Yes | Client sees `rejected` status + rationale | **Client needs to ask "why exactly"** | — |
| 14 | Client | **Wants to ask a clarifying question about the rejection** | — | **No mechanism exists** | — | Falls back to email/call | **YES — hard stop** |
| 15 | Consultant | Finalizes the Assessment | Assessment workspace | Yes | Client sees `finalized` status | Risk/Finding/Remediation | No |
| 16 | Consultant | Creates Risks, Findings from gaps | Risk/Findings pages | Yes | Client can read (and could ALSO write — §9 gap) | Remediation | No |
| 17 | Consultant/Client | Remediation actions created, owners assigned | Remediation page | Yes | Both see it | Client works the remediation | No |
| 18 | Client | Updates remediation status, uploads remediation evidence | Remediation page | Yes | Consultant sees it | Consultant validates | No |
| 19 | Consultant (or, today, technically the Client — §9 gap) | Creates a Validation record | Remediation/Validation area | Yes | Both see it | Maturity compute | No |
| 20 | Consultant | Computes Maturity | Assessment page (M2) | Yes | Client can read the result (unrestricted — no release gate exists) | Report | No |
| 21 | Consultant | Generates the Engagement Report | `/organisations/[id]/engagements/[id]/reports` | Generated on demand, not stored | Client can generate/view it too | Engagement continues or closes | No |

**Every point where the user currently has to leave PRIMUS, consolidated:**
1. **Client invitation/account provisioning (step 3-4)** — the single
   hardest, earliest blocker. Nothing downstream can happen through the
   product until this is solved.
2. **Clarification on a rejected item (step 14)** — the one recurring
   "email/call" fallback point throughout the entire engagement (would
   recur at every Finding, every Assessment control, every remediation
   status question — Assessment/Evidence is simply the first place it
   bites).

Everything else in this walkthrough works, mechanically, through the real
application layer today — the workflow is not broken by missing
capability nearly as much as it is broken by these two specific,
narrow gaps.

---

## 14. Gap Matrix

| Stage | Consultant Support | Client Support | Persistence | Auditability | Production Ready | Gap |
|---|---|---|---|---|---|---|
| Organisation | YES | N/A (consultant-created) | YES | YES | YES | None |
| Master Data | YES | PARTIAL (read yes, no confirm workflow) | YES | YES | YES | Client review framing |
| Data Landscape/ROPA | YES | PARTIAL (read yes) | YES | YES | YES | Export; client input framing |
| Applicability & Scope | YES | PARTIAL (read yes, correctly no write) | YES | YES | YES | Client-input-informed decisions (currently 100% consultant-driven) |
| Control Library | YES | N/A (practice-owned, correctly no client access) | YES | YES | PARTIAL (see §19 — demo content only) | DPDP content authority |
| Assessment | YES | PARTIAL (mechanically works, consultant-shaped UI) | YES | YES | YES | Client-facing framing (§5) |
| Assessment Responses | YES | PARTIAL (works, undifferentiated authorization) | YES | YES | YES | No per-control assignment concept |
| Evidence | YES | PARTIAL (upload works; review/visibility gaps — §6/§9) | YES | YES | **NO** (local storage stand-in) | Visibility enforcement; review authorization; production storage |
| Control Testing | YES | N/A (not meaningfully client-facing) | YES | YES | YES | None |
| Risks | YES | PARTIAL (undifferentiated write access — §9) | YES | YES | YES | Client-write narrowing |
| Findings | YES | PARTIAL (undifferentiated write access — §9) | YES | YES | YES | Client-write narrowing |
| Remediation | YES | PARTIAL (works, field-level scope undefined) | YES | YES | YES | Client-editable field subset (open, PRODUCT_UX_BLUEPRINT.md's own flagged gap) |
| Validation | YES | **NO — should not have write access, currently does (§9)** | YES | YES | YES | Authorization narrowing (real risk of false self-certification) |
| Maturity | YES | PARTIAL (unrestricted read, no release gate) | YES | YES | YES | Client-visibility gating |
| Engagement Report | YES | YES | Generated on demand | YES | PARTIAL (PDF real; no persisted/versioned report record) | None blocking |
| Client invitation | N/A | **NO — does not exist** | N/A | N/A | N/A | **The primary blocker** |
| Clarification/comments | N/A | **NO — does not exist** | N/A | N/A | N/A | Second-most-recurring blocker |

**Note on "Production Ready":** per instruction, nothing above is called
production-ready merely because an application layer exists — Evidence is
explicitly marked NO because the storage layer it depends on is a local
stand-in, not because the domain logic is incomplete; the Control Library
is marked PARTIAL because "production-ready code" and "authoritative
regulatory content" are two different kinds of readiness (§19).

---

## 15. Prioritized Gaps

**P0 — blocks first real customer (the engagement genuinely cannot run
without these):**
1. **Client invitation / account provisioning.** Without this, no client
   user can exist in the product at all — every other capability is moot.
2. **Production Supabase provisioning + real Storage adapter wiring**
   (Mumbai, `ap-south-1`, already decided per D-03). Without this, no real
   client evidence document can be safely stored — the local filesystem
   stand-in is explicitly not durable, not private, and not signed-URL-
   backed for real use.
3. **Validation write-authorization narrowing** (§9) — a client
   self-certifying their own remediation is a genuine integrity failure
   for a compliance product, not a cosmetic gap. Narrow, well-scoped fix
   (one function, one new check).
4. **`evidence.visibility` enforcement** (§6) — wiring an already-existing
   column into the already-existing read queries; small, but closes a real
   confidentiality gap the product's own design already anticipated and
   partially built.

**P1 — strongly desirable for first customer (the engagement CAN run
without these, but painfully, and the workaround is visible to the
client):**
1. **Clarification/comments mechanism** (§7, §8) — the one recurring
   fall-back-to-email point throughout the whole walkthrough (§13).
2. **Client-facing Assessment framing** — "your outstanding items," plain-
   language control explanations (§5) — same underlying data, different
   presentation; also directly serves §12's consultant "client action
   tracking" need.
3. **Findings/Risk write-authorization narrowing** (§9) — real but lower-
   severity than Validation; a client-created Risk/Finding is visible and
   auditable, not silently false.
4. **Evidence review-authorship narrowing** (§6/§9) — a client should not
   review/accept their own upload.
5. **Client landing/portfolio view** — "which engagements, what's
   outstanding" (§8, §12) — same underlying capability serves both actors.

**P2 — post-MVP (real value, not needed for a credible first
engagement):**
1. Remediation field-level client-write scoping (the exact open question
   PRODUCT_UX_BLUEPRINT.md already flags, §7).
2. Master Data / Processing Activity version-history UI (§10).
3. ROPA export (§11).
4. Client self-service Master Data create/edit (§10, §11).
5. Due-date surfacing/overdue summary (§8).

**P3 — future platform (no first-engagement pressure):**
1. Formal task assignment (§8).
2. Notifications/email delivery (§8).
3. Bulk consultant actions (§12).
4. A persisted/versioned Engagement Report record (currently generated
   fresh each time — acceptable for MVP).

---

## 16. Client Portal MVP Definition

**What "Client Portal" does NOT mean, based on this evidence:** it does
not mean "build a new dashboard app" or "build new screens from scratch."
Every underlying capability a client needs already exists as real,
working application/domain code (§2's table). "Client Portal" for PRIMUS
means: **(a) making it possible for a real client user to exist in the
product at all, (b) narrowing authorization so client-side access is
genuinely safe (not merely unused-in-practice), and (c) a thin,
client-oriented presentation layer over the SAME domain functions the
consultant workspace already calls — not a parallel implementation.**

**Smallest coherent Client Portal MVP, defined component by component:**

- **Client landing page:** a filtered view of `/organisations` scoped to
  the client's own organisation(s) — reuses `canAccessOrganisation`
  unchanged; new element is purely "what does the client see first,"
  which is a routing/presentation decision, not new domain logic.
- **Engagements:** the existing engagement list/detail, re-surfaced with
  client-oriented copy — no new persistence.
- **Assigned actions:** the §5/§12 "outstanding items" read layer — ONE
  new read function (a variant of `listAssessmentsForEngagement`'s own
  progress logic, generalized across Assessment/Evidence/Remediation),
  not a new table.
- **Assessment collaboration:** the existing Assessment workspace,
  re-presented with plain-language framing and (once §9's authorization
  narrowing lands) genuinely client-scoped write access — no change to
  `AssessmentControl`/`AssessmentResponse`.
- **Evidence:** the existing upload/download flow, with (once P0 items 2
  and 4 land) real storage and enforced visibility — no new domain
  concept.
- **Findings:** existing read access, narrowed write (§9) — no redesign.
- **Remediation:** existing read/write, scoped once the field-level
  question (§7, P2) is resolved — not P0 for MVP; broad access is an
  acceptable interim MVP posture given it is at least visible/auditable.
- **Reports:** already fully functional and client-accessible today — no
  work needed.
- **Permissions:** Client Administrator remains the correct primary
  client role; no new database role is needed for the MVP scope above —
  what's needed is closing the specific symmetric-access gaps §9
  identified (a handful of `requireEngagementAccess` call sites gaining a
  narrower, role-aware check), not a new authorization framework.

**What the MVP explicitly excludes** (per §15's own P2/P3 ranking):
notifications, formal task assignment, bulk actions, ROPA export, Master
Data self-service editing, a dedicated Client-Contributor-vs-Client-Admin
distinction beyond what already exists.

---

## 17. Production Readiness

Application-layer readiness and production infrastructure are evaluated
separately, per instruction — the former is largely real; the latter is
almost entirely unprovisioned (all findings below are traced to
DECISIONS.md's own existing, explicit entries, not newly discovered here):

| Item | Status | Evidence |
|---|---|---|
| Supabase production database | **NOT PROVISIONED** | R-85: `DATABASE_URL` still points at a local Postgres superuser everywhere this project has run |
| Supabase Mumbai region (`ap-south-1`) | **DECIDED, not provisioned** | D-03, resolved as the target region; explicitly states the project itself is not created by that decision |
| Private evidence storage | **NOT PROVISIONED** | `getEvidenceStorageAdapter()` falls back to local filesystem whenever real Supabase env vars are absent (verified, §6) |
| Signed URLs | **APPLICATION-LAYER REAL, INFRASTRUCTURE UNVERIFIED** | `SupabaseEvidenceStorageAdapter.createSignedUrl` is real code; never exercised against a real bucket (the local adapter's equivalent is an admitted fake) |
| Malware scanning | **DEFERRED, OPEN DECISION** | D-05 — explicitly not yet decided whether it's required pre-launch |
| Authentication | **PARTIAL** | Supabase Auth integration code is real (`lib/supabase/server.ts`, `lib/auth/session.ts`); no live Auth backend has ever been exercised end-to-end (session test's own docstring: "no live Supabase Auth backend... is reachable from this environment") |
| Authorization (application layer) | **REAL, well-tested** | Independently implemented, two-layer (app + RLS) model, exercised across 844 tests |
| RLS | **REAL AT THE SCHEMA LEVEL, unverified in a real project** | Every migration since 0001 defines real RLS policies, exercised against local Postgres; never run against an actual Supabase-hosted Postgres instance |
| Audit logging | **REAL** | `audit_log` mechanism exists and is exercised throughout; not yet proven under real production traffic volume |
| Backups/recovery | **NOT ADDRESSED** | No backup/restore procedure exists or has been tested (D-03's own explicit list) |
| Secrets | **NOT PRODUCTION-CONFIGURED** | No production secret-management posture beyond local `.env` — not evaluated as part of any slice to date |
| Monitoring | **NOT ADDRESSED** | No production monitoring exists (D-03's own explicit list) |
| Error handling | **PARTIAL** | Domain-layer errors are consistently typed/handled (verified throughout D1-M2); no production error-tracking/alerting integration exists |
| D-04 (data-principal PII) | **OPEN** | Unresolved — current MVP assumption is category-level data only, never individual data-principal records |
| D-05 (malware scanning) | **OPEN** | See above |
| D-06 (billing) | **OPEN** | Irrelevant to first-customer engagement delivery (billing is a Phase 3 self-serve concern, not a consulting-engagement blocker) |

**What must be solved before handling a real client's confidential
evidence, specifically:** the Supabase Mumbai project must exist and be
provisioned (database + Storage + Auth, per D-03's own already-decided
scope), the application must be repointed at it (`DATABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`), `supabase/storage-policies.sql`
must be applied and independently verified, and RLS must be confirmed to
actually enforce under the real Supabase Postgres role model (not merely
the local shim). This is a well-scoped, already-substantially-designed
body of work — not a research problem.

---

## 18. DPDP Content Readiness

**Control Library software vs. authoritative DPDP methodology content —
kept strictly distinct, per instruction:**

- **Control Library SOFTWARE** (authoring domain layer, versioning,
  publish/immutability lifecycle, RLS, requirement linkage): real,
  complete, and production-shaped (Slice D1) — this is genuinely reusable
  for ANY control library content, demo or real.
- **The 25-control demo library's own CONTENT:** explicitly,
  consistently, and deliberately labeled as non-authoritative everywhere
  it appears:
  - The version label itself: "DPDP Demo Control Library v1.0 (SAMPLE —
    for demonstration only, not an official or verified regulatory
    framework)" (verified directly in the reference-engagement report
    PDF's own rendered text, §M2 session).
  - Every regulatory reference/citation in the fixture is "clearly-
    labeled illustrative," never a quotation of actual DPDP Act/Rules
    statutory text (reference-engagement-fixture.ts's own explicit
    comment: "concise, original control statements — never a quotation
    of statutory text, never attributed to a specific DPDP Act/Rules
    section number").

**Determination: demo-only, by explicit design, not "somewhere in
between."** This is not a legal claim about DPDP's actual requirements
(none is made anywhere in this codebase) — it is a direct, verifiable
observation about what content exists in the repository today. Producing
a REAL, legally-reviewed, citation-accurate DPDP control library is a
distinct, substantial body of content work (subject-matter expert
involvement, legal review) — entirely separate from any engineering task,
and explicitly out of scope for this discovery exercise per its own
"do not create content" instruction.

---

## 19. Recommended Sequence

Derived from §15's actual prioritization, not defaulted to
"Client Portal first":

**P2A — Authorization & Confidentiality Hardening** (smallest, highest-
leverage, addresses the two P0 integrity/confidentiality gaps directly):
narrow Validation write access to consultant/Auditor only; wire
`evidence.visibility` into the existing read queries; narrow Evidence
review authorship away from the uploader; narrow Findings/Risk writes.
No new tables, no new UI — pure authorization-layer work, the same shape
D3's `scope.lock`/`requireEngagementMembershipAccess` and M2's
`maturity.compute` already established as this codebase's own pattern.

**P2B — Client Invitation & Account Provisioning** (the single hardest
blocker in §13's walkthrough): a real domain function + Server Action
for inviting a client user, creating their account, and granting the
correct initial membership (Client Administrator, by default). This
unblocks every downstream client-facing capability at once.

**P2C — Evidence Production Readiness** (P0 infrastructure item):
provision the Mumbai Supabase project, apply the already-written storage
policies, repoint the application, verify signed URLs and RLS against
the real project.

**P2D — Client Collaboration Layer** (P1 — the smallest coherent Client
Portal MVP per §16): client-scoped Assessment framing, the "outstanding
items" read layer (serving both consultant and client per §12), and the
clarification/comments mechanism (§7/§8).

**P2E — Authoritative DPDP Content** (a distinct, non-engineering
workstream that can proceed in parallel with P2A-D once subject-matter
expertise is engaged — not sequenced as a blocking dependency of the
others).

This ordering follows directly from severity (P2A closes real integrity
gaps with the least effort), then dependency (P2B unblocks everything
client-facing), then infrastructure (P2C is necessary before any real
client evidence can be handled at all, but does not block the
authorization/invitation work), then the actual collaboration UI (P2D),
with content work (P2E) running independently.

---

## 20. Open Decisions

1. **Per-control assignment.** Should `AssessmentControl` (or a new,
   additive junction) eventually carry an explicit "assigned to this
   user/role" concept, or does role-based informal assignment (e.g.,
   "IT/CISO handles SEC-* controls," communicated out-of-band) remain
   sufficient through the first several engagements? Recommend deferring
   a formal assignment column until a second real engagement makes the
   need concrete — §5's MVP explicitly does not require it.
2. **Comment/clarification entity shape.** A single polymorphic `Comment`
   table (mirroring `EvidenceLink`'s subject-type pattern) vs. several
   narrower, type-specific tables — a real design choice for whoever
   implements P2D, not resolved here.
3. **Whether Privacy Officer needs its own distinct authorization shape**
   (PRODUCT_UX_BLUEPRINT.md's own still-open question, §8 of that
   document) or can be treated identically to Client Administrator for
   MVP purposes — recommend treating it as Client-Administrator-equivalent
   for the first customer, revisiting only if a real engagement's actual
   staffing surfaces a concrete need for the distinction.
4. **Maturity/Report client-visibility gating.** PRODUCT_UX_BLUEPRINT.md's
   own "CV (released only)" design intends a formal release gate before a
   client sees a Maturity score or Report; today, read access is
   unrestricted for any engagement member the moment the underlying data
   exists. Whether this gate is needed for a FIRST customer (who is
   presumably closely collaborating with the consultant throughout, not
   guarding against a premature-disclosure scenario) or can wait for a
   later slice is a product judgment call, not resolved here.
5. **Whether "Client Portal" should be its own routed section
   (`/portal/...`) or remain the same `/organisations/...` routes with
   role-aware rendering** — a real architectural choice for the
   implementation slice, not decided by this discovery exercise; §16's
   MVP definition is agnostic to this choice (every capability it
   describes works under either routing shape).

---

**P2 STATUS: DESIGN COMPLETE — AWAITING PRODUCT APPROVAL**
