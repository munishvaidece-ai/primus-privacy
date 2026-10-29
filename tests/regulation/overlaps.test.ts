// The overlap register: where DPDP and a sector's rules cover the same ground. Every entry must point at real things,
// every sector must have at least one, and every entry must stay flagged for legal review until a lawyer says otherwise.
import { describe, expect, it } from "vitest";
import { EFFECT, OVERLAPS, SECTORS, SELECTABLE_SECTORS, allSectorControls, overlapsForControl, overlapsForSector, overlapsForSectors } from "@/lib/regulation";
import { regulationNote } from "@/lib/regulation/note";
import { applicabilityDraft, offlineApplicability, overlapFlag } from "@/lib/ai/tasks/applicability";
import { questionsFor } from "@/lib/workspace/question-bank";
import { STARTER_CONTROLS } from "@/db/seed/starter-library";

const STARTER_CONTROL_CODES_FOR_TEST = new Set(STARTER_CONTROLS.map((c) => c.code));

const profile = { activities: 3, principalCategories: ["Clients"], dataElements: [], hasProcessors: true, crossBorderHints: false, childrenHints: false };
const input = (code: string, sectors: Parameters<typeof overlapsForControl>[1]) => ({ engagementScopeControlId: "s", control: { code, title: "A control", description: null as string | null, tier: "medium" as const }, profile: { ...profile, sectors } });

describe("overlap register", () => {
  const sectorCodes = new Set(allSectorControls().map((c) => c.code));

  it("has unique ids, a known effect, and is flagged for legal review", () => {
    expect(new Set(OVERLAPS.map((x) => x.id)).size).toBe(OVERLAPS.length);
    for (const x of OVERLAPS) {
      expect(EFFECT[x.effect], x.id).toBeTruthy();
      expect(x.legalReview, x.id).toBe(true);
      expect(x.whatToDo.length, x.id).toBeGreaterThan(20);
    }
  });

  it("every sector, and the cross-sector set, has at least one overlap", () => {
    for (const s of SELECTABLE_SECTORS) expect(overlapsForSector(s.key).length, s.key).toBeGreaterThan(0);
    expect(overlapsForSector("all").length).toBeGreaterThan(0);
  });

  it("each entry names real controls and, where given, an instrument in its own sector", () => {
    for (const x of OVERLAPS) {
      expect(x.controls.length, x.id).toBeGreaterThan(0);
      for (const c of x.controls) expect(STARTER_CONTROL_CODES_FOR_TEST.has(c) || sectorCodes.has(c), `${x.id} control ${c}`).toBe(true);
      if (x.instrument) {
        const sector = SECTORS.find((s) => s.key === x.sector)!;
        expect(sector.instruments.some((i) => i.id === x.instrument), `${x.id} instrument ${x.instrument}`).toBe(true);
      }
    }
  });

  it("says plainly that DPDP is cumulative and prevails in a conflict, never that sector law replaces it", () => {
    const text = Object.values(EFFECT).map((e) => e.governs).join(" ");
    expect(text).not.toMatch(/replaces the (DPDP )?Act|instead of the (DPDP )?Act/i);
    expect(EFFECT.both_apply.governs).toMatch(/stricter/);
    expect(EFFECT.sector_retention.governs).toMatch(/s\.8\(7\)/);
    expect(EFFECT.sector_transfer.governs).toMatch(/s\.16\(2\)/);
  });

  it("finds overlaps by control and by the sectors in play", () => {
    expect(overlapsForControl("RET-01", ["banking"]).map((x) => x.id)).toContain("bnk-kyc");
    expect(overlapsForControl("RET-01", ["banking"]).map((x) => x.id)).not.toContain("hlt-retention");
    expect(overlapsForControl("RET-01", ["banking"]).map((x) => x.id)).toContain("all-legal-retention");
    expect(overlapsForSectors(["telecom"]).every((x) => x.sector === "all" || x.sector === "telecom")).toBe(true);
    expect(regulationNote("RET-01")!.overlaps.length).toBeGreaterThan(5);
    expect(regulationNote("BNK-04")!.overlaps.map((x) => x.id)).toContain("bnk-payment");
  });

  it("flags the overlap in the applicability reason, only for the sectors chosen", () => {
    const i = input("RET-01", ["banking"]);
    const out = offlineApplicability(i);
    expect(overlapFlag(i, out)).toMatch(/Overlap with sector law/);
    expect(applicabilityDraft(i, out).rationale).toMatch(/legal review/);
    expect(applicabilityDraft(i, out).proposed.rationale).toMatch(/Overlap with sector law/);
    const other = input("BNK-04", ["broking"]);
    expect(overlapFlag(other, offlineApplicability(other))).toBe("");
    const none = input("PRO-02", ["banking"]);
    expect(overlapFlag(none, offlineApplicability(none))).toBe("");
  });

  it("every sector set ends with an overlap question, and the common set asks about legal retention", () => {
    for (const s of SELECTABLE_SECTORS) {
      const qs = questionsFor(s.key);
      expect(qs[qs.length - 1]!.topic, s.key).toBe("Overlap with the DPDP Act");
    }
    expect(questionsFor("common").some((x) => x.topic === "Overlap with other laws")).toBe(true);
  });
});
