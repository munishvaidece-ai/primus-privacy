import "server-only";
import { sql } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { getEngagementSectors } from "@/lib/domain/sectors";
import { applicableObligations, factsFromAnswers, rulesThatBind, summarise, SECTORS, type Obligation, type OrgFacts, type Sector } from "@/lib/regulation";
import { getDiscovery } from "./discovery";

export interface EngagementApplicability {
  facts: OrgFacts;
  obligations: Obligation[];
  summary: ReturnType<typeof summarise>;
  rules: ReturnType<typeof rulesThatBind>;
  sectors: Sector[];
  /** What the platform could read for this organisation, to show how complete the picture is. */
  basis: { questionnaire: "none" | "in_progress" | "submitted" | "approved"; answered: number; total: number; vendors: number; activities: number; childrenGroups: number };
}

/** Works out which DPDP provisions and sector rules apply to one engagement, from its own answers and data map. */
export async function loadEngagementApplicability(db: RequestDb, userId: string, scope: { engagementId: string; organisationId: string }): Promise<EngagementApplicability> {
  const [state, sectorKeys] = await Promise.all([getDiscovery(db, userId, scope.engagementId), getEngagementSectors(db, userId, scope)]);
  const one = async (q: ReturnType<typeof sql>) => Number(((await db.execute<{ n: number }>(q)).rows[0] as { n: number } | undefined)?.n ?? 0);
  const [vendors, activities, childrenGroups] = await Promise.all([
    one(sql`SELECT count(*)::int AS n FROM processors WHERE organisation_id = ${scope.organisationId}`),
    one(sql`SELECT count(*)::int AS n FROM processing_activities WHERE engagement_id = ${scope.engagementId}`),
    one(sql`SELECT count(*)::int AS n FROM data_principal_category_versions WHERE organisation_id = ${scope.organisationId} AND is_current AND (is_children_flag OR name ~* 'minor|child')`),
  ]);
  const facts = factsFromAnswers(state.answers as never, sectorKeys);
  facts.evidence = {};
  if (facts.usesProcessors && vendors) facts.evidence.processorsFrom = `${vendors} vendors are on the data map as processors of personal data.`;
  if (facts.children && childrenGroups) facts.evidence.childrenFrom = `${childrenGroups} group${childrenGroups === 1 ? "" : "s"} of people on the data map are minors (and their guardians).`;
  const obligations = applicableObligations(facts);
  const filled = (v: unknown) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
  const answered = Object.values(state.answers).filter((sec) => Object.values(sec ?? {}).some(filled)).length;
  return {
    facts,
    obligations,
    summary: summarise(obligations),
    rules: rulesThatBind(obligations),
    sectors: sectorKeys.map((k) => SECTORS.find((s) => s.key === k)).filter((s): s is Sector => Boolean(s)),
    basis: { questionnaire: answered === 0 && vendors === 0 && activities === 0 ? "none" : state.status, answered, total: state.total, vendors, activities, childrenGroups },
  };
}
