// Portfolio numbers: engagement phase/progress derived from records, role scoping of lists.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { derivePhase, deriveProgress, engagementMetrics, organisationOverviews, listStakeholders, listAllFindings, listAllEvidence, summarise, clientNextSteps } from "@/lib/workspace/portfolio";
import { updateAssessmentResponse } from "@/lib/domain/assessments";
import { submitAssessment } from "@/lib/workspace/review";
import { createTask } from "@/lib/workspace/tasks";
import { buildWorkspaceFixture, insertEvidence, insertFinding, asFixtureSetup, type WsFixture } from "./helpers";

describe("phase and progress are derived, not stored", () => {
  const base = { status: "active" as const, discoveryStatus: "none" as const, assessmentId: null, assessmentStatus: null, assessmentSubmitted: false, questionsTotal: 0, questionsAnswered: 0, reportsReleased: 0 };
  it("walks Draft → Discovery → Assessment → Validation → Reporting → Remediation → Closed", () => {
    expect(derivePhase({ ...base, status: "draft" })).toBe("Draft");
    expect(derivePhase(base)).toBe("Discovery");
    expect(derivePhase({ ...base, discoveryStatus: "approved", assessmentId: "a", assessmentStatus: "draft", questionsTotal: 4 })).toBe("Assessment");
    expect(derivePhase({ ...base, discoveryStatus: "approved", assessmentId: "a", assessmentStatus: "draft", assessmentSubmitted: true, questionsTotal: 4, questionsAnswered: 4 })).toBe("Validation");
    expect(derivePhase({ ...base, discoveryStatus: "approved", assessmentId: "a", assessmentStatus: "finalized", questionsTotal: 4, questionsAnswered: 4 })).toBe("Reporting");
    expect(derivePhase({ ...base, discoveryStatus: "approved", assessmentId: "a", assessmentStatus: "finalized", reportsReleased: 1 })).toBe("Remediation");
    expect(derivePhase({ ...base, status: "closed" })).toBe("Closed");
  });
  it("progress weights discovery 20, answers 30, validation 20, report 10, remediation 20", () => {
    const m = { discoveryStatus: "in_progress" as const, discoveryDone: 13, questionsTotal: 10, questionsAnswered: 10, questionsValidated: 10, reportsReleased: 1, remediationTotal: 4, remediationClosed: 2, status: "active" as const };
    expect(deriveProgress(m)).toBe(20 + 30 + 20 + 10 + 10);
    expect(deriveProgress({ ...m, discoveryDone: 0, questionsAnswered: 0, questionsValidated: 0, reportsReleased: 0, remediationClosed: 0 })).toBe(0);
    expect(deriveProgress({ ...m, status: "closed" })).toBe(100);
  });
});

describe("portfolio lists respect who is asking", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("Port");
    await asFixtureSetup(async (c) => {
      await c.query("UPDATE organisations SET industry = 'Financial services', hq_location = 'Mumbai' WHERE id = $1", [f.organisationId]);
      await c.query("UPDATE engagements SET status = 'active' WHERE id = $1", [f.engagementId]);
    });
    await insertFinding(f, { title: "Draft critical", severity: "critical", released: false });
    await insertFinding(f, { title: "Released high", severity: "high", released: true });
    await insertEvidence(f, { title: "Policy PDF", uploadedBy: f.clientAdminId, visibility: "client_visible" });
    await insertEvidence(f, { title: "Consultant working note", uploadedBy: f.consultantId, visibility: "consultant_internal" });
    await withRequestDb(f.emId, (db) => createTask(db, f.emId, { engagementId: f.engagementId, title: "Overdue client task", assigneeSide: "client", dueDate: "2020-01-01" }));
  });

  it("metrics count draft findings for the team but a client never counts them", async () => {
    const [team] = await withRequestDb(f.emId, (db) => engagementMetrics(db, { engagementId: f.engagementId }));
    expect(team).toMatchObject({ findingsCriticalHigh: 2, findingsDraft: 1, phase: "Discovery", organisationName: expect.stringContaining("Port"), industry: "Financial services", hqLocation: "Mumbai" });
    const [client] = await withRequestDb(f.clientAdminId, (db) => engagementMetrics(db, { engagementId: f.engagementId }));
    expect(client).toMatchObject({ findingsCriticalHigh: 1, findingsDraft: 0, tasksOpen: 1, tasksOverdue: 1 });
    expect(await withRequestDb(f.otherClientId, (db) => engagementMetrics(db, { engagementId: f.engagementId }))).toHaveLength(0);
  });

  it("phase moves to Assessment once the scope is approved and to Validation after submission", async () => {
    await asFixtureSetup(async (c) => {
      await c.query("INSERT INTO engagement_discovery (tenant_id, organisation_id, engagement_id, status) VALUES ($1,$2,$3,'approved')", [f.tenantId, f.organisationId, f.engagementId]);
    });
    let [m] = await withRequestDb(f.emId, (db) => engagementMetrics(db, { engagementId: f.engagementId }));
    expect(m!.phase).toBe("Assessment");
    for (const key of ["breach", "policy", "training", "retention"] as const) {
      await withRequestDb(f.clientAdminId, (db) => updateAssessmentResponse(db, f.clientAdminId, { assessmentControlId: f.assessmentControlIds[key]!, effectivenessRating: "implemented", decisionRationale: null }));
      if (key === "breach") {
        // half-answered: the total must still be every question, not only the answered ones
        const [half] = await withRequestDb(f.emId, (db) => engagementMetrics(db, { engagementId: f.engagementId }));
        expect(half).toMatchObject({ questionsTotal: 4, questionsAnswered: 1 });
      }
    }
    [m] = await withRequestDb(f.emId, (db) => engagementMetrics(db, { engagementId: f.engagementId }));
    expect(m).toMatchObject({ questionsTotal: 4, questionsAnswered: 4 });
    await withRequestDb(f.clientAdminId, (db) => submitAssessment(db, f.clientAdminId, f.assessmentId));
    [m] = await withRequestDb(f.emId, (db) => engagementMetrics(db, { engagementId: f.engagementId }));
    expect(m!.phase).toBe("Validation");
    expect(m!.progress).toBeGreaterThan(40);
  });

  it("organisation overview and summary roll the numbers up", async () => {
    const orgs = await withRequestDb(f.emId, (db) => organisationOverviews(db));
    const mine = orgs.find((o) => o.id === f.organisationId)!;
    expect(mine).toMatchObject({ industry: "Financial services", hqLocation: "Mumbai", engagements: 1, activeEngagements: 1, criticalHigh: 2 });
    const metrics = await withRequestDb(f.emId, (db) => engagementMetrics(db));
    const s = summarise(orgs.length, metrics);
    expect(s.activeEngagements).toBeGreaterThanOrEqual(1);
    expect(s.awaitingReview.assessments).toBeGreaterThanOrEqual(1);
    expect(s.overdueTasks).toBeGreaterThanOrEqual(1);
    const clientOrgs = await withRequestDb(f.clientAdminId, (db) => organisationOverviews(db));
    expect(clientOrgs.map((o) => o.id)).toEqual([f.organisationId]);
  });

  it("stakeholders: the team sees both sides; a client sees their own people and the Primus team on their engagement, never another organisation", async () => {
    const team = await withRequestDb(f.emId, (db) => listStakeholders(db));
    expect(team.some((s) => s.side === "client" && s.role === "Client Administrator")).toBe(true);
    expect(team.some((s) => s.side === "primus" && s.role === "Engagement Manager")).toBe(true);
    expect(team.every((s) => !s.email.startsWith("ai-agent@"))).toBe(true);
    const client = await withRequestDb(f.clientAdminId, (db) => listStakeholders(db));
    expect(client.every((s) => s.organisationId === f.organisationId)).toBe(true);
    const other = await withRequestDb(f.otherClientId, (db) => listStakeholders(db));
    expect(other.every((s) => s.organisationId === f.otherOrgId)).toBe(true);
  });

  it("cross-engagement findings and evidence follow the same visibility rules", async () => {
    const teamF = await withRequestDb(f.emId, (db) => listAllFindings(db));
    expect(teamF.map((x) => x.title)).toEqual(expect.arrayContaining(["Draft critical", "Released high"]));
    const clientF = await withRequestDb(f.clientAdminId, (db) => listAllFindings(db));
    expect(clientF.map((x) => x.title)).toEqual(["Released high"]);
    const teamE = await withRequestDb(f.emId, (db) => listAllEvidence(db));
    expect(teamE.map((x) => x.title)).toEqual(expect.arrayContaining(["Policy PDF", "Consultant working note"]));
    const clientE = await withRequestDb(f.clientAdminId, (db) => listAllEvidence(db, { clientOnly: true }));
    expect(clientE.map((x) => x.title)).toEqual(["Policy PDF"]);
  });

  it("the client's 'what to do next' comes from the real records", async () => {
    const [m] = await withRequestDb(f.clientAdminId, (db) => engagementMetrics(db, { engagementId: f.engagementId }));
    const steps = clientNextSteps(m!);
    expect(steps.map((s) => s.label)).toContain("Finish your tasks");
    expect(steps.map((s) => s.label)).not.toContain("Answer the assessment questions");
  });
});
