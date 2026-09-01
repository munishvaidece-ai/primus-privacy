// Milestone 6 instructions §7/§15 — polymorphic security and database-
// enforced tenant/organisation consistency: "Evidence belongs to
// Organisation A. Its linked DocumentVersion must belong to Organisation
// A." "An EvidenceLink cannot connect Tenant A Evidence to Tenant B
// AssessmentResponse/ControlTest/other subject." Proven by composite FKs,
// not application validation.
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
  linkEvidenceToAssessmentResponse,
  linkEvidenceToControlTest,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
  uploadDocumentVersion,
} from "./helpers";

describe("Evidence -> DocumentVersion organisation consistency", () => {
  let tenant: string, orgA: string, orgB: string, engagementA: string, user: string;
  let libraryA: string, controlA: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Evidence-DocVersion consistency tenant");
      orgA = await createOrganisation(client, tenant, "Org A");
      orgB = await createOrganisation(client, tenant, "Org B");
      engagementA = await createEngagement(client, tenant, orgA, "Org A engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: orgA });

      libraryA = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Consistency Library" });
      controlA = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryA, code: "CONS1", title: "Consistency control" });
      await publishControlLibraryVersion(client, libraryA);
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below (the shared `pool` singleton would error if
  // ended twice).

  it("Evidence cannot reference a DocumentVersion belonging to a different Organisation — the exact milestone example", async () => {
    const orgBDocument = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: orgB, title: "Org B's Document" }));
    const orgBVersion = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId: orgBDocument, tenantId: tenant, organisationId: orgB, content: "Org B content.", uploadedBy: user }));

    await expect(
      asFixtureSetup((c) =>
        createEvidence(c, { tenantId: tenant, organisationId: orgA, documentVersionId: orgBVersion.id, title: "Attempted cross-org evidence" }),
      ),
    ).rejects.toThrow(/violates foreign key constraint|document_version_organisation_fk/i);
  });

  it("Evidence CAN reference a DocumentVersion belonging to the same Organisation", async () => {
    const orgADocument = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: orgA, title: "Org A's Document" }));
    const orgAVersion = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId: orgADocument, tenantId: tenant, organisationId: orgA, content: "Org A content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: orgA, documentVersionId: orgAVersion.id, title: "Correctly matched evidence" }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT document_version_id FROM evidence WHERE id = $1", [evidenceId]));
    expect(rows[0]!.document_version_id).toBe(orgAVersion.id);
  });

  it("Evidence cannot reference a DocumentVersion belonging to a different Engagement", async () => {
    const engagementB = await asFixtureSetup((c) => createEngagement(c, tenant, orgA, "A different Org A engagement"));
    const document = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: orgA, engagementId: engagementA, title: "Engagement A's Document" }));
    const version = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId: document, tenantId: tenant, organisationId: orgA, engagementId: engagementA, content: "Engagement A content.", uploadedBy: user }));

    await expect(
      asFixtureSetup((c) =>
        createEvidence(c, { tenantId: tenant, organisationId: orgA, engagementId: engagementB, documentVersionId: version.id, title: "Attempted cross-engagement evidence" }),
      ),
    ).rejects.toThrow(/violates foreign key constraint|document_version_engagement_fk/i);
  });
});

describe("EvidenceLink polymorphic subject security (CRITICAL)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgB: string;
  let engagementA: string, engagementB: string;
  let libraryA: string, controlA: string, libraryB: string, controlB: string;
  let assessmentA: string, acA: string, responseA: string;
  let assessmentB: string, acB: string, responseB: string;
  let controlTestA: string, controlTestB: string;
  let evidenceA: string;
  let user: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "EvidenceLink security tenant A");
      tenantB = await createTenant(client, "EvidenceLink security tenant B");
      orgA = await createOrganisation(client, tenantA, "EvidenceLink security org A");
      orgB = await createOrganisation(client, tenantB, "EvidenceLink security org B");
      engagementA = await createEngagement(client, tenantA, orgA, "EvidenceLink security engagement A");
      engagementB = await createEngagement(client, tenantB, orgB, "EvidenceLink security engagement B");
      user = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Security Library A" });
      controlA = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "SEC-A", title: "Security control A" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);

      libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Security Library B" });
      controlB = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "SEC-B", title: "Security control B" });
      await publishControlLibraryVersion(client, libraryB);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      assessmentA = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "Security A" });
      acA = await addAssessmentControl(client, { assessmentId: assessmentA, controlId: controlA, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      responseA = await createAssessmentResponse(client, { assessmentControlId: acA, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, effectivenessRating: "implemented" });
      controlTestA = await createControlTest(client, { controlId: controlA, tenantId: tenantA, assessmentId: assessmentA, organisationId: orgA, engagementId: engagementA });

      assessmentB = await createAssessment(client, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, controlLibraryVersionId: libraryB, periodLabel: "Security B" });
      acB = await addAssessmentControl(client, { assessmentId: assessmentB, controlId: controlB, tenantId: tenantB, organisationId: orgB, engagementId: engagementB, controlLibraryVersionId: libraryB });
      responseB = await createAssessmentResponse(client, { assessmentControlId: acB, tenantId: tenantB, organisationId: orgB, engagementId: engagementB, effectivenessRating: "implemented" });
      controlTestB = await createControlTest(client, { controlId: controlB, tenantId: tenantB, assessmentId: assessmentB, organisationId: orgB, engagementId: engagementB });

      const document = await createDocument(client, { tenantId: tenantA, organisationId: orgA, engagementId: engagementA, title: "Tenant A's Document" });
      const version = await uploadDocumentVersion(client, { documentId: document, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, content: "Tenant A content.", uploadedBy: user });
      evidenceA = await createEvidence(client, { tenantId: tenantA, organisationId: orgA, engagementId: engagementA, documentVersionId: version.id, title: "Tenant A's evidence" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Tenant A Evidence CANNOT be linked to Tenant B's AssessmentResponse", async () => {
    await expect(
      asFixtureSetup((c) =>
        linkEvidenceToAssessmentResponse(c, { evidenceId: evidenceA, assessmentResponseId: responseB, tenantId: tenantA, organisationId: orgA, engagementId: engagementA }),
      ),
    ).rejects.toThrow(/violates foreign key constraint|assessment_response_scope_fk/i);
  });

  it("Tenant A Evidence CANNOT be linked to Tenant B's ControlTest", async () => {
    await expect(
      asFixtureSetup((c) =>
        linkEvidenceToControlTest(c, { evidenceId: evidenceA, controlTestId: controlTestB, tenantId: tenantA, organisationId: orgA, engagementId: engagementA }),
      ),
    ).rejects.toThrow(/violates foreign key constraint|control_test_tenant_fk/i);
  });

  it("attempting to disguise a cross-tenant link by also forging the link's own tenant_id/organisation_id/engagement_id to Tenant B's values is still rejected — the evidence side no longer matches", async () => {
    await expect(
      asFixtureSetup((c) =>
        linkEvidenceToAssessmentResponse(c, { evidenceId: evidenceA, assessmentResponseId: responseB, tenantId: tenantB, organisationId: orgB, engagementId: engagementB }),
      ),
    ).rejects.toThrow(/violates foreign key constraint|evidence_scope_fk/i);
  });

  it("Evidence CAN be correctly linked to its own Tenant's AssessmentResponse and ControlTest", async () => {
    const link1 = await asFixtureSetup((c) => linkEvidenceToAssessmentResponse(c, { evidenceId: evidenceA, assessmentResponseId: responseA, tenantId: tenantA, organisationId: orgA, engagementId: engagementA }));
    const link2 = await asFixtureSetup((c) => linkEvidenceToControlTest(c, { evidenceId: evidenceA, controlTestId: controlTestA, tenantId: tenantA, organisationId: orgA, engagementId: engagementA }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT subject_type FROM evidence_links WHERE id = ANY($1) ORDER BY subject_type", [[link1, link2]]));
    expect(rows.map((r) => r.subject_type)).toEqual(["assessment_response", "control_test"]);
  });

  it("an EvidenceLink cannot be created with a subject_type that doesn't match which subject column is populated", async () => {
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, assessment_response_id, control_test_id)
           VALUES ($1, $2, $3, $4, 'control_test', $5, NULL)`,
          [evidenceA, tenantA, orgA, engagementA, responseA],
        ),
      ),
    ).rejects.toThrow(/violates check constraint|subject_matches_type/i);
  });

  it("Evidence cannot be linked to a fully standalone ControlTest (no organisation at all) — Evidence is always organisation-scoped", async () => {
    const standaloneTest = await asFixtureSetup((c) => createControlTest(c, { controlId: controlA, tenantId: tenantA }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT organisation_id, engagement_id FROM control_tests WHERE id = $1", [standaloneTest]));
    expect(rows[0]).toMatchObject({ organisation_id: null, engagement_id: null });

    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, control_test_id)
           VALUES ($1, $2, $3, $4, 'control_test', $5)`,
          [evidenceA, tenantA, orgA, engagementA, standaloneTest],
        ),
      ),
    ).rejects.toThrow(/violates foreign key constraint|control_test_organisation_fk/i);
  });
});
