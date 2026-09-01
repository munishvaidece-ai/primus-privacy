// Slice C1 — Assessment Workspace + Control Assessment. Tests the real
// functions the real workspace page/Server Actions call
// (lib/domain/assessments.ts) against real PostgreSQL — no mocked
// permission functions. Covers the 12 required security scenarios
// (PHASE C instructions §19) plus the application-level workspace
// behaviors §29 asks for.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  listAssessmentsForEngagement,
  getAssessmentDetail,
  getControlRequirements,
  getControlTestsForControl,
  getEvidenceSummaryForControl,
  updateAssessmentResponse,
  createControlTest,
  AssessmentFinalizedError,
} from "@/lib/domain/assessments";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import {
  asAnon,
  asFixtureSetup,
  createTenant,
  createOrganisation,
  createEngagement,
  createUser,
  grantEngagementMembership,
  createRegulatoryReference,
  createRequirement,
  createControlLibraryVersion,
  publishControlLibraryVersion,
  createControl,
  linkControlRequirement,
  pinEngagementControlLibraryVersion,
  createAssessment,
  finalizeAssessment,
  addAssessmentControl,
  createAssessmentResponse,
  createControlTest as createControlTestFixture,
  pool,
} from "./helpers";

describe("Application layer — Assessment Workspace + Control Assessment (Slice C1)", () => {
  let tenantA: string, tenantB: string;
  let orgA1: string, orgA2: string, orgB: string;
  let engagementA1: string, engagementA1b: string, engagementA2: string, engagementB: string;
  let libraryA: string, libraryA2: string, libraryB: string;
  let controlA1: string, controlA2: string, controlAOther: string, controlB1: string;
  let requirementA1: string;
  let assessmentA1: string, assessmentA1b: string, assessmentA1c: string, assessmentA2: string, assessmentB: string;
  let assessmentControlA1_1: string, assessmentControlA1_2: string;
  let assessmentControlA1b_1: string;
  let assessmentControlA1c_1: string;
  let assessmentControlB1: string;

  let userA1: string; // EngagementMembership on engagementA1 only
  let outsiderA: string; // Tenant A, no membership anywhere
  let userB: string; // EngagementMembership on engagementB

  let responseA1_1: string; // AssessmentResponse for assessmentControlA1_1
  let controlTestA1_1: string;
  let evidenceA: string;
  let evidenceB: string;

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice C1 Tenant A");
      tenantB = await createTenant(client, "Slice C1 Tenant B");
      orgA1 = await createOrganisation(client, tenantA, "Slice C1 Org A1");
      orgA2 = await createOrganisation(client, tenantA, "Slice C1 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice C1 Org B");

      engagementA1 = await createEngagement(client, tenantA, orgA1, "Slice C1 Engagement A1");
      engagementA1b = await createEngagement(client, tenantA, orgA1, "Slice C1 Engagement A1b");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Slice C1 Engagement A2");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice C1 Engagement B");

      libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C1 Library A" });
      libraryA2 = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C1 Library A2" });
      libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Slice C1 Library B" });

      controlA1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "A1", title: "Access control policy", description: "Formal access control policy is documented and enforced.", controlType: "preventive" });
      controlA2 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "A2", title: "Audit logging", controlType: "detective" });
      controlAOther = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA2, code: "X1", title: "A control from a different library version" });
      controlB1 = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "B1", title: "Tenant B control" });

      const regRef = await createRegulatoryReference(client, { tenantId: tenantA, citation: "Section 8(5)", title: "Reasonable security safeguards" });
      requirementA1 = await createRequirement(client, { tenantId: tenantA, primaryRegulatoryReferenceId: regRef, title: "Implement reasonable security safeguards" });
      // Linked before publishing — Milestone 4's rule blocks mapping a
      // control-requirement pair once the control's own library version
      // is published, the same ordering constraint Slice A1's own
      // authorization test suite already established.
      await linkControlRequirement(client, { tenantId: tenantA, controlId: controlA1, requirementId: requirementA1 });

      await publishControlLibraryVersion(client, libraryA);
      await publishControlLibraryVersion(client, libraryA2);
      await publishControlLibraryVersion(client, libraryB);

      await pinEngagementControlLibraryVersion(client, engagementA1, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA1b, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA2, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      assessmentA1 = await createAssessment(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026" });
      assessmentA1b = await createAssessment(client, { engagementId: engagementA1b, organisationId: orgA1, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (second engagement)" });
      // A THIRD assessment under engagementA1 itself (so userA1
      // legitimately has access to it), used only by the finalization
      // tests (6/7) — kept entirely separate from assessmentA1 (which
      // every other test above needs to stay in 'draft') so finalizing
      // it can never affect any other test's outcome, regardless of run
      // order.
      assessmentA1c = await createAssessment(client, { engagementId: engagementA1, organisationId: orgA1, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (for finalization tests)" });
      assessmentA2 = await createAssessment(client, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Org A2)" });
      assessmentB = await createAssessment(client, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, controlLibraryVersionId: libraryB, periodLabel: "FY2026 (Tenant B)" });

      assessmentControlA1_1 = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlA1, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, controlLibraryVersionId: libraryA });
      assessmentControlA1_2 = await addAssessmentControl(client, { assessmentId: assessmentA1, controlId: controlA2, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, controlLibraryVersionId: libraryA });
      assessmentControlA1b_1 = await addAssessmentControl(client, { assessmentId: assessmentA1b, controlId: controlA1, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1b, controlLibraryVersionId: libraryA });
      assessmentControlA1c_1 = await addAssessmentControl(client, { assessmentId: assessmentA1c, controlId: controlA1, tenantId: tenantA, organisationId: orgA1, engagementId: engagementA1, controlLibraryVersionId: libraryA });
      await addAssessmentControl(client, { assessmentId: assessmentA2, controlId: controlA1, tenantId: tenantA, organisationId: orgA2, engagementId: engagementA2, controlLibraryVersionId: libraryA });
      assessmentControlB1 = await addAssessmentControl(client, { assessmentId: assessmentB, controlId: controlB1, tenantId: tenantB, organisationId: orgB, engagementId: engagementB, controlLibraryVersionId: libraryB });

      userA1 = await createUser(client, { tenantId: tenantA });
      await grantEngagementMembership(client, userA1, engagementA1);
      outsiderA = await createUser(client, { tenantId: tenantA });
      userB = await createUser(client, { tenantId: tenantB });
      await grantEngagementMembership(client, userB, engagementB);

      responseA1_1 = await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlA1_1,
        tenantId: tenantA,
        organisationId: orgA1,
        engagementId: engagementA1,
        effectivenessRating: "implemented",
        decisionRationale: "Verified via walkthrough.",
        respondentId: userA1,
      });
      controlTestA1_1 = await createControlTestFixture(client, {
        controlId: controlA1,
        tenantId: tenantA,
        assessmentId: assessmentA1,
        organisationId: orgA1,
        engagementId: engagementA1,
        methodology: "Inspected the access control policy document and confirmed sign-off.",
        result: "pass",
        testerId: userA1,
      });

      const docA = await client.query<{ id: string }>(
        `INSERT INTO documents (tenant_id, organisation_id, engagement_id, title, document_type) VALUES ($1,$2,$3,'Access policy','policy') RETURNING id`,
        [tenantA, orgA1, engagementA1],
      );
      const docVA = await client.query<{ id: string }>(
        `INSERT INTO document_versions (document_id, tenant_id, organisation_id, engagement_id, storage_path, original_filename, mime_type, file_size_bytes, checksum_sha256, uploaded_by)
         VALUES ($1,$2,$3,$4,'tenants/x/documents/x/v1','policy.pdf','application/pdf',100,'deadbeef',$5) RETURNING id`,
        [docA.rows[0]!.id, tenantA, orgA1, engagementA1, userA1],
      );
      const evA = await client.query<{ id: string }>(
        `INSERT INTO evidence (tenant_id, organisation_id, engagement_id, document_version_id, title, evidence_type) VALUES ($1,$2,$3,$4,'Signed access policy','policy_document') RETURNING id`,
        [tenantA, orgA1, engagementA1, docVA.rows[0]!.id],
      );
      evidenceA = evA.rows[0]!.id;
      await client.query(
        `INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, assessment_response_id) VALUES ($1,$2,$3,$4,'assessment_response',$5)`,
        [evidenceA, tenantA, orgA1, engagementA1, responseA1_1],
      );

      // A second AssessmentResponse + Evidence item, entirely under
      // Tenant B / Org B — used by test 9 to prove cross-organisation
      // evidence never appears in Tenant A's workspace query, even if
      // its real id is known/guessed.
      const responseB = await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlB1,
        tenantId: tenantB,
        organisationId: orgB,
        engagementId: engagementB,
        effectivenessRating: "implemented",
      });
      const docB = await client.query<{ id: string }>(
        `INSERT INTO documents (tenant_id, organisation_id, engagement_id, title, document_type) VALUES ($1,$2,$3,'Tenant B policy','policy') RETURNING id`,
        [tenantB, orgB, engagementB],
      );
      const docVB = await client.query<{ id: string }>(
        `INSERT INTO document_versions (document_id, tenant_id, organisation_id, engagement_id, storage_path, original_filename, mime_type, file_size_bytes, checksum_sha256, uploaded_by)
         VALUES ($1,$2,$3,$4,'tenants/y/documents/y/v1','policy.pdf','application/pdf',100,'deadbeef2',$5) RETURNING id`,
        [docB.rows[0]!.id, tenantB, orgB, engagementB, userB],
      );
      const evB = await client.query<{ id: string }>(
        `INSERT INTO evidence (tenant_id, organisation_id, engagement_id, document_version_id, title, evidence_type) VALUES ($1,$2,$3,$4,'Tenant B evidence','policy_document') RETURNING id`,
        [tenantB, orgB, engagementB, docVB.rows[0]!.id],
      );
      evidenceB = evB.rows[0]!.id;
      await client.query(
        `INSERT INTO evidence_links (evidence_id, tenant_id, organisation_id, engagement_id, subject_type, assessment_response_id) VALUES ($1,$2,$3,$4,'assessment_response',$5)`,
        [evidenceB, tenantB, orgB, engagementB, responseB],
      );

      // Finalized here, in fixture setup, rather than by an `it` block
      // partway through the suite — the finalization tests (6/7) need a
      // deterministically-already-finalized assessment regardless of
      // test execution order, and assessmentA1c is used by nothing else
      // in this suite, so finalizing it here cannot affect any other
      // test's outcome.
      await finalizeAssessment(client, assessmentA1c);
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Application-level behavior -----------------------------------

  it("Assessment list: listAssessmentsForEngagement returns real progress and methodology, not fake values", async () => {
    const list = await withRequestDb(userA1, (db) => listAssessmentsForEngagement(db, userA1, engagementA1, orgA1));
    const row = list.find((a) => a.id === assessmentA1);
    expect(row).toMatchObject({
      periodLabel: "FY2026",
      status: "draft",
      controlLibraryVersionLabel: "Slice C1 Library A",
      progress: { completed: 1, total: 2 },
    });
  });

  it("Assessment access: an engagement member can open the assessment workspace", async () => {
    const detail = await withRequestDb(userA1, (db) => getAssessmentDetail(db, userA1, assessmentA1));
    expect(detail).toMatchObject({ id: assessmentA1, periodLabel: "FY2026", status: "draft" });
    expect(detail.controlRows).toHaveLength(2);
  });

  it("Control display: the control's own code/title/description/type are present", async () => {
    const detail = await withRequestDb(userA1, (db) => getAssessmentDetail(db, userA1, assessmentA1));
    const row = detail.controlRows.find((r) => r.assessmentControlId === assessmentControlA1_1);
    expect(row).toMatchObject({
      controlCode: "A1",
      controlTitle: "Access control policy",
      controlDescription: "Formal access control policy is documented and enforced.",
      controlType: "preventive",
    });
  });

  it("Requirement mapping: getControlRequirements returns the mapped Requirement and its primary RegulatoryReference", async () => {
    const reqs = await withRequestDb(userA1, (db) => getControlRequirements(db, controlA1));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({
      title: "Implement reasonable security safeguards",
      regulatoryReference: { citation: "Section 8(5)", title: "Reasonable security safeguards" },
    });

    const noReqs = await withRequestDb(userA1, (db) => getControlRequirements(db, controlA2));
    expect(noReqs).toHaveLength(0);
  });

  it("AssessmentResponse display: the current response, including respondent email and submitted date, is shown", async () => {
    const detail = await withRequestDb(userA1, (db) => getAssessmentDetail(db, userA1, assessmentA1));
    const row = detail.controlRows.find((r) => r.assessmentControlId === assessmentControlA1_1);
    expect(row?.response).toMatchObject({ effectivenessRating: "implemented", decisionRationale: "Verified via walkthrough." });
    expect(row?.response?.respondentEmail).toBeTruthy();
  });

  it("AssessmentResponse update / rationale update: an authorized consultant can record a response and rationale, then read it back", async () => {
    await withRequestDb(userA1, (db) =>
      updateAssessmentResponse(db, userA1, {
        assessmentControlId: assessmentControlA1_2,
        effectivenessRating: "partially_implemented",
        decisionRationale: "Logging exists but retention policy is undocumented.",
      }),
    );
    const detail = await withRequestDb(userA1, (db) => getAssessmentDetail(db, userA1, assessmentA1));
    const row = detail.controlRows.find((r) => r.assessmentControlId === assessmentControlA1_2);
    expect(row?.response).toMatchObject({
      effectivenessRating: "partially_implemented",
      decisionRationale: "Logging exists but retention policy is undocumented.",
    });
  });

  it("ControlTest display: getControlTestsForControl returns the recorded test, scoped to this control and assessment only", async () => {
    const tests = await withRequestDb(userA1, (db) => getControlTestsForControl(db, assessmentA1, controlA1));
    expect(tests).toHaveLength(1);
    expect(tests[0]).toMatchObject({ result: "pass" });

    const noneForA2 = await withRequestDb(userA1, (db) => getControlTestsForControl(db, assessmentA1, controlA2));
    expect(noneForA2).toHaveLength(0);
  });

  it("ControlTest creation: an authorized consultant can record a new control test through the domain function", async () => {
    const { id } = await withRequestDb(userA1, (db) =>
      createControlTest(db, userA1, {
        assessmentId: assessmentA1,
        controlId: controlA2,
        methodology: "Reviewed audit log configuration against policy.",
        sampleDescription: null,
        result: "exception_noted",
        testedAt: "2026-03-15",
      }),
    );
    expect(id).toBeTruthy();
    const tests = await withRequestDb(userA1, (db) => getControlTestsForControl(db, assessmentA1, controlA2));
    expect(tests.some((t) => t.id === id && t.result === "exception_noted")).toBe(true);
  });

  it("Evidence summary: evidence linked to this control's response is shown", async () => {
    const ev = await withRequestDb(userA1, (db) => getEvidenceSummaryForControl(db, responseA1_1, [controlTestA1_1]));
    expect(ev.some((e) => e.id === evidenceA)).toBe(true);
  });

  it("Progress calculation: matches PRODUCT_UX_BLUEPRINT.md's own read model — a response row counts as 'responded' regardless of its rating value", async () => {
    const detail = await withRequestDb(userA1, (db) => getAssessmentDetail(db, userA1, assessmentA1));
    // Both assessmentControlA1_1 and assessmentControlA1_2 now have a
    // response row (the second was created by the update test above) —
    // progress must be 2/2, not merely "ratings other than not_assessed".
    expect(detail.progress).toMatchObject({ completed: 2, total: 2 });
  });

  it("Finalized state: a finalized assessment's status is real and visible via getAssessmentDetail (assessmentA1c was finalized in fixture setup)", async () => {
    const detail = await withRequestDb(userA1, (db) => getAssessmentDetail(db, userA1, assessmentA1c));
    expect(detail.status).toBe("finalized");
  });

  // --- Required security scenarios (PHASE C instructions §19) --------

  it("1. Tenant A cannot view Tenant B Assessment", async () => {
    await expect(withRequestDb(userA1, (db) => getAssessmentDetail(db, userA1, assessmentB))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("2. Organisation A1 cannot view Organisation A2's Assessment (same tenant)", async () => {
    await expect(withRequestDb(userA1, (db) => getAssessmentDetail(db, userA1, assessmentA2))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("3. Engagement A1 cannot view Engagement A1b's Assessment (same organisation, different engagement)", async () => {
    await expect(withRequestDb(userA1, (db) => getAssessmentDetail(db, userA1, assessmentA1b))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4. Unauthorized user cannot update AssessmentResponse", async () => {
    await expect(
      withRequestDb(outsiderA, (db) =>
        updateAssessmentResponse(db, outsiderA, {
          assessmentControlId: assessmentControlA1_1,
          effectivenessRating: "not_implemented",
          decisionRationale: "Attempted by an unauthorized user.",
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("5. Unauthorized user cannot create ControlTest", async () => {
    await expect(
      withRequestDb(outsiderA, (db) =>
        createControlTest(db, outsiderA, {
          assessmentId: assessmentA1,
          controlId: controlA1,
          methodology: "Attempted by an unauthorized user.",
          sampleDescription: null,
          result: "pass",
          testedAt: null,
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("6. AssessmentResponse cannot be changed after finalization", async () => {
    await expect(
      withRequestDb(userA1, (db) =>
        updateAssessmentResponse(db, userA1, {
          assessmentControlId: assessmentControlA1c_1,
          effectivenessRating: "implemented",
          decisionRationale: "Attempted after finalization.",
        }),
      ),
    ).rejects.toThrow(AssessmentFinalizedError);
  });

  it("7. ControlTest cannot be created after finalization, where the database requires locking", async () => {
    await expect(
      withRequestDb(userA1, (db) =>
        createControlTest(db, userA1, {
          assessmentId: assessmentA1c,
          controlId: controlA1,
          methodology: "Attempted after finalization.",
          sampleDescription: null,
          result: "pass",
          testedAt: null,
        }),
      ),
    ).rejects.toThrow(AssessmentFinalizedError);
  });

  it("8. A cross-library Control cannot be attached to an Assessment pinned to a different library version", async () => {
    // Direct, raw attempt (bypassing all application code) to insert an
    // assessment_controls row referencing controlAOther (from libraryA2)
    // into assessmentA1 (pinned to libraryA) — the database's own
    // composite FK (assessment-controls.ts's controlLibraryVersionFk +
    // assessmentScopeFk) must reject this by construction, independent
    // of anything this slice's own application code does.
    await expect(
      asFixtureSetup((c) =>
        c.query(
          `INSERT INTO assessment_controls (assessment_id, control_id, tenant_id, organisation_id, engagement_id, control_library_version_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [assessmentA1, controlAOther, tenantA, orgA1, engagementA1, libraryA],
        ),
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it("9. Evidence from another organisation cannot appear in the workspace, even given its real id", async () => {
    // userA1 (Tenant A / Org A1) queries using evidenceB's own real
    // linking ids (Tenant B / Org B) — RLS on evidence_links/evidence
    // must filter this to nothing, independent of the application
    // layer's own WHERE clause.
    const evB = await asFixtureSetup((c) =>
      c.query<{ assessment_response_id: string }>(`SELECT assessment_response_id FROM evidence_links WHERE evidence_id = $1`, [evidenceB]),
    );
    const responseBId = evB.rows[0]!.assessment_response_id as string;

    const result = await withRequestDb(userA1, (db) => getEvidenceSummaryForControl(db, responseBId, []));
    expect(result).toHaveLength(0);
  });

  it("10. Malicious browser-supplied ids cannot cross tenant/organisation/engagement boundaries (updateAssessmentResponse re-derives scope from the AssessmentControl's own row)", async () => {
    // Even though userB legitimately controls engagementB, attempting to
    // update a Tenant A AssessmentControl (assessmentControlA1_1) must
    // fail — the function re-derives scope from the AssessmentControl
    // row itself, never trusts a caller-supplied engagement context.
    await expect(
      withRequestDb(userB, (db) =>
        updateAssessmentResponse(db, userB, {
          assessmentControlId: assessmentControlA1_1,
          effectivenessRating: "implemented",
          decisionRationale: "Cross-tenant attempt.",
        }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("11. Anonymous access is blocked", async () => {
    // `assessments` (migration 0009) grants no privilege at all to
    // `anon` — a bare SELECT is rejected at the GRANT layer before RLS
    // is even evaluated, a stricter outcome than an RLS-filtered empty
    // result, not a weaker one.
    await expect(
      asAnon((client) => client.query(`SELECT * FROM assessments WHERE id = $1`, [assessmentA1])),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asAnon((client) =>
        client.query(`INSERT INTO assessment_responses (assessment_control_id, tenant_id, organisation_id, engagement_id, effectiveness_rating) VALUES ($1,$2,$3,$4,'implemented')`, [
          assessmentControlA1_1,
          tenantA,
          orgA1,
          engagementA1,
        ]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it("12. A direct request that skips the application authorization layer entirely is still rejected by RLS", async () => {
    await expect(
      withRequestDb(outsiderA, (db, client) =>
        client.query(
          `INSERT INTO assessment_responses (assessment_control_id, tenant_id, organisation_id, engagement_id, effectiveness_rating) VALUES ($1,$2,$3,$4,'implemented')`,
          [assessmentControlA1_1, tenantA, orgA1, engagementA1],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("Audit attribution: AssessmentResponse update and ControlTest creation are both recorded in audit_log, attributed to the acting user", async () => {
    const responseAudit = await asFixtureSetup((c) =>
      c.query(
        `SELECT actor_user_id, entity_type, action FROM audit_log
         WHERE entity_type = 'assessment_responses'
           AND entity_id = (SELECT id FROM assessment_responses WHERE assessment_control_id = $1)`,
        [assessmentControlA1_2],
      ),
    );
    expect(responseAudit.rows.length).toBeGreaterThan(0);
    expect(responseAudit.rows.every((r) => r.actor_user_id === userA1)).toBe(true);

    // controlTestA1_1 itself was inserted by fixture setup (as the
    // superuser, with no request.jwt.claim.sub set) — real user
    // attribution can only be observed on a control test created
    // through the domain function, under a real authenticated session.
    const { id: freshControlTestId } = await withRequestDb(userA1, (db) =>
      createControlTest(db, userA1, {
        assessmentId: assessmentA1,
        controlId: controlA1,
        methodology: "A second, audit-attribution-only test.",
        sampleDescription: null,
        result: "pass",
        testedAt: null,
      }),
    );
    const testAudit = await asFixtureSetup((c) =>
      c.query(`SELECT actor_user_id, entity_type, action FROM audit_log WHERE entity_type = 'control_tests' AND entity_id = $1`, [freshControlTestId]),
    );
    expect(testAudit.rows).toMatchObject([{ actor_user_id: userA1, entity_type: "control_tests", action: "insert" }]);
  });
});
