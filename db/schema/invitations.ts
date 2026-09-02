import { pgTable, uuid, text, timestamp, foreignKey, unique, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { invitationStatusEnum } from "./enums";
import { tenants } from "./tenants";
import { organisations } from "./organisations";
import { engagements } from "./engagements";
import { roles } from "./roles";
import { users } from "./users";

// Invitation — P2B.1 (docs/P2B_CLIENT_INVITATION_DESIGN.md,
// docs/P2B.0.1_SECURITY_CLARIFICATIONS.md): the persistent model for
// client invitation/account provisioning. This slice is schema and
// lifecycle ONLY — no domain function, Server Action, token-generation
// logic, or SECURITY DEFINER acceptance function exists yet (those are
// later P2B slices, per the approved sequence). No `authenticated`-role
// GRANT exists on this table at all yet either (migration 0035) — the
// full `membership.manage`-based authorization layer is P2B.2's own
// scope, deliberately deferred rather than opened with an interim,
// broader-than-necessary policy this codebase's own history (migration
// 0019 → 0024's narrowing) shows is worth avoiding.
//
// Field provenance, matching the approved design's own field list
// (docs/P2B_CLIENT_INVITATION_DESIGN.md §5) with one deliberate
// omission: no `revoked_by` column — "who revoked this" is already
// captured by the generic audit trigger's own `actor_user_id`
// (identical reasoning to why `engagement_memberships`' own revoke
// path needs no dedicated column for the same fact), so adding one here
// would duplicate data the audit trail already owns, not fill a gap.
//
// tenant_id/organisation_id/engagement_id integrity is enforced
// structurally, not merely by application validation, via the same
// composite-FK pattern (`(id, organisation_id, tenant_id)` on
// `organisations`/`engagements`) every other engagement-scoped table in
// this schema already uses (remediation_actions, risks, findings,
// validation_records) — see the two composite FKs below. This makes
// "tenant A + organisation B", "organisation A + engagement B", and
// "engagement belonging to another tenant" structurally impossible to
// insert, not merely rejected by a check nobody is forced to call.
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    // Nullable — an organisation-scoped invitation (Client
    // Administrator / Privacy Officer / CXO) has no engagement at all;
    // an engagement-scoped one (Business Owner / IT-CISO / Procurement
    // / Legal) names exactly one. Never both null-and-role-mismatched —
    // that pairing is an application-layer allowlist concern (P2B.0
    // Decision 2's own reasoning: 7 known role names don't yet warrant
    // a `roles.is_client_facing`-style schema column), not enforced
    // here.
    engagementId: uuid("engagement_id").references(() => engagements.id),
    // Normalized (lower-cased) before storage — see the CHECK
    // constraint below, the database-level half of the approved
    // case-insensitive-matching requirement; the application layer
    // (a later slice) is responsible for actually lower-casing on
    // write, this CHECK is the structural guarantee that it always did.
    invitedEmail: text("invited_email").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    // SHA-256 hex digest of the raw token — the raw value itself is
    // never stored anywhere. UNIQUE as defense-in-depth (a broken RNG
    // or a bug producing two rows resolvable by the same hash would
    // otherwise make lookup-by-token ambiguous) — single-use
    // enforcement itself comes from `status`, not from this constraint.
    //
    // P2B.1.1 (migration 0036, DECISIONS.md R-159): unlike document_
    // versions.checksum_sha256 (an ordinary content-integrity
    // checksum), this column is the verifier for a bearer invitation
    // credential — the generic `log_methodology_change()` audit
    // trigger P2B.1 originally attached would have captured it openly
    // in every `audit_log.field_changes` entry. `invitations` uses its
    // own dedicated `log_invitation_change()` trigger instead, which
    // strips this one column before the row ever reaches `audit_log` —
    // every other column remains fully auditable.
    tokenHash: text("token_hash").notNull(),
    status: invitationStatusEnum("status").notNull().default("pending"),
    // Set once, at creation — a resend creates a new row with a fresh
    // expiry rather than extending this one in place (approved design
    // §6), so `expires_at` is immutable after creation, same as every
    // other identity-defining column here.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    invitedBy: uuid("invited_by").notNull(),
    acceptedUserId: uuid("accepted_user_id"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Proves organisation_id genuinely belongs to tenant_id — the
    // exact same `(id, tenant_id)` composite-FK trick `engagements`/
    // every engagement-scoped table already relies on.
    organisationTenantFk: foreignKey({
      columns: [table.organisationId, table.tenantId],
      foreignColumns: [organisations.id, organisations.tenantId],
      name: "invitations_organisation_tenant_fk",
    }),
    // Conditionally active (skipped when engagement_id is null, per
    // Postgres's own MATCH SIMPLE default for composite FKs — the
    // exact same "conditionally active" shape validation_records' own
    // triggersControlTestScopeFk/triggersAssessmentResponseScopeFk
    // already establish for a nullable composite reference). Proves,
    // when an engagement IS named, it belongs to the SAME organisation
    // and tenant this invitation itself names — structurally closing
    // every cross-tenant/cross-organisation engagement-reference risk.
    engagementOrganisationTenantFk: foreignKey({
      columns: [table.engagementId, table.organisationId, table.tenantId],
      foreignColumns: [engagements.id, engagements.organisationId, engagements.tenantId],
      name: "invitations_engagement_organisation_tenant_fk",
    }),
    // Mirrors risks.owner_id/findings.owner_id/remediation_actions.
    // owner_id/validation_records.validated_by's identical Slices
    // C3.1/C4/C5/C6 fix (DECISIONS.md R-104 et seq.): proves whoever
    // `invited_by` names belongs to this exact invitation's own tenant.
    invitedByTenantFk: foreignKey({
      columns: [table.invitedBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
      name: "invitations_invited_by_tenant_fk",
    }),
    // Conditionally active (skipped until acceptance) — the same
    // tenant-consistency proof, applied to whoever eventually accepts.
    // A structural, database-level companion to the P2B.0.1-reviewed
    // application-layer rule that an acceptor must belong to this
    // exact tenant.
    acceptedUserTenantFk: foreignKey({
      columns: [table.acceptedUserId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
      name: "invitations_accepted_user_id_tenant_fk",
    }),
    tokenHashUnique: unique("invitations_token_hash_key").on(table.tokenHash),
    // Database-level half of the approved case-insensitive-email
    // requirement (P2B.0.1 §3/§4) — guarantees `invited_email` is
    // always already normalized, so the two partial unique indexes
    // below (which key on this column directly, no `lower()` wrapper
    // needed) correctly treat `Client@Example.com` and
    // `client@example.com` as the same target.
    invitedEmailNormalizedCheck: check(
      "invitations_invited_email_normalized_check",
      sql`${table.invitedEmail} = lower(${table.invitedEmail})`,
    ),
    // The row's own internal consistency, independent of who is ever
    // authorized to cause a transition (that is P2B.3/P2B.4's own
    // scope) — mirrors validation_records' own CHECK-constraint-based
    // "structurally impossible to write a nonsensical combination"
    // discipline exactly.
    statusConsistencyCheck: check(
      "invitations_status_consistency_check",
      sql`(status = 'pending' AND accepted_at IS NULL AND accepted_user_id IS NULL AND revoked_at IS NULL)
       OR (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_user_id IS NOT NULL AND revoked_at IS NULL)
       OR (status = 'revoked' AND revoked_at IS NOT NULL AND accepted_at IS NULL AND accepted_user_id IS NULL)`,
    ),
    // At most one PENDING invitation per target — the approved design's
    // own invariant (P2B.0 Decision, approved-decisions list item 9).
    // Two separate partial indexes, not one COALESCE-to-a-sentinel-
    // value index: a plain `UNIQUE(organisation_id, engagement_id,
    // invited_email)` would NOT enforce this correctly on its own for
    // the organisation-scoped case, since standard SQL/Postgres treats
    // every NULL as distinct from every other NULL in a unique index —
    // two organisation-scoped (`engagement_id IS NULL`) pending
    // invitations to the same email would NOT collide under a plain
    // unique constraint. Splitting into two indexes, each scoped to
    // exactly one shape (`engagement_id IS NULL` / `IS NOT NULL`),
    // avoids inventing a magic sentinel value and keeps each rule
    // simple and self-documenting on its own.
    pendingOrganisationScopedUnique: uniqueIndex("invitations_pending_organisation_scoped_key")
      .on(table.organisationId, table.invitedEmail)
      .where(sql`${table.status} = 'pending' AND ${table.engagementId} IS NULL`),
    pendingEngagementScopedUnique: uniqueIndex("invitations_pending_engagement_scoped_key")
      .on(table.organisationId, table.engagementId, table.invitedEmail)
      .where(sql`${table.status} = 'pending' AND ${table.engagementId} IS NOT NULL`),
  }),
);
