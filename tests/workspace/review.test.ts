// Draft findings, finding release, assessment submission/validation, locks.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { listFindingsForEngagement } from "@/lib/domain/findings";
import { updateAssessmentResponse } from "@/lib/domain/assessments";
import { releaseFindings, getReviewState, submitAssessment, returnAssessment, validateAnswers } from "@/lib/workspace/review";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { WorkspaceInputError } from "@/lib/workspace/common";
import { buildWorkspaceFixture, insertFinding, pool, type WsFixture } from "./helpers";

describe("findings stay private until a reviewer releases them", () => {
  let f: WsFixture;
  let draftId: string;
  let releasedId: string;
  const scope = () => ({ engagementId: f.engagementId, organisationId: f.organisationId });

  beforeAll(async () => {
    f = await buildWorkspaceFixture("FindRel");
    draftId = await insertFinding(f, { title: "Draft: weak breach process", released: false });
    releasedId = await insertFinding(f, { title: "Released: no retention schedule", released: true });
  });

  it("the Primus team sees drafts; clients see only released findings", async () => {
    const team = await withRequestDb(f.consultantId, (db) => listFindingsForEngagement(db, f.consultantId, scope()));
    expect(team.map((x) => x.title).sort()).toEqual(["Draft: weak breach process", "Released: no retention schedule"]);
    for (const client of [f.clientAdminId, f.businessOwnerId, f.cxoId]) {
      const seen = await withRequestDb(client, (db) => listFindingsForEngagement(db, client, scope()));
      expect(seen.map((x) => x.title)).toEqual(["Released: no retention schedule"]);
    }
  });

  it("a client cannot read a draft finding even by its id", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.clientAdminId]);
      const r = await c.query("SELECT id FROM findings WHERE id = $1", [draftId]);
      expect(r.rowCount).toBe(0);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("a client cannot release a finding, whatever the screen says", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => releaseFindings(db, f.clientAdminId, { engagementId: f.engagementId, findingIds: [draftId] }))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("a consultant without the release permission cannot release", async () => {
    await expect(withRequestDb(f.consultantId, (db) => releaseFindings(db, f.consultantId, { engagementId: f.engagementId, findingIds: [draftId] }))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("the AI agent can never release a finding", async () => {
    await expect(withRequestDb(f.agentId, (db) => releaseFindings(db, f.agentId, { engagementId: f.engagementId, findingIds: [draftId] }))).rejects.toThrow();
  });

  it("the database itself refuses a release by someone without the permission (direct update)", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.consultantId]);
      await expect(c.query("UPDATE findings SET released_at = now(), released_by = $2 WHERE id = $1", [draftId, f.consultantId])).rejects.toThrow();
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("the Engagement Manager releases a draft; the client now sees it and is notified; it cannot be withdrawn", async () => {
    const out = await withRequestDb(f.emId, (db) => releaseFindings(db, f.emId, { engagementId: f.engagementId, findingIds: [draftId] }));
    expect(out.released).toBe(1);
    const seen = await withRequestDb(f.clientAdminId, (db) => listFindingsForEngagement(db, f.clientAdminId, scope()));
    expect(seen.map((x) => x.id).sort()).toEqual([draftId, releasedId].sort());
    const n = await pool.query("SELECT count(*)::int AS c FROM notifications WHERE user_id = $1 AND kind = 'findings_released'", [f.clientAdminId]);
    expect(n.rows[0].c).toBe(1);
    // The releasing person is not notified of their own action.
    const own = await pool.query("SELECT count(*)::int AS c FROM notifications WHERE user_id = $1 AND kind = 'findings_released'", [f.emId]);
    expect(own.rows[0].c).toBe(0);
    await expect(withRequestDb(f.emId, (db) => releaseFindings(db, f.emId, { engagementId: f.engagementId, findingIds: [draftId] }))).rejects.toThrow(WorkspaceInputError);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.emId]);
      await expect(c.query("UPDATE findings SET released_at = NULL, released_by = NULL WHERE id = $1", [draftId])).rejects.toThrow();
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("a finding in another organisation cannot be released through this engagement", async () => {
    const other = await insertFinding(f, { title: "Other org draft", released: false, engagementId: f.otherEngagementId, organisationId: f.otherOrgId });
    await expect(withRequestDb(f.emId, (db) => releaseFindings(db, f.emId, { engagementId: f.engagementId, findingIds: [other] }))).rejects.toThrow(WorkspaceInputError);
  });
});

describe("assessment: the client submits, a reviewer validates or returns", () => {
  let f: WsFixture;
  const scope = () => ({ engagementId: f.engagementId, organisationId: f.organisationId });
  const answer = (user: string, key: "breach" | "policy" | "training" | "retention", rating: "implemented" | "not_implemented" | "partially_implemented" = "implemented") =>
    withRequestDb(user, (db) => updateAssessmentResponse(db, user, { assessmentControlId: f.assessmentControlIds[key]!, effectivenessRating: rating, decisionRationale: "ok" }));

  beforeAll(async () => {
    f = await buildWorkspaceFixture("AsmRev");
  });

  it("cannot be submitted while questions are unanswered", async () => {
    await answer(f.clientAdminId, "breach");
    await expect(withRequestDb(f.clientAdminId, (db) => submitAssessment(db, f.clientAdminId, f.assessmentId))).rejects.toThrow(/unanswered/);
  });

  it("a read-only executive cannot answer questions", async () => {
    await expect(answer(f.cxoId, "breach")).rejects.toThrow();
  });

  it("a read-only executive cannot submit", async () => {
    await expect(withRequestDb(f.cxoId, (db) => submitAssessment(db, f.cxoId, f.assessmentId))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("a client administrator submits once everything is answered; the answers are then locked for the client", async () => {
    await answer(f.clientAdminId, "policy");
    await answer(f.businessOwnerId, "training", "partially_implemented");
    await answer(f.clientAdminId, "retention", "not_implemented");
    const before = await withRequestDb(f.clientAdminId, (db) => getReviewState(db, f.assessmentId));
    expect(before).toMatchObject({ total: 4, answered: 4, validated: 0 });
    await withRequestDb(f.clientAdminId, (db) => submitAssessment(db, f.clientAdminId, f.assessmentId));
    await expect(answer(f.clientAdminId, "breach", "not_implemented")).rejects.toThrow();
    await expect(withRequestDb(f.clientAdminId, (db) => submitAssessment(db, f.clientAdminId, f.assessmentId))).rejects.toThrow(/already submitted/);
    // The practice team is told.
    const n = await pool.query("SELECT count(*)::int AS c FROM notifications WHERE user_id = $1 AND kind = 'assessment_submitted'", [f.emId]);
    expect(n.rows[0].c).toBe(1);
    // The client is never told about their own submission.
    const own = await pool.query("SELECT count(*)::int AS c FROM notifications WHERE user_id = $1 AND kind = 'assessment_submitted'", [f.clientAdminId]);
    expect(own.rows[0].c).toBe(0);
  });

  it("only a reviewer with the permission validates; a client and the AI agent cannot", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => validateAnswers(db, f.clientAdminId, { assessmentId: f.assessmentId }))).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(withRequestDb(f.auditorId, (db) => validateAnswers(db, f.auditorId, { assessmentId: f.assessmentId }))).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(withRequestDb(f.agentId, (db) => validateAnswers(db, f.agentId, { assessmentId: f.assessmentId }))).rejects.toThrow();
    const out = await withRequestDb(f.consultantId, (db) => validateAnswers(db, f.consultantId, { assessmentId: f.assessmentId }));
    expect(out.validated).toBe(4);
    const state = await withRequestDb(f.emId, (db) => getReviewState(db, f.assessmentId));
    expect(state.validated).toBe(4);
  });

  it("returning the assessment unlocks it; a changed answer loses its validation", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => returnAssessment(db, f.clientAdminId, { assessmentId: f.assessmentId }))).rejects.toThrow(NotFoundOrForbiddenError);
    await withRequestDb(f.emId, (db) => returnAssessment(db, f.emId, { assessmentId: f.assessmentId, note: "Please recheck breach." }));
    await answer(f.clientAdminId, "breach", "partially_implemented");
    const state = await withRequestDb(f.emId, (db) => getReviewState(db, f.assessmentId));
    expect(state.submittedAt).toBeNull();
    expect(state.validated).toBe(3);
    const n = await pool.query("SELECT count(*)::int AS c FROM notifications WHERE user_id = $1 AND kind = 'assessment_returned'", [f.clientAdminId]);
    expect(n.rows[0].c).toBe(1);
  });

  it("a client cannot mark an answer validated by writing it directly", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [f.clientAdminId]);
      await expect(c.query("UPDATE assessment_responses SET validated_at = now(), validated_by = $1 WHERE assessment_control_id = $2", [f.clientAdminId, f.assessmentControlIds.breach])).rejects.toThrow();
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("another organisation's client cannot see or submit this assessment", async () => {
    await expect(withRequestDb(f.otherClientId, (db) => getReviewState(db, f.assessmentId))).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(withRequestDb(f.otherClientId, (db) => submitAssessment(db, f.otherClientId, f.assessmentId))).rejects.toThrow(NotFoundOrForbiddenError);
  });
  void scope;
});
