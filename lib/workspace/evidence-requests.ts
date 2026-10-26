import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { engagements, evidence, evidenceRequests, organisations } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission } from "@/lib/authorization/service";
import { WorkspaceInputError, cleanText, loadEngagement, parseDate } from "./common";
import { actorName, emit } from "./emit";

export interface EvidenceRequestRow {
  id: string;
  reference: string | null;
  engagementId: string;
  engagementName: string;
  organisationId: string;
  organisationName: string;
  title: string;
  description: string | null;
  questionRef: string | null;
  status: "requested" | "fulfilled" | "cancelled";
  requestedAt: Date;
  dueAt: Date | null;
  fulfilledEvidenceId: string | null;
  fulfilledAt: Date | null;
}

export async function listEvidenceRequests(db: RequestDb, opts: { engagementId?: string; status?: "requested" | "fulfilled" | "cancelled" } = {}): Promise<EvidenceRequestRow[]> {
  const conds = [];
  if (opts.engagementId) conds.push(eq(evidenceRequests.engagementId, opts.engagementId));
  if (opts.status) conds.push(eq(evidenceRequests.status, opts.status));
  const rows = await db
    .select({
      id: evidenceRequests.id,
      reference: evidenceRequests.reference,
      engagementId: evidenceRequests.engagementId,
      engagementName: engagements.name,
      organisationId: evidenceRequests.organisationId,
      organisationName: organisations.name,
      title: evidenceRequests.title,
      description: evidenceRequests.description,
      questionRef: evidenceRequests.questionRef,
      status: evidenceRequests.status,
      requestedAt: evidenceRequests.requestedAt,
      dueAt: evidenceRequests.dueAt,
      fulfilledEvidenceId: evidenceRequests.fulfilledEvidenceId,
      fulfilledAt: evidenceRequests.fulfilledAt,
    })
    .from(evidenceRequests)
    .innerJoin(engagements, eq(engagements.id, evidenceRequests.engagementId))
    .innerJoin(organisations, eq(organisations.id, evidenceRequests.organisationId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(evidenceRequests.status), desc(evidenceRequests.requestedAt))
    .limit(300);
  return rows as EvidenceRequestRow[];
}

export async function requestEvidence(
  db: RequestDb,
  userId: string,
  input: { engagementId: string; title: unknown; description?: unknown; questionRef?: unknown; dueDate?: unknown },
): Promise<{ id: string }> {
  const eng = await loadEngagement(db, userId, input.engagementId);
  if (!(await hasEngagementPermission(db, userId, eng.id, "evidence.review"))) throw new NotFoundOrForbiddenError();
  const title = cleanText(input.title, "The title", 200);
  const due = parseDate(input.dueDate, "The due date");
  const [row] = await db
    .insert(evidenceRequests)
    .values({
      tenantId: eng.tenantId,
      organisationId: eng.organisationId,
      engagementId: eng.id,
      title,
      description: cleanText(input.description, "The description", 2000, { required: false }) || null,
      questionRef: cleanText(input.questionRef, "The question reference", 60, { required: false }) || null,
      requestedBy: userId,
      dueAt: due ? new Date(due + "T23:59:59Z") : null,
    })
    .returning({ id: evidenceRequests.id, reference: evidenceRequests.reference });
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: eng.id,
    kind: "evidence_requested",
    summary: `${who} requested evidence ${row!.reference}: ${title}`,
    subjectType: "evidence_request",
    subjectId: row!.id,
    clientVisible: true,
    notify: { audience: "client", title: `Evidence requested: ${title}`, body: `Reference ${row!.reference}`, link: "/portal/evidence" },
  });
  return { id: row!.id };
}

/** The client links an uploaded document to the request it answers. */
export async function fulfilEvidenceRequest(db: RequestDb, userId: string, input: { requestId: string; evidenceId: string }): Promise<void> {
  const [req] = await db.select().from(evidenceRequests).where(eq(evidenceRequests.id, input.requestId)).limit(1);
  if (!req) throw new NotFoundOrForbiddenError();
  if (req.status !== "requested") throw new WorkspaceInputError("This request is already closed.");
  const [ev] = await db.select({ id: evidence.id, engagementId: evidence.engagementId, title: evidence.title }).from(evidence).where(eq(evidence.id, input.evidenceId)).limit(1);
  if (!ev || ev.engagementId !== req.engagementId) throw new WorkspaceInputError("Choose a document uploaded to this engagement.");
  await db.update(evidenceRequests).set({ status: "fulfilled", fulfilledEvidenceId: ev.id }).where(eq(evidenceRequests.id, req.id));
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: req.engagementId,
    kind: "evidence_provided",
    summary: `${who} provided evidence for ${req.reference}: ${ev.title}`,
    subjectType: "evidence_request",
    subjectId: req.id,
    clientVisible: true,
    notify: { audience: "practice", title: `Evidence provided for ${req.reference}`, body: ev.title, link: `/evidence-review` },
  });
}

export async function cancelEvidenceRequest(db: RequestDb, userId: string, requestId: string): Promise<void> {
  const [req] = await db.select().from(evidenceRequests).where(eq(evidenceRequests.id, requestId)).limit(1);
  if (!req) throw new NotFoundOrForbiddenError();
  if (req.status !== "requested") throw new WorkspaceInputError("This request is already closed.");
  await db.update(evidenceRequests).set({ status: "cancelled" }).where(eq(evidenceRequests.id, requestId));
}
