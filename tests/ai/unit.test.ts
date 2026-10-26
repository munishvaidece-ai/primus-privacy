import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import PDFDocument from "pdfkit";
import { route, gateFor } from "@/lib/ai/routing";
import { maskPii, detectPiiCategories } from "@/lib/ai/mask";
import { controlTier } from "@/lib/ai/tier";
import { extractJson, runTask } from "@/lib/ai/engine";
import { chooseProvider } from "@/lib/ai/providers";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { OpenAiCompatibleProvider } from "@/lib/ai/providers/openai";
import { readAiConfig } from "@/lib/ai/config";
import { extractText } from "@/lib/ai/extract";
import { evidenceReviewDraft, evidenceReviewTask, offlineEvidenceReview, type EvidenceReviewInput } from "@/lib/ai/tasks/evidence-review";
import { offlineApplicability } from "@/lib/ai/tasks/applicability";
import { offlineRating } from "@/lib/ai/tasks/rating";
import { offlineFinding, bandRating } from "@/lib/ai/tasks/finding";
import { offlineReport } from "@/lib/ai/tasks/report";
import { offlineRights, offlineBreach, offlineConsent, offlineVendor } from "@/lib/ai/tasks/ops";
import { verifyCitations } from "@/lib/ai/text";
import { GOOD_POLICY_TEXT, JUNK_TEXT } from "./helpers";

const gates = { rejectCriticalEvidence: true, releaseCriticalFindings: true, issueFinalReport: true, sendBreachNotices: true };
const base = { kind: "rating" as const, proposed: {}, confidence: 0.95, tier: "low" as const, level: 3 as const, thresholdSupervised: 0.9, thresholdFull: 0.75, gates };

describe("routing", () => {
  it("level 1 never auto-applies", () => {
    expect(route({ ...base, level: 1 }).mode).toBe("queue");
  });
  it("level 2 auto-applies only high-confidence low/medium work", () => {
    expect(route({ ...base, level: 2 }).mode).toBe("auto_apply");
    expect(route({ ...base, level: 2, confidence: 0.85 }).mode).toBe("queue");
    expect(route({ ...base, level: 2, tier: "high" }).mode).toBe("queue");
    expect(route({ ...base, level: 2, tier: "critical" }).mode).toBe("queue");
  });
  it("level 3 uses the lower threshold, and 0.90 for critical", () => {
    expect(route({ ...base, confidence: 0.76 }).mode).toBe("auto_apply");
    expect(route({ ...base, confidence: 0.7 }).mode).toBe("queue");
    expect(route({ ...base, tier: "critical", confidence: 0.85 }).mode).toBe("queue");
    expect(route({ ...base, tier: "critical", confidence: 0.92 }).mode).toBe("auto_apply");
  });
  it("needsHuman always queues", () => {
    expect(route({ ...base, needsHuman: "unreadable" }).mode).toBe("queue");
  });
  it("the four gates override every level", () => {
    expect(gateFor("evidence_review", { decision: "rejected" }, "critical", gates)).toBe("reject_critical_evidence");
    expect(gateFor("evidence_review", { decision: "accepted" }, "critical", gates)).toBeNull();
    expect(gateFor("evidence_review", { decision: "rejected" }, "high", gates)).toBeNull();
    expect(gateFor("finding_create", { severity: "critical" }, "low", gates)).toBe("release_critical_findings");
    expect(gateFor("finding_create", { severity: "high" }, "low", gates)).toBeNull();
    expect(gateFor("report_issue", {}, "low", gates)).toBe("issue_final_report");
    expect(gateFor("breach_notice", {}, "low", gates)).toBe("send_breach_notices");
    const d = route({ ...base, kind: "report_issue", confidence: 1 });
    expect(d).toMatchObject({ mode: "queue", gate: "issue_final_report" });
  });
  it("a gate that is switched off no longer holds the item", () => {
    const off = { ...gates, issueFinalReport: false };
    expect(route({ ...base, kind: "report_issue", confidence: 0.99, gates: off }).mode).toBe("auto_apply");
  });
});

describe("masking and detection", () => {
  it("masks Indian identifiers and contact details", () => {
    const m = maskPii("Mail a.b@example.com, Aadhaar 2345 6789 0123, PAN ABCDE1234F, phone +91 98765 43210, IFSC HDFC0001234, ip 10.1.2.3");
    expect(m.text).not.toMatch(/example\.com|2345|ABCDE|98765|HDFC0|10\.1\.2/);
    expect(m.text).toContain("[EMAIL]");
    expect(m.text).toContain("[AADHAAR]");
    expect(m.text).toContain("[PAN]");
    expect(m.counts.email).toBe(1);
  });
  it("detects categories without keeping values", () => {
    expect(detectPiiCategories("ABCDE1234F and x@y.org")).toEqual(expect.arrayContaining(["pan", "email"]));
    expect(detectPiiCategories("nothing personal here")).toEqual([]);
  });
});

describe("control tier", () => {
  it("derives tier from wording", () => {
    expect(controlTier({ title: "Personal data breach notification" }).tier).toBe("critical");
    expect(controlTier({ title: "Vendor due diligence" }).tier).toBe("high");
    expect(controlTier({ title: "Staff privacy awareness training" }).tier).toBe("medium");
    expect(controlTier({ title: "Office signage" }).tier).toBe("low");
  });
});

const ev = (over: Partial<EvidenceReviewInput> = {}): EvidenceReviewInput => ({
  evidenceId: "e1",
  title: "Privacy policy",
  evidenceType: "policy_document",
  filename: "p.txt",
  validUntil: null,
  now: "2026-10-22T00:00:00Z",
  text: GOOD_POLICY_TEXT,
  textMethod: "plain-text",
  controls: [{ code: "PP-1", title: "Privacy policy governance", description: "A written privacy policy approved by management, with a named owner, a version number and a review date.", tier: "medium" }],
  maxChars: 12000,
  ...over,
});

describe("evidence review (offline engine)", () => {
  it("supports a matching policy, with verified citations", () => {
    const o = offlineEvidenceReview(ev());
    expect(o.verdict).toBe("supports");
    const d = evidenceReviewDraft(ev(), o);
    expect(d.proposed.decision).toBe("accepted");
    expect(d.citations.length).toBeGreaterThan(0);
    expect(d.citations.every((c) => c.verified)).toBe(true);
  });
  it("does not support an irrelevant document", () => {
    const o = offlineEvidenceReview(ev({ text: JUNK_TEXT }));
    expect(o.verdict).toBe("does_not_support");
    expect(o.confidence).toBeGreaterThan(0.75);
  });
  it("calls an almost empty document unreadable and asks for a person", () => {
    const i = ev({ text: "scan", textMethod: "image-no-ocr" });
    const d = evidenceReviewDraft(i, offlineEvidenceReview(i));
    expect(d.needsHuman).toMatch(/could not be read/);
  });
  it("rejects expired evidence", () => {
    const o = offlineEvidenceReview(ev({ validUntil: "2025-01-01T00:00:00Z" }));
    expect(o.verdict).toBe("does_not_support");
    expect(o.rationale).toMatch(/expired/);
  });
  it("evidence not linked to any control goes to a person", () => {
    const i = ev({ controls: [] });
    expect(evidenceReviewDraft(i, offlineEvidenceReview(i)).needsHuman).toMatch(/not linked/);
  });
  it("citations that are not in the document are flagged and cap confidence", () => {
    const i = ev();
    const d = evidenceReviewDraft(i, { verdict: "supports", quality: "strong", confidence: 0.97, rationale: "Looks good to me", citations: [{ quote: "This sentence was invented by the model." }] });
    expect(d.citations[0]!.verified).toBe(false);
    expect(d.confidence).toBeLessThanOrEqual(0.6);
    expect(d.needsHuman).toBeTruthy();
  });
  it("verifyCitations ignores whitespace and case", () => {
    const r = verifyCitations([{ quote: "version   2.1.  EFFECTIVE from" }], "Version 2.1. Effective from 1 April");
    expect(r[0]!.verified).toBe(true);
  });
});

describe("other offline tasks", () => {
  const prof = { activities: 3, principalCategories: ["Employees", "Customers"], dataElements: [], hasProcessors: true, crossBorderHints: false, childrenHints: false };
  const ctrl = (title: string) => ({ code: "X-1", title, description: null, tier: "medium" as const });
  it("applicability: applicable by default; N/A only on positive evidence", () => {
    expect(offlineApplicability({ engagementScopeControlId: "s", control: ctrl("Privacy notice"), profile: prof }).decision).toBe("applicable");
    const kids = offlineApplicability({ engagementScopeControlId: "s", control: ctrl("Verifiable parental consent for children"), profile: prof });
    expect(kids.decision).toBe("not_applicable");
    expect(kids.rationale).toMatch(/Employees|none of the 3/);
    expect(offlineApplicability({ engagementScopeControlId: "s", control: ctrl("Significant Data Fiduciary DPIA"), profile: prof }).needsHuman).toBeTruthy();
    expect(offlineApplicability({ engagementScopeControlId: "s", control: ctrl("Verifiable parental consent for children"), profile: { ...prof, childrenHints: true } }).decision).toBe("applicable");
  });
  it("rating: the rules", () => {
    const now = "2026-10-22T00:00:00Z";
    const e = (s: string, q: string | null = "adequate"): { id: string; title: string; reviewStatus: string; quality: string | null; aiVerdict: null; validUntil: string | null } => ({ id: s, title: s, reviewStatus: s, quality: q, aiVerdict: null, validUntil: null });
    const mk = (evidence: ReturnType<typeof e>[], tests: Array<{ result: "pass" | "fail" | "exception_noted"; methodology: string }> = []) => ({ assessmentControlId: "a", control: ctrl("c"), currentRating: null, evidence, tests, now });
    expect(offlineRating(mk([e("accepted")], [{ result: "pass", methodology: "m" }])).rating).toBe("implemented");
    expect(offlineRating(mk([e("accepted", "weak")])).rating).toBe("partially_implemented");
    expect(offlineRating(mk([e("rejected")])).rating).toBe("not_implemented");
    expect(offlineRating(mk([], [{ result: "fail", methodology: "m" }])).rating).toBe("not_implemented");
    expect(offlineRating(mk([e("accepted")], [{ result: "fail", methodology: "m" }])).rating).toBe("partially_implemented");
    expect(offlineRating({ ...mk([{ ...e("accepted"), validUntil: "2025-01-01T00:00:00Z" }]) }).rating).toBe("not_implemented");
  });
  it("finding: severity follows tier × rating, rating band is transparent", () => {
    const f = (tier: "low" | "medium" | "high" | "critical", rating: "not_implemented" | "partially_implemented") =>
      offlineFinding({ assessmentId: "a", assessmentControlId: "c", controlId: "k", control: { code: "X", title: "T", description: null, tier }, rating, ratingRationale: "why", ratingConfidence: 0.8 });
    expect(f("critical", "not_implemented").severity).toBe("critical");
    expect(f("critical", "partially_implemented").severity).toBe("high");
    expect(f("low", "not_implemented").severity).toBe("low");
    expect(bandRating(4, 5)).toBe("critical");
    expect(bandRating(2, 2)).toBe("low");
  });
  it("report: uses only the given numbers", () => {
    const r = offlineReport({ assessmentId: "a", organisationName: "Acme", engagementName: "E", periodLabel: "FY26", controlsTotal: 10, implemented: 6, partial: 2, notImplemented: 2, notApplicable: 0, notAssessed: 0, findingsBySeverity: { low: 1, medium: 1, high: 1, critical: 0 }, openRemediation: 3, maturityScore: null });
    expect(r.headline).toContain("60%");
    expect(r.narrative).toContain("3 finding(s)");
  });
  it("rights: 90-day clock, human needed for risky erasure", () => {
    const o = offlineRights({ caseId: "c", reference: "R-1", requestType: "access", receivedAt: "2026-10-01T00:00:00Z", identityVerified: true, retentionObligation: false, notes: "" });
    expect(o.dueAt.slice(0, 10)).toBe("2026-12-30");
    expect(o.needsHuman).toBeUndefined();
    expect(offlineRights({ caseId: "c", reference: "R-2", requestType: "erasure", receivedAt: "2026-10-01T00:00:00Z", identityVerified: true, retentionObligation: true, notes: "" }).needsHuman).toBeTruthy();
  });
  it("breach: 72-hour clock and severity", () => {
    const b = offlineBreach({ caseId: "c", reference: "B-1", discoveredAt: "2026-10-01T10:00:00Z", categories: ["financial"], principalsAffected: 50, encrypted: false, contained: false, description: "mail a@b.com leaked" });
    expect(b.severity).toBe("critical");
    expect(b.boardReportDueAt).toBe("2026-10-04T10:00:00.000Z");
    expect(b.boardNoticeDraft).not.toContain("a@b.com");
    expect(offlineBreach({ caseId: "c", reference: "B-2", discoveredAt: "2026-10-01T10:00:00Z", categories: ["contact"], principalsAffected: 10, encrypted: true, contained: true, description: "" }).severity).toBe("low");
  });
  it("consent: flags pre-ticked and bundled", () => {
    const c = offlineConsent({ caseId: "c", reference: "C", consentText: "By using this site you agree to everything.", languages: ["English"], preTicked: true, bundled: true, withdrawalAsEasy: null });
    expect(c.verdict).toBe("non_compliant");
    const good = offlineConsent({ caseId: "c", reference: "C", consentText: "We collect your name and email for the purpose of order updates. You can withdraw consent any time. Contact our grievance officer by email. You may complain to the Data Protection Board.", languages: ["English", "Hindi"], preTicked: false, bundled: false, withdrawalAsEasy: true });
    expect(good.verdict).toBe("compliant");
  });
  it("vendor: no DPA means do not approve", () => {
    const answers = { hasDpa: false, breachNotificationHours: null, certifications: [], crossBorder: true, encryptionAtRest: false, deletionOnExit: false, auditRights: false, subprocessorsDisclosed: false };
    expect(offlineVendor({ caseId: "c", reference: "V", vendorName: "V", services: "", dataCategories: ["financial"], answers }).recommendation).toBe("do_not_approve");
    const ok = offlineVendor({ caseId: "c", reference: "V", vendorName: "V", services: "", dataCategories: ["contact"], answers: { hasDpa: true, breachNotificationHours: 24, certifications: ["ISO 27001"], crossBorder: false, encryptionAtRest: true, deletionOnExit: true, auditRights: true, subprocessorsDisclosed: true } });
    expect(ok.recommendation).toBe("approve");
  });
});

describe("text extraction", () => {
  it("reads plain text, html, docx, xlsx and pdf", async () => {
    expect((await extractText(Buffer.from("hello world"), "text/plain", "a.txt")).text).toBe("hello world");
    const html = await extractText(Buffer.from("<html><style>x{}</style><body><h1>Title</h1><p>Body text</p><script>1</script></body></html>"), "text/html", "a.html");
    expect(html.text).toContain("Title");
    expect(html.text).not.toContain("x{}");
    const docx = zipSync({ "word/document.xml": strToU8('<w:document><w:body><w:p><w:r><w:t>Policy &amp; Procedure</w:t></w:r></w:p><w:p><w:r><w:t>Second para</w:t></w:r></w:p></w:body></w:document>') });
    const d = await extractText(Buffer.from(docx), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx");
    expect(d.text).toContain("Policy & Procedure");
    expect(d.text).toContain("Second para");
    const xlsx = zipSync({
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Control</t></si><si><t>Status</t></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c><v>42</v></c></row></sheetData></worksheet>'),
    });
    const x = await extractText(Buffer.from(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx");
    expect(x.text).toContain("Control | Status");
    expect(x.text).toContain("42");
    const pdf = await new Promise<Buffer>((resolve) => {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.text("Data retention schedule approved by the board");
      doc.end();
    });
    const p = await extractText(pdf, "application/pdf", "a.pdf");
    expect(p.text).toContain("retention schedule");
  });
  it("images and unknown formats give no text (no OCR)", async () => {
    const r = await extractText(Buffer.from([1, 2, 3]), "image/png", "a.png");
    expect(r.text).toBe("");
    expect(r.method).toBe("image-no-ocr");
  });
});

describe("engine and external providers (mock servers)", () => {
  it("extractJson handles prose around the object and braces in strings", () => {
    expect(extractJson('Sure! {"a": "x } y", "b": {"c": 1}} thanks')).toEqual({ a: "x } y", b: { c: 1 } });
    expect(() => extractJson("no json")).toThrow();
  });

  let server: http.Server;
  let port = 0;
  const calls: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  let replies: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        calls.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(data) });
        const text = replies.shift() ?? "{}";
        res.setHeader("content-type", "application/json");
        if (req.url?.endsWith("/v1/messages")) res.end(JSON.stringify({ model: "mock-model", content: [{ type: "text", text }], usage: { input_tokens: 5, output_tokens: 7 } }));
        else res.end(JSON.stringify({ model: "mock-model", choices: [{ message: { content: text } }], usage: { prompt_tokens: 5, completion_tokens: 7 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const good = JSON.stringify({ verdict: "supports", quality: "adequate", confidence: 0.9, rationale: "Policy clearly covers the control.", citations: [{ quote: "Approved by the Board of Directors and signed by the Chief Executive Officer." }] });

  it("anthropic wire format, masking, and one repair retry", async () => {
    calls.length = 0;
    replies = ["not json at all", good];
    const p = new AnthropicProvider("sk-test", "mock-model", `http://127.0.0.1:${port}`);
    const input = ev({ text: GOOD_POLICY_TEXT + "\nContact dpo@example.com or 98765 43210." });
    const r = await runTask(evidenceReviewTask, input, { provider: p, label: "anthropic", model: "mock-model", note: null });
    expect(r.output.verdict).toBe("supports");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers["x-api-key"]).toBe("sk-test");
    expect(calls[0]!.headers["anthropic-version"]).toBe("2023-06-01");
    const prompt = calls[0]!.body.messages[0].content as string;
    expect(prompt).not.toContain("example.com");
    expect(prompt).not.toContain("98765");
    expect(prompt).toContain("[EMAIL]");
    expect(calls[1]!.body.messages[0].content).toContain("previous reply was invalid");
  });
  it("openai-compatible wire format", async () => {
    calls.length = 0;
    replies = [good];
    const p = new OpenAiCompatibleProvider("k", "mock-model", `http://127.0.0.1:${port}`);
    const r = await runTask(evidenceReviewTask, ev(), { provider: p, label: "openai_compatible", model: "mock-model", note: null });
    expect(r.output.confidence).toBe(0.9);
    expect(calls[0]!.url).toBe("/chat/completions");
    expect(calls[0]!.headers.authorization).toBe("Bearer k");
  });
  it("two invalid replies fail loudly (never guessed)", async () => {
    replies = ["nope", '{"verdict":"maybe"}'];
    const p = new AnthropicProvider("k", "m", `http://127.0.0.1:${port}`);
    await expect(runTask(evidenceReviewTask, ev(), { provider: p, label: "anthropic", model: "m", note: null })).rejects.toThrow(/invalid output twice/);
  });
  it("a model's invented quote is caught after the call", async () => {
    replies = [JSON.stringify({ verdict: "supports", quality: "strong", confidence: 0.99, rationale: "Great.", citations: [{ quote: "Invented sentence not in document at all." }] })];
    const p = new OpenAiCompatibleProvider("k", "m", `http://127.0.0.1:${port}`);
    const i = ev();
    const r = await runTask(evidenceReviewTask, i, { provider: p, label: "x", model: "m", note: null });
    const d = evidenceReviewDraft(i, r.output);
    expect(d.confidence).toBeLessThanOrEqual(0.6);
    expect(route({ ...base, kind: "evidence_review", proposed: d.proposed, confidence: d.confidence, tier: d.tier, needsHuman: d.needsHuman }).mode).toBe("queue");
  });
});

describe("provider choice never leaks by accident", () => {
  const env = (o: Record<string, string>) => readAiConfig(o as NodeJS.ProcessEnv);
  it("defaults to offline", () => {
    expect(chooseProvider(true, env({})).provider).toBeNull();
  });
  it("needs the deployment switch, a key, a model AND the engagement switch", () => {
    const cfg = { AI_PROVIDER: "anthropic", AI_API_KEY: "k", AI_MODEL: "m" };
    expect(chooseProvider(true, env(cfg)).provider).toBeNull(); // AI_EXTERNAL_ENABLED missing
    expect(chooseProvider(true, env({ ...cfg, AI_EXTERNAL_ENABLED: "true" })).provider?.name).toBe("anthropic");
    expect(chooseProvider(false, env({ ...cfg, AI_EXTERNAL_ENABLED: "true" })).provider).toBeNull(); // engagement switch off
    expect(chooseProvider(true, env({ AI_PROVIDER: "anthropic", AI_EXTERNAL_ENABLED: "true", AI_MODEL: "m" })).note).toMatch(/API_KEY/);
    expect(chooseProvider(true, env({ AI_PROVIDER: "openai_compatible", AI_EXTERNAL_ENABLED: "true", AI_API_KEY: "k", AI_MODEL: "m" })).note).toMatch(/BASE_URL/);
  });
});
