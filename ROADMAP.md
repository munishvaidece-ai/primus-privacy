# PRIMUS PRIVACY — Roadmap

Status: Draft v0.1. Scope boundaries here are intentionally conservative —
each phase only starts once the previous phase's real usage has validated
the data model underneath it (principle 15: don't build dozens of screens
before the data model is sound).

## MVP — One Complete Engagement Workflow

Goal: run one real client engagement, start to finish, on the platform,
end-to-end, rather than partially covering many modules. See
PRODUCT_SPEC.md §5 for the detailed in/out scope list. In build order:

1. **Foundation** — Organisation (Practice + one Client), BusinessUnit,
   User, Role, Permission, RolePermission, Engagement, EngagementMembership.
   Authentication + the two-layer authorization model (SECURITY.md §2).
   Nothing else is buildable safely before this exists and is tested.
2. **Evidence & Documents** — Document, Evidence, EvidenceLink, Note,
   NoteLink, Task, TaskLink, signed-URL access path. Needed early because
   almost every later object attaches evidence.
3. **Data Landscape** — ProcessingActivity and its connected entities
   (§5 of DATA_MODEL.md) — the ROPA/data-inventory view is a query over
   this, not a new module.
4. **Regulatory & Control Library (DPDP only)** — RegulatoryReference,
   Requirement, ControlLibraryVersion, Control, ControlRequirement — seeded
   content, not user-authored in MVP.
5. **Assessment Engine** — Assessment, AssessmentControl,
   AssessmentResponse, ControlTest, ApplicabilityDetermination.
6. **Risk & Findings** — RiskScoringModel (configurable), Risk, Finding and
   their junctions.
7. **Remediation & Validation loop** — RemediationAction, ValidationRecord,
   and the enforced state machine described in DATA_MODEL.md §8.
8. **Maturity Engine** — MaturityDomain, MaturityDomainWeight,
   MaturityScore, computed only from accepted validations/control
   reassessment.
9. **Audit Log + Reporting** — AuditLog wired into every write from step 1
   onward (retrofit as each module lands, not bolted on at the end); one
   exportable engagement report.
10. **Notifications** — in-app only, generated from Task/workflow events.

MVP is "done" when one real engagement can move through the full journey
(Client → … → Reporting) with server-enforced access control, an audit
trail, and no hard-coded/demo data anywhere in the path.

## Phase 2

Builds on a proven MVP, still single-practice:

- **DPIA & SDF-screening UI** over the existing Assessment-engine
  specialization (data model already supports this — see DATA_MODEL.md §7).
- **AI Use Case tracking UI.**
- **Cross-engagement / cross-period maturity comparison** dashboards and
  posture trend views (enabled by the Engagement/Assessment versioning
  chains already in the model).
- **Notice & consent management** expansion — still compliance
  documentation, not a consent-receipt transaction platform (see
  DECISIONS.md §D-04 before this expands further).
- **Email notification delivery**, layered onto the existing Notification
  entity rather than replacing it.
- **QualityReview workflow UI** for the Auditor role.
- **MFA** for all users; SSO for PRIMUS-side users and larger client
  organisations.
- **Malware scanning on evidence upload**, once real client file volume
  justifies the added infrastructure.
- Hardening of the client-facing experience for the post-engagement
  "Continuous Compliance" engagement type, so a client can operate
  independently between formal assessment cycles.

## Phase 3

Multi-tenant SaaS maturity, pursued only once Phase 2 is validated with
real client usage:

- **Self-serve client onboarding** and subscription/billing (no
  billing/subscription entity exists in the current model — this needs its
  own design pass and a DECISION on the billing model before schema work
  starts).
- **Multi-practice / white-label** support: the `Tenant` isolation
  mechanism is already in place from MVP (DECISIONS.md D-01, resolved
  Session 2), so onboarding a second practice is data provisioning, not a
  schema change — but the white-label-specific functionality itself
  (branding, custom domains, a multi-practice admin UI, per-tenant
  billing) is deliberately unbuilt until there's a real second practice to
  build it for.
- **Additional regulatory frameworks** beyond DPDP (the RegulatoryReference/
  Requirement model is already framework-agnostic; this phase is primarily
  content, not architecture).
- **Integrations**: SSO/SCIM at scale, ticketing systems, DLP/CASB feeds
  for semi-automated data-landscape discovery.
- **AI-assisted drafting**, strictly additive and strictly
  suggest/accept/modify/reject — never a source of a final conclusion
  (principle 10/11 continue to apply unchanged).
- **Advanced analytics/benchmarking** across clients (with the
  client-organisation isolation and consent implications that
  cross-client aggregation raises addressed explicitly before any such
  feature is built).

## Explicitly Not Scheduled

Nothing in Phase 2 or Phase 3 begins before the MVP has been used on a real
engagement. This roadmap is a sequencing guide, not a commitment to a
calendar.
