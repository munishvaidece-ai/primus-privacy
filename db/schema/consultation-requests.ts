import { pgTable, uuid, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

// "Connect with us" requests for a 30 minute consultation (migration 0053).
// Keeps what the person typed plus the notice version and consent text they
// were shown, so Primus can show later what they were told and agreed to.
export const consultationRequests = pgTable("consultation_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  submittedBy: uuid("submitted_by").notNull(),
  organisationName: text("organisation_name").notNull(),
  sectorKey: text("sector_key"),
  employeeBand: text("employee_band"),
  website: text("website"),
  contactName: text("contact_name").notNull(),
  contactDesignation: text("contact_designation").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactMobile: text("contact_mobile").notNull(),
  topics: jsonb("topics").notNull().default([]),
  preferredTime: text("preferred_time"),
  note: text("note"),
  submitterIsContact: boolean("submitter_is_contact").notNull(),
  noticeVersion: text("notice_version").notNull(),
  consentText: text("consent_text").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("new"),
  handledBy: uuid("handled_by"),
  handledAt: timestamp("handled_at", { withTimezone: true }),
  internalNote: text("internal_note"),
  emailStatus: text("email_status").notNull().default("pending"),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
