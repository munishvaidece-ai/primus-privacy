import "server-only";
import { sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { loadEngagement, mapDbError } from "./common";

export interface AuditRow {
  id: string;
  occurredAt: Date;
  actorEmail: string | null;
  entityType: string;
  action: string;
  changedFields: string[];
}

const ENTITY_LABELS: Record<string, string> = {
  findings: "Finding", risks: "Risk", remediation_actions: "Remediation action", evidence: "Evidence", evidence_links: "Evidence link",
  assessments: "Assessment", assessment_responses: "Assessment answer", assessment_controls: "Assessment control", control_tests: "Control test",
  engagements: "Engagement", engagement_memberships: "Team member", organisation_memberships: "Organisation member", validation_records: "Validation",
  engagement_tasks: "Task", clarifications: "Clarification", engagement_discovery: "Discovery questionnaire", evidence_requests: "Evidence request",
  documents: "Document", document_versions: "Document version", processing_activities: "Processing activity", business_units: "Business unit",
  engagement_scopes: "Scope", applicability_determinations: "Applicability decision", maturity_assessments: "Maturity assessment",
  ops_cases: "Operations case", ai_suggestions: "AI suggestion", ai_engagement_settings: "AI settings", systems: "System", processors: "Processor",
  data_stores: "Data store", purposes: "Purpose", invitations: "Invitation",
};
export const entityLabel = (t: string) => ENTITY_LABELS[t] ?? t.replace(/_/g, " ");

/** The change history of one engagement. Only people with the audit permission can read it. */
export async function engagementAuditTrail(db: RequestDb, userId: string, engagementId: string, limit = 200): Promise<AuditRow[]> {
  const eng = await loadEngagement(db, userId, engagementId);
  try {
    const r = await db.execute<{ id: string; occurred_at: Date; actor_email: string | null; entity_type: string; action: string; changed_fields: string[] | null }>(
      sql`select * from public.engagement_audit_trail(${eng.id}::uuid, ${limit}::int)`,
    );
    return r.rows.map((x) => ({
      id: x.id, occurredAt: new Date(x.occurred_at), actorEmail: x.actor_email, entityType: x.entity_type, action: x.action, changedFields: x.changed_fields ?? [],
    }));
  } catch (err) {
    return mapDbError(err);
  }
}
