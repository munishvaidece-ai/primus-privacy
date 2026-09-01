// Fixture builders for Risk, Findings & Remediation (Milestone 7).
// Re-exports the connection/role-switching harness and Milestone
// 1/4/5/6 fixture builders unchanged (reuse what earlier milestones
// already built) and adds Milestone-7-specific builders in the same
// style.
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

export {
  pinEngagementControlLibraryVersion,
  createAssessment,
  finalizeAssessment,
  addAssessmentControl,
  createAssessmentResponse,
  createControlTest,
} from "../assessment-engine/helpers";

export { createDocument, uploadDocumentVersion, createEvidence, sha256 } from "../evidence/helpers";

export async function createRiskScoringModel(
  client: PoolClient,
  opts: { tenantId: string; name: string; version: string; matrixDefinition?: object; isActive?: boolean },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO risk_scoring_models (tenant_id, name, version, matrix_definition, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      opts.tenantId,
      opts.name,
      opts.version,
      JSON.stringify(opts.matrixDefinition ?? { scale: "1-5", grid: "likelihood x impact" }),
      opts.isActive ?? true,
    ],
  );
  return rows[0]!.id;
}

export async function createRisk(
  client: PoolClient,
  opts: {
    engagementId: string;
    organisationId: string;
    tenantId: string;
    riskScoringModelId: string;
    title: string;
    likelihood: number;
    impact: number;
    inherentRating: "low" | "medium" | "high" | "critical";
    residualLikelihood?: number;
    residualImpact?: number;
    residualRating?: "low" | "medium" | "high" | "critical";
    assessmentResponseId?: string;
    previousRiskId?: string;
    ownerId?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO risks
       (engagement_id, organisation_id, tenant_id, risk_scoring_model_id, title, likelihood, impact, inherent_rating,
        residual_likelihood, residual_impact, residual_rating, assessment_response_id, previous_risk_id, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      opts.engagementId,
      opts.organisationId,
      opts.tenantId,
      opts.riskScoringModelId,
      opts.title,
      opts.likelihood,
      opts.impact,
      opts.inherentRating,
      opts.residualLikelihood ?? null,
      opts.residualImpact ?? null,
      opts.residualRating ?? null,
      opts.assessmentResponseId ?? null,
      opts.previousRiskId ?? null,
      opts.ownerId ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function linkRiskControl(
  client: PoolClient,
  opts: { riskId: string; controlId: string; tenantId: string; organisationId: string; engagementId: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO risk_controls (risk_id, control_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.riskId, opts.controlId, opts.tenantId, opts.organisationId, opts.engagementId],
  );
  return rows[0]!.id;
}

export async function linkRiskProcessingActivity(
  client: PoolClient,
  opts: {
    riskId: string;
    processingActivityId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO risk_processing_activities (risk_id, processing_activity_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.riskId, opts.processingActivityId, opts.tenantId, opts.organisationId, opts.engagementId],
  );
  return rows[0]!.id;
}

export async function createFinding(
  client: PoolClient,
  opts: {
    engagementId: string;
    organisationId: string;
    tenantId: string;
    title: string;
    description?: string;
    severity?: "low" | "medium" | "high" | "critical";
    ownerId?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO findings (engagement_id, organisation_id, tenant_id, title, description, severity, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      opts.engagementId,
      opts.organisationId,
      opts.tenantId,
      opts.title,
      opts.description ?? null,
      opts.severity ?? "high",
      opts.ownerId ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function linkFindingRisk(
  client: PoolClient,
  opts: { findingId: string; riskId: string; tenantId: string; organisationId: string; engagementId: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO finding_risks (finding_id, risk_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.findingId, opts.riskId, opts.tenantId, opts.organisationId, opts.engagementId],
  );
  return rows[0]!.id;
}

export async function linkFindingControl(
  client: PoolClient,
  opts: { findingId: string; controlId: string; tenantId: string; organisationId: string; engagementId: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO finding_controls (finding_id, control_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.findingId, opts.controlId, opts.tenantId, opts.organisationId, opts.engagementId],
  );
  return rows[0]!.id;
}

export async function linkFindingProcessingActivity(
  client: PoolClient,
  opts: {
    findingId: string;
    processingActivityId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO finding_processing_activities (finding_id, processing_activity_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.findingId, opts.processingActivityId, opts.tenantId, opts.organisationId, opts.engagementId],
  );
  return rows[0]!.id;
}

export async function createRemediationAction(
  client: PoolClient,
  opts: {
    engagementId: string;
    organisationId: string;
    tenantId: string;
    title: string;
    description?: string;
    ownerId?: string;
    dueDate?: string;
    priority?: "low" | "medium" | "high" | "critical";
    status?: "open" | "in_progress" | "evidence_submitted" | "validated" | "closed";
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO remediation_actions (engagement_id, organisation_id, tenant_id, title, description, owner_id, due_date, priority, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      opts.engagementId,
      opts.organisationId,
      opts.tenantId,
      opts.title,
      opts.description ?? null,
      opts.ownerId ?? null,
      opts.dueDate ?? null,
      opts.priority ?? null,
      opts.status ?? "open",
    ],
  );
  return rows[0]!.id;
}

export async function linkRemediationFinding(
  client: PoolClient,
  opts: {
    remediationActionId: string;
    findingId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO remediation_findings (remediation_action_id, finding_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.remediationActionId, opts.findingId, opts.tenantId, opts.organisationId, opts.engagementId],
  );
  return rows[0]!.id;
}

export async function linkRemediationRisk(
  client: PoolClient,
  opts: {
    remediationActionId: string;
    riskId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO remediation_risks (remediation_action_id, risk_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.remediationActionId, opts.riskId, opts.tenantId, opts.organisationId, opts.engagementId],
  );
  return rows[0]!.id;
}

export async function linkRemediationControl(
  client: PoolClient,
  opts: {
    remediationActionId: string;
    controlId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO remediation_controls (remediation_action_id, control_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.remediationActionId, opts.controlId, opts.tenantId, opts.organisationId, opts.engagementId],
  );
  return rows[0]!.id;
}

export async function createValidationRecord(
  client: PoolClient,
  opts: {
    remediationActionId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
    validatedBy?: string;
    outcome: "accepted" | "rejected";
    rationale?: string;
    triggersControlTestId?: string;
    triggersAssessmentResponseId?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO validation_records
       (remediation_action_id, tenant_id, organisation_id, engagement_id, validated_by, outcome, rationale, triggers_control_test_id, triggers_assessment_response_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      opts.remediationActionId,
      opts.tenantId,
      opts.organisationId,
      opts.engagementId,
      opts.validatedBy ?? null,
      opts.outcome,
      opts.rationale ?? null,
      opts.triggersControlTestId ?? null,
      opts.triggersAssessmentResponseId ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function linkEvidenceToRemediationAction(
  client: PoolClient,
  opts: {
    evidenceId: string;
    remediationActionId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, remediation_action_id)
     VALUES ($1, $2, $3, $4, 'remediation_action', $5) RETURNING id`,
    [opts.evidenceId, opts.tenantId, opts.organisationId, opts.engagementId, opts.remediationActionId],
  );
  return rows[0]!.id;
}

export async function linkEvidenceToValidationRecord(
  client: PoolClient,
  opts: {
    evidenceId: string;
    validationRecordId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, validation_record_id)
     VALUES ($1, $2, $3, $4, 'validation_record', $5) RETURNING id`,
    [opts.evidenceId, opts.tenantId, opts.organisationId, opts.engagementId, opts.validationRecordId],
  );
  return rows[0]!.id;
}

export async function createProcessingActivity(
  client: PoolClient,
  opts: { engagementId: string; organisationId: string; tenantId: string; name: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processing_activities (engagement_id, organisation_id, tenant_id, name) VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.engagementId, opts.organisationId, opts.tenantId, opts.name],
  );
  return rows[0]!.id;
}
