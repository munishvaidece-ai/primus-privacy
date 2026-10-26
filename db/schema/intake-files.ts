import { pgTable, uuid, text, smallint, bigint, jsonb, timestamp } from "drizzle-orm/pg-core";

// Files uploaded on the guided engagement run (migration 0051).
export const intakeFiles = pgTable("intake_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  phase: smallint("phase").notNull(),
  role: text("role").notNull(),
  templateKey: text("template_key"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storagePath: text("storage_path").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  source: text("source").notNull().default("upload"),
  status: text("status").notNull().default("received"),
  validation: jsonb("validation").notNull().default({}),
  parsed: jsonb("parsed"),
  uploadedBy: uuid("uploaded_by").notNull(),
  uploadedByName: text("uploaded_by_name").notNull().default(""),
  uploadedBySide: text("uploaded_by_side").notNull().default("primus"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processedJobId: uuid("processed_job_id"),
});
