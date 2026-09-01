// Milestone 5 instructions §3/§6 — the CRITICAL invariants:
//   - An Assessment must use the same ControlLibraryVersion as its
//     Engagement (§3), enforced by a database composite FK.
//   - An AssessmentControl must only reference a Control belonging to
//     the ControlLibraryVersion used by its Assessment (§6, "CRITICAL"),
//     enforced by database composite FKs, not application validation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  createAssessment,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createOrganisation,
  createTenant,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Engagement/ControlLibraryVersion consistency for Assessment", () => {
  let tenant: string, org: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Consistency test tenant");
      org = await createOrganisation(client, tenant, "Consistency Test Client");
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below (the shared `pool` singleton would error if
  // ended twice).

  it("an Assessment cannot be created for an Engagement with no ControlLibraryVersion pinned yet", async () => {
    const engagement = await asFixtureSetup((c) => createEngagement(c, tenant, org, "Unpinned Engagement"));
    const library = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Unused Library" }));
    await expect(
      asFixtureSetup((c) => createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Should fail" })),
    ).rejects.toThrow(/violates foreign key constraint|assessments_engagement_control_library_version_fk/i);
  });

  it("an Assessment cannot reference a ControlLibraryVersion different from its Engagement's pinned one", async () => {
    const libraryA = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Pinned Library" }));
    const libraryB = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Different Library" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, libraryA));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, libraryB));
    const engagement = await asFixtureSetup((c) => createEngagement(c, tenant, org, "Pinned to Library A"));
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, engagement, libraryA));

    await expect(
      asFixtureSetup((c) =>
        createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: libraryB, periodLabel: "Should fail — mismatched library" }),
      ),
    ).rejects.toThrow(/violates foreign key constraint|assessments_engagement_control_library_version_fk/i);
  });

  it("an Assessment CAN be created when its ControlLibraryVersion matches its Engagement's pinned one", async () => {
    const library = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Correctly Matched Library" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, library));
    const engagement = await asFixtureSetup((c) => createEngagement(c, tenant, org, "Matched Engagement"));
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, engagement, library));

    const assessmentId = await asFixtureSetup((c) =>
      createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Correctly matched" }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT control_library_version_id FROM assessments WHERE id = $1", [assessmentId]));
    expect(rows[0]!.control_library_version_id).toBe(library);
  });
});

describe("Control/ControlLibraryVersion consistency for AssessmentControl (CRITICAL)", () => {
  let tenant: string, org: string, engagement: string;
  let libraryV1: string, controlV1: string;
  let libraryV2: string, controlV2: string;
  let assessmentOnV1: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "AC consistency tenant");
      org = await createOrganisation(client, tenant, "AC Consistency Client");
      engagement = await createEngagement(client, tenant, org, "AC Consistency Engagement");

      libraryV1 = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "AC Consistency Library v1.0" });
      controlV1 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV1, code: "C1", title: "Library v1.0 control" });
      await publishControlLibraryVersion(client, libraryV1);

      libraryV2 = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "AC Consistency Library v2.0" });
      controlV2 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV2, code: "C100", title: "Library v2.0 control" });
      await publishControlLibraryVersion(client, libraryV2);

      await pinEngagementControlLibraryVersion(client, engagement, libraryV1);
      assessmentOnV1 = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: libraryV1, periodLabel: "Assessment on Library v1.0" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Assessment A (on Library v1.0) CANNOT attach Control C-100 from Library v2.0 — the exact scenario from the milestone brief", async () => {
    await expect(
      asFixtureSetup((c) =>
        addAssessmentControl(c, {
          assessmentId: assessmentOnV1,
          controlId: controlV2,
          tenantId: tenant,
          organisationId: org,
          engagementId: engagement,
          controlLibraryVersionId: libraryV1, // the row claims v1.0...
        }),
      ),
      // ...but controlV2 does NOT belong to libraryV1, so the
      // assessment_controls_control_library_version_fk composite FK must
      // reject this regardless of what the row's own column claims.
    ).rejects.toThrow(/violates foreign key constraint|control_library_version_fk/i);
  });

  it("attempting to lie about control_library_version_id (claiming v2.0 while the assessment itself is on v1.0) is also rejected", async () => {
    await expect(
      asFixtureSetup((c) =>
        addAssessmentControl(c, {
          assessmentId: assessmentOnV1,
          controlId: controlV2,
          tenantId: tenant,
          organisationId: org,
          engagementId: engagement,
          controlLibraryVersionId: libraryV2, // now internally consistent with controlV2...
        }),
      ),
      // ...but the assessment_scope_fk requires this row's
      // control_library_version_id to match assessmentOnV1's own (v1.0),
      // which v2.0 does not.
    ).rejects.toThrow(/violates foreign key constraint|assessment_scope_fk/i);
  });

  it("Assessment A CAN attach Control C1, which genuinely belongs to Library v1.0", async () => {
    const acId = await asFixtureSetup((c) =>
      addAssessmentControl(c, {
        assessmentId: assessmentOnV1,
        controlId: controlV1,
        tenantId: tenant,
        organisationId: org,
        engagementId: engagement,
        controlLibraryVersionId: libraryV1,
      }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT control_id FROM assessment_controls WHERE id = $1", [acId]));
    expect(rows[0]!.control_id).toBe(controlV1);
  });
});
