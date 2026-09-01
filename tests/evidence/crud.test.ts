// Milestone 6: Document/DocumentVersion/Evidence/EvidenceLink CRUD,
// version auto-numbering, file-integrity (hash) verification, and
// duplicate-upload detection. Mutations run via asFixtureSetup
// (committed, matching the project convention); asUser reads back under
// real RLS.
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
  createDocument,
  createEngagement,
  createEvidence,
  createOrganisation,
  createTenant,
  createUser,
  grantOrganisationMembership,
  linkEvidenceToAssessmentResponse,
  linkEvidenceToControlTest,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
  reviewEvidence,
  sha256,
  uploadDocumentVersion,
} from "./helpers";

describe("Evidence & Document Management CRUD", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let library: string, control: string, assessment: string, assessmentControlId: string, response: string;
  let controlTest: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Evidence CRUD tenant");
      org = await createOrganisation(client, tenant, "Evidence CRUD client");
      engagement = await createEngagement(client, tenant, org, "Evidence CRUD engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Evidence CRUD Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "EC1", title: "Evidence CRUD control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "Evidence CRUD assessment" });
      assessmentControlId = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      response = await createAssessmentResponse(client, { assessmentControlId, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "partially_implemented" });
      controlTest = await createControlTest(client, { controlId: control, tenantId: tenant, assessmentId: assessment, organisationId: org, engagementId: engagement, result: "pass" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a Document (logical identity), engagement-scoped", async () => {
    const id = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Information Security Policy" }));
    const { rows } = await asUser(user, (c) => c.query("SELECT title, status, document_type FROM documents WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ title: "Information Security Policy", status: "active", document_type: "policy" });
  });

  it("creates a Document with no engagement (organisation-level)", async () => {
    const id = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, title: "Vendor DPA (ongoing, no engagement)" }));
    const { rows } = await asUser(user, (c) => c.query("SELECT engagement_id FROM documents WHERE id = $1", [id]));
    expect(rows[0]!.engagement_id).toBeNull();
  });

  it("uploads DocumentVersion 1, auto-assigning version_number = 1", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Access Control Policy" }));
    const { id, versionNumber, checksum } = await asFixtureSetup((c) =>
      uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Synthetic access control policy v1 content.", uploadedBy: user }),
    );
    expect(versionNumber).toBe(1);
    const { rows } = await asUser(user, (c) => c.query("SELECT checksum_sha256, version_number FROM document_versions WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ checksum_sha256: checksum, version_number: 1 });
  });

  it("uploading a second version auto-assigns version_number = 2, and never overwrites version 1", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Multi-version Policy" }));
    const v1 = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Version 1 content.", uploadedBy: user }));
    const v2 = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Version 2 content.", uploadedBy: user }));

    expect(v1.versionNumber).toBe(1);
    expect(v2.versionNumber).toBe(2);
    expect(v1.id).not.toBe(v2.id);

    const rows = await asUser(user, (c) => c.query("SELECT id, version_number, checksum_sha256 FROM document_versions WHERE document_id = $1 ORDER BY version_number", [documentId]));
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ id: v1.id, version_number: 1, checksum_sha256: v1.checksum });
    expect(rows.rows[1]).toMatchObject({ id: v2.id, version_number: 2, checksum_sha256: v2.checksum });
  });

  it("the recorded hash corresponds exactly to the synthetic uploaded content", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Hash Verification Policy" }));
    const content = "Synthetic file content used only for hash verification.";
    const { id, checksum } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content, uploadedBy: user }));

    expect(checksum).toBe(sha256(content));
    const { rows } = await asUser(user, (c) => c.query("SELECT checksum_sha256, file_size_bytes FROM document_versions WHERE id = $1", [id]));
    expect(rows[0]!.checksum_sha256).toBe(sha256(content));
    expect(Number(rows[0]!.file_size_bytes)).toBe(Buffer.byteLength(content, "utf8"));
  });

  it("duplicate-upload detection: a query can find an earlier version with the same hash before creating a new one", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Duplicate Detection Policy" }));
    const content = "Identical content, uploaded twice.";
    const v1 = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content, uploadedBy: user }));

    // The application-level duplicate check: look for an existing version
    // with the same hash under this document before uploading again.
    const existing = await asFixtureSetup((c) =>
      c.query("SELECT id, version_number FROM document_versions WHERE document_id = $1 AND checksum_sha256 = $2", [documentId, sha256(content)]),
    );
    expect(existing.rows).toHaveLength(1);
    expect(existing.rows[0]!.id).toBe(v1.id);

    // Re-uploading identical content is still permitted (a legitimate
    // "reconfirm current state" action) — it creates a genuinely new,
    // separately immutable version row rather than being blocked outright.
    const v2 = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content, uploadedBy: user }));
    expect(v2.versionNumber).toBe(2);
    expect(v2.checksum).toBe(v1.checksum);
    expect(v2.id).not.toBe(v1.id);
  });

  it("creates Evidence pinned to a specific DocumentVersion", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Evidence Pin Test Policy" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Evidence pin test content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: versionId, title: "Evidence for pin test" }));

    const { rows } = await asUser(user, (c) => c.query("SELECT document_version_id, review_status, visibility FROM evidence WHERE id = $1", [evidenceId]));
    expect(rows[0]).toMatchObject({ document_version_id: versionId, review_status: "pending_review", visibility: "consultant_internal" });
  });

  it("records the evidence review lifecycle: who reviewed it, when, what decision, and rationale", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Review Lifecycle Policy" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Review lifecycle content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: versionId, title: "Evidence for review lifecycle" }));
    await asFixtureSetup((c) => reviewEvidence(c, { evidenceId, reviewStatus: "accepted", reviewedBy: user, reviewRationale: "Matches the policy on file, reviewed against control C1." }));

    const { rows } = await asUser(user, (c) => c.query("SELECT review_status, reviewed_by, reviewed_at, review_rationale FROM evidence WHERE id = $1", [evidenceId]));
    expect(rows[0]!.review_status).toBe("accepted");
    expect(rows[0]!.reviewed_by).toBe(user);
    expect(rows[0]!.reviewed_at).not.toBeNull();
    expect(rows[0]!.review_rationale).toBe("Matches the policy on file, reviewed against control C1.");
  });

  it("links Evidence to an AssessmentResponse via EvidenceLink", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "AR Link Policy" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "AR link content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: versionId, title: "Evidence for AR link" }));
    const linkId = await asFixtureSetup((c) => linkEvidenceToAssessmentResponse(c, { evidenceId, assessmentResponseId: response, tenantId: tenant, organisationId: org, engagementId: engagement }));

    const { rows } = await asUser(user, (c) => c.query("SELECT subject_type, assessment_response_id, control_test_id FROM evidence_links WHERE id = $1", [linkId]));
    expect(rows[0]).toMatchObject({ subject_type: "assessment_response", assessment_response_id: response, control_test_id: null });
  });

  it("links Evidence to a ControlTest via EvidenceLink", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "CT Link Policy" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "CT link content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: versionId, title: "Evidence for CT link" }));
    const linkId = await asFixtureSetup((c) => linkEvidenceToControlTest(c, { evidenceId, controlTestId: controlTest, tenantId: tenant, organisationId: org, engagementId: engagement }));

    const { rows } = await asUser(user, (c) => c.query("SELECT subject_type, control_test_id, assessment_response_id FROM evidence_links WHERE id = $1", [linkId]));
    expect(rows[0]).toMatchObject({ subject_type: "control_test", control_test_id: controlTest, assessment_response_id: null });
  });

  it("blocks a duplicate EvidenceLink (same Evidence, same subject)", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Duplicate Link Policy" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Duplicate link content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: versionId, title: "Evidence for duplicate-link test" }));
    await asFixtureSetup((c) => linkEvidenceToAssessmentResponse(c, { evidenceId, assessmentResponseId: response, tenantId: tenant, organisationId: org, engagementId: engagement }));

    await expect(
      asFixtureSetup((c) => linkEvidenceToAssessmentResponse(c, { evidenceId, assessmentResponseId: response, tenantId: tenant, organisationId: org, engagementId: engagement })),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("removing an EvidenceLink is a DELETE, not an in-place edit", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Delete Link Policy" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Delete link content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: versionId, title: "Evidence for delete-link test" }));
    const linkId = await asFixtureSetup((c) => linkEvidenceToControlTest(c, { evidenceId, controlTestId: controlTest, tenantId: tenant, organisationId: org, engagementId: engagement }));

    await asFixtureSetup((c) => c.query("DELETE FROM evidence_links WHERE id = $1", [linkId]));
    const { rows } = await asUser(user, (c) => c.query("SELECT id FROM evidence_links WHERE id = $1", [linkId]));
    expect(rows).toHaveLength(0);
  });
});
