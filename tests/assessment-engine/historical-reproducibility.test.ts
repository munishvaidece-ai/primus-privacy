// Milestone 5's exact required scenario (instructions §12): Library v1.0
// (C1, C2); Engagement "ABC Financial — FY2026" pinned to v1.0; Assessment
// A1 uses v1.0, includes C1, records a "Partially Implemented" response
// with a synthetic rationale, and a synthetic ControlTest. Library v2.0
// (C1, C2, C3, and/or changed mappings) is published afterward. The
// FY2026 Assessment A1 must continue to resolve to the original Library
// v1.0 Control C1 — it must NOT acquire C3, and must NOT change because
// Library v2.0 exists.
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
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Assessment historical reproducibility across Library v1.0 -> v2.0 (ABC Financial Services scenario)", () => {
  let tenant: string, org: string;
  let libraryV1: string, controlV1C1: string, controlV1C2: string;
  let engagementFY2026: string, assessmentA1: string, ac1: string, response1: string, test1: string;
  let libraryV2: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Assessment Historical Reproducibility Tenant");
      org = await createOrganisation(client, tenant, "ABC Financial Services");

      // --- Library v1.0: C1, C2 ---
      libraryV1 = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Assessment Scenario Library v1.0" });
      controlV1C1 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV1, code: "C1", title: "Access control policy" });
      controlV1C2 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV1, code: "C2", title: "Encryption at rest" });
      await publishControlLibraryVersion(client, libraryV1);

      // --- Engagement pinned to Library v1.0 ---
      engagementFY2026 = await createEngagement(client, tenant, org, "ABC Financial — FY2026");
      await pinEngagementControlLibraryVersion(client, engagementFY2026, libraryV1);

      // --- Assessment A1, uses Library v1.0 ---
      assessmentA1 = await createAssessment(client, {
        engagementId: engagementFY2026,
        organisationId: org,
        tenantId: tenant,
        controlLibraryVersionId: libraryV1,
        periodLabel: "FY2026",
      });
      ac1 = await addAssessmentControl(client, {
        assessmentId: assessmentA1,
        controlId: controlV1C1,
        tenantId: tenant,
        organisationId: org,
        engagementId: engagementFY2026,
        controlLibraryVersionId: libraryV1,
      });
      response1 = await createAssessmentResponse(client, {
        assessmentControlId: ac1,
        tenantId: tenant,
        organisationId: org,
        engagementId: engagementFY2026,
        effectivenessRating: "partially_implemented",
        decisionRationale: "Synthetic test rationale.",
      });
      test1 = await createControlTest(client, {
        controlId: controlV1C1,
        tenantId: tenant,
        assessmentId: assessmentA1,
        organisationId: org,
        engagementId: engagementFY2026,
        methodology: "Synthetic test procedure.",
        result: "exception_noted",
      });

      // --- Later: Library v2.0 (C1, C2, C3) ---
      libraryV2 = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Assessment Scenario Library v2.0" });
      await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV2, code: "C1", title: "Access control policy (revised)" });
      await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV2, code: "C2", title: "Encryption at rest (revised)" });
      await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV2, code: "C3", title: "Key management" });
      await publishControlLibraryVersion(client, libraryV2);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Assessment A1 still resolves to Library v1.0, not v2.0, after v2.0 is published", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT control_library_version_id FROM assessments WHERE id = $1", [assessmentA1]));
    expect(rows[0]!.control_library_version_id).toBe(libraryV1);
    expect(rows[0]!.control_library_version_id).not.toBe(libraryV2);
  });

  it("Assessment A1's AssessmentControl still resolves to the original Library v1.0 Control C1 (same row, unchanged id)", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT ac.control_id, c.code, c.title
         FROM assessment_controls ac JOIN controls c ON c.id = ac.control_id
         WHERE ac.id = $1`,
        [ac1],
      ),
    );
    expect(rows[0]).toMatchObject({ control_id: controlV1C1, code: "C1", title: "Access control policy" });
  });

  it("Assessment A1 does NOT automatically acquire Control C3 from Library v2.0", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT control_id FROM assessment_controls WHERE assessment_id = $1", [assessmentA1]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.control_id).toBe(controlV1C1);

    const { rows: c3Rows } = await asFixtureSetup((c) => c.query("SELECT id FROM controls WHERE control_library_version_id = $1 AND code = 'C3'", [libraryV2]));
    expect(rows.map((r) => r.control_id)).not.toContain(c3Rows[0]!.id);
  });

  it("Assessment A1's response and rationale are unchanged: 'Partially Implemented' with the synthetic rationale", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT effectiveness_rating, decision_rationale FROM assessment_responses WHERE id = $1", [response1]));
    expect(rows[0]).toMatchObject({ effectiveness_rating: "partially_implemented", decision_rationale: "Synthetic test rationale." });
  });

  it("Assessment A1's ControlTest is unchanged: synthetic test procedure, still tied to Library v1.0's C1", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT methodology, control_id FROM control_tests WHERE id = $1", [test1]));
    expect(rows[0]).toMatchObject({ methodology: "Synthetic test procedure.", control_id: controlV1C1 });
  });

  it("attempting to attach Library v2.0's Control C3 to Assessment A1 is rejected by the database, proving it could never have happened silently", async () => {
    const { rows: c3Rows } = await asFixtureSetup((c) => c.query("SELECT id FROM controls WHERE control_library_version_id = $1 AND code = 'C3'", [libraryV2]));
    const controlV2C3 = c3Rows[0]!.id;
    await expect(
      asFixtureSetup((c) =>
        addAssessmentControl(c, {
          assessmentId: assessmentA1,
          controlId: controlV2C3,
          tenantId: tenant,
          organisationId: org,
          engagementId: engagementFY2026,
          controlLibraryVersionId: libraryV1,
        }),
      ),
    ).rejects.toThrow(/violates foreign key constraint|control_library_version_fk/i);
  });

  it("Library v1.0's own Controls (C1, C2) and Library v2.0's Controls remain distinct row sets, exactly as Milestone 4 guaranteed", async () => {
    const v1Controls = await asFixtureSetup((c) => c.query("SELECT code FROM controls WHERE control_library_version_id = $1 ORDER BY code", [libraryV1]));
    expect(v1Controls.rows.map((r) => r.code)).toEqual(["C1", "C2"]);
    const v2Controls = await asFixtureSetup((c) => c.query("SELECT code FROM controls WHERE control_library_version_id = $1 ORDER BY code", [libraryV2]));
    expect(v2Controls.rows.map((r) => r.code)).toEqual(["C1", "C2", "C3"]);
  });

  it("resolves Assessment A1's full result set in one join, unaffected by Library v2.0's existence", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT c.code, ar.effectiveness_rating, ct.result
         FROM assessments a
         JOIN assessment_controls ac ON ac.assessment_id = a.id
         JOIN controls c ON c.id = ac.control_id
         LEFT JOIN assessment_responses ar ON ar.assessment_control_id = ac.id
         LEFT JOIN control_tests ct ON ct.assessment_id = a.id AND ct.control_id = ac.control_id
         WHERE a.id = $1`,
        [assessmentA1],
      ),
    );
    expect(rows).toEqual([{ code: "C1", effectiveness_rating: "partially_implemented", result: "exception_noted" }]);
  });
});
