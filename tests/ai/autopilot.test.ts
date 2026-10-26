// End-to-end tests of the AI layer against real PostgreSQL: the agent is a
// real user under real row-level security; the worker loop is the real one.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { uploadEvidence } from "@/lib/domain/evidence";
import { createEngagementScope } from "@/lib/domain/applicability";
import { saveAiSettings, getAiSettings, pauseAi, resumeAi } from "@/lib/ai/settings";
import { enqueueJob } from "@/lib/ai/queue";
import { runOnce } from "@/lib/ai/worker";
import { decideSuggestion, listSuggestions, getQueueCounts, listEvents } from "@/lib/ai/suggestions";
import { asFixtureSetup, createControlTest as createControlTestFixture, pool } from "../app/helpers";
import { buildAiFixture, GOOD_POLICY_TEXT, JUNK_TEXT, type AiFixture } from "./helpers";

const file = (text: string, name: string) => ({ buffer: Buffer.from(text, "utf8"), filename: name, mimeType: "text/plain" });

async function drain(max = 60): Promise<number> {
  let n = 0;
  while (n < max && (await runOnce("test-worker", () => {}))) n++;
  return n;
}

async function run(f: AiFixture, full = true) {
  await withRequestDb(f.emId, (db) =>
    enqueueJob(db, { tenantId: f.tenantId, organisationId: f.organisationId, engagementId: f.engagementId, kind: "plan", payload: { full }, dedupeKey: "plan", requestedBy: f.emId }),
  );
  return drain();
}

async function upload(f: AiFixture, key: string, text: string, name: string) {
  return withRequestDb(f.emId, (db) =>
    uploadEvidence(db, f.emId, {
      organisationId: f.organisationId,
      engagementId: f.engagementId,
      title: `Evidence for ${key}`,
      evidenceType: "policy_document",
      linkTo: { type: "assessment_response", assessmentResponseId: f.responseIds[key]! },
      file: file(text, name),
    }),
  );
}

async function settings(f: AiFixture, level: 1 | 2 | 3, gates = true) {
  return withRequestDb(f.emId, (db) =>
    saveAiSettings(db, f.emId, {
      engagementId: f.engagementId,
      organisationId: f.organisationId,
      enabled: true,
      level,
      thresholdSupervised: 0.9,
      thresholdFull: 0.75,
      gates: { rejectCriticalEvidence: gates, releaseCriticalFindings: gates, issueFinalReport: gates, sendBreachNotices: gates },
      allowExternalAi: false,
    }),
  );
}

describe("AI layer — full autopilot on a small engagement", () => {
  let f: AiFixture;
  let policyEvidence: string, junkEvidence: string, breachEvidence: string;

  beforeAll(async () => {
    f = await buildAiFixture("AI Full");
    await withRequestDb(f.emId, (db) => createEngagementScope(db, f.emId, { engagementId: f.engagementId }));
  });

  it("switching the AI on gives the agent a limited engagement membership", async () => {
    const s = await settings(f, 3);
    expect(s.enabled).toBe(true);
    const { rows } = await asFixtureSetup((c) =>
      c.query(
        `SELECT r.name, em.status FROM engagement_memberships em JOIN roles r ON r.id = em.role_id WHERE em.user_id = $1 AND em.engagement_id = $2`,
        [f.agentId, f.engagementId],
      ),
    );
    expect(rows).toEqual([{ name: "AI Analyst", status: "active" }]);
  });

  it("uploads evidence and lets the autopilot work through the whole chain", async () => {
    policyEvidence = (await upload(f, "policy", GOOD_POLICY_TEXT, "privacy-policy.txt")).evidenceId;
    junkEvidence = (await upload(f, "training", JUNK_TEXT, "training.txt")).evidenceId;
    breachEvidence = (await upload(f, "breach", JUNK_TEXT + " ", "breach-procedure.txt")).evidenceId;
    // A failed control test on the retention control, with no evidence at all.
    await asFixtureSetup((c) =>
      createControlTestFixture(c, {
        controlId: f.controlIds.retention!,
        tenantId: f.tenantId,
        assessmentId: f.assessmentId,
        organisationId: f.organisationId,
        engagementId: f.engagementId,
        result: "fail",
        testerId: f.consultantId,
      }),
    );

    const jobs = await run(f);
    expect(jobs).toBeGreaterThan(3);

    const ev = await asFixtureSetup((c) => c.query(`SELECT id, review_status FROM evidence WHERE engagement_id = $1`, [f.engagementId]));
    const status = Object.fromEntries(ev.rows.map((r) => [r.id, r.review_status]));
    expect(status[policyEvidence]).toBe("accepted"); // good policy: accepted automatically
    expect(status[junkEvidence]).toBe("rejected"); // irrelevant document on a medium-risk control: rejected automatically
    expect(status[breachEvidence]).toBe("pending_review"); // reject on a CRITICAL control: held at the gate

    const sugg = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId));
    const gated = sugg.filter((s) => s.status === "pending_review" && s.gate);
    expect(gated.map((g) => g.gate)).toContain("reject_critical_evidence");
  });

  it("rated the controls it had evidence for, and raised findings for weak ones", async () => {
    const r = await asFixtureSetup((c) =>
      c.query(
        `SELECT ac.control_id, ar.effectiveness_rating, ar.system_suggested_rating FROM assessment_responses ar
         JOIN assessment_controls ac ON ac.id = ar.assessment_control_id WHERE ar.engagement_id = $1`,
        [f.engagementId],
      ),
    );
    const byControl = Object.fromEntries(r.rows.map((x) => [x.control_id, x]));
    expect(byControl[f.controlIds.policy!].effectiveness_rating).toBe("implemented");
    expect(byControl[f.controlIds.policy!].system_suggested_rating).toBe("implemented");
    // Retention: a failed test and nothing accepted => not implemented, applied automatically.
    expect(byControl[f.controlIds.retention!].effectiveness_rating).toBe("not_implemented");
    // Training: the only evidence was rejected. That is weaker proof of absence (0.74 < 0.75),
    // so the AI asks a person instead of rating.
    expect(byControl[f.controlIds.training!].effectiveness_rating).toBe("not_assessed");
    const pending = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId, { status: ["pending_review"] }));
    expect(pending.some((s) => s.kind === "rating" && (s.proposed as { controlCode?: string }).controlCode === "TR-1")).toBe(true);
    const findings = await asFixtureSetup((c) => c.query(`SELECT title, severity FROM findings WHERE engagement_id = $1`, [f.engagementId]));
    expect(findings.rows.map((r) => r.severity)).toContain("high");
  });

  it("everything the AI did is attributed to the AI user in the generic audit log", async () => {
    const a = await asFixtureSetup((c) =>
      c.query(`SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id = $1 AND entity_type IN ('evidence','assessment_responses','findings')`, [f.agentId]),
    );
    expect(a.rows[0].n).toBeGreaterThan(0);
  });

  it("the AI cannot approve a suggestion itself (database-enforced)", async () => {
    const sugg = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId, { status: ["pending_review"] }));
    const target = sugg[0]!;
    await expect(
      withRequestDb(f.agentId, (db) =>
        db.execute(`UPDATE ai_suggestions SET status = 'approved', decided_by = '${f.agentId}', decided_at = now() WHERE id = '${target.id}'` as never),
      ),
    ).rejects.toThrow();
  });

  it("a consultant cannot decide a gated suggestion; the engagement manager can", async () => {
    const sugg = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId, { status: ["pending_review"] }));
    const gated = sugg.find((s) => s.gate === "reject_critical_evidence")!;
    await expect(withRequestDb(f.consultantId, (db) => decideSuggestion(db, f.consultantId, { suggestionId: gated.id, action: "approve" }))).rejects.toThrow();
    await withRequestDb(f.emId, (db) => decideSuggestion(db, f.emId, { suggestionId: gated.id, action: "approve", note: "Agreed" }));
    const ev = await asFixtureSetup((c) => c.query(`SELECT review_status FROM evidence WHERE id = $1`, [breachEvidence]));
    expect(ev.rows[0].review_status).toBe("rejected");
  });

  it("every step is in the AI audit trail", async () => {
    const events = await withRequestDb(f.emId, (db) => listEvents(db, f.engagementId, 500));
    const types = new Set(events.map((e) => e.eventType));
    for (const t of ["settings_changed", "planned", "suggested", "auto_applied", "held_at_gate", "approved"]) expect(types.has(t)).toBe(true);
  });

  it("queue counts add up", async () => {
    const c = await withRequestDb(f.emId, (db) => getQueueCounts(db, f.engagementId));
    expect(c.autoApplied).toBeGreaterThan(0);
    expect(c.approved).toBe(1);
  });

  it("pausing removes the AI's access immediately and stops its jobs", async () => {
    await withRequestDb(f.emId, (db) => pauseAi(db, f.emId, { engagementId: f.engagementId, organisationId: f.organisationId }));
    const m = await asFixtureSetup((c) => c.query(`SELECT status FROM engagement_memberships WHERE user_id = $1 AND engagement_id = $2`, [f.agentId, f.engagementId]));
    expect(m.rows.every((r) => r.status === "revoked")).toBe(true);
    await withRequestDb(f.emId, (db) =>
      enqueueJob(db, { tenantId: f.tenantId, organisationId: f.organisationId, engagementId: f.engagementId, kind: "plan", dedupeKey: "plan2", requestedBy: f.emId }),
    );
    expect(await drain()).toBe(0); // paused engagement's jobs are never claimed
    const s = await withRequestDb(f.emId, (db) => getAiSettings(db, f.engagementId, f.organisationId));
    expect(s.paused).toBe(true);
    // And the agent can no longer see anything.
    const seen = await withRequestDb(f.agentId, (db) => listSuggestions(db, f.engagementId));
    expect(seen.length).toBe(0);
    await withRequestDb(f.emId, (db) => resumeAi(db, f.emId, { engagementId: f.engagementId, organisationId: f.organisationId }));
    const seen2 = await withRequestDb(f.agentId, (db) => listSuggestions(db, f.engagementId));
    expect(seen2.length).toBeGreaterThan(0);
  });
});

describe("AI layer — Assist level applies nothing by itself", () => {
  it("level 1 queues everything", async () => {
    const f = await buildAiFixture("AI Assist");
    await withRequestDb(f.emId, (db) => createEngagementScope(db, f.emId, { engagementId: f.engagementId }));
    await settings(f, 1);
    await upload(f, "policy", GOOD_POLICY_TEXT, "privacy-policy.txt");
    await run(f);
    const c = await withRequestDb(f.emId, (db) => getQueueCounts(db, f.engagementId));
    expect(c.autoApplied).toBe(0);
    expect(c.pending).toBeGreaterThan(0);
    const ev = await asFixtureSetup((x) => x.query(`SELECT review_status FROM evidence WHERE engagement_id = $1`, [f.engagementId]));
    expect(ev.rows.every((r) => r.review_status === "pending_review")).toBe(true);
  });
});

afterAllClose();
function afterAllClose() {
  // pool is shared with the fixtures; nothing to close here.
  void pool;
}
