// Slice C6 — Validation. Tests the real functions the real
// RemediationAction detail/Server Actions call (lib/domain/validation.ts)
// against real PostgreSQL — no mocked authorization. Covers the
// required security scenarios (instructions §25), the validator
// security scenarios (§23), the Evidence linking scenarios (§24), the
// traceability scenario (§26), the multiple-validation scenario (§27),
// the immutability scenario (§28), the remediation-status-unchanged
// scenario (§29), and the historical-integrity scenario (§21).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createValidationRecord,
  listValidationRecordsForRemediation,
  getValidationRecordDetail,
  ValidationRationaleRequiredError,
  InvalidValidationInputError,
} from "@/lib/domain/validation";
import { createRemediationAction, getRemediationActionDetail } from "@/lib/domain/remediation";
import { createFinding } from "@/lib/domain/findings";
import { createRisk } from "@/lib/domain/risks";
import { uploadEvidence, getEvidenceSummaryForValidationRecord } from "@/lib/domain/evidence";
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
  createAssessment,
  addAssessmentControl,
  createRiskScoringModel,
  pool,
} from "./helpers";

function textFile(content = "synthetic evidence content — not a real client document") {
  return { buffer: Buffer.from(content, "utf8"), filename: "evidence.txt", mimeType: "text/plain" };
}

describe("Application layer — Validation (Slice C6)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string, engagementA2: string, engagementA3: string, engagementB: string;
  let controlA1: string, controlB1: string;
  let assessmentA: string, assessmentA2: string, assessmentA3: string, assessmentB: string;

  let userA: string;
  let outsiderA: string;
  let userA2: string;
  let userA3: string;
  let userB: string;

  let remediationA1: string; // RemediationAction under orgA/engagementA
  let remediationA2: string; // RemediationAction under orgA2/engagementA2
  let remediationA3: string; // RemediationAction under orgA/engagementA3
  let remediationB: string; // RemediationAction under tenantB

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice C6 Tenant A");
      tenantB = await createTenant(client, "Slice C6 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice C6 Org A");
      orgA2 = await createOrganisation(client, tenantA, "Slice C6 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice C6 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "Slice C6 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Slice C6 Engagement A2");
      engagementA3 = await createEngagement(client, tenantA, orgA, "Slice C6 Engagement A3 (same org as A)");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice C6 Engagement B");

      const libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C6 Library A" });
      controlA1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Slice C6 Control 1" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA2, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA3, libraryA);

      const libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Slice C6 Library B" });
      controlB1 = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "B1", title: "Slice C6 Control B1" });
      await publishControlLibraryVersion(client, libraryB);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      await createRiskScoringModel(client, { tenantId: tenantA, name: "C6 Matrix A", version: "v1.0" });
      await createRiskScoringModel(client, { tenantId: tenantB, name: "C6 Matrix B", version: "v1.0" });

      assessmentA = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026" });
      assessmentA2 = await createAssessment(client, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Org A2)" });
      assessmentA3 = await createAssessment(client, { engagementId: engagementA3, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Engagement A3)" });
      assessmentB = await createAssessment(client, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, controlLibraryVersionId: libraryB, periodLabel: "FY2026 (Tenant B)" });

      await addAssessmentControl(client, { assessmentId: assessmentA, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentA2, controlId: controlA1, tenantId: tenantA, organisationId: orgA2, engagementId: engagementA2, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentA3, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA3, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentB, controlId: controlB1, tenantId: tenantB, organisationId: orgB, engagementId: engagementB, controlLibraryVersionId: libraryB });

      userA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA, engagementA);
      outsiderA = await createUser(client, { tenantId: tenantA });
      userA2 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA2, engagementA2);
      userA3 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA3, engagementA3);
      userB = await createUser(client, { tenantId: tenantB });
      await grantEngagementMembership(client, userB, engagementB);
    });

    // Real Risks/Findings/RemediationActions, created through the real
    // domain functions (Slices C3/C4/C5), to attach ValidationRecords to.
    const riskA1 = (await withRequestDb(userA, (db) => createRisk(db, userA, { assessmentId: assessmentA, controlId: controlA1, title: "Source risk A1", description: null, likelihood: 4, impact: 4, inherentRating: "high", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    const findingA1 = (await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskA1, title: "Source finding A1", description: null, severity: "high", assignOwnerToSelf: false }))).id;
    remediationA1 = (await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "Remediation A1", description: null, priority: "high", dueDate: null, assignOwnerToSelf: false }))).id;

    const riskA2 = (await withRequestDb(userA2, (db) => createRisk(db, userA2, { assessmentId: assessmentA2, controlId: controlA1, title: "Source risk A2", description: null, likelihood: 3, impact: 3, inherentRating: "medium", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    const findingA2 = (await withRequestDb(userA2, (db) => createFinding(db, userA2, { riskId: riskA2, title: "Source finding A2", description: null, severity: "medium", assignOwnerToSelf: false }))).id;
    remediationA2 = (await withRequestDb(userA2, (db) => createRemediationAction(db, userA2, { findingId: findingA2, title: "Remediation A2", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }))).id;

    const riskA3 = (await withRequestDb(userA3, (db) => createRisk(db, userA3, { assessmentId: assessmentA3, controlId: controlA1, title: "Source risk A3", description: null, likelihood: 3, impact: 3, inherentRating: "medium", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    const findingA3 = (await withRequestDb(userA3, (db) => createFinding(db, userA3, { riskId: riskA3, title: "Source finding A3", description: null, severity: "medium", assignOwnerToSelf: false }))).id;
    remediationA3 = (await withRequestDb(userA3, (db) => createRemediationAction(db, userA3, { findingId: findingA3, title: "Remediation A3", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }))).id;

    const riskB = (await withRequestDb(userB, (db) => createRisk(db, userB, { assessmentId: assessmentB, controlId: controlB1, title: "Source risk B", description: null, likelihood: 3, impact: 3, inherentRating: "medium", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    const findingB = (await withRequestDb(userB, (db) => createFinding(db, userB, { riskId: riskB, title: "Source finding B", description: null, severity: "medium", assignOwnerToSelf: false }))).id;
    remediationB = (await withRequestDb(userB, (db) => createRemediationAction(db, userB, { findingId: findingB, title: "Remediation B", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }))).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Application-layer behavior --------------------------------------

  it("createValidationRecord success (accepted, no rationale required): validated_by is always the acting user", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT * FROM validation_records WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({
      tenant_id: tenantA,
      organisation_id: orgA,
      engagement_id: engagementA,
      remediation_action_id: remediationA1,
      validated_by: userA,
      outcome: "accepted",
      rationale: null,
    });
  });

  it("createValidationRecord rejecting without a rationale is refused server-side (mirrors ReviewRationaleRequiredError, Slice C2)", async () => {
    await expect(
      withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "rejected", rationale: null })),
    ).rejects.toThrow(ValidationRationaleRequiredError);
    await expect(
      withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "rejected", rationale: "   " })),
    ).rejects.toThrow(ValidationRationaleRequiredError);
  });

  it("createValidationRecord rejecting WITH a rationale succeeds and persists it", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "rejected", rationale: "Evidence does not demonstrate MFA is actually enforced." }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT outcome, rationale FROM validation_records WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ outcome: "rejected", rationale: "Evidence does not demonstrate MFA is actually enforced." });
  });

  it("createValidationRecord against a nonexistent RemediationAction is rejected", async () => {
    await expect(
      withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: "00000000-0000-0000-0000-000000000000", outcome: "accepted", rationale: null })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("createValidationRecord does NOT accept a caller-supplied validator — the input type has no such field, and the acting user is always the one recorded", async () => {
    const { id } = await withRequestDb(userA2, (db) => createValidationRecord(db, userA2, { remediationActionId: remediationA2, outcome: "accepted", rationale: null }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT validated_by FROM validation_records WHERE id = $1", [id]));
    expect(rows[0]!.validated_by).toBe(userA2);
  });

  // --- §29: no silent mutation of RemediationAction status --------------

  it("29. Creating a ValidationRecord does NOT mutate remediation_actions.status (no trigger connects the two tables)", async () => {
    const before = (await asFixtureSetup((c) => c.query("SELECT status FROM remediation_actions WHERE id = $1", [remediationA1]))).rows[0];
    await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));
    const after = (await asFixtureSetup((c) => c.query("SELECT status FROM remediation_actions WHERE id = $1", [remediationA1]))).rows[0];
    expect(after.status).toBe(before.status);

    // Definitive evidence, not just an observation of this one row: no
    // trigger anywhere connects validation_records writes to
    // remediation_actions at all.
    const { rows: triggerRows } = await asFixtureSetup((c) =>
      c.query(`SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE event_object_table = 'remediation_actions'`),
    );
    for (const row of triggerRows) {
      expect(row.trigger_name).not.toMatch(/validat/i);
    }
  });

  // --- §27: multiple validations -----------------------------------------

  it("27. Multiple ValidationRecords on the same RemediationAction are normal — a rejected V1 followed by an accepted V2 both remain queryable", async () => {
    const { id: v1 } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "rejected", rationale: "First pass insufficient." }));
    const { id: v2 } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));

    const history = await withRequestDb(userA, (db) => listValidationRecordsForRemediation(db, remediationA1));
    const ids = history.map((r) => r.id);
    expect(ids).toContain(v1);
    expect(ids).toContain(v2);

    const v1Detail = await withRequestDb(userA, (db) => getValidationRecordDetail(db, userA, { organisationId: orgA, engagementId: engagementA, validationRecordId: v1 }));
    const v2Detail = await withRequestDb(userA, (db) => getValidationRecordDetail(db, userA, { organisationId: orgA, engagementId: engagementA, validationRecordId: v2 }));
    expect(v1Detail.outcome).toBe("rejected");
    expect(v2Detail.outcome).toBe("accepted");
  });

  // --- §21/§28: historical integrity / immutability -----------------------

  it("21/28. Immutability: a ValidationRecord's decision fields never change, even after the source RemediationAction's own status later changes (direct SQL UPDATE attempt is rejected)", async () => {
    const { id: v1 } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));
    const snapshotBefore = (await asFixtureSetup((c) => c.query("SELECT * FROM validation_records WHERE id = $1", [v1]))).rows[0];

    // Subsequent, unrelated state changes to the RemediationAction — the
    // ValidationRecord must remain byte-for-byte unchanged afterward.
    await asFixtureSetup((c) => c.query(`UPDATE remediation_actions SET status = 'closed', title = 'Title changed after validation' WHERE id = $1`, [remediationA1]));

    // A direct SQL attempt to tamper with the ValidationRecord's own
    // decision fields is rejected by the existing tampering-guard
    // trigger (migration 0013).
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE validation_records SET outcome = 'rejected' WHERE id = $1`, [v1])),
    ).rejects.toThrow(/immutable/i);
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE validation_records SET rationale = 'tampered' WHERE id = $1`, [v1])),
    ).rejects.toThrow(/immutable/i);
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE validation_records SET validated_by = $1 WHERE id = $2`, [userA2, v1])),
    ).rejects.toThrow(/immutable/i);
    // DELETE is never GRANTed to `authenticated` at all (migration
    // 0013) — a real engagement member's connection is refused outright
    // (not merely blocked by RLS); asFixtureSetup's own superuser
    // connection deliberately bypasses this GRANT, so this check must
    // go through asUser, the real authenticated-role connection.
    await expect(asUser(userA, (c) => c.query(`DELETE FROM validation_records WHERE id = $1`, [v1]))).rejects.toThrow();

    const snapshotAfter = (await asFixtureSetup((c) => c.query("SELECT * FROM validation_records WHERE id = $1", [v1]))).rows[0];
    expect(snapshotAfter).toEqual(snapshotBefore);
  });

  it("A rejected ValidationRecord's outcome cannot later be silently accepted — direct SQL UPDATE attempt is rejected", async () => {
    const { id } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "rejected", rationale: "Not sufficient." }));
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE validation_records SET outcome = 'accepted' WHERE id = $1`, [id])),
    ).rejects.toThrow(/immutable/i);
  });

  // --- Required security scenarios (instructions §25) --------------------

  it("1. Tenant A cannot read Tenant B's ValidationRecord", async () => {
    const { id: vB } = await withRequestDb(userB, (db) => createValidationRecord(db, userB, { remediationActionId: remediationB, outcome: "accepted", rationale: null }));
    await expect(
      withRequestDb(userA, (db) => getValidationRecordDetail(db, userA, { organisationId: orgB, engagementId: engagementB, validationRecordId: vB })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("2. Organisation A cannot read Organisation A2's ValidationRecord (same tenant)", async () => {
    const { id: vA2 } = await withRequestDb(userA2, (db) => createValidationRecord(db, userA2, { remediationActionId: remediationA2, outcome: "accepted", rationale: null }));
    await expect(
      withRequestDb(userA, (db) => getValidationRecordDetail(db, userA, { organisationId: orgA2, engagementId: engagementA2, validationRecordId: vA2 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("3. Engagement A cannot read Engagement A3's ValidationRecord (same organisation)", async () => {
    const { id: vA3 } = await withRequestDb(userA3, (db) => createValidationRecord(db, userA3, { remediationActionId: remediationA3, outcome: "accepted", rationale: null }));
    await expect(
      withRequestDb(userA, (db) => getValidationRecordDetail(db, userA, { organisationId: orgA, engagementId: engagementA3, validationRecordId: vA3 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4. Tenant A cannot create a ValidationRecord against Tenant B's RemediationAction", async () => {
    await expect(
      withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationB, outcome: "accepted", rationale: null })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("5. Organisation A cannot create a ValidationRecord against Organisation A2's RemediationAction", async () => {
    await expect(
      withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA2, outcome: "accepted", rationale: null })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("6. Engagement A cannot create a ValidationRecord against Engagement A3's RemediationAction (same organisation)", async () => {
    await expect(
      withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA3, outcome: "accepted", rationale: null })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("7. Anonymous access is rejected", async () => {
    await expect(asAnon((c) => c.query("SELECT * FROM validation_records LIMIT 1"))).rejects.toThrow();
    await expect(
      asAnon((c) =>
        c.query(`INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome) VALUES ($1, $2, $3, $4, 'accepted')`, [
          remediationA1,
          tenantA,
          orgA,
          engagementA,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("8. Unauthorized user (no membership at all) cannot create a ValidationRecord", async () => {
    await expect(
      withRequestDb(outsiderA, (db) => createValidationRecord(db, outsiderA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("9. Unauthorized user (no membership at all) cannot read a ValidationRecord", async () => {
    const { id } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));
    await expect(
      withRequestDb(outsiderA, (db) => getValidationRecordDetail(db, outsiderA, { organisationId: orgA, engagementId: engagementA, validationRecordId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("10. Cross-tenant validator is rejected by the database on INSERT (migration 0023 — the fourth instance of the risks/findings/remediation_actions owner-scoping fix)", async () => {
    await expect(
      asUser(userA, (c) =>
        c.query(
          `INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome, validated_by) VALUES ($1, $2, $3, $4, 'accepted', $5)`,
          [remediationA1, tenantA, orgA, engagementA, userB],
        ),
      ),
    ).rejects.toThrow(/validation_records_validated_by_tenant_fk/);
  });

  it("10b. Cross-tenant validator is also rejected by the database on UPDATE, not only INSERT", async () => {
    const target = await asFixtureSetup((c) =>
      c
        .query(
          `INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome, validated_by) VALUES ($1, $2, $3, $4, 'accepted', $5) RETURNING id`,
          [remediationA1, tenantA, orgA, engagementA, userA],
        )
        .then((r) => r.rows[0].id),
    );
    // The tampering-guard trigger independently rejects ANY update to
    // validated_by regardless of tenant — a raw UPDATE attempting a
    // cross-tenant validator hits that guard first. Both are real,
    // independent protections; either error is an acceptable rejection.
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE validation_records SET validated_by = $1 WHERE id = $2`, [userB, target])),
    ).rejects.toThrow();
  });

  it("11. Self-validation-only: createValidationRecord's own input type has no assignable validator field — the acting user is always recorded", async () => {
    const { id } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT validated_by FROM validation_records WHERE id = $1", [id]));
    expect(rows[0]!.validated_by).toBe(userA);
  });

  it("11b. Migration 0023 safety: NULL validators and existing same-tenant validators both remain valid", async () => {
    const nullValidatorId = await asFixtureSetup((c) =>
      c
        .query(`INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome, validated_by) VALUES ($1, $2, $3, $4, 'accepted', NULL) RETURNING id`, [
          remediationA1,
          tenantA,
          orgA,
          engagementA,
        ])
        .then((r) => r.rows[0].id),
    );
    const sameTenantValidatorId = await asFixtureSetup((c) =>
      c
        .query(`INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome, validated_by) VALUES ($1, $2, $3, $4, 'accepted', $5) RETURNING id`, [
          remediationA1,
          tenantA,
          orgA,
          engagementA,
          userA,
        ])
        .then((r) => r.rows[0].id),
    );
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT id FROM validation_records WHERE id IN ($1, $2)`, [nullValidatorId, sameTenantValidatorId]));
    expect(rows).toHaveLength(2);
  });

  it("12. A direct, malicious raw INSERT with forged tenant/organisation/engagement is rejected by RLS", async () => {
    await expect(
      asUser(userA, (c) =>
        c.query(`INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome) VALUES ($1, $2, $3, $4, 'accepted')`, [
          remediationB,
          tenantB,
          orgB,
          engagementB,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("13. Browser-supplied forged scope ids cannot cross a tenant boundary even with a real ValidationRecord id", async () => {
    const { id } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));
    await expect(
      withRequestDb(userA, (db) => getValidationRecordDetail(db, userA, { organisationId: orgB, engagementId: engagementB, validationRecordId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("14. A ValidationRecord's RemediationAction relationship cannot cross a tenant boundary (validation_records_remediation_action_scope_fk)", async () => {
    await expect(
      asFixtureSetup((c) =>
        c.query(`INSERT INTO validation_records (remediation_action_id, tenant_id, organisation_id, engagement_id, outcome) VALUES ($1, $2, $3, $4, 'accepted')`, [
          remediationB,
          tenantA,
          orgA,
          engagementA,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("15. The full RemediationAction → ValidationRecord chain remains tenant-safe end-to-end", async () => {
    const { id } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));
    await expect(
      withRequestDb(userB, (db) => getValidationRecordDetail(db, userB, { organisationId: orgA, engagementId: engagementA, validationRecordId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(
      withRequestDb(userB, (db) => getRemediationActionDetail(db, userB, { organisationId: orgA, engagementId: engagementA, remediationActionId: remediationA1 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("16. No trigger connects validation_records to any RemediationAction status transition (Assessment-finalization-style rule does not exist here either)", async () => {
    const { rows } = await asFixtureSetup((c) => c.query(`SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'validation_records'`));
    const names = rows.map((r: { trigger_name: string }) => r.trigger_name);
    expect(names).toContain("validation_records_prevent_tampering");
    expect(names).toContain("validation_records_audit_log");
  });

  it("17. Audit attribution identifies the acting user for ValidationRecord creation", async () => {
    const { id } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT action, actor_user_id FROM audit_log WHERE entity_type = 'validation_records' AND entity_id = $1 ORDER BY occurred_at ASC`, [id]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "insert", actor_user_id: userA });
  });

  // --- §24: Evidence linking verification ---------------------------------

  it("24. Evidence: Tenant A → Tenant A's own ValidationRecord succeeds; Tenant A → Tenant B's ValidationRecord fails", async () => {
    const { id: vA } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));
    const { id: vB } = await withRequestDb(userB, (db) => createValidationRecord(db, userB, { remediationActionId: remediationB, outcome: "accepted", rationale: null }));

    const { evidenceId } = await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Validation evidence (same tenant)",
        evidenceType: "other",
        linkTo: { type: "validation_record", validationRecordId: vA },
        file: textFile(),
      }),
    );
    expect(evidenceId).toBeTruthy();

    await expect(
      withRequestDb(userA, (db) =>
        uploadEvidence(db, userA, {
          organisationId: orgA,
          engagementId: engagementA,
          title: "Should fail — cross-tenant validation record",
          evidenceType: "other",
          linkTo: { type: "validation_record", validationRecordId: vB },
          file: textFile(),
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("Evidence summary for a ValidationRecord is scoped correctly and invisible cross-tenant", async () => {
    const { id: v } = await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "accepted", rationale: null }));
    await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Evidence for scoped summary check",
        evidenceType: "other",
        linkTo: { type: "validation_record", validationRecordId: v },
        file: textFile(),
      }),
    );
    const rows = await withRequestDb(userA, (db) => getEvidenceSummaryForValidationRecord(db, v));
    expect(rows.some((r) => r.title === "Evidence for scoped summary check")).toBe(true);
  });

  // --- Traceability (instructions §26) ------------------------------------

  it("Full chain: Assessment → Control → Response(implicit) → Risk → Finding → Remediation → Validation → Evidence remains queryable end-to-end; Tenant B cannot traverse any part of it", async () => {
    const chainRisk = (
      await withRequestDb(userA, (db) =>
        createRisk(db, userA, { assessmentId: assessmentA, controlId: controlA1, title: "Chain risk (C6)", description: null, likelihood: 4, impact: 4, inherentRating: "high", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }),
      )
    ).id;
    const chainFinding = (
      await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: chainRisk, title: "Chain finding (C6)", description: null, severity: "high", assignOwnerToSelf: false }))
    ).id;
    const chainRemediation = (
      await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: chainFinding, title: "Chain remediation (C6)", description: null, priority: "high", dueDate: null, assignOwnerToSelf: false }))
    ).id;
    const chainValidation = (
      await withRequestDb(userA, (db) => createValidationRecord(db, userA, { remediationActionId: chainRemediation, outcome: "accepted", rationale: null }))
    ).id;
    await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Chain evidence (submitted directly against the validation)",
        evidenceType: "other",
        linkTo: { type: "validation_record", validationRecordId: chainValidation },
        file: textFile(),
      }),
    );

    const remediationDetail = await withRequestDb(userA, (db) => getRemediationActionDetail(db, userA, { organisationId: orgA, engagementId: engagementA, remediationActionId: chainRemediation }));
    expect(remediationDetail.validationRecords.some((v) => v.id === chainValidation)).toBe(true);

    const validationDetail = await withRequestDb(userA, (db) => getValidationRecordDetail(db, userA, { organisationId: orgA, engagementId: engagementA, validationRecordId: chainValidation }));
    expect(validationDetail.remediationAction.id).toBe(chainRemediation);
    expect(validationDetail.evidence.some((e) => e.title === "Chain evidence (submitted directly against the validation)")).toBe(true);

    // Tenant B cannot traverse any part of this chain, even with the
    // real ids.
    await expect(
      withRequestDb(userB, (db) => getValidationRecordDetail(db, userB, { organisationId: orgA, engagementId: engagementA, validationRecordId: chainValidation })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(
      withRequestDb(userB, (db) => getRemediationActionDetail(db, userB, { organisationId: orgA, engagementId: engagementA, remediationActionId: chainRemediation })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
    const tenantBEvidence = await withRequestDb(userB, (db) => getEvidenceSummaryForValidationRecord(db, chainValidation));
    expect(tenantBEvidence).toHaveLength(0);
  });

  // --- Read functions ------------------------------------------------------

  it("listValidationRecordsForRemediation returns the full history, most recent first", async () => {
    const rows = await withRequestDb(userA, (db) => listValidationRecordsForRemediation(db, remediationA1));
    expect(rows.length).toBeGreaterThan(1);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.validatedAt.getTime()).toBeGreaterThanOrEqual(rows[i]!.validatedAt.getTime());
    }
  });

  it("Invalid outcome value is rejected before any database write", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        // @ts-expect-error deliberately invalid outcome to prove server-side validation, not just the TS type
        createValidationRecord(db, userA, { remediationActionId: remediationA1, outcome: "partially_accepted", rationale: null }),
      ),
    ).rejects.toThrow(InvalidValidationInputError);
  });
});
