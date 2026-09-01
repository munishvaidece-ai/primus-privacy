import { pgTable, uuid, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { maturityDomains } from "./maturity-domains";
import { controls } from "./control-library";

// MaturityDomainControlMapping — which Controls feed which domain's
// score (DATA_MODEL.md §9: "MaturityDomain × Control"). Insert/delete
// only, like every junction table since Milestone 3 (DECISIONS.md R-35).
// Both sides are Tenant-scoped practice methodology, mirroring
// `RiskControl`'s own Control-half exactly (Milestone 7, risk-links.ts).
//
// Deliberately NOT gated by any finalization/draft-mutable trigger, and
// not itself consulted live when reading a historical `MaturityScore` —
// each `MaturityScore` row already carries its own frozen
// `computed_from_control_test_ids` (DATA_MODEL.md §9's own traceability
// field), recording exactly which ControlTest rows a given score was
// actually computed from at the time. A later change to this mapping
// (adding/removing which Controls feed a domain) affects only *future*
// computations, never rewrites which tests a historical score already
// traces to — see DECISIONS.md.
export const maturityDomainControlMappings = pgTable(
  "maturity_domain_control_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    maturityDomainId: uuid("maturity_domain_id").notNull(),
    controlId: uuid("control_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => ({
    maturityDomainTenantFk: foreignKey({
      columns: [table.maturityDomainId, table.tenantId],
      foreignColumns: [maturityDomains.id, maturityDomains.tenantId],
      name: "maturity_domain_control_mappings_maturity_domain_tenant_fk",
    }),
    controlTenantFk: foreignKey({
      columns: [table.controlId, table.tenantId],
      foreignColumns: [controls.id, controls.tenantId],
      name: "maturity_domain_control_mappings_control_tenant_fk",
    }),
    noDuplicateMapping: unique(
      "maturity_domain_control_mappings_maturity_domain_id_control_id_key",
    ).on(table.maturityDomainId, table.controlId),
  }),
);
