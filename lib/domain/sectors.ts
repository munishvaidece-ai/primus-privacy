import "server-only";
import { and, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { engagements, engagementSectors } from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";
import { SELECTABLE_SECTORS, type SectorKey } from "@/lib/regulation";

/** Sectors selected for an engagement (cross-sector rules are implicit). */
export async function getEngagementSectors(db: RequestDb, userId: string, input: { engagementId: string; organisationId: string }): Promise<SectorKey[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);
  const rows = await db
    .select({ key: engagementSectors.sectorKey })
    .from(engagementSectors)
    .where(and(eq(engagementSectors.engagementId, input.engagementId), eq(engagementSectors.organisationId, input.organisationId)));
  const order = SELECTABLE_SECTORS.map((s) => s.key);
  return rows.map((r) => r.key as SectorKey).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Replace the engagement's sector selection. Primus staff only (enforced by the database too). */
export async function setEngagementSectors(db: RequestDb, userId: string, input: { engagementId: string; organisationId: string; sectors: string[] }): Promise<SectorKey[]> {
  await requireEngagementAccess(db, userId, input.engagementId, input.organisationId);
  const valid = new Set<string>(SELECTABLE_SECTORS.map((s) => s.key));
  const wanted = Array.from(new Set(input.sectors));
  const bad = wanted.filter((k) => !valid.has(k));
  if (bad.length) throw new Error(`Unknown sector: ${bad.join(", ")}`);
  const [eng] = await db
    .select({ tenantId: engagements.tenantId })
    .from(engagements)
    .where(and(eq(engagements.id, input.engagementId), eq(engagements.organisationId, input.organisationId)))
    .limit(1);
  if (!eng) throw new NotFoundOrForbiddenError();
  const current = await getEngagementSectors(db, userId, input);
  const toAdd = wanted.filter((k) => !current.includes(k as SectorKey));
  const toRemove = current.filter((k) => !wanted.includes(k));
  for (const k of toRemove) {
    await db.delete(engagementSectors).where(and(eq(engagementSectors.engagementId, input.engagementId), eq(engagementSectors.sectorKey, k)));
  }
  for (const k of toAdd) {
    await db.insert(engagementSectors).values({ tenantId: eng.tenantId, organisationId: input.organisationId, engagementId: input.engagementId, sectorKey: k, createdBy: userId });
  }
  return getEngagementSectors(db, userId, input);
}
