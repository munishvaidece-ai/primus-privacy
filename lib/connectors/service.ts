import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { RequestDb } from "@/lib/db/request-client";
import { aiConnectorRuns, aiConnectors, aiDiscoveredAssets } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission } from "@/lib/authorization/service";
import { loadEngagementIds } from "@/lib/ai/settings";
import { enqueueJob } from "@/lib/ai/queue";
import { recordEvent } from "@/lib/ai/events";
import { connectorByType } from "./catalog";
import { IMPLEMENTATIONS } from "./registry";
import { SECRET_KEY_VERSION, encryptSecret } from "./secrets";

export class ConnectorInputError extends Error {}

type Scope = { engagementId: string; organisationId: string };

async function requireConfigure(db: RequestDb, userId: string, engagementId: string) {
  if (!(await hasEngagementPermission(db, userId, engagementId, "ai.configure"))) throw new NotFoundOrForbiddenError();
}
async function requireSupervise(db: RequestDb, userId: string, engagementId: string) {
  const ok = (await hasEngagementPermission(db, userId, engagementId, "ai.supervise")) || (await hasEngagementPermission(db, userId, engagementId, "ai.configure"));
  if (!ok) throw new NotFoundOrForbiddenError();
}

function cleanConfig(type: string, input: Record<string, string>): Record<string, string> {
  const def = connectorByType(type);
  if (!def) throw new ConnectorInputError("Unknown connector type.");
  if (def.status !== "available" || def.native || !IMPLEMENTATIONS[type]) throw new ConnectorInputError(`"${def.name}" cannot be set up yet — it is on the roadmap, not in this release.`);
  const out: Record<string, string> = {};
  for (const f of def.configFields) {
    const v = (input[f.key] ?? "").trim();
    if (f.required && !v) throw new ConnectorInputError(`${f.label} is required.`);
    if (v) out[f.key] = v;
  }
  return out;
}
function cleanSecret(type: string, input: Record<string, string>, requiredOnCreate: boolean): Record<string, string> | null {
  const def = connectorByType(type)!;
  if (def.secretFields.length === 0) return null;
  const out: Record<string, string> = {};
  for (const f of def.secretFields) {
    const v = (input[f.key] ?? "").trim();
    if (v) out[f.key] = v;
    else if (f.required && requiredOnCreate) throw new ConnectorInputError(`${f.label} is required.`);
  }
  return Object.keys(out).length ? out : null;
}

export async function listConnectors(db: RequestDb, userId: string, s: Scope) {
  await requireSupervise(db, userId, s.engagementId);
  return db.select().from(aiConnectors).where(eq(aiConnectors.engagementId, s.engagementId)).orderBy(aiConnectors.name);
}

export async function createConnector(db: RequestDb, userId: string, s: Scope, input: { type: string; name: string; config: Record<string, string>; secret: Record<string, string> }) {
  await requireConfigure(db, userId, s.engagementId);
  const ids = await loadEngagementIds(db, s.engagementId, s.organisationId);
  const name = input.name.trim();
  if (!name) throw new ConnectorInputError("Give the connector a name.");
  const config = cleanConfig(input.type, input.config);
  const secret = cleanSecret(input.type, input.secret, true);
  const cipher = secret ? encryptSecret(secret) : null; // fails early if the key is missing
  const dup = await db.select({ id: aiConnectors.id }).from(aiConnectors).where(and(eq(aiConnectors.engagementId, ids.engagementId), eq(aiConnectors.name, name))).limit(1);
  if (dup.length) throw new ConnectorInputError("A connector with that name already exists in this engagement.");
  const [row] = await db.insert(aiConnectors).values({ ...ids, connectorType: input.type, name, config, hasSecret: !!cipher, createdBy: userId, updatedBy: userId }).returning();
  if (cipher) await db.execute(sql`SELECT public.set_ai_connector_secret(${row!.id}::uuid, ${cipher}, ${SECRET_KEY_VERSION})`);
  await recordEvent(db, { ...ids, subjectType: "connector", subjectId: row!.id, eventType: "connector_added", actorType: "human", actorUserId: userId, message: `Connector "${name}" (${connectorByType(input.type)!.name}) added.` });
  return row!;
}

export async function updateConnector(db: RequestDb, userId: string, s: Scope, connectorId: string, input: { name: string; config: Record<string, string>; secret: Record<string, string> }) {
  await requireConfigure(db, userId, s.engagementId);
  const ids = await loadEngagementIds(db, s.engagementId, s.organisationId);
  const [cur] = await db.select().from(aiConnectors).where(and(eq(aiConnectors.id, connectorId), eq(aiConnectors.engagementId, ids.engagementId))).limit(1);
  if (!cur) throw new NotFoundOrForbiddenError();
  const config = cleanConfig(cur.connectorType, input.config);
  const secret = cleanSecret(cur.connectorType, input.secret, false); // blank = keep existing
  const cipher = secret ? encryptSecret(secret) : null;
  await db.update(aiConnectors).set({ name: input.name.trim() || cur.name, config, hasSecret: cur.hasSecret || !!cipher, status: "configured", lastTestOk: null, lastTestMessage: null, updatedAt: new Date(), updatedBy: userId }).where(eq(aiConnectors.id, cur.id));
  if (cipher) await db.execute(sql`SELECT public.set_ai_connector_secret(${cur.id}::uuid, ${cipher}, ${SECRET_KEY_VERSION})`);
  await recordEvent(db, { ...ids, subjectType: "connector", subjectId: cur.id, eventType: "connector_changed", actorType: "human", actorUserId: userId, message: `Connector "${cur.name}" settings changed${cipher ? " (credentials replaced)" : ""}.` });
}

export async function setConnectorEnabled(db: RequestDb, userId: string, s: Scope, connectorId: string, enabled: boolean) {
  await requireConfigure(db, userId, s.engagementId);
  const ids = await loadEngagementIds(db, s.engagementId, s.organisationId);
  const [cur] = await db.select().from(aiConnectors).where(and(eq(aiConnectors.id, connectorId), eq(aiConnectors.engagementId, ids.engagementId))).limit(1);
  if (!cur) throw new NotFoundOrForbiddenError();
  await db.update(aiConnectors).set({ status: enabled ? "configured" : "disabled", updatedAt: new Date(), updatedBy: userId }).where(eq(aiConnectors.id, cur.id));
  await recordEvent(db, { ...ids, subjectType: "connector", subjectId: cur.id, eventType: "connector_toggled", actorType: "human", actorUserId: userId, message: `Connector "${cur.name}" switched ${enabled ? "on" : "off"}.` });
}

/** Queues a test or scan; the AI worker runs it. */
export async function requestConnectorRun(db: RequestDb, userId: string, s: Scope, connectorId: string, kind: "test" | "scan") {
  await requireSupervise(db, userId, s.engagementId);
  const ids = await loadEngagementIds(db, s.engagementId, s.organisationId);
  const [cur] = await db.select().from(aiConnectors).where(and(eq(aiConnectors.id, connectorId), eq(aiConnectors.engagementId, ids.engagementId))).limit(1);
  if (!cur) throw new NotFoundOrForbiddenError();
  if (cur.status === "disabled") throw new ConnectorInputError("Switch the connector on first.");
  const jobId = await enqueueJob(db, { ...ids, kind: kind === "test" ? "connector_test" : "connector_scan", subjectType: "connector", subjectId: cur.id, payload: { connectorId: cur.id }, dedupeKey: `connector:${kind}:${cur.id}`, requestedBy: userId });
  return { queued: jobId !== null };
}

export async function listConnectorRuns(db: RequestDb, userId: string, s: Scope, limit = 30) {
  await requireSupervise(db, userId, s.engagementId);
  return db.select().from(aiConnectorRuns).where(eq(aiConnectorRuns.engagementId, s.engagementId)).orderBy(desc(aiConnectorRuns.startedAt)).limit(limit);
}

export async function listAssets(db: RequestDb, userId: string, s: Scope, opts: { connectorId?: string; limit?: number } = {}) {
  await requireSupervise(db, userId, s.engagementId);
  const where = opts.connectorId
    ? and(eq(aiDiscoveredAssets.engagementId, s.engagementId), eq(aiDiscoveredAssets.connectorId, opts.connectorId))
    : eq(aiDiscoveredAssets.engagementId, s.engagementId);
  return db.select().from(aiDiscoveredAssets).where(where).orderBy(desc(aiDiscoveredAssets.lastSeenAt), aiDiscoveredAssets.name).limit(opts.limit ?? 500);
}

export const connectorFormSchema = z.record(z.string());
