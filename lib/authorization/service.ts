import "server-only";
import { and, eq, exists } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  tenantMemberships,
  organisationMemberships,
  engagementMemberships,
  engagements,
  users,
  rolePermissions,
  permissions,
} from "@/db/schema";

// The single centralized application-layer authorization service
// (PHASE A instructions §6/§7). Consistent with SECURITY.md §2's
// two-layer model: this is the FIRST, independently-implemented check —
// RLS (already built, Milestones 1-8A) remains the second, backstop
// layer every query below is additionally subject to via
// `lib/db/request-client.ts`'s `SET LOCAL ROLE authenticated` +
// `request.jwt.claim.sub`. Deliberately re-implements the same
// membership logic as migration 0001's `is_active_tenant_member` /
// `is_active_organisation_member` / `is_active_engagement_member` /
// `can_access_tenant` / `can_access_organisation` / `can_access_engagement`
// SQL functions — not by calling them — because SECURITY.md R-07's own
// stated rationale for two layers is that they are independently
// implemented and must independently agree; wrapping one layer around
// the other would collapse that guarantee back into a single mechanism.
// If this module's answer and RLS's answer ever disagree, that is a bug
// to fix immediately (SECURITY.md §2), not a signal to relax either one.
//
// Uses the EXACT existing membership model — TenantMembership →
// OrganisationMembership → EngagementMembership — no new role database,
// no new permission table. Through Slice C7.1, `Role`/`Permission`/
// `RolePermission` fine-grained action checks (e.g. "can finalize")
// were intentionally NOT built: PRODUCT_UX_BLUEPRINT.md §22 flags the
// permission catalogue as only 8 illustrative rows, not the full set a
// general permission system would need, and every mutation through C7.1
// was gated by plain engagement access plus the database's own
// business-rule triggers — a real "can do X" check was deferred to the
// slice that actually needed one, not invented ahead of a concrete need.
//
// Slice C7.2 is that slice: `hasEngagementPermission`/
// `hasOrganisationPermission` below are the first fine-grained
// Role/Permission checks in this codebase, added because managing
// EngagementMembership is exactly the one existing, already-seeded
// `membership.manage` permission (`db/seed/roles.ts`, granted to
// Engagement Manager and Client Administrator) was seeded FOR — using
// it here is not inventing a new permission, it is finally reading one
// that has existed, fully seeded, since Milestone 1. Mirrors migration
// 0024's own `has_engagement_permission`/`has_organisation_permission`
// SQL functions, independently implemented in TypeScript per
// SECURITY.md §2's two-layer rule (this is the FIRST, application-layer
// check; the SQL functions are the SECOND, RLS-layer check — both must
// independently agree).

export class NotFoundOrForbiddenError extends Error {
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundOrForbiddenError";
  }
}

export async function isActiveTenantMember(db: RequestDb, userId: string, tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, "active"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function isActiveOrganisationMember(
  db: RequestDb,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: organisationMemberships.id })
    .from(organisationMemberships)
    .where(
      and(
        eq(organisationMemberships.userId, userId),
        eq(organisationMemberships.organisationId, organisationId),
        eq(organisationMemberships.status, "active"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function isActiveEngagementMember(
  db: RequestDb,
  userId: string,
  engagementId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: engagementMemberships.id })
    .from(engagementMemberships)
    .where(
      and(
        eq(engagementMemberships.userId, userId),
        eq(engagementMemberships.engagementId, engagementId),
        eq(engagementMemberships.status, "active"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Mirrors `can_access_organisation` (migration 0001): org-wide
 * membership, or any active membership on an engagement under this
 * organisation. Deliberately does NOT fall back to tenant-wide
 * membership — SECURITY.md §3's own explicit rule: "Practice staff do
 * not get implicit cross-client access within their own tenant." */
export async function canAccessOrganisation(
  db: RequestDb,
  userId: string,
  organisationId: string,
): Promise<boolean> {
  if (await isActiveOrganisationMember(db, userId, organisationId)) return true;
  const rows = await db
    .select({ id: engagements.id })
    .from(engagements)
    .where(
      and(
        eq(engagements.organisationId, organisationId),
        exists(
          db
            .select({ id: engagementMemberships.id })
            .from(engagementMemberships)
            .where(
              and(
                eq(engagementMemberships.engagementId, engagements.id),
                eq(engagementMemberships.userId, userId),
                eq(engagementMemberships.status, "active"),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Mirrors `can_access_engagement` (migration 0001): engagement-specific
 * membership, or org-wide membership on the engagement's own
 * organisation. `organisationId` must be the engagement's real, already-
 * resolved organisation id (never a caller-supplied value trusted
 * as-is) — see requireEngagementAccess below. */
export async function canAccessEngagement(
  db: RequestDb,
  userId: string,
  engagementId: string,
  organisationId: string,
): Promise<boolean> {
  if (await isActiveEngagementMember(db, userId, engagementId)) return true;
  return isActiveOrganisationMember(db, userId, organisationId);
}

/** Mirrors `can_access_tenant`: tenant-wide membership, or the ability
 * to access at least one organisation under this tenant. */
export async function canAccessTenant(db: RequestDb, userId: string, tenantId: string): Promise<boolean> {
  if (await isActiveTenantMember(db, userId, tenantId)) return true;
  // Intentionally not implemented via a broad `organisations` scan in
  // this slice — no screen in Slice A1 needs tenant-level access
  // resolution (Methodology/Administration screens are out of scope,
  // PHASE A instructions §19); added when that slice needs it, per the
  // same "don't build ahead of a concrete need" posture as the
  // permission-catalogue note above.
  return false;
}

export async function requireTenantAccess(db: RequestDb, userId: string, tenantId: string): Promise<void> {
  if (!(await canAccessTenant(db, userId, tenantId))) {
    throw new NotFoundOrForbiddenError();
  }
}

export async function requireOrganisationAccess(db: RequestDb, userId: string, organisationId: string): Promise<void> {
  if (!(await canAccessOrganisation(db, userId, organisationId))) {
    throw new NotFoundOrForbiddenError();
  }
}

export async function requireEngagementAccess(
  db: RequestDb,
  userId: string,
  engagementId: string,
  organisationId: string,
): Promise<void> {
  if (!(await canAccessEngagement(db, userId, engagementId, organisationId))) {
    throw new NotFoundOrForbiddenError();
  }
}

/** The authenticated user's own home tenant (`users.tenant_id`), read via
 * the existing `users_select` RLS policy's `id = auth.uid()` clause —
 * every user can always read their own row, so this needs no additional
 * authorization check of its own. Returns null only if no `users` row
 * exists for this id, which should not happen for a real authenticated
 * session (Slice A1's provisioning trigger always creates one). */
export async function getUserTenantId(db: RequestDb, userId: string): Promise<string | null> {
  const [row] = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.tenantId ?? null;
}

/**
 * Slice B1 (PHASE B instructions §7): the exact narrow check migration
 * 0001's `organisations_insert` RLS policy performs —
 * `is_active_tenant_member(tenant_id)`, nothing broader. Deliberately a
 * distinct, separately-named function from `requireTenantAccess` above
 * rather than reusing `canAccessTenant`: that function's own docstring
 * already anticipates growing an org-level fallback once a slice needs
 * one, and organisation *creation* specifically requires real tenant-
 * level membership, not merely the ability to see some organisation
 * under the tenant — conflating the two would silently broaden who can
 * create an organisation the moment `canAccessTenant` is extended for an
 * unrelated read-only screen. There is no finer-grained "can create
 * organisations" permission in the current Role/Permission catalogue
 * (PRODUCT_UX_BLUEPRINT.md §22 — only 8 illustrative rows) to check
 * instead; this is the narrowest existing role/permission consistent
 * with that catalogue and with SECURITY.md — see DECISIONS.md.
 */
export async function requireTenantMembership(db: RequestDb, userId: string, tenantId: string): Promise<void> {
  if (!(await isActiveTenantMember(db, userId, tenantId))) {
    throw new NotFoundOrForbiddenError();
  }
}

/**
 * Slice B2 (PHASE B2 instructions §7): the exact rule migration 0001's
 * `engagements_insert` RLS policy already uses — a tenant member (any
 * role) opening a new engagement for any client under their own tenant,
 * OR an organisation member (an org-wide client role) requesting a new
 * engagement for their own organisation. Not a new rule invented for
 * this slice; this function only gives that existing RLS-level rule an
 * application-layer, independently-implemented counterpart, matching
 * this project's two-layer model (SECURITY.md §2) the same way every
 * other `canAccess*`/`require*` pair in this file already does.
 */
export async function canCreateEngagement(
  db: RequestDb,
  userId: string,
  organisationId: string,
  tenantId: string,
): Promise<boolean> {
  if (await isActiveTenantMember(db, userId, tenantId)) return true;
  return isActiveOrganisationMember(db, userId, organisationId);
}

export async function requireEngagementCreateAccess(
  db: RequestDb,
  userId: string,
  organisationId: string,
  tenantId: string,
): Promise<void> {
  if (!(await canCreateEngagement(db, userId, organisationId, tenantId))) {
    throw new NotFoundOrForbiddenError();
  }
}

/**
 * Slice C7.2 (instructions §3): does the CALLING user hold an active
 * `EngagementMembership` on this specific engagement whose `Role`
 * grants `permissionKey`, via the existing `RolePermission` table?
 * Mirrors migration 0024's `has_engagement_permission` SQL function —
 * independently implemented (never calls it), the same discipline
 * every other pair in this file already follows.
 */
export async function hasEngagementPermission(
  db: RequestDb,
  userId: string,
  engagementId: string,
  permissionKey: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: rolePermissions.roleId })
    .from(engagementMemberships)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, engagementMemberships.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(engagementMemberships.userId, userId),
        eq(engagementMemberships.engagementId, engagementId),
        eq(engagementMemberships.status, "active"),
        eq(permissions.key, permissionKey),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Slice C7.2: the organisation-scope counterpart — does the calling
 * user hold an active `OrganisationMembership` on this organisation
 * whose `Role` grants `permissionKey` (e.g. Client Administrator's own
 * `membership.manage` grant)? Mirrors migration 0024's
 * `has_organisation_permission` SQL function. */
export async function hasOrganisationPermission(
  db: RequestDb,
  userId: string,
  organisationId: string,
  permissionKey: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: rolePermissions.roleId })
    .from(organisationMemberships)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, organisationMemberships.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(organisationMemberships.userId, userId),
        eq(organisationMemberships.organisationId, organisationId),
        eq(organisationMemberships.status, "active"),
        eq(permissions.key, permissionKey),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Slice C7.2: "who may manage this Engagement's membership" — the
 * single rule `addEngagementMember`/`revokeEngagementMember`
 * (lib/domain/engagement-memberships.ts) both gate on. Resolved from
 * the repository, not invented: the caller holds `membership.manage`
 * either via an active `EngagementMembership` on this specific
 * engagement (Engagement Manager, per `db/seed/roles.ts`) or via an
 * active `OrganisationMembership` on the engagement's own organisation
 * (Client Administrator). Deliberately narrower than migration 0024's
 * own INSERT policy (which additionally allows plain tenant-/
 * organisation-wide membership, for Slice B2's own unrelated
 * self-onboarding-at-creation-time flow) — the application layer is
 * where this feature's real business rule lives (SECURITY.md §2: RLS
 * is "a poor fit for the more dynamic parts of the model," this is
 * exactly that), RLS remains the coarser backstop underneath it.
 */
export async function canManageEngagementMembership(
  db: RequestDb,
  userId: string,
  engagementId: string,
  organisationId: string,
): Promise<boolean> {
  if (await hasEngagementPermission(db, userId, engagementId, "membership.manage")) return true;
  return hasOrganisationPermission(db, userId, organisationId, "membership.manage");
}

export async function requireEngagementMembershipManageAccess(
  db: RequestDb,
  userId: string,
  engagementId: string,
  organisationId: string,
): Promise<void> {
  if (!(await canManageEngagementMembership(db, userId, engagementId, organisationId))) {
    throw new NotFoundOrForbiddenError();
  }
}
