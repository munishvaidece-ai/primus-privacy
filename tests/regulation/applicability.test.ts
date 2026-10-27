import { describe, expect, it } from "vitest";
import { applicableObligations, rulesThatBind, summarise, type OrgFacts } from "@/lib/regulation/applicability";

const base: OrgFacts = { sectors: [] };
const by = (list: ReturnType<typeof applicableObligations>, id: string) => list.find((o) => o.id === id)!;

describe("DPDP applicability engine", () => {
  it("applies the duties every Data Fiduciary has, whatever the answers", () => {
    const l = applicableObligations(base);
    for (const id of ["ground", "accuracy", "security", "breach"]) expect(by(l, id).status).toBe("applies");
  });
  it("never turns a missing answer into a no", () => {
    expect(by(applicableObligations(base), "consent").status).toBe("may_apply");
    expect(by(applicableObligations({ ...base, reliesOnConsent: false }), "consent").status).toBe("not_applicable");
    expect(by(applicableObligations({ ...base, reliesOnConsent: true }), "consent").status).toBe("applies");
  });
  it("brings in children's duties only when children's data is processed", () => {
    expect(by(applicableObligations({ ...base, children: true }), "children").status).toBe("applies");
    expect(by(applicableObligations({ ...base, children: false }), "children").status).toBe("not_applicable");
    expect(by(applicableObligations(base), "children").status).toBe("may_apply");
  });
  it("treats Significant Data Fiduciary duties as 'may apply' until a notification is confirmed", () => {
    const l = applicableObligations({ ...base, largeOrSensitive: true, notifiedSdf: "unsure" });
    expect(l.filter((o) => o.group === "sdf").every((o) => o.status !== "not_applicable")).toBe(true);
  });
  it("gives each obligation a date from the Rules and a penalty ceiling from the Schedule", () => {
    const l = applicableObligations(base);
    expect(by(l, "security").penalty.text).toBe("up to ₹250 crore");
    expect(by(l, "breach").penalty.text).toBe("up to ₹200 crore");
    for (const o of l) expect(o.inForce).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("summarises counts, the highest ceiling and the days to the main duties", () => {
    const l = applicableObligations({ ...base, reliesOnConsent: true, children: true });
    const s = summarise(l, new Date("2027-05-03T00:00:00Z"));
    expect(s.applies).toBe(l.filter((o) => o.status === "applies").length);
    expect(s.highestCeilingCrore).toBe(250);
    expect(s.daysToFirstDuty).toBe(10);
    expect(rulesThatBind(l).length).toBeGreaterThan(5);
  });
});
