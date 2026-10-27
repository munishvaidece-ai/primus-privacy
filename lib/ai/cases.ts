import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { assessmentControls, assessments, controls, opsCases } from "@/db/schema";
import { createRisk } from "@/lib/domain/risks";
import { createFinding } from "@/lib/domain/findings";
import { createRemediationAction } from "@/lib/domain/remediation";
import { NotFoundOrForbiddenError, hasEngagementPermission } from "@/lib/authorization/service";
import { OPS_DETAILS } from "./jobs";
import { enqueueJob } from "./queue";
import { loadEngagementIds } from "./settings";
import { recordEvent } from "./events";
import { BREACH_REPORT_HOURS, RIGHTS_RESPONSE_DAYS } from "./tasks/ops";
import { bandRating } from "./tasks/finding";

export type CaseType = "rights_request" | "breach" | "consent_review" | "vendor_review";
export const CASE_LABELS: Record<CaseType, string> = {
  rights_request: "Rights request",
  breach: "Personal data breach",
  consent_review: "Consent review",
  vendor_review: "Vendor review",
};
const PREFIX: Record<CaseType, string> = { rights_request: "RR", breach: "BR", consent_review: "CR", vendor_review: "VR" };

export class CaseInputError extends Error {}
type Scope = { engagementId: string; organisationId: string };

async function requireSupervise(db: RequestDb, userId: string, engagementId: string) {
  if (!(await hasEngagementPermission(db, userId, engagementId, "ai.supervise"))) throw new NotFoundOrForbiddenError();
}

export async function createCase(db: RequestDb, userId: string, s: Scope, input: { type: CaseType; title: string; details: unknown; receivedAt?: Date }) {
  await requireSupervise(db, userId, s.engagementId);
  const ids = await loadEngagementIds(db, s.engagementId, s.organisationId);
  const parsed = OPS_DETAILS[input.type].safeParse(input.details);
  if (!parsed.success) throw new CaseInputError(parsed.error.issues[0]?.message ?? "Some details are missing or invalid.");
  const title = input.title.trim();
  if (!title) throw new CaseInputError("Give the case a short title.");
  const receivedAt = input.receivedAt ?? new Date();
  const details = parsed.data as Record<string, unknown>;

  let dueAt: Date | null = null;
  if (input.type === "rights_request") dueAt = new Date(receivedAt.getTime() + RIGHTS_RESPONSE_DAYS * 86400_000);
  if (input.type === "breach") {
    const d = new Date(String(details.discoveredAt));
    if (Number.isNaN(d.getTime())) throw new CaseInputError("The date the breach was discovered is not valid.");
    dueAt = new Date(d.getTime() + BREACH_REPORT_HOURS * 3600_000);
  }

  const [cnt] = await db.select({ n: count() }).from(opsCases).where(and(eq(opsCases.engagementId, ids.engagementId), eq(opsCases.caseType, input.type)));
  const reference = `${PREFIX[input.type]}-${receivedAt.getUTCFullYear()}-${String(Number(cnt?.n ?? 0) + 1).padStart(4, "0")}`;
  const [row] = await db.insert(opsCases).values({ ...ids, caseType: input.type, reference, title, details, receivedAt, dueAt, createdBy: userId, updatedBy: userId }).returning();
  await recordEvent(db, { ...ids, subjectType: "ops_case", subjectId: row!.id, eventType: "case_opened", actorType: "human", actorUserId: userId, message: `${CASE_LABELS[input.type]} ${reference} opened: ${title}` });
  await enqueueJob(db, { ...ids, kind: "plan", payload: { full: false }, dedupeKey: "plan", requestedBy: userId });
  return row!;
}

export async function listCases(db: RequestDb, userId: string, s: Scope) {
  await requireSupervise(db, userId, s.engagementId);
  return db.select().from(opsCases).where(eq(opsCases.engagementId, s.engagementId)).orderBy(desc(opsCases.receivedAt)).limit(200);
}

export async function getCase(db: RequestDb, userId: string, s: Scope, caseId: string) {
  await requireSupervise(db, userId, s.engagementId);
  const [row] = await db.select().from(opsCases).where(and(eq(opsCases.id, caseId), eq(opsCases.engagementId, s.engagementId))).limit(1);
  if (!row) throw new NotFoundOrForbiddenError();
  return row;
}

/** A person edits the draft response (not allowed once approved — enforced by the database too). */
export async function saveDraftResponse(db: RequestDb, userId: string, s: Scope, caseId: string, text: string) {
  const c = await getCase(db, userId, s, caseId);
  if (c.responseApprovedAt) throw new CaseInputError("The response was already approved and can no longer be edited.");
  await db.update(opsCases).set({ draftResponse: text, updatedBy: userId, updatedAt: new Date() }).where(eq(opsCases.id, c.id));
  await recordEvent(db, { tenantId: c.tenantId, organisationId: c.organisationId, engagementId: c.engagementId, subjectType: "ops_case", subjectId: c.id, eventType: "case_draft_edited", actorType: "human", actorUserId: userId, message: `Response for ${c.reference} edited by a reviewer.` });
}

/** The human sign-off. For a breach this needs the release permission (the database enforces it as well). */
export async function approveCaseResponse(db: RequestDb, userId: string, s: Scope, caseId: string) {
  const c = await getCase(db, userId, s, caseId);
  if (c.responseApprovedAt) throw new CaseInputError("This response was already approved.");
  if (!c.draftResponse?.trim()) throw new CaseInputError("There is no draft response to approve yet.");
  if (c.caseType === "breach" && !(await hasEngagementPermission(db, userId, c.engagementId, "ai.release"))) throw new NotFoundOrForbiddenError();
  await db.update(opsCases).set({ responseApprovedAt: new Date(), responseApprovedBy: userId, status: c.status === "closed" ? c.status : "in_progress", updatedBy: userId, updatedAt: new Date() }).where(eq(opsCases.id, c.id));
  await recordEvent(db, { tenantId: c.tenantId, organisationId: c.organisationId, engagementId: c.engagementId, subjectType: "ops_case", subjectId: c.id, eventType: "case_response_approved", actorType: "human", actorUserId: userId, message: `Response for ${c.reference} approved for sending.` });
}

export async function closeCase(db: RequestDb, userId: string, s: Scope, caseId: string) {
  const c = await getCase(db, userId, s, caseId);
  await db.update(opsCases).set({ status: "closed", closedAt: new Date(), updatedBy: userId, updatedAt: new Date() }).where(eq(opsCases.id, c.id));
  await recordEvent(db, { tenantId: c.tenantId, organisationId: c.organisationId, engagementId: c.engagementId, subjectType: "ops_case", subjectId: c.id, eventType: "case_closed", actorType: "human", actorUserId: userId, message: `${c.reference} closed.` });
}

/** Systems and vendors on the organisation's data map, for picking what a breach touched. */
export async function listDataMapChoices(db: RequestDb, organisationId: string): Promise<{ systems: string[]; vendors: string[] }> {
  const names = async (q: ReturnType<typeof sql>) => (await db.execute<{ name: string }>(q)).rows.map((r) => String((r as { name: string }).name));
  const [systems, vendors] = await Promise.all([
    names(sql`SELECT name FROM system_versions WHERE organisation_id = ${organisationId} AND is_current ORDER BY name`),
    names(sql`SELECT name FROM processor_versions WHERE organisation_id = ${organisationId} AND is_current ORDER BY name`),
  ]);
  return { systems, vendors };
}

const BREACH_CONTROLS = ["BRE-01", "BRE-02"];

/**
 * Learn from a breach: raise a risk, a finding and a remediation action against the
 * breach-response control in this engagement's assessment, so the lesson shows up in the
 * normal findings and remediation flow. Needs the same permissions as raising them by hand.
 */
export async function raiseFromBreach(db: RequestDb, userId: string, s: Scope, caseId: string) {
  const c = await getCase(db, userId, s, caseId);
  if (c.caseType !== "breach") throw new CaseInputError("Only a breach can raise a finding this way.");
  const details = (c.details ?? {}) as Record<string, unknown>;
  if (details.raised) throw new CaseInputError("A finding and action were already raised from this breach.");

  const [assessment] = await db.select({ id: assessments.id }).from(assessments).where(eq(assessments.engagementId, s.engagementId)).orderBy(desc(assessments.createdAt)).limit(1);
  if (!assessment) throw new CaseInputError("There is no assessment on this engagement yet. Run the assessment first, then raise the finding.");
  const rows = await db
    .select({ controlId: assessmentControls.controlId, code: controls.code })
    .from(assessmentControls)
    .innerJoin(controls, eq(controls.id, assessmentControls.controlId))
    .where(eq(assessmentControls.assessmentId, assessment.id));
  const control = BREACH_CONTROLS.map((code) => rows.find((r) => r.code === code)).find(Boolean);
  if (!control) throw new CaseInputError("The breach-response controls (BRE-01, BRE-02) are not in this engagement's assessment, so there is nothing to attach the finding to.");

  const severity = (c.severity ?? "high") as "low" | "medium" | "high" | "critical";
  const grid: Record<string, [number, number]> = { low: [2, 2], medium: [3, 3], high: [3, 4], critical: [4, 5] };
  const [likelihood, impact] = grid[severity] ?? [3, 4];
  const rating = bandRating(likelihood, impact);
  const where = [...((details.affectedSystems as string[]) ?? []), ...((details.affectedVendors as string[]) ?? [])].join(", ");
  const title = `Breach ${c.reference}: ${c.title}`.slice(0, 200);
  const description = `A personal data breach was recorded (${c.reference}, severity ${severity}).${where ? ` Affected: ${where}.` : ""}\n\nReview how the breach happened, whether detection and response met the plan, and what must change so it does not recur.`;
  const risk = await createRisk(db, userId, { assessmentId: assessment.id, controlId: control.controlId, title, description, likelihood, impact, inherentRating: rating, residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false });
  const finding = await createFinding(db, userId, { riskId: risk.id, title, description, severity, assignOwnerToSelf: false });
  const due = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const action = await createRemediationAction(db, userId, { findingId: finding.id, title: `Post-incident review and fix for ${c.reference}`, description: "Find the root cause, fix it, test the fix, and record the lessons learned.", priority: severity, dueDate: due, assignOwnerToSelf: false });
  await db.update(opsCases).set({ details: { ...details, raised: { findingId: finding.id, remediationActionId: action.id } }, updatedBy: userId, updatedAt: new Date() }).where(eq(opsCases.id, c.id));
  await recordEvent(db, { tenantId: c.tenantId, organisationId: c.organisationId, engagementId: c.engagementId, subjectType: "ops_case", subjectId: c.id, eventType: "case_finding_raised", actorType: "human", actorUserId: userId, message: `A finding and a remediation action were raised from ${c.reference}.` });
  return { findingId: finding.id, remediationActionId: action.id };
}
