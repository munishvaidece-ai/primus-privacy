// Fixture for the workspace tests: a practice team (Engagement Manager,
// Consultant, Auditor), the AI agent, a client team for one organisation
// (Client Administrator, Business Owner, CXO) and a second, unrelated client.
import {
  asFixtureSetup,
  createOrganisation,
  createEngagement,
  createUser,
  grantEngagementMembership,
  grantOrganisationMembership,
  pool,
} from "../app/helpers";
import { createDocument, uploadDocumentVersion, createEvidence } from "../evidence/helpers";
import { createFinding } from "../risk-remediation/helpers";
import { buildAiFixture, type AiFixture } from "../ai/helpers";

export { pool, asFixtureSetup };

export interface WsFixture extends AiFixture {
  auditorId: string;
  clientAdminId: string;
  businessOwnerId: string;
  cxoId: string;
  otherOrgId: string;
  otherEngagementId: string;
  otherClientId: string;
}

export async function buildWorkspaceFixture(label: string): Promise<WsFixture> {
  const base = await buildAiFixture(label);
  const f = base as WsFixture;
  await asFixtureSetup(async (client) => {
    f.auditorId = await createUser(client, { tenantId: f.tenantId });
    await grantEngagementMembership(client, f.auditorId, f.engagementId, "Auditor");
    f.clientAdminId = await createUser(client, { tenantId: f.tenantId, clientOrgId: f.organisationId });
    await grantOrganisationMembership(client, f.clientAdminId, f.organisationId, "Client Administrator");
    f.cxoId = await createUser(client, { tenantId: f.tenantId, clientOrgId: f.organisationId });
    await grantOrganisationMembership(client, f.cxoId, f.organisationId, "CXO / Executive Viewer");
    f.businessOwnerId = await createUser(client, { tenantId: f.tenantId, clientOrgId: f.organisationId });
    await grantEngagementMembership(client, f.businessOwnerId, f.engagementId, "Business Owner");
    f.otherOrgId = await createOrganisation(client, f.tenantId, `${label} Other Org`);
    f.otherEngagementId = await createEngagement(client, f.tenantId, f.otherOrgId, `${label} Other Engagement`);
    f.otherClientId = await createUser(client, { tenantId: f.tenantId, clientOrgId: f.otherOrgId });
    await grantOrganisationMembership(client, f.otherClientId, f.otherOrgId, "Client Administrator");
  });
  return f;
}

/** Inserts a finding directly (fixture setup, no row security). */
export async function insertFinding(f: WsFixture, opts: { title: string; severity?: "low" | "medium" | "high" | "critical"; released?: boolean; engagementId?: string; organisationId?: string }) {
  let id = "";
  await asFixtureSetup(async (client) => {
    id = await createFinding(client, {
      engagementId: opts.engagementId ?? f.engagementId,
      organisationId: opts.organisationId ?? f.organisationId,
      tenantId: f.tenantId,
      title: opts.title,
      severity: opts.severity ?? "high",
      released: opts.released ?? false,
    });
  });
  return id;
}

/** A stored document + evidence item for the engagement (fixture setup). */
export async function insertEvidence(f: WsFixture, opts: { title: string; uploadedBy: string; engagementId?: string; organisationId?: string; visibility?: "client_visible" | "consultant_internal" }) {
  let id = "";
  await asFixtureSetup(async (client) => {
    const engagementId = opts.engagementId ?? f.engagementId;
    const organisationId = opts.organisationId ?? f.organisationId;
    const documentId = await createDocument(client, { tenantId: f.tenantId, organisationId, engagementId, title: opts.title });
    const dv = await uploadDocumentVersion(client, { documentId, tenantId: f.tenantId, organisationId, engagementId, content: `content of ${opts.title}`, uploadedBy: opts.uploadedBy });
    id = await createEvidence(client, { tenantId: f.tenantId, organisationId, engagementId, documentVersionId: dv.id, title: opts.title, visibility: opts.visibility ?? "client_visible" });
  });
  return id;
}
