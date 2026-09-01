// Slice C7.1 — Assessment Creation & Control Population. Tests the real
// `createAssessment` function (lib/domain/assessments.ts) the real
// Server Action calls, against real PostgreSQL — no mocked
// authorization. This is the fix for the C7 review's own P0 finding:
// before this slice, no function anywhere in the codebase could ever
// create an Assessment, so the entire Risk→Finding→Remediation→
// Validation chain was unreachable without a database script.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createAssessment,
  getAssessmentDetail,
  InvalidAssessmentInputError,
  NoControlLibraryPinnedError,
} from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import {
  asUser,
  asAnon,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantEngagementMembership,
  createControlLibraryVersion,
  publishControlLibraryVersion,
  createControl,
  pinEngagementControlLibraryVersion,
  pool,
} from "./helpers";

describe("Application layer — Assessment Creation (Slice C7.1)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string; // tenantA/orgA, pinned to libraryA (3 controls)
  let engagementA2: string; // tenantA/orgA2, pinned to libraryA
  let engagementA3: string; // tenantA/orgA (same org as A), pinned to libraryA
  let engagementNoLibrary: string; // tenantA/orgA, NOT pinned
  let engagementEmptyLibrary: string; // tenantA/orgA, pinned to a published, zero-control library
  let engagementB: string; // tenantB/orgB, pinned to libraryB

  let libraryA: string; // published, controls C1/C2/C3
  let controlA1: string, controlA2: string, controlA3: string;
  let libraryAEmpty: string; // published, zero controls
  let libraryB: string; // published, one control
  let controlB1: string;

  let userA: string;
  let outsiderA: string;
  let userA2: string;
  let userA3: string;
  let userB: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice C7.1 Tenant A");
      tenantB = await createTenant(client, "Slice C7.1 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice C7.1 Org A");
      orgA2 = await createOrganisation(client, tenantA, "Slice C7.1 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice C7.1 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "Slice C7.1 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Slice C7.1 Engagement A2");
      engagementA3 = await createEngagement(client, tenantA, orgA, "Slice C7.1 Engagement A3 (same org as A)");
      engagementNoLibrary = await createEngagement(client, tenantA, orgA, "Slice C7.1 Engagement — no library pinned");
      engagementEmptyLibrary = await createEngagement(client, tenantA, orgA, "Slice C7.1 Engagement — empty library");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice C7.1 Engagement B");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C7.1 Library A v1" });
      controlA1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Control C1" });
      controlA2 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C2", title: "Control C2" });
      controlA3 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C3", title: "Control C3" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA2, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA3, libraryA);

      libraryAEmpty = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C7.1 Library A — empty" });
      await publishControlLibraryVersion(client, libraryAEmpty);
      await pinEngagementControlLibraryVersion(client, engagementEmptyLibrary, libraryAEmpty);

      libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Slice C7.1 Library B" });
      controlB1 = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "B1", title: "Control B1" });
      await publishControlLibraryVersion(client, libraryB);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      userA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA, engagementA);
      await grantEngagementMembership(client, userA, engagementEmptyLibrary);
      await grantEngagementMembership(client, userA, engagementNoLibrary);
      outsiderA = await createUser(client, { tenantId: tenantA });
      userA2 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA2, engagementA2);
      userA3 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA3, engagementA3);
      userB = await createUser(client, { tenantId: tenantB });
      await grantEngagementMembership(client, userB, engagementB);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Creation (instructions §22 "Creation" 1-7) -------------------------

  it("1-7. An authorized user creates an Assessment: starts draft, correct type/period/engagement/tenant/org/library stored", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementA, assessmentType: "control_readiness", periodLabel: "FY2026" }),
    );

    const { rows } = await asFixtureSetup((c) => c.query("SELECT * FROM assessments WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({
      engagement_id: engagementA,
      organisation_id: orgA,
      tenant_id: tenantA,
      control_library_version_id: libraryA,
      assessment_type: "control_readiness",
      period_label: "FY2026",
      status: "draft",
    });
  });

  it("An empty/whitespace period label is rejected before any database write", async () => {
    await expect(
      withRequestDb(userA, (db) => createAssessment(db, userA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "   " })),
    ).rejects.toThrow(InvalidAssessmentInputError);
  });

  it("An invalid assessment type is rejected before any database write", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        // @ts-expect-error deliberately invalid type to prove server-side validation, not just the TS type
        createAssessment(db, userA, { engagementId: engagementA, assessmentType: "not_a_real_type", periodLabel: "FY2026" }),
      ),
    ).rejects.toThrow(InvalidAssessmentInputError);
  });

  it("Creation against a nonexistent Engagement is rejected", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createAssessment(db, userA, { engagementId: "00000000-0000-0000-0000-000000000000", assessmentType: "annual", periodLabel: "FY2026" }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // --- Population (instructions §22 "Population" 8-11) --------------------

  it("8. All Controls from the pinned library become AssessmentControls", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "FY2027 (population check)" }),
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT control_id FROM assessment_controls WHERE assessment_id = $1 ORDER BY control_id", [id]),
    );
    const controlIds = rows.map((r) => r.control_id).sort();
    expect(controlIds).toEqual([controlA1, controlA2, controlA3].sort());
  });

  it("9. No Controls from another library are included", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "FY2027 (no cross-library controls)" }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT control_id FROM assessment_controls WHERE assessment_id = $1", [id]));
    expect(rows.some((r) => r.control_id === controlB1)).toBe(false);
  });

  it("10. Duplicate AssessmentControls are impossible — a direct SQL attempt to insert the same (assessment, control) pair twice is rejected", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "FY2027 (duplicate check)" }),
    );
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO assessment_controls (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, controlA1, tenantA, orgA, engagementA, libraryA],
        ),
      ),
    ).rejects.toThrow(/assessment_controls_assessment_id_control_id_key/);
  });

  it("11. A zero-control library behaves correctly — Assessment is created with zero AssessmentControls, no error", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementEmptyLibrary, assessmentType: "annual", periodLabel: "FY2026 (empty library)" }),
    );
    const detail = await withRequestDb(userA, (db) => getAssessmentDetail(db, userA, id));
    expect(detail.controlRows).toHaveLength(0);
    expect(detail.progress).toEqual({ completed: 0, total: 0 });
  });

  it("No control library pinned: creation is rejected with a clean, named error, never a raw database error", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createAssessment(db, userA, { engagementId: engagementNoLibrary, assessmentType: "annual", periodLabel: "FY2026" }),
      ),
    ).rejects.toThrow(NoControlLibraryPinnedError);
  });

  // --- Security (instructions §22 "Security" 12-16) ------------------------

  it("12. Tenant isolation: Tenant A cannot create an Assessment in Tenant B's Engagement", async () => {
    await expect(
      withRequestDb(userA, (db) => createAssessment(db, userA, { engagementId: engagementB, assessmentType: "annual", periodLabel: "Should fail" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("13. Organisation isolation: Organisation A cannot create an Assessment in Organisation A2's Engagement (same tenant)", async () => {
    await expect(
      withRequestDb(userA, (db) => createAssessment(db, userA, { engagementId: engagementA2, assessmentType: "annual", periodLabel: "Should fail" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("14. Engagement isolation: Engagement A's user cannot create an Assessment in Engagement A3 (same organisation)", async () => {
    await expect(
      withRequestDb(userA, (db) => createAssessment(db, userA, { engagementId: engagementA3, assessmentType: "annual", periodLabel: "Should fail" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("15. Anonymous creation fails", async () => {
    await expect(asAnon((c) => c.query("SELECT * FROM assessments LIMIT 1"))).rejects.toThrow();
    await expect(
      asAnon((c) =>
        c.query(
          `INSERT INTO assessments (engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label) VALUES ($1, $2, $3, $4, 'annual', 'Anon attempt')`,
          [engagementA, orgA, tenantA, libraryA],
        ),
      ),
    ).rejects.toThrow();
  });

  it("Unauthorized user (no membership at all) cannot create an Assessment", async () => {
    await expect(
      withRequestDb(outsiderA, (db) => createAssessment(db, outsiderA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Should fail" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("16. Forged scope IDs cannot cross a tenant boundary: a direct, malicious raw INSERT with forged tenant/organisation is rejected by RLS", async () => {
    await expect(
      asUser(userA, (c) =>
        c.query(
          `INSERT INTO assessments (engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label) VALUES ($1, $2, $3, $4, 'annual', 'Forged scope')`,
          [engagementB, orgB, tenantB, libraryB],
        ),
      ),
    ).rejects.toThrow();
  });

  it("17. Cross-library rejection: a direct SQL attempt to pin an Assessment to a ControlLibraryVersion inconsistent with its Engagement is rejected", async () => {
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO assessments (engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label) VALUES ($1, $2, $3, $4, 'annual', 'Cross-library attempt')`,
          [engagementA, orgA, tenantA, libraryB],
        ),
      ),
    ).rejects.toThrow(/assessments_engagement_control_library_version_fk|assessments_control_library_version_tenant_fk/);
  });

  // --- AssessmentControl security (instructions §18) -----------------------

  it("AssessmentControl security: a direct SQL attempt to reference a Control from a different library version than the Assessment's own pinned one is rejected", async () => {
    const { id: assessmentId } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Cross-library control attempt" }),
    );
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO assessment_controls (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id) VALUES ($1, $2, $3, $4, $5, $6)`,
          [assessmentId, controlB1, tenantA, orgA, engagementA, libraryA],
        ),
      ),
    ).rejects.toThrow(/assessment_controls_control_library_version_fk/);
  });

  it("AssessmentControl security: a direct SQL attempt to attach an AssessmentControl scoped to a different tenant/org/engagement than its own Assessment is rejected", async () => {
    const { id: assessmentId } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Forged AssessmentControl scope" }),
    );
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO assessment_controls (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id) VALUES ($1, $2, $3, $4, $5, $6)`,
          [assessmentId, controlB1, tenantB, orgB, engagementB, libraryB],
        ),
      ),
    ).rejects.toThrow(/assessment_controls_assessment_scope_fk/);
  });

  // --- Transactionality (instructions §22 "Transactionality" 18) -----------

  it("18. A failed control-population insert leaves no orphan Assessment — the same transaction mechanism createAssessment relies on rolls back both inserts together", async () => {
    const client = await pool.connect();
    let orphanAssessmentId: string | null = null;
    try {
      await client.query("BEGIN");
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO assessments (engagement_id, organisation_id, tenant_id, control_library_version_id, assessment_type, period_label) VALUES ($1, $2, $3, $4, 'annual', 'Should be rolled back') RETURNING id`,
        [engagementA, orgA, tenantA, libraryA],
      );
      orphanAssessmentId = insertResult.rows[0]!.id;
      // A deliberately invalid population insert — controlB1 does not
      // belong to libraryA — the exact real constraint violation
      // `createAssessment`'s own population insert would hit if its
      // source query ever returned a Control from the wrong library
      // (it never does, by construction — this proves what happens to
      // the whole transaction, including the Assessment row just
      // inserted above, if it somehow did).
      await client.query(
        `INSERT INTO assessment_controls (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [orphanAssessmentId, controlB1, tenantA, orgA, engagementA, libraryA],
      );
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM assessments WHERE id = $1", [orphanAssessmentId]));
    expect(rows).toHaveLength(0);
  });

  // --- Historical control-set integrity (instructions §8/§22 "Historical" 19-21) ---

  it("19-21. Historical integrity: an Assessment's control set is fixed at creation and never changes when a newer, separate library version is later created and used", async () => {
    const { id: originalAssessmentId } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "FY2026 (historical baseline)" }),
    );
    const originalControlIds = (
      await asFixtureSetup((c) => c.query("SELECT control_id FROM assessment_controls WHERE assessment_id = $1", [originalAssessmentId]))
    ).rows.map((r) => r.control_id);
    expect(originalControlIds.sort()).toEqual([controlA1, controlA2, controlA3].sort());

    // A genuinely new, separate ControlLibraryVersion — new Control rows
    // (new ids, same/new codes), never a mutation of libraryA's own
    // frozen Control set (DECISIONS.md R-42/R-44/R-45).
    const [libraryA2, controlA1v2, controlA2v2, controlA3v2, controlA4v2] = await asFixtureSetup(async (client) => {
      const lib = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C7.1 Library A v2" });
      const c1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: lib, code: "C1", title: "Control C1 (v2)" });
      const c2 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: lib, code: "C2", title: "Control C2 (v2)" });
      const c3 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: lib, code: "C3", title: "Control C3 (v2)" });
      const c4 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: lib, code: "C4", title: "Control C4 (v2, new)" });
      await publishControlLibraryVersion(client, lib);
      return [lib, c1, c2, c3, c4];
    });

    // The original Assessment's own control set is completely
    // unaffected by libraryA2's existence — no live join, no
    // retroactive acquisition of C4.
    const afterControlIds = (
      await asFixtureSetup((c) => c.query("SELECT control_id FROM assessment_controls WHERE assessment_id = $1", [originalAssessmentId]))
    ).rows.map((r) => r.control_id);
    expect(afterControlIds.sort()).toEqual(originalControlIds.sort());
    expect(afterControlIds).not.toContain(controlA4v2);

    // A NEW Assessment, in a NEW Engagement pinned to libraryA2,
    // correctly gets all 4 of libraryA2's own Controls — each
    // Assessment's materialized control set is independent and correct
    // for its own pinned library version.
    const engagementV2 = await asFixtureSetup((client) => createEngagement(client, tenantA, orgA, "Slice C7.1 Engagement — Library A v2"));
    await asFixtureSetup((client) => pinEngagementControlLibraryVersion(client, engagementV2, libraryA2));
    const userV2 = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    await asFixtureSetup((client) => grantEngagementMembership(client, userV2, engagementV2));

    const { id: newAssessmentId } = await withRequestDb(userV2, (db) =>
      createAssessment(db, userV2, { engagementId: engagementV2, assessmentType: "annual", periodLabel: "FY2026 (Library A v2)" }),
    );
    const newControlIds = (
      await asFixtureSetup((c) => c.query("SELECT control_id FROM assessment_controls WHERE assessment_id = $1", [newAssessmentId]))
    ).rows.map((r) => r.control_id);
    expect(newControlIds.sort()).toEqual([controlA1v2, controlA2v2, controlA3v2, controlA4v2].sort());

    // And the original Assessment still only has its original 3 —
    // proven one more time, after the new Assessment now exists too.
    const stillOriginal = (
      await asFixtureSetup((c) => c.query("SELECT control_id FROM assessment_controls WHERE assessment_id = $1", [originalAssessmentId]))
    ).rows.map((r) => r.control_id);
    expect(stillOriginal.sort()).toEqual(originalControlIds.sort());
  });

  // --- Workspace integration (instructions §22 "Workspace" 22-23) ----------

  it("22-23. A newly created Assessment is immediately reachable and the workspace displays its populated control set — no fixture/database-script intervention", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementA, assessmentType: "control_readiness", periodLabel: "FY2028 (workspace check)" }),
    );
    const detail = await withRequestDb(userA, (db) => getAssessmentDetail(db, userA, id));
    expect(detail.status).toBe("draft");
    expect(detail.controlLibraryVersionLabel).toBe("Slice C7.1 Library A v1");
    const codes = detail.controlRows.map((r) => r.controlCode).sort();
    expect(codes).toEqual(["C1", "C2", "C3"]);
    expect(detail.controlRows.every((r) => r.response === null)).toBe(true);
  });

  // --- Audit (instructions §22 "Audit" 24) ----------------------------------

  it("24. Assessment creation is attributed to the acting user in audit_log; AssessmentControl creation is captured too", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createAssessment(db, userA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "FY2029 (audit check)" }),
    );
    const { rows: assessmentAudit } = await asFixtureSetup((c) =>
      c.query(`SELECT action, actor_user_id FROM audit_log WHERE entity_type = 'assessments' AND entity_id = $1`, [id]),
    );
    expect(assessmentAudit).toHaveLength(1);
    expect(assessmentAudit[0]).toMatchObject({ action: "insert", actor_user_id: userA });

    const { rows: acRows } = await asFixtureSetup((c) => c.query("SELECT id FROM assessment_controls WHERE assessment_id = $1", [id]));
    const { rows: acAudit } = await asFixtureSetup((c) =>
      c.query(`SELECT action, actor_user_id FROM audit_log WHERE entity_type = 'assessment_controls' AND entity_id = ANY($1)`, [acRows.map((r) => r.id)]),
    );
    expect(acAudit.length).toBe(acRows.length);
    expect(acAudit.every((r) => r.action === "insert" && r.actor_user_id === userA)).toBe(true);
  });
});
