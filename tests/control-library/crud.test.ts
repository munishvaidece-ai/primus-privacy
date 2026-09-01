// Milestone 4: regulatory-reference CRUD, requirement CRUD + linkage,
// control CRUD, many-to-many mapping, and duplicate-mapping prevention.
//
// Mutations run via asFixtureSetup (committed, matching the convention
// established in tests/master-data/entity-coverage.test.ts) so later
// steps in the same test can see earlier steps' effects; asUser is used
// only to read back under real RLS, proving an authorized tenant member
// can see the result. Write-authorization itself (that an unauthorized
// caller cannot perform these same writes) is covered in
// tenant-isolation.test.ts.
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
  linkRequirementRegulatoryReference,
  pool,
} from "./helpers";

describe("Regulatory Content & Control Library CRUD", () => {
  let tenant: string, user: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "CRUD test tenant");
      user = await createUser(client, { tenantId: tenant });
      await grantTenantMembership(client, user, tenant);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a RegulatoryReference", async () => {
    const id = await asFixtureSetup((c) =>
      createRegulatoryReference(c, {
        tenantId: tenant,
        citation: "DPDP Act 2023, s.8(5)",
        title: "Reasonable security safeguards",
        version: "2023",
      }),
    );
    const { rows } = await asUser(user, (c) =>
      c.query("SELECT title, status FROM regulatory_references WHERE id = $1", [id]),
    );
    expect(rows[0]).toMatchObject({ title: "Reasonable security safeguards", status: "active" });
  });

  it("updates a RegulatoryReference while active, and can retire it", async () => {
    const id = await asFixtureSetup((c) =>
      createRegulatoryReference(c, { tenantId: tenant, citation: "DPDP Act 2023, s.9", title: "Draft title" }),
    );
    await asFixtureSetup((c) => c.query(`UPDATE regulatory_references SET title = 'Final title' WHERE id = $1`, [id]));
    await asFixtureSetup((c) => c.query(`UPDATE regulatory_references SET status = 'retired' WHERE id = $1`, [id]));
    const { rows } = await asUser(user, (c) =>
      c.query("SELECT title, status FROM regulatory_references WHERE id = $1", [id]),
    );
    expect(rows[0]).toMatchObject({ title: "Final title", status: "retired" });
  });

  it("creates a Requirement linked to a primary RegulatoryReference", async () => {
    const refId = await asFixtureSetup((c) =>
      createRegulatoryReference(c, { tenantId: tenant, citation: "DPDP Act 2023, s.8(3)", title: "Notice to data principal" }),
    );
    const reqId = await asFixtureSetup((c) =>
      createRequirement(c, {
        tenantId: tenant,
        primaryRegulatoryReferenceId: refId,
        title: "Provide notice before processing",
      }),
    );
    const { rows } = await asUser(user, (c) =>
      c.query("SELECT primary_regulatory_reference_id FROM requirements WHERE id = $1", [reqId]),
    );
    expect(rows[0]!.primary_regulatory_reference_id).toBe(refId);
  });

  it("links a Requirement to secondary RegulatoryReferences via RequirementRegulatoryReference, and blocks a duplicate mapping", async () => {
    const primaryRef = await asFixtureSetup((c) => createRegulatoryReference(c, { tenantId: tenant, citation: "s.8(1)", title: "Primary" }));
    const secondaryRef = await asFixtureSetup((c) => createRegulatoryReference(c, { tenantId: tenant, citation: "s.8(2)", title: "Secondary" }));
    const req = await asFixtureSetup((c) => createRequirement(c, { tenantId: tenant, primaryRegulatoryReferenceId: primaryRef, title: "Cross-cited requirement" }));

    await asFixtureSetup((c) => linkRequirementRegulatoryReference(c, { tenantId: tenant, requirementId: req, regulatoryReferenceId: secondaryRef }));

    const { rows } = await asUser(user, (c) =>
      c.query("SELECT regulatory_reference_id FROM requirement_regulatory_references WHERE requirement_id = $1", [req]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.regulatory_reference_id).toBe(secondaryRef);

    await expect(
      asFixtureSetup((c) => linkRequirementRegulatoryReference(c, { tenantId: tenant, requirementId: req, regulatoryReferenceId: secondaryRef })),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("creates a Control belonging to a draft ControlLibraryVersion", async () => {
    const libraryVersion = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "CRUD Test Library v1.0" }));
    const controlId = await asFixtureSetup((c) =>
      createControl(c, { tenantId: tenant, controlLibraryVersionId: libraryVersion, code: "C1", title: "Access review", controlType: "detective" }),
    );
    const { rows } = await asUser(user, (c) => c.query("SELECT code, control_type FROM controls WHERE id = $1", [controlId]));
    expect(rows[0]).toMatchObject({ code: "C1", control_type: "detective" });
  });

  it("maps a Control to multiple Requirements and a Requirement to multiple Controls (N:N), and blocks a duplicate mapping", async () => {
    const libraryVersion = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "N:N Test Library" }));
    const ref = await asFixtureSetup((c) => createRegulatoryReference(c, { tenantId: tenant, citation: "s.8(4)", title: "N:N ref" }));
    const req1 = await asFixtureSetup((c) => createRequirement(c, { tenantId: tenant, primaryRegulatoryReferenceId: ref, title: "Req 1" }));
    const req2 = await asFixtureSetup((c) => createRequirement(c, { tenantId: tenant, primaryRegulatoryReferenceId: ref, title: "Req 2" }));
    const control1 = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: libraryVersion, code: "NN1", title: "Control 1" }));
    const control2 = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: libraryVersion, code: "NN2", title: "Control 2" }));

    // control1 satisfies both requirements; req1 is satisfied by both controls.
    await asFixtureSetup((c) => linkControlRequirement(c, { tenantId: tenant, controlId: control1, requirementId: req1 }));
    await asFixtureSetup((c) => linkControlRequirement(c, { tenantId: tenant, controlId: control1, requirementId: req2 }));
    await asFixtureSetup((c) => linkControlRequirement(c, { tenantId: tenant, controlId: control2, requirementId: req1 }));

    const mappingsForControl1 = await asUser(user, (c) =>
      c.query("SELECT requirement_id FROM control_requirements WHERE control_id = $1 ORDER BY requirement_id", [control1]),
    );
    expect(mappingsForControl1.rows.map((r) => r.requirement_id).sort()).toEqual([req1, req2].sort());

    const mappingsForReq1 = await asUser(user, (c) =>
      c.query("SELECT control_id FROM control_requirements WHERE requirement_id = $1 ORDER BY control_id", [req1]),
    );
    expect(mappingsForReq1.rows.map((r) => r.control_id).sort()).toEqual([control1, control2].sort());

    await expect(
      asFixtureSetup((c) => linkControlRequirement(c, { tenantId: tenant, controlId: control1, requirementId: req1 })),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("removing a mapping is a DELETE, not an in-place edit — the row is gone, not merely changed", async () => {
    const libraryVersion = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Delete Mapping Library" }));
    const ref = await asFixtureSetup((c) => createRegulatoryReference(c, { tenantId: tenant, citation: "s.8(6)", title: "Delete mapping ref" }));
    const req = await asFixtureSetup((c) => createRequirement(c, { tenantId: tenant, primaryRegulatoryReferenceId: ref, title: "Delete mapping req" }));
    const control = await asFixtureSetup((c) => createControl(c, { tenantId: tenant, controlLibraryVersionId: libraryVersion, code: "DM1", title: "Delete mapping control" }));
    const mappingId = await asFixtureSetup((c) => linkControlRequirement(c, { tenantId: tenant, controlId: control, requirementId: req }));

    await asFixtureSetup((c) => c.query("DELETE FROM control_requirements WHERE id = $1", [mappingId]));
    const { rows } = await asUser(user, (c) => c.query("SELECT id FROM control_requirements WHERE id = $1", [mappingId]));
    expect(rows).toHaveLength(0);
  });
});
