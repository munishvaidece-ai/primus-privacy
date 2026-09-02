// Fixture builders for the Client Master Data (Milestone 2) test suite.
// Re-exports the connection/role-switching harness from tests/rls/helpers
// unchanged (Milestone 2 instructions §14: reuse what Milestone 1 already
// built, don't create a second harness) and adds master-data-specific
// fixture builders in the same style.
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

export async function createSystem(client: PoolClient, organisationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO systems (organisation_id) VALUES ($1) RETURNING id`,
    [organisationId],
  );
  return rows[0]!.id;
}

export async function insertSystemVersion(
  client: PoolClient,
  opts: { systemId: string; organisationId: string; name: string; owner?: string; hostingEnvironment?: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO system_versions (system_id, organisation_id, name, owner, hosting_environment)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.systemId, opts.organisationId, opts.name, opts.owner ?? null, opts.hostingEnvironment ?? null],
  );
  return rows[0]!.id;
}

export async function createProcessor(client: PoolClient, organisationId: string, parentProcessorId?: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processors (organisation_id, parent_processor_id) VALUES ($1, $2) RETURNING id`,
    [organisationId, parentProcessorId ?? null],
  );
  return rows[0]!.id;
}

export async function insertProcessorVersion(
  client: PoolClient,
  opts: { processorId: string; organisationId: string; name: string; dpaVersionLabel?: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO processor_versions (processor_id, organisation_id, name, dpa_version_label)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.processorId, opts.organisationId, opts.name, opts.dpaVersionLabel ?? null],
  );
  return rows[0]!.id;
}

export async function createDataStore(client: PoolClient, organisationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO data_stores (organisation_id) VALUES ($1) RETURNING id`,
    [organisationId],
  );
  return rows[0]!.id;
}

export async function insertDataStoreVersion(
  client: PoolClient,
  opts: { dataStoreId: string; organisationId: string; name: string; systemVersionId?: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO data_store_versions (data_store_id, organisation_id, name, system_version_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.dataStoreId, opts.organisationId, opts.name, opts.systemVersionId ?? null],
  );
  return rows[0]!.id;
}

export async function createBusinessUnit(client: PoolClient, organisationId: string, name: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO business_units (organisation_id, name) VALUES ($1, $2) RETURNING id`,
    [organisationId, name],
  );
  return rows[0]!.id;
}

export async function createDataPrincipalCategory(client: PoolClient, organisationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO data_principal_categories (organisation_id) VALUES ($1) RETURNING id`,
    [organisationId],
  );
  return rows[0]!.id;
}

export async function createPurpose(client: PoolClient, organisationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO purposes (organisation_id) VALUES ($1) RETURNING id`,
    [organisationId],
  );
  return rows[0]!.id;
}

export async function createPersonalDataElement(client: PoolClient, organisationId: string) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO personal_data_elements (organisation_id) VALUES ($1) RETURNING id`,
    [organisationId],
  );
  return rows[0]!.id;
}

// The three `*Version` insert helpers below were not needed by the
// Milestone 2 test suite itself (it exercises the identity-row/SCD2
// mechanism generically, without needing named content for every
// entity) but are needed by any fixture that wants a real, readable
// Purpose/PersonalDataElement/DataPrincipalCategory name — added here,
// alongside the master-data suite's own helpers, in the exact same
// shape `insertSystemVersion`/`insertProcessorVersion`/
// `insertDataStoreVersion` above already use, rather than as a new
// fixture abstraction elsewhere.

export async function insertPurposeVersion(
  client: PoolClient,
  opts: { purposeId: string; organisationId: string; name: string; description?: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO purpose_versions (purpose_id, organisation_id, name, description)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.purposeId, opts.organisationId, opts.name, opts.description ?? null],
  );
  return rows[0]!.id;
}

export async function insertPersonalDataElementVersion(
  client: PoolClient,
  opts: {
    personalDataElementId: string;
    organisationId: string;
    name: string;
    sensitivityCategory?: "general" | "sensitive" | "critical";
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO personal_data_element_versions (personal_data_element_id, organisation_id, name, sensitivity_category)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.personalDataElementId, opts.organisationId, opts.name, opts.sensitivityCategory ?? "general"],
  );
  return rows[0]!.id;
}

export async function insertDataPrincipalCategoryVersion(
  client: PoolClient,
  opts: {
    dataPrincipalCategoryId: string;
    organisationId: string;
    name: string;
    isChildrenFlag?: boolean;
    description?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO data_principal_category_versions (data_principal_category_id, organisation_id, name, is_children_flag, description)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.dataPrincipalCategoryId, opts.organisationId, opts.name, opts.isChildrenFlag ?? false, opts.description ?? null],
  );
  return rows[0]!.id;
}
