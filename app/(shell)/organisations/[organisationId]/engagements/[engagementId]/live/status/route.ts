import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { hasEngagementPermission, NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { loadLiveStatus } from "@/lib/live/status";

export const dynamic = "force-dynamic";

/** What the Live Run screen polls every second or two while the AI works. */
export async function GET(_req: Request, { params }: { params: { organisationId: string; engagementId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const data = await withRequestDb(user.id, async (db) => {
      const canSeeAi = await hasEngagementPermission(db, user.id, params.engagementId, "ai.supervise");
      return loadLiveStatus(db, user.id, params, canSeeAi);
    });
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    console.error("live status failed", err);
    return NextResponse.json({ error: "Could not read the status" }, { status: 500 });
  }
}
