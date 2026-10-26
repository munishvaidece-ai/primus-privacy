import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Which sectors an engagement operates in (migration 0050). The sector list
// and rules live in code (lib/regulation); this stores only the choice.
export const engagementSectors = pgTable("engagement_sectors", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  sectorKey: text("sector_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
});
