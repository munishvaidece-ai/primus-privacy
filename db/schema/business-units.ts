import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { masterDataStatusEnum } from "./enums";
import { organisations } from "./organisations";

// BusinessUnit — a subdivision of a client organisation (e.g. "Retail
// Banking", "Digital Banking", "HR"). Organisation-scoped, tenant-isolated
// via the organisation it belongs to. Per DATA_MODEL.md §5.1/§5.3: this is
// the one master-data entity with **no version table** — it is used
// structurally (which part of the client does this cover), not as a
// compliance fact asserted during an engagement, so its history isn't
// version-pinned the way System/Processor/etc. are (DATA_MODEL.md §5.3's
// explicit BusinessUnit carve-out).
//
// `parentBusinessUnitId` is the one piece of hierarchy DATA_MODEL.md §2
// already specifies (a single nullable self-reference) — not "sophisticated
// organisational hierarchy" management (Milestone 2 instructions §5), just
// the one column the approved model already calls for.
export const businessUnits = pgTable(
  "business_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    name: text("name").notNull(),
    parentBusinessUnitId: uuid("parent_business_unit_id"),
    status: masterDataStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // FK to users(id) added via ALTER TABLE in the migration SQL, per the
    // same circular-import reasoning as Milestone 1's tenants.ts.
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // Lets a future composite FK (e.g. from a junction or from
    // parent_business_unit_id itself) guarantee organisation consistency,
    // mirroring organisations_id_tenant_id_key from Milestone 1.
    idOrganisationUnique: unique("business_units_id_organisation_id_key").on(
      table.id,
      table.organisationId,
    ),
  }),
);
