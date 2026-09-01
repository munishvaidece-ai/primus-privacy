// Milestone 6 instructions §4/§14: a DocumentVersion must be immutable
// after creation — ordinary application/database paths cannot replace
// its storage object, change its hash, change its version number, or
// change the historical uploaded-by information. The one narrow,
// documented exception is `scan_status`, which may transition exactly
// once away from 'pending'. Also covers Document/Evidence reparenting
// guards (§15's "database-enforced tenant consistency wherever possible").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createDocument,
  createEngagement,
  createEvidence,
  createOrganisation,
  createTenant,
  createUser,
  grantOrganisationMembership,
  pool,
  uploadDocumentVersion,
} from "./helpers";

describe("DocumentVersion immutability", () => {
  let tenant: string, org: string, engagement: string, user: string, documentId: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Immutability test tenant");
      org = await createOrganisation(client, tenant, "Immutability test client");
      engagement = await createEngagement(client, tenant, org, "Immutability test engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
      documentId = await createDocument(client, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Immutability Test Policy" });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below (the shared `pool` singleton would error if
  // ended twice).

  it("cannot replace the storage object (storage_path) of an existing version", async () => {
    const { id } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Original content.", uploadedBy: user }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE document_versions SET storage_path = 'tampered/path' WHERE id = $1`, [id])),
    ).rejects.toThrow(/document version is immutable/i);
  });

  it("cannot change the recorded hash", async () => {
    const { id } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Hash immutability content.", uploadedBy: user }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE document_versions SET checksum_sha256 = 'deadbeef' WHERE id = $1`, [id])),
    ).rejects.toThrow(/document version is immutable/i);
  });

  it("cannot change the version number", async () => {
    const { id } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Version number immutability content.", uploadedBy: user }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE document_versions SET version_number = 999 WHERE id = $1`, [id])),
    ).rejects.toThrow(/document version is immutable/i);
  });

  it("cannot change the historical uploaded-by information (uploaded_by or uploaded_at)", async () => {
    const otherUser = await asFixtureSetup((c) => createUser(c, { tenantId: tenant, clientOrgId: org }));
    const { id } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Uploaded-by immutability content.", uploadedBy: user }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE document_versions SET uploaded_by = $1 WHERE id = $2`, [otherUser, id])),
    ).rejects.toThrow(/document version is immutable/i);
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE document_versions SET uploaded_at = now() WHERE id = $1`, [id])),
    ).rejects.toThrow(/document version is immutable/i);
  });

  it("cannot change original_filename or mime_type", async () => {
    const { id } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Filename immutability content.", uploadedBy: user }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE document_versions SET original_filename = 'tampered.txt' WHERE id = $1`, [id])),
    ).rejects.toThrow(/document version is immutable/i);
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE document_versions SET mime_type = 'application/x-tampered' WHERE id = $1`, [id])),
    ).rejects.toThrow(/document version is immutable/i);
  });

  it("scan_status CAN transition once, from pending to a terminal value", async () => {
    const { id } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Scan status content.", uploadedBy: user }));
    const before = await asFixtureSetup((c) => c.query("SELECT scan_status FROM document_versions WHERE id = $1", [id]));
    expect(before.rows[0]!.scan_status).toBe("pending");

    await asFixtureSetup((c) => c.query(`UPDATE document_versions SET scan_status = 'clean' WHERE id = $1`, [id]));
    const after = await asFixtureSetup((c) => c.query("SELECT scan_status FROM document_versions WHERE id = $1", [id]));
    expect(after.rows[0]!.scan_status).toBe("clean");
  });

  it("scan_status cannot transition a second time once it has left pending", async () => {
    const { id } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Scan status re-transition content.", uploadedBy: user }));
    await asFixtureSetup((c) => c.query(`UPDATE document_versions SET scan_status = 'flagged' WHERE id = $1`, [id]));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE document_versions SET scan_status = 'clean' WHERE id = $1`, [id])),
    ).rejects.toThrow(/scan_status can only transition once/i);
  });

  it("cannot DELETE a document version — no DELETE grant exists at all for `authenticated`", async () => {
    const { id } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "No-delete content.", uploadedBy: user }));
    await expect(asUser(user, (c) => c.query("DELETE FROM document_versions WHERE id = $1", [id]))).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe("Document and Evidence reparenting guards (afterAll ends the shared pool for this file)", () => {
  let tenant: string, tenantB: string, org: string, orgB: string, engagement: string, user: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Reparenting test tenant A");
      tenantB = await createTenant(client, "Reparenting test tenant B");
      org = await createOrganisation(client, tenant, "Reparenting test client A");
      orgB = await createOrganisation(client, tenantB, "Reparenting test client B");
      engagement = await createEngagement(client, tenant, org, "Reparenting test engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a Document's tenant_id/organisation_id/engagement_id cannot be changed after creation", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Reparent test document" }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE documents SET organisation_id = $1 WHERE id = $2`, [orgB, documentId])),
    ).rejects.toThrow(/documents\.\{tenant_id,organisation_id,engagement_id\} are immutable/i);
  });

  it("a Document's title/status remain freely editable (reparenting guard doesn't block ordinary edits)", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Editable title" }));
    await asFixtureSetup((c) => c.query(`UPDATE documents SET title = 'Renamed title', status = 'archived' WHERE id = $1`, [documentId]));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT title, status FROM documents WHERE id = $1", [documentId]));
    expect(rows[0]).toMatchObject({ title: "Renamed title", status: "archived" });
  });

  it("an Evidence's document_version_id cannot be changed after creation — the pinned version is permanent", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Evidence reparent test document" }));
    const v1 = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Version 1.", uploadedBy: user }));
    const v2 = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Version 2.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: v1.id, title: "Evidence reparent test" }));

    await expect(
      asFixtureSetup((c) => c.query(`UPDATE evidence SET document_version_id = $1 WHERE id = $2`, [v2.id, evidenceId])),
    ).rejects.toThrow(/evidence\.\{tenant_id,organisation_id,engagement_id,document_version_id\} are immutable/i);
  });

  it("Evidence's review fields and title remain freely editable (reparenting guard doesn't block ordinary review edits)", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Evidence review edit test document" }));
    const v1 = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Version content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: v1.id, title: "Evidence review edit test" }));
    await asFixtureSetup((c) => c.query(`UPDATE evidence SET review_status = 'accepted', title = 'Updated title' WHERE id = $1`, [evidenceId]));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT review_status, title FROM evidence WHERE id = $1", [evidenceId]));
    expect(rows[0]).toMatchObject({ review_status: "accepted", title: "Updated title" });
  });
});
