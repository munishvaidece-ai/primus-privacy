// Milestone 7: RiskScoringModel/Risk/Finding/RemediationAction/
// ValidationRecord CRUD, their M2M junctions, and Evidence linking to
// RemediationAction/ValidationRecord. Mutations run via asFixtureSetup
// (committed, matching the project convention); asUser reads back under
// real RLS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createControl,
  createControlLibraryVersion,
  createDocument,
  createEngagement,
  createEvidence,
  createFinding,
  createOrganisation,
  createProcessingActivity,
  createRemediationAction,
  createRisk,
  createRiskScoringModel,
  createTenant,
  createUser,
  createValidationRecord,
  grantOrganisationMembership,
  linkEvidenceToRemediationAction,
  linkEvidenceToValidationRecord,
  linkFindingControl,
  linkFindingProcessingActivity,
  linkFindingRisk,
  linkRemediationControl,
  linkRemediationFinding,
  linkRemediationRisk,
  linkRiskControl,
  linkRiskProcessingActivity,
  pool,
  publishControlLibraryVersion,
  uploadDocumentVersion,
} from "./helpers";

describe("Risk, Findings & Remediation CRUD", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let library: string, control: string, pa: string;
  let scoringModel: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "R&F CRUD tenant");
      org = await createOrganisation(client, tenant, "R&F CRUD client");
      engagement = await createEngagement(client, tenant, org, "R&F CRUD engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "R&F CRUD Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "RF1", title: "R&F CRUD control" });
      await publishControlLibraryVersion(client, library);
      pa = await createProcessingActivity(client, { engagementId: engagement, organisationId: org, tenantId: tenant, name: "R&F CRUD processing activity" });

      scoringModel = await createRiskScoringModel(client, { tenantId: tenant, name: "Standard 5x5 Matrix", version: "v1.0" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a RiskScoringModel, active by default", async () => {
    const { rows } = await asUser(user, (c) => c.query("SELECT is_active FROM risk_scoring_models WHERE id = $1", [scoringModel]));
    expect(rows[0]!.is_active).toBe(true);
  });

  it("creates a Risk with likelihood/impact/inherent_rating pinned to the active scoring model", async () => {
    const riskId = await asFixtureSetup((c) =>
      createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Processor governance risk", likelihood: 4, impact: 4, inherentRating: "high" }),
    );
    const { rows } = await asUser(user, (c) =>
      c.query("SELECT likelihood, impact, inherent_rating, risk_scoring_model_id, status FROM risks WHERE id = $1", [riskId]),
    );
    expect(rows[0]).toMatchObject({ likelihood: 4, impact: 4, inherent_rating: "high", risk_scoring_model_id: scoringModel, status: "open" });
  });

  it("rejects a likelihood/impact value outside the 1-5 range", async () => {
    await expect(
      asFixtureSetup((c) =>
        createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Out of range", likelihood: 6, impact: 3, inherentRating: "high" }),
      ),
    ).rejects.toThrow(/violates check constraint|risks_likelihood_range_check/i);
  });

  it("links a Risk to a Control and a Processing Activity (M2M)", async () => {
    const riskId = await asFixtureSetup((c) =>
      createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Link test risk", likelihood: 3, impact: 3, inherentRating: "medium" }),
    );
    const rcId = await asFixtureSetup((c) => linkRiskControl(c, { riskId, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement }));
    const rpaId = await asFixtureSetup((c) => linkRiskProcessingActivity(c, { riskId, processingActivityId: pa, tenantId: tenant, organisationId: org, engagementId: engagement }));

    const controls = await asUser(user, (c) => c.query("SELECT control_id FROM risk_controls WHERE id = $1", [rcId]));
    expect(controls.rows[0]!.control_id).toBe(control);
    const pas = await asUser(user, (c) => c.query("SELECT processing_activity_id FROM risk_processing_activities WHERE id = $1", [rpaId]));
    expect(pas.rows[0]!.processing_activity_id).toBe(pa);
  });

  it("creates a Finding, and links it to Risk/Control/ProcessingActivity", async () => {
    const riskId = await asFixtureSetup((c) =>
      createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Finding link risk", likelihood: 4, impact: 4, inherentRating: "high" }),
    );
    const findingId = await asFixtureSetup((c) => createFinding(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Processor register incomplete", severity: "high" }));

    const { rows } = await asUser(user, (c) => c.query("SELECT title, severity, status FROM findings WHERE id = $1", [findingId]));
    expect(rows[0]).toMatchObject({ title: "Processor register incomplete", severity: "high", status: "open" });

    await asFixtureSetup((c) => linkFindingRisk(c, { findingId, riskId, tenantId: tenant, organisationId: org, engagementId: engagement }));
    await asFixtureSetup((c) => linkFindingControl(c, { findingId, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement }));
    await asFixtureSetup((c) => linkFindingProcessingActivity(c, { findingId, processingActivityId: pa, tenantId: tenant, organisationId: org, engagementId: engagement }));

    const risks = await asUser(user, (c) => c.query("SELECT risk_id FROM finding_risks WHERE finding_id = $1", [findingId]));
    expect(risks.rows[0]!.risk_id).toBe(riskId);
    const controls = await asUser(user, (c) => c.query("SELECT control_id FROM finding_controls WHERE finding_id = $1", [findingId]));
    expect(controls.rows[0]!.control_id).toBe(control);
    const pas = await asUser(user, (c) => c.query("SELECT processing_activity_id FROM finding_processing_activities WHERE finding_id = $1", [findingId]));
    expect(pas.rows[0]!.processing_activity_id).toBe(pa);
  });

  it("creates a RemediationAction using the exact five-value status set, and links it to Finding/Risk/Control", async () => {
    const findingId = await asFixtureSetup((c) => createFinding(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Remediation link finding" }));
    const riskId = await asFixtureSetup((c) =>
      createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Remediation link risk", likelihood: 3, impact: 3, inherentRating: "medium" }),
    );
    const remediationId = await asFixtureSetup((c) =>
      createRemediationAction(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Complete processor/subprocessor inventory", priority: "high", dueDate: "2026-12-31" }),
    );

    const { rows } = await asUser(user, (c) => c.query("SELECT title, status, priority, due_date FROM remediation_actions WHERE id = $1", [remediationId]));
    expect(rows[0]).toMatchObject({ title: "Complete processor/subprocessor inventory", status: "open", priority: "high" });

    await asFixtureSetup((c) => linkRemediationFinding(c, { remediationActionId: remediationId, findingId, tenantId: tenant, organisationId: org, engagementId: engagement }));
    await asFixtureSetup((c) => linkRemediationRisk(c, { remediationActionId: remediationId, riskId, tenantId: tenant, organisationId: org, engagementId: engagement }));
    await asFixtureSetup((c) => linkRemediationControl(c, { remediationActionId: remediationId, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement }));

    const findings = await asUser(user, (c) => c.query("SELECT finding_id FROM remediation_findings WHERE remediation_action_id = $1", [remediationId]));
    expect(findings.rows[0]!.finding_id).toBe(findingId);
  });

  it("progresses a RemediationAction through its full status lifecycle", async () => {
    const remediationId = await asFixtureSetup((c) => createRemediationAction(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Lifecycle test remediation" }));
    for (const status of ["in_progress", "evidence_submitted", "validated", "closed"] as const) {
      await asFixtureSetup((c) => c.query(`UPDATE remediation_actions SET status = $1 WHERE id = $2`, [status, remediationId]));
    }
    const { rows } = await asUser(user, (c) => c.query("SELECT status FROM remediation_actions WHERE id = $1", [remediationId]));
    expect(rows[0]!.status).toBe("closed");
  });

  it("links Evidence to a RemediationAction and a ValidationRecord", async () => {
    const remediationId = await asFixtureSetup((c) => createRemediationAction(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Evidence link remediation" }));
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Processor register" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Processor register v2 content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: versionId, title: "Processor register v2" }));

    const linkId = await asFixtureSetup((c) => linkEvidenceToRemediationAction(c, { evidenceId, remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagement }));
    const { rows } = await asUser(user, (c) => c.query("SELECT subject_type, remediation_action_id FROM evidence_links WHERE id = $1", [linkId]));
    expect(rows[0]).toMatchObject({ subject_type: "remediation_action", remediation_action_id: remediationId });

    const validationId = await asFixtureSetup((c) => createValidationRecord(c, { remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagement, validatedBy: user, outcome: "accepted", rationale: "Register now complete." }));
    const vLinkId = await asFixtureSetup((c) => linkEvidenceToValidationRecord(c, { evidenceId, validationRecordId: validationId, tenantId: tenant, organisationId: org, engagementId: engagement }));
    const { rows: vRows } = await asUser(user, (c) => c.query("SELECT subject_type, validation_record_id FROM evidence_links WHERE id = $1", [vLinkId]));
    expect(vRows[0]).toMatchObject({ subject_type: "validation_record", validation_record_id: validationId });
  });

  it("creates a ValidationRecord recording who validated, when, the outcome, and rationale", async () => {
    const remediationId = await asFixtureSetup((c) => createRemediationAction(c, { engagementId: engagement, organisationId: org, tenantId: tenant, title: "Validation record test remediation" }));
    const validationId = await asFixtureSetup((c) =>
      createValidationRecord(c, { remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagement, validatedBy: user, outcome: "accepted", rationale: "Consultant confirmed evidence is sufficient." }),
    );
    const { rows } = await asUser(user, (c) => c.query("SELECT validated_by, outcome, rationale, validated_at FROM validation_records WHERE id = $1", [validationId]));
    expect(rows[0]).toMatchObject({ validated_by: user, outcome: "accepted", rationale: "Consultant confirmed evidence is sufficient." });
    expect(rows[0]!.validated_at).not.toBeNull();
  });

  it("removing a junction link is a DELETE, not an in-place edit", async () => {
    const riskId = await asFixtureSetup((c) =>
      createRisk(c, { engagementId: engagement, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel, title: "Delete link test risk", likelihood: 2, impact: 2, inherentRating: "low" }),
    );
    const linkId = await asFixtureSetup((c) => linkRiskControl(c, { riskId, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement }));
    await asFixtureSetup((c) => c.query("DELETE FROM risk_controls WHERE id = $1", [linkId]));
    const { rows } = await asUser(user, (c) => c.query("SELECT id FROM risk_controls WHERE id = $1", [linkId]));
    expect(rows).toHaveLength(0);
  });
});
