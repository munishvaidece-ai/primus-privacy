import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb, type RequestDb } from "@/lib/db/request-client";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { requireAiAccess } from "@/lib/ai/suggestions";

export interface AiPageContext {
  userId: string;
  organisationId: string;
  engagementId: string;
  engagementName: string;
  canConfigure: boolean;
  canRelease: boolean;
}

/** Signs the user in, proves they may work with AI on this engagement, and hands back the context. */
export async function loadAiContext<T>(
  params: { organisationId: string; engagementId: string },
  fn: (db: RequestDb, ctx: AiPageContext) => Promise<T>,
): Promise<{ ctx: AiPageContext; data: T }> {
  const user = await requireAuthenticatedUser();
  return withRequestDb(user.id, async (db) => {
    try {
      const eng = await getEngagementDetail(db, user.id, params.engagementId);
      if (eng.organisationId !== params.organisationId) notFound();
      const access = await requireAiAccess(db, user.id, params.engagementId);
      const ctx: AiPageContext = { userId: user.id, organisationId: params.organisationId, engagementId: params.engagementId, engagementName: eng.name, ...access };
      return { ctx, data: await fn(db, ctx) };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });
}
