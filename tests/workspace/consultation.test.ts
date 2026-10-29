// "Connect with us": the form's checks, the consent record, who can see and work a
// request, and the preliminary report that comes before it.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { CONSENT_TEXT, NOTICE_VERSION, checkConsultation, noticeFor, normaliseMobile } from "@/lib/workspace/consultation-notice";
import { deleteConsultation, listConsultations, setConsultationStatus, submitConsultation } from "@/lib/workspace/consultation";
import { buildPreliminaryReport, finalReportReleased } from "@/lib/workspace/preliminary";
import { preliminaryFacts } from "@/lib/reports/preliminary-report-pdf";
import { releaseReport } from "@/lib/workspace/reports";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { WorkspaceInputError } from "@/lib/workspace/common";
import { buildWorkspaceFixture, insertFinding, pool, type WsFixture } from "./helpers";

const good = {
  organisationName: "Orchid Hill Securities",
  sectorKey: "broking",
  employeeBand: "250_1000",
  website: "orchidhill.example",
  contactName: "Asha Menon",
  contactDesignation: "Head of Compliance",
  contactEmail: "Asha.Menon@orchidhill.example",
  contactMobile: "98765 43210",
  topics: ["dpdp_alignment", "report_insights", "not_a_topic"],
  preferredTime: "morning",
  note: "Please call after 10.",
  submitterIsContact: true,
  consent: true,
};

describe("the form's checks", () => {
  it("accepts a good form and cleans it", () => {
    const r = checkConsultation(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.contactMobile).toBe("+919876543210");
    expect(r.value.contactEmail).toBe("asha.menon@orchidhill.example");
    expect(r.value.website).toBe("https://orchidhill.example");
    expect(r.value.topics).toEqual(["dpdp_alignment", "report_insights"]);
    expect(r.value.noticeVersion).toBe(NOTICE_VERSION);
    expect(r.value.consentText).toBe(CONSENT_TEXT);
  });

  it("will not take the request without consent, and says why", () => {
    for (const consent of [false, undefined, "yes", "true", 1]) {
      const r = checkConsultation({ ...good, consent });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/tick the box to agree/);
    }
  });

  it("needs the bare minimum: organisation, contact name, designation, email, mobile, and who is filling it in", () => {
    for (const k of ["organisationName", "contactName", "contactDesignation", "contactEmail", "contactMobile"] as const) {
      expect(checkConsultation({ ...good, [k]: "  " }).ok, k).toBe(false);
    }
    expect(checkConsultation({ ...good, submitterIsContact: null }).ok).toBe(false);
    // Everything else is optional.
    expect(checkConsultation({ organisationName: "A", contactName: "B", contactDesignation: "C", contactEmail: "b@c.example", contactMobile: "9876543210", submitterIsContact: false, consent: true }).ok).toBe(true);
  });

  it("checks the mobile number and the email", () => {
    expect(normaliseMobile("98765-43210")).toBe("+919876543210");
    expect(normaliseMobile("+44 20 7946 0958")).toBe("+442079460958");
    expect(normaliseMobile("012")).toBeNull();
    expect(normaliseMobile("call me")).toBeNull();
    expect(checkConsultation({ ...good, contactEmail: "not-an-email" }).ok).toBe(false);
    expect(checkConsultation({ ...good, contactMobile: "12ab" }).ok).toBe(false);
    expect(checkConsultation({ ...good, note: "x".repeat(601) }).ok).toBe(false);
  });

  it("the notice says what is collected, why, who sees it, how long, the rights, and how to complain", () => {
    const n = noticeFor("privacy@primus.example");
    expect(n.collected.join(" ")).toMatch(/mobile number/);
    expect(n.purpose).toMatch(/30 minute consultation/);
    expect(n.sharing).toMatch(/Primus Partners/);
    expect(n.retention).toMatch(/12 months/);
    expect(n.rights).toContain("privacy@primus.example");
    expect(n.withdraw).toMatch(/as easily as you gave it/);
    expect(n.complaint).toMatch(/Data Protection Board/);
    expect(CONSENT_TEXT).toMatch(/30 minute consultation/);
    expect(CONSENT_TEXT).toMatch(/take back this agreement at any time/);
  });
});

describe("consultation requests", () => {
  let f: WsFixture;
  let id: string;
  beforeAll(async () => {
    delete process.env.CONSULTATION_INBOX_EMAIL;
    f = await buildWorkspaceFixture("Consult");
  });
  const send = (u: string, form: Record<string, unknown> = good) => withRequestDb(u, (db) => submitConsultation(db, u, { engagementId: f.engagementId, form }));

  it("a client sends a request; the consent and notice version are kept with it", async () => {
    const r = await send(f.clientAdminId);
    id = r.id;
    expect(r.emailStatus).toBe("not_configured");
    const [row] = await withRequestDb(f.clientAdminId, (db) => listConsultations(db, { engagementId: f.engagementId }));
    expect(row).toMatchObject({ id, contactMobile: "+919876543210", status: "new", noticeVersion: NOTICE_VERSION, consentText: CONSENT_TEXT, emailStatus: "not_configured", submitterIsContact: true });
    expect(row!.consentedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("if email is set up but fails, the request is still saved and Primus sees it in the app", async () => {
    process.env.CONSULTATION_INBOX_EMAIL = "consult@primus.example";
    process.env.MAIL_FROM = "no-reply@primus.example";
    process.env.SMTP_URL = "smtp://127.0.0.1:1";
    try {
      const r = await send(f.clientAdminId, { ...good, contactName: "Second Person" });
      expect(r.emailStatus).toBe("failed");
      const rows = await withRequestDb(f.emId, (db) => listConsultations(db));
      expect(rows.find((x) => x.id === r.id)).toMatchObject({ contactName: "Second Person", emailStatus: "failed" });
      await withRequestDb(f.emId, (db) => deleteConsultation(db, f.emId, r.id));
    } finally {
      delete process.env.CONSULTATION_INBOX_EMAIL; delete process.env.MAIL_FROM; delete process.env.SMTP_URL;
    }
  });

  it("a request without consent is refused and nothing is saved", async () => {
    const before = (await pool.query("SELECT count(*)::int AS n FROM consultation_requests")).rows[0].n;
    await expect(send(f.clientAdminId, { ...good, consent: false })).rejects.toThrow(WorkspaceInputError);
    expect((await pool.query("SELECT count(*)::int AS n FROM consultation_requests")).rows[0].n).toBe(before);
  });

  it("the database itself refuses a row without a consent record", async () => {
    await expect(pool.query("UPDATE consultation_requests SET consent_text = 'short' WHERE id = $1", [id])).rejects.toThrow();
    await expect(pool.query("UPDATE consultation_requests SET contact_mobile = 'abc' WHERE id = $1", [id])).rejects.toThrow();
  });

  it("the Primus team gets an in-app notification and can see the request; another organisation cannot", async () => {
    const n = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'consultation_requested'", [f.emId]);
    expect(n.rowCount).toBeGreaterThan(0);
    expect(await withRequestDb(f.emId, (db) => listConsultations(db))).toHaveLength(1);
    expect(await withRequestDb(f.otherClientId, (db) => listConsultations(db))).toHaveLength(0);
  });

  it("a client colleague sees only the requests they sent themselves", async () => {
    expect(await withRequestDb(f.cxoId, (db) => listConsultations(db, { engagementId: f.engagementId }))).toHaveLength(0);
  });

  it("a client cannot work a request; Primus can, and the record of consent cannot be edited", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => setConsultationStatus(db, f.clientAdminId, { id, status: "done", note: "x" }))).rejects.toThrow(NotFoundOrForbiddenError);
    await withRequestDb(f.emId, (db) => setConsultationStatus(db, f.emId, { id, status: "scheduled", note: "Call Thursday 11 am" }));
    const [row] = await withRequestDb(f.emId, (db) => listConsultations(db));
    expect(row).toMatchObject({ status: "scheduled", internalNote: "Call Thursday 11 am" });
    expect(row!.handledAt).not.toBeNull();
    await expect(withRequestDb(f.emId, (db) => setConsultationStatus(db, f.emId, { id, status: "bogus", note: "" }))).rejects.toThrow(WorkspaceInputError);
    const c = await pool.connect();
    try {
      for (const [user, sql] of [[f.emId, "UPDATE consultation_requests SET consent_text = 'I changed this text after the person agreed' WHERE id = $1"], [f.clientAdminId, "UPDATE consultation_requests SET status = 'done' WHERE id = $1"]] as const) {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
        await expect(c.query(sql, [id])).rejects.toThrow();
        await c.query("ROLLBACK");
      }
    } finally {
      c.release();
    }
  });

  it("only Primus can erase a request", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => deleteConsultation(db, f.clientAdminId, id))).rejects.toThrow(NotFoundOrForbiddenError);
    await withRequestDb(f.emId, (db) => deleteConsultation(db, f.emId, id));
    expect(await withRequestDb(f.emId, (db) => listConsultations(db))).toHaveLength(0);
  });
});

describe("the preliminary report", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("Prelim");
    await insertFinding(f, { title: "SECRET-DRAFT-FINDING", released: false });
    await insertFinding(f, { title: "Visible weak control", released: true });
  });

  it("is offered only after a final report has been released", async () => {
    expect(await withRequestDb(f.clientAdminId, (db) => finalReportReleased(db, f.engagementId))).toBe(false);
    await expect(withRequestDb(f.clientAdminId, (db) => buildPreliminaryReport(db, f.clientAdminId, f.engagementId))).rejects.toThrow(WorkspaceInputError);
  });

  it("is a PDF built from released records only, for the client's own engagement only", async () => {
    await withRequestDb(f.emId, (db) => releaseReport(db, f.emId, { organisationId: f.organisationId, engagementId: f.engagementId, userEmail: null }));
    expect(await withRequestDb(f.clientAdminId, (db) => finalReportReleased(db, f.engagementId))).toBe(true);
    const file = await withRequestDb(f.clientAdminId, (db) => buildPreliminaryReport(db, f.clientAdminId, f.engagementId));
    expect(file.content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file.fileName).toBe("preliminary-report.pdf");
    expect(file.content.toString("latin1")).not.toContain("SECRET-DRAFT-FINDING");
    await expect(withRequestDb(f.otherClientId, (db) => buildPreliminaryReport(db, f.otherClientId, f.engagementId))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("counts open findings by severity first and leaves out closed ones", () => {
    const data = {
      selectedAssessment: { progress: { completed: 3, total: 10 }, controlRows: [{ response: { effectivenessRating: "implemented" } }, { response: { effectivenessRating: "implemented" } }, { response: { effectivenessRating: "partially_implemented" } }, { response: null }] },
      findings: [
        { title: "Low one", severity: "low", status: "open" },
        { title: "Critical one", severity: "critical", status: "open" },
        { title: "Done one", severity: "critical", status: "closed" },
      ],
      remediationActions: [
        { title: "Later", status: "open", priority: "low", dueDate: "2027-03-01" },
        { title: "Sooner", status: "in_progress", priority: "high", dueDate: "2027-01-01" },
        { title: "Finished", status: "validated", priority: "critical", dueDate: "2026-12-01" },
      ],
    };
    const facts = preliminaryFacts(data as never);
    expect(facts.controlsAssessed).toBe(3);
    expect(facts.openFindings).toBe(2);
    expect(facts.topFindings.map((x) => x.title)).toEqual(["Critical one", "Low one"]);
    expect(facts.openActions).toBe(2);
    expect(facts.firstActions.map((x) => x.title)).toEqual(["Sooner", "Later"]);
    expect(facts.ratings[0]).toEqual({ label: "implemented", count: 2 });
  });
});
