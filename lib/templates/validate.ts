// Checks an uploaded Excel file against a template and reads its content.
// Every problem is reported with the sheet, row and column, in plain words,
// because the person reading it is the client's compliance lead, not a developer.
import { readXlsx, parseDateCell, type ReadSheet } from "./xlsx";
import { MARKER_SHEET } from "./build";
import { TEMPLATES, type TColumn, type TSheetDef, type TemplateKey } from "./definitions";

export interface Issue {
  severity: "error" | "warning";
  sheet?: string;
  row?: number;
  column?: string;
  message: string;
}

export interface ParsedRow {
  /** The row number in the Excel sheet, so a source can say "row 7". */
  row: number;
  v: Record<string, string>;
}
export interface ParsedFormRow {
  ref: string;
  key: string;
  label: string;
  row: number;
  answer: string;
  notes: string;
  /** The "Where it is written down" column, when the sheet has one. */
  document: string;
}
export interface ParsedTemplate {
  key: TemplateKey;
  version: number;
  tables: Record<string, ParsedRow[]>;
  forms: Record<string, ParsedFormRow[]>;
}

export interface ValidationResult {
  ok: boolean;
  /** The template the file claims to be, if it carries a marker. */
  detectedKey: string | null;
  issues: Issue[];
  data: ParsedTemplate | null;
  /** One plain sentence for the top of the result. */
  summary: string;
  stats: { rows: number; errors: number; warnings: number };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const colLetter = (i: number) => String.fromCharCode(65 + (i % 26));

function checkValue(col: { header: string; options?: string[]; type?: TColumn["type"] }, raw: string, issues: Issue[], at: { sheet: string; row: number }): string {
  let v = raw.trim();
  if (!v) return "";
  if (col.options?.length) {
    const hit = col.options.find((o) => norm(o) === norm(v));
    if (!hit) {
      issues.push({ severity: "error", ...at, column: col.header, message: `"${v}" is not one of the allowed answers (${col.options.join(", ")}).` });
      return v;
    }
    v = hit;
  }
  if (col.type === "number") {
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n)) issues.push({ severity: "error", ...at, column: col.header, message: `"${v}" is not a number.` });
    else v = String(n);
  }
  if (col.type === "date") {
    const d = parseDateCell(v);
    if (!d) issues.push({ severity: "error", ...at, column: col.header, message: `"${v}" is not a date. Use a form like 2026-04-30.` });
    else v = d;
  }
  return v;
}

function findHeader(sheet: ReadSheet, wanted: string[]): { rowIndex: number; map: Map<string, number> } | null {
  for (let r = 0; r < Math.min(sheet.rows.length, 6); r++) {
    const cells = sheet.rows[r] ?? [];
    const normed = cells.map((c) => norm(c ?? ""));
    if (wanted.every((w) => normed.includes(norm(w)))) {
      const map = new Map<string, number>();
      wanted.forEach((w) => map.set(w, normed.indexOf(norm(w))));
      return { rowIndex: r, map };
    }
  }
  // not all found: report which are missing using the best candidate row
  return null;
}

function missingHeaders(sheet: ReadSheet, wanted: string[]): string[] {
  let best: string[] = wanted;
  for (let r = 0; r < Math.min(sheet.rows.length, 6); r++) {
    const normed = (sheet.rows[r] ?? []).map((c) => norm(c ?? ""));
    const missing = wanted.filter((w) => !normed.includes(norm(w)));
    if (missing.length < best.length) best = missing;
  }
  return best;
}

function parseTable(def: TSheetDef, sheet: ReadSheet, issues: Issue[]): ParsedRow[] {
  const wanted = def.columns.map((c) => c.header);
  const header = findHeader(sheet, wanted);
  if (!header) {
    const m = missingHeaders(sheet, wanted);
    issues.push({ severity: "error", sheet: def.name, message: `The column heading${m.length === 1 ? "" : "s"} ${m.map((x) => `"${x}"`).join(", ")} ${m.length === 1 ? "is" : "are"} missing from this sheet. The template has been changed, so it cannot be read reliably. Download a fresh copy of the template.` });
    return [];
  }
  const out: ParsedRow[] = [];
  for (let r = header.rowIndex + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] ?? [];
    if (cells.every((c) => !c || !c.trim())) continue;
    const at = { sheet: def.name, row: r + 1 };
    const v: Record<string, string> = {};
    for (const col of def.columns) {
      const raw = cells[header.map.get(col.header)!] ?? "";
      if (col.required && !raw.trim()) {
        issues.push({ severity: "error", ...at, column: col.header, message: `"${col.header}" is empty but is required.` });
        v[col.key] = "";
      } else v[col.key] = checkValue(col, raw, issues, at);
    }
    out.push({ row: r + 1, v });
  }
  if (out.length < (def.minRows ?? 0)) issues.push({ severity: "error", sheet: def.name, message: `This sheet has no rows filled in. At least ${def.minRows} ${def.minRows === 1 ? "is" : "are"} needed.` });
  return out;
}

function parseForm(def: TSheetDef, sheet: ReadSheet, issues: Issue[]): ParsedFormRow[] {
  const answerCols = def.columns.map((c) => c.header);
  const wanted = ["Ref", def.labelHeader ?? "Field", ...answerCols];
  const header = findHeader(sheet, wanted);
  if (!header) {
    const m = missingHeaders(sheet, wanted);
    issues.push({ severity: "error", sheet: def.name, message: `The column heading${m.length === 1 ? "" : "s"} ${m.map((x) => `"${x}"`).join(", ")} ${m.length === 1 ? "is" : "are"} missing from this sheet. The template has been changed, so it cannot be read reliably. Download a fresh copy of the template.` });
    return [];
  }
  const byRef = new Map((def.rows ?? []).map((r) => [r.ref, r]));
  const seen = new Set<string>();
  const out: ParsedFormRow[] = [];
  for (let r = header.rowIndex + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] ?? [];
    const ref = (cells[header.map.get("Ref")!] ?? "").trim();
    if (!ref) continue;
    const q = byRef.get(ref);
    if (!q) {
      issues.push({ severity: "warning", sheet: def.name, row: r + 1, column: "Ref", message: `"${ref}" is not a question in this template, so it was ignored.` });
      continue;
    }
    seen.add(ref);
    const at = { sheet: def.name, row: r + 1 };
    const rawAnswer = cells[header.map.get(answerCols[0]!)!] ?? "";
    if (q.required && !rawAnswer.trim()) issues.push({ severity: "error", ...at, column: answerCols[0], message: `"${q.label}" must be answered.` });
    const answer = checkValue({ header: answerCols[0]!, options: q.options, type: q.type }, rawAnswer, issues, at);
    const second = def.columns[1];
    const secondText = second ? (cells[header.map.get(second.header)!] ?? "") : "";
    out.push({ ref, key: q.key, label: q.label, row: r + 1, answer, notes: second?.key === "notes" ? secondText : "", document: second?.key === "document" ? secondText : "" });
  }
  for (const q of def.rows ?? []) if (q.required && !seen.has(q.ref)) issues.push({ severity: "error", sheet: def.name, message: `The question ${q.ref} ("${q.label}") has been removed from the sheet.` });
  return out;
}

export function validateTemplateFile(buf: Uint8Array, expected: TemplateKey): ValidationResult {
  const issues: Issue[] = [];
  const fail = (summary: string, detectedKey: string | null = null): ValidationResult => ({ ok: false, detectedKey, issues, data: null, summary, stats: { rows: 0, errors: issues.filter((i) => i.severity === "error").length, warnings: 0 } });

  let wb;
  try {
    wb = readXlsx(buf);
  } catch (e) {
    issues.push({ severity: "error", message: e instanceof Error ? e.message : "The file could not be read." });
    return fail("This file is not an Excel workbook, so it was not read. Upload the .xlsx template for this phase.");
  }
  const marker = wb.sheets.find((s) => s.name === MARKER_SHEET);
  const markerRow = marker?.rows.find((r) => r[0] === "PRIMUS-TEMPLATE");
  if (!markerRow) {
    issues.push({ severity: "error", message: "This workbook is not one of the Primus templates. Download the template for this phase and copy your information into it." });
    return fail("This is not a Primus template, so nothing was read. Download the template for this phase from this screen.");
  }
  const detectedKey = markerRow[1] ?? "";
  const def = TEMPLATES[expected];
  if (detectedKey !== expected) {
    const other = (TEMPLATES as Record<string, (typeof TEMPLATES)[TemplateKey]>)[detectedKey];
    issues.push({ severity: "error", message: `This is the "${other?.title ?? detectedKey}" template${other ? ` (phase ${other.phase})` : ""}, but this upload slot expects "${def.title}" (phase ${def.phase}).` });
    return fail(`Wrong template: this is ${other ? `the ${other.title}` : "a different template"}, and this slot expects the ${def.title}. Nothing was read.`, detectedKey);
  }
  const version = Number(markerRow[2] ?? 0);
  if (version !== def.version) issues.push({ severity: "warning", message: `This file was made from version ${version} of the template; the current version is ${def.version}. It was read anyway.` });

  const tables: Record<string, ParsedRow[]> = {};
  const forms: Record<string, ParsedFormRow[]> = {};
  for (const s of def.sheets) {
    const sheet = wb.sheets.find((x) => norm(x.name) === norm(s.name) && !x.hidden);
    if (!sheet) {
      issues.push({ severity: "error", sheet: s.name, message: `The sheet "${s.name}" is missing. The template has been changed. Download a fresh copy.` });
      continue;
    }
    if (s.kind === "table") tables[s.name] = parseTable(s, sheet, issues);
    else forms[s.name] = parseForm(s, sheet, issues);
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const rows = Object.values(tables).reduce((n, t) => n + t.length, 0) + Object.values(forms).reduce((n, t) => n + t.filter((x) => x.answer).length, 0);
  const ok = errors === 0;
  return {
    ok,
    detectedKey,
    issues,
    data: ok ? { key: expected, version, tables, forms } : null,
    summary: ok ? `Template check passed: ${rows} filled row${rows === 1 ? "" : "s"} read${warnings ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.` : `Template check failed with ${errors} problem${errors === 1 ? "" : "s"}. Nothing was loaded. Fix the cells listed and upload again.`,
    stats: { rows, errors, warnings },
  };
}

export { colLetter };
