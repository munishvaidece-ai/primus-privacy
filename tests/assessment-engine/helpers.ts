// Fixture builders for the Assessment Engine (Milestone 5) test suite.
// Re-exports the connection/role-switching harness and Milestone 1/4
// fixture builders unchanged (reuse what earlier milestones already
// built) and adds Milestone-5-specific builders in the same style.
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
  createRegulatoryReference,
  createRequirement,
  createControlLibraryVersion,
  publishControlLibraryVersion,
  retireControlLibraryVersion,
  createControl,
  linkControlRequirement,
} from "../control-library/helpers";

export async function pinEngagementControlLibraryVersion(
  client: PoolClient,
  engagementId: string,
  controlLibraryVersionId: string,
) {
  await client.query(`UPDATE engagements SET control_library_version_id = $1 WHERE id = $2`, [
    controlLibraryVersionId,
    engagementId,
  ]);
}

export async function createAssessment(
  client: PoolClient,
  opts: {
    engagementId: string;
    organisationId: string;
    tenantId: string;
    controlLibraryVersionId: string;
    assessmentType?: "control_readiness" | "annual" | "dpia" | "sdf_screening" | "third_party";
    periodLabel: string;
    previousAssessmentId?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO assessments
       (engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label, previous_assessment_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      opts.engagementId,
      opts.organisationId,
      opts.tenantId,
      opts.controlLibraryVersionId,
      opts.assessmentType ?? "control_readiness",
      opts.periodLabel,
      opts.previousAssessmentId ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function finalizeAssessment(client: PoolClient, assessmentId: string) {
  await client.query(`UPDATE assessments SET status = 'finalized' WHERE id = $1`, [assessmentId]);
}

export async function addAssessmentControl(
  client: PoolClient,
  opts: {
    assessmentId: string;
    controlId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
    controlLibraryVersionId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO assessment_controls
       (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      opts.assessmentId,
      opts.controlId,
      opts.tenantId,
      opts.organisationId,
      opts.engagementId,
      opts.controlLibraryVersionId,
    ],
  );
  return rows[0]!.id;
}

export async function createAssessmentResponse(
  client: PoolClient,
  opts: {
    assessmentControlId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
    effectivenessRating:
      | "not_assessed"
      | "not_applicable"
      | "not_implemented"
      | "partially_implemented"
      | "implemented";
    decisionRationale?: string;
    respondentId?: string;
    submittedAt?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO assessment_responses
       (assessment_control_id, tenant_id, organisation_id, engagement_id, effectiveness_rating, decision_rationale, respondent_id, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      opts.assessmentControlId,
      opts.tenantId,
      opts.organisationId,
      opts.engagementId,
      opts.effectivenessRating,
      opts.decisionRationale ?? null,
      opts.respondentId ?? null,
      opts.submittedAt ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function createControlTest(
  client: PoolClient,
  opts: {
    controlId: string;
    tenantId: string;
    assessmentId?: string;
    organisationId?: string;
    engagementId?: string;
    methodology?: string;
    sampleDescription?: string;
    result?: "pass" | "fail" | "exception_noted";
    testerId?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO control_tests
       (control_id, tenant_id, assessment_id, organisation_id, engagement_id, methodology, sample_description, result, tester_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      opts.controlId,
      opts.tenantId,
      opts.assessmentId ?? null,
      opts.organisationId ?? null,
      opts.engagementId ?? null,
      opts.methodology ?? "Synthetic test procedure: inspect configuration and confirm control design matches policy.",
      opts.sampleDescription ?? null,
      opts.result ?? "pass",
      opts.testerId ?? null,
    ],
  );
  return rows[0]!.id;
}
