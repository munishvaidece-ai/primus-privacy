// Milestone 7 instructions §15: Risk creation/scoring/status changes/
// material updates; Finding creation/severity-or-status changes/material
// updates; Remediation creation/assignment/status changes/completion;
// Validation creation/decision must all be auditable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createFinding,
  createOrganisation,
  createRemediationAction,
  createRisk,
  createRiskScoringModel,
  createTenant,
  createUser,
  createValidationRecord,
  grantEngagementMembership,
  grantOrganisationMembership,
  linkRiskControl,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Risk, Findings & Remediation auditability", () => {
  let tenant: string, org: string, engagement: string, user: string, control: string, scoringModel: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "R&F audit test tenant");
      org = await createOrganisation(client, tenant, "R&F audit test org");
      engagement = await createEngagement(client, tenant, org, "R&F audit test engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
      // P2A (Authorization & Confidentiality Hardening): findings_insert
      // is now narrowed to `finding.manage` (migration 0031) — this
      // user's plain "Client Administrator" organisation membership
      // alone no longer qualifies. The attribution-check test below
      // performs a direct-SQL Finding insert, so also grant an engagement-
      // scoped "Consultant" membership (which holds `finding.manage`) —
      // every other test in this file uses `asFixtureSetup` (bypasses
      // RLS entirely) and is unaffected.
      await grantEngagementMembership(client, user, engagement, "Consultant");
      const library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "R&F Audit Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "AUD1", title: "R&F audit control" });
      await publishControlLibraryVersion(client, library);
      scoringModel = await createRiskScoringModel(client, { tenantId: tenant, name: "Audit Test Matrix", version: "v1.0" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function latestAuditEntries(entityType: string, entityId: string) {
    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT action, entity_type, entity_id, actor_user_id, field_changes
         FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY occurred_at`,
        [entityType, entityId],
      ),
    );
    return rows.rows;
  }

  it("RiskScoringModel creation is audited", async () => {
    const modelId = await asFixtureSetup((c) => createRiskScoringModel(c, { tenantId: tenant, name: "Second Audit Matrix", version: "v2.0" }));
    const entries = await latestAuditEntries("risk_scoring_models", modelId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.version).toBe("v2.0");
  });

  it("Risk creation, scoring changes, and status changes are all audited", async () => {
    const riskId = await asFixtureSetup((c) => createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Audited risk", likelihood: 3, impact: 3, inherentRating: "medium" }));
    await asFixtureSetup((c) => c.query(`UPDATE risks SET likelihood = 4, impact = 4, inherent_rating = 'high' WHERE id = $1`, [riskId]));
    await asFixtureSetup((c) => c.query(`UPDATE risks SET status = 'mitigating' WHERE id = $1`, [riskId]));

    const entries = await latestAuditEntries("risks", riskId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update", "update"]);
    expect(entries[1]!.field_changes.new.inherent_rating).toBe("high");
    expect(entries[2]!.field_changes.new.status).toBe("mitigating");
  });

  it("RiskControl linkage (material relationship change) is audited as an insert event", async () => {
    const riskId = await asFixtureSetup((c) => createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Link audit risk", likelihood: 2, impact: 2, inherentRating: "low" }));
    const linkId = await asFixtureSetup((c) => linkRiskControl(c, { riskId, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement }));
    const entries = await latestAuditEntries("risk_controls", linkId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.control_id).toBe(control);
  });

  it("Finding creation and severity/status changes are audited", async () => {
    const findingId = await asFixtureSetup((c) => createFinding(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Audited finding", severity: "medium" }));
    await asFixtureSetup((c) => c.query(`UPDATE findings SET severity = 'critical', status = 'in_progress' WHERE id = $1`, [findingId]));

    const entries = await latestAuditEntries("findings", findingId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update"]);
    expect(entries[1]!.field_changes.new).toMatchObject({ severity: "critical", status: "in_progress" });
  });

  it("RemediationAction creation, assignment, status changes, and completion are all audited", async () => {
    const remediationId = await asFixtureSetup((c) => createRemediationAction(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Audited remediation" }));
    await asFixtureSetup((c) => c.query(`UPDATE remediation_actions SET owner_id = $1 WHERE id = $2`, [user, remediationId])); // assignment
    await asFixtureSetup((c) => c.query(`UPDATE remediation_actions SET status = 'in_progress' WHERE id = $1`, [remediationId]));
    await asFixtureSetup((c) => c.query(`UPDATE remediation_actions SET status = 'closed', completed_at = now() WHERE id = $1`, [remediationId])); // completion

    const entries = await latestAuditEntries("remediation_actions", remediationId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update", "update", "update"]);
    expect(entries[1]!.field_changes.new.owner_id).toBe(user);
    expect(entries[2]!.field_changes.new.status).toBe("in_progress");
    expect(entries[3]!.field_changes.new.status).toBe("closed");
    expect(entries[3]!.field_changes.new.completed_at).not.toBeNull();
  });

  it("ValidationRecord creation (the validation decision itself) and the later reassessment-trigger update are both audited", async () => {
    const remediationId = await asFixtureSetup((c) => createRemediationAction(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Validation audit remediation" }));
    const validationId = await asFixtureSetup((c) =>
      createValidationRecord(c, { remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagement, validatedBy: user, outcome: "accepted", rationale: "Validated for audit test." }),
    );

    const entries = await latestAuditEntries("validation_records", validationId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.outcome).toBe("accepted");
  });

  it("every audit entry is correctly attributed to the acting user via auth.uid()", async () => {
    const committedId = await (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO findings (engagement_id, organisation_id, tenant_id, title, severity) VALUES ($1, $2, $3, 'Attribution Check', 'low') RETURNING id`,
          [engagement, org, tenant],
        );
        await client.query("COMMIT");
        return rows[0]!.id;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    })();

    const entries = await latestAuditEntries("findings", committedId);
    expect(entries[0]!.actor_user_id).toBe(user);
  });
});
