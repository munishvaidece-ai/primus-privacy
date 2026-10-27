// "Clear it for the next demo": everything the demo put in goes, the skeleton stays, and no other firm is touched.
import { describe, expect, it, beforeAll } from "vitest";
import { Pool } from "pg";
import { clearFirmData } from "@/lib/demo/reset";
import { asFixtureSetup, createEngagement, createOrganisation, createTenant } from "../app/helpers";

const url = process.env.TEST_DATABASE_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/primus_privacy_test";

describe("demo reset", () => {
  const ids = { tenant: "", orgA: "", engA: "", orgB: "", engB: "" };
  beforeAll(async () => {
    await asFixtureSetup(async (c) => {
      ids.tenant = await createTenant(c, "Reset Primus");
      ids.orgA = await createOrganisation(c, ids.tenant, "Orchid Hill Securities Limited");
      ids.engA = await createEngagement(c, ids.tenant, ids.orgA, "Demo A");
      ids.orgB = await createOrganisation(c, ids.tenant, "Some Other Client");
      ids.engB = await createEngagement(c, ids.tenant, ids.orgB, "Real work");
      for (const [org, eng] of [[ids.orgA, ids.engA], [ids.orgB, ids.engB]] as const) {
        await c.query("INSERT INTO engagement_sectors (tenant_id, organisation_id, engagement_id, sector_key) VALUES ($1,$2,$3,'broking')", [ids.tenant, org, eng]);
        await c.query("INSERT INTO business_units (organisation_id, name) VALUES ($1,'Retail broking')", [org]);
      }
    });
  });

  it("clears the demo firm, keeps its skeleton, and leaves every other firm alone", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = await clearFirmData(c, { organisationId: ids.orgA, engagementId: ids.engA });
      await c.query("COMMIT");
      expect(r.rows).toBeGreaterThanOrEqual(2);
      const n = async (q: string, id: string) => Number((await c.query(q, [id])).rows[0].n);
      expect(await n("SELECT count(*)::int n FROM engagement_sectors WHERE engagement_id = $1", ids.engA)).toBe(0);
      expect(await n("SELECT count(*)::int n FROM business_units WHERE organisation_id = $1", ids.orgA)).toBe(0);
      // the firm and its engagement remain
      expect(await n("SELECT count(*)::int n FROM organisations WHERE id = $1", ids.orgA)).toBe(1);
      expect(await n("SELECT count(*)::int n FROM engagements WHERE id = $1", ids.engA)).toBe(1);
      // the other firm is untouched
      expect(await n("SELECT count(*)::int n FROM engagement_sectors WHERE engagement_id = $1", ids.engB)).toBe(1);
      expect(await n("SELECT count(*)::int n FROM business_units WHERE organisation_id = $1", ids.orgB)).toBe(1);
    } finally {
      c.release();
      await pool.end();
    }
  });
});
