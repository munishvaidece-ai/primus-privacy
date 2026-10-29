// The "Documents and connections" guide: which steps need a file, which connectors can be asked for, and the request message.
import { describe, expect, it } from "vitest";
import { CONNECTORS } from "@/lib/connectors/catalog";
import { PHASES } from "@/lib/live/config";
import { DOCUMENT_STEPS, OTHER_SYSTEM, PLANNED_NAMES, REQUESTABLE, WHAT_WE_NEED, connectionRequestText } from "@/lib/workspace/data-connections";

describe("documents and connections guide", () => {
  it("lists exactly the steps where the client sends something, from the journey's own definition", () => {
    expect(DOCUMENT_STEPS.map((d) => d.phase)).toEqual(PHASES.filter((p) => p.from.side === "client").map((p) => p.n));
    expect(DOCUMENT_STEPS.length).toBe(4);
    expect(DOCUMENT_STEPS.filter((d) => d.hasTemplate).length).toBeGreaterThanOrEqual(3);
  });

  it("offers only connectors that are built, and says what to prepare for each", () => {
    expect(REQUESTABLE.map((c) => c.type).sort()).toEqual(["document_folder", "postgres_database", "website_scanner"]);
    for (const c of REQUESTABLE) expect((WHAT_WE_NEED[c.type] ?? []).length, c.type).toBeGreaterThan(1);
    expect(PLANNED_NAMES.length).toBe(CONNECTORS.filter((c) => c.status === "planned").length);
    for (const n of PLANNED_NAMES) expect(REQUESTABLE.map((c) => c.name)).not.toContain(n);
  });

  it("turns the form into a message for Primus, with no password asked for", () => {
    const t = connectionRequestText({ type: "postgres_database", systemName: "Loan database", hostedWhere: "Pune", contactName: "Kabir Shah", notes: "KYC data" });
    expect(t.subject).toContain("PostgreSQL");
    expect(t.subject).toContain("Loan database");
    expect(t.question).toContain("Kabir Shah");
    expect(t.question).toMatch(/not shared any password/i);
  });

  it("refuses a connector that is only planned, a missing name or a missing contact, but accepts 'other'", () => {
    expect(() => connectionRequestText({ type: "mysql_database", systemName: "X db", contactName: "Someone" })).toThrow();
    expect(() => connectionRequestText({ type: "nonsense", systemName: "X db", contactName: "Someone" })).toThrow();
    expect(() => connectionRequestText({ type: "postgres_database", systemName: "", contactName: "Someone" })).toThrow();
    expect(() => connectionRequestText({ type: "postgres_database", systemName: "Db", contactName: "" })).toThrow();
    const o = connectionRequestText({ type: OTHER_SYSTEM, systemName: "Legacy mainframe", contactName: "Ops lead" });
    expect(o.question).toMatch(/not built yet/i);
  });

  it("keeps a long or messy input to a safe size", () => {
    const t = connectionRequestText({ type: "website_scanner", systemName: "a".repeat(500), contactName: "b".repeat(500), notes: "n".repeat(5000) });
    expect(t.subject.length).toBeLessThanOrEqual(300);
    expect(t.question.length).toBeLessThan(2500);
  });
});
