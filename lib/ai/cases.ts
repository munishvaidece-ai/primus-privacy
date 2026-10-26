import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { opsCases } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission } from "@/lib/authorization/service";
import { OPS_DETAILS } from "./jobs";
import { enqueueJob } from "./queue";
import { loadEngagementIds } from "./settings";
import { recordEvent } from "./events";
import { BREACH_REPORT_HOURS, RIGHTS_RESPONSE_DAYS } from "./tasks/ops";

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
