# PRIMUS PRIVACY

A DPDP advisory and continuous compliance platform, architected as one
connected data model spanning the full client journey — Client →
Engagement → Discovery → Evidence → Applicability & Scope → Data Landscape
→ Processing Activities/ROPA → Data Mapping → Controls → Assessment →
Control Testing → Risk → Findings → Remediation → Validation → Maturity →
Reporting → Continuous Compliance.

**Status:** Milestone 8A (database foundation through Risk/Findings/
Remediation/Maturity) plus Slice P2B (Client Invitation & Onboarding)
are implemented and tested — see `PROGRESS.md` for the exact, session-
by-session build log and what remains open.

**Current MVP workflow** (P2B.5, Session 41): a PRIMUS consultant
creates an Organisation, an Engagement, and an invitation for a client
user (today via `lib/domain/invitations.ts`'s `createInvitation` —
invitation-creation UI does not exist yet, DECISIONS.md R-179); the
invited client opens `/invite/[token]`, signs in with their invited
email (existing Supabase Auth, `/login`), and accepts — landing on their
own Organisation or Engagement page, the same page a consultant already
uses, with client-appropriate navigation. From there the client and
consultant continue the same Assessment / Evidence / Risk / Finding /
Remediation / Validation workflow together, entirely server-side-
authorized (SECURITY.md §2).

## Documentation

| Document | Contents |
|---|---|
| [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md) | Product vision, users, core workflow, MVP / non-MVP scope |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System architecture, layers, components, tenancy, deployment |
| [`DATA_MODEL.md`](./DATA_MODEL.md) | Entities, relationships, cardinality, versioning |
| [`SECURITY.md`](./SECURITY.md) | Auth, authorization, tenant isolation, evidence security, threats |
| [`ROADMAP.md`](./ROADMAP.md) | MVP, Phase 2, Phase 3 |
| [`PROGRESS.md`](./PROGRESS.md) | What's actually implemented vs. planned, updated per session |
| [`DECISIONS.md`](./DECISIONS.md) | Architectural decision log, including open **DECISION REQUIRED** items |

Before writing code against this repository, read `DECISIONS.md` for the
open items. The two that used to block the first database migration —
tenancy (D-01) and Data-Landscape persistence across engagements (D-02) —
are resolved as of Session 2 (see `DECISIONS.md` and `DATA_MODEL.md` §2/§5).
**D-03 (data residency)** is the item to resolve before provisioning a
real Supabase project; the remaining open items (D-04–D-06) don't block
early schema work.
