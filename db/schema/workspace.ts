// Workspace and client-portal tables (migrations 0046-0048). See DECISIONS.md R-191..R-199.
import { pgTable, uuid, text, jsonb, boolean, integer, date, timestamp, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id"),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const engagementActivity = pgTable("engagement_activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  actorUserId: uuid("actor_user_id"),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  clientVisible: boolean("client_visible").notNull().default(false),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const engagementTasks = pgTable("engagement_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  kind: text("kind").notNull().default("task"),
  title: text("title").notNull(),
  description: text("description"),
  assigneeSide: text("assignee_side").notNull(),
  assigneeUserId: uuid("assignee_user_id"),
  dueDate: date("due_date"),
  status: text("status").notNull().default("open"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
});

export const clarifications = pgTable("clarifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  reference: text("reference"),
  subject: text("subject").notNull(),
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  status: text("status").notNull().default("open"),
  raisedBy: uuid("raised_by").notNull(),
  raisedBySide: text("raised_by_side").notNull(),
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: uuid("closed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clarificationMessages = pgTable("clarification_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  clarificationId: uuid("clarification_id").notNull(),
  authorId: uuid("author_id").notNull(),
  authorSide: text("author_side").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceRequests = pgTable("evidence_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  reference: text("reference"),
  title: text("title").notNull(),
  description: text("description"),
  questionRef: text("question_ref"),
  status: text("status").notNull().default("requested"),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  fulfilledEvidenceId: uuid("fulfilled_evidence_id"),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  fulfilledBy: uuid("fulfilled_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const engagementDiscovery = pgTable("engagement_discovery", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull().unique(),
  status: text("status").notNull().default("in_progress"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedBy: uuid("submitted_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const discoverySections = pgTable("discovery_sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  sectionKey: text("section_key").notNull(),
  answers: jsonb("answers").notNull().default({}),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});

export const reportReleases = pgTable("report_releases", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  engagementId: uuid("engagement_id").notNull(),
  title: text("title").notNull(),
  reportType: text("report_type").notNull().default("engagement_report"),
  version: integer("version").notNull().default(1),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull().default("application/pdf"),
  sizeBytes: integer("size_bytes").notNull(),
  content: bytea("content").notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
  releasedBy: uuid("released_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
