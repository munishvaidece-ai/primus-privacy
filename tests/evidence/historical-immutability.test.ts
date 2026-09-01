// Milestone 6's exact required scenario (instructions §8): Assessment A1
// — FY2026, Control C1, response "Partially Implemented", Evidence
// "Information Security Policy — Version 1", reviewer Consultant A.
// Later, FY2027: the client uploads "Information Security Policy —
// Version 2". The system must preserve FY2026 → Version 1 while allowing
// FY2027 → Version 2. Uploading Version 2 must never overwrite Version 1.
// Changing the current Document's metadata must not silently rewrite the
// historical evidence relationship.
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
  createOrganisation,
  createTenant,
  createUser,
  finalizeAssessment,
  grantOrganisationMembership,
  linkEvidenceToAssessmentResponse,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
  reviewEvidence,
  sha256,
  uploadDocumentVersion,
} from "./helpers";

describe("Historical evidence-version immutability (FY2026 v1 vs FY2027 v2 scenario)", () => {
  let tenant: string, org: string;
  let library: string, controlC1: string;
  let engagementFY2026: string, assessmentA1: string, acC1: string, responseC1: string;
  let policyDocument: string, versionFY2026: string, versionFY2027: string;
  let evidenceFY2026: string;
  let consultantA: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Historical Evidence Immutability Tenant");
      org = await createOrganisation(client, tenant, "ABC Financial Services");
      consultantA = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, consultantA, org);

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Historical Evidence Library v1.0" });
      controlC1 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Information security policy control" });
      await publishControlLibraryVersion(client, library);

      // --- Assessment A1 — FY2026 ---
      engagementFY2026 = await createEngagement(client, tenant, org, "ABC Financial — FY2026");
      await pinEngagementControlLibraryVersion(client, engagementFY2026, library);
      assessmentA1 = await createAssessment(client, { engagementId: engagementFY2026, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      acC1 = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlC1, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, controlLibraryVersionId: library });
      responseC1 = await createAssessmentResponse(client, { assessmentControlId: acC1, tenantId: tenant, organisationId: org, engagementId: engagementFY2026, effectivenessRating: "partially_implemented" });

      // --- Evidence: Information Security Policy — Version 1 ---
      policyDocument = await createDocument(client, { tenantId: tenant, organisationId: org, engagementId: engagementFY2026, title: "Information Security Policy" });
      const v1 = await uploadDocumentVersion(client, {
        documentId: policyDocument,
        tenantId: tenant,
        organisationId: org,
        engagementId: engagementFY2026,
        content: "Information Security Policy — synthetic FY2026 content (Version 1).",
        uploadedBy: consultantA,
      });
      versionFY2026 = v1.id;
      evidenceFY2026 = await createEvidence(client, { tenantId: tenant, organisationId: org, engagementId: engagementFY2026, documentVersionId: versionFY2026, title: "Information Security Policy — Version 1" });
      await reviewEvidence(client, { evidenceId: evidenceFY2026, reviewStatus: "accepted", reviewedBy: consultantA, reviewRationale: "Reviewed against C1 for FY2026." });
      await linkEvidenceToAssessmentResponse(client, { evidenceId: evidenceFY2026, assessmentResponseId: responseC1, tenantId: tenant, organisationId: org, engagementId: engagementFY2026 });
      await finalizeAssessment(client, assessmentA1);

      // --- Later, FY2027: the client uploads Version 2 of the SAME
      // logical Document (not a new Document — the same policy, updated) ---
      const v2 = await uploadDocumentVersion(client, {
        documentId: policyDocument,
        tenantId: tenant,
        organisationId: org,
        engagementId: engagementFY2026, // the Document's own scope is unchanged; only a new version is added
        content: "Information Security Policy — synthetic FY2027 content (Version 2).",
        uploadedBy: consultantA,
      });
      versionFY2027 = v2.id;

      // Changing the Document's own current metadata (e.g. re-titling)
      // must not rewrite history either.
      await client.query(`UPDATE documents SET title = 'Information Security Policy (FY2027 revision)' WHERE id = $1`, [policyDocument]);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Version 1 and Version 2 are two distinct, immutable rows — uploading Version 2 never overwrote Version 1", async () => {
    expect(versionFY2026).not.toBe(versionFY2027);
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT id, version_number, checksum_sha256 FROM document_versions WHERE document_id = $1 ORDER BY version_number", [policyDocument]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: versionFY2026, version_number: 1 });
    expect(rows[1]).toMatchObject({ id: versionFY2027, version_number: 2 });
    expect(rows[0]!.checksum_sha256).not.toBe(rows[1]!.checksum_sha256);
  });

  it("Version 1's content is exactly what it was when FY2026's Evidence was collected — unchanged by Version 2's existence", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT checksum_sha256 FROM document_versions WHERE id = $1", [versionFY2026]));
    expect(rows[0]!.checksum_sha256).toBe(sha256("Information Security Policy — synthetic FY2026 content (Version 1)."));
  });

  it("FY2026's Evidence still resolves to Version 1, not Version 2", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT document_version_id FROM evidence WHERE id = $1", [evidenceFY2026]));
    expect(rows[0]!.document_version_id).toBe(versionFY2026);
    expect(rows[0]!.document_version_id).not.toBe(versionFY2027);
  });

  it("changing the Document's current metadata (title) does not rewrite the historical Evidence relationship or the pinned version's own content", async () => {
    const { rows: docRows } = await asFixtureSetup((c) => c.query("SELECT title FROM documents WHERE id = $1", [policyDocument]));
    expect(docRows[0]!.title).toBe("Information Security Policy (FY2027 revision)");

    // Evidence's own title (set at collection time, FY2026) is untouched —
    // it is a separate field on a separate row, never derived live from
    // the Document's current title.
    const { rows: evidenceRows } = await asFixtureSetup((c) => c.query("SELECT title, document_version_id FROM evidence WHERE id = $1", [evidenceFY2026]));
    expect(evidenceRows[0]!.title).toBe("Information Security Policy — Version 1");
    expect(evidenceRows[0]!.document_version_id).toBe(versionFY2026);
  });

  it("resolves Assessment A1's full FY2026 evidence trail in one join, unaffected by Version 2's existence", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT dv.version_number, dv.checksum_sha256, e.title AS evidence_title, e.review_status
         FROM assessment_responses ar
         JOIN evidence_links el ON el.assessment_response_id = ar.id
         JOIN evidence e ON e.id = el.evidence_id
         JOIN document_versions dv ON dv.id = e.document_version_id
         WHERE ar.id = $1`,
        [responseC1],
      ),
    );
    expect(rows).toEqual([
      {
        version_number: 1,
        checksum_sha256: sha256("Information Security Policy — synthetic FY2026 content (Version 1)."),
        evidence_title: "Information Security Policy — Version 1",
        review_status: "accepted",
      },
    ]);
  });

  it("the EvidenceLink to the finalized FY2026 Assessment cannot be removed or replaced", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM evidence_links WHERE evidence_id = $1 AND assessment_response_id = $2", [evidenceFY2026, responseC1]));
    const linkId = rows[0]!.id;
    await expect(
      asFixtureSetup((c) => c.query("DELETE FROM evidence_links WHERE id = $1", [linkId])),
    ).rejects.toThrow(/finalized assessment/i);
  });
});
