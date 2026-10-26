import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import type { ClaimedJob } from "@/lib/ai/queue";
import { recordEvent } from "@/lib/ai/events";
import { aiConnectorRuns, aiConnectors, aiDiscoveredAssets } from "@/db/schema";
import { IMPLEMENTATIONS } from "./registry";
import { decryptSecret } from "./secrets";
import type { ConnectorContext, DiscoveredAsset } from "./types";

/**
 * Runs a connector test or scan as the AI agent. A scan that cannot complete
 * (wrong password, unreachable site...) is recorded as a failed RUN, not a
 * failed job: retrying the same bad setting would not help.
 */
export async function runConnectorJob(db: RequestDb, job: ClaimedJob, agentUserId: string): Promise<Record<string, unknown>> {
  const connectorId = String(job.payload.connectorId ?? job.subjectId ?? "");
  const [conn] = await db
    .select()
    .from(aiConnectors)
    .where(and(eq(aiConnectors.id, connectorId), eq(aiConnectors.engagementId, job.engagementId)))
    .limit(1);
  if (!conn) throw new Error("Connector not found for this engagement.");
  const runType = job.kind === "connector_test" ? "test" : "scan";
  const ids = { tenantId: job.tenantId, organisationId: job.organisationId, engagementId: job.engagementId };

  if (conn.status === "disabled") {
    await recordEvent(db, { ...ids, jobId: job.id, subjectType: "connector", subjectId: conn.id, eventType: "connector_skipped", actorType: "ai", actorUserId: agentUserId, message: `Skipped ${runType} of "${conn.name}": the connector is switched off.` });
    return { ok: false, skipped: true };
  }

  const [run] = await db.insert(aiConnectorRuns).values({ ...ids, connectorId: conn.id, runType }).returning({ id: aiConnectorRuns.id });
  const runId = run!.id;

  try {
    const impl = IMPLEMENTATIONS[conn.connectorType];
    if (!impl) throw new Error(`The "${conn.connectorType}" connector is not available in this release.`);

    let secret: Record<string, string> | null = null;
    if (conn.hasSecret) {
      const res = await db.execute<{ ciphertext: string }>(sql`SELECT ciphertext FROM public.get_ai_connector_secret(${conn.id}::uuid)`);
      const row = res.rows[0];
      if (!row) throw new Error("The saved credentials could not be found. Re-enter them on the connector.");
      secret = decryptSecret(row.ciphertext);
    }
    const ctx: ConnectorContext = { config: (conn.config ?? {}) as Record<string, unknown>, secret, env: process.env };

    if (runType === "test") {
      const t = await impl.test(ctx);
      await db.update(aiConnectorRuns).set({ status: t.ok ? "succeeded" : "failed", finishedAt: new Date(), stats: { message: t.message }, error: t.ok ? null : t.message }).where(eq(aiConnectorRuns.id, runId));
      await db.update(aiConnectors).set({ lastTestedAt: new Date(), lastTestOk: t.ok, lastTestMessage: t.message, status: t.ok ? "connected" : "error", updatedAt: new Date() }).where(eq(aiConnectors.id, conn.id));
      await recordEvent(db, { ...ids, jobId: job.id, subjectType: "connector", subjectId: conn.id, eventType: "connector_test", actorType: "ai", actorUserId: agentUserId, message: `Tested connector "${conn.name}": ${t.ok ? "OK" : "failed"} — ${t.message}` });
      return { ok: t.ok, message: t.message };
    }

    const result = await impl.scan(ctx);
    await saveAssets(db, { ...ids, connectorId: conn.id, runId }, result.assets);
    await db.update(aiConnectorRuns).set({ status: "succeeded", finishedAt: new Date(), stats: { ...result.stats, assets: result.assets.length } }).where(eq(aiConnectorRuns.id, runId));
    await db.update(aiConnectors).set({ lastRunAt: new Date(), lastTestOk: true, lastTestMessage: "Scan completed.", status: "connected", updatedAt: new Date() }).where(eq(aiConnectors.id, conn.id));
    const withPii = result.assets.filter((a) => a.piiCategories.length).length;
    await recordEvent(db, {
      ...ids, jobId: job.id, subjectType: "connector", subjectId: conn.id, eventType: "connector_scan", actorType: "ai", actorUserId: agentUserId,
      message: `Scanned "${conn.name}": ${result.assets.length} item(s) recorded, ${withPii} holding personal data. Only names, locations and categories were kept.`,
      detail: { stats: result.stats },
    });
    return { ok: true, assets: result.assets.length, withPersonalData: withPii, ...result.stats };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await db.update(aiConnectorRuns).set({ status: "failed", finishedAt: new Date(), error: msg }).where(eq(aiConnectorRuns.id, runId));
    await db.update(aiConnectors).set({ lastTestedAt: new Date(), lastTestOk: false, lastTestMessage: msg, status: "error", updatedAt: new Date() }).where(eq(aiConnectors.id, conn.id));
    await recordEvent(db, { ...ids, jobId: job.id, subjectType: "connector", subjectId: conn.id, eventType: "connector_failed", actorType: "ai", actorUserId: agentUserId, message: `Could not ${runType} "${conn.name}": ${msg}` });
    return { ok: false, error: msg };
  }
}

async function saveAssets(db: RequestDb, k: { tenantId: string; organisationId: string; engagementId: string; connectorId: string; runId: string }, assets: DiscoveredAsset[]) {
  const now = new Date();
  for (let i = 0; i < assets.length; i += 200) {
    const chunk = assets.slice(i, i + 200);
    await db
      .insert(aiDiscoveredAssets)
      .values(chunk.map((a) => ({ ...k, assetType: a.assetType, name: a.name, location: a.location, attributes: a.attributes, piiCategories: a.piiCategories, sensitivity: a.sensitivity, lastSeenAt: now })))
      .onConflictDoUpdate({
        target: [aiDiscoveredAssets.connectorId, aiDiscoveredAssets.assetType, aiDiscoveredAssets.location],
        set: {
          runId: k.runId,
          name: sql`excluded.name`,
          attributes: sql`excluded.attributes`,
          piiCategories: sql`excluded.pii_categories`,
          sensitivity: sql`excluded.sensitivity`,
          lastSeenAt: now,
        },
      });
  }
}
