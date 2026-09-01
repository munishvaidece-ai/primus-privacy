import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import {
  engagements,
  organisations,
  controlLibraryVersions,
  assessments,
  engagementMemberships,
  roles,
} from "@/db/schema";
import {
  NotFoundOrForbiddenError,
  requireEngagementAccess,
  requireOrganisationAccess,
  requireEngagementCreateAccess,
} from "@/lib/authorization/service";
import { getRoleIdByName } from "@/lib/domain/roles";

// Slice B2 (PHASE B2 instructions §9): the fixed, server-chosen role
// granted to whoever creates an Engagement — unlike organisation-scope
// roles (lib/domain/organisations.ts), this one is an unambiguous,
// well-fitting match: "Engagement Manager" (db/seed/roles.ts — "Owns
// delivery of one or more engagements: scoping, staffing, timeline,
// client relationship, final report sign-off") is exactly what someone
// who just opened an engagement is. Not a consequential interpretation
// the way the organisation-scope choice is.
const ENGAGEMENT_ONBOARDING_ROLE = "Engagement Manager";

export interface EngagementDetail {
  id: string;
  name: string;
  status: string;
  engagementType: string;
  periodStart: string | null;
  periodEnd: string | null;
  organisationId: string;
  organisationName: string;
  controlLibraryVersionId: string | null;
  controlLibraryVersionLabel: string | null;
  // Slice B2 (PHASE B2 instructions §14: "current authorised user
  // context where appropriate") — the caller's own engagement-scoped
  // role, if they hold direct EngagementMembership. Null when the
  // caller can see this engagement only via org-wide membership (the
  // `can_access_engagement` fallback) — they still have real access,
  // just not a role scoped to this specific engagement to display.
  currentUserRoleName: string | null;
  assessments: Array<{ id: string; periodLabel: string; assessmentType: string; status: string }>;
}

export async function getEngagementDetail(
  db: RequestDb,
  userId: string,
  engagementId: string,
): Promise<EngagementDetail> {
  const [row] = await db
    .select({
      id: engagements.id,
      name: engagements.name,
      status: engagements.status,
      engagementType: engagements.engagementType,
      periodStart: engagements.periodStart,
      periodEnd: engagements.periodEnd,
      organisationId: engagements.organisationId,
      organisationName: organisations.name,
      controlLibraryVersionId: engagements.controlLibraryVersionId,
      controlLibraryVersionLabel: controlLibraryVersions.versionLabel,
    })
    .from(engagements)
    .innerJoin(organisations, eq(organisations.id, engagements.organisationId))
    .leftJoin(controlLibraryVersions, eq(controlLibraryVersions.id, engagements.controlLibraryVersionId))
    .where(eq(engagements.id, engagementId))
    .limit(1);
  if (!row) throw new NotFoundOrForbiddenError();

  // Checked explicitly (not left to RLS alone) so a caller with no
  // access at all gets the same not-found/forbidden response whether or
  // not the row exists — SECURITY.md §13's "avoid leaking existence
  // through error-message differences," applied by making both cases
  // reach this exact same throw.
  await requireEngagementAccess(db, userId, engagementId, row.organisationId);

  const [membership] = await db
    .select({ roleName: roles.name })
    .from(engagementMemberships)
    .innerJoin(roles, eq(roles.id, engagementMemberships.roleId))
    .where(
      and(
        eq(engagementMemberships.engagementId, engagementId),
        eq(engagementMemberships.userId, userId),
        eq(engagementMemberships.status, "active"),
      ),
    )
    .limit(1);

  const assessmentRows = await db
    .select({
      id: assessments.id,
      periodLabel: assessments.periodLabel,
      assessmentType: assessments.assessmentType,
      status: assessments.status,
    })
    .from(assessments)
    .where(eq(assessments.engagementId, engagementId))
    .orderBy(desc(assessments.createdAt));

  return { ...row, currentUserRoleName: membership?.roleName ?? null, assessments: assessmentRows };
}

export class DuplicateEngagementError extends Error {
  constructor(message = "An engagement with this name already exists for this organisation.") {
    super(message);
    this.name = "DuplicateEngagementError";
  }
}

export class InvalidMethodologyError extends Error {
  constructor(message = "The selected control library version is not valid for this engagement.") {
    super(message);
    this.name = "InvalidMethodologyError";
  }
}

export interface CreateEngagementInput {
  organisationId: string;
  name: string;
  engagementType: "readiness" | "annual_assessment" | "dpia_programme" | "third_party_assessment" | "continuous_compliance";
  periodStart: string | null;
  periodEnd: string | null;
  controlLibraryVersionId: string | null;
}

/**
 * Slice B2 (PHASE B2 instructions §7-§11): Browser → Server Action →
 * authenticate → authorize → validate → database transaction → audit →
 * redirect — the same shape Slice A1/B1 already established.
 *
 * `organisationId` is a route param the caller (the Server Action)
 * trusts only as far as "which organisation to look up" — this
 * function still independently re-derives that organisation's own
 * `tenant_id` from its own database row (never accepts a
 * browser-supplied `tenant_id`) and re-checks access before writing
 * anything, exactly like `updateAssessmentResponse` (Slice A1)
 * re-derives its own scope from the AssessmentControl row rather than
 * trusting form fields.
 *
 * `requireOrganisationAccess` gates this whole function (matching how
 * the `/organisations/[organisationId]/engagements/new` page itself is
 * gated — instructions §13's "create engagement action" lives on the
 * already-access-checked Organisation Detail page, so this function
 * requires the same access to reach it at all) — but that check alone
 * is BROADER than what migration 0001's own `engagements_insert` RLS
 * policy allows (`canAccessOrganisation`/`requireOrganisationAccess`
 * also passes for a caller who only has EngagementMembership on some
 * OTHER engagement under this organisation, via the `can_access_
 * organisation` fallback — but `engagements_insert` requires tenant- or
 * organisation-*wide* membership specifically, not membership on an
 * unrelated engagement). `requireEngagementCreateAccess` is the second,
 * correctly-scoped check that actually matches what the database will
 * allow — both checks passing is required, and RLS itself remains the
 * final backstop regardless (SECURITY.md §2).
 *
 * The id is generated application-side and INSERTed without
 * `.returning()`, the same established pattern from
 * `lib/domain/organisations.ts`'s `createOrganisation` (see its own
 * docstring for the exact RLS/RETURNING interaction this avoids) —
 * applied uniformly here rather than reasoned out fresh for every
 * possible caller-membership shape.
 *
 * Immediately after inserting the engagement, this function ALSO
 * grants the creator an `engagement_memberships` row (role:
 * `ENGAGEMENT_ONBOARDING_ROLE`), in the SAME `withRequestDb`
 * transaction — mirroring `createOrganisation`'s own onboarding-grant
 * pattern exactly (see DECISIONS.md). No engagement this function
 * creates is ever left inaccessible to its own creator, and no
 * separate transaction API is needed for this to be atomic: any thrown
 * error here (methodology validation, the membership grant, or the
 * engagement insert itself) rolls back everything `withRequestDb`
 * already wrapped this call in.
 *
 * Methodology/control-library selection (instructions §8): a
 * `controlLibraryVersionId`, if provided, must belong to the SAME
 * tenant as the organisation and must be `published` or `retired` (not
 * `draft`) — this is exactly what migration 0007's own
 * `engagements_prevent_control_library_pin_change` trigger already
 * enforces at the database level regardless; this function's own check
 * exists only to turn that trigger's raw exception into a clean,
 * specific `InvalidMethodologyError` instead of a raw database error
 * reaching the user (instructions §20), the same "pre-check for a
 * clean error, trigger remains the real enforcement" pattern Slice A1's
 * `updateAssessmentResponse` already established for finalization.
 *
 * The duplicate-name check mirrors `createOrganisation`'s own — an
 * RLS-scoped, case-insensitive, best-effort check, scoped to this one
 * organisation's engagements rather than the caller's entire tenant.
 * Same documented limitation: it can only see engagements the caller
 * already has access to.
 */
export async function createEngagement(
  db: RequestDb,
  userId: string,
  input: CreateEngagementInput,
): Promise<{ id: string }> {
  const [org] = await db
    .select({ id: organisations.id, tenantId: organisations.tenantId })
    .from(organisations)
    .where(eq(organisations.id, input.organisationId))
    .limit(1);
  if (!org) throw new NotFoundOrForbiddenError();

  await requireOrganisationAccess(db, userId, input.organisationId);
  await requireEngagementCreateAccess(db, userId, input.organisationId, org.tenantId);

  if (input.controlLibraryVersionId) {
    const [clv] = await db
      .select({ status: controlLibraryVersions.status, tenantId: controlLibraryVersions.tenantId })
      .from(controlLibraryVersions)
      .where(eq(controlLibraryVersions.id, input.controlLibraryVersionId))
      .limit(1);
    if (!clv || clv.tenantId !== org.tenantId) {
      throw new InvalidMethodologyError("The selected control library version does not belong to this practice.");
    }
    if (clv.status === "draft") {
      throw new InvalidMethodologyError("A draft control library version cannot be pinned to an Engagement.");
    }
  }

  const [existing] = await db
    .select({ id: engagements.id })
    .from(engagements)
    .where(and(eq(engagements.organisationId, input.organisationId), ilike(engagements.name, input.name)))
    .limit(1);
  if (existing) throw new DuplicateEngagementError();

  const id = randomUUID();
  await db.insert(engagements).values({
    id,
    tenantId: org.tenantId,
    organisationId: input.organisationId,
    name: input.name,
    engagementType: input.engagementType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    controlLibraryVersionId: input.controlLibraryVersionId,
    createdBy: userId,
    updatedBy: userId,
  });

  const engagementManagerRoleId = await getRoleIdByName(db, ENGAGEMENT_ONBOARDING_ROLE);
  await db.insert(engagementMemberships).values({
    id: randomUUID(),
    userId,
    engagementId: id,
    roleId: engagementManagerRoleId,
    createdBy: userId,
  });

  return { id };
}

export interface SelectableControlLibraryVersion {
  id: string;
  versionLabel: string;
  status: string;
}

/**
 * The methodology dropdown's own data source — published/retired
 * versions for the organisation's own tenant only (instructions §8:
 * "only allow a methodology/control-library version valid for the same
 * tenant... respect published/approved state requirements"). Readable
 * once the caller has any access to this tenant (`control_library_
 * versions_select`'s RLS policy, migration 0007, uses `can_access_
 * tenant` — already true for anyone who reached this page at all).
 */
export async function listSelectableControlLibraryVersions(
  db: RequestDb,
  tenantId: string,
): Promise<SelectableControlLibraryVersion[]> {
  return db
    .select({
      id: controlLibraryVersions.id,
      versionLabel: controlLibraryVersions.versionLabel,
      status: controlLibraryVersions.status,
    })
    .from(controlLibraryVersions)
    .where(
      and(
        eq(controlLibraryVersions.tenantId, tenantId),
        inArray(controlLibraryVersions.status, ["published", "retired"]),
      ),
    )
    .orderBy(desc(controlLibraryVersions.publishedAt));
}
