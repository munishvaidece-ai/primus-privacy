import "server-only";
import { sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { actorMap, evidenceChannel, type Actor } from "./provenance";
import type { Source } from "./types";

export type InventoryGroup = "documents" | "landscape" | "answers" | "tests" | "cases" | "connectors";

export interface InventoryItem {
  group: InventoryGroup;
  ref: string;
  title: string;
  detail: string;
  provider: Actor | null;
  channel: string;
  at: string | null;
  link: string | null;
  usedIn: Array<{ id: string; title: string; kind: string; status: string }>;
  /** How the AI uses this kind of data, in words. */
  how: string;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const sys: Actor = { name: null, side: "system" };

/**
 * Everything in this engagement the AI is able to read, who supplied each item,
 * how it reaches the AI, and which AI outputs have used it so far.
 */
export async function loadInventory(db: RequestDb, organisationId: string, engagementId: string): Promise<InventoryItem[]> {
  const base = `/organisations/${organisationId}/engagements/${engagementId}`;
  const items: InventoryItem[] = [];

  const sug = await db.execute<{ id: string; kind: string; title: string; status: string; subject_id: string | null; sources: Source[] }>(sql`
    SELECT id, kind, title, status::text AS status, subject_id, sources FROM ai_suggestions WHERE engagement_id = ${engagementId}`);
  const used = new Map<string, InventoryItem["usedIn"]>();
  const note = (ref: string | null | undefined, s: { id: string; kind: string; title: string; status: string }) => {
    if (!ref) return;
    const l = used.get(ref) ?? [];
    if (!l.some((x) => x.id === s.id)) l.push({ id: s.id, title: s.title, kind: s.kind, status: s.status });
    used.set(ref, l);
  };
  for (const s of sug.rows) {
    note(s.subject_id, s);
    for (const src of s.sources ?? []) note(src.ref, s);
  }

  // documents
  const ev = await db.execute<{ id: string; title: string; type: string; review: string; quality: string | null; visibility: string | null; filename: string | null; by: string | null; at: Date | null; request_ref: string | null; valid_until: Date | null; chars: number | null; method: string | null; codes: string | null }>(sql`
    SELECT e.id, e.title, e.evidence_type::text AS type, e.review_status::text AS review, e.quality_rating::text AS quality, e.visibility::text AS visibility,
           dv.original_filename AS filename, dv.uploaded_by AS by, dv.uploaded_at AS at, e.valid_until,
           (SELECT er.reference FROM evidence_requests er WHERE er.fulfilled_evidence_id = e.id LIMIT 1) AS request_ref,
           x.char_count AS chars, x.method,
           (SELECT string_agg(DISTINCT c.code, ', ') FROM evidence_links el
              LEFT JOIN assessment_responses ar ON ar.id = el.assessment_response_id
              LEFT JOIN assessment_controls ac ON ac.id = ar.assessment_control_id
              LEFT JOIN control_tests ct ON ct.id = el.control_test_id
              JOIN controls c ON c.id = COALESCE(ac.control_id, ct.control_id)
             WHERE el.evidence_id = e.id) AS codes
      FROM evidence e JOIN document_versions dv ON dv.id = e.document_version_id
      LEFT JOIN ai_document_extracts x ON x.document_version_id = dv.id
     WHERE e.engagement_id = ${engagementId} ORDER BY dv.uploaded_at DESC`);

  // people for everything below
  const pa = await db.execute<{ id: string; name: string; by: string | null; at: Date }>(sql`
    SELECT id, name, created_by AS by, created_at AS at FROM processing_activities WHERE engagement_id = ${engagementId} AND lifecycle_status <> 'retired'`);
  const ans = await db.execute<{ by: string | null; n: string; last: Date | null }>(sql`
    SELECT respondent_id AS by, count(*)::text AS n, max(updated_at) AS last FROM assessment_responses WHERE engagement_id = ${engagementId} GROUP BY respondent_id`);
  const tests = await db.execute<{ id: string; methodology: string; result: string; by: string | null; at: Date | null; code: string }>(sql`
    SELECT t.id, t.methodology, t.result::text AS result, t.tester_id AS by, t.tested_at AS at, c.code
      FROM control_tests t JOIN controls c ON c.id = t.control_id WHERE t.engagement_id = ${engagementId}`);
  const cases = await db.execute<{ id: string; reference: string; title: string; type: string; status: string; by: string | null; at: Date }>(sql`
    SELECT id, reference, title, case_type AS type, status, created_by AS by, received_at AS at FROM ops_cases WHERE engagement_id = ${engagementId} ORDER BY received_at DESC`);
  const conns = await db.execute<{ id: string; name: string; type: string; status: string; by: string | null; last: Date | null; assets: string }>(sql`
    SELECT c.id, c.name, c.connector_type AS type, c.status, c.created_by AS by, c.last_run_at AS last,
           (SELECT count(*)::text FROM ai_discovered_assets a WHERE a.connector_id = c.id) AS assets
      FROM ai_connectors c WHERE c.engagement_id = ${engagementId}`);
  const people = await actorMap(db, engagementId, [...ev.rows.map((r) => r.by), ...pa.rows.map((r) => r.by), ...ans.rows.map((r) => r.by), ...tests.rows.map((r) => r.by), ...cases.rows.map((r) => r.by), ...conns.rows.map((r) => r.by)]);
  const p = (id: string | null): Actor | null => (id ? people.get(id) ?? null : null);
  const u = (ref: string) => used.get(ref) ?? [];

  for (const r of ev.rows) {
    const prov = p(r.by);
    items.push({
      group: "documents",
      ref: r.id,
      title: r.title,
      detail: `${r.filename ?? "file"} · ${r.type.replace(/_/g, " ")} · review: ${r.review.replace(/_/g, " ")}${r.quality ? ` (${r.quality})` : ""}${r.codes ? ` · linked to ${r.codes}` : " · not linked to a control"}${r.chars ? ` · ${r.chars.toLocaleString("en-IN")} characters readable by the AI` : ""}`,
      provider: prov,
      channel: evidenceChannel(prov?.side ?? "system", r.visibility, r.request_ref),
      at: iso(r.at),
      link: "/evidence-review",
      usedIn: u(r.id),
      how: "The AI extracts the text, checks it against the linked control, and proposes accept or reject. Then it uses the accepted evidence when it rates the control.",
    });
  }
  for (const r of pa.rows) {
    items.push({
      group: "landscape",
      ref: r.id,
      title: `Processing activity: ${r.name}`,
      detail: "Part of the data landscape (what personal data the organisation handles)",
      provider: p(r.by),
      channel: "Data Landscape",
      at: iso(r.at),
      link: `${base}/data-landscape`,
      usedIn: sug.rows.filter((s) => (s.sources ?? []).some((x) => x.channel?.startsWith("Data Landscape") && x.origin.includes(p(r.by)?.name ?? "\u0000"))).map((s) => ({ id: s.id, title: s.title, kind: s.kind, status: s.status })),
      how: "The AI uses the landscape to decide whether a control applies (for example children's data or cross-border transfers).",
    });
  }
  for (const r of ans.rows) {
    const prov = p(r.by);
    items.push({
      group: "answers",
      ref: `answers:${r.by ?? "none"}`,
      title: `${r.n} assessment answer${r.n === "1" ? "" : "s"} ${prov?.side === "system" ? "set by" : "given by"} ${prov?.name ?? "unknown"}`,
      detail: "The organisation's own ratings of its controls",
      provider: prov,
      channel: prov?.side === "client" ? "Client portal, Assessment" : prov?.side === "system" ? "Written by the AI under autopilot (Rating)" : "Primus workspace, Assessment",
      at: iso(r.last),
      link: `${base}/assessments`,
      usedIn: sug.rows.filter((s) => (s.sources ?? []).some((x) => x.type === "response" && x.providedBy?.name === (prov?.name ?? "\u0000"))).map((s) => ({ id: s.id, title: s.title, kind: s.kind, status: s.status })),
      how: "The AI weighs what the organisation said against the evidence when rating, and starts from weak ratings when it drafts findings.",
    });
  }
  for (const r of tests.rows) {
    items.push({
      group: "tests",
      ref: r.id,
      title: `Control test on ${r.code}: ${r.result.replace(/_/g, " ")}`,
      detail: r.methodology,
      provider: p(r.by),
      channel: "Primus workspace, Control tests",
      at: iso(r.at),
      link: `${base}/assessments`,
      usedIn: u(r.id),
      how: "Test results carry heavy weight when the AI rates a control: a failed test lowers the rating.",
    });
  }
  for (const r of cases.rows) {
    items.push({
      group: "cases",
      ref: r.id,
      title: `${r.reference}: ${r.title}`,
      detail: `${r.type.replace(/_/g, " ")} · status ${r.status.replace(/_/g, " ")}${r.status === "new" ? " · waiting for the AI" : ""}`,
      provider: p(r.by),
      channel: r.type === "rights_request" ? "Client portal, Rights requests (or Primus, Operations)" : "Primus workspace, AI Operations Centre → Operations",
      at: iso(r.at),
      link: `${base}/ai/cases`,
      usedIn: u(r.id),
      how: "New cases are triaged: the AI works out deadlines, steps and a draft reply or notice. Only cases with status \"new\" are picked up.",
    });
  }
  for (const r of conns.rows) {
    items.push({
      group: "connectors",
      ref: r.id,
      title: `Connector: ${r.name}`,
      detail: `${r.type.replace(/_/g, " ")} · ${r.status} · ${r.assets} items found (names and kinds of personal data only, never the data itself)`,
      provider: p(r.by) ?? sys,
      channel: "AI Operations Centre → Connectors",
      at: iso(r.last),
      link: `${base}/ai/connectors`,
      usedIn: [],
      how: "Scans build the data map. They are not yet used inside AI decisions.",
    });
  }
  return items;
}

export const GROUP_LABELS: Record<InventoryGroup, string> = {
  documents: "Documents and evidence",
  landscape: "Data landscape",
  answers: "Assessment answers",
  tests: "Control tests",
  cases: "Cases (rights requests, breaches, reviews)",
  connectors: "Connector scans",
};
