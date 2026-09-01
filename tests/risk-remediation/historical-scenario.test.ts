// Milestone 7's exact required scenario (instructions §10): ABC Financial
// — FY2026, Control C1 — Processor Governance, AssessmentResponse
// "Partially Implemented", Evidence "Processor register v1", Risk
// (Likelihood 4, Impact 4, High), Finding "Processor register
// incomplete", RemediationAction "Complete processor/subprocessor
// inventory" (status Open). Later: remediation status → Completed
// (i.e. `closed` per this schema's exact status set), Evidence
// "Processor register v2", a consultant ValidationRecord.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createDocument,
  createEngagement,
  createEvidence,
  createFinding,
  createOrganisation,
  createRemediationAction,
  createRisk,
  createRiskScoringModel,
  createTenant,
  createUser,
  createValidationRecord,
  finalizeAssessment,
  linkEvidenceToRemediationAction,
  linkFindingRisk,
  linkRemediationFinding,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
  uploadDocumentVersion,
} from "./helpers";

describe("Historical scenario: ABC Financial FY2026 — Risk, Finding, Remediation, Validation", () => {
  let tenant: string, org: string, engagementFY2026: string;
  let library: string, controlC1: string, scoringModel: string;
  let assessmentA1: string, acC1: string, responseC1: string;
  let policyDocument: string, evidenceV1: string, evidenceV2: string;
  let riskId: string, findingId: string, remediationId: string;
  let consultantA: string;
  let validationId: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Historical R&F Scenario Tenant");
      org = await createOrganisation(client, tenant, "ABC Financial Services");
      consultantA = await createUser(client, { tenantId: tenant, clientOrgId: org });

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "R&F Scenario Library v1.0" });
      controlC1 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Processor Governance" });
      await publishControlLibraryVersion(client, library);
      scoringModel = await createRiskScoringModel(client, { tenantId: tenant, name: "R&F Scenario Matrix", version: "v1.0" });

      engagementFY2026 = await createEngagement(client, tenant, org, "ABC Financial — FY2026");
      await pinEngagementControlLibraryVersion(client, engagementFY2026, library);

      assessmentA1 = await createAssessment(client, { engagementId: engagementFY2026, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      acC1 = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlC1, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, controlLibraryVersionId: library });
      responseC1 = await createAssessmentResponse(client, { assessmentControlId: acC1, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, effectivenessRating: "partially_implemented" });

      policyDocument = await createDocument(client, { tenantId: tenant, organisationId: org, engagementId: engagementFY2026, title: "Processor Register" });
      const v1 = await uploadDocumentVersion(client, { documentId: policyDocument, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, content: "Processor register v1 — synthetic content.", uploadedBy: consultantA });
      evidenceV1 = await createEvidence(client, { tenantId: tenant, organisationId: org, engagementId: engagementFY2026, documentVersionId: v1.id, title: "Processor register v1" });

      riskId = await createRisk(client, {
        engagementId: engagementFY2026, organisationId: org, tenantId: tenant, riskScoringModelId: scoringModel,
        title: "Incomplete processor governance", likelihood: 4, impact: 4, inherentRating: "high",
        assessmentResponseId: responseC1,
      });

      findingId = await createFinding(client, { engagementId: engagementFY2026, organisationId: org, tenantId: tenant, title: "Processor register incomplete", severity: "high" });
      await linkFindingRisk(client, { findingId, riskId, tenantId: tenant, organisationId: org, engagementId: engagementFY2026 });

      remediationId = await createRemediationAction(client, { engagementId: engagementFY2026, organisationId: org, tenantId: tenant, title: "Complete processor/subprocessor inventory", status: "open" });
      await linkRemediationFinding(client, { remediationActionId: remediationId, findingId, tenantId: tenant, organisationId: org, engagementId: engagementFY2026 });

      await finalizeAssessment(client, assessmentA1);

      // --- Later: remediation completed, Evidence v2, consultant validates ---
      await client.query(`UPDATE remediation_actions SET status = 'closed', completed_at = now() WHERE id = $1`, [remediationId]);
      const v2 = await uploadDocumentVersion(client, { documentId: policyDocument, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, content: "Processor register v2 — synthetic content, now complete.", uploadedBy: consultantA });
      evidenceV2 = await createEvidence(client, { tenantId: tenant, organisationId: org, engagementId: engagementFY2026, documentVersionId: v2.id, title: "Processor register v2" });
      await linkEvidenceToRemediationAction(client, { evidenceId: evidenceV2, remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagementFY2026 });
      validationId = await createValidationRecord(client, { remediationActionId: remediationId, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, validatedBy: consultantA, outcome: "accepted", rationale: "Processor register v2 confirms complete inventory." });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // 1. FY2026 Assessment Response remains unchanged.
  it("1. the FY2026 AssessmentResponse remains unchanged (still Partially Implemented)", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT effectiveness_rating FROM assessment_responses WHERE id = $1", [responseC1]));
    expect(rows[0]!.effectiveness_rating).toBe("partially_implemented");
  });

  // 2. FY2026 Risk remains historically reproducible.
  it("2. the FY2026 Risk remains historically reproducible (same scoring model, same likelihood/impact/rating)", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT r.likelihood, r.impact, r.inherent_rating, m.version AS scoring_model_version
         FROM risks r JOIN risk_scoring_models m ON m.id = r.risk_scoring_model_id
         WHERE r.id = $1`,
        [riskId],
      ),
    );
    expect(rows[0]).toMatchObject({ likelihood: 4, impact: 4, inherent_rating: "high", scoring_model_version: "v1.0" });
  });

  // 3. FY2026 Finding remains historically identifiable.
  it("3. the FY2026 Finding remains historically identifiable, still linked to the same Risk", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT title, severity FROM findings WHERE id = $1", [findingId]));
    expect(rows[0]).toMatchObject({ title: "Processor register incomplete", severity: "high" });
    const linked = await asFixtureSetup((c) => c.query("SELECT risk_id FROM finding_risks WHERE finding_id = $1", [findingId]));
    expect(linked.rows[0]!.risk_id).toBe(riskId);
  });

  // 4. Remediation status/history is recorded.
  it("4. remediation status/history is recorded — audited insert (open) then update (closed)", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT action, field_changes FROM audit_log WHERE entity_type = 'remediation_actions' AND entity_id = $1 ORDER BY occurred_at`,
        [remediationId],
      ),
    );
    expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(rows[0]!.field_changes.status).toBe("open");
    expect(rows[1]!.field_changes.new.status).toBe("closed");
  });

  // 5. Evidence v2 can be linked to the remediation/validation process.
  it("5. Evidence v2 is linked to the RemediationAction, distinct from v1", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT e.title, dv.version_number
         FROM evidence_links el JOIN evidence e ON e.id = el.evidence_id JOIN document_versions dv ON dv.id = e.document_version_id
         WHERE el.remediation_action_id = $1`,
        [remediationId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Processor register v2", version_number: 2 });
    expect(evidenceV2).not.toBe(evidenceV1);
  });

  // 6. Validation is a separate explicit record.
  it("6. the Validation is a separate, explicit ValidationRecord — not a boolean flag on RemediationAction", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT outcome, validated_by, rationale FROM validation_records WHERE id = $1", [validationId]));
    expect(rows[0]).toMatchObject({ outcome: "accepted", validated_by: consultantA, rationale: "Processor register v2 confirms complete inventory." });
    // Confirm RemediationAction itself has no "validated" boolean column —
    // its own status is the only lifecycle field it carries.
    const columns = await asFixtureSetup((c) =>
      c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'remediation_actions'`),
    );
    expect(columns.rows.map((r) => r.column_name)).not.toContain("validated");
  });

  // 7. No automatic change is made to the historical AssessmentResponse.
  it("7. no automatic change was made to the historical AssessmentResponse as a side effect of remediation/validation", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT action FROM audit_log WHERE entity_type = 'assessment_responses' AND entity_id = $1`, [responseC1]),
    );
    // Only the original creation — nothing downstream (remediation
    // completion, evidence v2, validation) touched this row.
    expect(rows.map((r) => r.action)).toEqual(["insert"]);
  });

  // 8. No automatic maturity improvement occurs.
  //
  // Written when Milestone 7 was the most recent milestone (no Maturity
  // table existed at all yet — instructions §17-19 forbade building one).
  // Milestone 8 has since implemented Maturity (DATA_MODEL.md §9); the
  // real invariant this test protects — "nothing about this remediation/
  // validation scenario ever automatically produces or improves a
  // maturity result" — is now checked directly against those tables:
  // zero MaturityAssessment rows exist anywhere in this tenant, because
  // nothing in this scenario ever computed one.
  it("8. no automatic maturity improvement occurs — no MaturityAssessment was ever computed for this scenario", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT id FROM maturity_assessments WHERE tenant_id = $1`, [tenant]),
    );
    expect(rows).toHaveLength(0);
  });

  // 9. A future assessment can reassess the control.
  it("9. a future assessment can reassess Control C1 — a new Assessment/AssessmentControl/AssessmentResponse for FY2027", async () => {
    const engagementFY2027 = await asFixtureSetup((c) => createEngagement(c, tenant, org, "ABC Financial — FY2027"));
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, engagementFY2027, library));
    const assessmentFY2027 = await asFixtureSetup((c) =>
      createAssessment(c, { engagementId: engagementFY2027, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2027" }),
    );
    const acFY2027 = await asFixtureSetup((c) =>
      addAssessmentControl(c, { assessmentId: assessmentFY2027, controlId: controlC1, tenantId: tenant, organisationId: org, engagementId: engagementFY2027, controlLibraryVersionId: library }),
    );

    // 10. The future assessment may produce a different result based on new evidence.
    const responseFY2027 = await asFixtureSetup((c) =>
      createAssessmentResponse(c, { assessmentControlId: acFY2027, tenantId: tenant, organisationId: org, engagementId: engagementFY2027, effectivenessRating: "implemented", decisionRationale: "Processor register v2 confirms full remediation." }),
    );

    // The consultant records the reassessment on the ValidationRecord —
    // an explicit, deliberate link, never an automatic side effect.
    await asFixtureSetup((c) =>
      c.query(`UPDATE validation_records SET triggers_assessment_response_id = $1 WHERE id = $2`, [responseFY2027, validationId]),
    );

    const { rows: fy2027 } = await asFixtureSetup((c) => c.query("SELECT effectiveness_rating FROM assessment_responses WHERE id = $1", [responseFY2027]));
    expect(fy2027[0]!.effectiveness_rating).toBe("implemented");

    // FY2026's own response is still exactly what it always was.
    const { rows: fy2026 } = await asFixtureSetup((c) => c.query("SELECT effectiveness_rating FROM assessment_responses WHERE id = $1", [responseC1]));
    expect(fy2026[0]!.effectiveness_rating).toBe("partially_implemented");

    const { rows: link } = await asFixtureSetup((c) => c.query("SELECT triggers_assessment_response_id FROM validation_records WHERE id = $1", [validationId]));
    expect(link[0]!.triggers_assessment_response_id).toBe(responseFY2027);
  });
});
