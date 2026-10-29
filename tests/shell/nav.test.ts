// The navigation is one definition for both portals: no page twice, no page lost, and the right area lights up.
import { describe, expect, it } from "vitest";
import { CLIENT_NAV, PRIMUS_NAV, locate, type NavGroup } from "@/components/shell/nav-config";

const hrefs = (g: NavGroup[]) => g.flatMap((x) => x.hubs.flatMap((h) => h.tabs.map((t) => t.href)));

// Every page that had its own sidebar link before the simplification must still be one click away.
const CLIENT_BEFORE = ["/portal", "/portal/tasks", "/notifications", "/portal/profile", "/portal/business-units", "/portal/processing", "/portal/journey", "/portal/data-connections", "/portal/discovery", "/portal/questions", "/portal/regulations", "/portal/assessment", "/portal/evidence", "/portal/clarifications", "/portal/findings", "/portal/remediation", "/portal/risks", "/portal/reports", "/portal/rights", "/portal/resources", "/portal/dpo-mate"];
const PRIMUS_BEFORE = ["/dashboard", "/tasks", "/notifications", "/organisations", "/engagements", "/stakeholders", "/discovery", "/question-bank", "/assessments", "/data-connections", "/evidence-review", "/findings", "/risks", "/remediation", "/clarifications", "/consultations", "/audit", "/resources", "/regulations", "/methodology", "/connectors", "/demo"];

describe("navigation", () => {
  it("lists no page twice, in either portal", () => {
    for (const g of [CLIENT_NAV, PRIMUS_NAV]) expect(new Set(hrefs(g)).size).toBe(hrefs(g).length);
  });

  it("keeps every page that was reachable before", () => {
    expect(hrefs(CLIENT_NAV).sort()).toEqual([...CLIENT_BEFORE].sort());
    expect(hrefs(PRIMUS_NAV).sort()).toEqual([...PRIMUS_BEFORE].sort());
  });

  it("shows fewer sidebar entries than pages", () => {
    expect(CLIENT_NAV.flatMap((g) => g.hubs).length).toBeLessThanOrEqual(15);
    expect(PRIMUS_NAV.flatMap((g) => g.hubs).length).toBeLessThanOrEqual(15);
  });

  it("lights the right area and tab, with the longest link winning", () => {
    expect(locate(CLIENT_NAV, "/portal")!.hub.key).toBe("home");
    expect(locate(CLIENT_NAV, "/portal/tasks")!.hub.key).toBe("todo");
    expect(locate(CLIENT_NAV, "/portal/journey")!.hub.key).toBe("docs");
    expect(locate(CLIENT_NAV, "/portal/findings/abc")!.tab.href).toBe("/portal/findings");
    expect(locate(CLIENT_NAV, "/portal/risks")!.hub.label).toBe("Findings & risks");
    expect(locate(PRIMUS_NAV, "/question-bank")!.hub.key).toBe("discovery");
    expect(locate(PRIMUS_NAV, "/organisations/o1/engagements/e1/assessments/a1")!.tab.href).toBe("/engagements");
    expect(locate(PRIMUS_NAV, "/organisations")!.tab.href).toBe("/organisations");
    expect(locate(PRIMUS_NAV, "/nowhere")).toBeNull();
  });

  it("gives the client's upload place a clear name in both portals", () => {
    expect(CLIENT_NAV.flatMap((g) => g.hubs).some((h) => h.label === "Documents & connections")).toBe(true);
    expect(PRIMUS_NAV.flatMap((g) => g.hubs).some((h) => h.label === "Documents & connections")).toBe(true);
  });
});
