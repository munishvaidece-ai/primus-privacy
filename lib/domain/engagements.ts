import "server-only";
import { desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { engagements, organisations, controlLibraryVersions, assessments } from "@/db/schema";
import { NotFoundOrForbiddenError, requireEngagementAccess } from "@/lib/authorization/service";

export interface EngagementDetail {
  id: string;
  name: string;
  status: string;
  engagementType: string;
  organisationId: string;
  organisationName: string;
  controlLibraryVersionLabel: string | null;
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
      organisationId: engagements.organisationId,
      organisationName: organisations.name,
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

  return { ...row, assessments: assessmentRows };
}
