import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { engagementTasks, engagements, organisations, users } from "@/db/schema";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { WorkspaceInputError, cleanText, getViewer, loadEngagement, parseDate, type Side } from "./common";
import { emit } from "./emit";

export interface TaskRow {
  id: string;
  engagementId: string;
  organisationId: string;
  organisationName: string;
  engagementName: string;
  kind: "task" | "milestone";
  title: string;
  description: string | null;
  assigneeSide: Side;
  assigneeEmail: string | null;
  dueDate: string | null;
  status: "open" | "done" | "cancelled";
  completedAt: Date | null;
}

const selection = {
  id: engagementTasks.id,
  engagementId: engagementTasks.engagementId,
  organisationId: engagementTasks.organisationId,
  organisationName: organisations.name,
  engagementName: engagements.name,
  kind: engagementTasks.kind,
  title: engagementTasks.title,
  description: engagementTasks.description,
  assigneeSide: engagementTasks.assigneeSide,
  assigneeEmail: users.email,
  dueDate: engagementTasks.dueDate,
  status: engagementTasks.status,
  completedAt: engagementTasks.completedAt,
};

function base(db: RequestDb) {
  return db
    .select(selection)
    .from(engagementTasks)
    .innerJoin(engagements, eq(engagements.id, engagementTasks.engagementId))
    .innerJoin(organisations, eq(organisations.id, engagementTasks.organisationId))
    .leftJoin(users, eq(users.id, engagementTasks.assigneeUserId));
}

/** Tasks and milestones the caller can see (RLS hides Primus-only tasks from clients). */
export async function listTasks(db: RequestDb, opts: { engagementId?: string; status?: "open" | "done"; kind?: "task" | "milestone" } = {}): Promise<TaskRow[]> {
  const conds = [ne(engagementTasks.status, "cancelled")];
  if (opts.engagementId) conds.push(eq(engagementTasks.engagementId, opts.engagementId));
  if (opts.status) conds.push(eq(engagementTasks.status, opts.status));
  if (opts.kind) conds.push(eq(engagementTasks.kind, opts.kind));
  const rows = await base(db).where(and(...conds)).orderBy(asc(engagementTasks.dueDate), desc(engagementTasks.createdAt)).limit(500);
  return rows as TaskRow[];
}

export async function createTask(
  db: RequestDb,
  userId: string,
  input: { engagementId: string; title: unknown; description?: unknown; assigneeSide: unknown; dueDate?: unknown; kind?: "task" | "milestone" },
): Promise<{ id: string }> {
  const eng = await loadEngagement(db, userId, input.engagementId);
  const viewer = await getViewer(db, userId);
  const title = cleanText(input.title, "The title", 200);
  const description = cleanText(input.description, "The description", 2000, { required: false }) || null;
  const dueDate = parseDate(input.dueDate, "The due date", { required: input.kind === "milestone" });
  const side: Side = input.assigneeSide === "client" ? "client" : "primus";
  if (viewer.isClient && side !== "client") throw new WorkspaceInputError("You can only create tasks for your own team.");
  const kind = input.kind ?? "task";
  if (viewer.isClient && kind === "milestone") throw new WorkspaceInputError("Milestones are set by the Primus team.");
  const [row] = await db
    .insert(engagementTasks)
    .values({
      tenantId: eng.tenantId,
      organisationId: eng.organisationId,
      engagementId: eng.id,
      kind,
      title,
      description,
      assigneeSide: side,
      dueDate,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: engagementTasks.id });
  await emit(db, {
    engagementId: eng.id,
    kind: kind === "milestone" ? "milestone_added" : "task_assigned",
    summary: `${kind === "milestone" ? "Milestone" : "Task"} added: ${title}`,
    subjectType: "engagement_task",
    subjectId: row!.id,
    clientVisible: side === "client" || kind === "milestone",
    notify: side === viewer.side ? undefined : { audience: side === "client" ? "client" : "practice", title: `New task: ${title}`, link: side === "client" ? "/portal/tasks" : "/tasks" },
  });
  return { id: row!.id };
}

export async function completeTask(db: RequestDb, userId: string, taskId: string): Promise<void> {
  const [t] = await db
    .select({ id: engagementTasks.id, engagementId: engagementTasks.engagementId, title: engagementTasks.title, status: engagementTasks.status, kind: engagementTasks.kind, side: engagementTasks.assigneeSide })
    .from(engagementTasks)
    .where(eq(engagementTasks.id, taskId))
    .limit(1);
  if (!t) throw new NotFoundOrForbiddenError();
  if (t.status !== "open") throw new WorkspaceInputError("This task is already finished.");
  await db.update(engagementTasks).set({ status: "done", updatedBy: userId, updatedAt: new Date() }).where(eq(engagementTasks.id, t.id));
  await emit(db, { engagementId: t.engagementId, kind: "task_done", summary: `${t.kind === "milestone" ? "Milestone reached" : "Task done"}: ${t.title}`, subjectType: "engagement_task", subjectId: t.id, clientVisible: t.side === "client" || t.kind === "milestone" });
}

export async function cancelTask(db: RequestDb, userId: string, taskId: string): Promise<void> {
  const [t] = await db.select({ id: engagementTasks.id, status: engagementTasks.status }).from(engagementTasks).where(eq(engagementTasks.id, taskId)).limit(1);
  if (!t) throw new NotFoundOrForbiddenError();
  if (t.status !== "open") throw new WorkspaceInputError("This task is already finished.");
  await db.update(engagementTasks).set({ status: "cancelled", updatedBy: userId, updatedAt: new Date() }).where(eq(engagementTasks.id, t.id));
}

