import "server-only";
import type { RequestDb } from "@/lib/db/request-client";
import { aiEvents } from "@/db/schema";

export interface EventInput {
  tenantId: string;
  organisationId: string;
  engagementId: string;
  suggestionId?: string | null;
  jobId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  eventType: string;
  actorType: "ai" | "human" | "system";
  actorUserId?: string | null;
  message: string;
  detail?: Record<string, unknown>;
}

/** Appends a human-readable line to the engagement's AI audit trail. */
export async function recordEvent(db: RequestDb, e: EventInput): Promise<void> {
  await db.insert(aiEvents).values({
    tenantId: e.tenantId,
    organisationId: e.organisationId,
    engagementId: e.engagementId,
    suggestionId: e.suggestionId ?? null,
    jobId: e.jobId ?? null,
    subjectType: e.subjectType ?? null,
    subjectId: e.subjectId ?? null,
    eventType: e.eventType,
    actorType: e.actorType,
    actorUserId: e.actorUserId ?? null,
    message: e.message,
    detail: e.detail ?? {},
  });
}
