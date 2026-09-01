// Milestone 8A — Historical Maturity Integrity Hardening: the exact
// required scenario. Governance (code GOV, "Original definition") is
// created; MaturityAssessment MA1 is created and finalized with a
// Governance score of 3/Defined; the CURRENT Governance domain row is
// then renamed and its description revised. The database must prove
// MA1 still reports the ORIGINAL Governance definition and score — no
// historical row silently resolves to the revised definition.
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
  grantOrganisationMembership,
  pinEngagementControlLibraryVersion,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Historical domain-snapshot integrity (Milestone 8A)", () => {
  let tenant: string, org: string, engagement: string, user: string;
  let library: string, control: string, assessment: string, methodology: string, weight: string;
  let governanceDomain: string;
  let ma1: string, ma1DomainScore: string, ma1OverallScore: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Domain Snapshot Integrity Tenant");
      org = await createOrganisation(client, tenant, "Domain Snapshot Integrity Client");
      engagement = await createEngagement(client, tenant, org, "Domain Snapshot Integrity Engagement — FY2026");
      user = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantOrganisationMembership(client, user, org);

      library = await createControlLibraryVersion(client, { tenantId: tenant, versionLabel: "Domain Snapshot Integrity Library" });
      control = await createControl(client, { tenantId: tenant, controlLibraryVersionId: library, code: "C1", title: "Domain snapshot test control" });
      await publishControlLibraryVersion(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      assessment = await createAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, controlLibraryVersionId: library, periodLabel: "FY2026" });
      const ac = await addAssessmentControl(client, { assessmentId: assessment, controlId: control, tenantId: tenant, organisationId: org, engagementId: engagement, controlLibraryVersionId: library });
      await createAssessmentResponse(client, { assessmentControlId: ac, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" });
      await finalizeAssessment(client, assessment);

      methodology = await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Domain Snapshot Integrity Methodology", version: "v1.0" });

      // --- Version 1: Governance, code GOV, "Original definition" ---
      governanceDomain = await createMaturityDomain(client, { tenantId: tenant, name: "Governance", code: "GOV", description: "Original definition" });
      weight = await createMaturityDomainWeight(client, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: governanceDomain, weight: 1.0 });

      ma1 = await createMaturityAssessment(client, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: assessment, maturityScoringMethodologyId: methodology });
      ma1DomainScore = await createMaturityScore(client, {
        maturityAssessmentId: ma1, tenantId: tenant, organisationId: org, engagementId: engagement,
        maturityDomainId: governanceDomain, maturityDomainWeightId: weight, score: 3, maturityLevel: "Defined",
      });
      ma1OverallScore = await createMaturityScore(client, {
        maturityAssessmentId: ma1, tenantId: tenant, organisationId: org, engagementId: engagement, score: 3, maturityLevel: "Defined",
      });
      await finalizeMaturityAssessment(client, ma1);

      // --- Later: the CURRENT Governance domain is renamed/revised ---
      await client.query(
        `UPDATE maturity_domains SET name = 'Governance & Oversight', code = 'GOV', description = 'Revised definition' WHERE id = $1`,
        [governanceDomain],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("MA1's MaturityScore still reports the ORIGINAL Governance name/code/description, not the revised one", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        "SELECT domain_name_snapshot, domain_code_snapshot, domain_description_snapshot FROM maturity_scores WHERE id = $1",
        [ma1DomainScore],
      ),
    );
    expect(rows[0]).toMatchObject({
      domain_name_snapshot: "Governance",
      domain_code_snapshot: "GOV",
      domain_description_snapshot: "Original definition",
    });
  });

  it("the CURRENT MaturityDomain row itself really was changed — the snapshot genuinely diverges from live data, not a coincidence", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT name, description FROM maturity_domains WHERE id = $1", [governanceDomain]));
    expect(rows[0]).toMatchObject({ name: "Governance & Oversight", description: "Revised definition" });
  });

  it("MA1's score remains 3/Defined — unaffected by the domain-definition change", async () => {
    const { rows } = await asFixtureSetup((c) => c.query("SELECT score, maturity_level FROM maturity_scores WHERE id = $1", [ma1DomainScore]));
    expect(rows[0]).toMatchObject({ score: 3, maturity_level: "Defined" });
  });

  it("no historical row silently resolves to the revised definition via a live JOIN — the snapshot is the authoritative historical record, not a derived value", async () => {
    // A naive live JOIN to the CURRENT domain row would show the revised
    // name/description; the point of the snapshot is that the historical
    // record does not need — and must not rely on — that live JOIN at all.
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT ms.domain_name_snapshot, ms.domain_description_snapshot, md.name AS live_name, md.description AS live_description
         FROM maturity_scores ms JOIN maturity_domains md ON md.id = ms.maturity_domain_id
         WHERE ms.id = $1`,
        [ma1DomainScore],
      ),
    );
    expect(rows[0]!.domain_name_snapshot).toBe("Governance");
    expect(rows[0]!.domain_description_snapshot).toBe("Original definition");
    expect(rows[0]!.live_name).toBe("Governance & Oversight");
    expect(rows[0]!.live_description).toBe("Revised definition");
    expect(rows[0]!.domain_name_snapshot).not.toBe(rows[0]!.live_name);
  });

  it("the full historical record answers all 8 required questions in one query", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT
           ms.maturity_domain_id                    AS domain_id,          -- (1) what domain was assessed
           ms.domain_name_snapshot, ms.domain_code_snapshot,                -- (2) its name/code
           ms.domain_description_snapshot,                                  -- (3) its definition/description
           mm.name AS methodology_name, mm.version AS methodology_version, -- (4) methodology/version used
           mdw.weight,                                                     -- (5) weight applied
           ms.score, ms.maturity_level,                                    -- (6) score produced
           ms.computed_at,                                                 -- (7) when computed
           ma.assessment_id                                                -- (8) source Assessment
         FROM maturity_scores ms
         JOIN maturity_assessments ma ON ma.id = ms.maturity_assessment_id
         JOIN maturity_scoring_methodologies mm ON mm.id = ma.maturity_scoring_methodology_id
         LEFT JOIN maturity_domain_weights mdw ON mdw.id = ms.maturity_domain_weight_id
         WHERE ms.id = $1`,
        [ma1DomainScore],
      ),
    );
    expect(rows[0]).toMatchObject({
      domain_id: governanceDomain,
      domain_name_snapshot: "Governance",
      domain_code_snapshot: "GOV",
      domain_description_snapshot: "Original definition",
      methodology_name: "Domain Snapshot Integrity Methodology",
      methodology_version: "v1.0",
      score: 3,
      maturity_level: "Defined",
      assessment_id: assessment,
    });
    expect(Number(rows[0]!.weight)).toBe(1);
    expect(rows[0]!.computed_at).not.toBeNull();
  });

  it("the overall row (no domain) never carries a domain snapshot", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        "SELECT maturity_domain_id, domain_name_snapshot, domain_code_snapshot, domain_description_snapshot FROM maturity_scores WHERE id = $1",
        [ma1OverallScore],
      ),
    );
    expect(rows[0]).toMatchObject({
      maturity_domain_id: null,
      domain_name_snapshot: null,
      domain_code_snapshot: null,
      domain_description_snapshot: null,
    });
  });

  it("the snapshot cannot be set directly by the application — the trigger always overwrites it from the live domain at insert time", async () => {
    // A fresh, still-draft MaturityAssessment — MA1 itself is already
    // finalized, and no further MaturityScore can be inserted against it
    // at all (the insert-gate trigger), which is itself the correct,
    // separately-tested behavior, not what this test is checking.
    const ma3 = await asFixtureSetup((c) =>
      createMaturityAssessment(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId: assessment, maturityScoringMethodologyId: methodology }),
    );
    const spoofedScoreId = await asFixtureSetup((c) =>
      c.query(
        `INSERT INTO maturity_scores
           (maturity_assessment_id, tenant_id, organisation_id, engagement_id, maturity_domain_id, maturity_domain_weight_id, score,
            domain_name_snapshot, domain_code_snapshot, domain_description_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, 5, 'Forged Name', 'FORGED', 'Forged description')
         RETURNING id`,
        [ma3, tenant, org, engagement, governanceDomain, weight],
      ).then((r) => r.rows[0]!.id),
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query("SELECT domain_name_snapshot, domain_code_snapshot, domain_description_snapshot FROM maturity_scores WHERE id = $1", [spoofedScoreId]),
    );
    // Trigger overwrote the forged values with the (by-then-revised)
    // live domain data — never the caller-supplied forgery.
    expect(rows[0]).toMatchObject({
      domain_name_snapshot: "Governance & Oversight",
      domain_code_snapshot: "GOV",
      domain_description_snapshot: "Revised definition",
    });
  });

  it("once written, a snapshot is immutable like every other MaturityScore field — no UPDATE grant exists at all", async () => {
    await expect(
      asUser(user, (c) => c.query(`UPDATE maturity_scores SET domain_name_snapshot = 'tampered' WHERE id = $1`, [ma1DomainScore])),
    ).rejects.toThrow(/permission denied/i);
  });
});
