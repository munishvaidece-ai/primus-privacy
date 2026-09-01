# PRIMUS PRIVACY

A DPDP advisory and continuous compliance platform, architected as one
connected data model spanning the full client journey — Client →
Engagement → Discovery → Evidence → Applicability & Scope → Data Landscape
→ Processing Activities/ROPA → Data Mapping → Controls → Assessment →
Control Testing → Risk → Findings → Remediation → Validation → Maturity →
Reporting → Continuous Compliance.

**Status:** Architecture phase. No application code has been written yet —
see `PROGRESS.md` for exactly what exists and what doesn't.

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
