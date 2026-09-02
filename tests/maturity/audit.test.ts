// Milestone 8 instructions §15: creation, scoring/calculation, status/
// finalization, methodology-version association, and material changes
// while draft must all be auditable; finalized historical maturity must
// remain reconstructable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addAssessmentControl,
  asFixtureSetup,
  asUser,
  createAssessment,
  createAssessmentResponse,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createMaturityAssessment,
  createMaturityDomain,
  createMaturityDomainWeight,
  createMaturityScore,
  createMaturityScoringMethodology,
  createOrganisation,
  createTenant,
  createUser,
  finalizeAssessment,
  finalizeMaturityAssessment,
  grantEngagementMembership,
  grantOrganisationMembership,
  linkMaturityDomainControl,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Maturity auditability", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let library: string, control: string, assessment: string, methodology: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Maturity audit test tenant");
      org = await createOrganisation(client, tenant, "Maturity audit test org");
      engagement = await createEngagement(client, tenant, org, "Maturity audit test engagement");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Maturity Audit Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "AUD1", title: "Maturity audit control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      const ac = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(client, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(client, assessment);

      methodology = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Audit Test Methodology", version: "v1.0" });
    });
  });

  // M2 (Maturity Implementation, approval §4)'s new UNIQUE(assessment_id)
  // constraint on `maturity_assessments` means each `it()` below that
  // creates its own MaturityAssessment needs its own distinct Assessment.
  async function freshFinalizedAssessment(periodLabel: string): Promise<string> {
    return asFixtureSetup(async (c) => {
      const a = await createAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel });
      const ac = await addAssessmentControl(c, { assessmentId: a, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(c, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(c, a);
      return a;
    });
  }

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

  it("MaturityScoringMethodology creation is audited", async () => {
    const methodologyId = await asFixtureSetup((c) => createMaturityScoringMethodology(c, { tenantId: tenant, name: "Second Audit Methodology", version: "v2.0" }));
    const entries = await latestAuditEntries("maturity_scoring_methodologies", methodologyId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.version).toBe("v2.0");
  });

  it("MaturityDomain creation and material updates are audited", async () => {
    const domainId = await asFixtureSetup((c) => createMaturityDomain(c, { tenantId: tenant, name: "Audited domain", code: "AUDIT_DOMAIN" }));
    await asFixtureSetup((c) => c.query(`UPDATE maturity_domains SET description = 'now described', is_active = false WHERE id = $1`, [domainId]));

    const entries = await latestAuditEntries("maturity_domains", domainId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update"]);
    expect(entries[1]!.field_changes.new).toMatchObject({ description: "now described", is_active: false });
  });

  it("MaturityDomainWeight creation is audited (append-only — no further updates ever occur)", async () => {
    const domainId = await asFixtureSetup((c) => createMaturityDomain(c, { tenantId: tenant, name: "Weight audit domain", code: "WEIGHT_AUDIT_DOMAIN" }));
    const weightId = await asFixtureSetup((c) => createMaturityDomainWeight(c, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domainId, weight: 1 }));

    const entries = await latestAuditEntries("maturity_domain_weights", weightId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(Number(entries[0]!.field_changes.weight)).toBe(1);
  });

  it("MaturityDomainControlMapping linkage (material relationship change) is audited as an insert event", async () => {
    const domainId = await asFixtureSetup((c) => createMaturityDomain(c, { tenantId: tenant, name: "Mapping audit domain", code: "MAPPING_AUDIT_DOMAIN" }));
    const mappingId = await asFixtureSetup((c) => linkMaturityDomainControl(c, { maturityDomainId: domainId, controlId: control, tenantId: tenant }));
    const entries = await latestAuditEntries("maturity_domain_control_mappings", mappingId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes.control_id).toBe(control);
  });

  it("MaturityAssessment creation, methodology-version association, and finalization are all audited", async () => {
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: assessment, maturityScoringMethodologyId: methodology }),
    );
    await asFixtureSetup((c) => finalizeMaturityAssessment(c, maturityAssessmentId));

    const entries = await latestAuditEntries("maturity_assessments", maturityAssessmentId);
    expect(entries.map((e) => e.action)).toEqual(["insert", "update"]);
    expect(entries[0]!.field_changes.maturity_scoring_methodology_id).toBe(methodology);
    expect(entries[1]!.field_changes.new.status).toBe("finalized");
    expect(entries[1]!.field_changes.new.finalized_at).not.toBeNull();
  });

  it("MaturityScore creation (the computed result itself) is audited", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2027 (score audit test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology }),
    );
    const scoreId = await asFixtureSetup((c) =>
      createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, score: 4, maturityLevel: "Managed" }),
    );

    const entries = await latestAuditEntries("maturity_scores", scoreId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "insert" });
    expect(entries[0]!.field_changes).toMatchObject({ score: 4, maturity_level: "Managed" });
  });

  it("finalized historical maturity remains reconstructable from audit history alone", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2028 (history reconstruction test)");
    const maturityAssessmentId = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: localAssessment, maturityScoringMethodologyId: methodology }),
    );
    await asFixtureSetup((c) => createMaturityScore(c, { maturityAssessmentId, tenantId: tenant, organisationId: org, engagementId: engagement, score: 5, maturityLevel: "Optimized" }));
    await asFixtureSetup((c) => finalizeMaturityAssessment(c, maturityAssessmentId));

    const assessmentEntries = await latestAuditEntries("maturity_assessments", maturityAssessmentId);
    const insertEntry = assessmentEntries[0]!;
    expect(insertEntry.field_changes).toMatchObject({ assessment_id: localAssessment, maturity_scoring_methodology_id: methodology, status: "draft" });
    const finalizeEntry = assessmentEntries[assessmentEntries.length - 1]!;
    expect(finalizeEntry.field_changes.new.status).toBe("finalized");
  });

  it("every audit entry is correctly attributed to the acting user via auth.uid()", async () => {
    const localAssessment = await freshFinalizedAssessment("FY2029 (attribution test)");
    // M2 (Maturity Implementation, approval §20/§21): `maturity_assessments`
    // INSERT now requires the dedicated `maturity.compute` permission
    // (migration 0030), not merely `can_access_engagement` — `user` (only
    // OrganisationMembership as Client Administrator) no longer qualifies,
    // so this attribution test needs its own Engagement Manager.
    const engagementManager = await asFixtureSetup((c) => createUser(c, { tenantId: tenant, clientOrgId: org }));
    await asFixtureSetup((c) => grantEngagementMembership(c, engagementManager, engagement, "Engagement Manager"));
    const committedId = await (async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [engagementManager]);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO maturity_assessments (engagement_id, organisation_id, tenant_id, assessment_id, maturity_scoring_methodology_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [engagement, org, tenant, localAssessment, methodology],
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

    const entries = await latestAuditEntries("maturity_assessments", committedId);
    expect(entries[0]!.actor_user_id).toBe(engagementManager);
  });
});
