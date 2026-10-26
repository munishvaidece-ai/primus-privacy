import "server-only";
import { z } from "zod";
import { withRequestDb, type RequestDb } from "@/lib/db/request-client";
import { readAiConfig } from "./config";
import { runTask } from "./engine";
import { recordEvent } from "./events";
import { enqueueJob, type ClaimedJob, type JobKind } from "./queue";
import { chooseProvider } from "./providers";
import { getAiSettings } from "./settings";
import { recordSuggestion, withSavepoint, type RecordContext, type RecordOutcome } from "./suggestions";
import type { EngagementAiSettings } from "./types";
import {
  assessmentControlsForEvidence,
  loadApplicabilityInput,
  loadCase,
  loadEvidenceReviewInput,
  loadFindingInput,
  loadLandscapeProfile,
  loadOpenCases,
  loadRatableAssessmentControls,
  loadRatingInput,
  loadReportInput,
  loadUndecidedScopeControls,
  loadWeakRatedAssessmentControls,
  loadFinalizedAssessmentsWithoutIssuance,
} from "./context";
import { evidenceReviewDraft, evidenceReviewTask } from "./tasks/evidence-review";
import { applicabilitySources, caseSources, evidenceReviewSources, findingSources, ratingSources, reportSources, withSources } from "./sources";
import { actorMap } from "./provenance";
import { applicabilityDraft, applicabilityTask } from "./tasks/applicability";
import { ratingDraft, ratingTask } from "./tasks/rating";
import { findingDraft, findingTask } from "./tasks/finding";
import { reportDraft, reportTask } from "./tasks/report";
import { breachDrafts, breachTask, consentDraft, consentTask, rightsDraft, rightsTask, vendorDraft, vendorTask } from "./tasks/ops";
import { aiSuggestions } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { runConnectorJob } from "@/lib/connectors/run";
import { markProcessed } from "@/lib/intake/store";
import { loadClosureInputs, loadFindingsNeedingActions, loadLandscapeInput, loadScopeInput } from "./intake-context";
import { scopeIntakeTask, scopeSectorDraft, scopeUnitsDraft } from "./tasks/scope-intake";
import { discoveryPrefillDraft, landscapeLoadDraft, landscapeTask } from "./tasks/landscape";
import { closureDraft, closureTask, remediationPlanDraft, remediationPlanSources, remediationPlanTask } from "./tasks/remediation";

const CHUNK: Record<string, number> = { evidence_review: 5, applicability: 50, rating: 25, finding_create: 25, report_issue: 5, ops_case: 10 };

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

interface Run {
  db: RequestDb;
  job: ClaimedJob;
  agentUserId: string;
  settings: EngagementAiSettings;
  rctx: RecordContext;
  choice: ReturnType<typeof chooseProvider>;
  cfg: ReturnType<typeof readAiConfig>;
}

interface Tally {
  considered: number;
  applied: number;
  queued: number;
  duplicate: number;
  failed: number;
  errors: string[];
}
const newTally = (): Tally => ({ considered: 0, applied: 0, queued: 0, duplicate: 0, failed: 0, errors: [] });
function tally(t: Tally, o: RecordOutcome) {
  if (o.outcome === "applied") t.applied++;
  else if (o.outcome === "queued") t.queued++;
  else if (o.outcome === "duplicate") t.duplicate++;
  else t.failed++;
}

async function enqueueFollowUp(run: Run, kind: JobKind, ids: string[], subjectType?: string) {
  let n = 0;
  for (const part of chunks([...new Set(ids)], CHUNK[kind] ?? 25)) {
    const id = await enqueueJob(run.db, {
      tenantId: run.settings.tenantId,
      organisationId: run.settings.organisationId,
      engagementId: run.settings.engagementId,
      kind,
      subjectType,
      payload: { ids: part },
      requestedBy: run.agentUserId,
    });
    if (id) n++;
  }
  return n;
}

async function perSubject<T>(run: Run, t: Tally, ids: string[], label: string, fn: (id: string) => Promise<T | null>): Promise<T[]> {
  const out: T[] = [];
  // Demo pace: a short pause after each item so a live audience can watch the work arrive. Zero in real use.
  const pace = Number(process.env.AI_DEMO_PACE_MS ?? 0);
  for (const id of ids) {
    if (pace > 0 && t.considered > 0) await new Promise((r) => setTimeout(r, pace));
    t.considered++;
    try {
      const r = await withSavepoint(run.db, "ai_subject", () => fn(id));
      if (r !== null) out.push(r);
    } catch (e) {
      t.failed++;
      const msg = e instanceof Error ? e.message.slice(0, 300) : "error";
      t.errors.push(`${label} ${id}: ${msg}`);
      await recordEvent(run.db, {
        tenantId: run.settings.tenantId,
        organisationId: run.settings.organisationId,
        engagementId: run.settings.engagementId,
        jobId: run.job.id,
        subjectId: id,
        eventType: "task_failed",
        actorType: "system",
        message: `${label} failed for one item: ${msg}`,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ handlers
async function handlePlan(run: Run): Promise<Record<string, unknown>> {
  const { db, settings } = run;
  const full = run.job.payload.full === true;
  const e = settings.engagementId;
  const counts: Record<string, number> = {};

  const evRows = await db.execute<{ id: string }>(
    // pending evidence that nobody (human or AI) has a live suggestion for
    // only evidence that supports a control (proof attached to a remediation action is checked by the closure check instead)
    sql`SELECT e.id FROM evidence e WHERE e.engagement_id = ${e} AND e.review_status = 'pending_review'
      AND EXISTS (SELECT 1 FROM evidence_links l WHERE l.evidence_id = e.id AND l.subject_type IN ('assessment_response','control_test'))
      AND NOT EXISTS (SELECT 1 FROM ai_suggestions s WHERE s.kind = 'evidence_review' AND s.subject_id = e.id AND s.status NOT IN ('failed','superseded'))`,
  );
  counts.evidence = await enqueueFollowUp(run, "evidence_review", evRows.rows.map((r) => r.id), "evidence");
  counts.applicability = await enqueueFollowUp(run, "applicability", await loadUndecidedScopeControls(db, e), "engagement_scope_control");
  const cases = await loadOpenCases(db, e);
  counts.cases = await enqueueFollowUp(run, "ops_case", cases.map((c) => c.id), "ops_case");
  if (full) {
    counts.ratings = await enqueueFollowUp(run, "rating", await loadRatableAssessmentControls(db, e), "assessment_control");
    counts.findings = await enqueueFollowUp(run, "finding_create", await loadWeakRatedAssessmentControls(db, e), "assessment_control");
    counts.reports = await enqueueFollowUp(run, "report_issue", await loadFinalizedAssessmentsWithoutIssuance(db, e), "assessment");
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  await recordEvent(db, {
    tenantId: settings.tenantId,
    organisationId: settings.organisationId,
    engagementId: e,
    jobId: run.job.id,
    eventType: "planned",
    actorType: "ai",
    actorUserId: run.agentUserId,
    message: total ? `Planned ${total} batch(es) of work: ${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ")}.` : "Looked for work and found nothing new to do.",
  });
  return { counts };
}

async function handleEvidenceReview(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const ids = (run.job.payload.ids as string[]) ?? [];
  const affected: string[] = [];
  await perSubject(run, t, ids, "Evidence review", async (id) => {
    const input = await loadEvidenceReviewInput(run.db, id, run.cfg.maxInputChars);
    if (!input) return null;
    const r = await runTask(evidenceReviewTask, input, run.choice);
    const o = await recordSuggestion(run.db, { ...run.rctx, provider: { label: r.provider, model: r.model } }, withSources(evidenceReviewDraft(input, r.output), evidenceReviewSources(input)));
    tally(t, o);
    if (o.outcome === "applied") affected.push(...(await assessmentControlsForEvidence(run.db, id)));
    return o;
  });
  const followUps = affected.length ? await enqueueFollowUp(run, "rating", affected, "assessment_control") : 0;
  return { ...t, followUps };
}

async function handleApplicability(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const ids = (run.job.payload.ids as string[]) ?? [];
  const profile = await loadLandscapeProfile(run.db, run.settings.engagementId);
  await perSubject(run, t, ids, "Applicability", async (id) => {
    const input = await loadApplicabilityInput(run.db, id, profile);
    if (!input) return null;
    const r = await runTask(applicabilityTask, input, run.choice);
    const o = await recordSuggestion(run.db, { ...run.rctx, provider: { label: r.provider, model: r.model } }, withSources(applicabilityDraft(input, r.output), applicabilitySources(input)));
    tally(t, o);
    return o;
  });
  return { ...t };
}

async function handleRating(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const ids = (run.job.payload.ids as string[]) ?? [];
  const weak: string[] = [];
  await perSubject(run, t, ids, "Rating", async (id) => {
    const input = await loadRatingInput(run.db, id);
    if (!input) return null;
    const r = await runTask(ratingTask, input, run.choice);
    const o = await recordSuggestion(run.db, { ...run.rctx, provider: { label: r.provider, model: r.model } }, withSources(ratingDraft(input, r.output), ratingSources(input)));
    tally(t, o);
    if (o.outcome === "applied" && r.output.rating !== "implemented") weak.push(id);
    return o;
  });
  const followUps = weak.length ? await enqueueFollowUp(run, "finding_create", weak, "assessment_control") : 0;
  return { ...t, followUps };
}

async function handleFinding(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const ids = (run.job.payload.ids as string[]) ?? [];
  await perSubject(run, t, ids, "Finding", async (id) => {
    const [last] = await run.db
      .select({ c: aiSuggestions.confidence })
      .from(aiSuggestions)
      .where(and(eq(aiSuggestions.kind, "rating"), eq(aiSuggestions.subjectId, id), inArray(aiSuggestions.status, ["auto_applied", "approved", "overridden"])))
      .orderBy(desc(aiSuggestions.createdAt))
      .limit(1);
    const input = await loadFindingInput(run.db, id, last ? Number(last.c) : 0.8);
    if (!input) return null;
    const r = await runTask(findingTask, input, run.choice);
    const o = await recordSuggestion(run.db, { ...run.rctx, provider: { label: r.provider, model: r.model } }, withSources(findingDraft(input, r.output), findingSources(input)));
    tally(t, o);
    return o;
  });
  return { ...t };
}

async function handleReport(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const ids = (run.job.payload.ids as string[]) ?? [];
  await perSubject(run, t, ids, "Report", async (id) => {
    const input = await loadReportInput(run.db, run.agentUserId, id);
    if (!input) return null;
    const r = await runTask(reportTask, input, run.choice);
    const o = await recordSuggestion(run.db, { ...run.rctx, provider: { label: r.provider, model: r.model } }, withSources(reportDraft(input, r.output), reportSources(input)));
    tally(t, o);
    return o;
  });
  return { ...t };
}

// ops cases: details are validated before use
const rightsDetails = z.object({
  requestType: z.enum(["access", "correction", "erasure", "grievance", "nomination", "withdraw_consent"]),
  identityVerified: z.boolean().default(false),
  retentionObligation: z.boolean().default(false),
  notes: z.string().default(""),
});
const breachDetails = z.object({
  discoveredAt: z.string(),
  categories: z.array(z.string()).default([]),
  principalsAffected: z.number().int().nonnegative().nullable().default(null),
  encrypted: z.boolean().default(false),
  contained: z.boolean().default(false),
  description: z.string().default(""),
});
const consentDetails = z.object({
  consentText: z.string().default(""),
  languages: z.array(z.string()).default([]),
  preTicked: z.boolean().default(false),
  bundled: z.boolean().default(false),
  withdrawalAsEasy: z.boolean().nullable().default(null),
});
const vendorDetails = z.object({
  vendorName: z.string(),
  services: z.string().default(""),
  dataCategories: z.array(z.string()).default([]),
  answers: z.object({
    hasDpa: z.boolean().default(false),
    breachNotificationHours: z.number().nullable().default(null),
    certifications: z.array(z.string()).default([]),
    crossBorder: z.boolean().default(false),
    encryptionAtRest: z.boolean().default(false),
    deletionOnExit: z.boolean().default(false),
    auditRights: z.boolean().default(false),
    subprocessorsDisclosed: z.boolean().default(false),
  }),
});
export const OPS_DETAILS = { rights_request: rightsDetails, breach: breachDetails, consent_review: consentDetails, vendor_review: vendorDetails };

async function handleOpsCase(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const ids = (run.job.payload.ids as string[]) ?? [];
  await perSubject(run, t, ids, "Case triage", async (id) => {
    const c = await loadCase(run.db, id);
    if (!c || c.status !== "new") return null;
    const provider = (r: { provider: string; model: string }) => ({ ...run.rctx, provider: { label: r.provider, model: r.model } });
    const loggedBy = (await actorMap(run.db, c.engagementId, [c.createdBy])).get(c.createdBy ?? "") ?? null;
    const logged = (channelWord: string) => ({ actor: loggedBy, at: c.receivedAt.toISOString(), channelWord });
    if (c.caseType === "rights_request") {
      const d = rightsDetails.parse(c.details);
      const input = { caseId: c.id, reference: c.reference, receivedAt: c.receivedAt.toISOString(), ...d };
      const r = await runTask(rightsTask, input, run.choice);
      tally(t, await recordSuggestion(run.db, provider(r), withSources(rightsDraft(input, r.output), caseSources("rights", c, `Request type: ${d.requestType.replace(/_/g, " ")} · identity verified: ${d.identityVerified ? "yes" : "no"} · legal retention duty: ${d.retentionObligation ? "yes" : "no"}${d.notes ? ` · notes: ${d.notes}` : ""}`, logged("Client portal, Rights requests (or Primus, Operations)")))));
    } else if (c.caseType === "breach") {
      const d = breachDetails.parse(c.details);
      const input = { caseId: c.id, reference: c.reference, ...d };
      const r = await runTask(breachTask, input, run.choice);
      const drafts = breachDrafts(input, r.output);
      const bsrc = caseSources("breach", c, `Discovered ${d.discoveredAt.slice(0, 10)} · ${d.principalsAffected ?? "unknown number of"} people affected · data: ${d.categories.join(", ") || "not stated"} · encrypted: ${d.encrypted ? "yes" : "no"} · contained: ${d.contained ? "yes" : "no"}`, logged("Primus workspace, AI Operations Centre → Operations"));
      tally(t, await recordSuggestion(run.db, provider(r), withSources(drafts.assess, bsrc)));
      tally(t, await recordSuggestion(run.db, provider(r), withSources(drafts.notice, bsrc)));
    } else if (c.caseType === "consent_review") {
      const d = consentDetails.parse(c.details);
      const input = { caseId: c.id, reference: c.reference, ...d };
      const r = await runTask(consentTask, input, run.choice);
      tally(t, await recordSuggestion(run.db, provider(r), withSources(consentDraft(input, r.output), caseSources("consent", c, `Languages: ${d.languages.join(", ") || "not stated"} · pre-ticked: ${d.preTicked ? "yes" : "no"} · bundled with other purposes: ${d.bundled ? "yes" : "no"} · text read: ${d.consentText.slice(0, 200)}`, logged("Primus workspace, AI Operations Centre → Operations")))));
    } else if (c.caseType === "vendor_review") {
      const d = vendorDetails.parse(c.details);
      const input = { caseId: c.id, reference: c.reference, ...d };
      const r = await runTask(vendorTask, input, run.choice);
      tally(t, await recordSuggestion(run.db, provider(r), withSources(vendorDraft(input, r.output), caseSources("vendor", c, `${d.vendorName}: ${d.services || "services not stated"} · data shared: ${d.dataCategories.join(", ") || "not stated"} · vendor's answers: DPA ${d.answers.hasDpa ? "yes" : "no"}, breach notice ${d.answers.breachNotificationHours ?? "not stated"} hours, cross-border ${d.answers.crossBorder ? "yes" : "no"}`, logged("Primus workspace, AI Operations Centre → Operations")))));
    }
    return true;
  });
  return { ...t };
}

// ------------------------------------------------------- intake phases (1, 2, 7)
function ev(run: Run, eventType: string, message: string, detail?: Record<string, unknown>, subject?: { type: string; id: string }) {
  return recordEvent(run.db, {
    tenantId: run.settings.tenantId, organisationId: run.settings.organisationId, engagementId: run.settings.engagementId,
    jobId: run.job.id, subjectType: subject?.type ?? null, subjectId: subject?.id ?? null,
    eventType, actorType: "ai", actorUserId: run.agentUserId, message, detail,
  });
}

async function handleIntakeScope(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const e = run.settings.engagementId;
  const input = await loadScopeInput(run.db, run.agentUserId, e, run.settings.organisationId);
  if (!input) { await ev(run, "nothing_to_do", "No new Scope Intake Form is waiting to be read."); return { ...t, note: "no file" }; }
  await ev(run, "file_read", `Opened ${input.fileName}: ${Object.keys(input.org).length} form answers, ${input.registrations.length} registrations, ${input.units.length} business units, ${input.systems.length} systems${input.supporting.length ? `, and ${input.supporting.length} supporting document${input.supporting.length === 1 ? "" : "s"}` : ""}.`, { fileId: input.fileId });
  const r = await runTask(scopeIntakeTask, input, run.choice);
  const o = r.output;
  await ev(run, "analysed", o.brief);
  const rctx = { ...run.rctx, provider: { label: r.provider, model: r.model } };
  for (const sec of o.sectors) {
    if (input.existingSectors.includes(sec.key)) continue;
    t.considered++;
    tally(t, await recordSuggestion(run.db, rctx, scopeSectorDraft(input, e, sec)));
  }
  for (const f of o.flags) await ev(run, "flag", `Point to raise: ${f.text} (${f.at})`);
  if (o.units.length) { t.considered++; tally(t, await recordSuggestion(run.db, rctx, scopeUnitsDraft(input, e, o))); }
  await markProcessed(run.db, input.fileId, run.job.id);
  return { ...t, file: input.fileName, sectors: o.sectors.length, units: o.units.length, flags: o.flags.length };
}

async function handleIntakeLandscape(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const e = run.settings.engagementId;
  const input = await loadLandscapeInput(run.db, e);
  if (!input) { await ev(run, "nothing_to_do", "No new Data Inventory is waiting to be read."); return { ...t, note: "no file" }; }
  await ev(run, "file_read", `Opened ${input.fileName}: ${input.activities.length} processing activities, ${input.stores.length} systems, ${input.vendors.length} vendors, ${input.practices.filter((p) => p.answer.trim()).length} practice answers${input.scope ? ", and used the Scope Intake Form from phase 1" : ""}.`, { fileId: input.fileId });
  const r = await runTask(landscapeTask, input, run.choice);
  await ev(run, "analysed", r.output.brief);
  const rctx = { ...run.rctx, provider: { label: r.provider, model: r.model } };
  for (const x of r.output.issues) await ev(run, "flag", `Point to raise: ${x.text} (${x.at})`);
  t.considered++;
  tally(t, await recordSuggestion(run.db, rctx, landscapeLoadDraft(input, e, r.output)));
  const pre = discoveryPrefillDraft(input, e, r.output);
  if (pre) { t.considered++; tally(t, await recordSuggestion(run.db, rctx, pre)); }
  await markProcessed(run.db, input.fileId, run.job.id);
  return { ...t, file: input.fileName, issues: r.output.issues.length };
}

async function handleRemediationPlan(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const list = await loadFindingsNeedingActions(run.db, run.settings.engagementId, run.cfg.maxInputChars);
  if (list.length === 0) { await ev(run, "nothing_to_do", "Every released finding already has a remediation action."); return { ...t, note: "nothing" }; }
  await ev(run, "file_read", `Found ${list.length} released finding${list.length === 1 ? "" : "s"} with no remediation action.`);
  const people = await actorMap(run.db, run.settings.engagementId, list.map((x) => x.by));
  await perSubject(run, t, list.map((x) => x.input.findingId), "Remediation plan", async (id) => {
    const item = list.find((x) => x.input.findingId === id)!;
    const r = await runTask(remediationPlanTask, item.input, run.choice);
    const o = await recordSuggestion(run.db, { ...run.rctx, provider: { label: r.provider, model: r.model } }, withSources(remediationPlanDraft(item.input, r.output), remediationPlanSources(item.input, (item.by && people.get(item.by)) || null)));
    tally(t, o);
    return o;
  });
  return { ...t };
}

async function handleClosureCheck(run: Run): Promise<Record<string, unknown>> {
  const t = newTally();
  const pack = await loadClosureInputs(run.db, run.settings.engagementId);
  if (!pack) { await ev(run, "nothing_to_do", "No new Remediation Closure Log is waiting to be read."); return { ...t, note: "no file" }; }
  await ev(run, "file_read", `Opened the closure log: ${pack.inputs.length} action${pack.inputs.length === 1 ? "" : "s"} matched${pack.unmatched.length ? `, ${pack.unmatched.length} could not be matched to an action on the platform` : ""}.`, { fileId: pack.fileId });
  for (const u of pack.unmatched) await ev(run, "flag", `Row ${u.row}: "${u.action}" does not match any remediation action on the platform, so it was not checked.`);
  await perSubject(run, t, pack.inputs.map((x) => x.actionId), "Closure check", async (id) => {
    const input = pack.inputs.find((x) => x.actionId === id)!;
    await ev(run, "file_read", input.proof ? `Reading the proof "${input.proof.filename}" for "${input.actionTitle}".` : `No file named "${input.claim.proofFile}" was uploaded for "${input.actionTitle}".`);
    const r = await runTask(closureTask, input, run.choice);
    const o = await recordSuggestion(run.db, { ...run.rctx, provider: { label: r.provider, model: r.model } }, closureDraft(input, r.output));
    tally(t, o);
    return o;
  });
  await markProcessed(run.db, pack.fileId, run.job.id);
  return { ...t, unmatched: pack.unmatched.length };
}

// -------------------------------------------------------------------- entry
export async function runJob(job: ClaimedJob, agentUserId: string): Promise<Record<string, unknown>> {
  return withRequestDb(agentUserId, async (db) => {
    const settings = await getAiSettings(db, job.engagementId, job.organisationId);
    if (!settings.enabled || settings.paused) throw new Error("AI is switched off or paused for this engagement.");
    const cfg = readAiConfig();
    const choice = chooseProvider(settings.allowExternalAi, cfg);
    const rctx: RecordContext = { actorUserId: agentUserId, jobId: job.id, settings, provider: { label: choice.label, model: choice.model } };
    const run: Run = { db, job, agentUserId, settings, rctx, choice, cfg };

    let result: Record<string, unknown>;
    switch (job.kind) {
      case "plan": result = await handlePlan(run); break;
      case "evidence_review": result = await handleEvidenceReview(run); break;
      case "applicability": result = await handleApplicability(run); break;
      case "rating": result = await handleRating(run); break;
      case "finding_create": result = await handleFinding(run); break;
      case "report_issue": result = await handleReport(run); break;
      case "ops_case": result = await handleOpsCase(run); break;
      case "intake_scope": result = await handleIntakeScope(run); break;
      case "intake_landscape": result = await handleIntakeLandscape(run); break;
      case "remediation_plan": result = await handleRemediationPlan(run); break;
      case "closure_check": result = await handleClosureCheck(run); break;
      case "connector_test":
      case "connector_scan": result = await runConnectorJob(db, job, agentUserId); break;
      default: throw new Error(`Unknown job kind ${job.kind}`);
    }
    // A batch where nothing worked and something was attempted is a failure worth retrying.
    const r = result as Partial<Tally>;
    if ((r.considered ?? 0) > 0 && (r.failed ?? 0) === r.considered && (r.errors?.length ?? 0) > 0) {
      throw new Error(`All ${r.considered} item(s) failed. First error: ${r.errors![0]}`);
    }
    return result;
  });
}
