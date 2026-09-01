// Milestone 3 §9: creation, modification, status change, carry-forward,
// relationship changes, and retirement/archive must all be auditable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createEngagement,
  createOrganisation,
  createProcessingActivity,
  createSystem,
  createTenant,
  createUser,
  grantOrganisationMembership,
  insertSystemVersion,
  linkSystem,
  pool,
} from "./helpers";

describe("Processing Activity auditability", () => {
  let tenant: string, org: string, engagement: string, user: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "PA audit test tenant");
      org = await createOrganisation(client, tenant, "PA audit test org");
      engagement = await createEngagement(client, tenant, org, "DPDP Readiness — FY2026");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
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

  it("creation is audited", async () => {
    const paId = await asUser(user, (c) =>
      c
        .query(
          `INSERT INTO processing_activities (engagement_id, organisation_id, tenant_id, name) VALUES ($1, $2, $3, 'Fraud Detection') RETURNING id`,
          [engagement, org, tenant],
        )
        .then((r) => r.rows[0]!.id),
    );
    // The insert above ran inside asUser's own rolled-back transaction,
    // so the audit row it produced was rolled back too — repeat as a
    // fixture (committed) write so we can actually read the audit trail
    // back afterward.
    const committedPaId = await asFixtureSetup((client) =>
      client
        .query(
          `INSERT INTO processing_activities (engagement_id, organisation_id, tenant_id, name) VALUES ($1, $2, $3, 'Fraud Detection') RETURNING id`,
          [engagement, org, tenant],
        )
        .then((r) => r.rows[0]!.id),
    );

    const entries = await latestAuditEntries("processing_activities", committedPaId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.name).toBe("Fraud Detection");
    void paId; // (kept only to document the rolled-back-transaction point above)
  });

  it("modification and status change are both audited as UPDATE events", async () => {
    const paId = await asFixtureSetup((client) =>
      createProcessingActivity(client, { engagementId: engagement, organisationId: org, tenantId: tenant, name: "KYC" }),
    );

    await asFixtureSetup((client) => client.query(`UPDATE processing_activities SET description = 'Initial KYC flow' WHERE id = $1`, [paId]));
    await asFixtureSetup((client) => client.query(`UPDATE processing_activities SET lifecycle_status = 'active' WHERE id = $1`, [paId]));

    const entries = await latestAuditEntries("processing_activities", paId);
    // insert + 2 updates
    expect(entries.map((e) => e.action)).toEqual(["insert", "update", "update"]);
    expect(entries[1]!.field_changes.new.description).toBe("Initial KYC flow");
    expect(entries[2]!.field_changes.new.lifecycle_status).toBe("active");
  });

  it("retirement (a status change to 'retired') is audited", async () => {
    const paId = await asFixtureSetup((client) =>
      createProcessingActivity(client, { engagementId: engagement, organisationId: org, tenantId: tenant, name: "Legacy Loyalty Programme" }),
    );
    await asFixtureSetup((client) => client.query(`UPDATE processing_activities SET lifecycle_status = 'retired' WHERE id = $1`, [paId]));

    const entries = await latestAuditEntries("processing_activities", paId);
    const retirement = entries.find((e) => e.field_changes?.new?.lifecycle_status === "retired");
    expect(retirement).toBeDefined();
    expect(retirement!.action).toBe("update");
  });

  it("carry-forward is captured on the new row's own creation audit entry (carried_forward_from_id is part of field_changes)", async () => {
    const priorEngagement = await asFixtureSetup((client) => createEngagement(client, tenant, org, "DPDP Readiness — FY2026 (prior)"));
    const pa1 = await asFixtureSetup((client) =>
      createProcessingActivity(client, { engagementId: priorEngagement, organisationId: org, tenantId: tenant, name: "Customer Onboarding" }),
    );
    const nextEngagement = await asFixtureSetup((client) => createEngagement(client, tenant, org, "Annual DPDP Assessment — FY2027 (next)"));
    const pa2 = await asFixtureSetup((client) =>
      createProcessingActivity(client, {
        engagementId: nextEngagement,
        organisationId: org,
        tenantId: tenant,
        name: "Customer Onboarding",
        carriedForwardFromId: pa1,
      }),
    );

    const entries = await latestAuditEntries("processing_activities", pa2);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("insert");
    expect(entries[0]!.field_changes.carried_forward_from_id).toBe(pa1);
  });

  it("relationship changes (linking and unlinking a System) are audited as INSERT and DELETE events on the junction table", async () => {
    const paId = await asFixtureSetup((client) =>
      createProcessingActivity(client, { engagementId: engagement, organisationId: org, tenantId: tenant, name: "Customer Support" }),
    );
    const systemId = await asFixtureSetup((client) => createSystem(client, org));
    const systemVersionId = await asFixtureSetup((client) =>
      insertSystemVersion(client, { systemId, organisationId: org, name: "Support Ticketing System" }),
    );

    const linkId = await asFixtureSetup((client) =>
      linkSystem(client, { processingActivityId: paId, engagementId: engagement, organisationId: org, systemId, systemVersionId }),
    );
    await asFixtureSetup((client) =>
      client.query(`DELETE FROM processing_activity_systems WHERE id = $1`, [linkId]),
    );

    const entries = await latestAuditEntries("processing_activity_systems", linkId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "delete"]);
    expect(entries[0]!.field_changes.system_id).toBe(systemId);
    expect(entries[1]!.field_changes.system_id).toBe(systemId); // DELETE logs the OLD row, so it's still there
  });

  it("every audit entry is correctly attributed to the acting user via auth.uid()", async () => {
    const paId = await asUser(user, (c) =>
      c
        .query(
          `INSERT INTO processing_activities (engagement_id, organisation_id, tenant_id, name) VALUES ($1, $2, $3, 'Attribution Check') RETURNING id`,
          [engagement, org, tenant],
        )
        .then((r) => r.rows[0]!.id),
    );
    void paId;

    // Repeat as a committed write to actually inspect the persisted row —
    // asUser's own writes roll back, same as the first test in this file.
    const committedPaId = await (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO processing_activities (engagement_id, organisation_id, tenant_id, name) VALUES ($1, $2, $3, 'Attribution Check') RETURNING id`,
          [engagement, org, tenant],
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

    const entries = await latestAuditEntries("processing_activities", committedPaId);
    expect(entries[0]!.actor_user_id).toBe(user);
  });
});
