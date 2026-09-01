// Milestone 6 instructions §16's 10 required RLS scenarios: (1) Tenant A
// own evidence, (2) Tenant A blocked from Tenant B, (3) Organisation A
// blocked from Organisation B, (4) Engagement A blocked from Engagement
// B, (5)-(6) unauthorized read/write blocking, (7) unauthorized cross-
// tenant EvidenceLink creation blocking, (8) anonymous users blocked, (9)
// RLS cannot be bypassed by querying DocumentVersion directly, (10)
// private storage objects unreachable through an unauthorized path (see
// PROGRESS.md for the explicit scope note on what this covers, given no
// real storage integration exists — D-03 unresolved).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asFixtureSetup,
  asUser,
  createDocument,
  createEngagement,
  createEvidence,
  createOrganisation,
  createTenant,
  createUser,
  grantEngagementMembership,
  grantOrganisationMembership,
  linkEvidenceToAssessmentResponse,
  pool,
  uploadDocumentVersion,
} from "./helpers";
import {
  addAssessmentControl,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  pinEngagementControlLibraryVersion,
  publishControlLibraryVersion,
} from "../assessment-engine/helpers";

describe("Evidence & Document tenant/organisation/engagement isolation and write protection", () => {
  let tenantA: string, tenantB: string;
  let orgA1: string, orgA2: string, orgB: string;
  let engagementA1: string, engagementA2: string, engagementB: string;
  let documentA1: string, versionA1: string, evidenceA1: string;
  let documentB: string, versionB: string;

  let orgWideUserA1: string; // OrganisationMembership on orgA1 only
  let userB: string;
  let outsiderUser: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — evidence isolation");
      tenantB = await createTenant(client, "Tenant B — evidence isolation");
      orgA1 = await createOrganisation(client, tenantA, "ABC Financial Services");
      orgA2 = await createOrganisation(client, tenantA, "Another Client Under Tenant A");
      orgB = await createOrganisation(client, tenantB, "Unrelated Client Co");

      engagementA1 = await createEngagement(client, tenantA, orgA1, "Tenant A Engagement 1");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Tenant A Engagement 2");
      engagementB = await createEngagement(client, tenantB, orgB, "Tenant B Engagement");

      orgWideUserA1 = await createUser(client, { tenantId: tenantA, clientOrgId: orgA1 });
      await grantOrganisationMembership(client, orgWideUserA1, orgA1);

      documentA1 = await createDocument(client, { tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, title: "Tenant A Engagement 1 document" });
      const va1 = await uploadDocumentVersion(client, { documentId: documentA1, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, content: "Tenant A content.", uploadedBy: orgWideUserA1 });
      versionA1 = va1.id;
      evidenceA1 = await createEvidence(client, { tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, documentVersionId: versionA1, title: "Tenant A Evidence" });

      documentB = await createDocument(client, { tenantId: tenantB, organisationId: orgB, engagementId: engagementB, title: "Tenant B document" });
      userB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      const vb = await uploadDocumentVersion(client, { documentId: documentB, tenantId: tenantB, organisationId: orgB, engagementId: engagementB, content: "Tenant B content.", uploadedBy: userB });
      versionB = vb.id;
      await grantOrganisationMembership(client, userB, orgB);

      outsiderUser = await createUser(client, { tenantId: tenantA });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // (1) Tenant A can access its own evidence.
  it("a Tenant A user can read their own tenant's Evidence and DocumentVersion", async () => {
    const evidenceRows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM evidence WHERE id = $1", [evidenceA1]));
    expect(evidenceRows.rows).toHaveLength(1);
    const versionRows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM document_versions WHERE id = $1", [versionA1]));
    expect(versionRows.rows).toHaveLength(1);
  });

  // (2) Tenant A cannot access Tenant B evidence.
  it("Tenant A cannot read Tenant B's Document or DocumentVersion, and their own Evidence listing never includes Tenant B rows", async () => {
    const documentRows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM documents WHERE id = $1", [documentB]));
    expect(documentRows.rows).toHaveLength(0);
    const versionRows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM document_versions WHERE id = $1", [versionB]));
    expect(versionRows.rows).toHaveLength(0);
    const evidenceListing = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM evidence"));
    expect(evidenceListing.rows.every((r) => r.id === evidenceA1)).toBe(true);
  });

  // (3) Organisation A cannot access Organisation B evidence (both under Tenant A).
  it("Organisation A1's member cannot access Organisation A2's Documents, even under the same tenant", async () => {
    const documentA2 = await asFixtureSetup((c) => createDocument(c, { tenantId: tenantA, organisationId: orgA2, engagementId: engagementA2, title: "Org A2 document" }));
    const rows = await asUser(orgWideUserA1, (c) => c.query("SELECT id FROM documents WHERE id = $1", [documentA2]));
    expect(rows.rows).toHaveLength(0);
  });

  // (4) Engagement A cannot access Engagement B evidence.
  it("an engagement-scoped Tenant A user can access exactly the Documents their EngagementMembership permits — no more", async () => {
    const engagementScopedUser = await asFixtureSetup((c) => createUser(c, { tenantId: tenantA, clientOrgId: orgA1 }));
    await asFixtureSetup((c) => grantEngagementMembership(c, engagementScopedUser, engagementA1));

    const own = await asUser(engagementScopedUser, (c) => c.query("SELECT id FROM documents WHERE id = $1", [documentA1]));
    expect(own.rows).toHaveLength(1);

    const documentA2 = await asFixtureSetup((c) => createDocument(c, { tenantId: tenantA, organisationId: orgA2, engagementId: engagementA2, title: "Org A2 document for engagement isolation" }));
    const other = await asUser(engagementScopedUser, (c) => c.query("SELECT id FROM documents WHERE id = $1", [documentA2]));
    expect(other.rows).toHaveLength(0);
  });

  // (5)/(6) Unauthorized read/write blocking.
  it("an unaffiliated user cannot read any Tenant A Evidence", async () => {
    const rows = await asUser(outsiderUser, (c) => c.query("SELECT id FROM evidence WHERE id = $1", [evidenceA1]));
    expect(rows.rows).toHaveLength(0);
  });

  it("Tenant B cannot UPDATE Tenant A's Evidence (0 rows affected — not visible to them at all)", async () => {
    const result = await asUser(userB, (c) => c.query("UPDATE evidence SET title = 'tampered' WHERE id = $1", [evidenceA1]));
    expect(result.rowCount).toBe(0);
    const check = await asUser(orgWideUserA1, (c) => c.query("SELECT title FROM evidence WHERE id = $1", [evidenceA1]));
    expect(check.rows[0]!.title).toBe("Tenant A Evidence");
  });

  it("Tenant B cannot INSERT a Document into Tenant A's organisation", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(`INSERT INTO documents (tenant_id, organisation_id, engagement_id, title, document_type) VALUES ($1, $2, $3, 'Forged', 'policy')`, [tenantA, orgA1, engagementA1]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  // (7) Unauthorized cross-tenant EvidenceLink creation blocking.
  it("Tenant B cannot create an EvidenceLink connecting Tenant A's Evidence to anything, even a legitimate Tenant A subject", async () => {
    const library = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenantA, versionLabel: "Isolation test library" }));
    const control = await asFixtureSetup((c) => createControl(c, { tenantId: tenantA, controlLibraryVersionId: library, code: "ISO1", title: "Isolation test control" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, library));
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, engagementA1, library));
    const assessment = await asFixtureSetup((c) => createAssessment(c, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, controlLibraryVersionId: library, periodLabel: "Isolation test" }));
    const ac = await asFixtureSetup((c) => addAssessmentControl(c, { assessmentId: assessment, controlId: control, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, controlLibraryVersionId: library }));
    const response = await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: ac, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, effectivenessRating: "implemented" }));

    await expect(
      asUser(userB, (c) => linkEvidenceToAssessmentResponse(c, { evidenceId: evidenceA1, assessmentResponseId: response, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1 })),
    ).rejects.toThrow(/row-level security/i);
  });

  // (8) Anonymous users cannot access evidence.
  it("an anonymous request is denied at the grant level for Evidence, Document, and DocumentVersion", async () => {
    await expect(asAnon((c) => c.query("SELECT id FROM evidence WHERE id = $1", [evidenceA1]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM documents WHERE id = $1", [documentA1]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query("SELECT id FROM document_versions WHERE id = $1", [versionA1]))).rejects.toThrow(/permission denied/i);
  });

  // (9) A user cannot bypass RLS by querying the underlying DocumentVersion.
  it("Tenant B cannot bypass Evidence's own access control by querying document_versions directly", async () => {
    const rows = await asUser(userB, (c) => c.query("SELECT id, storage_path, checksum_sha256 FROM document_versions WHERE id = $1", [versionA1]));
    expect(rows.rows).toHaveLength(0);
    const listing = await asUser(userB, (c) => c.query("SELECT id FROM document_versions"));
    expect(listing.rows.map((r) => r.id)).not.toContain(versionA1);
  });

  it("an authorized user CAN write (INSERT/UPDATE) their own Evidence — proving the blocks above are real access control, not a broken pipe", async () => {
    const insertResult = await asUser(orgWideUserA1, (c) =>
      c.query(
        `INSERT INTO evidence (tenant_id, organisation_id, engagement_id, document_version_id, title, evidence_type) VALUES ($1, $2, $3, $4, 'New Evidence', 'other') RETURNING id`,
        [tenantA, orgA1, engagementA1, versionA1],
      ),
    );
    expect(insertResult.rows).toHaveLength(1);

    const updateResult = await asUser(orgWideUserA1, (c) =>
      c.query("UPDATE evidence SET title = 'Updated Title' WHERE id = $1 RETURNING title", [evidenceA1]),
    );
    expect(updateResult.rows[0]!.title).toBe("Updated Title");
  });
});
