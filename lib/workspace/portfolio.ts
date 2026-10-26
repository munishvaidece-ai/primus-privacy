import "server-only";
import { sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { daysUntil } from "./common";
import { SECTIONS } from "./discovery-sections";

// ---------------------------------------------------------------------------
// Engagement phase and progress are DERIVED from the records, never stored,
// so they can never disagree with the work itself.
// ---------------------------------------------------------------------------

export const PHASES = ["Draft", "Discovery", "Assessment", "Validation", "Reporting", "Remediation", "Closed"] as const;
export type Phase = (typeof PHASES)[number];

export interface EngagementMetrics {
  id: string;
  name: string;
  engagementType: string;
  status: "draft" | "active" | "closed";
  periodStart: string | null;
  periodEnd: string | null;
  organisationId: string;
  organisationName: string;
  industry: string | null;
  hqLocation: string | null;
  discoveryStatus: "none" | "in_progress" | "submitted" | "approved";
  discoveryDone: number;
  assessmentId: string | null;
  assessmentStatus: "draft" | "finalized" | null;
  assessmentSubmitted: boolean;
  questionsTotal: number;
  questionsAnswered: number;
  questionsValidated: number;
  findingsOpen: number;
  findingsCriticalHigh: number;
  findingsDraft: number;
  remediationTotal: number;
  remediationClosed: number;
  reportsReleased: number;
  tasksOpen: number;
  tasksOverdue: number;
  evidencePending: number;
  evidenceRequestsOpen: number;
  clarificationsOpen: number;
  phase: Phase;
  /** 0-100. Discovery 20 + answers 30 + validation 20 + report 10 + remediation 20. */
  progress: number;
}

export function derivePhase(m: Pick<EngagementMetrics, "status" | "discoveryStatus" | "assessmentId" | "assessmentStatus" | "assessmentSubmitted" | "questionsTotal" | "questionsAnswered" | "reportsReleased">): Phase {
  if (m.status === "closed") return "Closed";
  if (m.status === "draft") return "Draft";
  if (m.reportsReleased > 0) return "Remediation";
  if (m.discoveryStatus !== "approved" && !m.assessmentId) return "Discovery";
  if (m.discoveryStatus !== "approved" && m.questionsAnswered === 0) return "Discovery";
  if (m.assessmentStatus === "finalized") return "Reporting";
  if (m.assessmentSubmitted) return "Validation";
  return "Assessment";
}

export function deriveProgress(m: Pick<EngagementMetrics, "discoveryDone" | "discoveryStatus" | "questionsTotal" | "questionsAnswered" | "questionsValidated" | "reportsReleased" | "remediationTotal" | "remediationClosed" | "status">): number {
  if (m.status === "closed") return 100;
  const disc = m.discoveryStatus === "approved" ? 1 : Math.min(1, m.discoveryDone / SECTIONS.length);
  const ans = m.questionsTotal ? m.questionsAnswered / m.questionsTotal : 0;
  const val = m.questionsTotal ? m.questionsValidated / m.questionsTotal : 0;
  const rep = m.reportsReleased > 0 ? 1 : 0;
  const rem = m.remediationTotal ? m.remediationClosed / m.remediationTotal : 0;
  return Math.round(disc * 20 + ans * 30 + val * 20 + rep * 10 + rem * 20);
}

type MetricsRow = {
  id: string; name: string; engagement_type: string; status: "draft" | "active" | "closed";
  period_start: string | null; period_end: string | null; organisation_id: string; organisation_name: string;
  industry: string | null; hq_location: string | null; discovery_status: string; discovery_done: number;
  assessment_id: string | null; assessment_status: "draft" | "finalized" | null; assessment_submitted: boolean;
  q_total: number; q_answered: number; q_validated: number;
  f_open: number; f_ch: number; f_draft: number; r_total: number; r_closed: number; reports: number;
  t_open: number; t_overdue: number; ev_pending: number; evr_open: number; cl_open: number;
};

/**
 * One row per engagement the caller can see (row security does the scoping),
 * with every number the portfolio screens show. Counts of findings are the
 * ones the caller is allowed to see: a client never counts a draft finding.
 */
export async function engagementMetrics(db: RequestDb, opts: { engagementId?: string; organisationId?: string } = {}): Promise<EngagementMetrics[]> {
  const eng = opts.engagementId ? sql`and e.id = ${opts.engagementId}::uuid` : sql``;
  const org = opts.organisationId ? sql`and e.organisation_id = ${opts.organisationId}::uuid` : sql``;
  const res = await db.execute<MetricsRow>(sql`
    select e.id, e.name, e.engagement_type::text, e.status::text as status, e.period_start::text, e.period_end::text,
           e.organisation_id, o.name as organisation_name, o.industry, o.hq_location,
           coalesce(d.status, 'none') as discovery_status,
           (select count(*)::int from discovery_sections s where s.engagement_id = e.id and s.completed_at is not null) as discovery_done,
           a.id as assessment_id, a.status::text as assessment_status, (a.submitted_at is not null) as assessment_submitted,
           coalesce(q.total, 0)::int as q_total, coalesce(q.answered, 0)::int as q_answered, coalesce(q.validated, 0)::int as q_validated,
           (select count(*)::int from findings f where f.engagement_id = e.id and f.status in ('open','in_progress')) as f_open,
           (select count(*)::int from findings f where f.engagement_id = e.id and f.status in ('open','in_progress') and f.severity in ('high','critical')) as f_ch,
           (select count(*)::int from findings f where f.engagement_id = e.id and f.released_at is null) as f_draft,
           (select count(*)::int from remediation_actions r where r.engagement_id = e.id) as r_total,
           (select count(*)::int from remediation_actions r where r.engagement_id = e.id and r.status = 'closed') as r_closed,
           (select count(*)::int from report_releases rr where rr.engagement_id = e.id) as reports,
           (select count(*)::int from engagement_tasks t where t.engagement_id = e.id and t.status = 'open') as t_open,
           (select count(*)::int from engagement_tasks t where t.engagement_id = e.id and t.status = 'open' and t.due_date < current_date) as t_overdue,
           (select count(*)::int from evidence v where v.engagement_id = e.id and v.review_status = 'pending_review') as ev_pending,
           (select count(*)::int from evidence_requests er where er.engagement_id = e.id and er.status = 'requested') as evr_open,
           (select count(*)::int from clarifications c where c.engagement_id = e.id and c.status <> 'closed') as cl_open
      from engagements e
      join organisations o on o.id = e.organisation_id
      left join engagement_discovery d on d.engagement_id = e.id
      left join lateral (
        select x.id, x.status, x.submitted_at from assessments x where x.engagement_id = e.id order by x.created_at desc, x.id desc limit 1
      ) a on true
      left join lateral (
        select count(*) filter (where coalesce(r.effectiveness_rating::text, 'not_assessed') <> 'not_applicable') as total,
               count(*) filter (where r.effectiveness_rating not in ('not_applicable','not_assessed')) as answered,
               count(*) filter (where r.effectiveness_rating <> 'not_applicable' and r.validated_at is not null) as validated
          from assessment_controls ac
          left join assessment_responses r on r.assessment_control_id = ac.id
         where ac.assessment_id = a.id
      ) q on a.id is not null
     where true ${eng} ${org}
     order by o.name, e.created_at desc
  `);
  return res.rows.map((r) => {
    const base = {
      id: r.id, name: r.name, engagementType: r.engagement_type, status: r.status, periodStart: r.period_start, periodEnd: r.period_end,
      organisationId: r.organisation_id, organisationName: r.organisation_name, industry: r.industry, hqLocation: r.hq_location,
      discoveryStatus: r.discovery_status as EngagementMetrics["discoveryStatus"], discoveryDone: r.discovery_done,
      assessmentId: r.assessment_id, assessmentStatus: r.assessment_status, assessmentSubmitted: r.assessment_submitted,
      questionsTotal: r.q_total, questionsAnswered: r.q_answered, questionsValidated: r.q_validated,
      findingsOpen: r.f_open, findingsCriticalHigh: r.f_ch, findingsDraft: r.f_draft,
      remediationTotal: r.r_total, remediationClosed: r.r_closed, reportsReleased: r.reports,
      tasksOpen: r.t_open, tasksOverdue: r.t_overdue, evidencePending: r.ev_pending, evidenceRequestsOpen: r.evr_open, clarificationsOpen: r.cl_open,
    };
    return { ...base, phase: derivePhase(base), progress: deriveProgress(base) };
  });
}

// ---------------------------------------------------------------------------
// Organisations and portfolio summary
// ---------------------------------------------------------------------------
export interface OrganisationOverview {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  hqLocation: string | null;
  engagements: number;
  activeEngagements: number;
  phase: Phase | null;
  progress: number | null;
  criticalHigh: number;
  openTasks: number;
  latestEngagementId: string | null;
}

export async function organisationOverviews(db: RequestDb): Promise<OrganisationOverview[]> {
  const orgs = await db.execute<{ id: string; name: string; status: string; industry: string | null; hq_location: string | null }>(
    sql`select id, name, status::text as status, industry, hq_location from organisations order by name`,
  );
  const metrics = await engagementMetrics(db);
  return orgs.rows.map((o) => {
    const ms = metrics.filter((m) => m.organisationId === o.id);
    const live = ms.find((m) => m.status === "active") ?? ms[0] ?? null;
    return {
      id: o.id, name: o.name, status: o.status, industry: o.industry, hqLocation: o.hq_location,
      engagements: ms.length, activeEngagements: ms.filter((m) => m.status === "active").length,
      phase: live?.phase ?? null, progress: live?.progress ?? null,
      criticalHigh: ms.reduce((n, m) => n + m.findingsCriticalHigh, 0),
      openTasks: ms.reduce((n, m) => n + m.tasksOpen, 0),
      latestEngagementId: live?.id ?? null,
    };
  });
}

export interface PortfolioSummary {
  organisations: number;
  activeEngagements: number;
  criticalHigh: number;
  awaitingReview: { assessments: number; evidence: number; discovery: number; clarifications: number };
  overdueTasks: number;
  draftFindings: number;
  byPhase: { phase: Phase; count: number }[];
}

export function summarise(orgCount: number, metrics: EngagementMetrics[]): PortfolioSummary {
  const live = metrics.filter((m) => m.status !== "closed");
  return {
    organisations: orgCount,
    activeEngagements: metrics.filter((m) => m.status === "active").length,
    criticalHigh: metrics.reduce((n, m) => n + m.findingsCriticalHigh, 0),
    awaitingReview: {
      assessments: metrics.filter((m) => m.assessmentSubmitted && m.assessmentStatus === "draft").length,
      evidence: metrics.reduce((n, m) => n + m.evidencePending, 0),
      discovery: metrics.filter((m) => m.discoveryStatus === "submitted").length,
      clarifications: metrics.reduce((n, m) => n + m.clarificationsOpen, 0),
    },
    overdueTasks: metrics.reduce((n, m) => n + m.tasksOverdue, 0),
    draftFindings: metrics.reduce((n, m) => n + m.findingsDraft, 0),
    byPhase: PHASES.map((phase) => ({ phase, count: live.filter((m) => m.phase === phase).length + (phase === "Closed" ? metrics.filter((m) => m.phase === "Closed").length : 0) })).filter((p) => p.phase !== "Closed" || p.count > 0),
  };
}

// ---------------------------------------------------------------------------
// "What to do next" for a client: built from the real records, not a script.
// ---------------------------------------------------------------------------
export interface NextStep { label: string; detail: string; href: string }

export function clientNextSteps(m: EngagementMetrics): NextStep[] {
  const steps: NextStep[] = [];
  if (m.discoveryStatus === "none" || m.discoveryStatus === "in_progress") {
    steps.push({ label: "Complete the discovery questionnaire", detail: `${m.discoveryDone} of ${SECTIONS.length} sections done`, href: "/portal/discovery" });
  }
  if (m.evidenceRequestsOpen > 0) {
    steps.push({ label: "Provide the evidence requested", detail: `${m.evidenceRequestsOpen} request${m.evidenceRequestsOpen === 1 ? "" : "s"} waiting on you`, href: "/portal/evidence" });
  }
  if (m.assessmentId && m.assessmentStatus === "draft" && !m.assessmentSubmitted && m.questionsTotal > 0) {
    steps.push({ label: "Answer the assessment questions", detail: `${m.questionsAnswered} of ${m.questionsTotal} answered`, href: "/portal/assessment" });
  }
  if (m.clarificationsOpen > 0) {
    steps.push({ label: "Reply to open clarifications", detail: `${m.clarificationsOpen} open`, href: "/portal/clarifications" });
  }
  if (m.tasksOpen > 0) {
    steps.push({ label: "Finish your tasks", detail: `${m.tasksOpen} open${m.tasksOverdue ? `, ${m.tasksOverdue} overdue` : ""}`, href: "/portal/tasks" });
  }
  if (m.remediationTotal > m.remediationClosed) {
    steps.push({ label: "Work through remediation actions", detail: `${m.remediationTotal - m.remediationClosed} still open`, href: "/portal/remediation" });
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Stakeholders: everyone with a role in the engagements / organisations the
// caller can see, with the role, the scope and whether they are Primus or client.
// ---------------------------------------------------------------------------
export interface StakeholderRow {
  userId: string;
  email: string;
  displayName: string | null;
  side: "primus" | "client";
  role: string;
  scope: "organisation" | "engagement";
  organisationId: string;
  organisationName: string;
  engagementId: string;
  engagementName: string;
}

export async function listStakeholders(db: RequestDb, opts: { engagementId?: string } = {}): Promise<StakeholderRow[]> {
  const only = opts.engagementId ? sql`where e.id = ${opts.engagementId}::uuid` : sql``;
  const res = await db.execute<{
    user_id: string; email: string; display_name: string | null; is_client: boolean; role: string; scope: "organisation" | "engagement";
    organisation_id: string; organisation_name: string; engagement_id: string; engagement_name: string;
  }>(sql`
    select s.user_id, s.email, s.display_name, s.is_client, s.role, s.scope,
           e.organisation_id, o.name as organisation_name, e.id as engagement_id, e.name as engagement_name
      from engagements e
      join organisations o on o.id = e.organisation_id
      cross join lateral public.list_engagement_stakeholders(e.id) s
      ${only}
     order by o.name, e.name, s.is_client, s.role, s.email
     limit 2000
  `);
  return res.rows.map((r) => ({
    userId: r.user_id, email: r.email, displayName: r.display_name, side: r.is_client ? "client" : "primus", role: r.role, scope: r.scope,
    organisationId: r.organisation_id, organisationName: r.organisation_name, engagementId: r.engagement_id, engagementName: r.engagement_name,
  }));
}

// ---------------------------------------------------------------------------
// Cross-engagement lists (every query below runs under the caller's row security)
// ---------------------------------------------------------------------------
export interface CrossFinding {
  id: string; title: string; severity: string; status: string; releasedAt: Date | null; createdAt: Date;
  ownerEmail: string | null; engagementId: string; engagementName: string; organisationId: string; organisationName: string;
}
export async function listAllFindings(db: RequestDb): Promise<CrossFinding[]> {
  const r = await db.execute<{ id: string; title: string; severity: string; status: string; released_at: Date | null; created_at: Date; owner_email: string | null; engagement_id: string; engagement_name: string; organisation_id: string; organisation_name: string }>(sql`
    select f.id, f.title, f.severity::text, f.status::text, f.released_at, f.created_at, u.email as owner_email,
           f.engagement_id, e.name as engagement_name, f.organisation_id, o.name as organisation_name
      from findings f join engagements e on e.id = f.engagement_id join organisations o on o.id = f.organisation_id
      left join users u on u.id = f.owner_id
     order by (f.released_at is null) desc, case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, f.created_at desc
     limit 1000`);
  return r.rows.map((x) => ({ id: x.id, title: x.title, severity: x.severity, status: x.status, releasedAt: x.released_at ? new Date(x.released_at) : null, createdAt: new Date(x.created_at), ownerEmail: x.owner_email, engagementId: x.engagement_id, engagementName: x.engagement_name, organisationId: x.organisation_id, organisationName: x.organisation_name }));
}

export interface CrossRisk {
  id: string; title: string; inherent: string; residual: string | null; status: string;
  likelihood: number | null; impact: number | null; engagementId: string; engagementName: string; organisationId: string; organisationName: string; ownerEmail: string | null;
}
export async function listAllRisks(db: RequestDb, opts: { engagementId?: string } = {}): Promise<CrossRisk[]> {
  const w = opts.engagementId ? sql`where r.engagement_id = ${opts.engagementId}::uuid` : sql``;
  const r = await db.execute<{ id: string; title: string; inherent_rating: string; residual_rating: string | null; status: string; likelihood: number | null; impact: number | null; engagement_id: string; engagement_name: string; organisation_id: string; organisation_name: string; owner_email: string | null }>(sql`
    select r.id, r.title, r.inherent_rating::text, r.residual_rating::text, r.status::text, r.likelihood, r.impact,
           r.engagement_id, e.name as engagement_name, r.organisation_id, o.name as organisation_name, u.email as owner_email
      from risks r join engagements e on e.id = r.engagement_id join organisations o on o.id = r.organisation_id
      left join users u on u.id = r.owner_id ${w}
     order by case r.inherent_rating when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, r.created_at desc
     limit 1000`);
  return r.rows.map((x) => ({ id: x.id, title: x.title, inherent: x.inherent_rating, residual: x.residual_rating, status: x.status, likelihood: x.likelihood, impact: x.impact, engagementId: x.engagement_id, engagementName: x.engagement_name, organisationId: x.organisation_id, organisationName: x.organisation_name, ownerEmail: x.owner_email }));
}

export interface CrossRemediation {
  id: string; title: string; status: string; priority: string | null; dueDate: string | null; ownerEmail: string | null;
  engagementId: string; engagementName: string; organisationId: string; organisationName: string; overdue: boolean;
}
export async function listAllRemediation(db: RequestDb, opts: { engagementId?: string } = {}): Promise<CrossRemediation[]> {
  const w = opts.engagementId ? sql`where a.engagement_id = ${opts.engagementId}::uuid` : sql``;
  const r = await db.execute<{ id: string; title: string; status: string; priority: string | null; due_date: string | null; owner_email: string | null; engagement_id: string; engagement_name: string; organisation_id: string; organisation_name: string }>(sql`
    select a.id, a.title, a.status::text, a.priority::text, a.due_date::text, u.email as owner_email,
           a.engagement_id, e.name as engagement_name, a.organisation_id, o.name as organisation_name
      from remediation_actions a join engagements e on e.id = a.engagement_id join organisations o on o.id = a.organisation_id
      left join users u on u.id = a.owner_id ${w}
     order by (a.status = 'closed'), a.due_date nulls last, a.created_at desc
     limit 1000`);
  return r.rows.map((x) => ({ id: x.id, title: x.title, status: x.status, priority: x.priority, dueDate: x.due_date, ownerEmail: x.owner_email, engagementId: x.engagement_id, engagementName: x.engagement_name, organisationId: x.organisation_id, organisationName: x.organisation_name, overdue: x.status !== "closed" && x.status !== "validated" && (daysUntil(x.due_date) ?? 0) < 0 && x.due_date !== null }));
}

export interface CrossEvidence {
  id: string; title: string; evidenceType: string; reviewStatus: string; collectedAt: Date; fileName: string | null;
  uploaderEmail: string | null; engagementId: string; engagementName: string; organisationId: string; organisationName: string; assessmentId: string | null;
}
/** Evidence the caller can see, with the review queue first. Internal-only items stay hidden from clients by the existing policy plus the visibility filter. */
export async function listAllEvidence(db: RequestDb, opts: { engagementId?: string; clientOnly?: boolean } = {}): Promise<CrossEvidence[]> {
  const w = opts.engagementId ? sql`and v.engagement_id = ${opts.engagementId}::uuid` : sql``;
  const vis = opts.clientOnly ? sql`and v.visibility = 'client_visible'` : sql``;
  const r = await db.execute<{ id: string; title: string; evidence_type: string; review_status: string; collected_at: Date; file_name: string | null; uploader_email: string | null; engagement_id: string; engagement_name: string; organisation_id: string; organisation_name: string; assessment_id: string | null }>(sql`
    select v.id, v.title, v.evidence_type::text, v.review_status::text, v.collected_at, dv.original_filename as file_name, u.email as uploader_email,
           v.engagement_id, e.name as engagement_name, v.organisation_id, o.name as organisation_name,
           (select ac.assessment_id from evidence_links l join assessment_responses ar on ar.id = l.assessment_response_id join assessment_controls ac on ac.id = ar.assessment_control_id where l.evidence_id = v.id limit 1) as assessment_id
      from evidence v
      join document_versions dv on dv.id = v.document_version_id
      join engagements e on e.id = v.engagement_id join organisations o on o.id = v.organisation_id
      left join users u on u.id = v.created_by
     where v.engagement_id is not null ${w} ${vis}
     order by (v.review_status = 'pending_review') desc, v.collected_at desc
     limit 1000`);
  return r.rows.map((x) => ({ id: x.id, title: x.title, evidenceType: x.evidence_type, reviewStatus: x.review_status, collectedAt: new Date(x.collected_at), fileName: x.file_name, uploaderEmail: x.uploader_email, engagementId: x.engagement_id, engagementName: x.engagement_name, organisationId: x.organisation_id, organisationName: x.organisation_name, assessmentId: x.assessment_id }));
}

// ---------------------------------------------------------------------------
// Activity feed (row security already hides Primus-only lines from clients)
// ---------------------------------------------------------------------------
export interface ActivityRow { id: string; summary: string; kind: string; occurredAt: Date; actorName: string | null; engagementId: string; engagementName: string; organisationName: string }

export async function recentActivity(db: RequestDb, opts: { engagementId?: string; limit?: number } = {}): Promise<ActivityRow[]> {
  const w = opts.engagementId ? sql`where a.engagement_id = ${opts.engagementId}::uuid` : sql``;
  const r = await db.execute<{ id: string; summary: string; kind: string; occurred_at: Date; actor_name: string | null; engagement_id: string; engagement_name: string; organisation_name: string }>(sql`
    select a.id, a.summary, a.kind, a.occurred_at, coalesce(nullif(u.display_name, ''), u.email) as actor_name,
           a.engagement_id, e.name as engagement_name, o.name as organisation_name
      from engagement_activity a
      join engagements e on e.id = a.engagement_id join organisations o on o.id = a.organisation_id
      left join users u on u.id = a.actor_user_id ${w}
     order by a.occurred_at desc limit ${opts.limit ?? 15}`);
  return r.rows.map((x) => ({ id: x.id, summary: x.summary, kind: x.kind, occurredAt: new Date(x.occurred_at), actorName: x.actor_name, engagementId: x.engagement_id, engagementName: x.engagement_name, organisationName: x.organisation_name }));
}

export interface CrossAssessment {
  id: string; periodLabel: string; assessmentType: string; status: "draft" | "finalized"; submittedAt: Date | null;
  total: number; answered: number; validated: number;
  engagementId: string; engagementName: string; organisationId: string; organisationName: string;
}
export async function listAllAssessments(db: RequestDb): Promise<CrossAssessment[]> {
  const r = await db.execute<{ id: string; period_label: string; assessment_type: string; status: "draft" | "finalized"; submitted_at: Date | null; total: number; answered: number; validated: number; engagement_id: string; engagement_name: string; organisation_id: string; organisation_name: string }>(sql`
    select a.id, a.period_label, a.assessment_type::text, a.status::text as status, a.submitted_at,
           coalesce(q.total,0)::int as total, coalesce(q.answered,0)::int as answered, coalesce(q.validated,0)::int as validated,
           a.engagement_id, e.name as engagement_name, a.organisation_id, o.name as organisation_name
      from assessments a join engagements e on e.id = a.engagement_id join organisations o on o.id = a.organisation_id
      left join lateral (
        select count(*) filter (where coalesce(r.effectiveness_rating::text, 'not_assessed') <> 'not_applicable') as total,
               count(*) filter (where r.effectiveness_rating not in ('not_applicable','not_assessed')) as answered,
               count(*) filter (where r.effectiveness_rating <> 'not_applicable' and r.validated_at is not null) as validated
          from assessment_controls ac left join assessment_responses r on r.assessment_control_id = ac.id where ac.assessment_id = a.id
      ) q on true
     order by (a.submitted_at is not null and a.status = 'draft') desc, a.created_at desc limit 500`);
  return r.rows.map((x) => ({ id: x.id, periodLabel: x.period_label, assessmentType: x.assessment_type, status: x.status, submittedAt: x.submitted_at ? new Date(x.submitted_at) : null, total: x.total, answered: x.answered, validated: x.validated, engagementId: x.engagement_id, engagementName: x.engagement_name, organisationId: x.organisation_id, organisationName: x.organisation_name }));
}
