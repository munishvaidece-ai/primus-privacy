import "server-only";
import { and, eq, exists } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { tenantMemberships, organisationMemberships, engagementMemberships, engagements } from "@/db/schema";

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
// no new permission table. `Role`/`Permission`/`RolePermission`
// fine-grained action checks (e.g. "can finalize") are intentionally
// NOT built in this slice: PRODUCT_UX_BLUEPRINT.md §22 already flags the
// permission catalogue as only 8 illustrative rows, not the full set
// this would need, and the only mutation this slice performs
// (AssessmentResponse update) is gated by engagement access plus the
// database's own finalization trigger (Milestone 5) — a real "can
// finalize" / "can write this specific field" check is deferred to the
// slice that actually needs it, not invented ahead of a concrete need.

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
