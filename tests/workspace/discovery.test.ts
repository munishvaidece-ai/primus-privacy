// The 13-step discovery questionnaire: autosave, completion, submit, approval and locks.
import { beforeAll, describe, expect, it } from "vitest";
import { withRequestDb } from "@/lib/db/request-client";
import { approveDiscovery, getDiscovery, returnDiscovery, saveDiscoverySection, submitDiscovery } from "@/lib/workspace/discovery";
import { SECTIONS, previewObligations, type Section } from "@/lib/workspace/discovery-sections";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { WorkspaceInputError } from "@/lib/workspace/common";
import { buildWorkspaceFixture, pool, type WsFixture } from "./helpers";

function fill(section: Section): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  for (const f of section.fields) {
    if (f.type === "yesno") a[f.key] = true;
    else if (f.type === "choice") a[f.key] = f.options![0]!.value;
    else if (f.type === "multi") a[f.key] = [f.options![0]!.value];
    else a[f.key] = "Sample answer";
  }
  return a;
}

describe("discovery questionnaire", () => {
  let f: WsFixture;
  const eng = () => f.engagementId;
  beforeAll(async () => {
    f = await buildWorkspaceFixture("Disc");
  });

  it("has thirteen steps", () => {
    expect(SECTIONS).toHaveLength(13);
  });

  it("autosaves a partial step without marking it complete; completing needs the required answers", async () => {
    const first = SECTIONS[0]!;
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: first.key, answers: { summary: "We run a lending app." }, complete: false }));
    let s = await withRequestDb(f.clientAdminId, (db) => getDiscovery(db, f.clientAdminId, eng()));
    expect(s.completedCount).toBe(0);
    expect(s.answers[first.key]!.summary).toBe("We run a lending app.");
    await expect(withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: first.key, answers: { summary: "x" }, complete: true }))).rejects.toThrow(WorkspaceInputError);
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: first.key, answers: fill(first), complete: true }));
    s = await withRequestDb(f.clientAdminId, (db) => getDiscovery(db, f.clientAdminId, eng()));
    expect(s.completedCount).toBe(1);
  });

  it("unknown steps and unknown answer keys are refused or dropped", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: "nope", answers: {}, complete: false }))).rejects.toThrow(WorkspaceInputError);
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: SECTIONS[1]!.key, answers: { units: "Retail", evil: "<script>" }, complete: false }));
    const s = await withRequestDb(f.clientAdminId, (db) => getDiscovery(db, f.clientAdminId, eng()));
    expect(Object.keys(s.answers[SECTIONS[1]!.key]!)).not.toContain("evil");
  });

  it("cannot be submitted until every step is complete", async () => {
    await expect(withRequestDb(f.clientAdminId, (db) => submitDiscovery(db, f.clientAdminId, eng()))).rejects.toThrow(/not complete/);
  });

  it("a read-only executive cannot edit or submit", async () => {
    await expect(withRequestDb(f.cxoId, (db) => saveDiscoverySection(db, f.cxoId, { engagementId: eng(), sectionKey: SECTIONS[2]!.key, answers: { activities: "x" }, complete: false }))).rejects.toThrow();
    await expect(withRequestDb(f.cxoId, (db) => submitDiscovery(db, f.cxoId, eng()))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("another organisation cannot read or write it", async () => {
    await expect(withRequestDb(f.otherClientId, (db) => getDiscovery(db, f.otherClientId, eng()))).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(withRequestDb(f.otherClientId, (db) => saveDiscoverySection(db, f.otherClientId, { engagementId: eng(), sectionKey: SECTIONS[0]!.key, answers: {}, complete: false }))).rejects.toThrow(NotFoundOrForbiddenError);
  });

  it("submit locks the client; only a reviewer approves; approval freezes it; return reopens it", async () => {
    for (const s of SECTIONS) {
      await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: s.key, answers: s.key === "scope_confirmation" ? { ...fill(s), confirm: true } : fill(s), complete: true }));
    }
    await withRequestDb(f.clientAdminId, (db) => submitDiscovery(db, f.clientAdminId, eng()));
    await expect(withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: SECTIONS[0]!.key, answers: { summary: "changed" }, complete: false }))).rejects.toThrow();
    await expect(withRequestDb(f.clientAdminId, (db) => approveDiscovery(db, f.clientAdminId, eng()))).rejects.toThrow(NotFoundOrForbiddenError);
    await expect(withRequestDb(f.consultantId, (db) => approveDiscovery(db, f.consultantId, eng()))).rejects.toThrow(NotFoundOrForbiddenError);
    const n = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'discovery_submitted'", [f.emId]);
    expect(n.rowCount).toBe(1);
    await withRequestDb(f.emId, (db) => returnDiscovery(db, f.emId, eng()));
    await withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: SECTIONS[0]!.key, answers: fill(SECTIONS[0]!), complete: true }));
    await withRequestDb(f.clientAdminId, (db) => submitDiscovery(db, f.clientAdminId, eng()));
    await withRequestDb(f.emId, (db) => approveDiscovery(db, f.emId, eng()));
    const s = await withRequestDb(f.clientAdminId, (db) => getDiscovery(db, f.clientAdminId, eng()));
    expect(s.status).toBe("approved");
    await expect(withRequestDb(f.clientAdminId, (db) => saveDiscoverySection(db, f.clientAdminId, { engagementId: eng(), sectionKey: SECTIONS[0]!.key, answers: { summary: "late" }, complete: false }))).rejects.toThrow(WorkspaceInputError);
    const c = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'discovery_approved'", [f.clientAdminId]);
    expect(c.rowCount).toBe(1);
  });

  it("the obligation preview is worked out from the answers and is indicative only", () => {
    const empty = previewObligations({});
    expect(Array.isArray(empty)).toBe(true);
    for (const o of empty) expect(["applicable", "potential", "not_applicable"]).toContain(o.status);
  });
});
