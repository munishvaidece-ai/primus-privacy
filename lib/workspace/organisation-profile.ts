import "server-only";
import { eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { organisations } from "@/db/schema";
import { NotFoundOrForbiddenError, isActiveTenantMember, getUserTenantId } from "@/lib/authorization/service";
import { cleanText, getViewer, mapDbError } from "./common";

/** Industry and headquarters are set by the Primus team; they show in lists and filters. */
export async function updateOrganisationProfile(db: RequestDb, userId: string, input: { organisationId: string; industry: unknown; hqLocation: unknown }): Promise<void> {
  const viewer = await getViewer(db, userId);
  const tenantId = await getUserTenantId(db, userId);
  if (viewer.isClient || !tenantId || !(await isActiveTenantMember(db, userId, tenantId))) throw new NotFoundOrForbiddenError();
  const industry = cleanText(input.industry, "Industry", 80, { required: false }) || null;
  const hqLocation = cleanText(input.hqLocation, "Headquarters", 120, { required: false }) || null;
  try {
    const rows = await db
      .update(organisations)
      .set({ industry, hqLocation, updatedBy: userId, updatedAt: new Date() })
      .where(eq(organisations.id, input.organisationId))
      .returning({ id: organisations.id });
    if (rows.length === 0) throw new NotFoundOrForbiddenError();
  } catch (err) {
    return mapDbError(err);
  }
}
