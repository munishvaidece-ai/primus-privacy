// Milestone 4's critical scenario: Library v1.0 (R1, C1, C2) is used by
// an ABC Financial assessment; Library v2.0 (R1, C1, C2, C3, with a
// changed mapping) is published later and must NOT silently alter v1.0's
// content. Also covers Engagement.control_library_version_id pinning:
// must reference a published/retired version (never draft), and is
// immutable once set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createOrganisation,
  createRegulatoryReference,
  createRequirement,
  createTenant,
  linkControlRequirement,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Historical reproducibility: Library v1.0 vs v2.0 (ABC Financial Services scenario)", () => {
  let tenant: string, org: string;
  let refR1: string, reqR1: string;
  let libraryV1: string, controlV1C1: string, controlV1C2: string;
  let libraryV2: string, controlV2C1: string, controlV2C2: string, controlV2C3: string;
  let abcEngagement: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Historical Reproducibility Tenant");
      org = await createOrganisation(client, tenant, "ABC Financial Services");

      // R1: a single Requirement row, shared across both library versions
      // — DATA_MODEL.md §6/§12: Requirement is not itself library-
      // version-scoped.
      refR1 = await createRegulatoryReference(client, { tenantId: tenant, citation: "DPDP Act 2023, s.8(5)", title: "Reasonable security safeguards" });
      reqR1 = await createRequirement(client, { tenantId: tenant, primaryRegulatoryReferenceId: refR1, title: "R1: Maintain reasonable security safeguards" });

      // --- Library v1.0: R1, C1, C2 ---
      libraryV1 = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "DPDP Control Library v1.0" });
      controlV1C1 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV1, code: "C1", title: "Access control policy" });
      controlV1C2 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV1, code: "C2", title: "Encryption at rest" });
      await linkControlRequirement(client, { tenantId: tenant, controlId: controlV1C1, requirementId: reqR1 });
      await linkControlRequirement(client, { tenantId: tenant, controlId: controlV1C2, requirementId: reqR1 });
      await publishControlLibraryVersion(client, libraryV1);

      // ABC Financial's engagement pins to Library v1.0 at creation.
      abcEngagement = await createEngagement(client, tenant, org, "DPDP Readiness — FY2026");
      await client.query(`UPDATE engagements SET control_library_version_id = $1 WHERE id = $2`, [libraryV1, abcEngagement]);

      // --- Library v2.0, published later: R1 (same row), C1, C2 (new
      // rows, same codes), C3 (new control), with a changed mapping —
      // C3 maps to R1 too, but C2's v2.0 row is deliberately NOT mapped
      // to R1 (a "changed mapping" relative to v1.0).
      libraryV2 = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "DPDP Control Library v2.0" });
      controlV2C1 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV2, code: "C1", title: "Access control policy (revised)" });
      controlV2C2 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV2, code: "C2", title: "Encryption at rest (revised)" });
      controlV2C3 = await createControl(client, { tenantId: tenant, controlLibraryVersionId: libraryV2, code: "C3", title: "Key management" });
      await linkControlRequirement(client, { tenantId: tenant, controlId: controlV2C1, requirementId: reqR1 });
      await linkControlRequirement(client, { tenantId: tenant, controlId: controlV2C3, requirementId: reqR1 });
      // Note: controlV2C2 is intentionally NOT linked to reqR1 in v2.0.
      await publishControlLibraryVersion(client, libraryV2);
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below (the shared `pool` singleton is imported from
  // rls/helpers and would error if ended twice).

  // Q1: What controls exist in Library v1.0?
  it("Q1: Library v1.0 contains exactly C1 and C2", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT code FROM controls WHERE control_library_version_id = $1 ORDER BY code", [libraryV1]),
    );
    expect(rows.map((r) => r.code)).toEqual(["C1", "C2"]);
  });

  // Q2: What controls exist in Library v2.0?
  it("Q2: Library v2.0 contains exactly C1, C2, and C3 (its own rows, not v1.0's)", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT code, id FROM controls WHERE control_library_version_id = $1 ORDER BY code", [libraryV2]),
    );
    expect(rows.map((r) => r.code)).toEqual(["C1", "C2", "C3"]);
    expect(rows.map((r) => r.id).sort()).toEqual([controlV2C1, controlV2C2, controlV2C3].sort());
    // Confirms v2.0's "C1"/"C2" are genuinely different rows from v1.0's.
    expect(rows.find((r) => r.code === "C1")!.id).not.toBe(controlV1C1);
    expect(rows.find((r) => r.code === "C2")!.id).not.toBe(controlV1C2);
  });

  // Q3: What requirements does v1.0's C1 map to?
  it("Q3: v1.0's C1 maps to R1", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT requirement_id FROM control_requirements WHERE control_id = $1", [controlV1C1]),
    );
    expect(rows.map((r) => r.requirement_id)).toEqual([reqR1]);
  });

  // Q4: What requirements does v2.0's C1/C2/C3 map to — did the mapping change?
  it("Q4: v2.0's mapping differs from v1.0's — C2(v2.0) is no longer mapped to R1, but C3(v2.0) now is", async () => {
    const v2Mappings = await asFixtureSetup((c) =>
      c.query(
        "SELECT c.code, cr.requirement_id FROM control_requirements cr JOIN controls c ON c.id = cr.control_id WHERE c.control_library_version_id = $1 ORDER BY c.code",
        [libraryV2],
      ),
    );
    expect(v2Mappings.rows).toEqual([
      { code: "C1", requirement_id: reqR1 },
      { code: "C3", requirement_id: reqR1 },
    ]);
  });

  // Q5: Which library version does the ABC Financial engagement use?
  it("Q5: ABC Financial's engagement is pinned to Library v1.0, not v2.0", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT control_library_version_id FROM engagements WHERE id = $1", [abcEngagement]),
    );
    expect(rows[0]!.control_library_version_id).toBe(libraryV1);
    expect(rows[0]!.control_library_version_id).not.toBe(libraryV2);
  });

  // Q6: After v2.0 is published, is v1.0's content (C1, C2, and their
  // mappings to R1) unchanged?
  it("Q6: v1.0's C1/C2 and their mapping to R1 are exactly what they were before v2.0 existed", async () => {
    const controls = await asFixtureSetup((c) =>
      c.query("SELECT id, code, title FROM controls WHERE control_library_version_id = $1 ORDER BY code", [libraryV1]),
    );
    expect(controls.rows).toEqual([
      { id: controlV1C1, code: "C1", title: "Access control policy" },
      { id: controlV1C2, code: "C2", title: "Encryption at rest" },
    ]);

    const mappings = await asFixtureSetup((c) =>
      c.query(
        "SELECT c.code, cr.requirement_id FROM control_requirements cr JOIN controls c ON c.id = cr.control_id WHERE c.control_library_version_id = $1 ORDER BY c.code",
        [libraryV1],
      ),
    );
    expect(mappings.rows).toEqual([
      { code: "C1", requirement_id: reqR1 },
      { code: "C2", requirement_id: reqR1 },
    ]);

    const version = await asFixtureSetup((c) => c.query("SELECT status, version_label FROM control_library_versions WHERE id = $1", [libraryV1]));
    expect(version.rows[0]).toMatchObject({ status: "published", version_label: "DPDP Control Library v1.0" });
  });

  // Resolving an engagement's full "what did we assess against" picture
  // end-to-end, joining Engagement -> ControlLibraryVersion -> Control ->
  // ControlRequirement -> Requirement in one query.
  it("resolves the full v1.0 methodology reachable from the ABC Financial engagement in one join", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT c.code AS control_code, r.title AS requirement_title
         FROM engagements e
         JOIN controls c ON c.control_library_version_id = e.control_library_version_id
         JOIN control_requirements cr ON cr.control_id = c.id
         JOIN requirements r ON r.id = cr.requirement_id
         WHERE e.id = $1
         ORDER BY c.code`,
        [abcEngagement],
      ),
    );
    expect(rows).toEqual([
      { control_code: "C1", requirement_title: "R1: Maintain reasonable security safeguards" },
      { control_code: "C2", requirement_title: "R1: Maintain reasonable security safeguards" },
    ]);
  });
});

describe("Engagement.control_library_version_id pinning rules", () => {
  let tenant: string, org: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Engagement Pinning Tenant");
      org = await createOrganisation(client, tenant, "Pinning Test Client");
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("an Engagement cannot pin to a draft ControlLibraryVersion", async () => {
    const draftVersion = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Still Draft" }));
    const engagement = await asFixtureSetup((c) => createEngagement(c, tenant, org, "Draft Pin Attempt"));
    await expect(
      asFixtureSetup((c) =>
        c.query(`UPDATE engagements SET control_library_version_id = $1 WHERE id = $2`, [draftVersion, engagement]),
      ),
    ).rejects.toThrow(/cannot pin to a draft control library version/i);
  });

  it("an Engagement CAN pin to a published ControlLibraryVersion, and CAN pin to a retired one", async () => {
    const publishedVersion = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Pin: Published" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, publishedVersion));
    const engagement1 = await asFixtureSetup((c) => createEngagement(c, tenant, org, "Published Pin"));
    await asFixtureSetup((c) => c.query(`UPDATE engagements SET control_library_version_id = $1 WHERE id = $2`, [publishedVersion, engagement1]));
    const { rows: r1 } = await asFixtureSetup((c) => c.query("SELECT control_library_version_id FROM engagements WHERE id = $1", [engagement1]));
    expect(r1[0]!.control_library_version_id).toBe(publishedVersion);

    const retiredVersion = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Pin: Retired" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, retiredVersion));
    await asFixtureSetup((c) => c.query(`UPDATE control_library_versions SET status = 'retired' WHERE id = $1`, [retiredVersion]));
    const engagement2 = await asFixtureSetup((c) => createEngagement(c, tenant, org, "Retired Pin"));
    await asFixtureSetup((c) => c.query(`UPDATE engagements SET control_library_version_id = $1 WHERE id = $2`, [retiredVersion, engagement2]));
    const { rows: r2 } = await asFixtureSetup((c) => c.query("SELECT control_library_version_id FROM engagements WHERE id = $1", [engagement2]));
    expect(r2[0]!.control_library_version_id).toBe(retiredVersion);
  });

  it("an Engagement's pin, once set, is immutable — even to another published version", async () => {
    const versionA = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Immutable Pin A" }));
    const versionB = await asFixtureSetup((c) => createControlLibraryVersion(c, { tenantId: tenant, versionLabel: "Immutable Pin B" }));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, versionA));
    await asFixtureSetup((c) => publishControlLibraryVersion(c, versionB));
    const engagement = await asFixtureSetup((c) => createEngagement(c, tenant, org, "Immutable Pin Test"));
    await asFixtureSetup((c) => c.query(`UPDATE engagements SET control_library_version_id = $1 WHERE id = $2`, [versionA, engagement]));

    await expect(
      asFixtureSetup((c) => c.query(`UPDATE engagements SET control_library_version_id = $1 WHERE id = $2`, [versionB, engagement])),
    ).rejects.toThrow(/control_library_version_id is immutable once set/i);
  });
});
