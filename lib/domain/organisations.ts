import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { organisations, engagements } from "@/db/schema";
import {
  NotFoundOrForbiddenError,
  requireOrganisationAccess,
  requireTenantMembership,
  getUserTenantId,
} from "@/lib/authorization/service";

export interface OrganisationSummary {
  id: string;
  name: string;
  status: string;
}

/**
 * Every organisation the current session can see. RLS itself performs
 * the filtering here (migration 0001's `organisations_select` policy,
 * `can_access_organisation(id)`) — `withRequestDb` (lib/db/request-
 * client.ts) always runs this query under `SET LOCAL ROLE authenticated`
 * with the session's `request.jwt.claim.sub` set first, so a plain,
 * unfiltered `SELECT` already returns exactly the visible rows. No
 * parallel application-layer filtering is added for this list read —
 * there is no more specific business question to ask for "what am I
 * allowed to see" than what RLS already answers; the explicit
 * `lib/authorization/service.ts` checks are used instead for the detail
 * page below and the write path, where a definite not-found/forbidden
 * response (not merely an empty list) is the correct behavior.
 */
export async function listAccessibleOrganisations(db: RequestDb): Promise<OrganisationSummary[]> {
  return db
    .select({ id: organisations.id, name: organisations.name, status: organisations.status })
    .from(organisations)
    .orderBy(organisations.name);
}

export interface OrganisationDetail extends OrganisationSummary {
  createdAt: Date;
  engagements: Array<{ id: string; name: string; status: string; engagementType: string }>;
}

export async function getOrganisationDetail(
  db: RequestDb,
  userId: string,
  organisationId: string,
): Promise<OrganisationDetail> {
  await requireOrganisationAccess(db, userId, organisationId);

  const [org] = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      status: organisations.status,
      createdAt: organisations.createdAt,
    })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  if (!org) throw new NotFoundOrForbiddenError();

  const engagementRows = await db
    .select({
      id: engagements.id,
      name: engagements.name,
      status: engagements.status,
      engagementType: engagements.engagementType,
    })
    .from(engagements)
    .where(eq(engagements.organisationId, organisationId))
    .orderBy(desc(engagements.createdAt));

  return { ...org, engagements: engagementRows };
}

export class DuplicateOrganisationError extends Error {
  constructor(message = "An organisation with this name already exists.") {
    super(message);
    this.name = "DuplicateOrganisationError";
  }
}

export interface CreateOrganisationInput {
  name: string;
}

/**
 * Slice B1 (PHASE B instructions §6-§10): Browser → Server Action →
 * authentication → authorization → validation → database → audit →
 * redirect. This function is the authorization + validation + database
 * step; the caller (the Server Action) has already authenticated and
 * Zod-validated `input.name`'s shape before calling in.
 *
 * `tenant_id` is never accepted as an input here — it is always derived
 * from the authenticated user's own `users.tenant_id` row (instructions
 * §8: "The browser must NEVER be able to choose which tenant_id an
 * organisation is created under"). `requireTenantMembership` re-checks
 * exactly what migration 0001's `organisations_insert` RLS policy checks
 * (`is_active_tenant_member(tenant_id)`), so a caller with no active
 * TenantMembership gets a clean, generic error here rather than
 * discovering the same rejection only via a raw RLS policy violation.
 *
 * The id is generated here, application-side, and INSERTed explicitly
 * rather than left to the column's default and read back via
 * `.returning()`. This is not stylistic: Postgres RLS re-checks a
 * RETURNING row against the table's own SELECT policy, in addition to
 * the INSERT policy's WITH CHECK — and `organisations_select`
 * (`can_access_organisation`, migration 0001) requires organisation- or
 * engagement-level membership, which nobody has yet on a row that was
 * just created (see the extensive note on `getOrganisationDetail`'s
 * caller in app/(shell)/organisations/[organisationId]/page.tsx for the
 * full consequence of this). A bare TenantMembership is genuinely
 * sufficient to satisfy `organisations_insert`'s WITH CHECK but NOT
 * `organisations_select`'s USING clause — confirmed directly: the exact
 * same INSERT that succeeds without RETURNING fails with "new row
 * violates row-level security policy" when RETURNING is added, for an
 * otherwise fully-authorized tenant member. Generating the id ourselves
 * sidesteps this entirely — the caller already knows what id it just
 * asked to be inserted, with no read-back required.
 *
 * The name-uniqueness check below is a deliberate, documented best-
 * effort, narrower than a simple "is this name taken" check might
 * suggest: `organisations.name` carries no database uniqueness
 * constraint (confirmed by inspection of db/schema/organisations.ts and
 * every migration since Milestone 1), and Slice B1 instructions §17
 * forbid adding a migration for a schema gap that isn't a genuinely
 * missing DATA_MODEL.md-required field — a uniqueness constraint is a
 * new invariant, not a pre-existing gap the schema already defines. This
 * check runs as an ordinary RLS-scoped SELECT (deliberately, per
 * instructions §15 — no service-role/RLS-bypassing read is used purely
 * to make this check more thorough), so — for exactly the same reason
 * described above — it can only ever see organisations the calling user
 * already has read access to; it cannot detect a name collision with an
 * organisation the caller cannot see. It is therefore best-effort,
 * case-insensitive, scoped to the caller's own tenant AND to the
 * caller's own visible scope within it, and not race-condition-safe
 * under concurrent creates of the same name — see DECISIONS.md.
 */
export async function createOrganisation(
  db: RequestDb,
  userId: string,
  input: CreateOrganisationInput,
): Promise<{ id: string }> {
  const tenantId = await getUserTenantId(db, userId);
  if (!tenantId) throw new NotFoundOrForbiddenError();

  await requireTenantMembership(db, userId, tenantId);

  const [existing] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(and(eq(organisations.tenantId, tenantId), ilike(organisations.name, input.name)))
    .limit(1);
  if (existing) throw new DuplicateOrganisationError();

  const id = randomUUID();
  await db.insert(organisations).values({
    id,
    tenantId,
    name: input.name,
    createdBy: userId,
    updatedBy: userId,
  });

  return { id };
}
