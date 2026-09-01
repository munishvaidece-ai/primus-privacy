// Milestone 4: Tenant/Practice boundary enforcement for the methodology
// tables — Tenant A cannot read or write Tenant B's RegulatoryReference/
// Requirement/ControlLibraryVersion/Control/junction rows. Also covers
// the deliberate read/write asymmetry (SELECT via can_access_tenant,
// INSERT/UPDATE via the narrower is_active_tenant_member) and
// unauthenticated/unauthorized access blocking.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asFixtureSetup,
  asUser,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createOrganisation,
  createRegulatoryReference,
  createRequirement,
  createTenant,
  createUser,
  grantEngagementMembership,
  grantOrganisationMembership,
  grantTenantMembership,
  linkControlRequirement,
  pool,
} from "./helpers";

describe("Methodology tenant isolation and write protection", () => {
  let tenantA: string, tenantB: string;
  let orgA: string;
  let refA: string, reqA: string, libraryA: string, controlA: string, mappingA: string;
  let refB: string;

  let tenantMemberA: string; // TenantMembership on tenant A — can read AND write
  let orgScopedUserA: string; // OrganisationMembership under tenant A only — can read, cannot write
  let userB: string; // TenantMembership on tenant B only
  let outsiderUser: string; // no membership anywhere

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Tenant A — methodology isolation");
      tenantB = await createTenant(client, "Tenant B — methodology isolation");
      orgA = await createOrganisation(client, tenantA, "Tenant A's Client");

      refA = await createRegulatoryReference(client, { tenantId: tenantA, citation: "s.8(5)", title: "Tenant A reference" });
      reqA = await createRequirement(client, { tenantId: tenantA, primaryRegulatoryReferenceId: refA, title: "Tenant A requirement" });
      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Tenant A Library" });
      controlA = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "TA1", title: "Tenant A control" });
      mappingA = await linkControlRequirement(client, { tenantId: tenantA, controlId: controlA, requirementId: reqA });

      refB = await createRegulatoryReference(client, { tenantId: tenantB, citation: "s.9(1)", title: "Tenant B reference" });

      tenantMemberA = await createUser(client, { tenantId: tenantA });
      await grantTenantMembership(client, tenantMemberA, tenantA);

      const engagementA = await createEngagement(client, tenantA, orgA, "Tenant A engagement");
      orgScopedUserA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, orgScopedUserA, orgA);
      // Also give this user an EngagementMembership so `can_access_tenant`
      // genuinely resolves true for them (via can_access_organisation),
      // proving the read/write split is about membership *scope*, not
      // just "no access at all".
      await grantEngagementMembership(client, orgScopedUserA, engagementA);

      userB = await createUser(client, { tenantId: tenantB });
      await grantTenantMembership(client, userB, tenantB);

      outsiderUser = await createUser(client, { tenantId: tenantA });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Read isolation ---

  it("a Tenant A member can read Tenant A's methodology objects", async () => {
    const ref = await asUser(tenantMemberA, (c) => c.query("SELECT id FROM regulatory_references WHERE id = $1", [refA]));
    expect(ref.rows).toHaveLength(1);
    const req = await asUser(tenantMemberA, (c) => c.query("SELECT id FROM requirements WHERE id = $1", [reqA]));
    expect(req.rows).toHaveLength(1);
    const lib = await asUser(tenantMemberA, (c) => c.query("SELECT id FROM control_library_versions WHERE id = $1", [libraryA]));
    expect(lib.rows).toHaveLength(1);
    const ctrl = await asUser(tenantMemberA, (c) => c.query("SELECT id FROM controls WHERE id = $1", [controlA]));
    expect(ctrl.rows).toHaveLength(1);
    const mapping = await asUser(tenantMemberA, (c) => c.query("SELECT id FROM control_requirements WHERE id = $1", [mappingA]));
    expect(mapping.rows).toHaveLength(1);
  });

  it("Tenant A cannot read Tenant B's RegulatoryReference", async () => {
    const rows = await asUser(tenantMemberA, (c) => c.query("SELECT id FROM regulatory_references WHERE id = $1", [refB]));
    expect(rows.rows).toHaveLength(0);

    const listing = await asUser(tenantMemberA, (c) => c.query("SELECT id FROM regulatory_references"));
    expect(listing.rows.map((r) => r.id)).not.toContain(refB);
  });

  it("Tenant B cannot read any of Tenant A's methodology objects (Requirement, ControlLibraryVersion, Control, mapping)", async () => {
    const req = await asUser(userB, (c) => c.query("SELECT id FROM requirements WHERE id = $1", [reqA]));
    expect(req.rows).toHaveLength(0);
    const lib = await asUser(userB, (c) => c.query("SELECT id FROM control_library_versions WHERE id = $1", [libraryA]));
    expect(lib.rows).toHaveLength(0);
    const ctrl = await asUser(userB, (c) => c.query("SELECT id FROM controls WHERE id = $1", [controlA]));
    expect(ctrl.rows).toHaveLength(0);
    const mapping = await asUser(userB, (c) => c.query("SELECT id FROM control_requirements WHERE id = $1", [mappingA]));
    expect(mapping.rows).toHaveLength(0);
  });

  it("an unaffiliated user cannot read Tenant A's methodology", async () => {
    const rows = await asUser(outsiderUser, (c) => c.query("SELECT id FROM regulatory_references WHERE id = $1", [refA]));
    expect(rows.rows).toHaveLength(0);
  });

  it("an anonymous request is denied at the grant level", async () => {
    await expect(asAnon((c) => c.query("SELECT id FROM regulatory_references WHERE id = $1", [refA]))).rejects.toThrow(
      /permission denied/i,
    );
  });

  // --- Write isolation ---

  it("Tenant B cannot INSERT a RegulatoryReference under Tenant A", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(`INSERT INTO regulatory_references (tenant_id, framework_name, citation, title) VALUES ($1, 'Forged', 'x', 'Forged reference')`, [tenantA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("Tenant B cannot UPDATE Tenant A's RegulatoryReference (0 rows affected — not visible to them at all)", async () => {
    const result = await asUser(userB, (c) => c.query("UPDATE regulatory_references SET title = 'tampered' WHERE id = $1", [refA]));
    expect(result.rowCount).toBe(0);

    const check = await asUser(tenantMemberA, (c) => c.query("SELECT title FROM regulatory_references WHERE id = $1", [refA]));
    expect(check.rows[0]!.title).toBe("Tenant A reference");
  });

  it("Tenant B cannot INSERT a Control into Tenant A's ControlLibraryVersion", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(
          `INSERT INTO controls (tenant_id, control_library_version_id, code, title, control_type) VALUES ($1, $2, 'FORGED', 'Forged control', 'preventive')`,
          [tenantA, libraryA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("Tenant B cannot INSERT a ControlRequirement mapping referencing Tenant A's Control", async () => {
    await expect(
      asUser(userB, (c) =>
        c.query(`INSERT INTO control_requirements (tenant_id, control_id, requirement_id) VALUES ($1, $2, $3)`, [tenantA, controlA, reqA]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  // --- Read/write authorization split: is_active_tenant_member (write)
  // is narrower than can_access_tenant (read) ---

  it("an organisation-scoped Tenant A user (no TenantMembership) CAN read Tenant A's methodology", async () => {
    const rows = await asUser(orgScopedUserA, (c) => c.query("SELECT id FROM regulatory_references WHERE id = $1", [refA]));
    expect(rows.rows).toHaveLength(1);
  });

  it("an organisation-scoped Tenant A user (no TenantMembership) CANNOT write Tenant A's methodology — practice governance requires actual TenantMembership", async () => {
    await expect(
      asUser(orgScopedUserA, (c) =>
        c.query(`INSERT INTO regulatory_references (tenant_id, framework_name, citation, title) VALUES ($1, 'Attempted', 'x', 'Attempted by org-scoped user')`, [tenantA]),
      ),
    ).rejects.toThrow(/row-level security/i);

    const updateResult = await asUser(orgScopedUserA, (c) =>
      c.query("UPDATE regulatory_references SET title = 'tampered' WHERE id = $1", [refA]),
    );
    expect(updateResult.rowCount).toBe(0);
  });

  it("a genuine Tenant A member CAN write — proving the blocks above are real access control, not a broken pipe", async () => {
    const insertResult = await asUser(tenantMemberA, (c) =>
      c.query(
        `INSERT INTO regulatory_references (tenant_id, framework_name, citation, title) VALUES ($1, 'DPDP Act 2023', 's.9', 'New reference') RETURNING id`,
        [tenantA],
      ),
    );
    expect(insertResult.rows).toHaveLength(1);

    const updateResult = await asUser(tenantMemberA, (c) =>
      c.query("UPDATE regulatory_references SET title = 'Updated by tenant member' WHERE id = $1 RETURNING title", [refA]),
    );
    expect(updateResult.rows[0]!.title).toBe("Updated by tenant member");
  });
});
