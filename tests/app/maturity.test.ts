// M2 — Maturity Implementation. Tests the real domain functions
// (lib/domain/maturity.ts) and the new `maturity.compute` permission
// (lib/authorization/service.ts) against real PostgreSQL — no mocked
// authorization, no mocked database. Covers the M2 approval's own §28/
// §29 required test lists: compute lifecycle, control eligibility (D3
// applicability), unanswered-control anti-gaming semantics, methodology/
// weighting validation, non-numeric-effect assertions (ControlTest/
// Evidence/Risk), historical integrity, and authorization/security.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantOrganisationMembership,
  grantEngagementMembership,
  createControlLibraryVersion as createControlLibraryVersionFixture,
  publishControlLibraryVersion as publishControlLibraryVersionFixture,
  createControl as createControlFixture,
  pinEngagementControlLibraryVersion,
  createAssessmentResponse,
  createMaturityScoringMethodology,
  createMaturityDomain,
  createMaturityDomainWeight,
  linkMaturityDomainControl,
  createMaturityAssessmentFixture,
  createRiskScoringModel,
  pool,
} from "./helpers";
import { withRequestDb } from "@/lib/db/request-client";
import { createAssessment, finalizeAssessment, updateAssessmentResponse, createControlTest } from "@/lib/domain/assessments";
import { createEngagementScope, updateControlApplicability, lockEngagementScope, getEngagementScopeDetail, reviseEngagementScope } from "@/lib/domain/applicability";
import { uploadEvidence } from "@/lib/domain/evidence";
import { createRisk } from "@/lib/domain/risks";
import {
  computeAndFinalizeMaturityAssessment,
  getMaturityAssessmentForAssessment,
  AssessmentNotFinalizedForMaturityError,
  MaturityAlreadyComputedError,
  NoActiveMaturityMethodologyError,
  IncompleteMaturityDataError,
  MissingMaturityDomainWeightError,
} from "@/lib/domain/maturity";
import { NotFoundOrForbiddenError, canComputeMaturity } from "@/lib/authorization/service";

function textFile(content = "synthetic maturity test evidence — not a real client document") {
  return { buffer: Buffer.from(content, "utf8"), filename: "evidence.txt", mimeType: "text/plain" };
}

// =============================================================================
// 1. Compute lifecycle
// =============================================================================

describe("Maturity — compute lifecycle", () => {
  let tenant: string, org: string, engagement: string;
  let library: string, controlA: string, controlB: string, controlC: string, controlD: string;
  let domain: string;
  let engManager: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Maturity Lifecycle Tenant");
      org = await createOrganisation(client, tenant, "Maturity Lifecycle Client");
      engagement = await createEngagement(client, tenant, org, "Maturity Lifecycle Engagement");
      engManager = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantEngagementMembership(client, engManager, engagement, "Engagement Manager");

      library = await createControlLibraryVersionFixture(client, { tenantId: tenant, versionLabel: "Maturity Lifecycle Library" });
      controlA = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "M-01", title: "Control A" });
      controlB = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "M-02", title: "Control B" });
      // Test 8's own dedicated rounding-boundary controls — created here,
      // before publish, since a published library's Control set is frozen.
      controlC = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "M-03", title: "Control C" });
      controlD = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "M-04", title: "Control D" });
      await publishControlLibraryVersionFixture(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      domain = await createMaturityDomain(client, { tenantId: tenant, name: "Lifecycle Domain", code: "LIFECYCLE_DOMAIN" });
      await linkMaturityDomainControl(client, { maturityDomainId: domain, controlId: controlA, tenantId: tenant });
      await linkMaturityDomainControl(client, { maturityDomainId: domain, controlId: controlB, tenantId: tenant });
      await createMaturityDomainWeight(client, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 1 });
      await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Lifecycle Methodology", version: "v1.0" });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  type Rating = "not_assessed" | "not_applicable" | "not_implemented" | "partially_implemented" | "implemented";
  async function buildFinalizedAssessment(periodLabel: string, ratings: { a?: Rating; b?: Rating }): Promise<{ assessmentId: string }> {
    const { id: assessmentId } = await withRequestDb(engManager, (db) => createAssessment(db, engManager, { engagementId: engagement, assessmentType: "annual", periodLabel }));
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id, control_id FROM assessment_controls WHERE assessment_id = $1`, [assessmentId]));
    const acA = rows.find((r: { control_id: string }) => r.control_id === controlA)!.id as string;
    const acB = rows.find((r: { control_id: string }) => r.control_id === controlB)!.id as string;
    if (ratings.a) await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acA, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: ratings.a! }));
    if (ratings.b) await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acB, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: ratings.b! }));
    await withRequestDb(engManager, (db) => finalizeAssessment(db, engManager, { organisationId: org, engagementId: engagement, assessmentId }));
    return { assessmentId };
  }

  it("1. a finalized Assessment computes maturity — exact arithmetic (implemented=5, partially_implemented=3 -> mean 4, round 4, level Managed)", async () => {
    const { assessmentId } = await buildFinalizedAssessment("FY1 (compute)", { a: "implemented", b: "partially_implemented" });
    const result = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    expect(result.overallScore).toBe(4);
    expect(result.overallLevel).toBe("Managed");
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0]).toMatchObject({ maturityDomainId: domain, score: 4, level: "Managed" });

    const read = await withRequestDb(engManager, (db) => getMaturityAssessmentForAssessment(db, engManager, { assessmentId, organisationId: org, engagementId: engagement }));
    expect(read).toMatchObject({ status: "finalized", overallScore: 4, overallLevel: "Managed" });
  });

  it("2. a draft Assessment cannot compute maturity", async () => {
    const { id: assessmentId } = await withRequestDb(engManager, (db) => createAssessment(db, engManager, { engagementId: engagement, assessmentType: "annual", periodLabel: "FY2 (still draft)" }));
    await expect(withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }))).rejects.toThrow(
      AssessmentNotFinalizedForMaturityError,
    );
  });

  it("3. repeat compute cannot create a competing official result — domain pre-check, and the DB constraint as backstop", async () => {
    const { assessmentId } = await buildFinalizedAssessment("FY3 (repeat compute)", { a: "implemented", b: "implemented" });
    await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    await expect(withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }))).rejects.toThrow(
      MaturityAlreadyComputedError,
    );

    // The DB constraint itself (migration 0029) as the real backstop —
    // bypassing the domain layer's own pre-check entirely.
    const activeMethodologyId = await asFixtureSetup(async (c) => {
      const { rows } = await c.query(`SELECT id FROM maturity_scoring_methodologies WHERE tenant_id = $1 AND is_active = true LIMIT 1`, [tenant]);
      return rows[0].id as string;
    });
    await expect(
      asFixtureSetup((c) =>
        createMaturityAssessmentFixture(c, { engagementId: engagement, organisationId: org, tenantId: tenant, assessmentId, maturityScoringMethodologyId: activeMethodologyId }),
      ),
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);
  });

  it("4. failed computation (an incomplete domain) leaves no partial rows — no MaturityAssessment, no MaturityScore", async () => {
    const { assessmentId } = await buildFinalizedAssessment("FY4 (incomplete)", { a: "implemented" }); // controlB left unanswered
    let thrown: unknown;
    try {
      await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(IncompleteMaturityDataError);
    const detail = (thrown as IncompleteMaturityDataError).incompleteDomains;
    expect(detail).toEqual([
      expect.objectContaining({ maturityDomainId: domain, eligibleCount: 2, answeredCount: 1, unansweredCount: 1 }),
    ]);

    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id FROM maturity_assessments WHERE assessment_id = $1`, [assessmentId]));
    expect(rows).toHaveLength(0);
  });

  it("5. MaturityScore is immutable — direct SQL UPDATE/DELETE on a real computed score both rejected", async () => {
    const { assessmentId } = await buildFinalizedAssessment("FY5 (score immutability)", { a: "implemented", b: "implemented" });
    const result = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id FROM maturity_scores WHERE maturity_assessment_id = $1 LIMIT 1`, [result.maturityAssessmentId]));
    const scoreId = rows[0].id as string;
    await expect(asUser(engManager, (c) => c.query(`UPDATE maturity_scores SET score = 1 WHERE id = $1`, [scoreId]))).rejects.toThrow(/permission denied/i);
    await expect(asUser(engManager, (c) => c.query(`DELETE FROM maturity_scores WHERE id = $1`, [scoreId]))).rejects.toThrow(/permission denied/i);
  });

  it("6. a finalized MaturityAssessment is immutable — direct SQL UPDATE rejected", async () => {
    const { assessmentId } = await buildFinalizedAssessment("FY6 (assessment immutability)", { a: "implemented", b: "implemented" });
    const result = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE maturity_assessments SET status = 'draft' WHERE id = $1`, [result.maturityAssessmentId])),
    ).rejects.toThrow(/immutable/i);
  });

  it("7. level classification at the exact scale boundaries (1 -> Ad Hoc, 5 -> Optimized)", async () => {
    const { assessmentId: lowId } = await buildFinalizedAssessment("FY7a (level low)", { a: "not_implemented", b: "not_implemented" });
    const low = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId: lowId }));
    expect(low).toMatchObject({ overallScore: 1, overallLevel: "Ad Hoc" });

    const { assessmentId: highId } = await buildFinalizedAssessment("FY7b (level high)", { a: "implemented", b: "implemented" });
    const high = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId: highId }));
    expect(high).toMatchObject({ overallScore: 5, overallLevel: "Optimized" });
  });

  it("8. domain-level half-up rounding at the exact .5 boundary (5,5,5,3 -> mean 4.5 -> rounds to 5)", async () => {
    // A dedicated 4-control domain, isolated from the shared 2-control
    // `domain` fixture above so this test's arithmetic is unambiguous.
    // controlC/controlD were created in `beforeAll`, before the library
    // was published (a published library's Control set is frozen).
    const roundingDomain = await asFixtureSetup((c) => createMaturityDomain(c, { tenantId: tenant, name: "Rounding Domain", code: "ROUNDING_DOMAIN" }));
    await asFixtureSetup((c) => linkMaturityDomainControl(c, { maturityDomainId: roundingDomain, controlId: controlA, tenantId: tenant }));
    await asFixtureSetup((c) => linkMaturityDomainControl(c, { maturityDomainId: roundingDomain, controlId: controlB, tenantId: tenant }));
    await asFixtureSetup((c) => linkMaturityDomainControl(c, { maturityDomainId: roundingDomain, controlId: controlC, tenantId: tenant }));
    await asFixtureSetup((c) => linkMaturityDomainControl(c, { maturityDomainId: roundingDomain, controlId: controlD, tenantId: tenant }));
    await asFixtureSetup((c) => createMaturityDomainWeight(c, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: roundingDomain, weight: 1 }));

    const { id: assessmentId } = await withRequestDb(engManager, (db) => createAssessment(db, engManager, { engagementId: engagement, assessmentType: "annual", periodLabel: "FY8 (rounding)" }));
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id, control_id FROM assessment_controls WHERE assessment_id = $1`, [assessmentId]));
    const acFor = (controlId: string) => rows.find((r: { control_id: string }) => r.control_id === controlId)!.id as string;
    // controlA=implemented(5), controlB=implemented(5), controlC=implemented(5), controlD=partially_implemented(3) -> mean 4.5.
    for (const [controlId, rating] of [
      [controlA, "implemented"],
      [controlB, "implemented"],
      [controlC, "implemented"],
      [controlD, "partially_implemented"],
    ] as const) {
      await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acFor(controlId), tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: rating }));
    }
    await withRequestDb(engManager, (db) => finalizeAssessment(db, engManager, { organisationId: org, engagementId: engagement, assessmentId }));

    const result = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    const roundingResult = result.domains.find((d) => d.maturityDomainId === roundingDomain)!;
    expect(roundingResult.score).toBe(5);
  });
});

// =============================================================================
// 2. Control eligibility (D3 applicability) and domain not-scorable states
// =============================================================================

describe("Maturity — control eligibility (D3 applicability)", () => {
  let tenant: string, org: string, engagement: string;
  let library: string, controlEligible: string, controlUndecided: string, controlNA: string;
  let domainMain: string, domainEmpty: string, domainAllNA: string;
  let engManager: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Maturity Eligibility Tenant");
      org = await createOrganisation(client, tenant, "Maturity Eligibility Client");
      engagement = await createEngagement(client, tenant, org, "Maturity Eligibility Engagement");
      engManager = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantEngagementMembership(client, engManager, engagement, "Engagement Manager");

      library = await createControlLibraryVersionFixture(client, { tenantId: tenant, versionLabel: "Maturity Eligibility Library" });
      controlEligible = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "E-01", title: "Eligible control" });
      controlUndecided = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "E-02", title: "Undecided control" });
      controlNA = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "E-03", title: "N/A control" });
      await publishControlLibraryVersionFixture(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      // domainMain: all 3 controls mapped — one goes not_applicable via D3.
      domainMain = await createMaturityDomain(client, { tenantId: tenant, name: "Main Domain", code: "ELIGIBILITY_MAIN" });
      await linkMaturityDomainControl(client, { maturityDomainId: domainMain, controlId: controlEligible, tenantId: tenant });
      await linkMaturityDomainControl(client, { maturityDomainId: domainMain, controlId: controlUndecided, tenantId: tenant });
      await linkMaturityDomainControl(client, { maturityDomainId: domainMain, controlId: controlNA, tenantId: tenant });
      await createMaturityDomainWeight(client, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domainMain, weight: 1 });

      // domainEmpty: exists, but no MaturityDomainControlMapping at all.
      domainEmpty = await createMaturityDomain(client, { tenantId: tenant, name: "Empty Domain", code: "ELIGIBILITY_EMPTY" });

      // domainAllNA: mapped ONLY to controlNA (which will be D3 not_applicable).
      domainAllNA = await createMaturityDomain(client, { tenantId: tenant, name: "All-N/A Domain", code: "ELIGIBILITY_ALL_NA" });
      await linkMaturityDomainControl(client, { maturityDomainId: domainAllNA, controlId: controlNA, tenantId: tenant });

      await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Eligibility Methodology", version: "v1.0" });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  it("N/A (D3) is excluded from the domain's denominator/numerator; undecided remains eligible; domains with no mapped controls or all-N/A controls are skipped, never fabricated as zero, and never block computation", async () => {
    const { id: scopeId } = await withRequestDb(engManager, (db) => createEngagementScope(db, engManager, { engagementId: engagement }));
    const scopeDetail = await withRequestDb(engManager, (db) => getEngagementScopeDetail(db, engManager, scopeId));
    const rowFor = (controlId: string) => scopeDetail.controlRows.find((r) => r.controlId === controlId)!;
    await withRequestDb(engManager, (db) => updateControlApplicability(db, engManager, { engagementScopeControlId: rowFor(controlEligible).id, decision: "applicable", rationale: null }));
    // controlUndecided is left 'undecided' deliberately.
    await withRequestDb(engManager, (db) => updateControlApplicability(db, engManager, { engagementScopeControlId: rowFor(controlNA).id, decision: "not_applicable", rationale: "Not relevant." }));
    await withRequestDb(engManager, (db) => lockEngagementScope(db, engManager, { engagementScopeId: scopeId }));

    const { id: assessmentId } = await withRequestDb(engManager, (db) => createAssessment(db, engManager, { engagementId: engagement, assessmentType: "annual", periodLabel: "FY (eligibility)" }));
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id, control_id FROM assessment_controls WHERE assessment_id = $1`, [assessmentId]));
    const acFor = (controlId: string) => rows.find((r: { control_id: string }) => r.control_id === controlId)!.id as string;
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acFor(controlEligible), tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" }));
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acFor(controlUndecided), tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "not_implemented" }));
    // controlNA is left unanswered entirely — irrelevant, since it's excluded by applicability regardless of any rating.
    await withRequestDb(engManager, (db) => finalizeAssessment(db, engManager, { organisationId: org, engagementId: engagement, assessmentId }));

    const result = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    // domainMain: only controlEligible(5, applicable) and controlUndecided(1, undecided) count -> mean 3.
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0]).toMatchObject({ maturityDomainId: domainMain, score: 3 });
    expect(result.overallScore).toBe(3);
    // domainEmpty and domainAllNA got no row at all — not fabricated, not blocking.
    expect(result.domains.some((d) => d.maturityDomainId === domainEmpty)).toBe(false);
    expect(result.domains.some((d) => d.maturityDomainId === domainAllNA)).toBe(false);
    const { rows: scoreRows } = await asFixtureSetup((c) => c.query(`SELECT maturity_domain_id FROM maturity_scores WHERE maturity_assessment_id = $1`, [result.maturityAssessmentId]));
    expect(scoreRows.map((r: { maturity_domain_id: string | null }) => r.maturity_domain_id).filter(Boolean)).toEqual([domainMain]);
  });
});

// =============================================================================
// 3. Methodology / weighting validation
// =============================================================================

describe("Maturity — methodology and weighting validation", () => {
  let tenant: string, org: string, engagement: string;
  let library: string, controlX: string, controlY: string;
  let domainX: string, domainY: string;
  let engManager: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Maturity Weighting Tenant");
      org = await createOrganisation(client, tenant, "Maturity Weighting Client");
      engagement = await createEngagement(client, tenant, org, "Maturity Weighting Engagement");
      engManager = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantEngagementMembership(client, engManager, engagement, "Engagement Manager");

      library = await createControlLibraryVersionFixture(client, { tenantId: tenant, versionLabel: "Maturity Weighting Library" });
      controlX = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "W-01", title: "Control X" });
      controlY = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "W-02", title: "Control Y" });
      await publishControlLibraryVersionFixture(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      domainX = await createMaturityDomain(client, { tenantId: tenant, name: "Domain X", code: "WEIGHT_X" });
      domainY = await createMaturityDomain(client, { tenantId: tenant, name: "Domain Y", code: "WEIGHT_Y" });
      await linkMaturityDomainControl(client, { maturityDomainId: domainX, controlId: controlX, tenantId: tenant });
      await linkMaturityDomainControl(client, { maturityDomainId: domainY, controlId: controlY, tenantId: tenant });
      // domainX weight 3, domainY weight 1 -> overall = (5*3 + 3*1)/4 = 4.5 -> round half up -> 5.
      await createMaturityDomainWeight(client, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domainX, weight: 3 });
      await createMaturityDomainWeight(client, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domainY, weight: 1 });
      await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Weighting Methodology", version: "v1.0" });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  it("domain-weighted overall arithmetic, including half-up rounding at the overall level: (5*3 + 3*1)/4 = 4.5 -> 5", async () => {
    const { id: assessmentId } = await withRequestDb(engManager, (db) => createAssessment(db, engManager, { engagementId: engagement, assessmentType: "annual", periodLabel: "FY (weighting)" }));
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id, control_id FROM assessment_controls WHERE assessment_id = $1`, [assessmentId]));
    const acX = rows.find((r: { control_id: string }) => r.control_id === controlX)!.id as string;
    const acY = rows.find((r: { control_id: string }) => r.control_id === controlY)!.id as string;
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acX, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" })); // 5
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: acY, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "partially_implemented" })); // 3
    await withRequestDb(engManager, (db) => finalizeAssessment(db, engManager, { organisationId: org, engagementId: engagement, assessmentId }));

    const result = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    expect(result.domains.find((d) => d.maturityDomainId === domainX)?.score).toBe(5);
    expect(result.domains.find((d) => d.maturityDomainId === domainY)?.score).toBe(3);
    expect(result.overallScore).toBe(5);
  });

  it("an invalid/incomplete methodology rating mapping fails safely (surfaced as incomplete, never a silently assigned value)", async () => {
    const localTenant = await asFixtureSetup((c) => createTenant(c, "Maturity Bad Mapping Tenant"));
    const localOrg = await asFixtureSetup((c) => createOrganisation(c, localTenant, "Maturity Bad Mapping Client"));
    const localEngagement = await asFixtureSetup((c) => createEngagement(c, localTenant, localOrg, "Maturity Bad Mapping Engagement"));
    const localManager = await asFixtureSetup((c) => createUser(c, { tenantId: localTenant, clientOrgId: localOrg }));
    await asFixtureSetup((c) => grantEngagementMembership(c, localManager, localEngagement, "Engagement Manager"));
    const localLibrary = await asFixtureSetup((c) => createControlLibraryVersionFixture(c, { tenantId: localTenant, versionLabel: "Bad Mapping Library" }));
    const localControl = await asFixtureSetup((c) => createControlFixture(c, { tenantId: localTenant, controlLibraryVersionId: localLibrary, code: "BM-01", title: "Bad mapping control" }));
    await asFixtureSetup((c) => publishControlLibraryVersionFixture(c, localLibrary));
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, localEngagement, localLibrary));
    const localDomain = await asFixtureSetup((c) => createMaturityDomain(c, { tenantId: localTenant, name: "Bad Mapping Domain", code: "BAD_MAPPING" }));
    await asFixtureSetup((c) => linkMaturityDomainControl(c, { maturityDomainId: localDomain, controlId: localControl, tenantId: localTenant }));
    await asFixtureSetup((c) => createMaturityDomainWeight(c, { engagementId: localEngagement, organisationId: localOrg, tenantId: localTenant, maturityDomainId: localDomain, weight: 1 }));
    // A methodology whose rating_scores omits 'implemented' entirely.
    await asFixtureSetup((c) =>
      createMaturityScoringMethodology(c, {
        tenantId: localTenant, name: "Incomplete Methodology", version: "v1.0",
        definition: { rating_scores: { not_implemented: 1, partially_implemented: 3 }, levels: [] },
      }),
    );

    const { id: assessmentId } = await withRequestDb(localManager, (db) => createAssessment(db, localManager, { engagementId: localEngagement, assessmentType: "annual", periodLabel: "FY (bad mapping)" }));
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id FROM assessment_controls WHERE assessment_id = $1`, [assessmentId]));
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: rows[0].id, tenantId: localTenant, organisationId: localOrg, engagementId: localEngagement, effectivenessRating: "implemented" }));
    await withRequestDb(localManager, (db) => finalizeAssessment(db, localManager, { organisationId: localOrg, engagementId: localEngagement, assessmentId }));

    let thrown: unknown;
    try {
      await withRequestDb(localManager, (db) => computeAndFinalizeMaturityAssessment(db, localManager, { assessmentId }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(IncompleteMaturityDataError);
    const { rows: maRows } = await asFixtureSetup((c) => c.query(`SELECT id FROM maturity_assessments WHERE assessment_id = $1`, [assessmentId]));
    expect(maRows).toHaveLength(0);
  });

  it("a missing MaturityDomainWeight for an otherwise-complete, scorable domain fails safely — never treated as weight 0 or 1", async () => {
    const localTenant = await asFixtureSetup((c) => createTenant(c, "Maturity Missing Weight Tenant"));
    const localOrg = await asFixtureSetup((c) => createOrganisation(c, localTenant, "Maturity Missing Weight Client"));
    const localEngagement = await asFixtureSetup((c) => createEngagement(c, localTenant, localOrg, "Maturity Missing Weight Engagement"));
    const localManager = await asFixtureSetup((c) => createUser(c, { tenantId: localTenant, clientOrgId: localOrg }));
    await asFixtureSetup((c) => grantEngagementMembership(c, localManager, localEngagement, "Engagement Manager"));
    const localLibrary = await asFixtureSetup((c) => createControlLibraryVersionFixture(c, { tenantId: localTenant, versionLabel: "Missing Weight Library" }));
    const localControl = await asFixtureSetup((c) => createControlFixture(c, { tenantId: localTenant, controlLibraryVersionId: localLibrary, code: "MW-01", title: "Missing weight control" }));
    await asFixtureSetup((c) => publishControlLibraryVersionFixture(c, localLibrary));
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, localEngagement, localLibrary));
    const localDomain = await asFixtureSetup((c) => createMaturityDomain(c, { tenantId: localTenant, name: "Missing Weight Domain", code: "MISSING_WEIGHT" }));
    await asFixtureSetup((c) => linkMaturityDomainControl(c, { maturityDomainId: localDomain, controlId: localControl, tenantId: localTenant }));
    // Deliberately NO MaturityDomainWeight row for (localEngagement, localDomain).
    await asFixtureSetup((c) => createMaturityScoringMethodology(c, { tenantId: localTenant, name: "Missing Weight Methodology", version: "v1.0" }));

    const { id: assessmentId } = await withRequestDb(localManager, (db) => createAssessment(db, localManager, { engagementId: localEngagement, assessmentType: "annual", periodLabel: "FY (missing weight)" }));
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id FROM assessment_controls WHERE assessment_id = $1`, [assessmentId]));
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: rows[0].id, tenantId: localTenant, organisationId: localOrg, engagementId: localEngagement, effectivenessRating: "implemented" }));
    await withRequestDb(localManager, (db) => finalizeAssessment(db, localManager, { organisationId: localOrg, engagementId: localEngagement, assessmentId }));

    await expect(withRequestDb(localManager, (db) => computeAndFinalizeMaturityAssessment(db, localManager, { assessmentId }))).rejects.toThrow(
      MissingMaturityDomainWeightError,
    );
    const { rows: maRows } = await asFixtureSetup((c) => c.query(`SELECT id FROM maturity_assessments WHERE assessment_id = $1`, [assessmentId]));
    expect(maRows).toHaveLength(0);
  });

  it("no active MaturityScoringMethodology for the tenant fails safely", async () => {
    const localTenant = await asFixtureSetup((c) => createTenant(c, "Maturity No Methodology Tenant"));
    const localOrg = await asFixtureSetup((c) => createOrganisation(c, localTenant, "Maturity No Methodology Client"));
    const localEngagement = await asFixtureSetup((c) => createEngagement(c, localTenant, localOrg, "Maturity No Methodology Engagement"));
    const localManager = await asFixtureSetup((c) => createUser(c, { tenantId: localTenant, clientOrgId: localOrg }));
    await asFixtureSetup((c) => grantEngagementMembership(c, localManager, localEngagement, "Engagement Manager"));
    const localLibrary = await asFixtureSetup((c) => createControlLibraryVersionFixture(c, { tenantId: localTenant, versionLabel: "No Methodology Library" }));
    await asFixtureSetup((c) => createControlFixture(c, { tenantId: localTenant, controlLibraryVersionId: localLibrary, code: "NM-01", title: "No methodology control" }));
    await asFixtureSetup((c) => publishControlLibraryVersionFixture(c, localLibrary));
    await asFixtureSetup((c) => pinEngagementControlLibraryVersion(c, localEngagement, localLibrary));
    // Deliberately no MaturityScoringMethodology row at all for localTenant.

    const { id: assessmentId } = await withRequestDb(localManager, (db) => createAssessment(db, localManager, { engagementId: localEngagement, assessmentType: "annual", periodLabel: "FY (no methodology)" }));
    await withRequestDb(localManager, (db) => finalizeAssessment(db, localManager, { organisationId: localOrg, engagementId: localEngagement, assessmentId }));

    await expect(withRequestDb(localManager, (db) => computeAndFinalizeMaturityAssessment(db, localManager, { assessmentId }))).rejects.toThrow(
      NoActiveMaturityMethodologyError,
    );
  });
});

// =============================================================================
// 4. Non-numeric-effect assertions — ControlTest / Evidence /
//    Risk-Finding-Remediation-Validation never mathematically change
//    maturity (DECISIONS.md R-79/R-80, PRODUCT_SPEC.md Principle 8,
//    ARCHITECTURE.md's own maturity rule — reaffirmed, not re-litigated).
// =============================================================================

describe("Maturity — ControlTest/Evidence/Risk do not alter the numeric score", () => {
  let tenant: string, org: string, engagement: string;
  let library: string, controlP: string, controlQ: string;
  let domain: string;
  let engManager: string;
  let assessmentId: string, acP: string, acQ: string, responseP: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Maturity Non-Numeric Tenant");
      org = await createOrganisation(client, tenant, "Maturity Non-Numeric Client");
      engagement = await createEngagement(client, tenant, org, "Maturity Non-Numeric Engagement");
      engManager = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantEngagementMembership(client, engManager, engagement, "Engagement Manager");

      library = await createControlLibraryVersionFixture(client, { tenantId: tenant, versionLabel: "Non-Numeric Library" });
      controlP = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "N-01", title: "Control P" });
      controlQ = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "N-02", title: "Control Q" });
      await publishControlLibraryVersionFixture(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      domain = await createMaturityDomain(client, { tenantId: tenant, name: "Non-Numeric Domain", code: "NON_NUMERIC" });
      await linkMaturityDomainControl(client, { maturityDomainId: domain, controlId: controlP, tenantId: tenant });
      await linkMaturityDomainControl(client, { maturityDomainId: domain, controlId: controlQ, tenantId: tenant });
      await createMaturityDomainWeight(client, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 1 });
      await createMaturityScoringMethodology(client, { tenantId: tenant, name: "Non-Numeric Methodology", version: "v1.0" });
      await createRiskScoringModel(client, { tenantId: tenant, name: "Non-Numeric Risk Matrix", version: "v1.0" });
    });

    // Built via withRequestDb (real app paths), not raw fixtures — this
    // describe block specifically proves the REAL ControlTest/Evidence/
    // Risk write paths have no numeric effect, so the surrounding
    // scaffolding uses them too, not just the object under test.
    const created = await withRequestDb(engManager, (db) => createAssessment(db, engManager, { engagementId: engagement, assessmentType: "annual", periodLabel: "FY (non-numeric)" }));
    assessmentId = created.id;
    const rows = await asFixtureSetup((c) => c.query(`SELECT id, control_id FROM assessment_controls WHERE assessment_id = $1`, [assessmentId]));
    acP = rows.rows.find((r: { control_id: string }) => r.control_id === controlP)!.id as string;
    acQ = rows.rows.find((r: { control_id: string }) => r.control_id === controlQ)!.id as string;

    // controlP rated implemented(5); a contradictory FAILING ControlTest
    // and a Risk with a HIGH residual rating are both attached to it —
    // neither should move the score away from what the rating alone
    // implies. Evidence must be uploaded before finalization (evidence
    // upload is blocked on a finalized Assessment) — added to controlP's
    // own response.
    await withRequestDb(engManager, (db) =>
      updateAssessmentResponse(db, engManager, { assessmentControlId: acP, effectivenessRating: "implemented", decisionRationale: null }),
    );
    responseP = (
      await asFixtureSetup((c) => c.query(`SELECT id FROM assessment_responses WHERE assessment_control_id = $1`, [acP]))
    ).rows[0].id as string;
    await withRequestDb(engManager, (db) =>
      updateAssessmentResponse(db, engManager, { assessmentControlId: acQ, effectivenessRating: "partially_implemented", decisionRationale: null }),
    );

    await withRequestDb(engManager, (db) =>
      createControlTest(db, engManager, {
        assessmentId,
        controlId: controlP,
        methodology: "Contradictory manual walkthrough — deliberately a FAIL despite the 'implemented' response, to prove ControlTest has no numeric effect.",
        sampleDescription: null,
        result: "fail",
        testedAt: null,
      }),
    );

    await withRequestDb(engManager, (db) =>
      uploadEvidence(db, engManager, {
        organisationId: org,
        engagementId: engagement,
        title: "Non-numeric-effect evidence",
        evidenceType: "policy_document",
        linkTo: { type: "assessment_response", assessmentResponseId: responseP },
        file: textFile(),
      }),
    );

    await withRequestDb(engManager, (db) =>
      createRisk(db, engManager, {
        assessmentId,
        controlId: controlP,
        title: "Non-numeric-effect risk",
        description: null,
        likelihood: 5,
        impact: 5,
        inherentRating: "critical",
        residualLikelihood: 5,
        residualImpact: 5,
        residualRating: "critical",
        assignOwnerToSelf: false,
      }),
    );

    await withRequestDb(engManager, (db) => finalizeAssessment(db, engManager, { organisationId: org, engagementId: engagement, assessmentId }));
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  it("ControlTest, Evidence, and Risk (residual rating) are all present on the scored controls, but the maturity score is exactly what the AssessmentResponse ratings alone imply — (5+3)/2=4", async () => {
    const result = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    expect(result.domains.find((d) => d.maturityDomainId === domain)?.score).toBe(4);
    expect(result.overallScore).toBe(4);

    // ControlTest appears in traceability, never in the score itself.
    const { rows: scoreRows } = await asFixtureSetup((c) => c.query(`SELECT computed_from_control_test_ids FROM maturity_scores WHERE maturity_assessment_id = $1 AND maturity_domain_id = $2`, [result.maturityAssessmentId, domain]));
    expect(scoreRows[0]!.computed_from_control_test_ids).not.toBeNull();
    expect(scoreRows[0]!.computed_from_control_test_ids.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 5. Historical integrity
// =============================================================================

describe("Maturity — historical integrity", () => {
  let tenant: string, org: string, engagement: string;
  let library: string, control1: string, control2: string;
  let domain: string;
  let engManager: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenant = await createTenant(client, "Maturity History Tenant");
      org = await createOrganisation(client, tenant, "Maturity History Client");
      engagement = await createEngagement(client, tenant, org, "Maturity History Engagement");
      engManager = await createUser(client, { tenantId: tenant, clientOrgId: org });
      await grantEngagementMembership(client, engManager, engagement, "Engagement Manager");

      library = await createControlLibraryVersionFixture(client, { tenantId: tenant, versionLabel: "History Library" });
      control1 = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "H-01", title: "Control 1" });
      control2 = await createControlFixture(client, { tenantId: tenant, controlLibraryVersionId: library, code: "H-02", title: "Control 2" });
      await publishControlLibraryVersionFixture(client, library);
      await pinEngagementControlLibraryVersion(client, engagement, library);

      domain = await createMaturityDomain(client, { tenantId: tenant, name: "Original Domain Name", code: "HISTORY_DOMAIN" });
      await linkMaturityDomainControl(client, { maturityDomainId: domain, controlId: control1, tenantId: tenant });
      await linkMaturityDomainControl(client, { maturityDomainId: domain, controlId: control2, tenantId: tenant });
      await createMaturityDomainWeight(client, { engagementId: engagement, organisationId: org, tenantId: tenant, maturityDomainId: domain, weight: 1 });
      await createMaturityScoringMethodology(client, { tenantId: tenant, name: "History Methodology", version: "v1.0" });
    });
  });

  // Note: `pool.end()` is called only once for this file, in the final
  // describe block below.

  it("revising the Engagement's Scope AFTER maturity has been computed never changes the already-computed result", async () => {
    const { id: scopeId } = await withRequestDb(engManager, (db) => createEngagementScope(db, engManager, { engagementId: engagement }));
    const scopeDetail = await withRequestDb(engManager, (db) => getEngagementScopeDetail(db, engManager, scopeId));
    const row1 = scopeDetail.controlRows.find((r) => r.controlId === control1)!;
    const row2 = scopeDetail.controlRows.find((r) => r.controlId === control2)!;
    await withRequestDb(engManager, (db) => updateControlApplicability(db, engManager, { engagementScopeControlId: row1.id, decision: "applicable", rationale: null }));
    await withRequestDb(engManager, (db) => updateControlApplicability(db, engManager, { engagementScopeControlId: row2.id, decision: "not_applicable", rationale: "Out of scope initially." }));
    await withRequestDb(engManager, (db) => lockEngagementScope(db, engManager, { engagementScopeId: scopeId }));

    const { id: assessmentId } = await withRequestDb(engManager, (db) => createAssessment(db, engManager, { engagementId: engagement, assessmentType: "annual", periodLabel: "FY (history 1)" }));
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id, control_id FROM assessment_controls WHERE assessment_id = $1`, [assessmentId]));
    const ac1 = rows.find((r: { control_id: string }) => r.control_id === control1)!.id as string;
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: ac1, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" }));
    // control2 is not_applicable, so it needs no response at all.
    await withRequestDb(engManager, (db) => finalizeAssessment(db, engManager, { organisationId: org, engagementId: engagement, assessmentId }));

    const computed = await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));
    expect(computed.overallScore).toBe(5); // only control1 (implemented=5) is eligible.

    // Revise the Scope AFTER maturity was computed — flip control2 to applicable.
    const { id: revisedScopeId } = await withRequestDb(engManager, (db) => reviseEngagementScope(db, engManager, { previousScopeId: scopeId }));
    const revised = await withRequestDb(engManager, (db) => getEngagementScopeDetail(db, engManager, revisedScopeId));
    await withRequestDb(engManager, (db) =>
      updateControlApplicability(db, engManager, { engagementScopeControlId: revised.controlRows.find((r) => r.controlId === control2)!.id, decision: "applicable", rationale: null }),
    );
    await withRequestDb(engManager, (db) => lockEngagementScope(db, engManager, { engagementScopeId: revisedScopeId }));

    // The already-computed MaturityAssessment is completely unaffected.
    const reread = await withRequestDb(engManager, (db) => getMaturityAssessmentForAssessment(db, engManager, { assessmentId, organisationId: org, engagementId: engagement }));
    expect(reread).toMatchObject({ overallScore: 5, overallLevel: "Optimized" });
  });

  it("renaming the live MaturityDomain after computing does not rewrite the historical result — the read reflects the frozen domain_name_snapshot", async () => {
    const { id: assessmentId } = await withRequestDb(engManager, (db) => createAssessment(db, engManager, { engagementId: engagement, assessmentType: "annual", periodLabel: "FY (history 2)" }));
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id, control_id FROM assessment_controls WHERE assessment_id = $1`, [assessmentId]));
    const ac1 = rows.find((r: { control_id: string }) => r.control_id === control1)!.id as string;
    const ac2 = rows.find((r: { control_id: string }) => r.control_id === control2)!.id as string;
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: ac1, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" }));
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: ac2, tenantId: tenant, organisationId: org, engagementId: engagement, effectivenessRating: "implemented" }));
    await withRequestDb(engManager, (db) => finalizeAssessment(db, engManager, { organisationId: org, engagementId: engagement, assessmentId }));
    await withRequestDb(engManager, (db) => computeAndFinalizeMaturityAssessment(db, engManager, { assessmentId }));

    // Rename the LIVE domain (an ordinarily mutable field — Milestone 8A).
    await asFixtureSetup((c) => c.query(`UPDATE maturity_domains SET name = 'Renamed Domain' WHERE id = $1`, [domain]));

    const reread = await withRequestDb(engManager, (db) => getMaturityAssessmentForAssessment(db, engManager, { assessmentId, organisationId: org, engagementId: engagement }));
    expect(reread!.domains.find((d) => d.maturityDomainId === domain)?.domainName).toBe("Original Domain Name");
  });
});

// =============================================================================
// 6. Authorization and security
// =============================================================================

describe("Maturity — authorization and security", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgB: string;
  let engagementA: string, engagementOtherA: string, engagementB: string;
  let libraryA: string, controlA: string;
  let domainA: string;
  let assessmentAId: string;
  let engManagerA: string, consultantA: string, clientAdminA: string, engManagerB: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Maturity Security Tenant A");
      tenantB = await createTenant(client, "Maturity Security Tenant B");
      orgA = await createOrganisation(client, tenantA, "Maturity Security Client A");
      orgB = await createOrganisation(client, tenantB, "Maturity Security Client B");
      engagementA = await createEngagement(client, tenantA, orgA, "Maturity Security Engagement A");
      engagementOtherA = await createEngagement(client, tenantA, orgA, "Maturity Security Engagement A (other)");
      engagementB = await createEngagement(client, tenantB, orgB, "Maturity Security Engagement B");

      libraryA = await createControlLibraryVersionFixture(client, { tenantId: tenantA, versionLabel: "Security Library A" });
      controlA = await createControlFixture(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "S-01", title: "Security control" });
      await publishControlLibraryVersionFixture(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);

      domainA = await createMaturityDomain(client, { tenantId: tenantA, name: "Security Domain", code: "SECURITY_DOMAIN" });
      await linkMaturityDomainControl(client, { maturityDomainId: domainA, controlId: controlA, tenantId: tenantA });
      await createMaturityDomainWeight(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, maturityDomainId: domainA, weight: 1 });
      await createMaturityScoringMethodology(client, { tenantId: tenantA, name: "Security Methodology A", version: "v1.0" });

      engManagerA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      consultantA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      clientAdminA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      engManagerB = await createUser(client, { tenantId: tenantB, clientOrgId: orgB });
      await grantEngagementMembership(client, engManagerA, engagementA, "Engagement Manager");
      await grantEngagementMembership(client, consultantA, engagementA, "Consultant");
      await grantOrganisationMembership(client, clientAdminA, orgA, "Client Administrator");
      await grantEngagementMembership(client, engManagerB, engagementB, "Engagement Manager");
    });

    const { id } = await withRequestDb(engManagerA, (db) => createAssessment(db, engManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "FY (security)" }));
    assessmentAId = id;
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id FROM assessment_controls WHERE assessment_id = $1`, [assessmentAId]));
    await asFixtureSetup((c) => createAssessmentResponse(c, { assessmentControlId: rows[0].id, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, effectivenessRating: "implemented" }));
    await withRequestDb(engManagerA, (db) => finalizeAssessment(db, engManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: assessmentAId }));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("1/2. only the Engagement Manager (maturity.compute) can compute — a Consultant (engagement member, no maturity.compute) and a Client Administrator (organisation-only membership) both cannot", async () => {
    await expect(withRequestDb(consultantA, (db) => computeAndFinalizeMaturityAssessment(db, consultantA, { assessmentId: assessmentAId }))).rejects.toThrow(
      NotFoundOrForbiddenError,
    );
    await expect(withRequestDb(clientAdminA, (db) => computeAndFinalizeMaturityAssessment(db, clientAdminA, { assessmentId: assessmentAId }))).rejects.toThrow(
      NotFoundOrForbiddenError,
    );
    // Proves the block above is real access control, not a broken pipe.
    const result = await withRequestDb(engManagerA, (db) => computeAndFinalizeMaturityAssessment(db, engManagerA, { assessmentId: assessmentAId }));
    expect(result.maturityAssessmentId).toBeTruthy();
  });

  it("3. a cross-tenant assessment id is rejected — Tenant B's Engagement Manager cannot compute maturity for Tenant A's Assessment", async () => {
    await expect(withRequestDb(engManagerB, (db) => computeAndFinalizeMaturityAssessment(db, engManagerB, { assessmentId: assessmentAId }))).rejects.toThrow(
      NotFoundOrForbiddenError,
    );
  });

  it("4. cross-tenant MaturityAssessment read is rejected — via the domain function AND raw SQL (0 rows)", async () => {
    const { rows: existing } = await asFixtureSetup((c) => c.query(`SELECT id FROM maturity_assessments WHERE assessment_id = $1`, [assessmentAId]));
    if (existing.length === 0) {
      // Not yet computed by an earlier test in this describe block's own
      // execution order — compute it now so this test has a real result
      // to prove is unreadable cross-tenant.
      await withRequestDb(engManagerA, (db) => computeAndFinalizeMaturityAssessment(db, engManagerA, { assessmentId: assessmentAId }));
    }
    // engManagerB is genuinely authorized on their OWN (orgB, engagementB)
    // — the read is authorized, but the query itself (scoped to
    // engagementB) can never match Tenant A's row, so it returns null,
    // never Tenant A's data. No cross-tenant leak either way.
    const crossTenantRead = await withRequestDb(engManagerB, (db) =>
      getMaturityAssessmentForAssessment(db, engManagerB, { assessmentId: assessmentAId, organisationId: orgB, engagementId: engagementB }),
    );
    expect(crossTenantRead).toBeNull();

    const rows = await asUser(engManagerB, (c) => c.query(`SELECT id FROM maturity_assessments WHERE assessment_id = $1`, [assessmentAId]));
    expect(rows.rows).toHaveLength(0);
  });

  it("5. wrong engagement/organisation combination — a legitimate Tenant A Engagement Manager cannot read Tenant A's own MaturityAssessment through an engagement they are not staffed on", async () => {
    await expect(
      withRequestDb(engManagerA, (db) => getMaturityAssessmentForAssessment(db, engManagerA, { assessmentId: assessmentAId, organisationId: orgA, engagementId: engagementOtherA })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("6. organisation-only membership (Client Administrator) attempting compute is rejected even with real, correct ids (not merely a lookup failure)", async () => {
    // canComputeMaturity itself returns false for the org-scoped role —
    // proves this is a real permission check, not an incidental 404.
    expect(await withRequestDb(clientAdminA, (db) => canComputeMaturity(db, clientAdminA, engagementA, orgA))).toBe(false);
    expect(await withRequestDb(engManagerA, (db) => canComputeMaturity(db, engManagerA, engagementA, orgA))).toBe(true);
  });

  it("7/8. direct database attempts bypass neither tenant isolation nor immutability", async () => {
    // Tenant B forging an INSERT into maturity_assessments citing Tenant
    // A's real ids — rejected by RLS (migration 0030's narrowed INSERT
    // policy), not merely by the application layer.
    const activeMethodologyId = await asFixtureSetup(async (c) => {
      const { rows } = await c.query(`SELECT id FROM maturity_scoring_methodologies WHERE tenant_id = $1 AND is_active = true LIMIT 1`, [tenantA]);
      return rows[0].id as string;
    });
    await expect(
      asUser(engManagerB, (c) =>
        c.query(
          `INSERT INTO maturity_assessments (engagement_id, organisation_id, tenant_id, assessment_id, maturity_scoring_methodology_id) VALUES ($1, $2, $3, $4, $5)`,
          [engagementA, orgA, tenantA, assessmentAId, activeMethodologyId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    // Direct mutation of an already-computed, immutable score — the
    // grant-level backstop, independent of RLS policy logic entirely.
    const { rows: scoreRows } = await asFixtureSetup((c) =>
      c.query(`SELECT ms.id FROM maturity_scores ms JOIN maturity_assessments ma ON ma.id = ms.maturity_assessment_id WHERE ma.assessment_id = $1 LIMIT 1`, [assessmentAId]),
    );
    await expect(asUser(engManagerA, (c) => c.query(`UPDATE maturity_scores SET score = 1 WHERE id = $1`, [scoreRows[0].id]))).rejects.toThrow(/permission denied/i);
  });
});
