import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { getReleasedReportFile } from "@/lib/workspace/reports";

export const dynamic = "force-dynamic";

/** Downloads one released report. Row security limits this to the person's own engagements. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireAuthenticatedUser();
  try {
    const file = await withRequestDb(user.id, (db) => getReleasedReportFile(db, params.id));
    return new NextResponse(new Uint8Array(file.content), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) return NextResponse.json({ error: "Not found." }, { status: 404 });
    console.error("Report download failed", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
