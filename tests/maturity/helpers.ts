// Fixture builders for Maturity (Milestone 8). Re-exports the
// connection/role-switching harness and Milestone 1/4/5/6/7 fixture
// builders unchanged (reuse what earlier milestones already built) and
// adds Milestone-8-specific builders in the same style.
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

export {
  createRiskScoringModel,
  createRisk,
  createFinding,
  createRemediationAction,
  createValidationRecord,
} from "../risk-remediation/helpers";

export async function createMaturityScoringMethodology(
  client: PoolClient,
  opts: { tenantId: string; name: string; version: string; definition?: object; isActive?: boolean },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO maturity_scoring_methodologies (tenant_id, name, version, definition, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      opts.tenantId,
      opts.name,
      opts.version,
      JSON.stringify(
        opts.definition ?? {
          rating_scores: {
            implemented: 5,
            partially_implemented: 3,
            not_implemented: 1,
            not_applicable: null,
            not_assessed: null,
          },
          levels: [
            { min: 1, max: 1.99, label: "Ad Hoc" },
            { min: 2, max: 2.99, label: "Developing" },
            { min: 3, max: 3.99, label: "Defined" },
            { min: 4, max: 4.99, label: "Managed" },
            { min: 5, max: 5, label: "Optimized" },
          ],
        },
      ),
      opts.isActive ?? true,
    ],
  );
  return rows[0]!.id;
}

export async function createMaturityDomain(
  client: PoolClient,
  opts: { tenantId: string; name: string; code: string; description?: string; isActive?: boolean },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO maturity_domains (tenant_id, name, code, description, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.tenantId, opts.name, opts.code, opts.description ?? null, opts.isActive ?? true],
  );
  return rows[0]!.id;
}

export async function createMaturityDomainWeight(
  client: PoolClient,
  opts: {
    engagementId: string;
    organisationId: string;
    tenantId: string;
    maturityDomainId: string;
    weight: number;
    isActive?: boolean;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO maturity_domain_weights (engagement_id, organisation_id, tenant_id, maturity_domain_id, weight, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [opts.engagementId, opts.organisationId, opts.tenantId, opts.maturityDomainId, opts.weight, opts.isActive ?? true],
  );
  return rows[0]!.id;
}

export async function linkMaturityDomainControl(
  client: PoolClient,
  opts: { maturityDomainId: string; controlId: string; tenantId: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO maturity_domain_control_mappings (maturity_domain_id, control_id, tenant_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [opts.maturityDomainId, opts.controlId, opts.tenantId],
  );
  return rows[0]!.id;
}

export async function createMaturityAssessment(
  client: PoolClient,
  opts: {
    engagementId: string;
    organisationId: string;
    tenantId: string;
    assessmentId: string;
    maturityScoringMethodologyId: string;
    computedBy?: string;
    computedFromRiskIds?: string[];
    computedFromValidationRecordIds?: string[];
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO maturity_assessments
       (engagement_id, organisation_id, tenant_id, assessment_id, maturity_scoring_methodology_id,
        computed_by, computed_from_risk_ids, computed_from_validation_record_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      opts.engagementId,
      opts.organisationId,
      opts.tenantId,
      opts.assessmentId,
      opts.maturityScoringMethodologyId,
      opts.computedBy ?? null,
      opts.computedFromRiskIds ?? null,
      opts.computedFromValidationRecordIds ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function finalizeMaturityAssessment(client: PoolClient, maturityAssessmentId: string) {
  await client.query(`UPDATE maturity_assessments SET status = 'finalized' WHERE id = $1`, [
    maturityAssessmentId,
  ]);
}

export async function createMaturityScore(
  client: PoolClient,
  opts: {
    maturityAssessmentId: string;
    tenantId: string;
    organisationId: string;
    engagementId: string;
    maturityDomainId?: string;
    maturityDomainWeightId?: string;
    score: number;
    maturityLevel?: string;
    computedFromControlTestIds?: string[];
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO maturity_scores
       (maturity_assessment_id, tenant_id, organisation_id, engagement_id, maturity_domain_id,
        maturity_domain_weight_id, score, maturity_level, computed_from_control_test_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      opts.maturityAssessmentId,
      opts.tenantId,
      opts.organisationId,
      opts.engagementId,
      opts.maturityDomainId ?? null,
      opts.maturityDomainWeightId ?? null,
      opts.score,
      opts.maturityLevel ?? null,
      opts.computedFromControlTestIds ?? null,
    ],
  );
  return rows[0]!.id;
}
