import "server-only";
import { sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { listIntakeFiles, type IntakeFileRow } from "@/lib/intake/store";
import { getEngagementSectors } from "@/lib/domain/sectors";
import { SECTORS } from "@/lib/regulation";
import { PHASES } from "./config";

export type PhaseState = "waiting" | "ready" | "working" | "needs_person" | "done";

export interface Fact { label: string; value: string }
export interface WaitingItem { id: string; kind: string; title: string; summary: string; routingReason: string | null; gate: string | null; confidence: number; tier: string }
export interface PhaseStatus {
  n: number;
  state: PhaseState;
  files: IntakeFileRow[];
  facts: Fact[];
  waiting: WaitingItem[];
  autoApplied: number;
  decided: number;
  /** Plain words for the state badge. */
  stateText: string;
}
export interface LiveConnector {
  id: string;
  name: string;
  type: string;
  status: string;
  lastMessage: string | null;
  lastRunAt: string | null;
  tables: Array<{ location: string; categories: string[]; sensitivity: string; rows: number | null }>;
}
export interface LiveStatus {
  phases: PhaseStatus[];
  connectors: LiveConnector[];
  jobs: { queued: number; running: number; failed: number; failedMessages: string[] };
  events: Array<{ id: string; at: string; type: string; actor: string; message: string }>;
  scopeId: string | null;
  scopeStatus: string | null;
  assessmentId: string | null;
  assessmentStatus: string | null;
  unreleasedFindings: number;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

export async function loadLiveStatus(db: RequestDb, userId: string, scope: { engagementId: string; organisationId: string }, canSeeAi: boolean): Promise<LiveStatus> {
  const e = scope.engagementId;
  const files = await listIntakeFiles(db, userId, scope);
  const sectors = await getEngagementSectors(db, userId, scope);

  const one = async (q: ReturnType<typeof sql>): Promise<Row> => ((await db.execute<Row>(q)).rows[0] ?? {}) as Row;
  const [units, acts, procs, systems, stores, elements, purposes, scopeRow, tests, evid, finds, actions, assess, issued, disc] = await Promise.all([
    one(sql`SELECT count(*)::int AS n FROM business_units WHERE organisation_id = ${scope.organisationId}`),
    one(sql`SELECT count(*)::int AS n FROM processing_activities WHERE engagement_id = ${e}`),
    one(sql`SELECT count(*)::int AS n FROM processors WHERE organisation_id = ${scope.organisationId}`),
    one(sql`SELECT count(*)::int AS n FROM systems WHERE organisation_id = ${scope.organisationId}`),
    one(sql`SELECT count(*)::int AS n FROM data_stores WHERE organisation_id = ${scope.organisationId}`),
    one(sql`SELECT count(*)::int AS n FROM personal_data_elements WHERE organisation_id = ${scope.organisationId}`),
    one(sql`SELECT count(*)::int AS n FROM purposes WHERE organisation_id = ${scope.organisationId}`),
    one(sql`SELECT s.id, s.status::text AS status,
              count(c.*) FILTER (WHERE c.decision = 'applicable')::int AS applicable,
              count(c.*) FILTER (WHERE c.decision = 'not_applicable')::int AS not_applicable,
              count(c.*) FILTER (WHERE c.decision IS NULL OR c.decision::text = 'undecided')::int AS undecided
         FROM engagement_scopes s LEFT JOIN engagement_scope_controls c ON c.engagement_scope_id = s.id
        WHERE s.engagement_id = ${e} GROUP BY s.id, s.status ORDER BY s.created_at DESC LIMIT 1`),
    one(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE result::text = 'fail')::int AS failed FROM control_tests WHERE engagement_id = ${e}`),
    one(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE review_status::text = 'accepted')::int AS accepted, count(*) FILTER (WHERE review_status::text = 'rejected')::int AS rejected FROM evidence WHERE engagement_id = ${e}`),
    one(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE released_at IS NOT NULL)::int AS released, count(*) FILTER (WHERE severity::text = 'critical')::int AS critical FROM findings WHERE engagement_id = ${e}`),
    one(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE status::text IN ('validated','closed'))::int AS closed, count(*) FILTER (WHERE status::text = 'in_progress')::int AS wip FROM remediation_actions WHERE engagement_id = ${e}`),
    one(sql`SELECT a.id, a.status::text AS status,
              count(r.*) FILTER (WHERE r.effectiveness_rating::text = 'implemented')::int AS implemented,
              count(r.*) FILTER (WHERE r.effectiveness_rating::text = 'partially_implemented')::int AS partial,
              count(r.*) FILTER (WHERE r.effectiveness_rating::text = 'not_implemented')::int AS not_implemented
         FROM assessments a LEFT JOIN assessment_controls ac ON ac.assessment_id = a.id LEFT JOIN assessment_responses r ON r.assessment_control_id = ac.id
        WHERE a.engagement_id = ${e} GROUP BY a.id, a.status ORDER BY a.created_at DESC LIMIT 1`),
    one(sql`SELECT count(*)::int AS n FROM ai_report_issuances WHERE engagement_id = ${e}`),
    one(sql`SELECT status::text AS status FROM engagement_discovery WHERE engagement_id = ${e}`),
  ]);

  // suggestions by kind and status
  const sg = (await db.execute<Row>(sql`SELECT id, kind, status, title, summary, routing_reason, gate, confidence::float8 AS confidence, risk_tier FROM ai_suggestions WHERE engagement_id = ${e} ORDER BY created_at`)).rows;
  const jobsRows = (await db.execute<Row>(sql`SELECT status, kind, error FROM ai_jobs WHERE engagement_id = ${e} AND status IN ('queued','running','failed') ORDER BY created_at DESC LIMIT 20`)).rows;
  const jobsByKind = (kinds: string[]) => jobsRows.filter((j) => kinds.includes(String(j.kind)));

  const evRows = canSeeAi
    ? (await db.execute<Row>(sql`SELECT id, created_at, event_type, actor_type, message FROM ai_events WHERE engagement_id = ${e} ORDER BY created_at DESC LIMIT 60`)).rows.map((r) => ({ id: String(r.id), at: new Date(String(r.created_at)).toISOString(), type: String(r.event_type), actor: String(r.actor_type), message: String(r.message) }))
    : (await db.execute<Row>(sql`SELECT id, occurred_at AS created_at, kind, summary FROM engagement_activity WHERE engagement_id = ${e} ORDER BY occurred_at DESC LIMIT 60`)).rows.map((r) => ({ id: String(r.id), at: new Date(String(r.created_at)).toISOString(), type: String(r.kind), actor: "human", message: String(r.summary) }));

  const sectorNames = sectors.map((s) => SECTORS.find((x) => x.key === s)?.label ?? s);
  const hasScope = Boolean(scopeRow.id);
  const locked = String(scopeRow.status ?? "") === "locked";
  const factsBy: Record<number, Fact[]> = {
    1: [
      { label: "Sectors applied", value: sectorNames.length ? sectorNames.join(", ") : "none yet" },
      { label: "Business units created", value: String(n(units.n)) },
    ],
    2: [
      { label: "Processing activities", value: String(n(acts.n)) },
      { label: "Systems · data stores", value: `${n(systems.n)} · ${n(stores.n)}` },
      { label: "Vendors (processors)", value: String(n(procs.n)) },
      { label: "Purposes · data elements", value: `${n(purposes.n)} · ${n(elements.n)}` },
      { label: "Questionnaire", value: disc.status ? String(disc.status).replace(/_/g, " ") : "not started" },
    ],
    3: hasScope
      ? [
          { label: "Scope", value: locked ? "locked" : "open" },
          { label: "Controls that apply", value: String(n(scopeRow.applicable)) },
          { label: "Not applicable", value: String(n(scopeRow.not_applicable)) },
          { label: "Not yet decided", value: String(n(scopeRow.undecided)) },
        ]
      : [{ label: "Scope", value: "not created yet" }],
    4: [
      { label: "Tests loaded", value: String(n(tests.n)) },
      { label: "Failed tests", value: String(n(tests.failed)) },
    ],
    5: [
      { label: "Evidence files linked", value: String(n(evid.n)) },
      { label: "Accepted · rejected", value: `${n(evid.accepted)} · ${n(evid.rejected)}` },
      { label: "Controls implemented", value: String(n(assess.implemented)) },
      { label: "Partly · not implemented", value: `${n(assess.partial)} · ${n(assess.not_implemented)}` },
    ],
    6: [
      { label: "Findings", value: String(n(finds.n)) },
      { label: "Critical", value: String(n(finds.critical)) },
      { label: "Released to the client", value: String(n(finds.released)) },
    ],
    7: [
      { label: "Remediation actions", value: String(n(actions.n)) },
      { label: "Closed (validated)", value: String(n(actions.closed)) },
      { label: "Sent back, in progress", value: String(n(actions.wip)) },
      { label: "Assessment", value: assess.status ? String(assess.status) : "not started" },
      { label: "Final report", value: n(issued.n) ? "issued" : "not issued" },
    ],
  };

  const phases: PhaseStatus[] = PHASES.map((p) => {
    const mine = sg.filter((s) => p.kinds.includes(String(s.kind)));
    // Phase 5 and 4 both touch ratings; show a rating suggestion under phase 5 only when evidence exists.
    const own = p.n === 4 ? mine.filter((s) => String(s.kind) === "rating") : p.n === 5 ? sg.filter((s) => String(s.kind) === "evidence_review" || String(s.kind) === "rating") : mine;
    const waiting: WaitingItem[] = own
      .filter((s) => s.status === "pending_review")
      .map((s) => ({ id: String(s.id), kind: String(s.kind), title: String(s.title), summary: String(s.summary ?? ""), routingReason: s.routing_reason ? String(s.routing_reason) : null, gate: s.gate ? String(s.gate) : null, confidence: n(s.confidence), tier: String(s.risk_tier) }));
    const autoApplied = own.filter((s) => s.status === "auto_applied").length;
    const decided = own.filter((s) => ["approved", "overridden", "rejected"].includes(String(s.status))).length;
    const phaseFiles = files.filter((f) => f.phase === p.n);
    const running = jobsByKind(p.n === 3 ? ["plan", "applicability"] : p.n === 1 ? ["intake_scope"] : p.n === 2 ? ["intake_landscape", "connector_test", "connector_scan"] : p.n === 7 ? ["remediation_plan", "closure_check", "report_issue"] : ["plan", "rating", "evidence_review", "finding_create"]).some((j) => j.status === "queued" || j.status === "running");
    let done = false;
    let started = phaseFiles.length > 0 || own.length > 0;
    switch (p.n) {
      case 1: done = sectors.length > 0 && n(units.n) > 0; break;
      case 2: done = n(acts.n) > 0 && String(disc.status ?? "") !== "" && own.some((s) => String(s.kind) === "discovery_prefill" && ["approved", "overridden", "auto_applied"].includes(String(s.status))); break;
      case 3: done = locked; started = hasScope; break;
      case 4: done = n(tests.n) > 0 && sg.some((s) => String(s.kind) === "rating"); break;
      case 5: done = n(evid.n) > 0 && sg.some((s) => String(s.kind) === "evidence_review") && !waiting.length; break;
      case 6: done = n(finds.n) > 0 && n(finds.released) === n(finds.n) && !waiting.length; started = n(finds.n) > 0 || own.length > 0; break;
      case 7: done = n(issued.n) > 0; started = n(actions.n) > 0 || phaseFiles.length > 0; break;
    }
    const state: PhaseState = running ? "working" : waiting.length ? "needs_person" : done ? "done" : started ? "ready" : "waiting";
    const stateText = { working: "AI is working", needs_person: `${waiting.length} waiting for a person`, done: "Done", ready: "Ready for the next step", waiting: "Not started" }[state];
    return { n: p.n, state, files: phaseFiles, facts: factsBy[p.n] ?? [], waiting, autoApplied, decided, stateText };
  });

  const connectors: LiveConnector[] = [];
  if (canSeeAi) {
    const cs = (await db.execute<Row>(sql`SELECT id, name, connector_type, status::text AS status, last_test_message, last_run_at FROM ai_connectors WHERE engagement_id = ${e} ORDER BY name`)).rows;
    for (const c of cs) {
      const ts = (await db.execute<Row>(sql`SELECT location, pii_categories, sensitivity, attributes FROM ai_discovered_assets WHERE connector_id = ${String(c.id)}::uuid AND asset_type = 'table' ORDER BY (cardinality(pii_categories) = 0), location`)).rows;
      connectors.push({
        id: String(c.id), name: String(c.name), type: String(c.connector_type), status: String(c.status),
        lastMessage: c.last_test_message ? String(c.last_test_message) : null,
        lastRunAt: c.last_run_at ? new Date(String(c.last_run_at)).toISOString() : null,
        tables: ts.map((t) => {
          const est = (t.attributes as { estimatedRows?: number | null } | null)?.estimatedRows;
          return { location: String(t.location), categories: (t.pii_categories as string[]) ?? [], sensitivity: String(t.sensitivity), rows: typeof est === "number" && est > 0 ? est : null };
        }),
      });
    }
  }

  return {
    phases,
    connectors,
    jobs: {
      queued: jobsRows.filter((j) => j.status === "queued").length,
      running: jobsRows.filter((j) => j.status === "running").length,
      failed: jobsRows.filter((j) => j.status === "failed").length,
      failedMessages: jobsRows.filter((j) => j.status === "failed").map((j) => `${j.kind}: ${j.error ?? "failed"}`).slice(0, 3),
    },
    events: evRows,
    scopeId: scopeRow.id ? String(scopeRow.id) : null,
    scopeStatus: scopeRow.status ? String(scopeRow.status) : null,
    assessmentId: assess.id ? String(assess.id) : null,
    assessmentStatus: assess.status ? String(assess.status) : null,
    unreleasedFindings: n(finds.n) - n(finds.released),
  };
}
