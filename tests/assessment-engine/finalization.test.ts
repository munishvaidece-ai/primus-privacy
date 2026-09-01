// Milestone 5 instructions §10: finalized assessments must be protected
// from ordinary mutation — at the database level, not just the
// application layer. Draft assessments remain freely editable throughout.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createControlTest,
  createEngagement,
  createOrganisation,
  createTenant,
  finalizeAssessment,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Finalized-assessment immutability", () => {
  let tenant: string, org: string, engagement: string, library: string, control: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Finalization test tenant");
      org = await createOrganisation(client, tenant, "Finalization Test Client");
      engagement = await createEngagement(client, tenant, org, "Finalization Test Engagement");
      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Finalization Test Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "F1", title: "Finalization test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a draft Assessment can be freely edited (period_label, ordinary fields)", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Draft Label" }));
    await asFixtureSetup((c) => c.query(`UPDATE assessments SET period_label = 'Renamed Draft Label' WHERE id = $1`, [id]));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT period_label, status FROM assessments WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ period_label: "Renamed Draft Label", status: "draft" });
  });

  it("draft -> finalized is allowed", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "To Be Finalized" }));
    await asFixtureSetup((c) => finalizeAssessment(c, id));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM assessments WHERE id = $1", [id]));
    expect(rows[0]!.status).toBe("finalized");
  });

  it("a finalized Assessment cannot be un-finalized or edited in any way — even a no-op field UPDATE", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Immutable After Finalization" }));
    await asFixtureSetup((c) => finalizeAssessment(c, id));

    await expect(
      asFixtureSetup((c) => c.query(`UPDATE assessments SET status = 'draft' WHERE id = $1`, [id])),
    ).rejects.toThrow(/finalized assessment is immutable/i);

    await expect(
      asFixtureSetup((c) => c.query(`UPDATE assessments SET period_label = 'Tampered' WHERE id = $1`, [id])),
    ).rejects.toThrow(/finalized assessment is immutable/i);
  });

  it("an AssessmentControl cannot be INSERTed into a finalized Assessment", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "No New Controls After Finalization" }));
    await asFixtureSetup((c) => finalizeAssessment(c, id));
    await expect(
      asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: id, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library })),
    ).rejects.toThrow(/finalized assessment/i);
  });

  it("an AssessmentControl cannot be DELETEd from a finalized Assessment", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "No Removing Controls After Finalization" }));
    const acId = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: id, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    await asFixtureSetup((c) => finalizeAssessment(c, id));
    await expect(
      asFixtureSetup((c) => c.query("DELETE FROM assessment_controls WHERE id = $1", [acId])),
    ).rejects.toThrow(/finalized assessment/i);
  });

  it("an AssessmentResponse cannot be created on a finalized Assessment's AssessmentControl", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "No New Response After Finalization" }));
    const acId = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: id, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    await asFixtureSetup((c) => finalizeAssessment(c, id));
    await expect(
      asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acId, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" })),
    ).rejects.toThrow(/finalized assessment/i);
  });

  it("an AssessmentResponse becomes read-only once its Assessment is finalized — the exact DATA_MODEL.md §6 guarantee", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Response Read-Only Test" }));
    const acId = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: id, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    const responseId = await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acId, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "partially_implemented", decisionRationale: "Original rationale" }));
    await asFixtureSetup((c) => finalizeAssessment(c, id));

    await expect(
      asFixtureSetup((c) => c.query(`UPDATE assessment_responses SET decision_rationale = 'Tampered rationale' WHERE id = $1`, [responseId])),
    ).rejects.toThrow(/finalized assessment/i);

    await expect(
      asFixtureSetup((c) => c.query("DELETE FROM assessment_responses WHERE id = $1", [responseId])),
    ).rejects.toThrow(/finalized assessment/i);

    // Confirm the original value survived every rejected attempt.
    const { rows } = await asFixtureSetup((c) => c.query("SELECT decision_rationale FROM assessment_responses WHERE id = $1", [responseId]));
    expect(rows[0]!.decision_rationale).toBe("Original rationale");
  });

  it("a ControlTest tied to a finalized Assessment cannot be modified", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Control Test Lock Test" }));
    await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: id, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    const testId = await asFixtureSetup((c) => createControlTest(c, { controlId: control, tenantId: tenant, assessmentId: id, organisationId: org, engagementId: engagement, result: "pass" }));
    await asFixtureSetup((c) => finalizeAssessment(c, id));

    await expect(
      asFixtureSetup((c) => c.query(`UPDATE control_tests SET result = 'fail' WHERE id = $1`, [testId])),
    ).rejects.toThrow(/finalized assessment/i);
  });

  it("a standalone ControlTest (no Assessment) is never locked by finalization — it isn't tied to any assessment lifecycle", async () => {
    const testId = await asFixtureSetup((c) => createControlTest(c, { controlId: control, tenantId: tenant, result: "pass" }));
    await asFixtureSetup((c) => c.query(`UPDATE control_tests SET result = 'exception_noted' WHERE id = $1`, [testId]));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT result FROM control_tests WHERE id = $1", [testId]));
    expect(rows[0]!.result).toBe("exception_noted");
  });

  it("everything remains freely editable/deletable while the Assessment stays draft", async () => {
    const id = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Still Draft Test" }));
    const acId = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: id, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    const responseId = await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acId, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "not_implemented" }));

    await asFixtureSetup((c) => c.query(`UPDATE assessment_responses SET effectiveness_rating = 'implemented' WHERE id = $1`, [responseId]));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT effectiveness_rating FROM assessment_responses WHERE id = $1", [responseId]));
    expect(rows[0]!.effectiveness_rating).toBe("implemented");

    await asFixtureSetup((c) => c.query("DELETE FROM assessment_responses WHERE id = $1", [responseId]));
    await asFixtureSetup((c) => c.query("DELETE FROM assessment_controls WHERE id = $1", [acId]));
    const after = await asFixtureSetup((c) => c.query("SELECT id FROM assessment_controls WHERE id = $1", [acId]));
    expect(after.rows).toHaveLength(0);
  });
});
