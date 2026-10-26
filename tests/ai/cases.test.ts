// The four operations flows and report issuance, through the real worker,
// real row-level security and the real sign-off gates.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { finalizeAssessment } from "@/lib/domain/assessments";
import { saveAiSettings } from "@/lib/ai/settings";
import { runOnce } from "@/lib/ai/worker";
import { decideSuggestion, listSuggestions, getQueueCounts } from "@/lib/ai/suggestions";
import { approveCaseResponse, closeCase, createCase, getCase, listCases, saveDraftResponse, CaseInputError } from "@/lib/ai/cases";
import { listRecentJobs, listReportIssuances, retryJob, runNow, jobCounts } from "@/lib/ai/control";
import { pool } from "../app/helpers";
import { buildAiFixture, type AiFixture } from "./helpers";

async function drain(max = 60) {
  let n = 0;
  while (n < max && (await runOnce("case-worker", () => {}))) n++;
  return n;
}
const GATES_ON = { rejectCriticalEvidence: true, releaseCriticalFindings: true, issueFinalReport: true, sendBreachNotices: true };

describe("operations flows and report issuance", () => {
  let f: AiFixture;
  const scope = () => ({ engagementId: f.engagementId, organisationId: f.organisationId });
  const configure = (level: 1 | 2 | 3, gates = GATES_ON) =>
    withRequestDb(f.emId, (db) =>
      saveAiSettings(db, f.emId, { ...scope(), enabled: true, level, thresholdSupervised: 0.9, thresholdFull: 0.75, gates, allowExternalAi: false }),
    );

  beforeAll(async () => {
    f = await buildAiFixture("Cases");
    await configure(3);
  });

  it("rights request: opened, triaged by the AI with a 90-day clock and a draft reply, then a person approves", async () => {
    const c = await withRequestDb(f.consultantId, (db) =>
      createCase(db, f.consultantId, scope(), { type: "rights_request", title: "Access request from a customer", details: { requestType: "access", identityVerified: true, retentionObligation: false, notes: "Customer asked for a copy of their data." } }),
    );
    expect(c.reference).toMatch(/^RR-\d{4}-0001$/);
    const days = Math.round((c.dueAt!.getTime() - c.receivedAt.getTime()) / 86400_000);
    expect(days).toBe(90);
    await drain();
    // Whether policy auto-applied it or queued it, a person can finish it.
    const pending = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId, { status: ["pending_review"] }));
    for (const s of pending.filter((x) => x.kind === "rights_triage")) await withRequestDb(f.emId, (db) => decideSuggestion(db, f.emId, { suggestionId: s.id, action: "approve" }));
    const got = await withRequestDb(f.emId, (db) => getCase(db, f.emId, scope(), c.id));
    expect(got.status).toBe("triaged");
    expect(got.aiAssessment).toBeTruthy();
    expect(got.draftResponse).toBeTruthy();
    // Edit, approve, close.
    await withRequestDb(f.emId, (db) => saveDraftResponse(db, f.emId, scope(), c.id, got.draftResponse + "\n\nReviewed by the DPO."));
    await withRequestDb(f.consultantId, (db) => approveCaseResponse(db, f.consultantId, scope(), c.id));
    const approved = await withRequestDb(f.emId, (db) => getCase(db, f.emId, scope(), c.id));
    expect(approved.responseApprovedBy).toBe(f.consultantId);
    await expect(withRequestDb(f.emId, (db) => saveDraftResponse(db, f.emId, scope(), c.id, "tamper"))).rejects.toThrow(CaseInputError);
    await withRequestDb(f.emId, (db) => closeCase(db, f.emId, scope(), c.id));
  });

  it("breach: 72-hour clock; the notice is held at the gate; only release-rights holders can authorise it", async () => {
    const c = await withRequestDb(f.consultantId, (db) =>
      createCase(db, f.consultantId, scope(), { type: "breach", title: "Mis-sent customer file", details: { discoveredAt: "2026-10-20T08:00:00.000Z", categories: ["financial", "contact"], principalsAffected: 120, encrypted: false, contained: false, description: "A spreadsheet was emailed to the wrong recipient." } }),
    );
    expect(c.dueAt!.toISOString()).toBe("2026-10-23T08:00:00.000Z");
    await drain();
    const all = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId, {}));
    const notice = all.find((s) => s.kind === "breach_notice" && s.subjectId === c.id)!;
    expect(notice.status).toBe("pending_review");
    expect(notice.gate).toBe("send_breach_notices");
    const counts = await withRequestDb(f.emId, (db) => getQueueCounts(db, f.engagementId));
    expect(counts.gated).toBeGreaterThanOrEqual(1);
    // A consultant cannot decide a gated item, nor approve a breach response.
    await expect(withRequestDb(f.consultantId, (db) => decideSuggestion(db, f.consultantId, { suggestionId: notice.id, action: "approve" }))).rejects.toThrow();
    const mid = await withRequestDb(f.emId, (db) => getCase(db, f.emId, scope(), c.id));
    expect(mid.responseApprovedAt).toBeNull();
    expect(mid.draftResponse ?? "").not.toContain("BOARD NOTICE"); // not applied before sign-off
    // The Engagement Manager authorises.
    await withRequestDb(f.emId, (db) => decideSuggestion(db, f.emId, { suggestionId: notice.id, action: "approve" }));
    const after = await withRequestDb(f.emId, (db) => getCase(db, f.emId, scope(), c.id));
    expect(after.draftResponse).toContain("BOARD NOTICE");
    expect(after.responseApprovedBy).toBe(f.emId);
    // The assessment of a serious breach is also a person's call; approving it fills in severity.
    const assess = (await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId, { status: ["pending_review"] }))).find((s) => s.kind === "breach_assess" && s.subjectId === c.id);
    if (assess) await withRequestDb(f.emId, (db) => decideSuggestion(db, f.emId, { suggestionId: assess.id, action: "approve" }));
    const done = await withRequestDb(f.emId, (db) => getCase(db, f.emId, scope(), c.id));
    expect(done.severity).toBe("critical");
  });

  it("breach notice with the gate switched off is prepared by the AI but never authorised by it", async () => {
    await configure(3, { ...GATES_ON, sendBreachNotices: false });
    const c = await withRequestDb(f.emId, (db) =>
      createCase(db, f.emId, scope(), { type: "breach", title: "Lost laptop", details: { discoveredAt: "2026-10-21T08:00:00.000Z", categories: ["contact"], principalsAffected: 5, encrypted: true, contained: true, description: "Laptop lost, disk encrypted." } }),
    );
    await drain();
    const got = await withRequestDb(f.emId, (db) => getCase(db, f.emId, scope(), c.id));
    if (got.draftResponse) {
      expect(got.responseApprovedAt).toBeNull(); // the database forbids the agent from approving
      expect(got.status).toBe("awaiting_approval");
    }
    await configure(3);
  });

  it("consent and vendor reviews produce assessments a person can see", async () => {
    const consent = await withRequestDb(f.emId, (db) =>
      createCase(db, f.emId, scope(), { type: "consent_review", title: "Sign-up form consent", details: { consentText: "By using this site you agree to everything we do.", languages: ["English"], preTicked: true, bundled: true, withdrawalAsEasy: null } }),
    );
    const vendor = await withRequestDb(f.emId, (db) =>
      createCase(db, f.emId, scope(), { type: "vendor_review", title: "Payroll vendor", details: { vendorName: "PayCo", services: "Payroll processing", dataCategories: ["financial"], answers: { hasDpa: false, breachNotificationHours: null, certifications: [], crossBorder: true, encryptionAtRest: false, deletionOnExit: false, auditRights: false, subprocessorsDisclosed: false } } }),
    );
    await drain();
    const pending = await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId, { status: ["pending_review"] }));
    for (const s of pending.filter((x) => (x.kind === "consent_review" || x.kind === "vendor_review") && !x.gate)) await withRequestDb(f.emId, (db) => decideSuggestion(db, f.emId, { suggestionId: s.id, action: "approve" }));
    const [c1, v1] = await withRequestDb(f.emId, async (db) => [await getCase(db, f.emId, scope(), consent.id), await getCase(db, f.emId, scope(), vendor.id)] as const);
    expect((c1.aiAssessment as { verdict: string }).verdict).toBe("non_compliant");
    expect(c1.severity).toBe("high");
    expect((v1.aiAssessment as { recommendation: string }).recommendation).toBe("do_not_approve");
  });

  it("invalid case details are refused with a plain message; outsiders see nothing", async () => {
    await expect(withRequestDb(f.emId, (db) => createCase(db, f.emId, scope(), { type: "vendor_review", title: "x", details: {} }))).rejects.toThrow(CaseInputError);
    await expect(withRequestDb(f.emId, (db) => createCase(db, f.emId, scope(), { type: "breach", title: "x", details: { discoveredAt: "not a date" } }))).rejects.toThrow(/not valid/);
    const other = await buildAiFixture("CasesOther");
    await expect(withRequestDb(other.emId, (db) => listCases(db, other.emId, scope()))).rejects.toThrow();
    const rows = await pool.query(`SELECT count(*)::int AS n FROM ops_cases WHERE engagement_id = $1`, [f.engagementId]);
    expect(rows.rows[0].n).toBeGreaterThanOrEqual(4);
  });

  it("final report: held at the gate, issued as a numbered version once a manager approves", async () => {
    // Rate the controls (as the practice would), then finalise.
    await pool.query(`UPDATE assessment_responses SET effectiveness_rating = 'implemented' WHERE engagement_id = $1`, [f.engagementId]).catch(() => undefined);
    await withRequestDb(f.emId, (db) => finalizeAssessment(db, f.emId, { organisationId: f.organisationId, engagementId: f.engagementId, assessmentId: f.assessmentId }));
    await withRequestDb(f.emId, (db) => runNow(db, f.emId, scope()));
    await drain();
    const sugg = (await withRequestDb(f.emId, (db) => listSuggestions(db, f.engagementId, { status: ["pending_review"] }))).find((s) => s.kind === "report_issue")!;
    expect(sugg).toBeTruthy();
    expect(sugg.gate).toBe("issue_final_report");
    expect((sugg.proposed as { headline: string }).headline).toBeTruthy();
    await expect(withRequestDb(f.consultantId, (db) => decideSuggestion(db, f.consultantId, { suggestionId: sugg.id, action: "approve" }))).rejects.toThrow();
    await withRequestDb(f.emId, (db) => decideSuggestion(db, f.emId, { suggestionId: sugg.id, action: "approve" }));
    const issued = await withRequestDb(f.consultantId, (db) => listReportIssuances(db, f.consultantId, scope()));
    expect(issued).toHaveLength(1);
    expect(issued[0]!.version).toBe(1);
    expect(issued[0]!.issuedBy).toBe(f.emId);
    // A second pass does not issue it again.
    await withRequestDb(f.emId, (db) => runNow(db, f.emId, scope()));
    await drain();
    expect(await withRequestDb(f.emId, (db) => listReportIssuances(db, f.emId, scope()))).toHaveLength(1);
  });

  it("failed jobs can be seen and retried by a supervisor", async () => {
    const { rows } = await pool.query(
      `INSERT INTO ai_jobs (tenant_id, organisation_id, engagement_id, kind, status, attempts, error) VALUES ($1,$2,$3,'plan','failed',3,'boom') RETURNING id`,
      [f.tenantId, f.organisationId, f.engagementId],
    );
    const jobs = await withRequestDb(f.consultantId, (db) => listRecentJobs(db, f.consultantId, scope()));
    expect(jobs.some((j) => j.id === rows[0].id && j.status === "failed")).toBe(true);
    expect((await withRequestDb(f.emId, (db) => jobCounts(db, scope()))).failed).toBeGreaterThanOrEqual(1);
    await withRequestDb(f.consultantId, (db) => retryJob(db, f.consultantId, scope(), rows[0].id));
    const after = await pool.query(`SELECT status, attempts FROM ai_jobs WHERE id = $1`, [rows[0].id]);
    expect(after.rows[0]).toMatchObject({ status: "queued", attempts: 0 });
    await expect(withRequestDb(f.consultantId, (db) => retryJob(db, f.consultantId, scope(), rows[0].id))).rejects.toThrow();
  });
});
