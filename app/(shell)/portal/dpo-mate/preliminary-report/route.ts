import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { WorkspaceInputError } from "@/lib/workspace/common";
import { uuidOr } from "@/lib/workspace/page";
import { buildPreliminaryReport } from "@/lib/workspace/preliminary";

export const dynamic = "force-dynamic";

/** Downloads the preliminary report for one engagement, built from the records the person may see. */
export async function GET(req: Request) {
  const user = await requireAuthenticatedUser();
  const engagementId = uuidOr(new URL(req.url).searchParams.get("e"));
  if (!engagementId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const file = await withRequestDb(user.id, (db) => buildPreliminaryReport(db, user.id, engagementId));
    return new NextResponse(new Uint8Array(file.content), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (err instanceof WorkspaceInputError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error("Preliminary report failed", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
