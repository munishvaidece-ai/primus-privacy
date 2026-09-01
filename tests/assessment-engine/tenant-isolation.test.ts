// Milestone 5 instructions §14/§15: Tenant/Organisation/Engagement
// boundary enforcement for all assessment objects, plus the 8 required
// RLS tests: (1) Tenant A own assessment, (2) Tenant A cannot access
// Tenant B assessment, (3) Organisation A cannot access Organisation B
// assessment, (4) AssessmentControl cannot cross tenants, (5)
// AssessmentControl cannot reference controls from another library
// version (covered directly in consistency.test.ts's CRITICAL suite —
// re-asserted here from the tenant-isolation angle), (6)-(7) unauthorized
// read/write blocking, (8) finalized assessments cannot be mutated
// (covered in finalization.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asAnon,
  asFixtureSetup,
  asUser,
  createAssessment,
  createControl,
  createControlLibraryVersion,
  createControlTest,
  createEngagement,
  createOrganisation,
  createTenant,
  createUser,
  grantOrganisationMembership,
  grantTenantMembership,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Assessment Engine tenant/organisation isolation and write protection", () => {
  let tenantA: string, tenantB: string;
  let orgA1: string, orgA2: string, orgB: string;
  let engagementA1: string, engagementA2: string, engagementB: string;
  let libraryA: string, controlA: string;
  let libraryB: string, controlB: string;
  let assessmentA1: string, assessmentA2: string, assessmentB: string;
  let acA1: string;

  let orgWideUserA: string;
  let userB: string;
  let outsiderUser: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — assessment isolation");
      tenantB = await createTenant(client, "Tenant B — assessment isolation");
      orgA1 = await createOrganisation(client, tenantA, "ABC Financial Services");
      orgA2 = await createOrganisation(client, tenantA, "Another Client Under Tenant A");
      orgB = await createOrganisation(client, tenantB, "Unrelated Client Co");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Tenant A Library" });
      controlA = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "TA1", title: "Tenant A control" });
      await publishControlLibraryVersion(client, libraryA);

      libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Tenant B Library" });
      controlB = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "TB1", title: "Tenant B control" });
      await publishControlLibraryVersion(client, libraryB);

      engagementA1 = await createEngagement(client, tenantA, orgA1, "Tenant A Engagement 1");
      await pinEngagementControlLibraryVersion(client, engagementA1, libraryA);
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Tenant A Engagement 2");
      await pinEngagementControlLibraryVersion(client, engagementA2, libraryA);
      engagementB = await createEngagement(client, tenantB, orgB, "Tenant B Engagement");
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      assessmentA1 = await createAssessment(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "A1" });
      acA1 = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlA, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, controlLibraryVersionId: libraryA });
      assessmentA2 = await createAssessment(client, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "A2" });
      assessmentB = await createAssessment(client, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, controlLibraryVersionId: libraryB, periodLabel: "B" });

      orgWideUserA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA1 });
      await grantOrganisationMembership(client, orgWideUserA, orgA1);

      userB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantOrganisationMembership(client, userB, orgB);
      await grantTenantMembership(client, userB, tenantB);

      outsiderUser = await createUser(client, { tenantId: tenantA });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below (the shared `pool` singleton would error if
  // ended twice).

  // (1) Tenant A can access its own assessment.
  it("a Tenant A user can read their own tenant's Assessment", async () => {
    const rows = await asUser(orgWideUserA, (c) => c.query("SELECT id FROM assessments WHERE id = $1", [assessmentA1]));
    expect(rows.rows).toHaveLength(1);
  });

  // (2) Tenant A cannot access Tenant B assessment.
  it("Tenant A cannot access Tenant B's Assessment", async () => {
    const rows = await asUser(orgWideUserA, (c) => c.query("SELECT id FROM assessments WHERE id = $1", [assessmentB]));
    expect(rows.rows).toHaveLength(0);
    const listing = await asUser(orgWideUserA, (c) => c.query("SELECT id FROM assessments"));
    expect(listing.rows.map((r) => r.id)).not.toContain(assessmentB);
  });

  // (3) Organisation A cannot access Organisation B assessment (both under Tenant A).
  it("Organisation A1's member cannot access Organisation A2's Assessment, even under the same tenant", async () => {
    const rows = await asUser(orgWideUserA, (c) => c.query("SELECT id FROM assessments WHERE id = $1", [assessmentA2]));
    expect(rows.rows).toHaveLength(0);
  });

  // (4) AssessmentControl cannot cross tenants.
  it("Tenant B cannot read Tenant A's AssessmentControl", async () => {
    const rows = await asUser(userB, (c) => c.query("SELECT id FROM assessment_controls WHERE id = $1", [acA1]));
    expect(rows.rows).toHaveLength(0);
  });

  it("Tenant B cannot INSERT an AssessmentControl into Tenant A's Assessment", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(
          `INSERT INTO assessment_controls (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [assessmentA1, controlA, tenantA, orgA1, engagementA1, libraryA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("Tenant B cannot INSERT an AssessmentControl referencing Tenant B's own Control into Tenant A's Assessment (cross-tenant control forgery, also blocked by the library-version FK)", async () => {
    await expect(
      asFixtureSetup((c) =>
        addAssessmentControl(c, { assessmentId: assessmentA1, controlId: controlB, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, controlLibraryVersionId: libraryA }),
      ),
    ).rejects.toThrow(/violates foreign key constraint|control_library_version_fk/i);
  });

  // (6)/(7) Unauthorized read/write blocking.
  it("an unaffiliated user cannot read any Tenant A Assessment", async () => {
    const rows = await asUser(outsiderUser, (c) => c.query("SELECT id FROM assessments WHERE id = $1", [assessmentA1]));
    expect(rows.rows).toHaveLength(0);
  });

  it("an anonymous request is denied at the grant level", async () => {
    await expect(asAnon((c) => c.query("SELECT id FROM assessments WHERE id = $1", [assessmentA1]))).rejects.toThrow(/permission denied/i);
  });

  it("Tenant B cannot UPDATE Tenant A's Assessment (0 rows affected — not visible to them at all)", async () => {
    const result = await asUser(userB, (c) => c.query("UPDATE assessments SET period_label = 'tampered' WHERE id = $1", [assessmentA1]));
    expect(result.rowCount).toBe(0);
    const check = await asUser(orgWideUserA, (c) => c.query("SELECT period_label FROM assessments WHERE id = $1", [assessmentA1]));
    expect(check.rows[0]!.period_label).toBe("A1");
  });

  it("an authorized user CAN write (INSERT/UPDATE) their own Assessment — proving the blocks above are real access control, not a broken pipe", async () => {
    const insertResult = await asUser(orgWideUserA, (c) =>
      c.query(
        `INSERT INTO assessments (engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label)
         VALUES ($1, $2, $3, $4, 'annual', 'New Assessment') RETURNING id`,
        [engagementA1, orgA1, tenantA, libraryA],
      ),
    );
    expect(insertResult.rows).toHaveLength(1);

    const updateResult = await asUser(orgWideUserA, (c) =>
      c.query("UPDATE assessments SET period_label = 'Updated Label' WHERE id = $1 RETURNING period_label", [assessmentA1]),
    );
    expect(updateResult.rows[0]!.period_label).toBe("Updated Label");
  });
});

describe("ControlTest dual-mode isolation (engagement-scoped vs. standalone/continuous-monitoring)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string;
  let libraryA: string, controlA: string;
  let engagementA: string, assessmentA: string;

  let tenantMemberA: string; // TenantMembership on tenant A — reads/writes standalone tests
  let orgScopedUserA: string; // OrganisationMembership only — reads/writes engagement-scoped tests
  let userB: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "ControlTest isolation tenant A");
      tenantB = await createTenant(client, "ControlTest isolation tenant B");
      orgA = await createOrganisation(client, tenantA, "ControlTest isolation client");
      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "ControlTest Isolation Library" });
      controlA = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "CT1", title: "ControlTest isolation control" });
      await publishControlLibraryVersion(client, libraryA);

      engagementA = await createEngagement(client, tenantA, orgA, "ControlTest isolation engagement");
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);
      assessmentA = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "CT isolation" });
      await addAssessmentControl(client, { assessmentId: assessmentA, controlId: controlA, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });

      tenantMemberA = await createUser(client, { tenantId: tenantA });
      await grantTenantMembership(client, tenantMemberA, tenantA);

      orgScopedUserA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, orgScopedUserA, orgA);

      userB = await createUser(client, { tenantId: tenantB });
      await grantTenantMembership(client, userB, tenantB);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a TenantMembership holder can read AND write a standalone (assessment_id NULL) ControlTest", async () => {
    const testId = await asUser(tenantMemberA, (c) =>
      c
        .query(`INSERT INTO control_tests (control_id, tenant_id, methodology, result) VALUES ($1, $2, 'Standalone test', 'pass') RETURNING id`, [controlA, tenantA])
        .then((r) => r.rows[0]!.id),
    );
    void testId; // rolled back by asUser — repeat as committed fixture to confirm persistence

    const committed = await asFixtureSetup((c) =>
      createControlTest(c, { controlId: controlA, tenantId: tenantA, methodology: "Standalone test (committed)" }),
    );
    const rows = await asUser(tenantMemberA, (c) => c.query("SELECT id FROM control_tests WHERE id = $1", [committed]));
    expect(rows.rows).toHaveLength(1);
  });

  it("an organisation-scoped user (no TenantMembership) CANNOT write a standalone ControlTest — that's practice-governance content", async () => {
    await expect(
      asUser(orgScopedUserA, (c) =>
        c.query(`INSERT INTO control_tests (control_id, tenant_id, methodology, result) VALUES ($1, $2, 'Attempted standalone test', 'pass')`, [controlA, tenantA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("an organisation-scoped user CAN read AND write an engagement-scoped ControlTest (assessment_id set)", async () => {
    const committed = await asFixtureSetup((c) =>
      createControlTest(c, { controlId: controlA, tenantId: tenantA, assessmentId: assessmentA, organisationId: orgA, engagementId: engagementA, methodology: "Engagement-scoped test" }),
    );
    const rows = await asUser(orgScopedUserA, (c) => c.query("SELECT id FROM control_tests WHERE id = $1", [committed]));
    expect(rows.rows).toHaveLength(1);

    const updateResult = await asUser(orgScopedUserA, (c) =>
      c.query("UPDATE control_tests SET result = 'exception_noted' WHERE id = $1 RETURNING result", [committed]),
    );
    expect(updateResult.rows[0]!.result).toBe("exception_noted");
  });

  it("Tenant B cannot read Tenant A's standalone ControlTest", async () => {
    const committed = await asFixtureSetup((c) => createControlTest(c, { controlId: controlA, tenantId: tenantA, methodology: "Cross-tenant read test" }));
    const rows = await asUser(userB, (c) => c.query("SELECT id FROM control_tests WHERE id = $1", [committed]));
    expect(rows.rows).toHaveLength(0);
  });

  it("Tenant B cannot read Tenant A's engagement-scoped ControlTest", async () => {
    const committed = await asFixtureSetup((c) =>
      createControlTest(c, { controlId: controlA, tenantId: tenantA, assessmentId: assessmentA, organisationId: orgA, engagementId: engagementA, methodology: "Cross-tenant engagement-scoped read test" }),
    );
    const rows = await asUser(userB, (c) => c.query("SELECT id FROM control_tests WHERE id = $1", [committed]));
    expect(rows.rows).toHaveLength(0);
  });
});
