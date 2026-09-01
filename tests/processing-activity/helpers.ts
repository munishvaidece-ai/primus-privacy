// Fixture builders for the Processing Activity (Milestone 3) test suite.
// Re-exports the connection/role-switching harness and master-data
// fixture builders unchanged (Milestone 3 instructions §8: reuse what
// earlier milestones already built) and adds Processing-Activity-specific
// builders in the same style.
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
  createSystem,
  insertSystemVersion,
  createProcessor,
  insertProcessorVersion,
  createDataStore,
  insertDataStoreVersion,
  createBusinessUnit,
  createDataPrincipalCategory,
  createPurpose,
  createPersonalDataElement,
} from "../master-data/helpers";

export async function createProcessingActivity(
  client: PoolClient,
  opts: {
    engagementId: string;
    organisationId: string;
    tenantId: string;
    name: string;
    carriedForwardFromId?: string;
    businessUnitId?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processing_activities
       (engagement_id, organisation_id, tenant_id, name, carried_forward_from_id, business_unit_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      opts.engagementId,
      opts.organisationId,
      opts.tenantId,
      opts.name,
      opts.carriedForwardFromId ?? null,
      opts.businessUnitId ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function linkSystem(
  client: PoolClient,
  opts: {
    processingActivityId: string;
    engagementId: string;
    organisationId: string;
    systemId: string;
    systemVersionId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processing_activity_systems
       (processing_activity_id, engagement_id, organisation_id, system_id, system_version_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.processingActivityId, opts.engagementId, opts.organisationId, opts.systemId, opts.systemVersionId],
  );
  return rows[0]!.id;
}

export async function linkDataStore(
  client: PoolClient,
  opts: {
    processingActivityId: string;
    engagementId: string;
    organisationId: string;
    dataStoreId: string;
    dataStoreVersionId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processing_activity_data_stores
       (processing_activity_id, engagement_id, organisation_id, data_store_id, data_store_version_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.processingActivityId, opts.engagementId, opts.organisationId, opts.dataStoreId, opts.dataStoreVersionId],
  );
  return rows[0]!.id;
}

export async function linkProcessor(
  client: PoolClient,
  opts: {
    processingActivityId: string;
    engagementId: string;
    organisationId: string;
    processorId: string;
    processorVersionId: string;
    role?: "processor" | "joint_controller";
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processing_activity_processors
       (processing_activity_id, engagement_id, organisation_id, processor_id, processor_version_id, role)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      opts.processingActivityId,
      opts.engagementId,
      opts.organisationId,
      opts.processorId,
      opts.processorVersionId,
      opts.role ?? "processor",
    ],
  );
  return rows[0]!.id;
}

export async function linkPurpose(
  client: PoolClient,
  opts: {
    processingActivityId: string;
    engagementId: string;
    organisationId: string;
    purposeId: string;
    purposeVersionId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processing_activity_purposes
       (processing_activity_id, engagement_id, organisation_id, purpose_id, purpose_version_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.processingActivityId, opts.engagementId, opts.organisationId, opts.purposeId, opts.purposeVersionId],
  );
  return rows[0]!.id;
}

export async function linkPersonalDataElement(
  client: PoolClient,
  opts: {
    processingActivityId: string;
    engagementId: string;
    organisationId: string;
    personalDataElementId: string;
    personalDataElementVersionId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processing_activity_personal_data_elements
       (processing_activity_id, engagement_id, organisation_id, personal_data_element_id, personal_data_element_version_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      opts.processingActivityId,
      opts.engagementId,
      opts.organisationId,
      opts.personalDataElementId,
      opts.personalDataElementVersionId,
    ],
  );
  return rows[0]!.id;
}

export async function linkDataPrincipalCategory(
  client: PoolClient,
  opts: {
    processingActivityId: string;
    engagementId: string;
    organisationId: string;
    dataPrincipalCategoryId: string;
    dataPrincipalCategoryVersionId: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processing_activity_data_principal_categories
       (processing_activity_id, engagement_id, organisation_id, data_principal_category_id, data_principal_category_version_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      opts.processingActivityId,
      opts.engagementId,
      opts.organisationId,
      opts.dataPrincipalCategoryId,
      opts.dataPrincipalCategoryVersionId,
    ],
  );
  return rows[0]!.id;
}
