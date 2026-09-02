// Slice C7.3 — Assessment Finalization. Tests the real
// `finalizeAssessment` function (lib/domain/assessments.ts) and the new
// `canFinalizeAssessment` permission (lib/authorization/service.ts) the
// real Server Action calls, against real PostgreSQL — no mocked
// authorization. This is the fix for the C7 review's own "no Finalize
// action exists" finding: establishes a genuine, enforceable lifecycle
// boundary between an editable and a finalized Assessment.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createAssessment,
  finalizeAssessment,
  getAssessmentDetail,
  updateAssessmentResponse,
  createControlTest,
  AssessmentFinalizedError,
} from "@/lib/domain/assessments";
import { uploadEvidence, unlinkEvidence } from "@/lib/domain/evidence";
import { createRisk, updateRiskStatus } from "@/lib/domain/risks";
import { createFinding, updateFinding } from "@/lib/domain/findings";
import { createRemediationAction, updateRemediationAction } from "@/lib/domain/remediation";
import { createValidationRecord } from "@/lib/domain/validation";
import { revokeEngagementMember } from "@/lib/domain/engagement-memberships";
import { NotFoundOrForbiddenError, canFinalizeAssessment } from "@/lib/authorization/service";
import {
  asUser,
  asAnon,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantEngagementMembership,
  grantOrganisationMembership,
  createControlLibraryVersion,
  publishControlLibraryVersion,
  createControl,
  pinEngagementControlLibraryVersion,
  createRiskScoringModel,
  pool,
} from "./helpers";

function textFile(content = "synthetic evidence content — not a real client document") {
  return { buffer: Buffer.from(content, "utf8"), filename: "evidence.txt", mimeType: "text/plain" };
}

describe("Application layer — Assessment Finalization (Slice C7.3)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string, engagementA2: string, engagementA3: string, engagementB: string;
  let libraryA: string, controlA1: string, controlA2: string;
  let libraryB: string, controlB1: string;

  let userManagerA: string; // Engagement Manager on engagementA — holds assessment.finalize
  let userConsultantA: string; // plain Consultant on engagementA — no assessment.finalize
  let userClientAdminA: string; // Client Administrator on orgA (OrganisationMembership) — no assessment.finalize
  let userOutsiderA: string; // tenantA, no membership anywhere
  let userManagerB: string; // Engagement Manager on engagementB (tenantB)

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice C7.3 Tenant A");
      tenantB = await createTenant(client, "Slice C7.3 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice C7.3 Org A");
      orgA2 = await createOrganisation(client, tenantA, "Slice C7.3 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice C7.3 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "Slice C7.3 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Slice C7.3 Engagement A2");
      engagementA3 = await createEngagement(client, tenantA, orgA, "Slice C7.3 Engagement A3 (same org)");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice C7.3 Engagement B");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C7.3 Library A" });
      controlA1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Control C1" });
      controlA2 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C2", title: "Control C2" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA2, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA3, libraryA);

      libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Slice C7.3 Library B" });
      controlB1 = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "B1", title: "Control B1" });
      await publishControlLibraryVersion(client, libraryB);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      await createRiskScoringModel(client, { tenantId: tenantA, name: "C7.3 Matrix A", version: "v1.0" });
      await createRiskScoringModel(client, { tenantId: tenantB, name: "C7.3 Matrix B", version: "v1.0" });

      userManagerA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userManagerA, engagementA, "Engagement Manager");
      await grantEngagementMembership(client, userManagerA, engagementA3, "Engagement Manager");
      userConsultantA = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userConsultantA, engagementA, "Consultant");
      userClientAdminA = await createUser(client, { tenantId: tenantA, clientOrgId: orgA });
      await grantOrganisationMembership(client, userClientAdminA, orgA, "Client Administrator");
      userOutsiderA = await createUser(client, { tenantId: tenantA });
      userManagerB = await createUser(client, { tenantId: tenantB });
      await grantEngagementMembership(client, userManagerB, engagementB, "Engagement Manager");
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Happy path (instructions §22 "Happy path" 1-3) -----------------------

  it("1-3. Authorized Engagement Manager can finalize; status persists after reload; finalized assessment remains readable", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "FY2026 (happy path)" }),
    );
    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));

    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM assessments WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ status: "finalized" });

    const detail = await withRequestDb(userConsultantA, (db) => getAssessmentDetail(db, userConsultantA, id));
    expect(detail.status).toBe("finalized");
  });

  it("Finalization succeeds even with zero responses recorded — no completeness requirement is documented anywhere, so none is enforced", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "FY2026 (zero responses)" }),
    );
    const detail = await withRequestDb(userManagerA, (db) => getAssessmentDetail(db, userManagerA, id));
    expect(detail.progress.completed).toBe(0);

    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM assessments WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ status: "finalized" });
  });

  it("canFinalizeAssessment is true for the Engagement Manager and false for a plain Consultant / Client Administrator", async () => {
    expect(await withRequestDb(userManagerA, (db) => canFinalizeAssessment(db, userManagerA, engagementA, orgA))).toBe(true);
    expect(await withRequestDb(userConsultantA, (db) => canFinalizeAssessment(db, userConsultantA, engagementA, orgA))).toBe(false);
    expect(await withRequestDb(userClientAdminA, (db) => canFinalizeAssessment(db, userClientAdminA, engagementA, orgA))).toBe(false);
  });

  // --- Authorization (instructions §22 "Authorization" 4-7) ----------------

  it("4. Unauthorized engagement member (plain Consultant) cannot finalize", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Consultant cannot finalize" }),
    );
    await expect(
      withRequestDb(userConsultantA, (db) => finalizeAssessment(db, userConsultantA, { organisationId: orgA, engagementId: engagementA, assessmentId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("5. Ordinary client member (Client Administrator, no assessment.finalize) cannot finalize", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Client Admin cannot finalize" }),
    );
    await expect(
      withRequestDb(userClientAdminA, (db) => finalizeAssessment(db, userClientAdminA, { organisationId: orgA, engagementId: engagementA, assessmentId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("6. Anonymous user cannot finalize", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Anon cannot finalize" }),
    );
    await expect(asAnon((c) => c.query(`UPDATE assessments SET status = 'finalized' WHERE id = $1`, [id]))).rejects.toThrow();
  });

  it("7. Cross-tenant actor cannot finalize", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Cross-tenant cannot finalize" }),
    );
    await expect(
      withRequestDb(userManagerB, (db) => finalizeAssessment(db, userManagerB, { organisationId: orgA, engagementId: engagementA, assessmentId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // --- Forged IDs (instructions §22 "Forged IDs" 8-11) ----------------------

  it("8. Forged tenant boundary: a direct raw SQL UPDATE by an unauthorized (Consultant) actor is rejected by RLS independently of the domain function", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Forged RLS attempt" }),
    );
    await expect(asUser(userConsultantA, (c) => c.query(`UPDATE assessments SET status = 'finalized' WHERE id = $1`, [id]))).rejects.toThrow(
      /row-level security/i,
    );
  });

  it("9. Forged organisation ID does not grant access: real Assessment, wrong organisationId argument is rejected", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Forged org id" }),
    );
    await expect(
      withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA2, engagementId: engagementA, assessmentId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("10. Forged engagement ID does not grant access: real Assessment, wrong engagementId argument is rejected", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Forged engagement id" }),
    );
    await expect(
      withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA3, assessmentId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("11. Forged assessment ownership: an Engagement Manager on Engagement A3 cannot finalize Engagement A's assessment even by passing A3's own (real) scope ids", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Forged ownership" }),
    );
    await expect(
      withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA3, assessmentId: id })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // --- State transition (instructions §22 "State transition" 12) -----------

  it("12. An already-finalized Assessment cannot be finalized again", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "No re-finalize" }),
    );
    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));
    await expect(
      withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id })),
    ).rejects.toThrow(AssessmentFinalizedError);
  });

  it("Finalizing a nonexistent Assessment fails safely", async () => {
    await expect(
      withRequestDb(userManagerA, (db) =>
        finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: "00000000-0000-0000-0000-000000000000" }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // --- Immutability (instructions §22 "Immutability") -----------------------

  it("Immutability — Assessment: a direct SQL UPDATE (even a no-op) against a finalized Assessment is rejected regardless of role", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Assessment immutability" }),
    );
    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));

    await expect(
      asFixtureSetup((c) => c.query(`UPDATE assessments SET period_label = 'tampered' WHERE id = $1`, [id])),
    ).rejects.toThrow(/immutable/i);
  });

  it("Immutability — AssessmentControl: INSERT/DELETE against a finalized Assessment's control set is rejected", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "AssessmentControl immutability" }),
    );
    const { rows: acRows } = await asFixtureSetup((c) => c.query("SELECT id, control_id FROM assessment_controls WHERE assessment_id = $1", [id]));
    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));

    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO assessment_controls (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id) SELECT $1, id, $2, $3, $4, $5 FROM controls WHERE control_library_version_id = $5 LIMIT 1`,
          [id, tenantA, orgA, engagementA, libraryA],
        ),
      ),
    ).rejects.toThrow(/finalized/i);
    await expect(asFixtureSetup((c) => c.query(`DELETE FROM assessment_controls WHERE id = $1`, [acRows[0]!.id]))).rejects.toThrow(/finalized/i);
  });

  it("Immutability — AssessmentResponse: updateAssessmentResponse rejects a finalized Assessment's control with AssessmentFinalizedError, and direct SQL is rejected too", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "AssessmentResponse immutability" }),
    );
    const detail = await withRequestDb(userManagerA, (db) => getAssessmentDetail(db, userManagerA, id));
    const assessmentControlId = detail.controlRows[0]!.assessmentControlId;
    await withRequestDb(userManagerA, (db) =>
      updateAssessmentResponse(db, userManagerA, { assessmentControlId, effectivenessRating: "implemented", decisionRationale: "Before finalization." }),
    );
    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));

    await expect(
      withRequestDb(userManagerA, (db) =>
        updateAssessmentResponse(db, userManagerA, { assessmentControlId, effectivenessRating: "not_implemented", decisionRationale: "Tampering attempt." }),
      ),
    ).rejects.toThrow(AssessmentFinalizedError);

    const { rows } = await asFixtureSetup((c) => c.query("SELECT effectiveness_rating FROM assessment_responses WHERE assessment_control_id = $1", [assessmentControlId]));
    expect(rows[0]).toMatchObject({ effectiveness_rating: "implemented" });
  });

  it("Immutability — ControlTest: createControlTest rejects a finalized Assessment with AssessmentFinalizedError, and direct SQL UPDATE/DELETE is rejected too", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "ControlTest immutability" }),
    );
    const detail = await withRequestDb(userManagerA, (db) => getAssessmentDetail(db, userManagerA, id));
    const { id: testId } = await withRequestDb(userManagerA, (db) =>
      createControlTest(db, userManagerA, {
        assessmentId: id,
        controlId: detail.controlRows[0]!.controlId,
        methodology: "Walkthrough before finalization.",
        sampleDescription: null,
        result: "pass",
        testedAt: null,
      }),
    );
    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));

    await expect(
      withRequestDb(userManagerA, (db) =>
        createControlTest(db, userManagerA, {
          assessmentId: id,
          controlId: detail.controlRows[0]!.controlId,
          methodology: "Attempted after finalization.",
          sampleDescription: null,
          result: "fail",
          testedAt: null,
        }),
      ),
    ).rejects.toThrow(AssessmentFinalizedError);

    await expect(asFixtureSetup((c) => c.query(`UPDATE control_tests SET result = 'fail' WHERE id = $1`, [testId]))).rejects.toThrow(/finalized/i);
    await expect(asFixtureSetup((c) => c.query(`DELETE FROM control_tests WHERE id = $1`, [testId]))).rejects.toThrow(/finalized/i);
  });

  it("Immutability — EvidenceLink: uploadEvidence against a finalized Assessment's response is rejected, and an existing link cannot be unlinked", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "EvidenceLink immutability" }),
    );
    const detail = await withRequestDb(userManagerA, (db) => getAssessmentDetail(db, userManagerA, id));
    const assessmentControlId = detail.controlRows[0]!.assessmentControlId;
    await withRequestDb(userManagerA, (db) =>
      updateAssessmentResponse(db, userManagerA, { assessmentControlId, effectivenessRating: "implemented", decisionRationale: null }),
    );
    const detail2 = await withRequestDb(userManagerA, (db) => getAssessmentDetail(db, userManagerA, id));
    const responseId = detail2.controlRows[0]!.response!.id;

    const { evidenceId } = await withRequestDb(userManagerA, (db) =>
      uploadEvidence(db, userManagerA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Pre-finalization evidence",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: responseId },
        file: textFile(),
      }),
    );
    const { rows: linkRows } = await asFixtureSetup((c) => c.query("SELECT id FROM evidence_links WHERE evidence_id = $1", [evidenceId]));

    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));

    await expect(
      withRequestDb(userManagerA, (db) =>
        uploadEvidence(db, userManagerA, {
          organisationId: orgA,
          engagementId: engagementA,
          title: "Post-finalization attempt",
          evidenceType: "other",
          linkTo: { type: "assessment_response", assessmentResponseId: responseId },
          file: textFile(),
        }),
      ),
    ).rejects.toThrow(/finalized/i);

    await expect(
      withRequestDb(userManagerA, (db) => unlinkEvidence(db, userManagerA, { organisationId: orgA, engagementId: engagementA, evidenceLinkId: linkRows[0]!.id })),
    ).rejects.toThrow(/finalized/i);
  });

  // --- Downstream workflow continues (instructions §22 "Downstream workflow") ---

  it("Downstream workflow: Risk, Finding, Remediation, and Validation all remain fully editable after finalization — no trigger references Assessment finalization for any of them", async () => {
    const { id: assessmentId } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Downstream continuity" }),
    );
    const chainRisk = (
      await withRequestDb(userManagerA, (db) =>
        createRisk(db, userManagerA, { assessmentId, controlId: controlA1, title: "Downstream risk", description: null, likelihood: 4, impact: 4, inherentRating: "high", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }),
      )
    ).id;
    const chainFinding = (
      await withRequestDb(userManagerA, (db) => createFinding(db, userManagerA, { riskId: chainRisk, title: "Downstream finding", description: null, severity: "high", assignOwnerToSelf: false }))
    ).id;
    const chainRemediation = (
      await withRequestDb(userManagerA, (db) => createRemediationAction(db, userManagerA, { findingId: chainFinding, title: "Downstream remediation", description: null, priority: "high", dueDate: null, assignOwnerToSelf: false }))
    ).id;

    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId }));

    // All four downstream layers remain genuinely mutable/creatable
    // after the source Assessment is finalized.
    await expect(
      withRequestDb(userManagerA, (db) => updateRiskStatus(db, userManagerA, { organisationId: orgA, engagementId: engagementA, riskId: chainRisk, status: "mitigating" })),
    ).resolves.not.toThrow();
    await expect(
      withRequestDb(userManagerA, (db) => updateFinding(db, userManagerA, { organisationId: orgA, engagementId: engagementA, findingId: chainFinding, title: "Downstream finding (updated)", description: "Updated after finalization.", severity: "high", status: "in_progress", ownerAction: "keep" })),
    ).resolves.not.toThrow();
    await expect(
      withRequestDb(userManagerA, (db) =>
        updateRemediationAction(db, userManagerA, { organisationId: orgA, engagementId: engagementA, remediationActionId: chainRemediation, title: "Downstream remediation (updated)", description: null, priority: "high", status: "in_progress", dueDate: null, ownerAction: "assign_self" }),
      ),
    ).resolves.not.toThrow();
    await expect(
      withRequestDb(userManagerA, (db) => createValidationRecord(db, userManagerA, { remediationActionId: chainRemediation, outcome: "accepted", rationale: null })),
    ).resolves.not.toThrow();
  });

  it("No trigger anywhere connects Assessment finalization to risks/findings/remediation_actions/validation_records", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE event_object_table IN ('risks', 'findings', 'remediation_actions', 'validation_records')`),
    );
    for (const row of rows) {
      expect(row.trigger_name).not.toMatch(/final/i);
    }
  });

  // --- Audit (instructions §22 "Audit") -------------------------------------

  it("Finalization creates an audit record attributed to the correct actor with the correct before/after status", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Audit check" }),
    );
    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));

    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT action, actor_user_id, field_changes FROM audit_log WHERE entity_type = 'assessments' AND entity_id = $1 ORDER BY occurred_at`, [id]),
    );
    const finalizeEntry = rows[rows.length - 1]!;
    expect(finalizeEntry).toMatchObject({ action: "update", actor_user_id: userManagerA });
    expect(finalizeEntry.field_changes.old.status).toBe("draft");
    expect(finalizeEntry.field_changes.new.status).toBe("finalized");
  });

  // --- Revoked user (instructions §22 "Revoked user") -----------------------

  it("A revoked engagement member cannot read the (finalized or draft) Assessment through the existing authorization layer", async () => {
    const target = await asFixtureSetup((client) => createUser(client, { tenantId: tenantA }));
    const { id: engagementRoleId } = (
      await asFixtureSetup((c) => c.query("SELECT id FROM roles WHERE name = 'Consultant'"))
    ).rows[0]!;
    const membershipId = await asFixtureSetup((c) =>
      c
        .query(`INSERT INTO engagement_memberships (user_id, engagement_id, role_id) VALUES ($1, $2, $3) RETURNING id`, [target, engagementA, engagementRoleId])
        .then((r) => r.rows[0].id),
    );

    const { id: assessmentId } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Revoked-access check" }),
    );
    await withRequestDb(target, (db) => getAssessmentDetail(db, target, assessmentId)); // sanity: has access before revoke

    await withRequestDb(userManagerA, (db) => revokeEngagementMember(db, userManagerA, { organisationId: orgA, engagementId: engagementA, membershipId }));

    await expect(withRequestDb(target, (db) => getAssessmentDetail(db, target, assessmentId))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  // --- Raw SQL security invariants (instructions §23) -----------------------

  it("Raw SQL invariant: the database independently rejects an unauthorized (Consultant) role's attempt to finalize, matching the application layer's own denial", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Raw SQL invariant — unauthorized" }),
    );
    await expect(asUser(userConsultantA, (c) => c.query(`UPDATE assessments SET status = 'finalized' WHERE id = $1`, [id]))).rejects.toThrow(
      /row-level security/i,
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT status FROM assessments WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ status: "draft" });
  });

  it("Raw SQL invariant: the database independently rejects ANY update to an already-finalized Assessment, even by the authorized Engagement Manager", async () => {
    const { id } = await withRequestDb(userManagerA, (db) =>
      createAssessment(db, userManagerA, { engagementId: engagementA, assessmentType: "annual", periodLabel: "Raw SQL invariant — already finalized" }),
    );
    await withRequestDb(userManagerA, (db) => finalizeAssessment(db, userManagerA, { organisationId: orgA, engagementId: engagementA, assessmentId: id }));

    await expect(asUser(userManagerA, (c) => c.query(`UPDATE assessments SET status = 'finalized' WHERE id = $1`, [id]))).rejects.toThrow(/immutable/i);
  });
});
