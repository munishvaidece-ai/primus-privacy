// Slice D1 — Control Library Authoring. Tests the real domain functions
// (lib/domain/control-library.ts) and the new `methodology.manage`
// permission (lib/authorization/service.ts) against real PostgreSQL —
// no mocked authorization, no mocked database. Covers instructions
// §15's full checklist: authorization, draft lifecycle, publishing,
// versioning, Assessment integrity, and tenant isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
  createRegulatoryReference,
  createRequirement,
  createControlLibraryVersion as createControlLibraryVersionFixture,
  publishControlLibraryVersion as publishControlLibraryVersionFixture,
  createControl as createControlFixture,
  linkControlRequirement,
  pinEngagementControlLibraryVersion,
  pool,
} from "./helpers";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createRegulatoryReference as createRegulatoryReferenceDomain,
  createRequirement as createRequirementDomain,
  createControlLibraryVersion,
  cloneControlLibraryVersion,
  publishControlLibraryVersion,
  createControl,
  updateControl,
  deleteControl,
  associateControlRequirement,
  dissociateControlRequirement,
  listControlLibraryVersions,
  getControlLibraryVersionDetail,
  getControlDetail,
  ControlLibraryVersionNotDraftError,
  ControlLibraryVersionNotPublishedError,
  DuplicateVersionLabelError,
  DuplicateControlCodeError,
  CrossTenantAssociationError,
  InvalidControlLibraryInputError,
} from "@/lib/domain/control-library";
import { createAssessment, getAssessmentDetail } from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError, canManageMethodology } from "@/lib/authorization/service";

describe("Application layer — Control Library Authoring (Slice D1)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgB: string;
  let engagementA: string;

  let userPracticePartnerA: string; // Practice Partner, tenantA — holds methodology.manage
  let userPlatformAdminA: string; // Platform Administrator, tenantA — holds methodology.manage
  let userNoPermTenantA: string; // active TenantMembership, tenantA, but a role with NO permissions
  let userEngManagerA: string; // Engagement Manager on engagementA — no TenantMembership at all
  let userClientAdminA: string; // Client Administrator on orgA (OrganisationMembership) — client-side, no TenantMembership
  let userPracticePartnerB: string; // Practice Partner, tenantB — for cross-tenant tests

  let libraryARegRefId: string;
  let libraryARequirementId: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice D1 Tenant A");
      tenantB = await createTenant(client, "Slice D1 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice D1 Org A");
      orgB = await createOrganisation(client, tenantB, "Slice D1 Org B");
      engagementA = await createEngagement(client, tenantA, orgA, "Slice D1 Engagement A");

      userPracticePartnerA = await createUser(client, { tenantId: tenantA });
      await grantTenantMembership(client, userPracticePartnerA, tenantA, "Practice Partner");

      userPlatformAdminA = await createUser(client, { tenantId: tenantA });
      await grantTenantMembership(client, userPlatformAdminA, tenantA, "Platform Administrator");

      userNoPermTenantA = await createUser(client, { tenantId: tenantA });
      const { rows: roleRows } = await client.query<{ id: string }>(
        `INSERT INTO roles (name, scope) VALUES ('D1 No-Permission Tenant Role (test)', 'tenant') RETURNING id`,
      );
      await client.query(`INSERT INTO tenant_memberships (user_id, tenant_id, role_id) VALUES ($1, $2, $3)`, [
        userNoPermTenantA,
        tenantA,
        roleRows[0]!.id,
      ]);

      userEngManagerA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userEngManagerA, engagementA, "Engagement Manager");

      userClientAdminA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, userClientAdminA, orgA, "Client Administrator");

      userPracticePartnerB = await createUser(client, { tenantId: tenantB });
      await grantTenantMembership(client, userPracticePartnerB, tenantB, "Practice Partner");

      // Baseline regulatory content for tenantA, built via raw fixture
      // (not the function under test) — matches every other test
      // file's own "fixture vs. system under test" separation.
      libraryARegRefId = await createRegulatoryReference(client, {
        tenantId: tenantA,
        citation: "D1 test citation",
        title: "D1 test regulatory reference",
      });
      libraryARequirementId = await createRequirement(client, {
        tenantId: tenantA,
        primaryRegulatoryReferenceId: libraryARegRefId,
        title: "D1 test requirement",
      });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // === Authorization (instructions §15) ====================================

  it("1. An authorized methodology user (Practice Partner) can create a control library version", async () => {
    const { id } = await withRequestDb(userPracticePartnerA, (db) =>
      createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Authz Test — Practice Partner creates" }),
    );
    expect(id).toBeTruthy();
  });

  it("Platform Administrator (the other Tenant-scope role) can also create", async () => {
    const { id } = await withRequestDb(userPlatformAdminA, (db) =>
      createControlLibraryVersion(db, userPlatformAdminA, { versionLabel: "D1 Authz Test — Platform Admin creates" }),
    );
    expect(id).toBeTruthy();
  });

  it("canManageMethodology is true for Practice Partner/Platform Administrator and false for a tenant member with no methodology.manage grant", async () => {
    expect(await withRequestDb(userPracticePartnerA, (db) => canManageMethodology(db, userPracticePartnerA, tenantA))).toBe(true);
    expect(await withRequestDb(userPlatformAdminA, (db) => canManageMethodology(db, userPlatformAdminA, tenantA))).toBe(true);
    expect(await withRequestDb(userNoPermTenantA, (db) => canManageMethodology(db, userNoPermTenantA, tenantA))).toBe(false);
  });

  it("2. An active Tenant member whose Role grants no methodology.manage permission cannot create", async () => {
    await expect(
      withRequestDb(userNoPermTenantA, (db) => createControlLibraryVersion(db, userNoPermTenantA, { versionLabel: "D1 Should Not Be Created (no-perm)" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("3. An unauthorized user with no TenantMembership at all (Engagement Manager only) cannot create", async () => {
    await expect(
      withRequestDb(userEngManagerA, (db) => createControlLibraryVersion(db, userEngManagerA, { versionLabel: "D1 Should Not Be Created (eng manager)" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4. A client-side user (Client Administrator) cannot author methodology", async () => {
    await expect(
      withRequestDb(userClientAdminA, (db) => createControlLibraryVersion(db, userClientAdminA, { versionLabel: "D1 Should Not Be Created (client admin)" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("5. Tenant B's Practice Partner cannot author Tenant A's methodology, or vice versa", async () => {
    const { id: versionA } = await withRequestDb(userPracticePartnerA, (db) =>
      createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Cross-Tenant Guard — A's own version" }),
    );
    await expect(
      withRequestDb(userPracticePartnerB, (db) => createControl(db, userPracticePartnerB, { controlLibraryVersionId: versionA, code: "X1", title: "Should fail", description: null, controlType: "preventive" })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // === Draft lifecycle =======================================================

  it("6. A draft version's Control can be created, and edited while still draft", async () => {
    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Draft Lifecycle Test" }));
    const { id: controlId } = await withRequestDb(userPracticePartnerA, (db) =>
      createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "DL-01", title: "Original title", description: "Original description", controlType: "preventive" }),
    );

    await withRequestDb(userPracticePartnerA, (db) =>
      updateControl(db, userPracticePartnerA, { controlId, code: "DL-01", title: "Edited title", description: "Edited description", controlType: "detective" }),
    );

    const detail = await withRequestDb(userPracticePartnerA, (db) => getControlDetail(db, userPracticePartnerA, controlId));
    expect(detail).toMatchObject({ title: "Edited title", description: "Edited description", controlType: "detective" });
  });

  it("7. Requirement association works, and idempotently re-associating is a no-op success", async () => {
    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Requirement Association Test" }));
    const { id: controlId } = await withRequestDb(userPracticePartnerA, (db) =>
      createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "RA-01", title: "Control for association test", description: null, controlType: "preventive" }),
    );

    const first = await withRequestDb(userPracticePartnerA, (db) => associateControlRequirement(db, userPracticePartnerA, { controlId, requirementId: libraryARequirementId }));
    const second = await withRequestDb(userPracticePartnerA, (db) => associateControlRequirement(db, userPracticePartnerA, { controlId, requirementId: libraryARequirementId }));
    expect(second.id).toBe(first.id);

    const detail = await withRequestDb(userPracticePartnerA, (db) => getControlDetail(db, userPracticePartnerA, controlId));
    expect(detail.requirements).toHaveLength(1);
    expect(detail.requirements[0]!.id).toBe(libraryARequirementId);

    await withRequestDb(userPracticePartnerA, (db) => dissociateControlRequirement(db, userPracticePartnerA, { controlId, requirementId: libraryARequirementId }));
    const afterRemove = await withRequestDb(userPracticePartnerA, (db) => getControlDetail(db, userPracticePartnerA, controlId));
    expect(afterRemove.requirements).toHaveLength(0);
  });

  it("8. A cross-tenant association is rejected with a clean error", async () => {
    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Cross-Tenant Association Test" }));
    const { id: controlId } = await withRequestDb(userPracticePartnerA, (db) =>
      createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "XT-01", title: "Control A", description: null, controlType: "preventive" }),
    );

    const tenantBRegRefId = await asFixtureSetup((c) => createRegulatoryReference(c, { tenantId: tenantB, citation: "Tenant B citation", title: "Tenant B reference" }));
    const tenantBRequirementId = await asFixtureSetup((c) => createRequirement(c, { tenantId: tenantB, primaryRegulatoryReferenceId: tenantBRegRefId, title: "Tenant B requirement" }));

    await expect(
      withRequestDb(userPracticePartnerA, (db) => associateControlRequirement(db, userPracticePartnerA, { controlId, requirementId: tenantBRequirementId })),
    ).rejects.toThrow(CrossTenantAssociationError);
  });

  it("Duplicate control code within the same version is rejected; duplicate version label within the same tenant is rejected", async () => {
    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Duplicate Guard Test" }));
    await withRequestDb(userPracticePartnerA, (db) => createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "DUP-01", title: "First", description: null, controlType: "preventive" }));
    await expect(
      withRequestDb(userPracticePartnerA, (db) => createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "DUP-01", title: "Second", description: null, controlType: "preventive" })),
    ).rejects.toThrow(DuplicateControlCodeError);

    await expect(
      withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Duplicate Guard Test" })),
    ).rejects.toThrow(DuplicateVersionLabelError);
  });

  it("Empty/whitespace-only input is rejected server-side (version label, control code, control title)", async () => {
    await expect(withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "   " }))).rejects.toThrow(InvalidControlLibraryInputError);

    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Empty Input Guard Test" }));
    await expect(
      withRequestDb(userPracticePartnerA, (db) => createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "", title: "Has a title", description: null, controlType: "preventive" })),
    ).rejects.toThrow(InvalidControlLibraryInputError);
  });

  // === Publishing =============================================================

  it("9. A valid draft can publish", async () => {
    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Publish Happy Path Test" }));
    await withRequestDb(userPracticePartnerA, (db) => createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "PUB-01", title: "Publishable control", description: null, controlType: "preventive" }));

    await withRequestDb(userPracticePartnerA, (db) => publishControlLibraryVersion(db, userPracticePartnerA, { versionId }));

    const detail = await withRequestDb(userPracticePartnerA, (db) => getControlLibraryVersionDetail(db, userPracticePartnerA, versionId));
    expect(detail.status).toBe("published");
    expect(detail.publishedAt).toBeTruthy();
  });

  it("A version with zero Controls can still publish — no invented minimum-controls rule", async () => {
    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Publish Zero Controls Test" }));
    await withRequestDb(userPracticePartnerA, (db) => publishControlLibraryVersion(db, userPracticePartnerA, { versionId }));
    const detail = await withRequestDb(userPracticePartnerA, (db) => getControlLibraryVersionDetail(db, userPracticePartnerA, versionId));
    expect(detail.status).toBe("published");
  });

  it("10. Publishing an already-published (non-draft) version is rejected", async () => {
    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Double Publish Guard Test" }));
    await withRequestDb(userPracticePartnerA, (db) => publishControlLibraryVersion(db, userPracticePartnerA, { versionId }));
    await expect(withRequestDb(userPracticePartnerA, (db) => publishControlLibraryVersion(db, userPracticePartnerA, { versionId }))).rejects.toThrow(ControlLibraryVersionNotDraftError);
  });

  it("11. A published version's own Controls cannot be edited, created, or deleted (domain layer)", async () => {
    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Published Immutability — Domain Layer Test" }));
    const { id: controlId } = await withRequestDb(userPracticePartnerA, (db) => createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "IMM-01", title: "Immutable-to-be", description: null, controlType: "preventive" }));
    await withRequestDb(userPracticePartnerA, (db) => publishControlLibraryVersion(db, userPracticePartnerA, { versionId }));

    await expect(
      withRequestDb(userPracticePartnerA, (db) => updateControl(db, userPracticePartnerA, { controlId, code: "IMM-01", title: "Attempted edit", description: null, controlType: "preventive" })),
    ).rejects.toThrow(ControlLibraryVersionNotDraftError);
    await expect(
      withRequestDb(userPracticePartnerA, (db) => createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "IMM-02", title: "Should not be creatable", description: null, controlType: "preventive" })),
    ).rejects.toThrow(ControlLibraryVersionNotDraftError);
    await expect(withRequestDb(userPracticePartnerA, (db) => deleteControl(db, userPracticePartnerA, { controlId }))).rejects.toThrow(ControlLibraryVersionNotDraftError);
  });

  it("Published-version immutability is real at the RAW SQL / trigger layer too, independently of the domain function", async () => {
    const versionId = await asFixtureSetup((c) => createControlLibraryVersionFixture(c, { tenantId: tenantA, versionLabel: "D1 Published Immutability — Raw SQL Test" }));
    const controlId = await asFixtureSetup((c) => createControlFixture(c, { tenantId: tenantA, controlLibraryVersionId: versionId, code: "RAW-01", title: "Raw SQL immutability test" }));
    await asFixtureSetup((c) => publishControlLibraryVersionFixture(c, versionId));

    await expect(asFixtureSetup((c) => c.query(`UPDATE controls SET title = 'tampered' WHERE id = $1`, [controlId]))).rejects.toThrow();
    await expect(asFixtureSetup((c) => c.query(`DELETE FROM controls WHERE id = $1`, [controlId]))).rejects.toThrow();
    await expect(
      asFixtureSetup((c) => c.query(`INSERT INTO control_requirements (tenant_id, control_id, requirement_id) VALUES ($1, $2, $3)`, [tenantA, controlId, libraryARequirementId])),
    ).rejects.toThrow();
  });

  it("12. Published associations cannot be modified (domain layer)", async () => {
    const { id: versionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Published Association Immutability Test" }));
    const { id: controlId } = await withRequestDb(userPracticePartnerA, (db) => createControl(db, userPracticePartnerA, { controlLibraryVersionId: versionId, code: "ASSOC-01", title: "Control for association immutability", description: null, controlType: "preventive" }));
    await withRequestDb(userPracticePartnerA, (db) => associateControlRequirement(db, userPracticePartnerA, { controlId, requirementId: libraryARequirementId }));
    await withRequestDb(userPracticePartnerA, (db) => publishControlLibraryVersion(db, userPracticePartnerA, { versionId }));

    await expect(
      withRequestDb(userPracticePartnerA, (db) => dissociateControlRequirement(db, userPracticePartnerA, { controlId, requirementId: libraryARequirementId })),
    ).rejects.toThrow(ControlLibraryVersionNotDraftError);
  });

  // === Versioning ==============================================================

  it("13-15. Cloning a published version creates a new DRAFT with copied Controls/associations, and the published source remains completely unchanged", async () => {
    const { id: sourceVersionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Clone Source Test v1.0" }));
    const { id: sourceControlId } = await withRequestDb(userPracticePartnerA, (db) =>
      createControl(db, userPracticePartnerA, { controlLibraryVersionId: sourceVersionId, code: "CLONE-01", title: "Original control", description: "Original description", controlType: "preventive" }),
    );
    await withRequestDb(userPracticePartnerA, (db) => associateControlRequirement(db, userPracticePartnerA, { controlId: sourceControlId, requirementId: libraryARequirementId }));
    await withRequestDb(userPracticePartnerA, (db) => publishControlLibraryVersion(db, userPracticePartnerA, { versionId: sourceVersionId }));

    const { id: newVersionId } = await withRequestDb(userPracticePartnerA, (db) =>
      cloneControlLibraryVersion(db, userPracticePartnerA, { sourceVersionId, newVersionLabel: "D1 Clone Source Test v2.0" }),
    );
    expect(newVersionId).not.toBe(sourceVersionId);

    // 14. new version starts as draft
    const newDetail = await withRequestDb(userPracticePartnerA, (db) => getControlLibraryVersionDetail(db, userPracticePartnerA, newVersionId));
    expect(newDetail.status).toBe("draft");
    expect(newDetail.controlRows).toHaveLength(1);
    const clonedControl = newDetail.controlRows[0]!;
    expect(clonedControl.id).not.toBe(sourceControlId); // fresh id — never migrates between versions
    expect(clonedControl.code).toBe("CLONE-01");
    expect(clonedControl.title).toBe("Original control");
    expect(clonedControl.requirements).toHaveLength(1);
    expect(clonedControl.requirements[0]!.id).toBe(libraryARequirementId); // same Requirement row reused, not duplicated

    // 15. changes to the new draft do not affect the published source
    await withRequestDb(userPracticePartnerA, (db) =>
      updateControl(db, userPracticePartnerA, { controlId: clonedControl.id, code: "CLONE-01", title: "Edited in v2.0 only", description: "Edited", controlType: "corrective" }),
    );
    const sourceAfter = await withRequestDb(userPracticePartnerA, (db) => getControlLibraryVersionDetail(db, userPracticePartnerA, sourceVersionId));
    expect(sourceAfter.controlRows[0]).toMatchObject({ id: sourceControlId, title: "Original control", description: "Original description", controlType: "preventive" });
  });

  it("Cloning a DRAFT (not yet published) version is rejected", async () => {
    const { id: draftVersionId } = await withRequestDb(userPracticePartnerA, (db) => createControlLibraryVersion(db, userPracticePartnerA, { versionLabel: "D1 Clone-A-Draft Guard Test" }));
    await expect(
      withRequestDb(userPracticePartnerA, (db) => cloneControlLibraryVersion(db, userPracticePartnerA, { sourceVersionId: draftVersionId, newVersionLabel: "D1 Should Not Be Creatable" })),
    ).rejects.toThrow(ControlLibraryVersionNotPublishedError);
  });

  // === Assessment integrity (instructions §9/§16 step 10-11) ================

  it("16. An existing Assessment remains pinned to its original library version after a new version is published from it; controls never cross library boundaries", async () => {
    const versionId = await asFixtureSetup((c) => createControlLibraryVersionFixture(c, { tenantId: tenantA, versionLabel: "D1 Assessment Pin Integrity v1.0" }));
    const controlId = await asFixtureSetup((c) => createControlFixture(c, { tenantId: tenantA, controlLibraryVersionId: versionId, code: "PIN-01", title: "Pinned control" }));
    await asFixtureSetup((c) => publishControlLibraryVersionFixture(c, versionId));
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, engagementA, versionId));

    const { id: assessmentId } = await withRequestDb(userEngManagerA, (db) => createAssessment(db, userEngManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "D1 Assessment Pin Test" }));
    const detailBefore = await withRequestDb(userEngManagerA, (db) => getAssessmentDetail(db, userEngManagerA, assessmentId));
    expect(detailBefore.controlLibraryVersionId).toBe(versionId);
    expect(detailBefore.controlRows).toHaveLength(1);
    expect(detailBefore.controlRows[0]!.controlId).toBe(controlId);

    // Publishing a NEW version (cloned from the pinned one) must not
    // touch the Engagement's pin or the Assessment's already-populated
    // AssessmentControls in any way.
    const { id: newVersionId } = await withRequestDb(userPracticePartnerA, (db) =>
      cloneControlLibraryVersion(db, userPracticePartnerA, { sourceVersionId: versionId, newVersionLabel: "D1 Assessment Pin Integrity v2.0" }),
    );
    await withRequestDb(userPracticePartnerA, (db) => publishControlLibraryVersion(db, userPracticePartnerA, { versionId: newVersionId }));

    const detailAfter = await withRequestDb(userEngManagerA, (db) => getAssessmentDetail(db, userEngManagerA, assessmentId));
    expect(detailAfter.controlLibraryVersionId).toBe(versionId); // unchanged
    expect(detailAfter.controlRows).toHaveLength(1);
    expect(detailAfter.controlRows[0]!.controlId).toBe(controlId); // still the ORIGINAL control, not the v2.0 clone

    // The Engagement's own pin is immutable regardless (pre-existing
    // migration 0007 trigger, re-verified live here) — a second attempt
    // to pin the new version is rejected.
    await expect(asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, engagementA, newVersionId))).rejects.toThrow();

    // The v2.0 clone's own control is a genuinely different row —
    // never reachable from engagementA's Assessment.
    const newVersionDetail = await withRequestDb(userPracticePartnerA, (db) => getControlLibraryVersionDetail(db, userPracticePartnerA, newVersionId));
    expect(newVersionDetail.controlRows[0]!.id).not.toBe(controlId);
  });

  // === Tenant isolation — direct at the DB/security boundary ================

  it("17. A raw SQL write by a Tenant member without methodology.manage is rejected by RLS directly, independently of the domain function", async () => {
    const versionId = await asFixtureSetup((c) => createControlLibraryVersionFixture(c, { tenantId: tenantA, versionLabel: "D1 RLS Direct Test" }));

    // UPDATE: the narrowed policy's own USING clause (not just WITH
    // CHECK) already excludes this row from the unauthorized caller's
    // visibility, so Postgres reports 0 rows affected rather than a
    // thrown "row-level security" error (that error shape is what a
    // WITH-CHECK-only rejection on an otherwise-visible row looks
    // like — not the case here, since USING and WITH CHECK share the
    // exact same `has_tenant_permission` check). Either shape is a
    // real, independent RLS rejection; asserted here by confirming the
    // row was genuinely never modified.
    const updateResult = await asUser(userNoPermTenantA, (c) => c.query(`UPDATE control_library_versions SET version_label = 'tampered' WHERE id = $1`, [versionId]));
    expect(updateResult.rowCount).toBe(0);
    const { rows: afterUpdate } = await asFixtureSetup((c) => c.query(`SELECT version_label FROM control_library_versions WHERE id = $1`, [versionId]));
    expect(afterUpdate[0]).toMatchObject({ version_label: "D1 RLS Direct Test" });

    // INSERT has no prior row to filter via USING — WITH CHECK failing
    // here is a genuine, thrown row-level-security violation.
    await expect(
      asUser(userNoPermTenantA, (c) => c.query(`INSERT INTO controls (tenant_id, control_library_version_id, code, title, control_type) VALUES ($1, $2, 'RLS-01', 'Should be rejected', 'preventive')`, [tenantA, versionId])),
    ).rejects.toThrow(/row-level security/i);
  });

  it("18. Tenant B genuinely cannot see Tenant A's methodology at all (SELECT), and Tenant A's methodology never leaks across the boundary", async () => {
    const versionId = await asFixtureSetup((c) => createControlLibraryVersionFixture(c, { tenantId: tenantA, versionLabel: "D1 Read-Isolation Test" }));
    const { rows } = await asUser(userPracticePartnerB, (c) => c.query(`SELECT id FROM control_library_versions WHERE id = $1`, [versionId]));
    expect(rows).toHaveLength(0);

    await expect(
      withRequestDb(userPracticePartnerB, (db) => getControlLibraryVersionDetail(db, userPracticePartnerB, versionId)),
    ).rejects.toThrow(NotFoundOrForbiddenError);

    const versionsForB = await withRequestDb(userPracticePartnerB, (db) => listControlLibraryVersions(db, userPracticePartnerB));
    expect(versionsForB.some((v) => v.id === versionId)).toBe(false);
  });

  it("Anonymous (unauthenticated) caller cannot read or write methodology content", async () => {
    const versionId = await asFixtureSetup((c) => createControlLibraryVersionFixture(c, { tenantId: tenantA, versionLabel: "D1 Anon Guard Test" }));
    // `anon` holds no GRANT at all on these tables (migration 0007's own
    // `REVOKE ALL ... FROM PUBLIC, anon`, unchanged by this slice) — the
    // rejection happens at the table-privilege layer, before row-level
    // security is even evaluated, so both the SELECT and the UPDATE
    // throw outright rather than silently returning/affecting zero rows.
    await expect(asAnon((c) => c.query(`SELECT id FROM control_library_versions WHERE id = $1`, [versionId]))).rejects.toThrow(/permission denied/i);
    await expect(asAnon((c) => c.query(`UPDATE control_library_versions SET version_label = 'tampered' WHERE id = $1`, [versionId]))).rejects.toThrow(/permission denied/i);
  });

  // --- createRegulatoryReference/createRequirement (always-editable,
  // non-lifecycle-gated content — DECISIONS.md R-44) ------------------------

  it("Regulatory reference and requirement creation both require methodology.manage and are tenant-scoped", async () => {
    const { id: refId } = await withRequestDb(userPracticePartnerA, (db) =>
      createRegulatoryReferenceDomain(db, userPracticePartnerA, { frameworkName: "D1 Test Framework", citation: "D1-CITE-01", title: "D1 domain-created reference", version: "1.0" }),
    );
    expect(refId).toBeTruthy();

    await expect(
      withRequestDb(userNoPermTenantA, (db) => createRegulatoryReferenceDomain(db, userNoPermTenantA, { frameworkName: "Should fail", citation: "x", title: "x", version: null })),
    ).rejects.toThrow(NotFoundOrForbiddenError);

    const { id: reqId } = await withRequestDb(userPracticePartnerA, (db) =>
      createRequirementDomain(db, userPracticePartnerA, { primaryRegulatoryReferenceId: refId, title: "D1 domain-created requirement", description: null }),
    );
    expect(reqId).toBeTruthy();

    // Cross-tenant: Tenant B cannot create a Requirement against
    // Tenant A's RegulatoryReference.
    await expect(
      withRequestDb(userPracticePartnerB, (db) => createRequirementDomain(db, userPracticePartnerB, { primaryRegulatoryReferenceId: refId, title: "Should fail cross-tenant", description: null })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });
});
