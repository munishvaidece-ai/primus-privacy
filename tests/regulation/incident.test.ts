import { describe, expect, it } from "vitest";
import { incidentDuties } from "@/lib/regulation";

describe("who may have to be told after an incident", () => {
  it("always lists the DPDP duty first and the cross-sector CERT-In duty", () => {
    const d = incidentDuties([]);
    expect(d[0]!.body).toMatch(/Data Protection Board/);
    expect(d[0]!.inForce).toBe("2027-05-13");
    expect(d.some((x) => x.control === "CYB-01")).toBe(true);
  });
  it("adds SEBI for a stock broker, RBI for a bank and not the other way round", () => {
    const broker = incidentDuties(["broking"]).map((x) => x.control);
    expect(broker).toContain("BRK-02");
    expect(broker).not.toContain("BNK-06");
    expect(incidentDuties(["banking"]).map((x) => x.control)).toContain("BNK-06");
  });
  it("does not list the same duty twice", () => {
    const codes = incidentDuties(["broking", "broking"]).map((x) => x.control).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
