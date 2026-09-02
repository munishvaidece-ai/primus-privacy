// Slice D2 — Data Landscape / Processing Activities / ROPA. Tests the
// real domain functions (lib/domain/master-data.ts,
// lib/domain/processing-activities.ts) against real PostgreSQL — no
// mocked authorization, no mocked database. Covers instructions §18's
// checklist: Processing Activity CRUD, relationships, authorization,
// versioning/historical integrity, and ROPA.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantTenantMembership,
  grantOrganisationMembership,
  grantEngagementMembership,
  pool,
} from "./helpers";
import { withRequestDb } from "@/lib/db/request-client";
import {
  listBusinessUnits,
  createBusinessUnit,
  updateBusinessUnit,
  listSystems,
  createSystem,
  createSystemVersion,
  retireSystem,
  listProcessors,
  createProcessor,
  listPurposes,
  createPurpose,
  listDataPrincipalCategories,
  createDataPrincipalCategory,
  listPersonalDataElements,
  createPersonalDataElement,
  listDataStores,
  createDataStore,
  InvalidMasterDataInputError,
  CrossOrganisationReferenceError,
} from "@/lib/domain/master-data";
import {
  createProcessingActivity,
  updateProcessingActivity,
  getProcessingActivityDetail,
  listProcessingActivities,
  listRopaEntries,
  linkSystem,
  unlinkSystem,
  linkPurpose,
  linkProcessor,
  linkDataStore,
  linkDataPrincipalCategory,
  linkPersonalDataElement,
  carryForwardProcessingActivity,
  CrossScopeReferenceError,
  DuplicateLinkError,
} from "@/lib/domain/processing-activities";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";

describe("Application layer — Data Landscape / Processing Activities / ROPA (Slice D2)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgB: string;
  let engagementA: string, engagementA2: string, engagementB: string;

  let userOrgMemberA: string; // OrganisationMembership on orgA — can manage master data & PAs under orgA
  let userEngMemberA: string; // EngagementMembership on engagementA only
  let userTenantOnlyA: string; // TenantMembership on tenantA only — no org/engagement access
  let userOrgMemberB: string; // OrganisationMembership on orgB — cross-tenant isolation

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice D2 Tenant A");
      tenantB = await createTenant(client, "Slice D2 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice D2 Org A");
      orgB = await createOrganisation(client, tenantB, "Slice D2 Org B");
      engagementA = await createEngagement(client, tenantA, orgA, "Slice D2 Engagement A — FY2026");
      engagementA2 = await createEngagement(client, tenantA, orgA, "Slice D2 Engagement A — FY2027");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice D2 Engagement B");

      userOrgMemberA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, userOrgMemberA, orgA, "Client Administrator");

      userEngMemberA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userEngMemberA, engagementA, "Engagement Manager");

      userTenantOnlyA = await createUser(client, { tenantId: tenantA });
      await grantTenantMembership(client, userTenantOnlyA, tenantA, "Practice Partner");

      userOrgMemberB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantOrganisationMembership(client, userOrgMemberB, orgB, "Client Administrator");
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Master Data (organisation-level) -----------------------------------

  describe("Master data — organisation-level, versioned (SCD2)", () => {
    it("an authorized org member can create and list Business Units (no version table)", async () => {
      const { id } = await withRequestDb(userOrgMemberA, (db) =>
        createBusinessUnit(db, userOrgMemberA, orgA, { name: "D2 Retail Banking", parentBusinessUnitId: null }),
      );
      const list = await withRequestDb(userOrgMemberA, (db) => listBusinessUnits(db, userOrgMemberA, orgA));
      expect(list.some((bu) => bu.id === id && bu.name === "D2 Retail Banking")).toBe(true);
    });

    it("editing a Business Unit is a direct in-place update — not version-pinned", async () => {
      const { id } = await withRequestDb(userOrgMemberA, (db) =>
        createBusinessUnit(db, userOrgMemberA, orgA, { name: "D2 BU Before Edit", parentBusinessUnitId: null }),
      );
      await withRequestDb(userOrgMemberA, (db) =>
        updateBusinessUnit(db, userOrgMemberA, { businessUnitId: id, name: "D2 BU After Edit", parentBusinessUnitId: null, status: "active" }),
      );
      const list = await withRequestDb(userOrgMemberA, (db) => listBusinessUnits(db, userOrgMemberA, orgA));
      const row = list.find((bu) => bu.id === id);
      expect(row?.name).toBe("D2 BU After Edit");
    });

    it("creating a System inserts an identity row and its first current version", async () => {
      const { id } = await withRequestDb(userOrgMemberA, (db) =>
        createSystem(db, userOrgMemberA, orgA, { name: "D2 Core Banking System", owner: "IT", hostingEnvironment: "AWS ap-south-1" }),
      );
      const list = await withRequestDb(userOrgMemberA, (db) => listSystems(db, userOrgMemberA, orgA));
      const row = list.find((s) => s.id === id);
      expect(row?.name).toBe("D2 Core Banking System");
      expect(row?.status).toBe("active");
    });

    it("creating a new System version closes out the old one — never rewrites it", async () => {
      const { id } = await withRequestDb(userOrgMemberA, (db) =>
        createSystem(db, userOrgMemberA, orgA, { name: "D2 CRM v1", owner: "Sales Ops", hostingEnvironment: "On-prem" }),
      );
      const before = await withRequestDb(userOrgMemberA, (db) => listSystems(db, userOrgMemberA, orgA));
      const v1 = before.find((s) => s.id === id)!;

      await withRequestDb(userOrgMemberA, (db) =>
        createSystemVersion(db, userOrgMemberA, { systemId: id, name: "D2 CRM v2 (re-platformed)", owner: "Sales Ops", hostingEnvironment: "AWS" }),
      );
      const after = await withRequestDb(userOrgMemberA, (db) => listSystems(db, userOrgMemberA, orgA));
      const v2 = after.find((s) => s.id === id)!;

      expect(v2.currentVersionId).not.toBe(v1.currentVersionId);
      expect(v2.name).toBe("D2 CRM v2 (re-platformed)");

      // The old version row itself is untouched — a direct raw read
      // (not the domain layer, which only ever surfaces the current
      // version) proves it, matching this codebase's own "prove
      // history is preserved by reading it back" convention.
      const { rows } = await pool.query(`SELECT name, is_current, valid_to FROM system_versions WHERE id = $1`, [v1.currentVersionId]);
      expect(rows[0].name).toBe("D2 CRM v1");
      expect(rows[0].is_current).toBe(false);
      expect(rows[0].valid_to).not.toBeNull();
    });

    it("retiring a System keeps its identity row (never hard-deleted)", async () => {
      const { id } = await withRequestDb(userOrgMemberA, (db) =>
        createSystem(db, userOrgMemberA, orgA, { name: "D2 Legacy System", owner: null, hostingEnvironment: null }),
      );
      await withRequestDb(userOrgMemberA, (db) => retireSystem(db, userOrgMemberA, { systemId: id }));
      const list = await withRequestDb(userOrgMemberA, (db) => listSystems(db, userOrgMemberA, orgA));
      expect(list.find((s) => s.id === id)?.status).toBe("retired");
    });

    it("rejects an empty name", async () => {
      await expect(
        withRequestDb(userOrgMemberA, (db) => createPurpose(db, userOrgMemberA, orgA, { name: "   ", description: null })),
      ).rejects.toThrow(InvalidMasterDataInputError);
    });

    it("a Business Unit cannot be assigned a parent from another organisation", async () => {
      const { id: foreignBuId } = await withRequestDb(userOrgMemberB, (db) =>
        createBusinessUnit(db, userOrgMemberB, orgB, { name: "D2 Org B BU", parentBusinessUnitId: null }),
      );
      await expect(
        withRequestDb(userOrgMemberA, (db) =>
          createBusinessUnit(db, userOrgMemberA, orgA, { name: "D2 Should Fail", parentBusinessUnitId: foreignBuId }),
        ),
      ).rejects.toThrow(CrossOrganisationReferenceError);
    });

    it("authorization: an engagement-only member of orgA's own engagement can also manage orgA's master data (canAccessOrganisation's own engagement-membership fallback)", async () => {
      const { id } = await withRequestDb(userEngMemberA, (db) =>
        createPurpose(db, userEngMemberA, orgA, { name: "D2 Purpose via Engagement Member", description: null }),
      );
      expect(id).toBeTruthy();
    });

    it("authorization: a tenant-only member (no org/engagement membership) cannot manage master data — no implicit cross-client access", async () => {
      await expect(
        withRequestDb(userTenantOnlyA, (db) =>
          createPurpose(db, userTenantOnlyA, orgA, { name: "D2 Should Not Be Created", description: null }),
        ),
      ).rejects.toThrow(NotFoundOrForbiddenError);
    });

    it("tenant isolation: an org B member cannot read or write org A's master data", async () => {
      await expect(withRequestDb(userOrgMemberB, (db) => listSystems(db, userOrgMemberB, orgA))).rejects.toThrow(NotFoundOrForbiddenError);
      await expect(
        withRequestDb(userOrgMemberB, (db) => createSystem(db, userOrgMemberB, orgA, { name: "Should fail", owner: null, hostingEnvironment: null })),
      ).rejects.toThrow(NotFoundOrForbiddenError);
    });

    it("tenant isolation: a forged organisationId on a version-create call is rejected (identity row's real org, not the caller's claim, decides access)", async () => {
      const { id: sysId } = await withRequestDb(userOrgMemberA, (db) =>
        createSystem(db, userOrgMemberA, orgA, { name: "D2 Forgery Target", owner: null, hostingEnvironment: null }),
      );
      await expect(
        withRequestDb(userOrgMemberB, (db) => createSystemVersion(db, userOrgMemberB, { systemId: sysId, name: "Forged", owner: null, hostingEnvironment: null })),
      ).rejects.toThrow(NotFoundOrForbiddenError);
    });

    it("RLS itself rejects a direct raw cross-organisation SELECT (belt-and-suspenders, independent of the application layer)", async () => {
      const { id: sysId } = await withRequestDb(userOrgMemberA, (db) =>
        createSystem(db, userOrgMemberA, orgA, { name: "D2 RLS Direct Check", owner: null, hostingEnvironment: null }),
      );
      const rows = await asUser(userOrgMemberB, (client) => client.query(`SELECT id FROM systems WHERE id = $1`, [sysId]));
      expect(rows.rows.length).toBe(0);
    });
  });

  // --- Processing Activities & ROPA (engagement-level) --------------------

  describe("Processing Activities, relationships, and ROPA — engagement-level", () => {
    let sysId: string;
    let processorId: string;
    let purposeId: string;
    let dpcId: string;
    let pdeId: string;
    let dataStoreId: string;

    beforeAll(async () => {
      sysId = (await withRequestDb(userOrgMemberA, (db) => createSystem(db, userOrgMemberA, orgA, { name: "D2 PA System", owner: null, hostingEnvironment: null }))).id;
      processorId = (await withRequestDb(userOrgMemberA, (db) => createProcessor(db, userOrgMemberA, orgA, { name: "D2 PA Processor", dpaVersionLabel: "v1", riskTier: null, parentProcessorId: null }))).id;
      purposeId = (await withRequestDb(userOrgMemberA, (db) => createPurpose(db, userOrgMemberA, orgA, { name: "D2 PA Purpose", description: null }))).id;
      dpcId = (await withRequestDb(userOrgMemberA, (db) => createDataPrincipalCategory(db, userOrgMemberA, orgA, { name: "D2 PA Customers", isChildrenFlag: false, description: null }))).id;
      pdeId = (await withRequestDb(userOrgMemberA, (db) => createPersonalDataElement(db, userOrgMemberA, orgA, { name: "D2 PA Email Address", sensitivityCategory: "general" }))).id;
      dataStoreId = (await withRequestDb(userOrgMemberA, (db) => createDataStore(db, userOrgMemberA, orgA, { name: "D2 PA Data Store", storageType: null, location: null, systemId: null }))).id;
    });

    it("creates a Processing Activity scoped to the engagement, deriving organisation/tenant from the Engagement itself", async () => {
      const { id } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 Customer Onboarding", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: "Consent" }),
      );
      const detail = await withRequestDb(userOrgMemberA, (db) => getProcessingActivityDetail(db, userOrgMemberA, id));
      expect(detail.engagementId).toBe(engagementA);
      expect(detail.organisationId).toBe(orgA);
      expect(detail.lifecycleStatus).toBe("draft");
    });

    it("updates a Processing Activity's own fields", async () => {
      const { id } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 Before Update", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
      );
      await withRequestDb(userOrgMemberA, (db) =>
        updateProcessingActivity(db, userOrgMemberA, { processingActivityId: id, name: "D2 After Update", description: "updated", businessUnitId: null, ownerUserId: null, lifecycleStatus: "active", lawfulBasis: "Contract" }),
      );
      const detail = await withRequestDb(userOrgMemberA, (db) => getProcessingActivityDetail(db, userOrgMemberA, id));
      expect(detail.name).toBe("D2 After Update");
      expect(detail.lifecycleStatus).toBe("active");
    });

    it("links all six relationship categories, each resolved to the current master-data version", async () => {
      const { id } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 Full Relationship Activity", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
      );

      await withRequestDb(userOrgMemberA, (db) => linkSystem(db, userOrgMemberA, { processingActivityId: id, systemId: sysId }));
      await withRequestDb(userOrgMemberA, (db) => linkDataStore(db, userOrgMemberA, { processingActivityId: id, dataStoreId }));
      await withRequestDb(userOrgMemberA, (db) => linkProcessor(db, userOrgMemberA, { processingActivityId: id, processorId, role: "processor" }));
      await withRequestDb(userOrgMemberA, (db) => linkPurpose(db, userOrgMemberA, { processingActivityId: id, purposeId }));
      await withRequestDb(userOrgMemberA, (db) => linkDataPrincipalCategory(db, userOrgMemberA, { processingActivityId: id, dataPrincipalCategoryId: dpcId }));
      await withRequestDb(userOrgMemberA, (db) =>
        linkPersonalDataElement(db, userOrgMemberA, { processingActivityId: id, personalDataElementId: pdeId, sensitivityNote: "test note" }),
      );

      const detail = await withRequestDb(userOrgMemberA, (db) => getProcessingActivityDetail(db, userOrgMemberA, id));
      expect(detail.systems.map((s) => s.systemId)).toContain(sysId);
      expect(detail.dataStores.map((s) => s.dataStoreId)).toContain(dataStoreId);
      expect(detail.processors.map((p) => p.processorId)).toContain(processorId);
      expect(detail.purposes.map((p) => p.purposeId)).toContain(purposeId);
      expect(detail.dataPrincipalCategories.map((c) => c.dataPrincipalCategoryId)).toContain(dpcId);
      expect(detail.personalDataElements.find((e) => e.personalDataElementId === pdeId)?.sensitivityNote).toBe("test note");
    });

    it("rejects linking a master-data entity that belongs to a different organisation", async () => {
      const { id: foreignSysId } = await withRequestDb(userOrgMemberB, (db) => createSystem(db, userOrgMemberB, orgB, { name: "D2 Org B System", owner: null, hostingEnvironment: null }));
      const { id: paId } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 Cross-Org Link Attempt", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
      );
      await expect(
        withRequestDb(userOrgMemberA, (db) => linkSystem(db, userOrgMemberA, { processingActivityId: paId, systemId: foreignSysId })),
      ).rejects.toThrow(CrossScopeReferenceError);
    });

    it("rejects linking the same entity twice to one activity", async () => {
      const { id: paId } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 Duplicate Link Attempt", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
      );
      await withRequestDb(userOrgMemberA, (db) => linkSystem(db, userOrgMemberA, { processingActivityId: paId, systemId: sysId }));
      await expect(withRequestDb(userOrgMemberA, (db) => linkSystem(db, userOrgMemberA, { processingActivityId: paId, systemId: sysId }))).rejects.toThrow(DuplicateLinkError);
    });

    it("unlinking removes the relationship", async () => {
      const { id: paId } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 Unlink Test", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
      );
      await withRequestDb(userOrgMemberA, (db) => linkSystem(db, userOrgMemberA, { processingActivityId: paId, systemId: sysId }));
      await withRequestDb(userOrgMemberA, (db) => unlinkSystem(db, userOrgMemberA, { processingActivityId: paId, systemId: sysId }));
      const detail = await withRequestDb(userOrgMemberA, (db) => getProcessingActivityDetail(db, userOrgMemberA, paId));
      expect(detail.systems.length).toBe(0);
    });

    it("VERSIONING / HISTORICAL INTEGRITY: a Processing Activity's pinned System version is never silently rewritten by a later System version", async () => {
      const { id: histSysId } = await withRequestDb(userOrgMemberA, (db) =>
        createSystem(db, userOrgMemberA, orgA, { name: "D2 History System v1", owner: null, hostingEnvironment: null }),
      );
      const { id: paId } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 History Pin Test", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
      );
      await withRequestDb(userOrgMemberA, (db) => linkSystem(db, userOrgMemberA, { processingActivityId: paId, systemId: histSysId }));

      const beforeDetail = await withRequestDb(userOrgMemberA, (db) => getProcessingActivityDetail(db, userOrgMemberA, paId));
      expect(beforeDetail.systems[0]!.name).toBe("D2 History System v1");

      // The System changes materially AFTER the link was made.
      await withRequestDb(userOrgMemberA, (db) =>
        createSystemVersion(db, userOrgMemberA, { systemId: histSysId, name: "D2 History System v2 (re-platformed)", owner: null, hostingEnvironment: null }),
      );

      const afterDetail = await withRequestDb(userOrgMemberA, (db) => getProcessingActivityDetail(db, userOrgMemberA, paId));
      expect(afterDetail.systems[0]!.name).toBe("D2 History System v1"); // unchanged — the pin, not the current state

      const currentSystems = await withRequestDb(userOrgMemberA, (db) => listSystems(db, userOrgMemberA, orgA));
      expect(currentSystems.find((s) => s.id === histSysId)?.name).toBe("D2 History System v2 (re-platformed)"); // the client's real current state has moved on
    });

    it("CARRY FORWARD: creates a new engagement-scoped row and re-resolves links to each entity's CURRENT version, never touching the source row", async () => {
      const { id: cfSysId } = await withRequestDb(userOrgMemberA, (db) =>
        createSystem(db, userOrgMemberA, orgA, { name: "D2 Carry-Forward System v1", owner: null, hostingEnvironment: null }),
      );
      const { id: sourcePaId } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 Carry-Forward Activity", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: "Consent" }),
      );
      await withRequestDb(userOrgMemberA, (db) => linkSystem(db, userOrgMemberA, { processingActivityId: sourcePaId, systemId: cfSysId }));

      // The System changes between engagements, matching DATA_MODEL.md
      // §5.5's own worked scenario.
      await withRequestDb(userOrgMemberA, (db) =>
        createSystemVersion(db, userOrgMemberA, { systemId: cfSysId, name: "D2 Carry-Forward System v2", owner: null, hostingEnvironment: null }),
      );

      const { id: newPaId } = await withRequestDb(userOrgMemberA, (db) =>
        carryForwardProcessingActivity(db, userOrgMemberA, { sourceProcessingActivityId: sourcePaId, targetEngagementId: engagementA2 }),
      );

      const newDetail = await withRequestDb(userOrgMemberA, (db) => getProcessingActivityDetail(db, userOrgMemberA, newPaId));
      expect(newDetail.engagementId).toBe(engagementA2);
      expect(newDetail.carriedForwardFromId).toBe(sourcePaId);
      expect(newDetail.name).toBe("D2 Carry-Forward Activity");
      expect(newDetail.systems[0]!.name).toBe("D2 Carry-Forward System v2"); // re-resolved to current, not the old pin

      // The source row and its own pin are completely untouched.
      const sourceDetail = await withRequestDb(userOrgMemberA, (db) => getProcessingActivityDetail(db, userOrgMemberA, sourcePaId));
      expect(sourceDetail.engagementId).toBe(engagementA);
      expect(sourceDetail.systems[0]!.name).toBe("D2 Carry-Forward System v1");
    });

    it("authorization: an engagement-only member can manage that engagement's Processing Activities", async () => {
      const { id } = await withRequestDb(userEngMemberA, (db) =>
        createProcessingActivity(db, userEngMemberA, { engagementId: engagementA, name: "D2 Via Engagement Member", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
      );
      expect(id).toBeTruthy();
    });

    it("authorization: a tenant-only member cannot create or read Processing Activities", async () => {
      await expect(
        withRequestDb(userTenantOnlyA, (db) =>
          createProcessingActivity(db, userTenantOnlyA, { engagementId: engagementA, name: "D2 Should Not Be Created", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
        ),
      ).rejects.toThrow(NotFoundOrForbiddenError);
    });

    it("tenant isolation: an org B member cannot list or read org A's Processing Activities", async () => {
      await expect(withRequestDb(userOrgMemberB, (db) => listProcessingActivities(db, userOrgMemberB, { engagementId: engagementA, organisationId: orgA }))).rejects.toThrow(NotFoundOrForbiddenError);

      const { id: paId } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 Tenant Isolation Target", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
      );
      await expect(withRequestDb(userOrgMemberB, (db) => getProcessingActivityDetail(db, userOrgMemberB, paId))).rejects.toThrow(NotFoundOrForbiddenError);
    });

    it("tenant isolation: a caller cannot forge an engagementId to attach a Processing Activity to another tenant's engagement", async () => {
      await expect(
        withRequestDb(userOrgMemberA, (db) =>
          createProcessingActivity(db, userOrgMemberA, { engagementId: engagementB, name: "D2 Forged Engagement", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
        ),
      ).rejects.toThrow(NotFoundOrForbiddenError);
    });

    it("RLS itself rejects a direct raw cross-tenant SELECT on processing_activities (belt-and-suspenders)", async () => {
      const { id: paId } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 RLS Direct Check", description: null, businessUnitId: null, ownerUserId: null, lawfulBasis: null }),
      );
      const rows = await asUser(userOrgMemberB, (client) => client.query(`SELECT id FROM processing_activities WHERE id = $1`, [paId]));
      expect(rows.rows.length).toBe(0);
    });

    it("ROPA: resolves every linked category with no cross-tenant leakage", async () => {
      const { id: paId } = await withRequestDb(userOrgMemberA, (db) =>
        createProcessingActivity(db, userOrgMemberA, { engagementId: engagementA, name: "D2 ROPA Coverage Activity", description: "for ROPA test", businessUnitId: null, ownerUserId: null, lawfulBasis: "Legitimate Interest" }),
      );
      await withRequestDb(userOrgMemberA, (db) => linkPurpose(db, userOrgMemberA, { processingActivityId: paId, purposeId }));
      await withRequestDb(userOrgMemberA, (db) => linkSystem(db, userOrgMemberA, { processingActivityId: paId, systemId: sysId }));

      const entries = await withRequestDb(userOrgMemberA, (db) => listRopaEntries(db, userOrgMemberA, { engagementId: engagementA, organisationId: orgA }));
      const entry = entries.find((e) => e.id === paId);
      expect(entry).toBeDefined();
      expect(entry!.purposes.map((p) => p.name)).toContain("D2 PA Purpose");
      expect(entry!.systems.map((s) => s.name)).toContain("D2 PA System");

      await expect(withRequestDb(userOrgMemberB, (db) => listRopaEntries(db, userOrgMemberB, { engagementId: engagementA, organisationId: orgA }))).rejects.toThrow(NotFoundOrForbiddenError);
    });
  });
});
