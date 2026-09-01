// Milestone 7 instructions §4/§11: "Create Risk Scoring Model v1. Then
// calculate/create a Risk. Later create Risk Scoring Model v2. The
// historical Risk must continue to resolve to v1 and remain
// reproducible. Do not allow current scoring configuration to silently
// rewrite historical risk." Uses the frozen/pinned model DECISIONS.md
// R-16 already established for RiskScoringModel.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  createEngagement,
  createOrganisation,
  createRisk,
  createRiskScoringModel,
  createTenant,
  pool,
} from "./helpers";

describe("RiskScoringModel versioning and historical Risk reproducibility", () => {
  let tenant: string, org: string, engagement: string;
  let modelV1: string;
  let riskUnderV1: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Risk scoring versioning tenant");
      org = await createOrganisation(client, tenant, "Risk scoring versioning client");
      engagement = await createEngagement(client, tenant, org, "Risk scoring versioning engagement");

      modelV1 = await createRiskScoringModel(client, {
        tenantId: tenant,
        name: "Standard Matrix",
        version: "v1.0",
        matrixDefinition: { scale: "1-5", high_threshold: 16 },
      });
      riskUnderV1 = await createRisk(client, {
        engagementId: engagement,
        organisationId: org,
        tenantId: tenant,
        riskScoringModelId: modelV1,
        title: "Risk scored under v1.0",
        likelihood: 4,
        impact: 4,
        inherentRating: "high",
      });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("only one RiskScoringModel is active per tenant at a time", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM risk_scoring_models WHERE tenant_id = $1 AND is_active = true", [tenant]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(modelV1);
  });

  it("creating RiskScoringModel v2 does not alter v1's own matrix_definition or any field", async () => {
    const before = await asFixtureSetup((c) => c.query("SELECT name, version, matrix_definition FROM risk_scoring_models WHERE id = $1", [modelV1]));

    const modelV2 = await asFixtureSetup((c) =>
      createRiskScoringModel(c, { tenantId: tenant, name: "Standard Matrix", version: "v2.0", matrixDefinition: { scale: "1-5", high_threshold: 12 } }),
    );

    const after = await asFixtureSetup((c) => c.query("SELECT name, version, matrix_definition FROM risk_scoring_models WHERE id = $1", [modelV1]));
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(modelV2).not.toBe(modelV1);
  });

  it("v1 automatically becomes inactive the moment v2 is created active — but this is bookkeeping only, not a content change", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT is_active FROM risk_scoring_models WHERE id = $1", [modelV1]));
    expect(rows[0]!.is_active).toBe(false);
  });

  it("the historical Risk still resolves to Model v1 by id, not whichever model is currently active", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT risk_scoring_model_id FROM risks WHERE id = $1", [riskUnderV1]));
    expect(rows[0]!.risk_scoring_model_id).toBe(modelV1);

    const { rows: activeModel } = await asFixtureSetup((c) => c.query("SELECT id FROM risk_scoring_models WHERE tenant_id = $1 AND is_active = true", [tenant]));
    expect(activeModel[0]!.id).not.toBe(modelV1);
  });

  it("resolves the historical Risk's full scoring basis (matrix used, likelihood/impact/rating) in one join, unaffected by v2's existence", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT r.likelihood, r.impact, r.inherent_rating, m.version AS scoring_model_version, m.matrix_definition
         FROM risks r JOIN risk_scoring_models m ON m.id = r.risk_scoring_model_id
         WHERE r.id = $1`,
        [riskUnderV1],
      ),
    );
    expect(rows[0]).toMatchObject({ likelihood: 4, impact: 4, inherent_rating: "high", scoring_model_version: "v1.0" });
    expect(rows[0]!.matrix_definition).toEqual({ scale: "1-5", high_threshold: 16 });
  });

  it("Risk.risk_scoring_model_id cannot be silently reparented to v2", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM risk_scoring_models WHERE tenant_id = $1 AND is_active = true", [tenant]));
    const modelV2Id = rows[0]!.id;
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE risks SET risk_scoring_model_id = $1 WHERE id = $2`, [modelV2Id, riskUnderV1])),
    ).rejects.toThrow(/risks\.\{engagement_id,organisation_id,tenant_id,risk_scoring_model_id\} are immutable/i);
  });

  it("a deliberate re-score under v2 creates a NEW Risk row linked via previous_risk_id, never an in-place reparent", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM risk_scoring_models WHERE tenant_id = $1 AND is_active = true", [tenant]));
    const modelV2Id = rows[0]!.id;

    const rescored = await asFixtureSetup((c) =>
      createRisk(c, {
        engagementId: engagement,
        organisationId: org,
        tenantId: tenant,
        riskScoringModelId: modelV2Id,
        title: "Risk scored under v1.0",
        likelihood: 3,
        impact: 3,
        inherentRating: "medium",
        previousRiskId: riskUnderV1,
      }),
    );

    const { rows: rescoredRows } = await asFixtureSetup((c) => c.query("SELECT risk_scoring_model_id, previous_risk_id FROM risks WHERE id = $1", [rescored]));
    expect(rescoredRows[0]).toMatchObject({ risk_scoring_model_id: modelV2Id, previous_risk_id: riskUnderV1 });

    // The original v1 row is completely untouched by the re-score.
    const { rows: originalRows } = await asFixtureSetup((c) => c.query("SELECT risk_scoring_model_id, likelihood, impact, inherent_rating FROM risks WHERE id = $1", [riskUnderV1]));
    expect(originalRows[0]).toMatchObject({ risk_scoring_model_id: modelV1, likelihood: 4, impact: 4, inherent_rating: "high" });
  });
});
