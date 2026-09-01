import { pgTable, uuid, text, integer, bigint, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import { documentStatusEnum, documentTypeEnum, documentVersionScanStatusEnum } from "./enums";
import { tenants } from "./tenants";
import { organisations } from "./organisations";
import { users } from "./users";

// Document — the logical/stable identity of an uploaded artifact (e.g.
// "ABC Financial's Information Security Policy"), analogous in shape to
// every master-data identity table since Milestone 2: a stable id,
// mutable descriptive fields, never deleted (only archived).
//
// DATA_MODEL.md §4 defines a single `Document` entity — "storage_path,
// filename, mime_type, size, uploaded_by" — with no separate version
// concept. Read literally, that field list describes exactly ONE
// uploaded file, not a logical document that can be re-uploaded over
// time. Milestone 6's own CORE PRINCIPLE requires exactly this split
// ("Document → Document Version... A new file upload must create a new
// version, never overwrite an existing one"), so this milestone splits
// DATA_MODEL.md's `Document` into two tables: `documents` (this table —
// the stable logical identity, newly carrying the tenant/organisation/
// engagement/title/type/owner/status metadata Milestone 6 instructions
// §3 require and DATA_MODEL.md's current entry doesn't yet have) and
// `document_versions` below (which carries DATA_MODEL.md's original
// field list verbatim — storage_path/filename/mime_type/size/uploaded_by
// — since that is what those fields were actually describing: one
// specific immutable upload). See DECISIONS.md for the full reasoning;
// this is additive clarification of an underspecified entity, not a
// competing model (Milestone 6 instructions §2's own escape valve).
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    // Nullable — "engagement where applicable" (Milestone 6 instructions
    // §3), mirroring Evidence's own nullable engagement_id (DATA_MODEL.md
    // §4, DECISIONS.md R-14): a document collected outside any formal
    // engagement (e.g. an ongoing vendor's policy library) has none.
    engagementId: uuid("engagement_id"),

    title: text("title").notNull(),
    documentType: documentTypeEnum("document_type").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    status: documentStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // FK to users(id) added via ALTER TABLE in the migration SQL — same
    // circular-import reasoning as every audit column since tenants.ts.
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // Consumed by `document_versions`' always-active composite FK.
    idTenantOrganisationUnique: unique("documents_id_tenant_id_organisation_id_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
    ),
    // Consumed by `document_versions`' engagement-conditional FK (skipped
    // when the version's own `engagement_id` is null — see the file
    // comment on `documentVersions` below).
    idEngagementUnique: unique("documents_id_engagement_id_key").on(
      table.id,
      table.engagementId,
    ),
  }),
);

// DocumentVersion — one specific, immutable uploaded file (DATA_MODEL.md
// §4's original `Document` field list: storage_path, filename, mime_type,
// size, uploaded_by — plus `version_number`, a cryptographic checksum,
// `uploaded_at`, and `scan_status`, all named by Milestone 6 instructions
// §4/§10). Immutable after creation in every field except `scan_status`
// (migration's immutability trigger) — a new upload always creates a new
// row; nothing here is ever overwritten (instructions §4/§14).
//
// Storage is a technical-metadata reference only: `storage_path` is an
// object key/path, never a public URL, and no file content is stored in
// PostgreSQL (instructions §3/§9) — see DECISIONS.md for the storage
// architecture actually exercised this milestone (D-03 is unresolved, so
// no real Supabase Storage project exists; this table is the DB-layer
// abstraction instructions §9 explicitly permits building instead).
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").notNull(),
    // Denormalized from the owning Document (tenant/organisation always;
    // engagement only when the Document itself is engagement-scoped) —
    // every column this table's own RLS policies and Evidence's
    // composite FK need directly on the row.
    tenantId: uuid("tenant_id").notNull(),
    organisationId: uuid("organisation_id").notNull(),
    engagementId: uuid("engagement_id"),

    // Trigger-assigned (migration SQL) — starts at 1 per document and
    // increments monotonically; the application never sets this
    // directly, so it cannot be spoofed or reused to overwrite an
    // earlier version's slot.
    versionNumber: integer("version_number").notNull(),
    storagePath: text("storage_path").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    scanStatus: documentVersionScanStatusEnum("scan_status").notNull().default("pending"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // `updated_at`/`updated_by` exist only to record the one legitimate
    // exception to immutability — a `scan_status` transition — not for
    // ordinary edits (migration's immutability trigger blocks everything
    // else).
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // Always active: this version's Document really belongs to this
    // version's Tenant/Organisation — cross-tenant/cross-organisation
    // reference is impossible regardless of engagement scoping.
    documentTenantOrganisationFk: foreignKey({
      columns: [table.documentId, table.tenantId, table.organisationId],
      foreignColumns: [documents.id, documents.tenantId, documents.organisationId],
      name: "document_versions_document_tenant_organisation_fk",
    }),
    // Conditionally active (skipped when this version's own
    // `engagement_id` is null, under Postgres's default MATCH SIMPLE
    // semantics — the same discipline used throughout this project):
    // when set, ties it to the Document's own real `engagement_id`, so a
    // version can never claim an engagement its Document doesn't have.
    documentEngagementFk: foreignKey({
      columns: [table.documentId, table.engagementId],
      foreignColumns: [documents.id, documents.engagementId],
      name: "document_versions_document_engagement_fk",
    }),
    versionNumberUnique: unique("document_versions_document_id_version_number_key").on(
      table.documentId,
      table.versionNumber,
    ),
    // Consumed by `evidence`'s composite FKs (the exact "Evidence belongs
    // to Organisation A; its linked DocumentVersion must belong to
    // Organisation A" invariant — Milestone 6 instructions §15).
    idTenantOrganisationUnique: unique(
      "document_versions_id_tenant_id_organisation_id_key",
    ).on(table.id, table.tenantId, table.organisationId),
    idEngagementUnique: unique("document_versions_id_engagement_id_key").on(
      table.id,
      table.engagementId,
    ),
  }),
);
