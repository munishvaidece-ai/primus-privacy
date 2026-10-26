import "server-only";
import { sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { latestParsed, listSupportFiles, nextTemplateToProcess } from "@/lib/intake/store";
import type { ParsedRow } from "@/lib/templates/validate";
import { listBusinessUnits } from "@/lib/domain/master-data";
import { getEngagementSectors } from "@/lib/domain/sectors";
import { extractText } from "./extract";
import { readEvidenceObject } from "./storage-reader";
import type { Actor } from "./provenance";
import type { ScopeIntakeInput } from "./tasks/scope-intake";
import type { ActRow, DiscoveredTable, LandscapeInput, RegRow, StoreRow, UnitRow, VendorRow, FormAns } from "./tasks/landscape";
import type { ClosureInput, RemediationPlanInput } from "./tasks/remediation";
import type { RiskTier } from "./types";

const rows = <T>(r: ParsedRow[] | undefined): Array<T & { _row: number }> => (r ?? []).map((x) => ({ ...(x.v as unknown as T), _row: x.row }));
const actorOf = (r: { uploadedByName: string; uploadedBySide: "primus" | "client" }): Actor => ({ name: r.uploadedByName, side: r.uploadedBySide });

export async function readSupportTexts(db: RequestDb, engagementId: string, phase: number, role: "support" | "proof_file", maxChars = 6000): Promise<Array<{ filename: string; text: string; id: string; method: string; uploadedBy: Actor; uploadedAt: string }>> {
  const files = await listSupportFiles(db, engagementId, phase, role);
  const out: Awaited<ReturnType<typeof readSupportTexts>> = [];
  for (const f of files) {
    try {
      const x = await extractText(await readEvidenceObject(f.storagePath), f.mimeType, f.filename);
      out.push({ filename: f.filename, text: x.text.slice(0, maxChars), id: f.id, method: x.method, uploadedBy: actorOf({ uploadedByName: f.uploadedByName, uploadedBySide: f.uploadedBySide as "primus" | "client" }), uploadedAt: f.uploadedAt.toISOString() });
    } catch {
      out.push({ filename: f.filename, text: "", id: f.id, method: "unreadable", uploadedBy: actorOf({ uploadedByName: f.uploadedByName, uploadedBySide: f.uploadedBySide as "primus" | "client" }), uploadedAt: f.uploadedAt.toISOString() });
    }
  }
  return out;
}

export async function loadScopeInput(db: RequestDb, agentUserId: string, engagementId: string, organisationId: string): Promise<ScopeIntakeInput | null> {
  const next = await nextTemplateToProcess(db, engagementId, "SCOPE-INTAKE");
  if (!next) return null;
  const { row, data } = next;
  const org: ScopeIntakeInput["org"] = {};
  for (const f of data.forms["Organisation"] ?? []) org[f.key] = { value: f.answer, row: f.row };
  const support = await readSupportTexts(db, engagementId, 1, "support");
  return {
    fileId: row.id,
    fileName: row.filename,
    uploadedAt: row.uploadedAt.toISOString(),
    uploadedBy: actorOf(row),
    org,
    registrations: rows<Omit<RegRow, "_row">>(data.tables["Registrations"]).map((r) => ({ row: r._row, registration: r.registration, regulator: r.regulator, number: r.number ?? "", status: r.status })),
    units: rows<Omit<UnitRow, "_row">>(data.tables["Business units"]).map((r) => ({ row: r._row, name: r.name, does: r.does, head: r.head, personal: r.personal, staff: r.staff ?? "" })),
    systems: rows<{ system: string; purpose: string; hosting: string; client_data: string }>(data.tables["Systems"]).map((r) => ({ row: r._row, ...r })),
    supporting: support.filter((s) => s.text).map((s) => ({ filename: s.filename, text: s.text })),
    existingUnits: (await listBusinessUnits(db, agentUserId, organisationId)).map((u) => u.name),
    existingSectors: await getEngagementSectors(db, agentUserId, { engagementId, organisationId }),
  };
}

export async function loadDiscoveredTables(db: RequestDb, engagementId: string): Promise<DiscoveredTable[]> {
  const r = await db.execute<{ connector: string; location: string; name: string; categories: string[]; sensitivity: string; attributes: { columns?: Array<{ name: string; type: string; categories: string[] }>; estimatedRows?: number | null } }>(sql`
    SELECT c.name AS connector, a.location, a.name, a.pii_categories AS categories, a.sensitivity, a.attributes
      FROM ai_discovered_assets a JOIN ai_connectors c ON c.id = a.connector_id
     WHERE a.engagement_id = ${engagementId} AND a.asset_type = 'table' AND c.connector_type = 'postgres_database'
     ORDER BY a.location`);
  return r.rows.map((x) => ({
    connector: x.connector, location: x.location, name: x.name, categories: x.categories ?? [], sensitivity: x.sensitivity,
    rows: typeof x.attributes?.estimatedRows === "number" && x.attributes.estimatedRows > 0 ? x.attributes.estimatedRows : null,
    columns: x.attributes?.columns ?? [],
  }));
}

export async function loadLandscapeInput(db: RequestDb, engagementId: string): Promise<LandscapeInput | null> {
  const next = await nextTemplateToProcess(db, engagementId, "DATA-INVENTORY");
  if (!next) return null;
  const { row, data } = next;
  const scope = await latestParsed(db, engagementId, "SCOPE-INTAKE");
  const org: Record<string, { value: string; row: number }> = {};
  for (const f of scope?.data.forms["Organisation"] ?? []) org[f.key] = { value: f.answer, row: f.row };
  return {
    fileId: row.id,
    fileName: row.filename,
    uploadedAt: row.uploadedAt.toISOString(),
    uploadedBy: actorOf(row),
    activities: rows<Omit<ActRow, "_row">>(data.tables["Processing activities"]).map((r) => ({ _row: r._row, activity: r.activity, unit: r.unit, purpose: r.purpose, principals: r.principals, elements: r.elements, systems: r.systems ?? "", vendors: r.vendors ?? "", basis: r.basis, retention: r.retention, abroad: r.abroad ?? "" })),
    stores: rows<Omit<StoreRow, "_row">>(data.tables["Systems and data stores"]).map((r) => ({ _row: r._row, system: r.system, store: r.store ?? "", hosting: r.hosting, owner: r.owner ?? "" })),
    vendors: rows<Omit<VendorRow, "_row">>(data.tables["Vendors"]).map((r) => ({ _row: r._row, vendor: r.vendor, service: r.service, data: r.data, contract: r.contract, country: r.country ?? "" })),
    discovered: await loadDiscoveredTables(db, engagementId),
    practices: (data.forms["Practices"] ?? []).map((p): FormAns => ({ ref: p.ref, key: p.key, label: p.label, row: p.row, answer: p.answer, document: p.document })),
    scope: scope
      ? {
          org,
          fileName: scope.row.filename,
          registrations: rows<Omit<RegRow, "_row">>(scope.data.tables["Registrations"]).map((r) => ({ _row: r._row, registration: r.registration, regulator: r.regulator, number: r.number ?? "", status: r.status })),
          units: rows<Omit<UnitRow, "_row">>(scope.data.tables["Business units"]).map((r) => ({ _row: r._row, name: r.name, does: r.does, head: r.head, personal: r.personal, staff: r.staff ?? "" })),
        }
      : null,
  };
}

const day = () => new Date().toISOString().slice(0, 10);

export async function loadFindingsNeedingActions(db: RequestDb, engagementId: string, maxChars = 4000): Promise<Array<{ input: RemediationPlanInput; by: string | null }>> {
  const r = await db.execute<{ id: string; title: string; description: string | null; severity: string; released_at: Date | null; created_by: string | null; code: string | null; ctitle: string | null }>(sql`
    SELECT f.id, f.title, f.description, f.severity::text AS severity, f.released_at, f.created_by, c.code, c.title AS ctitle
      FROM findings f
      LEFT JOIN LATERAL (SELECT rc.control_id FROM finding_risks fr JOIN risk_controls rc ON rc.risk_id = fr.risk_id WHERE fr.finding_id = f.id LIMIT 1) rcx ON true
      LEFT JOIN controls c ON c.id = rcx.control_id
     WHERE f.engagement_id = ${engagementId} AND f.released_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM remediation_findings rf WHERE rf.finding_id = f.id)
     ORDER BY f.created_at`);
  return r.rows.map((x) => ({
    by: x.created_by,
    input: { findingId: x.id, title: x.title, description: (x.description ?? "").slice(0, maxChars), severity: x.severity as RiskTier, controlCode: x.code, controlTitle: x.ctitle, releasedAt: x.released_at ? new Date(x.released_at).toISOString() : null, today: day() },
  }));
}

const norm = (s: string) => s.toLowerCase().replace(/^(fix|remediate):\s*/i, "").replace(/\s+/g, " ").trim();

export async function loadClosureInputs(db: RequestDb, engagementId: string): Promise<{ fileId: string; inputs: ClosureInput[]; unmatched: Array<{ row: number; action: string }> } | null> {
  const next = await nextTemplateToProcess(db, engagementId, "CLOSURE-PACK");
  if (!next) return null;
  const { row, data } = next;
  const acts = await db.execute<{ id: string; title: string; description: string | null; priority: string | null; status: string }>(sql`
    SELECT id, title, description, priority::text AS priority, status::text AS status FROM remediation_actions WHERE engagement_id = ${engagementId}`);
  const proofs = await readSupportTexts(db, engagementId, 7, "proof_file", 8000);
  const inputs: ClosureInput[] = [];
  const unmatched: Array<{ row: number; action: string }> = [];
  for (const r of rows<{ action: string; done: string; date: string; by: string; proof: string }>(data.tables["Closures"])) {
    const want = norm(r.action);
    const a = acts.rows.find((x) => norm(x.title) === want) ?? acts.rows.find((x) => norm(x.title).includes(want) || want.includes(norm(x.title)));
    if (!a) { unmatched.push({ row: r._row, action: r.action }); continue; }
    const p = proofs.find((x) => x.filename.toLowerCase() === r.proof.trim().toLowerCase());
    inputs.push({
      actionId: a.id, actionTitle: a.title, actionDescription: a.description ?? "", priority: a.priority, status: a.status,
      claim: { done: r.done, date: r.date, by: r.by, proofFile: r.proof, row: r._row },
      closureFileId: row.id, closureFileName: row.filename, uploadedAt: row.uploadedAt.toISOString(), uploadedBy: actorOf(row),
      proof: p ? { fileId: p.id, filename: p.filename, text: p.text, method: p.method, uploadedBy: p.uploadedBy, uploadedAt: p.uploadedAt } : null,
      now: new Date().toISOString(),
    });
  }
  return { fileId: row.id, inputs, unmatched };
}
