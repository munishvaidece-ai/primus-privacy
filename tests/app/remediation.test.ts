// Slice C5 — Remediation Actions. Tests the real functions the real
// Finding detail/Server Actions call (lib/domain/remediation.ts)
// against real PostgreSQL — no mocked authorization. Covers the
// required database/application security scenarios (PHASE C5
// instructions §25), the owner security scenarios (§26), the
// traceability scenario (§27), and update tests (§28).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import {
  createRemediationAction,
  updateRemediationAction,
  listRemediationActionsForEngagement,
  listRemediationActionsForFinding,
  getRemediationActionDetail,
  InvalidRemediationInputError,
} from "@/lib/domain/remediation";
import { createFinding, getFindingDetail } from "@/lib/domain/findings";
import { createRisk, getRiskDetail } from "@/lib/domain/risks";
import { getControlTestsForControl } from "@/lib/domain/assessments";
import { getEvidenceSummaryForControl, getEvidenceSummaryForRemediationAction, uploadEvidence } from "@/lib/domain/evidence";
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
  finalizeAssessment,
  addAssessmentControl,
  createAssessmentResponse,
  createRiskScoringModel,
  pool,
} from "./helpers";

function textFile(content = "synthetic evidence content — not a real client document") {
  return { buffer: Buffer.from(content, "utf8"), filename: "evidence.txt", mimeType: "text/plain" };
}

describe("Application layer — Remediation Actions (Slice C5)", () => {
  let tenantA: string, tenantB: string;
  let orgA: string, orgA2: string, orgB: string;
  let engagementA: string, engagementA2: string, engagementA3: string, engagementB: string;
  let controlA1: string, controlB1: string;
  let assessmentA: string, assessmentAFinalized: string, assessmentA2: string, assessmentA3: string, assessmentB: string;

  let userA: string;
  let outsiderA: string;
  let userA2: string;
  let userA3: string;
  let userB: string;

  let responseA1: string;
  let findingA1: string; // Finding from riskA1 (from assessmentA/controlA1)
  let findingAFinalized: string; // Finding from a risk sourced from a finalized assessment
  let findingA2: string; // Finding under orgA2/engagementA2
  let findingA3: string; // Finding under orgA/engagementA3
  let findingB: string; // Finding under tenantB

  beforeAll(async () => {
    await asFixtureSetup(async (client) => {
      tenantA = await createTenant(client, "Slice C5 Tenant A");
      tenantB = await createTenant(client, "Slice C5 Tenant B");
      orgA = await createOrganisation(client, tenantA, "Slice C5 Org A");
      orgA2 = await createOrganisation(client, tenantA, "Slice C5 Org A2");
      orgB = await createOrganisation(client, tenantB, "Slice C5 Org B");

      engagementA = await createEngagement(client, tenantA, orgA, "Slice C5 Engagement A");
      engagementA2 = await createEngagement(client, tenantA, orgA2, "Slice C5 Engagement A2");
      engagementA3 = await createEngagement(client, tenantA, orgA, "Slice C5 Engagement A3 (same org as A)");
      engagementB = await createEngagement(client, tenantB, orgB, "Slice C5 Engagement B");

      const libraryA = await createControlLibraryVersion(client, { tenantId: tenantA, versionLabel: "Slice C5 Library A" });
      controlA1 = await createControl(client, { tenantId: tenantA, controlLibraryVersionId: libraryA, code: "C1", title: "Slice C5 Control 1" });
      await publishControlLibraryVersion(client, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA2, libraryA);
      await pinEngagementControlLibraryVersion(client, engagementA3, libraryA);

      const libraryB = await createControlLibraryVersion(client, { tenantId: tenantB, versionLabel: "Slice C5 Library B" });
      controlB1 = await createControl(client, { tenantId: tenantB, controlLibraryVersionId: libraryB, code: "B1", title: "Slice C5 Control B1" });
      await publishControlLibraryVersion(client, libraryB);
      await pinEngagementControlLibraryVersion(client, engagementB, libraryB);

      await createRiskScoringModel(client, { tenantId: tenantA, name: "C5 Matrix A", version: "v1.0" });
      await createRiskScoringModel(client, { tenantId: tenantB, name: "C5 Matrix B", version: "v1.0" });

      assessmentA = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026" });
      assessmentAFinalized = await createAssessment(client, { engagementId: engagementA, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (finalized)" });
      assessmentA2 = await createAssessment(client, { engagementId: engagementA2, organisationId: orgA2, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Org A2)" });
      assessmentA3 = await createAssessment(client, { engagementId: engagementA3, organisationId: orgA, tenantId: tenantA, controlLibraryVersionId: libraryA, periodLabel: "FY2026 (Engagement A3)" });
      assessmentB = await createAssessment(client, { engagementId: engagementB, organisationId: orgB, tenantId: tenantB, controlLibraryVersionId: libraryB, periodLabel: "FY2026 (Tenant B)" });

      const assessmentControlA1 = await addAssessmentControl(client, { assessmentId: assessmentA, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
      const assessmentControlAFinalized = await addAssessmentControl(client, { assessmentId: assessmentAFinalized, controlId: controlA1, tenantId: tenantA, organisationId: orgA, engagementId: engagementA, controlLibraryVersionId: libraryA });
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

      responseA1 = await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlA1,
        tenantId: tenantA,
        organisationId: orgA,
        engagementId: engagementA,
        effectivenessRating: "not_implemented",
        respondentId: userA,
      });

      await createAssessmentResponse(client, {
        assessmentControlId: assessmentControlAFinalized,
        tenantId: tenantA,
        organisationId: orgA,
        engagementId: engagementA,
        effectivenessRating: "not_implemented",
      });
      await finalizeAssessment(client, assessmentAFinalized);
    });

    // Real Risks and Findings, created through the real domain
    // functions (Slices C3/C4), to attach RemediationActions to.
    const riskA1 = (await withRequestDb(userA, (db) => createRisk(db, userA, { assessmentId: assessmentA, controlId: controlA1, title: "Source risk A1", description: null, likelihood: 4, impact: 4, inherentRating: "high", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    findingA1 = (await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskA1, title: "Source finding A1", description: null, severity: "high", assignOwnerToSelf: false }))).id;

    const riskAFinalized = (await withRequestDb(userA, (db) => createRisk(db, userA, { assessmentId: assessmentAFinalized, controlId: controlA1, title: "Source risk from finalized assessment", description: null, likelihood: 5, impact: 5, inherentRating: "critical", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    findingAFinalized = (await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: riskAFinalized, title: "Source finding from finalized assessment", description: null, severity: "critical", assignOwnerToSelf: false }))).id;

    const riskA2 = (await withRequestDb(userA2, (db) => createRisk(db, userA2, { assessmentId: assessmentA2, controlId: controlA1, title: "Source risk A2", description: null, likelihood: 3, impact: 3, inherentRating: "medium", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    findingA2 = (await withRequestDb(userA2, (db) => createFinding(db, userA2, { riskId: riskA2, title: "Source finding A2", description: null, severity: "medium", assignOwnerToSelf: false }))).id;

    const riskA3 = (await withRequestDb(userA3, (db) => createRisk(db, userA3, { assessmentId: assessmentA3, controlId: controlA1, title: "Source risk A3", description: null, likelihood: 3, impact: 3, inherentRating: "medium", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    findingA3 = (await withRequestDb(userA3, (db) => createFinding(db, userA3, { riskId: riskA3, title: "Source finding A3", description: null, severity: "medium", assignOwnerToSelf: false }))).id;

    const riskB = (await withRequestDb(userB, (db) => createRisk(db, userB, { assessmentId: assessmentB, controlId: controlB1, title: "Source risk B", description: null, likelihood: 3, impact: 3, inherentRating: "medium", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }))).id;
    findingB = (await withRequestDb(userB, (db) => createFinding(db, userB, { riskId: riskB, title: "Source finding B", description: null, severity: "medium", assignOwnerToSelf: false }))).id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // --- Application-layer behavior --------------------------------------

  it("createRemediationAction success: creates RemediationAction + RemediationFinding, scoped from the source Finding's own authoritative row", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRemediationAction(db, userA, {
        findingId: findingA1,
        title: "Enforce MFA on the client database",
        description: "Configure MFA for all privileged accounts.",
        priority: "high",
        dueDate: "2026-12-31",
        assignOwnerToSelf: true,
      }),
    );

    const { rows } = await asFixtureSetup((c) => c.query("SELECT * FROM remediation_actions WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({
      tenant_id: tenantA,
      organisation_id: orgA,
      engagement_id: engagementA,
      priority: "high",
      status: "open",
      owner_id: userA,
    });
    expect(rows[0].due_date.toISOString().slice(0, 10)).toBe("2026-12-31");

    const { rows: linkRows } = await asFixtureSetup((c) => c.query("SELECT * FROM remediation_findings WHERE remediation_action_id = $1", [id]));
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0]).toMatchObject({ finding_id: findingA1, tenant_id: tenantA, organisation_id: orgA, engagement_id: engagementA });
  });

  it("createRemediationAction without self-assignment or priority/due date — all stay null/default", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRemediationAction(db, userA, { findingId: findingA1, title: "Unassigned remediation", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT owner_id, priority, due_date, status FROM remediation_actions WHERE id = $1", [id]));
    expect(rows[0]).toMatchObject({ owner_id: null, priority: null, due_date: null, status: "open" });
  });

  it("createRemediationAction with an invalid due date format is rejected before any database write", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createRemediationAction(db, userA, { findingId: findingA1, title: "Bad date", description: null, priority: null, dueDate: "31/12/2026", assignOwnerToSelf: false }),
      ),
    ).rejects.toThrow(InvalidRemediationInputError);
  });

  it("createRemediationAction against a nonexistent Finding is rejected", async () => {
    await expect(
      withRequestDb(userA, (db) =>
        createRemediationAction(db, userA, { findingId: "00000000-0000-0000-0000-000000000000", title: "Should fail", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("createRemediationAction with an empty title is rejected", async () => {
    await expect(
      withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "   ", description: null, priority: null, dueDate: null, assignOwnerToSelf: false })),
    ).rejects.toThrow(InvalidRemediationInputError);
  });

  it("createRemediationAction is NOT blocked by a finalized Assessment (mirrors DECISIONS.md R-98/R-103's identical Risk/Finding conclusion)", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRemediationAction(db, userA, { findingId: findingAFinalized, title: "Remediation from a finalized assessment's finding", description: null, priority: "critical", dueDate: null, assignOwnerToSelf: false }),
    );
    const { rows } = await asFixtureSetup((c) => c.query("SELECT id FROM remediation_actions WHERE id = $1", [id]));
    expect(rows).toHaveLength(1);
  });

  it("updateRemediationAction: title/description/priority/status/due_date/owner all update; completed_at is set once on entering a terminal status and never cleared afterward", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRemediationAction(db, userA, { findingId: findingA1, title: "Original title", description: "Original", priority: "low", dueDate: null, assignOwnerToSelf: false }),
    );

    await withRequestDb(userA, (db) =>
      updateRemediationAction(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        remediationActionId: id,
        title: "Updated title",
        description: "Updated description",
        priority: "critical",
        status: "closed",
        dueDate: "2026-06-30",
        ownerAction: "assign_self",
      }),
    );
    let row = (await asFixtureSetup((c) => c.query("SELECT * FROM remediation_actions WHERE id = $1", [id]))).rows[0];
    expect(row).toMatchObject({ title: "Updated title", description: "Updated description", priority: "critical", status: "closed", owner_id: userA });
    expect(row.due_date.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(row.completed_at).not.toBeNull();
    const firstCompletedAt = row.completed_at;

    // Move status away from terminal, then back — completed_at is
    // never cleared or re-stamped (it records when status FIRST
    // reached a terminal value, not a live "currently terminal" flag).
    await withRequestDb(userA, (db) =>
      updateRemediationAction(db, userA, { organisationId: orgA, engagementId: engagementA, remediationActionId: id, title: "Updated title", description: "Updated description", priority: "critical", status: "in_progress", dueDate: "2026-06-30", ownerAction: "unassign" }),
    );
    row = (await asFixtureSetup((c) => c.query("SELECT status, owner_id, completed_at FROM remediation_actions WHERE id = $1", [id]))).rows[0];
    expect(row).toMatchObject({ status: "in_progress", owner_id: null });
    expect(row.completed_at).toEqual(firstCompletedAt);

    await withRequestDb(userA, (db) =>
      updateRemediationAction(db, userA, { organisationId: orgA, engagementId: engagementA, remediationActionId: id, title: "Updated title", description: "Updated description", priority: "critical", status: "validated", dueDate: "2026-06-30", ownerAction: "keep" }),
    );
    row = (await asFixtureSetup((c) => c.query("SELECT completed_at FROM remediation_actions WHERE id = $1", [id]))).rows[0];
    expect(row.completed_at).toEqual(firstCompletedAt);
  });

  it("updateRemediationAction with an empty title is rejected", async () => {
    const { id } = await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "Has a title", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }));
    await expect(
      withRequestDb(userA, (db) =>
        updateRemediationAction(db, userA, { organisationId: orgA, engagementId: engagementA, remediationActionId: id, title: "  ", description: null, priority: null, status: "open", dueDate: null, ownerAction: "keep" }),
      ),
    ).rejects.toThrow(InvalidRemediationInputError);
  });

  // --- Required security scenarios (PHASE C5 instructions §25) ---------

  it("1. Tenant A cannot read Tenant B's RemediationAction", async () => {
    const { id: remB } = await withRequestDb(userB, (db) => createRemediationAction(db, userB, { findingId: findingB, title: "Tenant B remediation", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }));
    await expect(
      withRequestDb(userA, (db) => getRemediationActionDetail(db, userA, { organisationId: orgB, engagementId: engagementB, remediationActionId: remB })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("2. Organisation A cannot read Organisation A2's RemediationAction (same tenant)", async () => {
    const { id: remA2 } = await withRequestDb(userA2, (db) => createRemediationAction(db, userA2, { findingId: findingA2, title: "Org A2 remediation", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }));
    await expect(
      withRequestDb(userA, (db) => getRemediationActionDetail(db, userA, { organisationId: orgA2, engagementId: engagementA2, remediationActionId: remA2 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("3. Engagement A cannot read Engagement A3's RemediationAction (same organisation)", async () => {
    const { id: remA3 } = await withRequestDb(userA3, (db) => createRemediationAction(db, userA3, { findingId: findingA3, title: "Engagement A3 remediation", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }));
    await expect(
      withRequestDb(userA, (db) => getRemediationActionDetail(db, userA, { organisationId: orgA, engagementId: engagementA3, remediationActionId: remA3 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("4. Tenant A cannot create a RemediationAction against Tenant B's Finding", async () => {
    await expect(
      withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingB, title: "Should be rejected", description: null, priority: null, dueDate: null, assignOwnerToSelf: false })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("5. Organisation A cannot create a RemediationAction against Organisation A2's Finding", async () => {
    await expect(
      withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA2, title: "Should be rejected", description: null, priority: null, dueDate: null, assignOwnerToSelf: false })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("6. Engagement A cannot create a RemediationAction against Engagement A3's Finding (same organisation)", async () => {
    await expect(
      withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA3, title: "Should be rejected", description: null, priority: null, dueDate: null, assignOwnerToSelf: false })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("7. Anonymous access is rejected", async () => {
    await expect(asAnon((c) => c.query("SELECT * FROM remediation_actions LIMIT 1"))).rejects.toThrow();
    await expect(
      asAnon((c) => c.query(`INSERT INTO remediation_actions (engagement_id, organisation_id, tenant_id, title) VALUES ($1, $2, $3, 'Anon attempt')`, [engagementA, orgA, tenantA])),
    ).rejects.toThrow();
  });

  it("8. Unauthorized user (no membership at all) cannot create a RemediationAction", async () => {
    await expect(
      withRequestDb(outsiderA, (db) => createRemediationAction(db, outsiderA, { findingId: findingA1, title: "Should be rejected", description: null, priority: null, dueDate: null, assignOwnerToSelf: false })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("9. Unauthorized user (no membership at all) cannot update a RemediationAction", async () => {
    const { id } = await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "Target remediation", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }));
    await expect(
      withRequestDb(outsiderA, (db) =>
        updateRemediationAction(db, outsiderA, { organisationId: orgA, engagementId: engagementA, remediationActionId: id, title: "Hijacked", description: null, priority: "critical", status: "closed", dueDate: null, ownerAction: "keep" }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("10. Cross-tenant owner is rejected by the database on INSERT (migration 0022 — the same fix migrations 0020/0021 already applied to risks/findings)", async () => {
    await expect(
      asUser(userA, (c) =>
        c.query(`INSERT INTO remediation_actions (engagement_id, organisation_id, tenant_id, title, owner_id) VALUES ($1, $2, $3, 'Cross-tenant owner', $4)`, [
          engagementA,
          orgA,
          tenantA,
          userB,
        ]),
      ),
    ).rejects.toThrow(/remediation_actions_owner_id_tenant_fk/);
  });

  it("10b. Cross-tenant owner is also rejected by the database on UPDATE, not only INSERT (PHASE C5 instructions §18)", async () => {
    const target = await asFixtureSetup((c) =>
      c
        .query(`INSERT INTO remediation_actions (engagement_id, organisation_id, tenant_id, title, owner_id) VALUES ($1, $2, $3, 'UPDATE-attack target', $4) RETURNING id`, [
          engagementA,
          orgA,
          tenantA,
          userA,
        ])
        .then((r) => r.rows[0].id),
    );
    await expect(
      asFixtureSetup((c) => c.query(`UPDATE remediation_actions SET owner_id = $1 WHERE id = $2`, [userB, target])),
    ).rejects.toThrow(/remediation_actions_owner_id_tenant_fk/);
  });

  it("11. Cross-tenant owner is rejected through the application — createRemediationAction's own input type only supports self-assignment", async () => {
    const { id } = await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "Self-assign probe", description: null, priority: null, dueDate: null, assignOwnerToSelf: true }));
    const { rows } = await asFixtureSetup((c) => c.query("SELECT owner_id FROM remediation_actions WHERE id = $1", [id]));
    expect(rows[0]!.owner_id).toBe(userA);
  });

  it("11b. Migration 0022 safety (PHASE C5 instructions §18): NULL owners and existing same-tenant owners both remain valid — a plain SELECT over rows with each shape succeeds without any constraint violation", async () => {
    const nullOwnerId = (
      await asFixtureSetup((c) =>
        c
          .query(`INSERT INTO remediation_actions (engagement_id, organisation_id, tenant_id, title, owner_id) VALUES ($1, $2, $3, 'Null owner (pre-existing shape)', NULL) RETURNING id`, [
            engagementA,
            orgA,
            tenantA,
          ])
          .then((r) => r.rows[0].id),
      )
    );
    const sameTenantOwnerId = (
      await asFixtureSetup((c) =>
        c
          .query(`INSERT INTO remediation_actions (engagement_id, organisation_id, tenant_id, title, owner_id) VALUES ($1, $2, $3, 'Same-tenant owner (pre-existing shape)', $4) RETURNING id`, [
            engagementA,
            orgA,
            tenantA,
            userA,
          ])
          .then((r) => r.rows[0].id),
      )
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT id, owner_id FROM remediation_actions WHERE id IN ($1, $2)`, [nullOwnerId, sameTenantOwnerId]),
    );
    expect(rows).toHaveLength(2);
  });

  it("12. A direct, malicious raw INSERT with forged tenant/organisation/engagement is rejected by RLS", async () => {
    await expect(
      asUser(userA, (c) => c.query(`INSERT INTO remediation_actions (engagement_id, organisation_id, tenant_id, title) VALUES ($1, $2, $3, 'Forged scope')`, [engagementB, orgB, tenantB])),
    ).rejects.toThrow();
  });

  it("13. Browser-supplied forged scope ids cannot cross a tenant boundary even with a real RemediationAction id", async () => {
    const { id } = await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "Real remediation, forged scope on update", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }));
    await expect(
      withRequestDb(userA, (db) =>
        updateRemediationAction(db, userA, { organisationId: orgB, engagementId: engagementB, remediationActionId: id, title: "Should be rejected", description: null, priority: null, status: "closed", dueDate: null, ownerAction: "keep" }),
      ),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("14. A RemediationAction's source Finding relationship cannot cross a tenant boundary (remediation_findings_finding_scope_fk)", async () => {
    const { id: remediationActionId } = await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "Legit remediation", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }));
    await expect(
      asFixtureSetup((c) =>
        c.query(`INSERT INTO remediation_findings (remediation_action_id, finding_id, tenant_id, organisation_id, engagement_id) VALUES ($1, $2, $3, $4, $5)`, [
          remediationActionId,
          findingB,
          tenantA,
          orgA,
          engagementA,
        ]),
      ),
    ).rejects.toThrow();
  });

  it("15. The full Risk → Finding → Remediation chain remains tenant-safe end-to-end", async () => {
    const { id: remediationActionId } = await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "Chain-safety check", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }));

    await expect(
      withRequestDb(userB, (db) => getRemediationActionDetail(db, userB, { organisationId: orgA, engagementId: engagementA, remediationActionId })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(
      withRequestDb(userB, (db) => getFindingDetail(db, userB, { organisationId: orgA, engagementId: engagementA, findingId: findingA1 })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("16. Finalized-assessment behavior matches the approved database rules — no trigger on remediation_actions/remediation_findings references Assessment finalization", async () => {
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT trigger_name FROM information_schema.triggers WHERE event_object_table IN ('remediation_actions', 'remediation_findings')`),
    );
    for (const row of rows) {
      expect(row.trigger_name).not.toMatch(/finaliz/i);
    }
  });

  it("17. Audit attribution identifies the acting user for both RemediationAction creation and update", async () => {
    const { id } = await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "Audit check remediation", description: null, priority: "low", dueDate: null, assignOwnerToSelf: false }));
    await withRequestDb(userA, (db) =>
      updateRemediationAction(db, userA, { organisationId: orgA, engagementId: engagementA, remediationActionId: id, title: "Audit check remediation (updated)", description: null, priority: "high", status: "in_progress", dueDate: null, ownerAction: "keep" }),
    );
    const { rows } = await asFixtureSetup((c) =>
      c.query(`SELECT action, actor_user_id, field_changes FROM audit_log WHERE entity_type = 'remediation_actions' AND entity_id = $1 ORDER BY occurred_at ASC`, [id]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: "insert", actor_user_id: userA });
    expect(rows[1]).toMatchObject({ action: "update", actor_user_id: userA });
    expect(rows[1]!.field_changes.new.priority).toBe("high");
    expect(rows[1]!.field_changes.old.priority).toBe("low");
  });

  // --- Traceability (PHASE C5 instructions §27) -------------------------

  it("Full chain: Assessment A → Control C1 → Response → Risk R1 → Finding F1 → Remediation Rm1 → Evidence remains queryable end-to-end; Tenant B cannot traverse any part of it", async () => {
    const chainRisk = (
      await withRequestDb(userA, (db) =>
        createRisk(db, userA, { assessmentId: assessmentA, controlId: controlA1, title: "Chain risk", description: null, likelihood: 4, impact: 4, inherentRating: "high", residualLikelihood: null, residualImpact: null, residualRating: null, assignOwnerToSelf: false }),
      )
    ).id;
    const chainFinding = (
      await withRequestDb(userA, (db) => createFinding(db, userA, { riskId: chainRisk, title: "Chain finding", description: null, severity: "high", assignOwnerToSelf: false }))
    ).id;
    const chainRemediation = (
      await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: chainFinding, title: "Chain remediation", description: null, priority: "high", dueDate: null, assignOwnerToSelf: false }))
    ).id;
    await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Chain evidence (from assessment response)",
        evidenceType: "other",
        linkTo: { type: "assessment_response", assessmentResponseId: responseA1 },
        file: textFile(),
      }),
    );
    await withRequestDb(userA, (db) =>
      uploadEvidence(db, userA, {
        organisationId: orgA,
        engagementId: engagementA,
        title: "Chain evidence (submitted directly against the remediation)",
        evidenceType: "other",
        linkTo: { type: "remediation_action", remediationActionId: chainRemediation },
        file: textFile(),
      }),
    );

    // Full chain, resolved exactly as the RemediationAction detail page
    // itself composes it.
    const remediationDetail = await withRequestDb(userA, (db) => getRemediationActionDetail(db, userA, { organisationId: orgA, engagementId: engagementA, remediationActionId: chainRemediation }));
    expect(remediationDetail.sourceFindings[0]!.id).toBe(chainFinding);

    const findingDetail = await withRequestDb(userA, (db) => getFindingDetail(db, userA, { organisationId: orgA, engagementId: engagementA, findingId: chainFinding }));
    expect(findingDetail.sourceRisks[0]!.id).toBe(chainRisk);

    const riskDetail = await withRequestDb(userA, (db) => getRiskDetail(db, userA, { organisationId: orgA, engagementId: engagementA, riskId: chainRisk }));
    expect(riskDetail.sourceAssessment?.id).toBe(assessmentA);
    expect(riskDetail.sourceControls[0]!.id).toBe(controlA1);
    expect(riskDetail.sourceAssessmentResponse?.id).toBe(responseA1);

    const [tests, indirectEvidence, directEvidence] = await withRequestDb(userA, async (db) => {
      const t = await getControlTestsForControl(db, riskDetail.sourceAssessment!.id, riskDetail.sourceControls[0]!.id);
      const indirect = await getEvidenceSummaryForControl(db, riskDetail.sourceAssessmentResponse!.id, t.map((x) => x.id), true);
      const direct = await getEvidenceSummaryForRemediationAction(db, chainRemediation, true);
      return [t, indirect, direct] as const;
    });
    void tests;
    expect(indirectEvidence.some((e) => e.title === "Chain evidence (from assessment response)")).toBe(true);
    expect(directEvidence.some((e) => e.title === "Chain evidence (submitted directly against the remediation)")).toBe(true);

    // Tenant B cannot traverse any part of this chain, even with the
    // real ids.
    await expect(
      withRequestDb(userB, (db) => getRemediationActionDetail(db, userB, { organisationId: orgA, engagementId: engagementA, remediationActionId: chainRemediation })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(
      withRequestDb(userB, (db) => getFindingDetail(db, userB, { organisationId: orgA, engagementId: engagementA, findingId: chainFinding })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(
      withRequestDb(userB, (db) => getRiskDetail(db, userB, { organisationId: orgA, engagementId: engagementA, riskId: chainRisk })),
    ).rejects.toThrow(NotFoundOrForbiddenError);
    const tenantBDirectEvidence = await withRequestDb(userB, (db) => getEvidenceSummaryForRemediationAction(db, chainRemediation, true));
    expect(tenantBDirectEvidence).toHaveLength(0);
  });

  // --- Read functions ----------------------------------------------------

  it("listRemediationActionsForEngagement returns remediation actions scoped to the engagement, joining source finding identity where a link exists", async () => {
    const { id } = await withRequestDb(userA, (db) =>
      createRemediationAction(db, userA, { findingId: findingA1, title: "List-read check remediation", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }),
    );
    const rows = await withRequestDb(userA, (db) => listRemediationActionsForEngagement(db, userA, { organisationId: orgA, engagementId: engagementA }));
    expect(rows.length).toBeGreaterThan(0);
    const created = rows.find((r) => r.id === id);
    // A remediation_findings link always exists for anything created
    // through the real createRemediationAction function — a row with
    // no link at all (e.g. inserted directly via raw SQL, as this same
    // file's own "11b" test does) is a legitimate, honest LEFT JOIN
    // miss, not something every row must have.
    expect(created?.sourceFindingTitle).toBeTruthy();
  });

  it("listRemediationActionsForFinding is scoped to exactly one Finding", async () => {
    const { id } = await withRequestDb(userA, (db) => createRemediationAction(db, userA, { findingId: findingA1, title: "Scoped-to-finding remediation", description: null, priority: null, dueDate: null, assignOwnerToSelf: false }));
    const rowsForA1 = await withRequestDb(userA, (db) => listRemediationActionsForFinding(db, findingA1));
    const rowsForAFinalized = await withRequestDb(userA, (db) => listRemediationActionsForFinding(db, findingAFinalized));
    expect(rowsForA1.some((r) => r.id === id)).toBe(true);
    expect(rowsForAFinalized.some((r) => r.id === id)).toBe(false);
  });
});
