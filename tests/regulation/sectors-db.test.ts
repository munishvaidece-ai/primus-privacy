// Engagement sectors: stored per engagement, changed only by Primus staff, audited,
// and read by the AI when it decides which sector controls apply.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementSectors, setEngagementSectors } from "@/lib/domain/sectors";
import { loadLandscapeProfile } from "@/lib/ai/context";
import { asFixtureSetup, createUser, grantEngagementMembership, pool } from "../app/helpers";
import { buildAiFixture, type AiFixture } from "../ai/helpers";

describe("engagement sectors", () => {
  let f: AiFixture;
  let clientUser: string;

  beforeAll(async () => {
    f = await buildAiFixture("Sectors");
    await asFixtureSetup(async (c) => {
      clientUser = await createUser(c, { tenantId: f.tenantId, clientOrgId: f.organisationId });
      await grantEngagementMembership(c, clientUser, f.engagementId, "Business Owner");
    });
  });

  const ids = () => ({ engagementId: f.engagementId, organisationId: f.organisationId });

  it("starts empty, then stores and returns the chosen sectors in a stable order", async () => {
    expect(await withRequestDb(f.emId, (db) => getEngagementSectors(db, f.emId, ids()))).toEqual([]);
    const saved = await withRequestDb(f.emId, (db) => setEngagementSectors(db, f.emId, { ...ids(), sectors: ["banking", "broking", "broking"] }));
    expect(saved).toEqual(["broking", "banking"]);
  });

  it("replaces the selection: removes what is unticked, keeps the rest", async () => {
    const saved = await withRequestDb(f.emId, (db) => setEngagementSectors(db, f.emId, { ...ids(), sectors: ["broking", "msme"] }));
    expect(saved).toEqual(["broking", "msme"]);
  });

  it("rejects a sector that does not exist", async () => {
    await expect(withRequestDb(f.emId, (db) => setEngagementSectors(db, f.emId, { ...ids(), sectors: ["broking", "mining"] }))).rejects.toThrow(/Unknown sector/);
  });

  it("a client user can see the choice but cannot change it", async () => {
    expect(await withRequestDb(clientUser, (db) => getEngagementSectors(db, clientUser, ids()))).toEqual(["broking", "msme"]);
    await expect(withRequestDb(clientUser, (db) => setEngagementSectors(db, clientUser, { ...ids(), sectors: ["banking"] }))).rejects.toThrow();
    expect(await withRequestDb(f.emId, (db) => getEngagementSectors(db, f.emId, ids()))).toEqual(["broking", "msme"]);
  });

  it("every change is in the audit trail", async () => {
    const r = await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'engagement_sectors' AND tenant_id = $1", [f.tenantId]);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(4);
  });

  it("the AI's view of the client includes the chosen sectors", async () => {
    const p = await withRequestDb(f.emId, (db) => loadLandscapeProfile(db, f.engagementId));
    expect(p.sectors).toEqual(expect.arrayContaining(["broking", "msme"]));
    expect(p.sectors).toHaveLength(2);
    expect(p.sectorChosenBy?.length).toBeGreaterThan(0);
  });
});
