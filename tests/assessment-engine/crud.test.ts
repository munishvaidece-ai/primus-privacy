// Milestone 5: Assessment creation, AssessmentControl inclusion,
// AssessmentResponse recording (all five effectiveness_rating states —
// never collapsed to a boolean), and ControlTest (both assessment-scoped
// and standalone/continuous-monitoring). Mutations run via
// asFixtureSetup (committed, matching the convention established in
// tests/master-data/entity-coverage.test.ts and tests/control-library);
// asUser reads back under real RLS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  asUser,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createControlTest,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  grantOrganisationMembership,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Assessment Engine CRUD", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let library: string, controlA: string, controlB: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Assessment CRUD tenant");
      org = await createOrganisation(client, tenant, "CRUD Test Client");
      engagement = await createEngagement(client, tenant, org, "DPDP Readiness — FY2026");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "CRUD Library v1.0" });
      controlA = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "CA1", title: "Access control policy" });
      controlB = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "CA2", title: "Encryption at rest" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates an Assessment, permanently associated with tenant/organisation/engagement/library version/type/period/status", async () => {
    const id = await asFixtureSetup((c) =>
      createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" }),
    );
    const { rows } = await asUser(user, (c) =>
      c.query(
        "SELECT engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label, status FROM assessments WHERE id = $1",
        [id],
      ),
    );
    expect(rows[0]).toMatchObject({
      engagement_id: engagement,
      organisation_id: org,
      tenant_id: tenant,
      control_library_version_id: library,
      assessment_type: "control_readiness",
      period_label: "FY2026",
      status: "draft",
    });
  });

  it("includes Controls in an Assessment via AssessmentControl", async () => {
    const assessment = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026 (AC test)" }));
    const acId = await asFixtureSetup((c) =>
      addAssessmentControl(c, { assessmentId: assessment, controlId: controlA, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }),
    );
    const { rows } = await asUser(user, (c) => c.query("SELECT control_id FROM assessment_controls WHERE id = $1", [acId]));
    expect(rows[0]!.control_id).toBe(controlA);
  });

  it("records an AssessmentResponse using each of the five effectiveness_rating states — never a boolean", async () => {
    const assessment = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026 (ratings test)" }));
    const ratings = ["not_assessed", "not_applicable", "not_implemented", "partially_implemented", "implemented"] as const;
    for (const rating of ratings) {
      const acId = await asFixtureSetup((c) =>
        addAssessmentControl(c, { assessmentId: assessment, controlId: rating === "not_assessed" ? controlA : controlB, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }),
      );
      // controlA is reused only for the first iteration; subsequent
      // iterations need distinct AssessmentControls, so create a fresh
      // Control per rating beyond the first two.
      const { rows } = await asFixtureSetup((c) =>
        c.query(
          `INSERT INTO assessment_responses (assessment_control_id, tenant_id, organisation_id, engagement_id, effectiveness_rating) VALUES ($1, $2, $3, $4, $5) RETURNING id, effectiveness_rating`,
          [acId, tenant, org, engagement, rating],
        ),
      );
      expect(rows[0]!.effectiveness_rating).toBe(rating);
      // Clean up the AssessmentControl (and its response, via FK cascade
      // rules — actually no cascade is defined, so delete response first)
      // so the next iteration's controlB reuse doesn't collide with the
      // assessment_controls_assessment_id_control_id_key uniqueness.
      await asFixtureSetup((c) => c.query("DELETE FROM assessment_responses WHERE id = $1", [rows[0]!.id]));
      await asFixtureSetup((c) => c.query("DELETE FROM assessment_controls WHERE id = $1", [acId]));
    }
  });

  it("records reviewer decision fields (system_suggested_rating, decision_rating, decision_rationale) alongside the assessor's own effectiveness_rating", async () => {
    const assessment = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026 (decision test)" }));
    const acId = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: assessment, controlId: controlA, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `INSERT INTO assessment_responses (assessment_control_id, tenant_id, organisation_id, engagement_id, effectiveness_rating, system_suggested_rating, decision_rating, decision_rationale, respondent_id, submitted_at)
         VALUES ($1, $2, $3, $4, 'partially_implemented', 'not_implemented', 'partially_implemented', 'Reviewer accepted assessor rating after discussion.', $5, now())
         RETURNING system_suggested_rating, decision_rating, decision_rationale`,
        [acId, tenant, org, engagement, user],
      ),
    );
    expect(rows[0]).toMatchObject({
      system_suggested_rating: "not_implemented",
      decision_rating: "partially_implemented",
      decision_rationale: "Reviewer accepted assessor rating after discussion.",
    });
  });

  it("at most one AssessmentResponse per AssessmentControl", async () => {
    const assessment = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026 (uniqueness test)" }));
    const acId = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: assessment, controlId: controlA, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acId, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" }));
    await expect(
      asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acId, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "not_implemented" })),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("records an assessment-scoped ControlTest", async () => {
    const assessment = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026 (test1)" }));
    await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: assessment, controlId: controlA, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    const testId = await asFixtureSetup((c) =>
      createControlTest(c, { controlId: controlA, tenantId: tenant, assessmentId: assessment, organisationId: org, engagementId: engagement, result: "pass" }),
    );
    const { rows } = await asUser(user, (c) => c.query("SELECT assessment_id, result FROM control_tests WHERE id = $1", [testId]));
    expect(rows[0]).toMatchObject({ assessment_id: assessment, result: "pass" });
  });

  it("records a standalone ControlTest with no Assessment (continuous monitoring), assessment_id NULL", async () => {
    const testId = await asFixtureSetup((c) => createControlTest(c, { controlId: controlA, tenantId: tenant, result: "exception_noted" }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT assessment_id, organisation_id, engagement_id, result FROM control_tests WHERE id = $1", [testId]));
    expect(rows[0]).toMatchObject({ assessment_id: null, organisation_id: null, engagement_id: null, result: "exception_noted" });
  });

  it("removing a control from scope is a DELETE on AssessmentControl, not an in-place edit", async () => {
    const assessment = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026 (delete test)" }));
    const acId = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: assessment, controlId: controlA, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library }));
    await asFixtureSetup((c) => c.query("DELETE FROM assessment_controls WHERE id = $1", [acId]));
    const { rows } = await asUser(user, (c) => c.query("SELECT id FROM assessment_controls WHERE id = $1", [acId]));
    expect(rows).toHaveLength(0);
  });
});
