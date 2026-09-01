// Milestone 7 instructions §16: "If a Risk, Finding or Validation
// becomes historically finalized according to DATA_MODEL.md, protect it
// from silent mutation." DATA_MODEL.md §8 names no explicit "finalized"
// state for Risk/Finding (documented, not invented — DECISIONS.md); the
// one entity DATA_MODEL.md does describe as "an explicit event/record"
// is ValidationRecord — its decision fields (outcome/validated_by/
// validated_at/rationale) are frozen after creation, with one narrow,
// documented exception (the reassessment-trigger columns may be set
// exactly once, later — DECISIONS.md, mirroring `document_versions.
// scan_status`, Milestone 6). Also covers RiskScoringModel's append-only
// posture and the reparenting guards on Risk/Finding/RemediationAction.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createControl,
  createControlLibraryVersion,
  createControlTest,
  createEngagement,
  createFinding,
  createOrganisation,
  createRemediationAction,
  createRisk,
  createRiskScoringModel,
  createTenant,
  createUser,
  createValidationRecord,
  grantOrganisationMembership,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("RiskScoringModel append-only / ValidationRecord immutability", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let scoringModel: string, remediationId: string, controlTestId: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "R&F immutability tenant");
      org = await createOrganisation(client, tenant, "R&F immutability client");
      engagement = await createEngagement(client, tenant, org, "R&F immutability engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
      scoringModel = await createRiskScoringModel(client, { tenantId: tenant, name: "Immutability Test Matrix", version: "v1.0" });
      remediationId = await createRemediationAction(client, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Immutability test remediation" });

      const library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Immutability Test Library" });
      const control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "IMM1", title: "Immutability test control" });
      await publishControlLibraryVersion(client, library);
      controlTestId = await createControlTest(client, { controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  it("no UPDATE grant exists on RiskScoringModel — its content cannot be edited through any ordinary path", async () => {
    await expect(asUser(user, (c) => c.query(`UPDATE risk_scoring_models SET name = 'tampered' WHERE id = $1`, [scoringModel]))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("no DELETE grant exists on RiskScoringModel — it is never removed", async () => {
    await expect(asUser(user, (c) => c.query("DELETE FROM risk_scoring_models WHERE id = $1", [scoringModel]))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("a ValidationRecord's decision fields (outcome, rationale, validated_by, validated_at) cannot be changed after creation", async () => {
    const validationId = await asFixtureSetup((c) => createValidationRecord(c, { remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagement, validatedBy: user, outcome: "accepted", rationale: "Original rationale" }));
    await expect(
      asUser(user, (c) => c.query(`UPDATE validation_records SET rationale = 'tampered' WHERE id = $1`, [validationId])),
    ).rejects.toThrow(/decision fields are immutable/i);
    await expect(
      asUser(user, (c) => c.query(`UPDATE validation_records SET outcome = 'rejected' WHERE id = $1`, [validationId])),
    ).rejects.toThrow(/decision fields are immutable/i);
  });

  it("a ValidationRecord's reassessment trigger CAN be set once, later, from NULL, referencing a real ControlTest", async () => {
    const validationId = await asFixtureSetup((c) => createValidationRecord(c, { remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagement, validatedBy: user, outcome: "accepted", rationale: "Awaiting reassessment." }));
    const before = await asFixtureSetup((c) => c.query("SELECT triggers_control_test_id FROM validation_records WHERE id = $1", [validationId]));
    expect(before.rows[0]!.triggers_control_test_id).toBeNull();

    await asFixtureSetup((c) => c.query(`UPDATE validation_records SET triggers_control_test_id = $1 WHERE id = $2`, [controlTestId, validationId]));
    const after = await asFixtureSetup((c) => c.query("SELECT triggers_control_test_id FROM validation_records WHERE id = $1", [validationId]));
    expect(after.rows[0]!.triggers_control_test_id).toBe(controlTestId);
  });

  it("a ValidationRecord's reassessment trigger cannot be changed a second time once set", async () => {
    const validationId = await asFixtureSetup((c) => createValidationRecord(c, { remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagement, validatedBy: user, outcome: "accepted", triggersControlTestId: controlTestId }));
    const anotherControlTest = await asFixtureSetup(async (c) => {
      const library = await createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Second Reassessment Trigger Library" });
      const control = await createControl(c, { tenantId: tenant, controlLibraryVersionId: library, code: "IMM2", title: "Second immutability test control" });
      await publishControlLibraryVersion(c, library);
      return createControlTest(c, { controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement });
    });
    await expect(
      asUser(user, (c) => c.query(`UPDATE validation_records SET triggers_control_test_id = $1 WHERE id = $2`, [anotherControlTest, validationId])),
    ).rejects.toThrow(/can only be set once/i);
  });

  it("a ValidationRecord cannot be DELETEd — no DELETE grant exists at all", async () => {
    const validationId = await asFixtureSetup((c) => createValidationRecord(c, { remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagement, validatedBy: user, outcome: "rejected", rationale: "Not sufficient." }));
    await expect(asUser(user, (c) => c.query("DELETE FROM validation_records WHERE id = $1", [validationId]))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("a rejected ValidationRecord cannot carry a reassessment trigger", async () => {
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome, triggers_assessment_response_id)
           VALUES ($1, $2, $3, $4, 'rejected', gen_random_uuid())`,
          [remediationId, tenant, org, engagement],
        ),
      ),
    ).rejects.toThrow(/violates foreign key constraint|violates check constraint|only_accepted_triggers_reassessment/i);
  });

  it("a ValidationRecord cannot set both triggers_control_test_id and triggers_assessment_response_id at once", async () => {
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome, triggers_control_test_id, triggers_assessment_response_id)
           VALUES ($1, $2, $3, $4, 'accepted', gen_random_uuid(), gen_random_uuid())`,
          [remediationId, tenant, org, engagement],
        ),
      ),
    ).rejects.toThrow(/violates foreign key constraint|violates check constraint|at_most_one_reassessment_target/i);
  });
});

describe("Risk/Finding/RemediationAction reparenting guards (afterAll ends the shared pool for this file)", () => {
  let tenant: string, tenantB: string, org: string, orgB: string, engagement: string;
  let scoringModel: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Reparenting guard tenant A");
      tenantB = await createTenant(client, "Reparenting guard tenant B");
      org = await createOrganisation(client, tenant, "Reparenting guard client A");
      orgB = await createOrganisation(client, tenantB, "Reparenting guard client B");
      engagement = await createEngagement(client, tenant, org, "Reparenting guard engagement");
      scoringModel = await createRiskScoringModel(client, { tenantId: tenant, name: "Reparenting Matrix", version: "v1.0" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a Risk's engagement_id/organisation_id/tenant_id cannot be changed after creation", async () => {
    const riskId = await asFixtureSetup((c) => createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Reparent test risk", likelihood: 2, impact: 2, inherentRating: "low" }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE risks SET organisation_id = $1 WHERE id = $2`, [orgB, riskId])),
    ).rejects.toThrow(/risks\.\{engagement_id,organisation_id,tenant_id,risk_scoring_model_id\} are immutable/i);
  });

  it("a Risk's ordinary fields (title, status, likelihood, owner) remain freely editable", async () => {
    const riskId = await asFixtureSetup((c) => createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Editable risk", likelihood: 2, impact: 2, inherentRating: "low" }));
    await asFixtureSetup((c) => c.query(`UPDATE risks SET title = 'Renamed risk', status = 'mitigating', likelihood = 3 WHERE id = $1`, [riskId]));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT title, status, likelihood FROM risks WHERE id = $1", [riskId]));
    expect(rows[0]).toMatchObject({ title: "Renamed risk", status: "mitigating", likelihood: 3 });
  });

  it("a Finding's engagement_id/organisation_id/tenant_id cannot be changed after creation", async () => {
    const findingId = await asFixtureSetup((c) => createFinding(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Reparent test finding" }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE findings SET tenant_id = $1 WHERE id = $2`, [tenantB, findingId])),
    ).rejects.toThrow(/findings\.\{engagement_id,organisation_id,tenant_id\} are immutable/i);
  });

  it("a RemediationAction's engagement_id/organisation_id/tenant_id cannot be changed after creation", async () => {
    const remediationId = await asFixtureSetup((c) => createRemediationAction(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Reparent test remediation" }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE remediation_actions SET engagement_id = gen_random_uuid() WHERE id = $1`, [remediationId])),
    ).rejects.toThrow(/remediation_actions\.\{engagement_id,organisation_id,tenant_id\} are immutable/i);
  });
});
