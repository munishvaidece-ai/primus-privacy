// The demo pack: the good files pass their own template check, the deliberately bad ones are refused with a useful reason.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateTemplateFile } from "@/lib/templates/validate";
import { closureFile, indexFile, inventoryFile, scopeFile, testsFile } from "@/lib/demo/orchid/pack";

const bad = (name: string) => new Uint8Array(readFileSync(`demo-data/orchid-hill/Try these bad uploads/${name}`));

describe("Orchid Hill demo pack", () => {
  it("every filled template passes its own check", () => {
    expect(validateTemplateFile(scopeFile(), "SCOPE-INTAKE").ok).toBe(true);
    expect(validateTemplateFile(inventoryFile(), "DATA-INVENTORY").ok).toBe(true);
    expect(validateTemplateFile(testsFile(), "CONTROL-TEST-LOG").ok).toBe(true);
    expect(validateTemplateFile(indexFile(), "EVIDENCE-INDEX").ok).toBe(true);
    expect(validateTemplateFile(closureFile(), "CLOSURE-PACK").ok).toBe(true);
  });
  it("the bad samples are refused, each for its own reason", () => {
    const wrong = validateTemplateFile(bad("wrong_template_evidence_index_in_phase1.xlsx"), "SCOPE-INTAKE");
    expect(wrong.ok).toBe(false);
    expect(wrong.summary).toMatch(/Wrong template/);
    const renamed = validateTemplateFile(bad("renamed_heading_scope_intake.xlsx"), "SCOPE-INTAKE");
    expect(renamed.ok).toBe(false);
    expect(renamed.issues[0]!.message).toMatch(/missing/);
    const empty = validateTemplateFile(bad("empty_required_cells_scope_intake.xlsx"), "SCOPE-INTAKE");
    expect(empty.ok).toBe(false);
    expect(empty.issues.length).toBeGreaterThanOrEqual(4);
    expect(empty.issues.every((i) => i.sheet && i.message)).toBe(true);
    expect(validateTemplateFile(bad("not_a_spreadsheet.txt"), "SCOPE-INTAKE").summary).toMatch(/not an Excel workbook/);
  });
});
