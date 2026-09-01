// Milestone 4: Draft/Published/Retired status transitions, and
// published-version immutability enforced at the database level —
// "published methodology cannot be modified through ordinary application
// paths." All mutations run via asFixtureSetup (superuser, matching the
// project convention — see crud.test.ts) so a rejected write is a real
// database-level constraint/trigger failure, not an RLS visibility gap.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  createControl,
  createControlLibraryVersion,
  createRegulatoryReference,
  createRequirement,
  createTenant,
  linkControlRequirement,
  pool,
  publishControlLibraryVersion,
  retireControlLibraryVersion,
} from "./helpers";

describe("ControlLibraryVersion status transitions and published-content immutability", () => {
  let tenant: string;

  beforeAll(async () => {
    tenant = await asFixtureSetup((c) => createTenant(c, "Publishing/Immutability test tenant"));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a draft version can be edited freely (version_label, ordinary fields)", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Draft A" }));
    await asFixtureSetup((c) => c.query(`UPDATE control_library_versions SET version_label = 'Draft A (renamed)' WHERE id = $1`, [id]));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT version_label, status FROM control_library_versions WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ version_label: "Draft A (renamed)", status: "draft" });
  });

  it("draft -> published is allowed and stamps published_at automatically", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Publish Test A" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status, published_at FROM control_library_versions WHERE id = $1", [id]));
    expect(rows[0]!.status).toBe("published");
    expect(rows[0]!.published_at).not.toBeNull();
  });

  it("draft -> retired is blocked (must be published first)", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Draft-to-Retired Test" }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE control_library_versions SET status = 'retired' WHERE id = $1`, [id])),
    ).rejects.toThrow(/only transition to published/i);
  });

  it("published -> draft (un-publishing) is blocked", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Unpublish Test" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE control_library_versions SET status = 'draft' WHERE id = $1`, [id])),
    ).rejects.toThrow(/only transition to retired/i);
  });

  it("published content (version_label) cannot be modified through an ordinary UPDATE", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Immutable Content Test" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE control_library_versions SET version_label = 'Tampered' WHERE id = $1`, [id])),
    ).rejects.toThrow(/content is immutable/i);
  });

  it("published -> retired is allowed", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Retire Test" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));
    await asFixtureSetup((c) => retireControlLibraryVersion(c, id));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM control_library_versions WHERE id = $1", [id]));
    expect(rows[0]!.status).toBe("retired");
  });

  it("a retired version is permanently immutable — even a status-only no-op UPDATE is blocked", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Retired Immutable Test" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));
    await asFixtureSetup((c) => retireControlLibraryVersion(c, id));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE control_library_versions SET version_label = 'Tampered' WHERE id = $1`, [id])),
    ).rejects.toThrow(/retired control library version is immutable/i);
  });

  it("a Control cannot be INSERTed into a published ControlLibraryVersion", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "No New Controls Test" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));
    await expect(
      asFixtureSetup((c) =>
        createControl(c, { tenantId: tenant, controlLibraryVersionId: id, code: "LATE1", title: "Added after publish" }),
      ),
    ).rejects.toThrow(/cannot INSERT a control belonging to a published/i);
  });

  it("a Control cannot be UPDATEd once its library version is published", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "No Edit Controls Test" }));
    const controlId = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: id, code: "EDIT1", title: "Original title" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE controls SET title = 'Tampered title' WHERE id = $1`, [controlId])),
    ).rejects.toThrow(/cannot UPDATE a control belonging to a published/i);
  });

  it("a Control cannot be DELETEd once its library version is published", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "No Delete Controls Test" }));
    const controlId = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: id, code: "DEL1", title: "Should stay" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));
    await expect(
      asFixtureSetup((c) => c.query(`DELETE FROM controls WHERE id = $1`, [controlId])),
    ).rejects.toThrow(/cannot DELETE a control belonging to a published/i);
  });

  it("a Control's control_library_version_id is immutable, even while still draft", async () => {
    const versionA = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Reparent Source" }));
    const versionB = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Reparent Target" }));
    const controlId = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: versionA, code: "RP1", title: "Reparent test" }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE controls SET control_library_version_id = $1 WHERE id = $2`, [versionB, controlId])),
    ).rejects.toThrow(/control_library_version_id is immutable/i);
  });

  it("a ControlRequirement mapping cannot be created once the Control's library version is published", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "No New Mapping Test" }));
    const controlId = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: id, code: "MAP1", title: "Mapping test control" }));
    const refId = await asFixtureSetup((c) => createRegulatoryReference(c, { tenantId: tenant, citation: "s.9(1)", title: "Mapping test ref" }));
    const reqId = await asFixtureSetup((c) => createRequirement(c, { tenantId: tenant, primaryRegulatoryReferenceId: refId, title: "Mapping test req" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));

    await expect(
      asFixtureSetup((c) => linkControlRequirement(c, { tenantId: tenant, controlId, requirementId: reqId })),
    ).rejects.toThrow(/cannot INSERT a control-requirement mapping/i);
  });

  it("a ControlRequirement mapping cannot be removed once the Control's library version is published", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "No Remove Mapping Test" }));
    const controlId = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: id, code: "MAP2", title: "Mapping removal test control" }));
    const refId = await asFixtureSetup((c) => createRegulatoryReference(c, { tenantId: tenant, citation: "s.9(2)", title: "Mapping removal test ref" }));
    const reqId = await asFixtureSetup((c) => createRequirement(c, { tenantId: tenant, primaryRegulatoryReferenceId: refId, title: "Mapping removal test req" }));
    const mappingId = await asFixtureSetup((c) => linkControlRequirement(c, { tenantId: tenant, controlId, requirementId: reqId }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, id));

    await expect(
      asFixtureSetup((c) => c.query("DELETE FROM control_requirements WHERE id = $1", [mappingId])),
    ).rejects.toThrow(/cannot DELETE a control-requirement mapping/i);
  });

  it("Controls and mappings remain freely editable while the library version stays draft", async () => {
    const id = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Still Draft Test" }));
    const controlId = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: id, code: "SD1", title: "Editable" }));
    await asFixtureSetup((c) => c.query(`UPDATE controls SET title = 'Edited while draft' WHERE id = $1`, [controlId]));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT title FROM controls WHERE id = $1", [controlId]));
    expect(rows[0]!.title).toBe("Edited while draft");
    // And still deletable while draft.
    await asFixtureSetup((c) => c.query(`DELETE FROM controls WHERE id = $1`, [controlId]));
    const after = await asFixtureSetup((c) => c.query("SELECT id FROM controls WHERE id = $1", [controlId]));
    expect(after.rows).toHaveLength(0);
  });
});
