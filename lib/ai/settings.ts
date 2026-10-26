import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { aiEngagementSettings, engagementMemberships, engagements, roles } from "@/db/schema";
import { NotFoundOrForbiddenError, hasEngagementPermission } from "@/lib/authorization/service";
import { addEngagementMember, revokeEngagementMember, DuplicateMembershipError } from "@/lib/domain/engagement-memberships";
import { recordEvent } from "./events";
import type { AutopilotLevel, EngagementAiSettings } from "./types";
import { LEVEL_NAMES } from "./types";

export class AgentNotProvisionedError extends Error {
  constructor() {
    super(
      "The AI agent user has not been provisioned for this practice yet. Ask your administrator to run: npm run ai:provision-agent",
    );
    this.name = "AgentNotProvisionedError";
  }
}

export const AI_ANALYST_ROLE = "AI Analyst";

export function defaultSettings(ids: { engagementId: string; organisationId: string; tenantId: string }): EngagementAiSettings {
  return {
    ...ids,
    enabled: false,
    level: 2,
    paused: false,
    thresholdSupervised: 0.9,
    thresholdFull: 0.75,
    gates: { rejectCriticalEvidence: true, releaseCriticalFindings: true, issueFinalReport: true, sendBreachNotices: true },
    allowExternalAi: false,
  };
}

function rowToSettings(r: typeof aiEngagementSettings.$inferSelect): EngagementAiSettings {
  return {
    engagementId: r.engagementId,
    organisationId: r.organisationId,
    tenantId: r.tenantId,
    enabled: r.enabled,
    level: r.autopilotLevel as AutopilotLevel,
    paused: r.paused,
    thresholdSupervised: Number(r.thresholdSupervised),
    thresholdFull: Number(r.thresholdFull),
    gates: {
      rejectCriticalEvidence: r.gateRejectCriticalEvidence,
      releaseCriticalFindings: r.gateReleaseCriticalFindings,
      issueFinalReport: r.gateIssueFinalReport,
      sendBreachNotices: r.gateSendBreachNotices,
    },
    allowExternalAi: r.allowExternalAi,
  };
}

export async function loadEngagementIds(db: RequestDb, engagementId: string, organisationId: string) {
  const [e] = await db
    .select({ id: engagements.id, organisationId: engagements.organisationId, tenantId: engagements.tenantId })
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);
  if (!e || e.organisationId !== organisationId) throw new NotFoundOrForbiddenError();
  return { engagementId: e.id, organisationId: e.organisationId, tenantId: e.tenantId };
}

/** Returns the saved settings, or the safe defaults (AI off) when none exist. */
export async function getAiSettings(db: RequestDb, engagementId: string, organisationId: string): Promise<EngagementAiSettings> {
  const ids = await loadEngagementIds(db, engagementId, organisationId);
  const [row] = await db.select().from(aiEngagementSettings).where(eq(aiEngagementSettings.engagementId, engagementId)).limit(1);
  return row ? rowToSettings(row) : defaultSettings(ids);
}

async function findAgentUserId(db: RequestDb, tenantId: string): Promise<string | null> {
  const res = await db.execute<{ id: string | null }>(sql`SELECT public.ai_agent_user_id(${tenantId}::uuid) AS id`);
  return res.rows[0]?.id ?? null;
}

async function ensureAgentMembership(db: RequestDb, userId: string, ids: { engagementId: string; organisationId: string; tenantId: string }) {
  const agentId = await findAgentUserId(db, ids.tenantId);
  if (!agentId) throw new AgentNotProvisionedError();
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, AI_ANALYST_ROLE)).limit(1);
  if (!role) throw new Error(`Role "${AI_ANALYST_ROLE}" is missing: run npm run db:seed.`);
  try {
    await addEngagementMember(db, userId, { organisationId: ids.organisationId, engagementId: ids.engagementId, targetUserId: agentId, roleId: role.id });
  } catch (e) {
    if (!(e instanceof DuplicateMembershipError)) throw e;
  }
  return agentId;
}

async function removeAgentMembership(db: RequestDb, userId: string, ids: { engagementId: string; organisationId: string; tenantId: string }) {
  const agentId = await findAgentUserId(db, ids.tenantId);
  if (!agentId) return;
  const rows = await db
    .select({ id: engagementMemberships.id })
    .from(engagementMemberships)
    .where(and(eq(engagementMemberships.engagementId, ids.engagementId), eq(engagementMemberships.userId, agentId), eq(engagementMemberships.status, "active")));
  for (const m of rows) {
    await revokeEngagementMember(db, userId, { organisationId: ids.organisationId, engagementId: ids.engagementId, membershipId: m.id });
  }
}

export interface SaveSettingsInput {
  engagementId: string;
  organisationId: string;
  enabled: boolean;
  level: AutopilotLevel;
  thresholdSupervised: number;
  thresholdFull: number;
  gates: EngagementAiSettings["gates"];
  allowExternalAi: boolean;
}

export class InvalidAiSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAiSettingsError";
  }
}

export async function saveAiSettings(db: RequestDb, userId: string, input: SaveSettingsInput): Promise<EngagementAiSettings> {
  const ids = await loadEngagementIds(db, input.engagementId, input.organisationId);
  if (!(await hasEngagementPermission(db, userId, ids.engagementId, "ai.configure"))) throw new NotFoundOrForbiddenError();
  if (![1, 2, 3].includes(input.level)) throw new InvalidAiSettingsError("Autopilot level must be 1, 2 or 3.");
  for (const t of [input.thresholdSupervised, input.thresholdFull]) {
    if (!(t >= 0.5 && t <= 1)) throw new InvalidAiSettingsError("Confidence thresholds must be between 50% and 100%.");
  }

  const before = await getAiSettings(db, input.engagementId, input.organisationId);
  const values = {
    enabled: input.enabled,
    autopilotLevel: input.level,
    thresholdSupervised: input.thresholdSupervised.toFixed(2),
    thresholdFull: input.thresholdFull.toFixed(2),
    gateRejectCriticalEvidence: input.gates.rejectCriticalEvidence,
    gateReleaseCriticalFindings: input.gates.releaseCriticalFindings,
    gateIssueFinalReport: input.gates.issueFinalReport,
    gateSendBreachNotices: input.gates.sendBreachNotices,
    allowExternalAi: input.allowExternalAi,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  await db
    .insert(aiEngagementSettings)
    .values({ ...ids, ...values, createdBy: userId })
    .onConflictDoUpdate({ target: aiEngagementSettings.engagementId, set: values });

  // The AI's access follows the switch: enabled (and not paused) = it holds an
  // engagement membership; otherwise it holds none.
  if (input.enabled && !before.paused) await ensureAgentMembership(db, userId, ids);
  if (!input.enabled) await removeAgentMembership(db, userId, ids);

  const changes: string[] = [];
  if (before.enabled !== input.enabled) changes.push(input.enabled ? "AI switched on" : "AI switched off");
  if (before.level !== input.level) changes.push(`level ${LEVEL_NAMES[before.level]} → ${LEVEL_NAMES[input.level]}`);
  if (JSON.stringify(before.gates) !== JSON.stringify(input.gates)) changes.push("sign-off gates changed");
  if (before.thresholdSupervised !== input.thresholdSupervised || before.thresholdFull !== input.thresholdFull) changes.push("thresholds changed");
  if (before.allowExternalAi !== input.allowExternalAi) changes.push(input.allowExternalAi ? "external AI allowed" : "external AI disallowed");
  if (changes.length) {
    await recordEvent(db, { ...ids, eventType: "settings_changed", actorType: "human", actorUserId: userId, message: `Settings changed: ${changes.join("; ")}.`, detail: { before, after: input } });
  }
  return getAiSettings(db, input.engagementId, input.organisationId);
}

/** Pause = the AI immediately loses its engagement membership, so even work
 *  already in flight can no longer read or write anything here. */
export async function pauseAi(db: RequestDb, userId: string, input: { engagementId: string; organisationId: string }): Promise<void> {
  const ids = await loadEngagementIds(db, input.engagementId, input.organisationId);
  if (!(await hasEngagementPermission(db, userId, ids.engagementId, "ai.configure"))) throw new NotFoundOrForbiddenError();
  await db
    .insert(aiEngagementSettings)
    .values({ ...ids, paused: true, pausedAt: new Date(), pausedBy: userId, createdBy: userId, updatedBy: userId })
    .onConflictDoUpdate({ target: aiEngagementSettings.engagementId, set: { paused: true, pausedAt: new Date(), pausedBy: userId, updatedBy: userId, updatedAt: new Date() } });
  await removeAgentMembership(db, userId, ids);
  await recordEvent(db, { ...ids, eventType: "paused", actorType: "human", actorUserId: userId, message: "AI paused. It no longer has access to this engagement." });
}

export async function resumeAi(db: RequestDb, userId: string, input: { engagementId: string; organisationId: string }): Promise<void> {
  const ids = await loadEngagementIds(db, input.engagementId, input.organisationId);
  if (!(await hasEngagementPermission(db, userId, ids.engagementId, "ai.configure"))) throw new NotFoundOrForbiddenError();
  const s = await getAiSettings(db, input.engagementId, input.organisationId);
  await db
    .update(aiEngagementSettings)
    .set({ paused: false, pausedAt: null, pausedBy: null, updatedBy: userId, updatedAt: new Date() })
    .where(eq(aiEngagementSettings.engagementId, ids.engagementId));
  if (s.enabled) await ensureAgentMembership(db, userId, ids);
  await recordEvent(db, { ...ids, eventType: "resumed", actorType: "human", actorUserId: userId, message: s.enabled ? "AI resumed." : "Pause cleared (AI is still switched off)." });
}
