// Milestone 3 §5's required scenario, tested against real PostgreSQL:
//
//   ABC Financial Services
//   FY2026: PA-014-E1 "Customer Onboarding"
//     System: Customer CRM v1        Data Store: Customer Database v1
//     Processor: XYZ Analytics v1    Personal Data: Name, PAN, Mobile
//     Purpose: Customer Onboarding
//   FY2027: carry forward into PA-014-E2, then update the landscape:
//     System: Customer CRM v2        Data Store: Customer Database v2
//     Processor: ABC Analytics v1    Purpose: Customer Onboarding (unchanged)
//
// Required demonstrations (§5, items 1-8 — items 9-12 are covered by
// tenant-org-isolation.test.ts and version-consistency.test.ts):
//   1. PA-014-E1 remains unchanged.
//   2. PA-014-E2 exists as a separate engagement record.
//   3. PA-014-E2 correctly records carried_forward_from_id = PA-014-E1.
//   4. FY2026 resolves to the original master-data versions.
//   5. FY2027 resolves to the new master-data versions.
//   6. Updating FY2027 relationships does not alter FY2026.
//   7. Current-state queries can resolve the latest applicable master versions.
//   8. Historical queries can reconstruct the FY2026 state.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createDataStore,
  createEngagement,
  createOrganisation,
  createPersonalDataElement,
  createProcessingActivity,
  createProcessor,
  createPurpose,
  createSystem,
  createTenant,
  createUser,
  grantOrganisationMembership,
  insertDataStoreVersion,
  insertProcessorVersion,
  insertSystemVersion,
  linkDataStore,
  linkPersonalDataElement,
  linkProcessor,
  linkPurpose,
  linkSystem,
  pool,
} from "./helpers";

describe("Processing Activity carry-forward — the ABC Financial PA-014 scenario", () => {
  let tenant: string, org: string, user: string;
  let engagement2026: string, engagement2027: string;

  // Master data identities
  let system: string, dataStore: string, purpose: string;
  let namePde: string, panPde: string, mobilePde: string;

  // FY2026 versions
  let systemV1: string, dataStoreV1: string, xyzProcessor: string, xyzV1: string, purposeV1: string;
  let namePdeV1: string, panPdeV1: string, mobilePdeV1: string;

  // FY2027 versions (System/DataStore get a new version on the SAME
  // identity; the processor is a genuinely different identity, matching
  // DATA_MODEL.md §5.5's "Processor XYZ replaced by Processor ABC" — not
  // a new version of XYZ)
  let systemV2: string, dataStoreV2: string, abcProcessor: string, abcV1: string;

  let pa1: string; // PA-014-E1
  let pa2: string; // PA-014-E2

  beforeAll(async () => {
    ({ tenant, org, user, engagement2026 } = await asFixtureSetup(async (client) => {
      const tenant = await createTenant(client, "ABC Financial Services — PA carry-forward");
      const org = await createOrganisation(client, tenant, "ABC Financial Services");
      const user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
      const engagement2026 = await createEngagement(client, tenant, org, "DPDP Readiness — FY2026");
      return { tenant, org, user, engagement2026 };
    }));

    // --- FY2026 master data + PA-014-E1 -----------------------------
    ({ pa1, system, systemV1, dataStore, dataStoreV1, xyzProcessor, xyzV1, purpose, purposeV1, namePde, namePdeV1, panPde, panPdeV1, mobilePde, mobilePdeV1 } =
      await asFixtureSetup(async (client) => {
        const system = await createSystem(client, org);
        const systemV1 = await insertSystemVersion(client, {
          systemId: system,
          organisationId: org,
          name: "Customer CRM",
          owner: "Digital Banking",
          hostingEnvironment: "India",
        });

        const dataStore = await createDataStore(client, org);
        const dataStoreV1 = await insertDataStoreVersion(client, {
          dataStoreId: dataStore,
          organisationId: org,
          name: "Customer Database",
          systemVersionId: systemV1,
        });

        const xyzProcessor = await createProcessor(client, org);
        const xyzV1 = await insertProcessorVersion(client, {
          processorId: xyzProcessor,
          organisationId: org,
          name: "XYZ Analytics",
          dpaVersionLabel: "v1",
        });

        const purpose = await createPurpose(client, org);
        const purposeV1 = await client
          .query<{ id: string }>(
            `INSERT INTO purpose_versions (purpose_id, organisation_id, name) VALUES ($1, $2, 'Customer Onboarding') RETURNING id`,
            [purpose, org],
          )
          .then((r) => r.rows[0]!.id);

        const namePde = await createPersonalDataElement(client, org);
        const namePdeV1 = await client
          .query<{ id: string }>(
            `INSERT INTO personal_data_element_versions (personal_data_element_id, organisation_id, name, sensitivity_category)
             VALUES ($1, $2, 'Name', 'general') RETURNING id`,
            [namePde, org],
          )
          .then((r) => r.rows[0]!.id);

        const panPde = await createPersonalDataElement(client, org);
        const panPdeV1 = await client
          .query<{ id: string }>(
            `INSERT INTO personal_data_element_versions (personal_data_element_id, organisation_id, name, sensitivity_category)
             VALUES ($1, $2, 'PAN', 'sensitive') RETURNING id`,
            [panPde, org],
          )
          .then((r) => r.rows[0]!.id);

        const mobilePde = await createPersonalDataElement(client, org);
        const mobilePdeV1 = await client
          .query<{ id: string }>(
            `INSERT INTO personal_data_element_versions (personal_data_element_id, organisation_id, name, sensitivity_category)
             VALUES ($1, $2, 'Mobile', 'general') RETURNING id`,
            [mobilePde, org],
          )
          .then((r) => r.rows[0]!.id);

        const pa1 = await createProcessingActivity(client, {
          engagementId: engagement2026,
          organisationId: org,
          tenantId: tenant,
          name: "Customer Onboarding",
        });

        await linkSystem(client, { processingActivityId: pa1, engagementId: engagement2026, organisationId: org, systemId: system, systemVersionId: systemV1 });
        await linkDataStore(client, { processingActivityId: pa1, engagementId: engagement2026, organisationId: org, dataStoreId: dataStore, dataStoreVersionId: dataStoreV1 });
        await linkProcessor(client, { processingActivityId: pa1, engagementId: engagement2026, organisationId: org, processorId: xyzProcessor, processorVersionId: xyzV1 });
        await linkPurpose(client, { processingActivityId: pa1, engagementId: engagement2026, organisationId: org, purposeId: purpose, purposeVersionId: purposeV1 });
        await linkPersonalDataElement(client, { processingActivityId: pa1, engagementId: engagement2026, organisationId: org, personalDataElementId: namePde, personalDataElementVersionId: namePdeV1 });
        await linkPersonalDataElement(client, { processingActivityId: pa1, engagementId: engagement2026, organisationId: org, personalDataElementId: panPde, personalDataElementVersionId: panPdeV1 });
        await linkPersonalDataElement(client, { processingActivityId: pa1, engagementId: engagement2026, organisationId: org, personalDataElementId: mobilePde, personalDataElementVersionId: mobilePdeV1 });

        return {
          pa1, system, systemV1, dataStore, dataStoreV1, xyzProcessor, xyzV1, purpose, purposeV1,
          namePde, namePdeV1, panPde, panPdeV1, mobilePde, mobilePdeV1,
        };
      }));

    // --- Between engagements: master data changes independently -----
    ({ systemV2, dataStoreV2, abcProcessor, abcV1 } = await asFixtureSetup(async (client) => {
      const systemV2 = await insertSystemVersion(client, {
        systemId: system,
        organisationId: org,
        name: "Customer CRM",
        owner: "Technology",
        hostingEnvironment: "Singapore",
      });
      const dataStoreV2 = await insertDataStoreVersion(client, {
        dataStoreId: dataStore,
        organisationId: org,
        name: "Customer Database",
        systemVersionId: systemV2,
      });
      const abcProcessor = await createProcessor(client, org);
      const abcV1 = await insertProcessorVersion(client, {
        processorId: abcProcessor,
        organisationId: org,
        name: "ABC Analytics",
        dpaVersionLabel: "v1",
      });
      return { systemV2, dataStoreV2, abcProcessor, abcV1 };
    }));

    // --- FY2027: carry forward PA-014-E1 into PA-014-E2 --------------
    engagement2027 = await asFixtureSetup((client) =>
      createEngagement(client, tenant, org, "Annual DPDP Assessment — FY2027"),
    );

    pa2 = await asFixtureSetup((client) =>
      createProcessingActivity(client, {
        engagementId: engagement2027,
        organisationId: org,
        tenantId: tenant,
        name: "Customer Onboarding",
        carriedForwardFromId: pa1,
      }),
    );

    // Carry-forward re-resolves System/Data Store to their now-current
    // versions (DATA_MODEL.md §5.4); Purpose is unchanged so it
    // re-resolves to the same version it already had; the Processor
    // relationship is replaced outright (XYZ removed, ABC added) — not a
    // "new version of XYZ", matching §5.5 exactly.
    await asFixtureSetup(async (client) => {
      await linkSystem(client, { processingActivityId: pa2, engagementId: engagement2027, organisationId: org, systemId: system, systemVersionId: systemV2 });
      await linkDataStore(client, { processingActivityId: pa2, engagementId: engagement2027, organisationId: org, dataStoreId: dataStore, dataStoreVersionId: dataStoreV2 });
      await linkProcessor(client, { processingActivityId: pa2, engagementId: engagement2027, organisationId: org, processorId: abcProcessor, processorVersionId: abcV1 });
      await linkPurpose(client, { processingActivityId: pa2, engagementId: engagement2027, organisationId: org, purposeId: purpose, purposeVersionId: purposeV1 });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("(1) PA-014-E1 remains unchanged after FY2027 work", async () => {
    const rows = await asUser(user, (c) =>
      c.query("SELECT name, engagement_id, carried_forward_from_id FROM processing_activities WHERE id = $1", [pa1]),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ name: "Customer Onboarding", engagement_id: engagement2026, carried_forward_from_id: null });
  });

  it("(2) PA-014-E2 exists as a separate, distinct engagement-scoped record", async () => {
    expect(pa2).not.toBe(pa1);
    const rows = await asUser(user, (c) => c.query("SELECT id, engagement_id FROM processing_activities WHERE id = $1", [pa2]));
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ id: pa2, engagement_id: engagement2027 });
  });

  it("(3) PA-014-E2 correctly records carried_forward_from_id = PA-014-E1", async () => {
    const rows = await asUser(user, (c) =>
      c.query("SELECT carried_forward_from_id FROM processing_activities WHERE id = $1", [pa2]),
    );
    expect(rows.rows[0]!.carried_forward_from_id).toBe(pa1);
  });

  it("(4) FY2026 resolves to the original master-data versions (System v1, Data Store v1, Processor XYZ v1)", async () => {
    const system = await asUser(user, (c) =>
      c.query(
        `SELECT sv.owner, sv.hosting_environment FROM processing_activity_systems pas
         JOIN system_versions sv ON sv.id = pas.system_version_id
         WHERE pas.processing_activity_id = $1`,
        [pa1],
      ),
    );
    expect(system.rows[0]).toMatchObject({ owner: "Digital Banking", hosting_environment: "India" });

    const processor = await asUser(user, (c) =>
      c.query(
        `SELECT pv.name, pv.dpa_version_label FROM processing_activity_processors pap
         JOIN processor_versions pv ON pv.id = pap.processor_version_id
         WHERE pap.processing_activity_id = $1`,
        [pa1],
      ),
    );
    expect(processor.rows[0]).toMatchObject({ name: "XYZ Analytics", dpa_version_label: "v1" });
  });

  it("(5) FY2027 resolves to the new master-data versions (System v2, Data Store v2, Processor ABC v1)", async () => {
    const system = await asUser(user, (c) =>
      c.query(
        `SELECT sv.owner, sv.hosting_environment FROM processing_activity_systems pas
         JOIN system_versions sv ON sv.id = pas.system_version_id
         WHERE pas.processing_activity_id = $1`,
        [pa2],
      ),
    );
    expect(system.rows[0]).toMatchObject({ owner: "Technology", hosting_environment: "Singapore" });

    const processor = await asUser(user, (c) =>
      c.query(
        `SELECT pv.name, pv.dpa_version_label FROM processing_activity_processors pap
         JOIN processor_versions pv ON pv.id = pap.processor_version_id
         WHERE pap.processing_activity_id = $1`,
        [pa2],
      ),
    );
    expect(processor.rows[0]).toMatchObject({ name: "ABC Analytics", dpa_version_label: "v1" });

    // XYZ is no longer linked to PA-014-E2 at all — replaced, not versioned.
    const xyzStillLinked = await asUser(user, (c) =>
      c.query(
        `SELECT 1 FROM processing_activity_processors WHERE processing_activity_id = $1 AND processor_id = $2`,
        [pa2, xyzProcessor],
      ),
    );
    expect(xyzStillLinked.rows).toHaveLength(0);
  });

  it("(6) updating FY2027's relationships does not alter FY2026's", async () => {
    // Simulate further FY2027 discovery work: swap the Purpose version
    // (a hypothetical refinement) by removing and re-adding the link —
    // junctions are never updated in place (migration 0005 §3).
    await asFixtureSetup(async (client) => {
      const newPurposeV = await client
        .query<{ id: string }>(
          `INSERT INTO purpose_versions (purpose_id, organisation_id, name, description)
           VALUES ($1, $2, 'Customer Onboarding', 'Refined scope for FY2027') RETURNING id`,
          [purpose, org],
        )
        .then((r) => r.rows[0]!.id);
      await client.query(
        `DELETE FROM processing_activity_purposes WHERE processing_activity_id = $1 AND purpose_id = $2`,
        [pa2, purpose],
      );
      await linkPurpose(client, { processingActivityId: pa2, engagementId: engagement2027, organisationId: org, purposeId: purpose, purposeVersionId: newPurposeV });
    });

    // FY2026's purpose link is completely unaffected.
    const fy2026Purpose = await asUser(user, (c) =>
      c.query(
        `SELECT pv.description FROM processing_activity_purposes pap
         JOIN purpose_versions pv ON pv.id = pap.purpose_version_id
         WHERE pap.processing_activity_id = $1`,
        [pa1],
      ),
    );
    expect(fy2026Purpose.rows[0]!.description).toBeNull();

    const fy2027Purpose = await asUser(user, (c) =>
      c.query(
        `SELECT pv.description FROM processing_activity_purposes pap
         JOIN purpose_versions pv ON pv.id = pap.purpose_version_id
         WHERE pap.processing_activity_id = $1`,
        [pa2],
      ),
    );
    expect(fy2027Purpose.rows[0]!.description).toBe("Refined scope for FY2027");
  });

  it("(7) a current-state query resolves the latest applicable master versions, independent of any engagement", async () => {
    const currentSystem = await asUser(user, (c) =>
      c.query(
        `SELECT sv.owner, sv.hosting_environment FROM systems s
         JOIN system_versions sv ON sv.system_id = s.id AND sv.is_current = true
         WHERE s.id = $1`,
        [system],
      ),
    );
    expect(currentSystem.rows[0]).toMatchObject({ owner: "Technology", hosting_environment: "Singapore" });

    const currentDataStore = await asUser(user, (c) =>
      c.query(
        `SELECT dsv.name FROM data_stores ds
         JOIN data_store_versions dsv ON dsv.data_store_id = ds.id AND dsv.is_current = true
         WHERE ds.id = $1`,
        [dataStore],
      ),
    );
    expect(currentDataStore.rows[0]!.name).toBe("Customer Database");
  });

  it("(8) a historical query reconstructs the FY2026 state exactly (PA-014-E1's own junctions, untouched by anything since)", async () => {
    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT sv.owner AS system_owner, dsv.name AS data_store_name, pv.name AS processor_name, pv.dpa_version_label
         FROM processing_activities pa
         JOIN processing_activity_systems pas ON pas.processing_activity_id = pa.id
         JOIN system_versions sv ON sv.id = pas.system_version_id
         JOIN processing_activity_data_stores pads ON pads.processing_activity_id = pa.id
         JOIN data_store_versions dsv ON dsv.id = pads.data_store_version_id
         JOIN processing_activity_processors pap ON pap.processing_activity_id = pa.id
         JOIN processor_versions pv ON pv.id = pap.processor_version_id
         WHERE pa.id = $1`,
        [pa1],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      system_owner: "Digital Banking",
      data_store_name: "Customer Database",
      processor_name: "XYZ Analytics",
      dpa_version_label: "v1",
    });

    // The three personal data elements captured for FY2026 are intact too.
    const pde = await asUser(user, (c) =>
      c.query(
        `SELECT pdev.name FROM processing_activity_personal_data_elements padel
         JOIN personal_data_element_versions pdev ON pdev.id = padel.personal_data_element_version_id
         WHERE padel.processing_activity_id = $1 ORDER BY pdev.name`,
        [pa1],
      ),
    );
    expect(pde.rows.map((r) => r.name)).toEqual(["Mobile", "Name", "PAN"]);
  });
});
