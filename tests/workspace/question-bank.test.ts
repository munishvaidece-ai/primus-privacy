// The question bank: every sector has its own questions, clients see the set for
// their own sector, Primus sees the whole bank, and old sector values still work.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { SELECTABLE_SECTORS } from "@/lib/regulation";
import { DPDP_DUTIES } from "@/lib/workspace/question-bank-extra";
import { BANK_KEYS, BANK_SECTION_KEYS, BANK_TOTAL, COMMON_QUESTIONS, bankKeyFromSection, bankSection, questionsFor } from "@/lib/workspace/question-bank";
import { LEGACY_SECTOR_VALUES, SECTIONS, sanitizeAnswers, sectionComplete } from "@/lib/workspace/discovery-sections";
import { approveDiscovery, getSectorQuestions, saveDiscoverySection, submitDiscovery } from "@/lib/workspace/discovery";
import { setEngagementSectors } from "@/lib/domain/sectors";
import { WorkspaceInputError } from "@/lib/workspace/common";
import { buildWorkspaceFixture, type WsFixture } from "./helpers";

describe("question bank (data)", () => {
  it("has a common set and a set for every sector, with no sector missing", () => {
    expect(COMMON_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    for (const s of SELECTABLE_SECTORS) expect(questionsFor(s.key).length, s.key).toBeGreaterThanOrEqual(5);
    expect(BANK_KEYS).toHaveLength(SELECTABLE_SECTORS.length + 1);
    expect(BANK_TOTAL).toBeGreaterThan(100);
  });

  it("question keys are unique inside a set, and every saved key fits the database rule", () => {
    for (const k of BANK_KEYS) {
      const keys = questionsFor(k).map((q) => q.key);
      expect(new Set(keys).size, k).toBe(keys.length);
    }
    for (const key of BANK_SECTION_KEYS) expect(key).toMatch(/^[a-z_]{3,40}$/);
    expect(new Set(BANK_SECTION_KEYS).size).toBe(BANK_SECTION_KEYS.length);
    for (const s of SECTIONS) expect(BANK_SECTION_KEYS).not.toContain(s.key);
  });

  it("no question is asked twice in the same set, and the sector sets really differ", () => {
    for (const k of BANK_KEYS) {
      const labels = questionsFor(k).map((q) => q.label.toLowerCase());
      expect(new Set(labels).size, k).toBe(labels.length);
    }
    const banking = questionsFor("banking").map((q) => q.label);
    const healthcare = questionsFor("healthcare").map((q) => q.label);
    const insurance = questionsFor("insurance").map((q) => q.label);
    expect(banking.filter((l) => healthcare.includes(l) || insurance.includes(l))).toEqual([]);
  });

  it("questions speak to the client in the second person and never to 'the client'", () => {
    for (const k of BANK_KEYS) for (const q of questionsFor(k)) {
      expect(q.label, `${k} ${q.key}`).not.toMatch(/\bthe client\b/i);
      expect(q.label, `${k} ${q.key}`).toMatch(/\b(you|your)\b/i);
    }
  });

  it("education has questions for schools, colleges, coaching centres and edtech, and others may answer 'not applicable'", () => {
    const edu = questionsFor("education");
    const topics = new Set(edu.map((x) => x.topic));
    for (const t of ["School", "College or university", "Coaching centre", "Edtech platform"]) expect(topics.has(t), t).toBe(true);
    const typed = edu.filter((x) => ["School", "College or university", "Coaching centre", "Edtech platform"].includes(x.topic));
    for (const x of typed) {
      expect(x.options!.map((o) => o.value)).toContain("na");
      expect(x.label).toMatch(/^If you run an? /);
    }
    const sec = bankSection("education");
    const answers = Object.fromEntries(sec.fields.map((f) => [f.key, "na"]));
    expect(sectionComplete(sec, sanitizeAnswers(sec, answers))).toBe(false); // common-to-all questions have no 'na'
    const ok = Object.fromEntries(sec.fields.map((f) => [f.key, f.options!.some((o) => o.value === "na") ? "na" : "yes"]));
    expect(sectionComplete(sec, sanitizeAnswers(sec, ok))).toBe(true);
  });

  it("the common set covers every duty in the Act and Rules that we list, each with a DPDP reference", () => {
    const refs = new Set(questionsFor("common").flatMap((x) => (x.ref ?? "").split(";").map((r) => r.trim()).filter(Boolean)));
    for (const d of DPDP_DUTIES) expect(refs.has(d.ref), `${d.ref} ${d.duty}`).toBe(true);
    // Every common question says which part of the law it checks.
    for (const x of questionsFor("common")) expect(x.ref, x.key).toBeTruthy();
    expect(questionsFor("common").length).toBeGreaterThanOrEqual(35);
  });

  it("every sector has at least twelve questions, and extra questions never repeat a base question", () => {
    for (const s of SELECTABLE_SECTORS) expect(questionsFor(s.key).length, s.key).toBeGreaterThanOrEqual(12);
    expect(BANK_TOTAL).toBeGreaterThan(250);
    const all = BANK_KEYS.flatMap((k) => questionsFor(k).map((x) => x.label.toLowerCase()));
    expect(new Set(all).size, "a question appears in two sets").toBe(all.length);
  });

  it("section keys round-trip and unknown keys are not accepted", () => {
    expect(bankKeyFromSection("sq_banking")).toBe("banking");
    expect(bankKeyFromSection("sq_common")).toBe("common");
    expect(bankKeyFromSection("sq_nonsense")).toBeNull();
    expect(bankKeyFromSection("organisation_profile")).toBeNull();
  });

  it("answers are cleaned against the set, and a set completes only when everything is answered", () => {
    const sec = bankSection("pharma");
    expect(sectionComplete(sec, sanitizeAnswers(sec, {}))).toBe(false);
    const full = Object.fromEntries(sec.fields.map((f) => [f.key, "yes"]));
    expect(sectionComplete(sec, sanitizeAnswers(sec, { ...full, evil: "x" }))).toBe(true);
    expect(Object.keys(sanitizeAnswers(sec, { ...full, evil: "x" }))).not.toContain("evil");
    expect(sanitizeAnswers(sec, { q1: "banana" }).q1).toBeNull();
  });

  it("the step-1 sector list is the sector catalogue, with each sector once, and old values map into it", () => {
    const f = SECTIONS[0]!.fields.find((x) => x.key === "sector")!;
    const values = f.options!.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    for (const s of SELECTABLE_SECTORS) expect(values).toContain(s.key);
    expect(values).toContain("other");
    for (const to of Object.values(LEGACY_SECTOR_VALUES)) expect(values).toContain(to);
    expect(sanitizeAnswers(SECTIONS[0]!, { sector: "financial_services" }).sector).toBe("banking");
    expect(sanitizeAnswers(SECTIONS[0]!, { sector: "pharma" }).sector).toBe("pharma");
  });
});

describe("question sets for a client", () => {
  let f: WsFixture;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("QSet");
  });
  const eng = () => f.engagementId;
  const state = (u: string) => withRequestDb(u, (db) => getSectorQuestions(db, u, eng()));

  it("start with only the common set until a sector is known", async () => {
    const s = await state(f.clientAdminId);
    expect(s.declared).toBeNull();
    expect(s.sets.map((x) => x.key)).toEqual(["common"]);
  });

  it("follow the sector the client names in step 1, and change when they change it", async () => {
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "organisation_profile", answers: { sector: "insurance" }, complete: false }));
    let s = await state(f.clientAdminId);
    expect(s.declared).toBe("insurance");
    expect(s.sets.map((x) => x.key)).toEqual(["common", "insurance"]);
    expect(s.sets[1]!.section.fields.map((q) => q.label)).toEqual(questionsFor("insurance").map((q) => q.label));
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "organisation_profile", answers: { sector: "banking" }, complete: false }));
    s = await state(f.clientAdminId);
    expect(s.sets.map((x) => x.key)).toEqual(["common", "banking"]);
  });

  it("add the sectors Primus sets, once each, even when the client named the same one", async () => {
    await withRequestDb(f.emId, (db) => setEngagementSectors(db, f.emId, { engagementId: eng(), organisationId: f.organisationId, sectors: ["banking", "healthcare"] }));
    const s = await state(f.clientAdminId);
    expect(s.sets.map((x) => x.key)).toEqual(["common", "banking", "healthcare"]);
    expect(s.setByPrimus).toEqual(["banking", "healthcare"]);
    // Primus sees the same sets for the same engagement.
    expect((await state(f.emId)).sets.map((x) => x.key)).toEqual(["common", "banking", "healthcare"]);
  });

  it("save answers per set; they come back, and a completed set is marked", async () => {
    const sec = bankSection("banking");
    const answers = Object.fromEntries(sec.fields.map((q) => [q.key, "yes"]));
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "sq_banking", answers: { q1: "partly" }, complete: false }));
    let s = await state(f.clientAdminId);
    const b = s.sets.find((x) => x.key === "banking")!;
    expect(b.answers.q1).toBe("partly");
    expect(b.answered).toBe(1);
    expect(b.complete).toBe(false);
    await expect(withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "sq_banking", answers: { q1: "yes" }, complete: true }))).rejects.toThrow(WorkspaceInputError);
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "sq_banking", answers, complete: true }));
    s = await state(f.clientAdminId);
    expect(s.sets.find((x) => x.key === "banking")!.complete).toBe(true);
  });

  it("do not count towards the thirteen discovery steps", async () => {
    const { getDiscovery } = await import("@/lib/workspace/discovery");
    const d = await withRequestDb(f.clientAdminId, (db) => getDiscovery(db, f.clientAdminId, eng()));
    expect(d.total).toBe(13);
    expect(Object.keys(d.answers).every((k) => !k.startsWith("sq_"))).toBe(true);
  });

  it("an unknown set is refused, and another organisation cannot read or write these answers", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "sq_nonsense", answers: {}, complete: false }))).rejects.toThrow(WorkspaceInputError);
    await expect(state(f.otherClientId)).rejects.toThrow();
    await expect(withRequestDb(f.otherClientId, (db) => saveDiscoverySection(db, f.otherClientId, { engagementId: eng(), sectionKey: "sq_banking", answers: { q1: "no" }, complete: false }))).rejects.toThrow();
  });

  it("stay open after the questionnaire is submitted and approved, while the thirteen steps lock", async () => {
    for (const sec of SECTIONS) {
      const a: Record<string, unknown> = {};
      for (const fl of sec.fields) a[fl.key] = fl.type === "yesno" ? true : fl.type === "choice" ? fl.options![0]!.value : fl.type === "multi" ? [fl.options![0]!.value] : "Sample answer";
      await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: sec.key, answers: a, complete: true }));
    }
    await withRequestDb(f.clientAdminId, (db) => submitDiscovery(db, f.clientAdminId, eng()));
    // Submitted: a discovery step is locked, a question set is not.
    await expect(withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "business_units", answers: { units: "changed" }, complete: false }))).rejects.toThrow();
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "sq_healthcare", answers: { q1: "yes" }, complete: false }));
    // Approved: same.
    await withRequestDb(f.emId, (db) => approveDiscovery(db, f.emId, eng()));
    await expect(withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "business_units", answers: { units: "changed" }, complete: false }))).rejects.toThrow(WorkspaceInputError);
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "sq_healthcare", answers: { q1: "partly" }, complete: false }));
    expect((await state(f.clientAdminId)).sets.find((x) => x.key === "healthcare")!.answers.q1).toBe("partly");
    // A reader who may not contribute still cannot write them.
    await expect(withRequestDb(f.cxoId, (db) => saveDiscoverySection(db, f.cxoId, { engagementId: eng(), sectionKey: "sq_healthcare", answers: { q1: "no" }, complete: false }))).rejects.toThrow();
  });
});
