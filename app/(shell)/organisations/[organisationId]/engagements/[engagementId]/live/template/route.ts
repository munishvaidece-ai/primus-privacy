import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { requireEngagementAccess } from "@/lib/authorization/service";
import { isDemoAuthActive } from "@/lib/auth/demo-auth";
import { buildTemplateWorkbook } from "@/lib/templates/build";
import { TEMPLATES } from "@/lib/templates/definitions";
import { phaseOf } from "@/lib/live/config";
import { closureFile, indexFile, inventoryFile, scopeFile, testsFile } from "@/lib/demo/orchid/pack";

export const dynamic = "force-dynamic";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** ?phase=1&kind=blank gives the empty template. kind=sample gives the filled Orchid Hill file (demo installs only). */
export async function GET(req: Request, { params }: { params: { organisationId: string; engagementId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(req.url);
  const phase = Number(url.searchParams.get("phase"));
  const kind = url.searchParams.get("kind") === "sample" ? "sample" : "blank";
  const def = Number.isInteger(phase) && phase >= 1 && phase <= 7 ? phaseOf(phase) : null;
  if (!def?.template) return NextResponse.json({ error: "No template for that phase" }, { status: 404 });
  try {
    await withRequestDb(user.id, (db) => requireEngagementAccess(db, user.id, params.engagementId, params.organisationId));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const t = TEMPLATES[def.template];
  let body: Uint8Array;
  let name = t.fileName;
  if (kind === "sample") {
    if (!isDemoAuthActive()) return NextResponse.json({ error: "Sample files are only offered on demo installs" }, { status: 404 });
    const makers = { "SCOPE-INTAKE": scopeFile, "DATA-INVENTORY": inventoryFile, "CONTROL-TEST-LOG": testsFile, "EVIDENCE-INDEX": indexFile, "CLOSURE-PACK": closureFile } as const;
    body = makers[def.template]();
  } else {
    body = buildTemplateWorkbook(def.template);
    name = t.fileName.replace(".xlsx", "_BLANK.xlsx");
  }
  return new NextResponse(Buffer.from(body), { headers: { "content-type": XLSX, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
