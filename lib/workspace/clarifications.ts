import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { clarificationMessages, clarifications, engagements, organisations, users } from "@/db/schema";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { WorkspaceInputError, cleanText, getViewer, loadEngagement, parseDate, type Side } from "./common";
import { actorName, emit } from "./emit";

export interface ClarificationRow {
  id: string;
  reference: string | null;
  engagementId: string;
  engagementName: string;
  organisationId: string;
  organisationName: string;
  subject: string;
  subjectType: string | null;
  subjectId: string | null;
  status: "open" | "answered" | "closed";
  raisedBySide: Side;
  raisedByEmail: string | null;
  raisedAt: Date;
  dueAt: Date | null;
  closedAt: Date | null;
}

export interface ClarificationMessageRow {
  id: string;
  authorEmail: string | null;
  authorSide: Side;
  body: string;
  createdAt: Date;
}

const selection = {
  id: clarifications.id,
  reference: clarifications.reference,
  engagementId: clarifications.engagementId,
  engagementName: engagements.name,
  organisationId: clarifications.organisationId,
  organisationName: organisations.name,
  subject: clarifications.subject,
  subjectType: clarifications.subjectType,
  subjectId: clarifications.subjectId,
  status: clarifications.status,
  raisedBySide: clarifications.raisedBySide,
  raisedByEmail: users.email,
  raisedAt: clarifications.raisedAt,
  dueAt: clarifications.dueAt,
  closedAt: clarifications.closedAt,
};

export async function listClarifications(db: RequestDb, opts: { engagementId?: string; status?: "open" | "answered" | "closed" } = {}): Promise<ClarificationRow[]> {
  const conds = [];
  if (opts.engagementId) conds.push(eq(clarifications.engagementId, opts.engagementId));
  if (opts.status) conds.push(eq(clarifications.status, opts.status));
  const rows = await db
    .select(selection)
    .from(clarifications)
    .innerJoin(engagements, eq(engagements.id, clarifications.engagementId))
    .innerJoin(organisations, eq(organisations.id, clarifications.organisationId))
    .leftJoin(users, eq(users.id, clarifications.raisedBy))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(clarifications.raisedAt))
    .limit(300);
  return rows as ClarificationRow[];
}

export async function getClarification(db: RequestDb, id: string): Promise<{ clarification: ClarificationRow; messages: ClarificationMessageRow[] }> {
  const [row] = await db
    .select(selection)
    .from(clarifications)
    .innerJoin(engagements, eq(engagements.id, clarifications.engagementId))
    .innerJoin(organisations, eq(organisations.id, clarifications.organisationId))
    .leftJoin(users, eq(users.id, clarifications.raisedBy))
    .where(eq(clarifications.id, id))
    .limit(1);
  if (!row) throw new NotFoundOrForbiddenError();
  const messages = await db
    .select({ id: clarificationMessages.id, authorEmail: users.email, authorSide: clarificationMessages.authorSide, body: clarificationMessages.body, createdAt: clarificationMessages.createdAt })
    .from(clarificationMessages)
    .leftJoin(users, eq(users.id, clarificationMessages.authorId))
    .where(eq(clarificationMessages.clarificationId, id))
    .orderBy(asc(clarificationMessages.createdAt));
  return { clarification: row as ClarificationRow, messages: messages as ClarificationMessageRow[] };
}

/** Raise a question. The first message is the question itself. */
export async function raiseClarification(
  db: RequestDb,
  userId: string,
  input: { engagementId: string; subject: unknown; question: unknown; dueDate?: unknown; subjectType?: string; subjectId?: string },
): Promise<{ id: string }> {
  const eng = await loadEngagement(db, userId, input.engagementId);
  const viewer = await getViewer(db, userId);
  const subject = cleanText(input.subject, "The subject", 300);
  const question = cleanText(input.question, "The question", 5000);
  const due = parseDate(input.dueDate, "The due date");
  const [row] = await db
    .insert(clarifications)
    .values({
      tenantId: eng.tenantId,
      organisationId: eng.organisationId,
      engagementId: eng.id,
      subject,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      raisedBy: userId,
      raisedBySide: viewer.side,
      dueAt: due ? new Date(due + "T23:59:59Z") : null,
    })
    .returning({ id: clarifications.id, reference: clarifications.reference });
  await db.insert(clarificationMessages).values({ tenantId: eng.tenantId, organisationId: eng.organisationId, engagementId: eng.id, clarificationId: row!.id, authorId: userId, authorSide: viewer.side, body: question });
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: eng.id,
    kind: "clarification_raised",
    summary: `${who} raised ${row!.reference}: ${subject}`,
    subjectType: "clarification",
    subjectId: row!.id,
    clientVisible: true,
    notify: { audience: viewer.side === "primus" ? "client" : "practice", title: `Clarification ${row!.reference}: ${subject}`, body: question.slice(0, 300), link: viewer.side === "primus" ? `/portal/clarifications/${row!.id}` : `/clarifications/${row!.id}` },
  });
  return { id: row!.id };
}

export async function replyToClarification(db: RequestDb, userId: string, input: { clarificationId: string; body: unknown }): Promise<void> {
  const { clarification } = await getClarification(db, input.clarificationId);
  if (clarification.status === "closed") throw new WorkspaceInputError("This clarification is closed.");
  const eng = await loadEngagement(db, userId, clarification.engagementId);
  const viewer = await getViewer(db, userId);
  const body = cleanText(input.body, "The reply", 5000);
  await db.insert(clarificationMessages).values({ tenantId: eng.tenantId, organisationId: eng.organisationId, engagementId: eng.id, clarificationId: clarification.id, authorId: userId, authorSide: viewer.side, body });
  const who = await actorName(db, userId);
  await emit(db, {
    engagementId: eng.id,
    kind: viewer.side === clarification.raisedBySide ? "clarification_followup" : "clarification_answered",
    summary: `${who} replied on ${clarification.reference}`,
    subjectType: "clarification",
    subjectId: clarification.id,
    clientVisible: true,
    notify: { audience: viewer.side === "primus" ? "client" : "practice", title: `New reply on ${clarification.reference}: ${clarification.subject}`, body: body.slice(0, 300), link: viewer.side === "primus" ? `/portal/clarifications/${clarification.id}` : `/clarifications/${clarification.id}` },
  });
}

export async function closeClarification(db: RequestDb, userId: string, clarificationId: string): Promise<void> {
  const { clarification } = await getClarification(db, clarificationId);
  if (clarification.status === "closed") throw new WorkspaceInputError("This clarification is already closed.");
  await db.update(clarifications).set({ status: "closed" }).where(eq(clarifications.id, clarificationId));
  const who = await actorName(db, userId);
  await emit(db, { engagementId: clarification.engagementId, kind: "clarification_closed", summary: `${who} closed ${clarification.reference}`, subjectType: "clarification", subjectId: clarificationId, clientVisible: true });
}

export async function openClarificationCounts(db: RequestDb, engagementIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (engagementIds.length === 0) return map;
  const rows = await db
    .select({ engagementId: clarifications.engagementId })
    .from(clarifications)
    .where(and(inArray(clarifications.engagementId, engagementIds), inArray(clarifications.status, ["open"])));
  for (const r of rows) map.set(r.engagementId, (map.get(r.engagementId) ?? 0) + 1);
  return map;
}
