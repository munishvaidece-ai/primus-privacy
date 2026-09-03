import "server-only";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { invitations, organisations, engagements, roles } from "@/db/schema";
import {
  NotFoundOrForbiddenError,
  requireInvitationManageAccess,
  isInvitationRoleAllowedForScope,
} from "@/lib/authorization/service";
import { getInvitationDeliveryAdapter } from "@/lib/domain/invitation-delivery";

// P2B.3 (Invitation Creation & Secure Token Lifecycle): the first
// domain function to actually write an `invitations` row.
// P2B.1/P2B.1.1 built the schema/audit layer; P2B.2 built the
// authorization/RLS layer (`invitations_select`/`_insert`/`_update`,
// migration 0037) and proved it entirely via direct SQL, deliberately
// without a domain function of any kind. This module is that domain
// function, reusing BOTH prior layers unchanged: every authorization
// decision below calls `lib/authorization/service.ts`'s own P2B.2
// functions (never a new check invented here), and every write below
// remains additionally, independently subject to migration 0037's own
// RLS policies (SECURITY.md §2 — the two layers must independently
// agree, not merely trust each other).
//
// Explicitly OUT of this slice's scope (P2B.3's own brief): invitation
// acceptance, account provisioning, Supabase Auth user creation,
// membership creation, a SECURITY DEFINER acceptance function, real
// email delivery, Client Portal UI. Nothing in this file creates a
// user, creates a membership, or ever writes `status = 'accepted'` —
// see `revokeInvitation` below for the one write path this slice does
// add beyond creation, which is structurally incapable of doing either
// (migration 0037's own `invitations_update` WITH CHECK requires
// `status = 'revoked'`, and `prevent_invitation_tampering`, migration
// 0035, freezes the row entirely the moment it leaves `pending`).

// --- Token lifecycle -------------------------------------------------------

// 7-day TTL — the approved design (docs/P2B_CLIENT_INVITATION_DESIGN.md
// §5a, P2B.0 approved decision 6). Computed from creation time, always;
// `invitations.status` never gains a persisted 'expired' value (db/
// schema/enums.ts's own `invitationStatusEnum` comment) — a
// still-`pending` row whose `expires_at` has passed is simply expired,
// computed at read time, not written anywhere. Nothing in this slice
// writes `expired` anywhere; the future acceptance slice (P2B.4) is
// where an expired-but-pending row is actually treated as unusable.
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 32 bytes (256 bits) of CSPRNG entropy — a bearer credential, not an
// identifier, so it gets materially more entropy than a UUID's 122 bits
// and, unlike a UUID, is generated for exactly this purpose rather than
// reused from an identifier space with its own, unrelated collision
// properties. See DECISIONS.md for why this exact size/encoding was
// chosen over rolling anything more elaborate.
const INVITATION_TOKEN_BYTES = 32;

/**
 * Generates a fresh, cryptographically random invitation token —
 * `node:crypto`'s CSPRNG (`randomBytes`, the same primitive Node's own
 * `crypto.randomUUID()` is built on), base64url-encoded (URL-safe, no
 * padding, no `/`/`+` characters that would need escaping in a URL
 * path) via Node's built-in `"base64url"` `Buffer` encoding — no new
 * dependency. Never derived from anything predictable: not `Math.
 * random()`, not a timestamp, not a UUID standing in as the secret
 * itself, not a user id, email address, or database id, and not a
 * concatenation of any of those. Exported so this slice's own tests can
 * assert on the shape/entropy of what this function actually produces —
 * never so a caller can substitute a token, which stays entirely
 * internal to `createInvitation` below.
 */
export function generateInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
}

/**
 * SHA-256 hex digest of a raw invitation token — the ONLY form of a
 * token ever written to `invitations.token_hash`. A plain one-way hash
 * (no salt/pepper) is the correct, established primitive here, not
 * `bcrypt`/`scrypt`/`argon2`: those exist to slow down brute-forcing a
 * LOW-entropy, human-chosen secret (a password) — this token already
 * carries 256 bits of CSPRNG entropy, so a fast, deterministic hash
 * (mirroring `lib/storage/evidence-storage.ts`'s own `sha256Buffer` for
 * content-integrity checksums, applied here to a bearer-credential
 * verifier instead) is the right tool: brute-forcing a 256-bit random
 * value by hash-guessing is infeasible regardless of hash speed, and a
 * deterministic hash is exactly what a future `accept_invitation()`
 * function (P2B.4) will need to compute from an incoming raw token and
 * compare, unsalted, against the single stored `token_hash` value —
 * salting would require storing the salt too, defeating comparison. Not
 * implemented here (P2B.3 does not implement acceptance) — exported so
 * P2B.4 and this slice's own tests can compute the identical hash
 * independently, never by duplicating the hashing logic.
 */
export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function buildInvitationUrl(rawToken: string): string {
  // No existing base-URL convention exists anywhere in this codebase
  // (grepped fresh this slice — only NEXT_PUBLIC_SUPABASE_URL exists,
  // an unrelated concern). NEXT_PUBLIC_APP_URL is the smallest new one,
  // following the same "public, safe to expose, documented in
  // .env.example" convention that variable already establishes;
  // defaults to localhost for local/dev use so this function works with
  // zero configuration. `/invite/<token>` is a conceptual, NOT YET
  // ROUTED path (P2B.3 does not implement the acceptance route) — no
  // tenant/organisation/engagement identifier, and no PII, appears
  // anywhere in it; the token alone is the only thing an acceptance
  // route will ever need to look up the invitation by its hash.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${baseUrl}/invite/${rawToken}`;
}

// --- Errors ------------------------------------------------------------

export class InvalidInvitationRoleError extends Error {
  constructor(message = "This role is not valid for the requested invitation scope.") {
    super(message);
    this.name = "InvalidInvitationRoleError";
  }
}

export class DuplicatePendingInvitationError extends Error {
  constructor(message = "A pending invitation already exists for this email address at this scope.") {
    super(message);
    this.name = "DuplicatePendingInvitationError";
  }
}

export class InvitationNotPendingError extends Error {
  constructor(message = "Only a pending invitation can be revoked.") {
    super(message);
    this.name = "InvitationNotPendingError";
  }
}

// --- Scope resolution ----------------------------------------------------

/** Confirms the Organisation exists, returning its own authoritative
 * `tenant_id` — never trusted from the caller (module docstring; this
 * is the ONLY source of `tenant_id` this module ever uses). Mirrors
 * `lib/domain/engagement-memberships.ts`'s own
 * `loadAuthoritativeEngagement` and `lib/domain/evidence.ts`'s own
 * `resolveEngagementScope` — the same "resolve scope from the database
 * row, not from what the caller claims" discipline applied one level
 * higher, for the organisation-scoped invitation case where there is no
 * Engagement row to resolve from at all. */
async function loadAuthoritativeOrganisation(db: RequestDb, organisationId: string): Promise<{ id: string; tenantId: string }> {
  const [row] = await db
    .select({ id: organisations.id, tenantId: organisations.tenantId })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  if (!row) throw new NotFoundOrForbiddenError();
  return row;
}

/** Confirms the Engagement exists AND genuinely belongs to the claimed
 * Organisation — rejecting a mismatched organisation/engagement pair
 * (P2B.3 §9/§F) with the same single check
 * `loadAuthoritativeEngagement` (engagement-memberships.ts) already
 * uses, applied here. Because `organisationId` was itself already
 * resolved to a real row belonging to exactly one tenant
 * (`loadAuthoritativeOrganisation`), an Engagement genuinely belonging
 * to a DIFFERENT tenant necessarily also belongs to a different
 * Organisation id — so this one check structurally closes the
 * cross-tenant-engagement case too, with no separate tenant comparison
 * needed (the same reasoning `loadAuthoritativeEngagement` itself
 * relies on). The database's own composite FK
 * (`invitations_engagement_organisation_tenant_fk`, migration 0034)
 * remains the real, structural backstop regardless — this check exists
 * only to turn what would otherwise be a raw foreign-key violation into
 * a clean `NotFoundOrForbiddenError` before any insert is attempted. */
async function loadAuthoritativeEngagement(
  db: RequestDb,
  engagementId: string,
  organisationId: string,
): Promise<{ id: string; tenantId: string; organisationId: string }> {
  const [row] = await db
    .select({ id: engagements.id, tenantId: engagements.tenantId, organisationId: engagements.organisationId })
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);
  if (!row || row.organisationId !== organisationId) throw new NotFoundOrForbiddenError();
  return row;
}

// --- createInvitation ------------------------------------------------------

export interface CreateInvitationInput {
  organisationId: string;
  /** `null` = organisation-scoped invitation. A real id = engagement-
   * scoped. Never inferred — the caller states which kind of invitation
   * this is, exactly as `canManageInvitation`'s own dispatcher
   * (lib/authorization/service.ts) already expects. */
  engagementId: string | null;
  invitedEmail: string;
  roleId: string;
}

/**
 * Creates a pending invitation and hands its one-time raw token to the
 * delivery boundary (`lib/domain/invitation-delivery.ts`) — the
 * complete write path this slice adds. Every security-sensitive field
 * (`tenant_id`, `invited_by`, `status`, `token_hash`, `expires_at`,
 * `created_at`, `accepted_user_id`, `accepted_at`, `revoked_at`) is
 * entirely server-controlled below; `CreateInvitationInput` above names
 * exactly the four fields a caller may actually choose
 * (`organisationId`/`engagementId`/`invitedEmail`/`roleId`), and even
 * those are independently re-validated against the database and the
 * approved role allowlist before anything is written — never trusted
 * merely because a browser form or Server Action passed them through.
 *
 * Order of operations, each closing one specific attack this slice's
 * own security review considered:
 *
 * 1. Resolve the Organisation (and Engagement, if scoped) from their
 *    OWN database rows — `tenant_id` is derived exclusively from the
 *    Organisation's own row, never accepted as an input at all (no
 *    `tenantId` field exists on `CreateInvitationInput`). A mismatched
 *    organisation/engagement pair, or an engagement genuinely belonging
 *    to a different tenant, is rejected here with a clean
 *    `NotFoundOrForbiddenError` (see `loadAuthoritativeEngagement`).
 * 2. Authorize via `requireInvitationManageAccess` — the EXACT P2B.2
 *    dispatcher (organisation-level `membership.manage` only for an
 *    organisation-scoped invitation; the existing engagement-OR-
 *    organisation-level rule, reused unchanged, for an engagement-
 *    scoped one). No new authorization model.
 * 3. Resolve the requested Role and check it against
 *    `isInvitationRoleAllowedForScope` (lib/authorization/service.ts) —
 *    the SAME allowlist migration 0037's own `invitations_insert` RLS
 *    policy independently enforces. A nonexistent role id, or a role
 *    valid for the WRONG scope (an engagement-scope role on an
 *    organisation-scoped invitation, or vice versa), is rejected with a
 *    clean `InvalidInvitationRoleError` before any insert is attempted
 *    — a malicious caller cannot escalate merely by supplying a
 *    different `role_id`; RLS remains the independent backstop
 *    regardless. (This project's `roles` table carries no "active/
 *    inactive" flag at all — the allowlist check above is the entire
 *    gate; a role either belongs to the approved allowlist for this
 *    scope or it does not.)
 * 4. Normalize `invitedEmail` — trim + lowercase, matching the
 *    database's own `invitations_invited_email_normalized_check`
 *    (migration 0034) exactly, so the CHECK constraint always passes
 *    and the two partial unique indexes always compare correctly.
 * 5. Best-effort duplicate precheck (an ordinary RLS-scoped SELECT,
 *    visible to this caller precisely because step 2 already proved
 *    they hold `membership.manage` over this exact scope — the same
 *    "RLS-scoped, best-effort, not race-safe on its own" duplicate
 *    check `createOrganisation`/`createEngagement` already use for
 *    their own name-uniqueness checks) for a clean
 *    `DuplicatePendingInvitationError` in the common case; the
 *    database's own partial unique indexes
 *    (`invitations_pending_organisation_scoped_key`/`_engagement_
 *    scoped_key`, migration 0034) remain the real, race-safe backstop —
 *    caught explicitly below and turned into the same clean error.
 * 6. Generate the raw token, hash it, and insert — `token_hash` is the
 *    ONLY form of the token this step ever writes; `status` is left to
 *    its own schema default (`'pending'`), and `accepted_user_id`/
 *    `accepted_at`/`revoked_at` are never set at all (NULL by column
 *    default) — there is no code path here, or anywhere else in this
 *    slice, that can produce a row that appears accepted or revoked at
 *    creation.
 * 7. Hand the raw token — embedded in a `/invite/<token>` URL, never as
 *    `token_hash` — to `getInvitationDeliveryAdapter().deliver(...)`.
 *    This call happens INSIDE the same `withRequestDb` transaction the
 *    caller already wrapped this function in (lib/db/request-client.ts
 *    commits only once this whole function returns without throwing):
 *    if delivery preparation throws, the invitation row itself is
 *    rolled back rather than left as an orphaned, undeliverable
 *    invitation nobody will ever be told about — the smallest safe
 *    transactional boundary for this MVP slice, not a new outbox/event
 *    system.
 *
 * Returns only `{ id }` — the same minimal shape `createOrganisation`/
 * `createEngagement` already return, deliberately not the full row (and
 * never the raw token or its hash): whichever future Server
 * Action/UI needs more can re-read the row it already knows the id of,
 * subject to the same `invitations_select` RLS this function's own
 * caller already satisfies by construction (step 2 above).
 */
export async function createInvitation(db: RequestDb, userId: string, input: CreateInvitationInput): Promise<{ id: string }> {
  const organisation = await loadAuthoritativeOrganisation(db, input.organisationId);
  const engagement =
    input.engagementId === null ? null : await loadAuthoritativeEngagement(db, input.engagementId, organisation.id);

  await requireInvitationManageAccess(db, userId, organisation.id, input.engagementId);

  const [role] = await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.id, input.roleId)).limit(1);
  if (!role || !isInvitationRoleAllowedForScope(role.name, input.engagementId)) {
    throw new InvalidInvitationRoleError();
  }

  const invitedEmail = input.invitedEmail.trim().toLowerCase();

  const duplicateScope =
    input.engagementId === null
      ? and(eq(invitations.organisationId, organisation.id), isNull(invitations.engagementId), eq(invitations.invitedEmail, invitedEmail), eq(invitations.status, "pending"))
      : and(eq(invitations.organisationId, organisation.id), eq(invitations.engagementId, input.engagementId), eq(invitations.invitedEmail, invitedEmail), eq(invitations.status, "pending"));
  const [duplicate] = await db.select({ id: invitations.id }).from(invitations).where(duplicateScope).limit(1);
  if (duplicate) throw new DuplicatePendingInvitationError();

  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  try {
    await db.insert(invitations).values({
      id,
      tenantId: organisation.tenantId,
      organisationId: organisation.id,
      engagementId: engagement?.id ?? null,
      invitedEmail,
      roleId: role.id,
      tokenHash,
      expiresAt,
      invitedBy: userId,
    });
  } catch (err) {
    if (err instanceof Error && /invitations_pending_(organisation|engagement)_scoped_key/.test(err.message)) {
      throw new DuplicatePendingInvitationError();
    }
    throw err;
  }

  // The raw token exists only in this local scope from here on — never
  // assigned to a variable that outlives this call, never logged, never
  // part of this function's own return value.
  await getInvitationDeliveryAdapter().deliver({
    invitationId: id,
    invitedEmail,
    invitationUrl: buildInvitationUrl(rawToken),
    expiresAt,
  });

  return { id };
}

// --- listInvitations ---------------------------------------------------

export interface InvitationRow {
  id: string;
  invitedEmail: string;
  roleId: string;
  status: string;
  expiresAt: Date;
  invitedBy: string;
  createdAt: Date;
  revokedAt: Date | null;
  acceptedAt: Date | null;
}

/**
 * The invitation roster for ONE exact scope (an organisation-scoped
 * list, or one specific engagement's list — never "everything this
 * actor can manage across the tenant," which would be a materially
 * larger feature this slice does not build). Requires the SAME
 * `membership.manage` authority `createInvitation`/`revokeInvitation`
 * require (P2B.3 §13's own explicit requirement — list/read stays
 * restricted to `membership.manage` actors, matching P2B.2's own
 * `invitations_select` RLS policy exactly, never the broader "any
 * member of this scope" shape other list functions in this codebase
 * use). `token_hash` is never selected at all — not merely omitted from
 * the returned shape — so there is no risk of a future refactor
 * accidentally exposing it through this path.
 */
export async function listInvitations(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string | null },
): Promise<InvitationRow[]> {
  const organisation = await loadAuthoritativeOrganisation(db, input.organisationId);
  if (input.engagementId !== null) {
    await loadAuthoritativeEngagement(db, input.engagementId, organisation.id);
  }
  await requireInvitationManageAccess(db, userId, organisation.id, input.engagementId);

  const scope =
    input.engagementId === null
      ? and(eq(invitations.organisationId, organisation.id), isNull(invitations.engagementId))
      : and(eq(invitations.organisationId, organisation.id), eq(invitations.engagementId, input.engagementId));

  const rows = await db
    .select({
      id: invitations.id,
      invitedEmail: invitations.invitedEmail,
      roleId: invitations.roleId,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      invitedBy: invitations.invitedBy,
      createdAt: invitations.createdAt,
      revokedAt: invitations.revokedAt,
      acceptedAt: invitations.acceptedAt,
    })
    .from(invitations)
    .where(scope)
    .orderBy(invitations.createdAt);

  return rows;
}

// --- revokeInvitation ----------------------------------------------------

export interface RevokeInvitationInput {
  organisationId: string;
  engagementId: string | null;
  invitationId: string;
}

/**
 * Revokes a pending invitation — `pending -> revoked`, the ONE
 * transition migration 0037's own `invitations_update` RLS policy
 * permits an ordinary `membership.manage` actor to reach at all (its
 * own WITH CHECK requires `status = 'revoked'` specifically —
 * DECISIONS.md R-163). This function cannot be used to simulate
 * acceptance in any way: it only ever writes `status = 'revoked'` plus
 * `revoked_at`, never touches `accepted_user_id`/`accepted_at`, and the
 * RLS policy underneath would reject any attempt to write a different
 * status regardless of what this function's own code does.
 *
 * Scope is re-derived from the invitation row's OWN `organisation_id`/
 * `engagement_id` — the caller's `organisationId`/`engagementId` inputs
 * are checked to MATCH the row's own authoritative values (mirroring
 * `revokeEngagementMember`'s identical "confirm the claimed scope
 * matches the row's own" pattern) rather than trusted to select the
 * row; a mismatch is rejected as not-found, never silently corrected.
 * `requireInvitationManageAccess` is then re-checked against the row's
 * own authoritative scope, not the caller's claim.
 *
 * Idempotent for an already-revoked invitation (silent no-op — the same
 * "a redundant safe action shouldn't be treated as a failure" posture
 * `revokeEngagementMember` already established). An invitation that has
 * already transitioned to `accepted` is REJECTED with
 * `InvitationNotPendingError`, never silently accepted as success and
 * never attempted as a write — migration 0035's own
 * `prevent_invitation_tampering` trigger would reject that write
 * outright regardless (the entire row is frozen once `status` leaves
 * `'pending'`), but this function checks first so the caller gets a
 * clean, specific error instead of a raw trigger exception.
 */
export async function revokeInvitation(db: RequestDb, userId: string, input: RevokeInvitationInput): Promise<void> {
  const [invitation] = await db
    .select({
      id: invitations.id,
      organisationId: invitations.organisationId,
      engagementId: invitations.engagementId,
      status: invitations.status,
    })
    .from(invitations)
    .where(eq(invitations.id, input.invitationId))
    .limit(1);
  if (!invitation || invitation.organisationId !== input.organisationId || invitation.engagementId !== input.engagementId) {
    throw new NotFoundOrForbiddenError();
  }

  await requireInvitationManageAccess(db, userId, invitation.organisationId, invitation.engagementId);

  if (invitation.status === "revoked") return; // idempotent
  if (invitation.status !== "pending") throw new InvitationNotPendingError();

  await db
    .update(invitations)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(invitations.id, invitation.id));
}
