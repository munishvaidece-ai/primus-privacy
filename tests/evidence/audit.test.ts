// Milestone 6 instructions §17: document creation, document version
// creation, evidence creation, evidence review, acceptance/rejection,
// expiry/status changes, EvidenceLink creation/removal, and relevant
// metadata changes must all be auditable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
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
  linkEvidenceToControlTest,
  pool,
  publishControlLibraryVersion,
  reviewEvidence,
  uploadDocumentVersion,
} from "./helpers";

describe("Evidence & Document Management auditability", () => {
  let tenant: string, org: string, engagement: string, user: string, control: string, controlTest: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Evidence audit test tenant");
      org = await createOrganisation(client, tenant, "Evidence audit test org");
      engagement = await createEngagement(client, tenant, org, "Evidence audit test engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);

      const library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Evidence Audit Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "AUD1", title: "Evidence audit control" });
      await publishControlLibraryVersion(client, library);
      controlTest = await createControlTest(client, { controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function latestAuditEntries(entityType: string, entityId: string) {
    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT action, entity_type, entity_id, actor_user_id, field_changes
         FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY occurred_at`,
        [entityType, entityId],
      ),
    );
    return rows.rows;
  }

  it("Document creation is audited", async () => {
    const id = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Audit Trail Document" }));
    const entries = await latestAuditEntries("documents", id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.title).toBe("Audit Trail Document");
  });

  it("DocumentVersion creation is audited", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Version Audit Document" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Version audit content.", uploadedBy: user }));
    const entries = await latestAuditEntries("document_versions", versionId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.version_number).toBe(1);
  });

  it("Evidence creation, review, and acceptance/rejection are all audited", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Evidence Audit Document" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Evidence audit content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: versionId, title: "Audited Evidence" }));
    await asFixtureSetup((c) => reviewEvidence(c, { evidenceId, reviewStatus: "accepted", reviewedBy: user, reviewRationale: "Looks correct." }));
    await asFixtureSetup((c) => reviewEvidence(c, { evidenceId, reviewStatus: "expired" }));

    const entries = await latestAuditEntries("evidence", evidenceId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update", "update"]);
    expect(entries[1]!.field_changes.new.review_status).toBe("accepted");
    expect(entries[1]!.field_changes.new.review_rationale).toBe("Looks correct.");
    expect(entries[2]!.field_changes.new.review_status).toBe("expired");
  });

  it("EvidenceLink creation and removal are audited as insert and delete events", async () => {
    const documentId = await asFixtureSetup((c) => createDocument(c, { tenantId: tenant, organisationId: org, engagementId: engagement, title: "Link Audit Document" }));
    const { id: versionId } = await asFixtureSetup((c) => uploadDocumentVersion(c, { documentId, tenantId: tenant, organisationId: org, engagementId: engagement, content: "Link audit content.", uploadedBy: user }));
    const evidenceId = await asFixtureSetup((c) => createEvidence(c, { tenantId: tenant, organisationId: org, engagementId: engagement, documentVersionId: versionId, title: "Link audit evidence" }));
    const linkId = await asFixtureSetup((c) => linkEvidenceToControlTest(c, { evidenceId, controlTestId: controlTest, tenantId: tenant, organisationId: org, engagementId: engagement }));
    await asFixtureSetup((c) => c.query("DELETE FROM evidence_links WHERE id = $1", [linkId]));

    const entries = await latestAuditEntries("evidence_links", linkId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "delete"]);
    expect(entries[0]!.field_changes.control_test_id).toBe(controlTest);
    expect(entries[1]!.field_changes.control_test_id).toBe(controlTest); // DELETE logs the OLD row
  });

  it("every audit entry is correctly attributed to the acting user via auth.uid()", async () => {
    const committedId = await (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO documents (tenant_id, organisation_id, engagement_id, title, document_type) VALUES ($1, $2, $3, 'Attribution Check', 'other') RETURNING id`,
          [tenant, org, engagement],
        );
        await client.query("COMMIT");
        return rows[0]!.id;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    })();

    const entries = await latestAuditEntries("documents", committedId);
    expect(entries[0]!.actor_user_id).toBe(user);
  });
});
