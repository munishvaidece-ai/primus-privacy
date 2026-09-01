import "server-only";
import { desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { organisations, engagements } from "@/db/schema";
import { NotFoundOrForbiddenError, requireOrganisationAccess } from "@/lib/authorization/service";

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
  engagements: Array<{ id: string; name: string; status: string; engagementType: string }>;
}

export async function getOrganisationDetail(
  db: RequestDb,
  userId: string,
  organisationId: string,
): Promise<OrganisationDetail> {
  await requireOrganisationAccess(db, userId, organisationId);

  const [org] = await db
    .select({ id: organisations.id, name: organisations.name, status: organisations.status })
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
