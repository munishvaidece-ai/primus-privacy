# PRIMUS PRIVACY — Product Specification

Status: Draft v0.2 — architecture phase, no application code yet.
Owner: Principal Architecture session, 2026-09-01. Session 2 aligns §2 and
§4–§5 terminology with the `Tenant`/`Organisation` model resolved in
DECISIONS.md D-01.

## 1. Product Vision

PRIMUS PRIVACY is a technology-enabled DPDP (Digital Personal Data Protection)
advisory and continuous compliance platform. It is built first as the
delivery engine for a professional privacy/DPDP consulting practice running
real client engagements, and is architected from day one so that a client
can continue operating on the same underlying data — as a tenant in its own
right — after the consulting engagement ends, without a re-platforming
event.

The single governing product principle is:

> **One source of truth for the client's privacy/compliance journey.**

Concretely: a Processing Activity, a Risk, a Control, a Finding are each a
single real row in a relational database, referenced (not copied) by every
screen that needs them — the ROPA, the Data Inventory, the Processor
Register, the Risk Register, dashboards and client/board reports are **views
and workflows over one data model**, not parallel databases that can drift
out of sync with each other.

The platform explicitly does **not** aim to generate legal conclusions. It
helps consultants work faster and more consistently, surfaces
system-suggested candidates (e.g. "this processing activity may need a
DPIA"), and gives consultants full audit-tracked ability to review, accept,
modify or reject anything the system suggests. The professional judgment of
a qualified consultant remains the source of every legal conclusion in the
platform.

## 2. Users

### PRIMUS-side (the consulting practice)

| Role | Purpose |
|---|---|
| Platform Administrator | Operates the platform itself: client organisation provisioning, global role/permission configuration, control library and regulatory content management. Not a participant in client engagement work by default. |
| Practice Partner | Practice-wide oversight: engagement economics, quality sign-off, cross-engagement visibility within the practice. |
| Engagement Manager | Owns delivery of one or more engagements: scoping, staffing, timeline, client relationship, final report sign-off. |
| Consultant | Does the engagement work: discovery, data landscape build-out, assessments, control testing, findings, remediation tracking. |
| Auditor | Independent, practice-internal quality reviewer of engagement work products before they reach the client (interpreted as an internal QA function — see DECISIONS.md). |

### Client-side

| Role | Purpose |
|---|---|
| Client Administrator | Manages the client organisation's own users and access on the platform. |
| Privacy Officer / DPO | Primary client-side owner of the compliance programme; broadest client-side visibility. |
| Business Owner | Owns specific processing activities / business units; provides input, accepts remediation ownership. |
| IT / CISO | Owns systems, data stores, technical controls and technical evidence. |
| Procurement | Owns processor/vendor relationships and contracts (DPAs). |
| Legal | Reviews legal-adjacent artifacts: notices, contracts, regulatory interpretation notes (not a generator of legal conclusions — a reviewer). |
| CXO / Executive Viewer | Read-only, summary/dashboard-level visibility for governance reporting. |

Access is always determined server-side by **organisation + engagement +
role (+ object-level exception where necessary)** — see SECURITY.md. No
role's access is enforced by hiding UI elements alone.

## 3. Core Workflow (the engagement journey)

```
Client → Engagement → Discovery → Evidence → Applicability & Scope →
Data Landscape → Processing Activities / ROPA → Data Mapping → Controls →
Assessment → Control Testing → Risk → Findings → Remediation →
Validation → Maturity → Reporting → Continuous Compliance
```

This is not eighteen separate modules. It is one connected object graph
(see DATA_MODEL.md) traversed in a broadly linear order during an
engagement, with a governance engine (Assessment → Evidence → Control Test →
Risk → Finding → Remediation → Validation) that keeps running throughout an
engagement and, eventually, continuously after it.

Narrative walk-through:

1. **Client** is onboarded as a client organisation under PRIMUS's tenant
   (see ARCHITECTURE.md §5 for the `Tenant`/`Organisation` distinction).
2. An **Engagement** is opened under the client (e.g. "DPDP Readiness &
   Implementation — FY2026"). All engagement work happens inside this
   boundary.
3. **Discovery** — structured interviews, questionnaires and document
   collection produce **Evidence** and populate the **Data Landscape**:
   Processing Activities, Data Principals (categories), Personal Data
   Elements, Purposes, Systems, Data Stores, Processors/Subprocessors, Data
   Flows, Retention practice, Notices, and Consent mechanisms.
4. **Applicability & Scope** determines which regulatory obligations apply
   to which parts of the client's processing, with rationale and evidence —
   never a silently auto-generated legal conclusion.
5. **Processing Activities** become the connective hub: each one links to
   the data landscape objects that describe *how* that activity actually
   processes personal data.
6. **Controls** (drawn from a versioned control library, itself mapped to
   **Regulatory References** and **Requirements**) are assessed via
   **Assessments** with **Assessment Responses**, backed by **Evidence** and
   **Control Tests**.
7. Control results and business context drive the **Risk** register
   (inherent → residual → rating, via a configurable scoring model).
8. Gaps become **Findings**, which drive **Remediation Actions**, which —
   once evidenced and consultant-**validated** — trigger **Control
   Reassessment**, which is what actually moves the **Maturity** score.
   Marking a remediation "done" never moves maturity by itself.
9. **Reporting** is generated from the live object graph (with clear
   internal-vs-client visibility rules — see below), not from a duplicated
   reporting database.
10. **Continuous Compliance** is the same object graph kept alive after the
    engagement closes, under a new engagement type, so the client's history
    is preserved and comparable over time.

## 4. Product Principles (commitments)

These are enforced architecturally, not just as intentions — see
ARCHITECTURE.md, DATA_MODEL.md and SECURITY.md for how each is implemented:

1. Real relational data; no hard-coded demo data anywhere in shipped code.
2. Multi-tenant from day one — a `Tenant` (one consulting practice) owns
   many client `Organisation`s, each isolated from every other client
   under the same tenant; exactly one `Tenant` exists in MVP (see
   ARCHITECTURE.md §5, DECISIONS.md D-01).
3. Server-side authorization on every read and write; UI hiding is cosmetic
   only.
4. Engagement-level isolation as a first-class boundary, not a filter
   applied late.
5. Full audit history for every material change (append-only audit log).
6. Historical assessments are immutable once finalized; corrections create
   a new assessment period rather than rewriting history.
7. Consultant-internal data and client-visible data are distinguished by an
   explicit visibility attribute, enforced server-side, never by client-side
   filtering.
8. Regulatory content, consulting methodology (control library) and client
   engagement data are three separate concepts with separate versioning.
9. No feature auto-generates a definitive legal conclusion. System
   suggestions are always paired with an explicit human decision field.
10. Risk scoring and maturity weighting are configurable data, not
    hard-coded logic.
11. Every workflow transition that matters is traceable to who did it, when,
    and (where relevant) why.

## 5. MVP Scope

The MVP is **one complete, real engagement workflow**, end to end, for a
single client and a single engagement — not partial coverage of many
modules. Concretely:

**In scope for MVP:**
- Tenant/organisation model: one `Tenant` (PRIMUS) + one client `Organisation`
  + Business Units.
- User accounts, roles, and engagement membership (server-enforced
  authorization).
- Engagement creation and lifecycle (Draft → Active → Closed).
- Discovery via Tasks + Evidence + Notes attached to the engagement (no
  bespoke questionnaire-builder UI in MVP — see Non-MVP).
- Applicability & Scope determination record with rationale and evidence.
- Data Landscape: Processing Activities, Data Principal categories,
  Personal Data Elements, Purposes, Systems, Data Stores, Processors (incl.
  subprocessor chaining), Data Flows, Retention Rules, Notices, and a
  lightweight Consent-mechanism description (not a consent-receipt
  transaction log — see Non-MVP).
- Control library (versioned) mapped to Regulatory References and
  Requirements (DPDP Act content only).
- Assessment engine: Assessment → Assessment Response → Evidence → Control
  Test, with consultant override + rationale fields.
- Risk register with a configurable scoring model (likelihood × impact →
  inherent/residual rating).
- Findings and Remediation Actions with the full
  remediation→evidence→validation→reassessment loop.
- Maturity scoring derived from control results via configurable domain
  weights (no manual override of the final number).
- One exportable engagement report, generated from live data, honoring
  internal/client visibility.
- Append-only audit log for all material entities.
- Basic Task and Notification objects (in-app only).

**Explicitly out of MVP (Non-MVP) scope:**
- DPIA and SDF/high-risk screening workflow UI (data model supports them as
  specialized assessments — see DATA_MODEL.md — but no dedicated UI yet).
- AI Use Case tracking UI (entity modeled, not exposed).
- Real consent-receipt capture at data-principal-transaction scale (a
  consent management platform is a distinct product; MVP only records how
  consent is obtained per processing activity).
- Cross-engagement / cross-period maturity comparison dashboards.
- Self-serve client onboarding, billing/subscription management, and any
  multi-practice (white-label) capability.
- Email/SMS notification delivery (in-app only in MVP).
- Any AI-assisted drafting or generation feature.
- SSO/SCIM and third-party integrations (ticketing, DLP/CASB discovery
  feeds).
- Multiple regulatory frameworks beyond DPDP Act (architecture supports it;
  content does not exist yet).

See ROADMAP.md for how Non-MVP items are sequenced into Phase 2 / Phase 3.
