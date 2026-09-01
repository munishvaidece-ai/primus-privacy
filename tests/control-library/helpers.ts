// Fixture builders for the Regulatory Content & Control Library
// (Milestone 4) test suite. Re-exports the connection/role-switching
// harness and Milestone 1 fixture builders unchanged (reuse what earlier
// milestones already built) and adds Milestone-4-specific builders in the
// same style.
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

export async function createRegulatoryReference(
  client: PoolClient,
  opts: {
    tenantId: string;
    frameworkName?: string;
    citation: string;
    title: string;
    version?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO regulatory_references (tenant_id, framework_name, citation, title, version)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      opts.tenantId,
      opts.frameworkName ?? "DPDP Act 2023 (synthetic test fixture)",
      opts.citation,
      opts.title,
      opts.version ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function createRequirement(
  client: PoolClient,
  opts: {
    tenantId: string;
    primaryRegulatoryReferenceId: string;
    title: string;
    description?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO requirements (tenant_id, primary_regulatory_reference_id, title, description)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.tenantId, opts.primaryRegulatoryReferenceId, opts.title, opts.description ?? null],
  );
  return rows[0]!.id;
}

export async function createControlLibraryVersion(
  client: PoolClient,
  opts: { tenantId: string; versionLabel: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO control_library_versions (tenant_id, version_label) VALUES ($1, $2) RETURNING id`,
    [opts.tenantId, opts.versionLabel],
  );
  return rows[0]!.id;
}

export async function publishControlLibraryVersion(client: PoolClient, id: string) {
  await client.query(`UPDATE control_library_versions SET status = 'published' WHERE id = $1`, [id]);
}

export async function retireControlLibraryVersion(client: PoolClient, id: string) {
  await client.query(`UPDATE control_library_versions SET status = 'retired' WHERE id = $1`, [id]);
}

export async function createControl(
  client: PoolClient,
  opts: {
    tenantId: string;
    controlLibraryVersionId: string;
    code: string;
    title: string;
    controlType?: "preventive" | "detective" | "corrective";
    description?: string;
  },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO controls (tenant_id, control_library_version_id, code, title, control_type, description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      opts.tenantId,
      opts.controlLibraryVersionId,
      opts.code,
      opts.title,
      opts.controlType ?? "preventive",
      opts.description ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function linkControlRequirement(
  client: PoolClient,
  opts: { tenantId: string; controlId: string; requirementId: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO control_requirements (tenant_id, control_id, requirement_id) VALUES ($1, $2, $3) RETURNING id`,
    [opts.tenantId, opts.controlId, opts.requirementId],
  );
  return rows[0]!.id;
}

export async function linkRequirementRegulatoryReference(
  client: PoolClient,
  opts: { tenantId: string; requirementId: string; regulatoryReferenceId: string },
) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO requirement_regulatory_references (tenant_id, requirement_id, regulatory_reference_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [opts.tenantId, opts.requirementId, opts.regulatoryReferenceId],
  );
  return rows[0]!.id;
}
