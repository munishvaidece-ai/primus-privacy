// Milestone 6 instructions §8: "Changing the current Document metadata
// must not silently rewrite the historical evidence relationship."
// Extends Milestone 5's finalized-assessment immutability one hop
// further: once the Assessment behind an EvidenceLink's subject is
// finalized, the link itself cannot be created or removed. A standalone
// ControlTest (no assessment_id) is never locked this way.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createControlTest,
  createDocument,
  createEngagement,
  createEvidence,
  createOrganisation,
  createTenant,
  createUser,
  finalizeAssessment,
  linkEvidenceToAssessmentResponse,
  linkEvidenceToControlTest,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
  uploadDocumentVersion,
} from "./helpers";

describe("EvidenceLink finalization lock", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let library: string, control: string, assessment: string, ac: string, response: string, controlTest: string;
  let evidenceId: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "EvidenceLink finalization tenant");
      org = await createOrganisation(client, tenant, "EvidenceLink finalization client");
      engagement = await createEngagement(client, tenant, org, "EvidenceLink finalization engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "EvidenceLink Finalization Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "FIN1", title: "Finalization test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "EvidenceLink finalization assessment" });
      ac = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      response = await createAssessmentResponse(client, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      controlTest = await createControlTest(client, { controlId: control, tenantId: tenant, assessmentId: assessment, organisationId: org, engagementId: engagement });

      const document = await createDocument(client, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Finalization test document" });
      const version = await uploadDocumentVersion(client, { documentId: document, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Finalization test content.", uploadedBy: user });
      evidenceId = await createEvidence(client, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: version.id, title: "Finalization test evidence" });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below (the shared `pool` singleton would error if
  // ended twice).

  it("an EvidenceLink to an AssessmentResponse CAN be created while the Assessment is still draft", async () => {
    const linkId = await asFixtureSetup((c) => linkEvidenceToAssessmentResponse(c, { evidenceId, assessmentResponseId: response, tenantId: tenant, organisationId: org, engagementId: engagement }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM evidence_links WHERE id = $1", [linkId]));
    expect(rows).toHaveLength(1);
    // Clean up so later tests in this file start from a clean slate.
    await asFixtureSetup((c) => c.query("DELETE FROM evidence_links WHERE id = $1", [linkId]));
  });

  it("an EvidenceLink to an AssessmentResponse CANNOT be created once the Assessment is finalized", async () => {
    await asFixtureSetup((c) => finalizeAssessment(c, assessment));
    await expect(
      asFixtureSetup((c) => linkEvidenceToAssessmentResponse(c, { evidenceId, assessmentResponseId: response, tenantId: tenant, organisationId: org, engagementId: engagement })),
    ).rejects.toThrow(/finalized assessment/i);
  });

  it("an existing EvidenceLink to a ControlTest cannot be removed once the ControlTest's Assessment is finalized", async () => {
    // (assessment already finalized by the previous test in this file)
    await expect(
      asFixtureSetup((c) => linkEvidenceToControlTest(c, { evidenceId, controlTestId: controlTest, tenantId: tenant, organisationId: org, engagementId: engagement })),
    ).rejects.toThrow(/finalized assessment/i);
  });
});

describe("EvidenceLink to a ControlTest with no assessment_id is never locked by finalization", () => {
  let tenant: string, org: string, user: string;
  let library: string, control: string;
  let standaloneTest: string;
  let evidenceId: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Standalone EvidenceLink tenant");
      org = await createOrganisation(client, tenant, "Standalone EvidenceLink client");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Standalone EvidenceLink Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "STANDALONE1", title: "Standalone control" });
      await publishControlLibraryVersion(client, library);

      // Evidence is always organisation-scoped (consistency.test.ts's
      // "Evidence cannot be linked to a fully standalone ControlTest"
      // finding), so a ControlTest Evidence can attach to must carry a
      // real organisation_id/engagement_id — but it can still have NO
      // assessment_id (Milestone 5's "continuous monitoring" concept:
      // DATA_MODEL.md §6 nullable `assessment_id`). The finalization-lock
      // trigger (migration 0011 §5) branches on `assessment_id`
      // specifically, not on organisation/engagement presence, so this is
      // the correct state to exercise "never locked."
      const engagement = await createEngagement(client, tenant, org, "Standalone EvidenceLink engagement");
      standaloneTest = await createControlTest(client, { controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement });

      const document = await createDocument(client, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Standalone EvidenceLink document" });
      const version = await uploadDocumentVersion(client, { documentId: document, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Standalone content.", uploadedBy: user });
      evidenceId = await createEvidence(client, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: version.id, title: "Standalone evidence" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("an EvidenceLink to a ControlTest with no assessment_id can always be created and removed, regardless of any other assessment's finalization state", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT engagement_id FROM control_tests WHERE id = $1", [standaloneTest]));
    const engagementId = rows[0]!.engagement_id as string;
    const { rows: docRows } = await asFixtureSetup((c) => c.query("SELECT organisation_id FROM evidence WHERE id = $1", [evidenceId]));
    const organisationId = docRows[0]!.organisation_id as string;

    const linkId = await asFixtureSetup((c) => linkEvidenceToControlTest(c, { evidenceId, controlTestId: standaloneTest, tenantId: tenant, organisationId, engagementId }));
    await asFixtureSetup((c) => c.query("DELETE FROM evidence_links WHERE id = $1", [linkId]));
    const { rows: after } = await asFixtureSetup((c) => c.query("SELECT id FROM evidence_links WHERE id = $1", [linkId]));
    expect(after).toHaveLength(0);
  });
});
