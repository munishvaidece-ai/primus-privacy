// Milestone 7 instructions §13: "Do not use unrestricted polymorphic
// relationships for core Risk/Finding/Remediation relationships where
// explicit FK relationships are practical. Preserve referential
// integrity... the database should reject inconsistent combinations."
// Also covers §12's database-level (not RLS-level — see
// tenant-isolation.test.ts) cross-tenant/cross-organisation rejection
// tests: "Cross-tenant remediation relationships are rejected.
// Cross-organisation remediation relationships are rejected. Validation
// cannot attach to a remediation belonging to another tenant."
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asFixtureSetup,
  createControl,
  createControlLibraryVersion,
  createEngagement,
  createFinding,
  createOrganisation,
  createProcessingActivity,
  createRemediationAction,
  createRisk,
  createRiskScoringModel,
  createTenant,
  createValidationRecord,
  linkFindingProcessingActivity,
  linkRemediationRisk,
  linkRiskControl,
  linkRiskProcessingActivity,
  pool,
  publishControlLibraryVersion,
} from "./helpers";

describe("Referential integrity across engagements/organisations/tenants (CRITICAL)", () => {
  let tenantA: string, tenantB: string;
  let orgA1: string, orgA2: string;
  let engagementA1: string, engagementA2: string;
  let libraryA: string, controlA: string, libraryB: string, controlB: string;
  let scoringModelA: string;
  let paA1: string;
  let riskA1: string;
  let remediationA1: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Consistency tenant A");
      tenantB = await createTenant(client, "Consistency tenant B");
      orgA1 = await createOrganisation(client, tenantA, "Consistency org A1");
      orgA2 = await createOrganisation(client, tenantA, "Consistency org A2");
      engagementA1 = await createEngagement(client, tenantA, orgA1, "Consistency engagement A1");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Consistency engagement A2");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Consistency Library A" });
      controlA = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "CONS-A", title: "Consistency control A" });
      await publishControlLibraryVersion(client, libraryA);

      libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Consistency Library B" });
      controlB = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "CONS-B", title: "Consistency control B" });
      await publishControlLibraryVersion(client, libraryB);

      scoringModelA = await createRiskScoringModel(client, { tenantId: tenantA, name: "Consistency Matrix", version: "v1.0" });
      paA1 = await createProcessingActivity(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, name: "Consistency PA A1" });

      riskA1 = await createRisk(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, riskScoringModelId: scoringModelA, title: "Consistency risk A1", likelihood: 3, impact: 3, inherentRating: "medium" });
      remediationA1 = await createRemediationAction(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, title: "Consistency remediation A1" });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a RiskControl cannot reference a Control from a different Tenant", async () => {
    await expect(
      asFixtureSetup((c) => linkRiskControl(c, { riskId: riskA1, controlId: controlB, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1 })),
    ).rejects.toThrow(/violates foreign key constraint|control_tenant_fk/i);
  });

  it("a RiskProcessingActivity cannot reference a ProcessingActivity from a different Engagement (same Tenant)", async () => {
    const paA2 = await asFixtureSetup((c) => createProcessingActivity(c, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, name: "Consistency PA A2" }));
    await expect(
      asFixtureSetup((c) => linkRiskProcessingActivity(c, { riskId: riskA1, processingActivityId: paA2, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1 })),
    ).rejects.toThrow(/violates foreign key constraint|processing_activity_scope_fk/i);
  });

  it("a Finding cannot reference a ProcessingActivity from a different Engagement — the exact §13 example", async () => {
    const findingA1 = await asFixtureSetup((c) => createFinding(c, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, title: "Consistency finding A1" }));
    const paA2 = await asFixtureSetup((c) => createProcessingActivity(c, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, name: "Consistency PA A2 for finding" }));
    await expect(
      asFixtureSetup((c) => linkFindingProcessingActivity(c, { findingId: findingA1, processingActivityId: paA2, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1 })),
    ).rejects.toThrow(/violates foreign key constraint|processing_activity_scope_fk/i);
  });

  it("a Finding CAN reference a ProcessingActivity from the same Engagement", async () => {
    const findingA1 = await asFixtureSetup((c) => createFinding(c, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, title: "Consistency finding A1 (matched)" }));
    const linkId = await asFixtureSetup((c) => linkFindingProcessingActivity(c, { findingId: findingA1, processingActivityId: paA1, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1 }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT processing_activity_id FROM finding_processing_activities WHERE id = $1", [linkId]));
    expect(rows[0]!.processing_activity_id).toBe(paA1);
  });

  // §12: "Cross-tenant remediation relationships are rejected."
  it("cross-tenant remediation relationships are rejected at the database level", async () => {
    const riskB = await asFixtureSetup(async (c) => {
      const orgB = await createOrganisation(c, tenantB, "Consistency org B");
      const engagementB = await createEngagement(c, tenantB, orgB, "Consistency engagement B");
      const modelB = await createRiskScoringModel(c, { tenantId: tenantB, name: "Consistency Matrix B", version: "v1.0" });
      return createRisk(c, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, riskScoringModelId: modelB, title: "Tenant B risk", likelihood: 2, impact: 2, inherentRating: "low" });
    });
    await expect(
      asFixtureSetup((c) => linkRemediationRisk(c, { remediationActionId: remediationA1, riskId: riskB, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1 })),
    ).rejects.toThrow(/violates foreign key constraint|risk_scope_fk/i);
  });

  // §12: "Cross-organisation remediation relationships are rejected."
  it("cross-organisation remediation relationships are rejected at the database level (same tenant)", async () => {
    const riskA2 = await asFixtureSetup((c) =>
      createRisk(c, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, riskScoringModelId: scoringModelA, title: "Org A2 risk", likelihood: 2, impact: 2, inherentRating: "low" }),
    );
    await expect(
      asFixtureSetup((c) => linkRemediationRisk(c, { remediationActionId: remediationA1, riskId: riskA2, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1 })),
    ).rejects.toThrow(/violates foreign key constraint|risk_scope_fk/i);
  });

  // §12: "Validation cannot attach to a remediation belonging to another tenant."
  it("a ValidationRecord cannot attach to a RemediationAction belonging to another tenant", async () => {
    await expect(
      asFixtureSetup((c) => createValidationRecord(c, { remediationActionId: remediationA1, tenantId: tenantB, organisationId: orgA1, engagementId: engagementA1, outcome: "accepted" })),
    ).rejects.toThrow(/violates foreign key constraint|remediation_action_scope_fk/i);
  });
});
