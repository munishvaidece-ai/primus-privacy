import "server-only";
import { sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { WorkspaceInputError, loadEngagement, mapDbError, parseDate } from "./common";
import { actorName, emit } from "./emit";

export const REQUEST_TYPES = [
  { value: "access", label: "Access to personal data" },
  { value: "correction", label: "Correction or updating" },
  { value: "erasure", label: "Erasure" },
  { value: "grievance", label: "Grievance" },
  { value: "nomination", label: "Nomination" },
  { value: "withdraw_consent", label: "Withdrawal of consent" },
] as const;

export interface RightsRequestRow {
  id: string;
  reference: string | null;
  title: string;
  requestType: string | null;
  channel: string | null;
  receivedAt: Date;
  dueAt: Date | null;
  status: string;
  closedAt: Date | null;
}

export async function listRightsRequests(db: RequestDb, engagementId: string): Promise<RightsRequestRow[]> {
  try {
    const r = await db.execute<{
      id: string; reference: string | null; title: string; request_type: string | null; channel: string | null;
      received_at: Date; due_at: Date | null; status: string; closed_at: Date | null;
    }>(sql`select * from public.client_list_rights_requests(${engagementId}::uuid)`);
    return r.rows.map((x) => ({
      id: x.id, reference: x.reference, title: x.title, requestType: x.request_type, channel: x.channel,
      receivedAt: new Date(x.received_at), dueAt: x.due_at ? new Date(x.due_at) : null, status: x.status,
      closedAt: x.closed_at ? new Date(x.closed_at) : null,
    }));
  } catch (err) {
    return mapDbError(err);
  }
}

export async function logRightsRequest(
  db: RequestDb,
  userId: string,
  input: { engagementId: string; title: string; requestType: string; channel: string; receivedOn?: string; dueOn?: string },
): Promise<{ id: string; reference: string }> {
  const eng = await loadEngagement(db, userId, input.engagementId);
  const received = parseDate(input.receivedOn, "Received date");
  const due = parseDate(input.dueOn, "Due date");
  if (received && due && due < received) throw new WorkspaceInputError("The due date cannot be before the received date.");
  try {
    const r = await db.execute<{ id: string; reference: string }>(
      sql`select * from public.client_log_rights_request(${eng.id}::uuid, ${input.title}, ${input.requestType}, ${input.channel}, ${received ? received + "T00:00:00Z" : null}::timestamptz, ${due ? due + "T00:00:00Z" : null}::timestamptz)`,
    );
    const row = r.rows[0]!;
    const who = await actorName(db, userId);
    await emit(db, {
      engagementId: eng.id,
      kind: "rights_request_logged",
      summary: `${who} logged data-principal request ${row.reference}`,
      subjectType: "rights_request",
      subjectId: row.id,
      clientVisible: true,
    });
    return row;
  } catch (err) {
    return mapDbError(err);
  }
}

export async function setRightsStatus(db: RequestDb, userId: string, input: { caseId: string; status: "in_progress" | "closed"; engagementId: string }): Promise<void> {
  const eng = await loadEngagement(db, userId, input.engagementId);
  try {
    await db.execute(sql`select public.client_set_rights_status(${input.caseId}::uuid, ${input.status})`);
    const who = await actorName(db, userId);
    await emit(db, {
      engagementId: eng.id,
      kind: "rights_request_updated",
      summary: `${who} marked a data-principal request ${input.status === "closed" ? "closed" : "in progress"}`,
      subjectType: "rights_request",
      subjectId: input.caseId,
      clientVisible: true,
    });
  } catch (err) {
    return mapDbError(err);
  }
}
