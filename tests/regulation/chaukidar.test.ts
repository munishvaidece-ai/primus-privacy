import { describe, expect, it } from "vitest";
import { CH_NODES, CH_START, checkGraph, citeKnown } from "@/lib/regulation/chaukidar";

describe("Chaukidar conversation graph", () => {
  it("has no dead ends, orphans or unknown citations", () => {
    expect(checkGraph()).toEqual([]);
  });

  it("starts at a question with the six front-door choices", () => {
    const start = CH_NODES[CH_START]!;
    expect(start.kind).toBe("ask");
    expect(start.kind === "ask" ? start.options.length : 0).toBe(6);
  });

  it("every option that records a fact uses a known fact and value", () => {
    const keys = new Set(["consent", "children", "processors", "abroad", "large"]);
    const vals = new Set(["yes", "no", "unsure"]);
    for (const n of Object.values(CH_NODES)) {
      if (n.kind !== "ask") continue;
      for (const o of n.options) for (const [k, v] of Object.entries(o.set ?? {})) {
        expect(keys.has(k)).toBe(true);
        expect(vals.has(v as string)).toBe(true);
      }
    }
  });

  it("answers every question about the six facts with a plain-language reply", () => {
    for (const id of ["a_consent", "a_children", "a_proc", "a_abroad", "a_large"]) {
      const n = CH_NODES[id]!;
      expect(n.kind).toBe("ask");
      if (n.kind === "ask") for (const o of n.options) expect(o.reply && o.reply.length > 20).toBe(true);
    }
  });

  it("recognises real sections and Rules and rejects invented ones", () => {
    for (const c of ["s.5", "s.8(6)", "s.12", "s.14", "Rule 7", "Rule 23"]) expect(citeKnown(c)).toBe(true);
    for (const c of ["s.99", "Rule 99", "section 5", "s.8(x)"]) expect(citeKnown(c)).toBe(false);
  });

  it("the breach path records how long ago the organisation became aware", () => {
    const n = CH_NODES["b_clock"]!;
    expect(n.kind === "ask" && n.options.every((o) => typeof o.aware === "number")).toBe(true);
  });
});
