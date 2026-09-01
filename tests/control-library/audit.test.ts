// Milestone 4: creation, draft modification, publishing, retirement,
// version creation, and mapping changes must all be auditable, reusing
// the existing audit-log architecture (no new UI, no new mechanism).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createControl,
  createControlLibraryVersion,
  createRegulatoryReference,
  createRequirement,
  createTenant,
  createUser,
  grantTenantMembership,
  linkControlRequirement,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Regulatory Content & Control Library auditability", () => {
  let tenant: string, user: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Methodology audit test tenant");
      user = await createUser(client, { tenantId: tenant });
      await grantTenantMembership(client, user, tenant);
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

  it("RegulatoryReference creation is audited", async () => {
    const id = await asFixtureSetup((c) => createRegulatoryReference(c, { tenantId: tenant, citation: "s.8(5)", title: "Audit test reference" }));
    const entries = await latestAuditEntries("regulatory_references", id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.title).toBe("Audit test reference");
  });

  it("ControlLibraryVersion creation, publishing, and retirement are each audited (creation = insert, publish/retire = update)", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Audit Trail Library" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));
    await asFixtureSetup((c) => c.query(`UPDATE control_library_versions SET status = 'retired' WHERE id = $1`, [id]));

    const entries = await latestAuditEntries("control_library_versions", id);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update", "update"]);
    expect(entries[1]!.field_changes.new.status).toBe("published");
    expect(entries[2]!.field_changes.new.status).toBe("retired");
  });

  it("Control creation is audited, and draft modification is audited as an update", async () => {
    const library = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Control Audit Library" }));
    const controlId = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: library, code: "AUD1", title: "Original title" }));
    await asFixtureSetup((c) => c.query(`UPDATE controls SET title = 'Revised while draft' WHERE id = $1`, [controlId]));

    const entries = await latestAuditEntries("controls", controlId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update"]);
    expect(entries[0]!.field_changes.code).toBe("AUD1");
    expect(entries[1]!.field_changes.new.title).toBe("Revised while draft");
  });

  it("mapping changes (linking and unlinking a Control to a Requirement) are audited as insert and delete events on the junction table", async () => {
    const library = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Mapping Audit Library" }));
    const controlId = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: library, code: "MAPAUD1", title: "Mapping audit control" }));
    const refId = await asFixtureSetup((c) => createRegulatoryReference(c, { tenantId: tenant, citation: "s.10(1)", title: "Mapping audit ref" }));
    const reqId = await asFixtureSetup((c) => createRequirement(c, { tenantId: tenant, primaryRegulatoryReferenceId: refId, title: "Mapping audit req" }));

    const mappingId = await asFixtureSetup((c) => linkControlRequirement(c, { tenantId: tenant, controlId, requirementId: reqId }));
    await asFixtureSetup((c) => c.query(`DELETE FROM control_requirements WHERE id = $1`, [mappingId]));

    const entries = await latestAuditEntries("control_requirements", mappingId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "delete"]);
    expect(entries[0]!.field_changes.control_id).toBe(controlId);
    expect(entries[1]!.field_changes.control_id).toBe(controlId); // DELETE logs the OLD row
  });

  it("every audit entry is correctly attributed to the acting user via auth.uid()", async () => {
    const committedId = await (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO regulatory_references (tenant_id, framework_name, citation, title) VALUES ($1, 'Attribution Test', 's.11', 'Attribution Check') RETURNING id`,
          [tenant],
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

    const entries = await latestAuditEntries("regulatory_references", committedId);
    expect(entries[0]!.actor_user_id).toBe(user);
  });
});
