// Builds the Excel file for a template: blank (what people download) or filled
// (the demo files). The same definition drives both, so a filled demo file can
// only differ from the blank template in its data.
import { buildXlsx, type SheetSpec } from "./xlsx";
import { TEMPLATES, type TFormRow, type TemplateDef, type TemplateKey } from "./definitions";

export type FilledTable = Array<Record<string, string | number | null>>;
export type FilledForm = Record<string, { answer?: string | number | null; notes?: string | null; document?: string | null }>;
export interface Filled {
  tables?: Record<string, FilledTable>;
  forms?: Record<string, FilledForm>;
}

export const MARKER_SHEET = "_template";

function instructionsSheet(def: TemplateDef): SheetSpec {
  return {
    name: "Instructions",
    columns: [{ header: `Primus Privacy template · ${def.title} (version ${def.version})`, width: 110 }],
    rows: [
      [`Phase ${def.phase}. ${def.purpose}`],
      [`Completed by: ${def.completedBy === "client" ? "the client organisation" : "the Primus team"}.`],
      [`What the AI does with it: ${def.aiTask}`],
      [""],
      ["How to fill it in"],
      ["1. Go to each of the other sheets and fill in the yellow cells."],
      ["2. Do not rename the sheets, change the column headings, or change the Ref column. The platform checks them, and an altered template is rejected."],
      ["3. Where a cell has a drop-down list, choose from the list."],
      ["4. Dates are best typed as 2026-04-30."],
      ["5. Save as .xlsx and upload it on the engagement's Live Run screen, in the phase this template belongs to."],
      [""],
      ["Everything in this file is read by the platform exactly as written. Nothing outside the template is read."],
    ],
  };
}

function formSheet(def: TemplateDef, name: string, filled?: FilledForm): SheetSpec {
  const sheet = def.sheets.find((s) => s.name === name)!;
  const rows = (sheet.rows ?? []).map((r: TFormRow) => {
    const f = filled?.[r.ref];
    return [r.ref, r.label, ...sheet.columns.map((c, i) => (i === 0 ? (f?.answer ?? null) : c.key === "notes" ? (f?.notes ?? null) : (f?.document ?? null)))];
  });
  const columns = [{ header: "Ref", width: 8 }, { header: sheet.labelHeader ?? "Field", width: 62 }, ...sheet.columns.map((c) => ({ header: c.header, width: c.width ?? 30 }))];
  // Drop-down lists differ by row, which a column-wide list cannot express, so rows with fixed options are validated on upload instead.
  return { name, columns, rows, note: sheet.note };
}

export function buildTemplateWorkbook(key: TemplateKey, filled?: Filled): Uint8Array {
  const def = TEMPLATES[key];
  const sheets: SheetSpec[] = [instructionsSheet(def)];
  for (const s of def.sheets) {
    if (s.kind === "form") {
      sheets.push(formSheet(def, s.name, filled?.forms?.[s.name]));
    } else {
      const data = filled?.tables?.[s.name];
      sheets.push({
        name: s.name,
        note: s.note,
        columns: s.columns.map((c) => ({ header: c.header, width: c.width, options: c.options })),
        rows: (data ?? []).map((row) => s.columns.map((c) => row[c.key] ?? null)),
        blankRows: filled ? 0 : 25,
      });
    }
  }
  sheets.push({ name: MARKER_SHEET, hidden: true, columns: [{ header: "marker" }, { header: "key" }, { header: "version" }], rows: [["PRIMUS-TEMPLATE", def.key, def.version]] });
  return buildXlsx(sheets);
}
