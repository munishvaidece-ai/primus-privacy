// Light coverage for the four master-data entities not exercised in
// depth elsewhere (System/Processor/DataStore get the deep versioning
// and cross-org-FK tests in system-versioning.test.ts and
// version-tenant-consistency.test.ts). This proves the identity+version
// pattern (or, for Business Unit, the identity-only pattern —
// DATA_MODEL.md §5.3's explicit no-version carve-out) actually works for
// all seven entities named in Milestone 2 §1, under real RLS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  asUser,
  createBusinessUnit,
  createDataPrincipalCategory,
  createOrganisation,
  createPersonalDataElement,
  createPurpose,
  createTenant,
  createUser,
  grantOrganisationMembership,
  pool,
} from "./helpers";

describe("master-data entity coverage: Business Unit, Data Principal Category, Personal Data Element, Purpose", () => {
  let org: string;
  let user: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      const tenant = await createTenant(client, "Entity Coverage Tenant");
      org = await createOrganisation(client, tenant, "ABC Financial Services");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Business Unit: identity-only (no version table), examples from Milestone 2 §5", async () => {
    const names = ["Retail Banking", "Corporate Banking", "Digital Banking", "HR", "Marketing"];
    const ids = await asFixtureSetup(async (client) => {
      const result: string[] = [];
      for (const name of names) {
        result.push(await createBusinessUnit(client, org, name));
      }
      return result;
    });

    const rows = await asUser(user, (c) =>
      c.query("SELECT id, name FROM business_units WHERE id = ANY($1) ORDER BY name", [ids]),
    );
    expect(rows.rows.map((r) => r.name)).toEqual([...names].sort());
  });

  it("Business Unit hierarchy: a single parent_business_unit_id link (not a full hierarchy engine) works", async () => {
    const { parentId, childId } = await asFixtureSetup(async (client) => {
      const parentId = await createBusinessUnit(client, org, "Banking");
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO business_units (organisation_id, name, parent_business_unit_id) VALUES ($1, $2, $3) RETURNING id`,
        [org, "Digital Banking", parentId],
      );
      return { parentId, childId: rows[0]!.id };
    });

    const rows = await asUser(user, (c) =>
      c.query("SELECT parent_business_unit_id FROM business_units WHERE id = $1", [childId]),
    );
    expect(rows.rows[0]!.parent_business_unit_id).toBe(parentId);
  });

  it("Data Principal Category: category taxonomy (Customer, Employee, Applicant, Vendor, Partner, Child), versioned", async () => {
    const categoryId = await asFixtureSetup((client) => createDataPrincipalCategory(client, org));

    await asFixtureSetup((client) =>
      client.query(
        `INSERT INTO data_principal_category_versions (data_principal_category_id, organisation_id, name, is_children_flag)
         VALUES ($1, $2, 'Customer', false)`,
        [categoryId, org],
      ),
    );

    const current = await asUser(user, (c) =>
      c.query(
        `SELECT name, is_children_flag FROM data_principal_category_versions
         WHERE data_principal_category_id = $1 AND is_current = true`,
        [categoryId],
      ),
    );
    expect(current.rows).toHaveLength(1);
    expect(current.rows[0]).toMatchObject({ name: "Customer", is_children_flag: false });

    // A "Child" category records is_children_flag = true — this is a
    // classification value, not a record of any actual child (Milestone
    // 2 §6/§16: no real personal data in this milestone).
    const childCategoryId = await asFixtureSetup((client) => createDataPrincipalCategory(client, org));
    await asFixtureSetup((client) =>
      client.query(
        `INSERT INTO data_principal_category_versions (data_principal_category_id, organisation_id, name, is_children_flag)
         VALUES ($1, $2, 'Child', true)`,
        [childCategoryId, org],
      ),
    );
    const childCurrent = await asUser(user, (c) =>
      c.query(
        `SELECT is_children_flag FROM data_principal_category_versions
         WHERE data_principal_category_id = $1 AND is_current = true`,
        [childCategoryId],
      ),
    );
    expect(childCurrent.rows[0]!.is_children_flag).toBe(true);
  });

  it("Personal Data Element: catalogue entries with sensitivity classification, versioned", async () => {
    const elementId = await asFixtureSetup((client) => createPersonalDataElement(client, org));
    await asFixtureSetup((client) =>
      client.query(
        `INSERT INTO personal_data_element_versions (personal_data_element_id, organisation_id, name, sensitivity_category)
         VALUES ($1, $2, 'PAN', 'sensitive')`,
        [elementId, org],
      ),
    );

    const current = await asUser(user, (c) =>
      c.query(
        `SELECT name, sensitivity_category FROM personal_data_element_versions
         WHERE personal_data_element_id = $1 AND is_current = true`,
        [elementId],
      ),
    );
    expect(current.rows[0]).toMatchObject({ name: "PAN", sensitivity_category: "sensitive" });
  });

  it("Personal Data Element: reclassifying sensitivity creates a new version, preserving the old classification historically", async () => {
    const elementId = await asFixtureSetup((client) => createPersonalDataElement(client, org));
    await asFixtureSetup((client) =>
      client.query(
        `INSERT INTO personal_data_element_versions (personal_data_element_id, organisation_id, name, sensitivity_category)
         VALUES ($1, $2, 'Mobile Number', 'general')`,
        [elementId, org],
      ),
    );
    await asFixtureSetup((client) =>
      client.query(
        `INSERT INTO personal_data_element_versions (personal_data_element_id, organisation_id, name, sensitivity_category)
         VALUES ($1, $2, 'Mobile Number', 'sensitive')`,
        [elementId, org],
      ),
    );

    const rows = await asUser(user, (c) =>
      c.query(
        `SELECT sensitivity_category, is_current FROM personal_data_element_versions
         WHERE personal_data_element_id = $1 ORDER BY created_at`,
        [elementId],
      ),
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ sensitivity_category: "general", is_current: false });
    expect(rows.rows[1]).toMatchObject({ sensitivity_category: "sensitive", is_current: true });
  });

  it("Purpose: reusable purpose-of-processing taxonomy, versioned", async () => {
    const purposeId = await asFixtureSetup((client) => createPurpose(client, org));
    await asFixtureSetup((client) =>
      client.query(
        `INSERT INTO purpose_versions (purpose_id, organisation_id, name, description)
         VALUES ($1, $2, 'KYC', 'Know Your Customer verification')`,
        [purposeId, org],
      ),
    );

    const current = await asUser(user, (c) =>
      c.query(`SELECT name FROM purpose_versions WHERE purpose_id = $1 AND is_current = true`, [purposeId]),
    );
    expect(current.rows[0]!.name).toBe("KYC");
  });
});
