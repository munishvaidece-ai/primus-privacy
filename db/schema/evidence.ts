import { pgTable, uuid, text, timestamp, foreignKey, unique } from "drizzle-orm/pg-core";
import {
  evidenceTypeEnum,
  evidenceQualityRatingEnum,
  evidenceVisibilityEnum,
  evidenceReviewStatusEnum,
} from "./enums";
import { tenants } from "./tenants";
import { organisations } from "./organisations";
import { documentVersions } from "./documents";
import { users } from "./users";

// Evidence — the compliance meaning of a stored DocumentVersion: what it
// evidences, its quality/classification, and its visibility (DATA_MODEL.md
// §4). `organisation_id` (DATA_MODEL.md's `client_org_id`, per the
// project's established naming convention since Milestone 1) is always
// required; `engagement_id` is nullable — populated when evidence was
// collected during a specific engagement's assessment work, left null for
// evidence attached directly at the client-organisation level (e.g. a
// signed DPA collected during ongoing vendor management outside any
// formal engagement) — DATA_MODEL.md §4, DECISIONS.md R-14.
//
// Fields match DATA_MODEL.md §4: `client_org_id`→`organisationId`,
// `engagement_id`, `title`, `evidence_type`, `quality_rating`,
// `visibility`, `collected_at`. `document_id` is implemented as
// `documentVersionId` — DATA_MODEL.md's `Document` was split into
// `Document`/`DocumentVersion` this milestone (documents.ts), and
// Milestone 6 instructions §5/§8's own historical-immutability
// requirement makes clear Evidence must pin to one specific, immutable
// version, not "whichever version is current" — see DECISIONS.md.
// `description`, `review_status`, `reviewed_by`, `reviewed_at`,
// `review_rationale`, `valid_until` are additive: Milestone 6
// instructions §5/§13 require an evidence review lifecycle (reviewer,
// review date, decision, rationale, expiry) that DATA_MODEL.md's current
// field list does not yet name — a genuine implementation clarification,
// not an invented complex workflow (exactly instructions §13's four
// states, no more — see DECISIONS.md).
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    engagementId: uuid("engagement_id"),
    documentVersionId: uuid("document_version_id").notNull(),

    title: text("title").notNull(),
    description: text("description"),
    evidenceType: evidenceTypeEnum("evidence_type").notNull(),
    qualityRating: evidenceQualityRatingEnum("quality_rating"),
    // Defaults to the more restrictive value — visibility must be
    // explicitly widened to client_visible, never accidentally left
    // permissive (SECURITY.md §2/§5's existing CONSULTANT_INTERNAL/
    // CLIENT_VISIBLE model, unchanged — see DECISIONS.md for why this
    // column is not itself an RLS condition).
    visibility: evidenceVisibilityEnum("visibility").notNull().default("consultant_internal"),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),

    reviewStatus: evidenceReviewStatusEnum("review_status").notNull().default("pending_review"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewRationale: text("review_rationale"),
    // "Validity/expiry information where defined" (instructions §5) — a
    // single nullable expiry timestamp, not a renewal workflow.
    validUntil: timestamp("valid_until", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (table) => ({
    // The database-enforced version of Milestone 6 instructions §15's own
    // example: "Evidence belongs to Organisation A. Its linked
    // DocumentVersion must belong to Organisation A." Always active
    // (organisation_id is never null on either side).
    documentVersionOrganisationFk: foreignKey({
      columns: [table.documentVersionId, table.tenantId, table.organisationId],
      foreignColumns: [documentVersions.id, documentVersions.tenantId, documentVersions.organisationId],
      name: "evidence_document_version_organisation_fk",
    }),
    // Conditionally active (skipped when Evidence itself has no
    // engagement — the standalone case): when Evidence IS engagement-
    // scoped, its DocumentVersion must carry that exact same
    // engagement_id too — a client-org-level Document can't silently
    // masquerade as this specific engagement's evidence.
    documentVersionEngagementFk: foreignKey({
      columns: [table.documentVersionId, table.engagementId],
      foreignColumns: [documentVersions.id, documentVersions.engagementId],
      name: "evidence_document_version_engagement_fk",
    }),
    // Consumed by `evidence_links`' composite FKs.
    idTenantOrganisationUnique: unique("evidence_id_tenant_id_organisation_id_key").on(
      table.id,
      table.tenantId,
      table.organisationId,
    ),
    idEngagementUnique: unique("evidence_id_engagement_id_key").on(table.id, table.engagementId),
  }),
);
