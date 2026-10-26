// The fixed templates: what we hand out must be readable, what comes back must be
// checked, and every problem must say where it is.
import { describe, expect, it } from "vitest";
import { buildDocx } from "@/lib/templates/docx";
import { buildXlsx, parseDateCell, readXlsx } from "@/lib/templates/xlsx";
import { buildTemplateWorkbook } from "@/lib/templates/build";
import { TEMPLATE_LIST, TEMPLATES, practiceRows } from "@/lib/templates/definitions";
import { validateTemplateFile } from "@/lib/templates/validate";
import { extractText } from "@/lib/ai/extract";

describe("xlsx writer and reader", () => {
  it("round-trips text, numbers, several sheets and a hidden sheet", () => {
    const buf = buildXlsx([
      { name: "A", columns: [{ header: "Name" }, { header: "Count" }], rows: [["Ravi & Co <test>", 3], ["Second", null]] },
      { name: "hidden", hidden: true, columns: [{ header: "k" }], rows: [["v"]] },
    ]);
    const wb = readXlsx(buf);
    expect(wb.sheets.map((s) => [s.name, s.hidden])).toEqual([["A", false], ["hidden", true]]);
    expect(wb.sheets[0]!.rows[0]).toEqual(["Name", "Count"]);
    expect(wb.sheets[0]!.rows[1]).toEqual(["Ravi & Co <test>", "3"]);
  });
  it("rejects a file that is not a workbook", () => {
    expect(() => readXlsx(new TextEncoder().encode("not a zip"))).toThrow(/not a valid Excel/);
  });
  it("reads Excel date serials and common date forms", () => {
    expect(parseDateCell("46142")).toBe("2026-04-30");
    expect(parseDateCell("2026-04-30")).toBe("2026-04-30");
    expect(parseDateCell("30/04/2026")).toBe("2026-04-30");
    expect(parseDateCell("soon")).toBeNull();
  });
});

describe("docx writer", () => {
  it("produces a Word file the document extractor can read", async () => {
    const buf = Buffer.from(buildDocx([{ t: "h1", text: "Privacy Policy" }, { t: "p", text: "We keep records for 8 years." }, { t: "li", text: "Retention" }, { t: "table", rows: [["Record", "Years"], ["KYC", "8"]] }]));
    const r = await extractText(buf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "policy.docx");
    expect(r.text).toContain("Privacy Policy");
    expect(r.text).toContain("We keep records for 8 years.");
    expect(r.text).toContain("KYC");
  });
});

describe("templates", () => {
  it("every template defines unique column keys and unique form refs", () => {
    for (const t of TEMPLATE_LIST) {
      for (const s of t.sheets) {
        const keys = s.columns.map((c) => c.key);
        expect(new Set(keys).size, `${t.key}/${s.name}`).toBe(keys.length);
        if (s.rows) expect(new Set(s.rows.map((r) => r.ref)).size).toBe(s.rows.length);
      }
    }
  });
  it("the Practices questions are the discovery questionnaire's own questions", () => {
    const rows = practiceRows();
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) expect(r.discovery).toBeTruthy();
  });
  it("a blank template builds, opens, carries its marker, and is refused until it is filled in", () => {
    for (const t of TEMPLATE_LIST) {
      const buf = buildTemplateWorkbook(t.key);
      const wb = readXlsx(buf);
      expect(wb.sheets.find((s) => s.name === "_template")?.rows[1]).toEqual(["PRIMUS-TEMPLATE", t.key, String(t.version)]);
      const r = validateTemplateFile(buf, t.key);
      expect(r.ok, t.key).toBe(false);
      expect(r.data).toBeNull();
    }
  });
  it("a filled template passes, and the content comes back with its row numbers", () => {
    const buf = buildTemplateWorkbook("CONTROL-TEST-LOG", {
      tables: { Tests: [{ control: "BRK-03", procedure: "Inspected the audit report", sample: "Latest audit", result: "Pass", date: "2026-04-30", tester: "Arjun Mehta", notes: null }] },
    });
    const r = validateTemplateFile(buf, "CONTROL-TEST-LOG");
    expect(r.ok).toBe(true);
    expect(r.data!.tables.Tests![0]).toMatchObject({ row: 3, v: { control: "BRK-03", result: "Pass", date: "2026-04-30" } });
  });
  it("says which template it is when the wrong one is uploaded", () => {
    const buf = buildTemplateWorkbook("DATA-INVENTORY");
    const r = validateTemplateFile(buf, "SCOPE-INTAKE");
    expect(r.ok).toBe(false);
    expect(r.detectedKey).toBe("DATA-INVENTORY");
    expect(r.summary).toMatch(/Wrong template/);
    expect(r.issues[0]!.message).toMatch(/Data Inventory.*expects "Scope Intake Form"/);
  });
  it("refuses a workbook that is not a Primus template", () => {
    const plain = buildXlsx([{ name: "Sheet1", columns: [{ header: "a" }], rows: [["b"]] }]);
    const r = validateTemplateFile(plain, "SCOPE-INTAKE");
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/not a Primus template/);
  });
  it("refuses something that is not a workbook at all", () => {
    const r = validateTemplateFile(new TextEncoder().encode("hello"), "SCOPE-INTAKE");
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/not an Excel workbook/);
  });
  it("reports empty required cells, bad drop-down values, bad dates and numbers with the row and column", () => {
    const buf = buildTemplateWorkbook("CONTROL-TEST-LOG", {
      tables: {
        Tests: [
          { control: "BRK-01", procedure: "", sample: null, result: "Maybe", date: "yesterday", tester: "A", notes: null },
          { control: "BRK-02", procedure: "ok", sample: null, result: "pass", date: "2026-05-01", tester: "A", notes: null },
        ],
      },
    });
    const r = validateTemplateFile(buf, "CONTROL-TEST-LOG");
    expect(r.ok).toBe(false);
    const msgs = r.issues.map((i) => `${i.sheet}|${i.row}|${i.column}|${i.message}`);
    expect(msgs.some((m) => m.includes("Tests|3|What was tested|"))).toBe(true);
    expect(msgs.some((m) => m.includes("Tests|3|Result|") && m.includes("not one of the allowed"))).toBe(true);
    expect(msgs.some((m) => m.includes("Tests|3|Tested on|") && m.includes("not a date"))).toBe(true);
    // row 4 is fine: "pass" matches "Pass" without regard to case
    expect(r.issues.some((i) => i.row === 4)).toBe(false);
  });
  it("detects a template whose column headings were changed", () => {
    const def = TEMPLATES["CONTROL-TEST-LOG"];
    const bad = buildXlsx([
      { name: "Tests", note: "x", columns: def.sheets[0]!.columns.map((c, i) => ({ header: i === 1 ? "Procedure (renamed)" : c.header })), rows: [["BRK-01", "x", "", "Pass", "2026-01-01", "A", ""]] },
      { name: "_template", hidden: true, columns: [{ header: "marker" }, { header: "key" }, { header: "version" }], rows: [["PRIMUS-TEMPLATE", "CONTROL-TEST-LOG", 1]] },
    ]);
    const r = validateTemplateFile(bad, "CONTROL-TEST-LOG");
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.message).toMatch(/"What was tested".*missing/);
  });
});
