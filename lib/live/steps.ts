import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { findings } from "@/db/schema";
import { enqueueJob, type JobKind } from "@/lib/ai/queue";
import { loadEngagementIds } from "@/lib/ai/settings";
import { recordEvent } from "@/lib/ai/events";
import { NotFoundOrForbiddenError, hasEngagementPermission } from "@/lib/authorization/service";
import { receiveSupportFile, receiveTemplateFile, type FileInput } from "@/lib/intake/store";
import { ensureAssessment, loadControlTests, reconcileEvidence } from "@/lib/intake/load";
import { createEngagementScope, lockEngagementScope } from "@/lib/domain/applicability";
import { finalizeAssessment } from "@/lib/domain/assessments";
import { releaseFindings } from "@/lib/workspace/review";
import { mimeFor } from "@/lib/live/mime";
import { phaseOf } from "./config";
import { sql } from "drizzle-orm";

type Scope = { engagementId: string; organisationId: string };

export interface StepReport { ok: boolean; message: string; details?: string[] }

export const RUN_STEPS = {
  "1": { kind: "intake_scope", payload: {}, label: "Read the scope form" },
  "2": { kind: "intake_landscape", payload: {}, label: "Read the data inventory" },
  "3": { kind: "plan", payload: {}, label: "Decide applicability" },
  "4": { kind: "plan", payload: { full: true }, label: "Rate the controls from the tests" },
  "5": { kind: "plan", payload: { full: true }, label: "Review the evidence and re-rate" },
  "6": { kind: "plan", payload: { full: true }, label: "Draft findings" },
  "7a": { kind: "remediation_plan", payload: {}, label: "Plan the remediation actions" },
  "7b": { kind: "closure_check", payload: {}, label: "Check the proof files" },
  "7c": { kind: "plan", payload: { full: true }, label: "Draft the final report" },
} as const satisfies Record<string, { kind: JobKind; payload: Record<string, unknown>; label: string }>;
export type RunStep = keyof typeof RUN_STEPS;
export const isRunStep = (s: string): s is RunStep => s in RUN_STEPS;

/** Queues one AI job. The worker picks it up within a second or two. */
export async function runStep(db: RequestDb, userId: string, scope: Scope, step: RunStep): Promise<StepReport> {
  if (!(await hasEngagementPermission(db, userId, scope.engagementId, "ai.supervise"))) {
    return { ok: false, message: "Only a Primus team member who supervises the AI can start it. The client's upload is saved, and the Primus team runs the AI step." };
  }
  const ids = await loadEngagementIds(db, scope.engagementId, scope.organisationId);
  const def = RUN_STEPS[step];
  const id = await enqueueJob(db, { ...ids, kind: def.kind, payload: { ...def.payload }, dedupeKey: `${def.kind}-${step}-${Date.now()}`, requestedBy: userId });
  if (!id) return { ok: false, message: "That AI step is already queued." };
  await recordEvent(db, { ...ids, eventType: "run_requested", actorType: "human", actorUserId: userId, message: `Started: ${def.label}.` });
  return { ok: true, message: `${def.label}: the AI has started. Watch the live log.` };
}

/** A filled template (and, for phase 4, the tests it contains) goes in. */
export async function uploadTemplate(db: RequestDb, userId: string, scope: Scope, phase: number, file: FileInput): Promise<StepReport> {
  const def = phaseOf(phase);
  if (!def.template) return { ok: false, message: "This phase takes no template." };
  const { result } = await receiveTemplateFile(db, userId, { ...scope, template: def.template, file });
  if (!result.ok) {
    return { ok: false, message: `${file.filename} was refused. ${result.summary}`, details: result.issues.slice(0, 6).map((i) => `${i.sheet ? `${i.sheet}, ` : ""}${i.row ? `row ${i.row}, ` : ""}${i.column ? `${i.column}: ` : ""}${i.message}`) };
  }
  if (phase === 4) {
    try {
      const loaded = await loadControlTests(db, userId, scope);
      return { ok: true, message: `${file.filename} passed the template check. ${loaded.lines.join(" ")}`, details: loaded.issues.map((i) => i.text) };
    } catch {
      return { ok: true, message: `${file.filename} passed the template check, but the tests could not be recorded yet. Finish Phase 3 (lock the scope) first, then press "Load the tests".` };
    }
  }
  if (phase === 5) return withLinking(db, userId, scope, `${file.filename} passed the template check (${result.stats.rows} rows read).`);
  return { ok: true, message: `${file.filename} passed the template check (${result.stats.rows} rows read). Ready for the AI.` };
}

/** Phase 5: files are linked to the controls the index names as soon as both the index and the files are in. */
async function withLinking(db: RequestDb, userId: string, scope: Scope, lead: string): Promise<StepReport> {
  try {
    const r = await reconcileEvidence(db, userId, scope);
    const tail = r.created ? r.lines.join(" ") : "Files are linked to their controls once the Evidence Index and the files are both in and the assessment is open.";
    return { ok: true, message: `${lead} ${tail}`, details: r.issues.map((i) => i.text) };
  } catch {
    return { ok: true, message: `${lead} Linking to controls will happen when the assessment is open.` };
  }
}

export async function uploadSupport(db: RequestDb, userId: string, scope: Scope, phase: number, files: FileInput[]): Promise<StepReport> {
  const role = phaseOf(phase).support?.role;
  if (!role) return { ok: false, message: "This phase takes no supporting files." };
  for (const f of files) await receiveSupportFile(db, userId, { ...scope, phase, role, file: { ...f, mimeType: f.mimeType || mimeFor(f.filename) } });
  const lead = `${files.length} file${files.length === 1 ? "" : "s"} received.`;
  return phase === 5 ? withLinking(db, userId, scope, lead) : { ok: true, message: lead };
}

/** Phase 4 and 5: reads the uploaded test log / evidence index and creates the records, as the person who uploaded them. */
export async function loadUploads(db: RequestDb, userId: string, scope: Scope, phase: number): Promise<StepReport> {
  if (phase === 4) {
    const r = await loadControlTests(db, userId, scope);
    return { ok: true, message: r.created ? r.lines.join(" ") : "No new test log from you is waiting to be loaded.", details: r.issues.map((i) => i.text) };
  }
  if (phase === 5) {
    const primus = await hasEngagementPermission(db, userId, scope.engagementId, "ai.supervise");
    const r = await reconcileEvidence(db, userId, scope, { anyUploader: primus });
    return { ok: true, message: r.created ? r.lines.join(" ") : (await alreadyLinked(db, scope.engagementId)) ? "All uploaded files are already linked to their controls. Go on to the AI review." : "Nothing to link yet. Upload the Evidence Index and the files first.", details: r.issues.map((i) => i.text) };
  }
  return { ok: false, message: "Nothing to load in this phase." };
}

export async function scopeStep(db: RequestDb, userId: string, scope: Scope, step: "create" | "lock"): Promise<StepReport> {
  if (step === "create") {
    await createEngagementScope(db, userId, { engagementId: scope.engagementId });
    return { ok: true, message: "The scope was created with every control listed as undecided. Now run the AI." };
  }
  const r = await db.execute<{ id: string }>(sql`SELECT id FROM engagement_scopes WHERE engagement_id = ${scope.engagementId} AND status = 'draft' ORDER BY created_at DESC LIMIT 1`);
  const id = r.rows[0]?.id;
  if (!id) return { ok: false, message: "There is no open scope to lock." };
  await lockEngagementScope(db, userId, { engagementScopeId: id });
  await ensureAssessment(db, userId, scope.engagementId, scope.organisationId);
  return { ok: true, message: "The scope is locked and the assessment is open. Phase 4 can start." };
}

export async function releaseAll(db: RequestDb, userId: string, scope: Scope): Promise<StepReport> {
  const rows = await db.select({ id: findings.id }).from(findings).where(and(eq(findings.engagementId, scope.engagementId), isNull(findings.releasedAt)));
  if (!rows.length) return { ok: false, message: "No findings are waiting to be released." };
  const r = await releaseFindings(db, userId, { engagementId: scope.engagementId, findingIds: rows.map((x) => x.id) });
  return { ok: true, message: `${r.released} finding${r.released === 1 ? "" : "s"} released to the client.` };
}

export async function finalise(db: RequestDb, userId: string, scope: Scope): Promise<StepReport> {
  const r = await db.execute<{ id: string }>(sql`SELECT id FROM assessments WHERE engagement_id = ${scope.engagementId} AND status = 'draft' ORDER BY created_at DESC LIMIT 1`);
  const id = r.rows[0]?.id;
  if (!id) return { ok: false, message: "There is no open assessment to finalise." };
  await finalizeAssessment(db, userId, { organisationId: scope.organisationId, engagementId: scope.engagementId, assessmentId: id });
  return { ok: true, message: "The assessment is finalised. Now ask the AI to draft the final report." };
}

export { NotFoundOrForbiddenError };


async function alreadyLinked(db: RequestDb, engagementId: string): Promise<boolean> {
  const r = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM evidence WHERE engagement_id = ${engagementId}`);
  return Number(r.rows[0]?.n ?? 0) > 0;
}
