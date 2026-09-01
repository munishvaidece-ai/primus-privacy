// Fixture builders for Evidence & Document Management (Milestone 6).
// Re-exports the connection/role-switching harness and Milestone 1/4/5
// fixture builders unchanged (reuse what earlier milestones already
// built) and adds Milestone-6-specific builders in the same style.
//
// No real files are ever written or uploaded (Milestone 6 instructions
// §18): "file content" here is always a short synthetic in-memory string
// hashed with Node's own `crypto` module — the same SHA-256 algorithm
// `checksum_sha256` is meant to record — never touching any storage
// service, real or otherwise (D-03 is unresolved; see PROGRESS.md).
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export {
  pool,
  asUser,
  asAnon,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantTenantMembership,
  grantOrganisationMembership,
  grantEngagementMembership,
} from "../rls/helpers";

export {
  createControlLibraryVersion,
  publishControlLibraryVersion,
  createControl,
} from "../control-library/helpers";

export { pinEngagementControlLibraryVersion, createAssessment, finalizeAssessment, addAssessmentControl, createAssessmentResponse, createControlTest } from "../assessment-engine/helpers";

/** Deterministically hashes synthetic "file content" the same way a real
 * upload pipeline would hash real bytes — never a real file. */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function createDocument(
  client: PoolClient,
  opts: {
    tenantId: string;
    organisationId: string;
    engagementId?: string;
    title: string;
    documentType?: "policy" | "contract" | "screenshot" | "certificate" | "report" | "system_configuration" | "other";
    ownerUserId?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO documents (tenant_id, organisation_id, engagement_id, title, document_type, owner_user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      opts.tenantId,
      opts.organisationId,
      opts.engagementId ?? null,
      opts.title,
      opts.documentType ?? "policy",
      opts.ownerUserId ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function uploadDocumentVersion(
  client: PoolClient,
  opts: {
    documentId: string;
    tenantId: string;
    organisationId: string;
    engagementId?: string;
    content: string;
    originalFilename?: string;
    mimeType?: string;
    uploadedBy: string;
  },
) {
  const checksum = sha256(opts.content);
  const { rows } = await client.query<{ id: string; version_number: number }>(
    `INSERT INTO document_versions
       (document_id, tenant_id, organisation_id, engagement_id, storage_path, original_filename, mime_type, file_size_bytes, checksum_sha256, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, version_number`,
    [
      opts.documentId,
      opts.tenantId,
      opts.organisationId,
      opts.engagementId ?? null,
      `tenants/${opts.tenantId}/documents/${opts.documentId}/${sha256(opts.content).slice(0, 16)}`,
      opts.originalFilename ?? "synthetic-test-file.txt",
      opts.mimeType ?? "text/plain",
      Buffer.byteLength(opts.content, "utf8"),
      checksum,
      opts.uploadedBy,
    ],
  );
  return { id: rows[0]!.id, versionNumber: rows[0]!.version_number, checksum };
}

export async function createEvidence(
  client: PoolClient,
  opts: {
    tenantId: string;
    organisationId: string;
    engagementId?: string;
    documentVersionId: string;
    title: string;
    evidenceType?: "policy_document" | "screenshot" | "system_configuration_export" | "signed_agreement" | "certificate" | "other";
    visibility?: "client_visible" | "consultant_internal";
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO evidence (tenant_id, organisation_id, engagement_id, document_version_id, title, evidence_type, visibility)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      opts.tenantId,
      opts.organisationId,
      opts.engagementId ?? null,
      opts.documentVersionId,
      opts.title,
      opts.evidenceType ?? "policy_document",
      opts.visibility ?? "consultant_internal",
    ],
  );
  return rows[0]!.id;
}

export async function reviewEvidence(
  client: PoolClient,
  opts: {
    evidenceId: string;
    reviewStatus: "accepted" | "rejected" | "expired";
    reviewedBy?: string;
    reviewRationale?: string;
  },
) {
  await client.query(
    `UPDATE evidence SET review_status = $1, reviewed_by = $2, reviewed_at = now(), review_rationale = $3 WHERE id = $4`,
    [opts.reviewStatus, opts.reviewedBy ?? null, opts.reviewRationale ?? null, opts.evidenceId],
  );
}

export async function linkEvidenceToAssessmentResponse(
  client: PoolClient,
  opts: {
    evidenceId: string;
    assessmentResponseId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, assessment_response_id)
     VALUES ($1, $2, $3, $4, 'assessment_response', $5) RETURNING id`,
    [opts.evidenceId, opts.tenantId, opts.organisationId, opts.engagementId, opts.assessmentResponseId],
  );
  return rows[0]!.id;
}

/** `organisationId`/`engagementId` are optional only so a test can
 * deliberately omit them and prove the database rejects the attempt —
 * Evidence is always organisation-scoped, so it can never legitimately
 * attach to a fully standalone (no organisation) ControlTest; a real
 * caller always supplies both when linking to an engagement-scoped one. */
export async function linkEvidenceToControlTest(
  client: PoolClient,
  opts: {
    evidenceId: string;
    controlTestId: string;
    tenantId: string;
    organisationId?: string;
    engagementId?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, control_test_id)
     VALUES ($1, $2, $3, $4, 'control_test', $5) RETURNING id`,
    [opts.evidenceId, opts.tenantId, opts.organisationId ?? null, opts.engagementId ?? null, opts.controlTestId],
  );
  return rows[0]!.id;
}
