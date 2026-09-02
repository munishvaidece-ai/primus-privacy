import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { engagements, engagementMemberships, roles } from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess, requireEngagementMembershipManageAccess } from "@/lib/authorization/service";

// Slice C7.2 (the C7 review's own second P0 finding, instructions §4):
// the domain module that makes an Engagement genuinely multi-user.
// Before this slice, `createEngagement`/`createOrganisation` (Slices
// B1/B2) granted membership only to their own creator — no function
// anywhere in this codebase could add a second user to an Engagement or
// Organisation without a raw database script. Manages EngagementMembership
// only (existing, already-eligible users — no invitation/registration
// system, per instructions §28). See lib/authorization/service.ts's own
// `canManageEngagementMembership`/`hasEngagementPermission`/
// `hasOrganisationPermission` for the authorization rule this module
// gates every mutation on, and migration 0024 for the matching RLS
// layer.

export class InvalidEngagementRoleError extends Error {
  constructor(message = "Invalid engagement role.") {
    super(message);
    this.name = "InvalidEngagementRoleError";
  }
}

export class IneligibleUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IneligibleUserError";
  }
}

export class DuplicateMembershipError extends Error {
  constructor(message = "This user already has an active membership on this engagement.") {
    super(message);
    this.name = "DuplicateMembershipError";
  }
}

export interface EngagementRoleOption {
  id: string;
  name: string;
}

/**
 * The Add Member form's own role dropdown source (instructions §7): only
 * `Role` rows whose `scope = 'engagement'` — never a Tenant- or
 * Organisation-scoped role, which `roles.ts`'s own schema comment names
 * as structurally inappropriate here regardless ("a role is only ever
 * granted via the membership table matching its scope"). `roles` is
 * global reference/taxonomy data, readable by any authenticated user
 * (migration 0001) — no additional authorization check is needed to
 * read it, matching `lib/domain/roles.ts`'s own identical posture.
 */
export async function listEngagementRoles(db: RequestDb): Promise<EngagementRoleOption[]> {
  const rows = await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.scope, "engagement")).orderBy(asc(roles.name));
  return rows;
}

export interface EngagementMemberRow {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  roleName: string;
  status: string;
  createdAt: Date;
}

/**
 * The full membership roster for one Engagement (instructions §16) —
 * every EngagementMembership row, active and revoked, showing each
 * one's own history rather than only the current active set (mirrors
 * this project's own established "show status honestly, never collapse
 * history" posture — e.g. ValidationRecord's full history, Slice C6).
 * Readable by ANY engagement member (still independently re-checked via
 * `requireEngagementAccess` here first), not only someone who can
 * manage it — seeing who else is on the engagement is ordinary,
 * non-sensitive information, the same as the Organisation detail page's
 * own read-only member list (Slice B1).
 *
 * **Reads via `engagement_membership_roster` (migration 0024), not a
 * plain `users` JOIN — a real gap this slice's own testing found:**
 * `shares_membership_scope`'s own engagement-membership branch requires
 * BOTH sides' membership to be `status = 'active'` (migration 0001) —
 * the moment a member is revoked, an ordinary `JOIN users` roster query
 * silently loses their row purely as an RLS side effect, contradicting
 * this project's own "never collapse history" posture. The SECURITY
 * DEFINER function re-checks `can_access_engagement` internally, the
 * same rule `requireEngagementAccess` already enforces at the
 * application layer just above — belt and suspenders, not a
 * replacement for it.
 */
export async function listEngagementMembers(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string },
): Promise<EngagementMemberRow[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);

  const result = await db.execute<{
    id: string;
    user_id: string;
    email: string;
    display_name: string | null;
    role_name: string;
    status: string;
    created_at: Date;
  }>(sql`SELECT id, user_id, email, display_name, role_name, status, created_at FROM public.engagement_membership_roster(${input.engagementId})`);

  return result.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    roleName: r.role_name,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export interface EligibleUserRow {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * The Add Member form's own candidate list (instructions §5/§17): only
 * users legitimately eligible to join THIS Engagement, resolved
 * entirely from the existing `users.tenant_id`/`users.client_org_id`
 * model (instructions §6/§11) — never invented. `users.ts`'s own file
 * comment states the rule directly: "Practice-side (PRIMUS) users have
 * `client_org_id = NULL`... client-side users have it set." A
 * PRIMUS-side (tenant-wide) user is eligible for any Engagement in
 * their own tenant — this is the existing, intended shape of
 * cross-organisation consultant staffing (SECURITY.md §3: a consultant
 * "get[s] it only through an explicit EngagementMembership... on a
 * specific client," with no organisation-membership prerequisite named
 * anywhere). A client-side user is eligible ONLY for Engagements under
 * their own one client Organisation — DATA_MODEL.md/ARCHITECTURE.md's
 * own explicit organisation-isolation rule ("client users... cannot see
 * another client's data under any role"), which this function enforces
 * at the application layer since no RLS policy encodes this specific
 * business rule (SECURITY.md §2: RLS is the coarser tenant/scope
 * backstop, not a fit for this kind of dynamic, cross-cutting rule).
 * Suspended users (`users.status = 'suspended'`) and users already
 * holding an active membership on this Engagement are excluded — no
 * search engine, one bounded query (instructions §17: "if the eligible
 * user set can be safely listed without pagination... use one query" —
 * this project's own current scale never needs more).
 *
 * **Reads via `eligible_engagement_members` (migration 0024), not a
 * plain `users` query — a real gap this slice's own testing found, not
 * assumed:** `users_select`'s own RLS policy (migration 0001) is
 * `id = auth.uid() OR shares_membership_scope(id)` — a caller can only
 * see a user's row if they ALREADY share a membership with them. A
 * candidate who isn't yet on this Engagement (the entire point of this
 * screen) is therefore structurally invisible to a plain `SELECT ...
 * FROM users` under RLS. `eligible_engagement_members` is a SECURITY
 * DEFINER function built specifically to resolve this — not a widening
 * of `users_select` itself (which would let any authenticated user
 * browse their whole tenant's user directory, a materially broader,
 * unrelated capability this slice does not introduce) — and it
 * independently re-checks `membership.manage` internally before
 * returning any row, the same "authorize inside the function, not only
 * in the calling code" discipline every SECURITY DEFINER function in
 * this project already follows.
 */
export async function listEligibleUsersForEngagement(
  db: RequestDb,
  userId: string,
  input: { organisationId: string; engagementId: string },
): Promise<EligibleUserRow[]> {
  const engagement = await loadAuthoritativeEngagement(db, input.engagementId, input.organisationId);
  await requireEngagementMembershipManageAccess(db, userId, engagement.id, engagement.organisationId);

  const result = await db.execute<{ id: string; email: string; display_name: string | null }>(
    sql`SELECT id, email, display_name FROM public.eligible_engagement_members(${engagement.id})`,
  );

  return result.rows.map((r) => ({ id: r.id, email: r.email, displayName: r.display_name }));
}

/** Confirms the Engagement exists and belongs to the claimed
 * Organisation, returning its own authoritative tenant/organisation ids
 * — never trusting a browser-supplied value as proof by itself,
 * mirroring `lib/domain/evidence.ts`'s own `resolveEngagementScope`. */
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

export interface AddEngagementMemberInput {
  organisationId: string;
  engagementId: string;
  targetUserId: string;
  roleId: string;
}

/**
 * Grants a new, active EngagementMembership (instructions §14):
 * Engagement Detail → Members → Add Member → select eligible existing
 * user → select valid Engagement Role → Add. Every scope value
 * (tenant/organisation) is derived from the Engagement's own
 * authoritative row; the target user and role are independently
 * re-validated here too — never trusted merely because they appeared in
 * `listEligibleUsersForEngagement`'s own earlier result (a
 * time-of-check/time-of-use gap: eligibility could change between
 * rendering the form and submitting it).
 *
 * **Role validation (instructions §7):** only a `Role` whose `scope =
 * 'engagement'` may be assigned — `roles.ts`'s own schema comment: "a
 * role is only ever granted via the membership table matching its
 * scope." A Tenant- or Organisation-scoped role id is rejected with a
 * clean, named error, never silently coerced or accepted.
 *
 * **Eligibility validation (instructions §5/§6/§11):** re-checks the
 * exact same tenant/organisation rule `listEligibleUsersForEngagement`
 * uses, applied to this one target user directly (not by re-deriving
 * the whole candidate list) — a suspended user, a user from another
 * tenant, or a client-side user from a different client Organisation
 * are all rejected with a clean `IneligibleUserError`, never a raw
 * database error. Reads the target user via `resolve_membership_
 * candidate` (migration 0024), not a plain `users` query, for the exact
 * same RLS-visibility reason `listEligibleUsersForEngagement` does (see
 * that function's own docstring) — the target user, not yet a member of
 * this Engagement, is otherwise invisible to the caller under ordinary
 * RLS.
 *
 * **Duplicates (instructions §9/§12):** the existing partial unique
 * index (`engagement_memberships_active_user_engagement_key`, migration
 * 0000) already makes a second ACTIVE membership for the same
 * (user, engagement) pair database-impossible — this function
 * pre-checks it for a clean error, then also catches the constraint
 * violation itself as a fallback (the same "pre-check for a clean
 * error, the constraint is the real enforcement" pattern every other
 * create function in this codebase already uses). A user with an
 * earlier REVOKED membership on this engagement may be re-added — that
 * insert becomes a new row (`id`), preserving the revoked row's own
 * history untouched, exactly how the unique index's own partial
 * (`WHERE status = 'active'`) shape is designed to work.
 */
export async function addEngagementMember(
  db: RequestDb,
  userId: string,
  input: AddEngagementMemberInput,
): Promise<{ id: string }> {
  const engagement = await loadAuthoritativeEngagement(db, input.engagementId, input.organisationId);
  await requireEngagementMembershipManageAccess(db, userId, engagement.id, engagement.organisationId);

  const [role] = await db.select({ id: roles.id, scope: roles.scope }).from(roles).where(eq(roles.id, input.roleId)).limit(1);
  if (!role || role.scope !== "engagement") {
    throw new InvalidEngagementRoleError();
  }

  const candidateResult = await db.execute<{ tenant_id: string; client_org_id: string | null; status: string }>(
    sql`SELECT tenant_id, client_org_id, status FROM public.resolve_membership_candidate(${engagement.id}, ${input.targetUserId})`,
  );
  const targetUser = candidateResult.rows[0];
  if (!targetUser) throw new NotFoundOrForbiddenError();
  if (targetUser.status !== "active") {
    throw new IneligibleUserError("This user's account is not active.");
  }
  if (targetUser.tenant_id !== engagement.tenantId) {
    throw new IneligibleUserError("This user does not belong to the same practice as this engagement.");
  }
  if (targetUser.client_org_id !== null && targetUser.client_org_id !== engagement.organisationId) {
    throw new IneligibleUserError("This user belongs to a different client organisation.");
  }

  const [existingActive] = await db
    .select({ id: engagementMemberships.id })
    .from(engagementMemberships)
    .where(
      and(
        eq(engagementMemberships.engagementId, engagement.id),
        eq(engagementMemberships.userId, input.targetUserId),
        eq(engagementMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (existingActive) throw new DuplicateMembershipError();

  const id = randomUUID();
  try {
    await db.insert(engagementMemberships).values({
      id,
      userId: input.targetUserId,
      engagementId: engagement.id,
      roleId: role.id,
      createdBy: userId,
    });
  } catch (err) {
    if (err instanceof Error && /engagement_memberships_active_user_engagement_key/.test(err.message)) {
      throw new DuplicateMembershipError();
    }
    throw err;
  }

  return { id };
}

export interface RevokeEngagementMemberInput {
  organisationId: string;
  engagementId: string;
  membershipId: string;
}

/**
 * Revokes an EngagementMembership (instructions §15): a status change
 * (`active` → `revoked`), never a hard DELETE — the model's own
 * intended lifecycle mechanism (§4 above; `engagement_memberships` has
 * no DELETE policy/GRANT anywhere, migrations 0001/0019/0024). Scope is
 * re-derived from the membership row's own `engagement_id`, then that
 * Engagement's own authoritative row — never the caller's own claimed
 * `organisationId`/`engagementId` beyond confirming they match.
 *
 * **Self-protection (instructions §8):** no invariant preventing
 * self-revocation, revoking the last remaining manager, or revoking
 * another manager exists anywhere in DATA_MODEL.md/SECURITY.md/
 * PRODUCT_SPEC.md/PRODUCT_UX_BLUEPRINT.md/DECISIONS.md (grepped fresh
 * this slice — none found). Per instructions §8's own explicit
 * fallback ("if no invariant exists, preserve the simplest existing
 * model"), none is invented here: anyone who can manage this
 * Engagement's membership may revoke ANY member, including themselves
 * or the only other manager. This is a real, deliberate, documented
 * behavior (DECISIONS.md R-114) — a manager genuinely can revoke
 * themselves down to zero managers, matching the schema's own silence
 * on the question — not an oversight.
 *
 * Idempotent: revoking an already-revoked membership is a silent no-op,
 * never an error — matches the general posture "a redundant safe action
 * shouldn't be treated as a failure."
 */
export async function revokeEngagementMember(db: RequestDb, userId: string, input: RevokeEngagementMemberInput): Promise<void> {
  const [membership] = await db
    .select({ id: engagementMemberships.id, engagementId: engagementMemberships.engagementId, status: engagementMemberships.status })
    .from(engagementMemberships)
    .where(eq(engagementMemberships.id, input.membershipId))
    .limit(1);
  if (!membership || membership.engagementId !== input.engagementId) throw new NotFoundOrForbiddenError();

  const engagement = await loadAuthoritativeEngagement(db, membership.engagementId, input.organisationId);
  await requireEngagementMembershipManageAccess(db, userId, engagement.id, engagement.organisationId);

  if (membership.status !== "active") return;

  await db
    .update(engagementMemberships)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(engagementMemberships.id, membership.id));
}
