// Who supplied each piece of data the AI reads, and through which feature.
// Used only to build the evidence trail shown beside every AI output.
import { sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";

export interface Actor {
  name: string | null;
  side: "primus" | "client" | "system";
}

export interface EvidenceProv {
  actor: Actor;
  uploadedAt: string | null;
  filename: string | null;
  visibility: string | null;
  requestRef: string | null;
  channel: string;
}

type UserRow = { id: string; name: string | null; client_org_id: string | null; is_agent: boolean };

/** Looks up names and sides (Primus team or client) for a set of user ids. Unknown ids are simply absent. */
export async function actorMap(db: RequestDb, engagementId: string, ids: Array<string | null | undefined>): Promise<Map<string, Actor>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, Actor>();
  if (list.length === 0) return out;
  // A narrow, permission-checked function: the AI agent cannot read the users table directly.
  const r = await db.execute<UserRow>(sql`
    SELECT id, name, client_org_id, is_agent FROM public.ai_actor_names(${engagementId}::uuid, ARRAY[${sql.join(list.map((i) => sql`${i}::uuid`), sql`, `)}])`);
  for (const u of r.rows) out.set(u.id, u.is_agent ? { name: "AI agent (autopilot)", side: "system" } : { name: u.name, side: u.client_org_id ? "client" : "primus" });
  return out;
}

export function evidenceChannel(side: Actor["side"], visibility: string | null, requestRef: string | null): string {
  if (side === "client") return requestRef ? `Client portal, Evidence centre (reply to request ${requestRef})` : "Client portal, Evidence centre (upload)";
  return visibility === "consultant_internal" ? "Primus workspace, evidence upload (internal working document)" : "Primus workspace, evidence upload";
}

/** Provenance for evidence items: who uploaded the file, when, and through which feature. */
export async function evidenceProvenance(db: RequestDb, engagementId: string, evidenceIds: string[]): Promise<Map<string, EvidenceProv>> {
  const out = new Map<string, EvidenceProv>();
  const list = [...new Set(evidenceIds)];
  if (list.length === 0) return out;
  const r = await db.execute<{ id: string; visibility: string | null; filename: string | null; uploaded_at: Date | null; uploaded_by: string | null; request_ref: string | null }>(sql`
    SELECT e.id, e.visibility::text AS visibility, dv.original_filename AS filename, dv.uploaded_at, dv.uploaded_by,
           (SELECT er.reference FROM evidence_requests er WHERE er.fulfilled_evidence_id = e.id LIMIT 1) AS request_ref
      FROM evidence e JOIN document_versions dv ON dv.id = e.document_version_id
     WHERE e.id IN (${sql.join(list.map((i) => sql`${i}::uuid`), sql`, `)})`);
  const actors = await actorMap(db, engagementId, r.rows.map((x) => x.uploaded_by));
  for (const x of r.rows) {
    const actor = (x.uploaded_by && actors.get(x.uploaded_by)) || { name: null, side: "system" as const };
    out.set(x.id, {
      actor,
      uploadedAt: x.uploaded_at ? new Date(x.uploaded_at).toISOString() : null,
      filename: x.filename,
      visibility: x.visibility,
      requestRef: x.request_ref,
      channel: evidenceChannel(actor.side, x.visibility, x.request_ref),
    });
  }
  return out;
}

export const SIDE_WORDS: Record<Actor["side"], string> = { primus: "Primus team", client: "Client organisation", system: "System" };
export const who = (a: Actor | null | undefined): string => (a ? `${a.name ?? "Unknown"} (${SIDE_WORDS[a.side]})` : "Unknown");
