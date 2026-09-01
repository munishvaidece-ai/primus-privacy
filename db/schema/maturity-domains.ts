import { pgTable, uuid, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// MaturityDomain — a configurable scoring domain, e.g. "Governance,"
// "Data Management," "Third-Party Risk" (DATA_MODEL.md §9's exact
// example set — used here only as illustrative prose, never seeded as
// PRIMUS's actual proprietary methodology; Milestone 8 instructions §4/
// §16: "do NOT invent a large production domain framework... use clearly
// synthetic/test domains" and never "present synthetic domains as
// PRIMUS's final proprietary methodology"). Every domain this milestone's
// own tests create is named accordingly (e.g. "Test Domain — Governance")
// — see DECISIONS.md.
//
// Practice-owned, Tenant-scoped — the same boundary as `Control`/
// `RiskScoringModel`: one domain taxonomy reused across every client, not
// duplicated per engagement (the per-engagement configurable part is
// `MaturityDomainWeight` below, not the domain identity itself).
// Deliberately NOT versioned/append-only like `ControlLibraryVersion`/
// `RiskScoringModel` — DATA_MODEL.md names no such lifecycle for it, and
// inventing one would be exactly the "large production domain framework"
// instructions §4 warn against; `retire()` is simply `is_active = false`
// (never deleted, matching every other practice-content table's "never
// hard deleted" posture). A domain's own `name`/`description` remaining
// ordinarily mutable does not retroactively rewrite any already-computed
// `MaturityScore` — a score is a frozen, immutable snapshot referencing
// this row by id only (never by copying its name), same posture
// DATA_MODEL.md's own field list documents for `computed_from_control_
// test_ids` (frozen references to frozen rows, not duplicated content) —
// see DECISIONS.md for the explicit trade-off this leaves open.
export const maturityDomains = pgTable(
  "maturity_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    description: text("description"),
    code: text("code").notNull(),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    tenantCodeUnique: unique("maturity_domains_tenant_id_code_key").on(table.tenantId, table.code),
    // Consumed by `maturity_domain_weights`, `maturity_domain_control_
    // mappings`, and `maturity_scores`' composite FKs.
    idTenantUnique: unique("maturity_domains_id_tenant_id_key").on(table.id, table.tenantId),
  }),
);
