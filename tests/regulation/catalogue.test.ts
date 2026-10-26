// The regulation catalogue is plain data, so these checks guard its consistency:
// unique codes, valid cross-links, a mapping for every DPDP control, and the
// migration's sector list matching the code.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTROL_MAP,
  DPDP_RULES,
  PENALTY_SCHEDULE,
  SECTORS,
  SELECTABLE_SECTORS,
  allSectorControls,
  controlsForSectors,
  sectorOfControl,
} from "@/lib/regulation";
import { regulationNote } from "@/lib/regulation/note";
import { STARTER_CONTROLS, SECTOR_STARTER_CONTROLS, SECTOR_REFERENCES, RULE_REFERENCES } from "@/db/seed/starter-library";
import { offlineApplicability, applicabilityDraft } from "@/lib/ai/tasks/applicability";

const profile = { activities: 3, principalCategories: ["Clients"], dataElements: [], hasProcessors: true, crossBorderHints: false, childrenHints: false };
const ctl = (code: string, title = "A control") => ({ code, title, description: null as string | null, tier: "medium" as const });

describe("regulation catalogue", () => {
  const sectorCodes = allSectorControls().map((c) => c.code);
  const dpdpCodes = STARTER_CONTROLS.map((c) => c.code);

  it("covers every sector the product promises, including MSME and Government", () => {
    const keys = SELECTABLE_SECTORS.map((s) => s.key);
    for (const k of ["broking", "banking", "insurance", "healthcare", "telecom", "ecommerce", "ott", "aviation", "ai", "education", "msme", "government"]) expect(keys).toContain(k);
  });

  it("control codes are unique and do not clash with the DPDP controls", () => {
    expect(new Set(sectorCodes).size).toBe(sectorCodes.length);
    for (const c of sectorCodes) expect(dpdpCodes).not.toContain(c);
  });

  it("each control code starts with its own sector's prefix", () => {
    for (const s of SECTORS) for (const c of s.controls) expect(c.code.startsWith(`${s.prefix}-`), c.code).toBe(true);
    const prefixes = SECTORS.map((s) => s.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("each control points at an instrument in its own sector, and related codes exist", () => {
    const all = new Set([...dpdpCodes, ...sectorCodes]);
    for (const s of SECTORS) {
      const ids = new Set(s.instruments.map((i) => i.id));
      expect(ids.size).toBe(s.instruments.length);
      for (const c of s.controls) {
        expect(ids.has(c.instrument), `${c.code} instrument`).toBe(true);
        for (const r of c.related ?? []) expect(all.has(r), `${c.code} related ${r}`).toBe(true);
      }
    }
  });

  it("every sector has a DPDP interplay note, typical evidence, and flags each instrument as checked or not", () => {
    for (const s of SECTORS) {
      expect(s.dpdpInterplay.length, s.key).toBeGreaterThan(0);
      expect(s.typicalEvidence.length, s.key).toBeGreaterThan(0);
      for (const i of s.instruments) expect(typeof i.confirmed).toBe("boolean");
    }
  });

  it("stock broking is the deepest sector", () => {
    const broking = SECTORS.find((s) => s.key === "broking")!;
    for (const s of SELECTABLE_SECTORS.filter((x) => x.key !== "broking")) expect(broking.controls.length, s.key).toBeGreaterThan(s.controls.length);
  });

  it("every DPDP starter control maps to at least one section and a penalty row", () => {
    const keys = new Set(PENALTY_SCHEDULE.map((p) => p.key));
    const ruleNumbers = new Set(DPDP_RULES.map((r) => r.number));
    for (const code of dpdpCodes) {
      const m = CONTROL_MAP[code];
      expect(m, code).toBeTruthy();
      expect(m!.sections.length, code).toBeGreaterThan(0);
      expect(keys.has(m!.penalty), code).toBe(true);
      for (const r of m!.rules) expect(ruleNumbers.has(r), `${code} rule ${r}`).toBe(true);
    }
  });

  it("penalty ceilings match the Schedule to the Act", () => {
    const by = Object.fromEntries(PENALTY_SCHEDULE.map((p) => [p.key, p.maxCrore]));
    expect(by).toMatchObject({ security: 250, breach: 200, children: 200, sdf: 150, other: 50 });
  });

  it("the database check on sector keys matches the code", () => {
    const sql = readFileSync("drizzle/migrations/0050_engagement_sectors.sql", "utf8");
    const listed = (/sector_key IN \(([^)]*)\)/.exec(sql)?.[1] ?? "").split(",").map((x) => x.trim().replace(/'/g, "")).sort();
    expect(listed).toEqual(SELECTABLE_SECTORS.map((s) => s.key).sort());
  });

  it("the starter library carries the sector controls, rule references and instrument references", () => {
    expect(SECTOR_STARTER_CONTROLS.length).toBe(sectorCodes.length);
    expect(RULE_REFERENCES.length).toBe(DPDP_RULES.length);
    expect(SECTOR_REFERENCES.length).toBeGreaterThan(20);
    const cites = SECTOR_REFERENCES.map((r) => r.citation);
    expect(new Set(cites).size).toBe(cites.length);
  });

  it("sectorOfControl tells DPDP controls from sector controls", () => {
    expect(sectorOfControl("SEC-01")).toBeNull();
    expect(sectorOfControl("BRK-02")).toBe("broking");
    expect(sectorOfControl("CYB-01")).toBe("all");
    expect(sectorOfControl("GVT-01")).toBe("government");
  });

  it("controlsForSectors always includes the cross-sector controls", () => {
    const codes = controlsForSectors(["broking"]).map((c) => c.code);
    expect(codes).toContain("BRK-01");
    expect(codes).toContain("CYB-01");
    expect(codes).not.toContain("BNK-01");
  });

  it("regulationNote gives sections and a labelled ceiling for DPDP controls, and the instrument for sector controls", () => {
    const n = regulationNote("SEC-01")!;
    expect(n.lines[0]).toContain("s.8(5)");
    expect(n.ceiling).toContain("₹250 crore");
    expect(n.ceiling).toMatch(/not a prediction/);
    const b = regulationNote("BRK-02")!;
    expect(b.lines[0]).toContain("SEBI");
    expect(b.ceiling).toBeNull();
    expect(regulationNote("NOPE-1")).toBeNull();
  });
});

describe("sector-aware applicability (rules engine)", () => {
  it("applies a sector control only when that sector was chosen", () => {
    const on = offlineApplicability({ engagementScopeControlId: "s", control: ctl("BRK-02"), profile: { ...profile, sectors: ["broking"] } });
    expect(on.decision).toBe("applicable");
    expect(on.basis).toBe("sector");
    const off = offlineApplicability({ engagementScopeControlId: "s", control: ctl("BNK-01"), profile: { ...profile, sectors: ["broking"] } });
    expect(off.decision).toBe("not_applicable");
    expect(off.needsHuman).toBeUndefined();
    expect(off.rationale).toMatch(/Stock broking/);
  });

  it("asks a person when no sector has been chosen at all", () => {
    const r = offlineApplicability({ engagementScopeControlId: "s", control: ctl("INS-01"), profile });
    expect(r.decision).toBe("not_applicable");
    expect(r.needsHuman).toMatch(/no sector/);
  });

  it("cross-sector controls follow the normal DPDP rules, whatever the sector", () => {
    const r = offlineApplicability({ engagementScopeControlId: "s", control: ctl("CYB-01", "Cyber incident reporting"), profile: { ...profile, sectors: ["msme"] } });
    expect(r.decision).toBe("applicable");
    expect(r.basis).toBeUndefined();
  });

  it("a sector choice is a low-risk decision, so it does not flood the review queue", () => {
    const i = { engagementScopeControlId: "s", control: { ...ctl("BNK-01"), tier: "critical" as const }, profile: { ...profile, sectors: ["broking" as const] } };
    const d = applicabilityDraft(i, offlineApplicability(i));
    expect(d.tier).toBe("low");
    expect(d.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
