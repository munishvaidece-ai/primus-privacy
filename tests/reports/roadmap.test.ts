import { describe, expect, it } from "vitest";
import { buildRoadmap } from "@/lib/reports/engagement-report-pdf";

const act = (id: string, priority: string, dueDate: string | null, status = "open") =>
  ({ id, title: `Action ${id}`, status, priority, ownerEmail: null, dueDate, sourceFindingTitle: null, createdAt: new Date("2026-10-01") }) as never;

describe("buildRoadmap", () => {
  const today = new Date("2026-10-27T10:00:00Z");

  it("groups open actions by how soon they fall due and counts closed ones separately", () => {
    const r = buildRoadmap(
      [
        act("a", "low", "2026-10-20"), // overdue
        act("b", "high", "2026-11-26"), // 30 days
        act("c", "medium", "2026-11-27"), // 31 days
        act("d", "critical", "2026-12-26"), // 60 days
        act("e", "low", "2027-01-25"), // 90 days
        act("f", "low", "2027-01-26"), // 91 days
        act("g", "low", null), // no date
        act("h", "high", "2026-11-01", "validated"),
        act("i", "high", "2026-11-01", "closed"),
      ],
      today,
    );
    const by = Object.fromEntries(r.groups.map((g) => [g.key, g.rows.map((x) => x.id)]));
    expect(by).toEqual({ overdue: ["a"], d30: ["b"], d60: ["d", "c"], d90: ["e"], later: ["f"], undated: ["g"] });
    expect(r.closed).toBe(2);
  });

  it("puts the most serious first inside a period, then the earliest due date", () => {
    const r = buildRoadmap([act("x", "low", "2026-11-02"), act("y", "critical", "2026-11-20"), act("z", "critical", "2026-11-05")], today);
    expect(r.groups[1]!.rows.map((x) => x.id)).toEqual(["z", "y", "x"]);
  });

  it("treats an action due today as due in the next 30 days, not overdue", () => {
    const r = buildRoadmap([act("t", "high", "2026-10-27")], today);
    expect(r.groups[0]!.rows).toHaveLength(0);
    expect(r.groups[1]!.rows).toHaveLength(1);
  });
});
