// A small Excel (.xlsx) writer and reader, built on fflate (already a dependency).
// The writer produces the fixed templates and the demo files; the reader reads
// what people upload. Only what the templates need is supported: text, numbers,
// several sheets, header styling, drop-down lists, a hidden marker sheet.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export interface SheetColumn {
  header: string;
  width?: number;
  /** Drop-down list for the data rows under this column. */
  options?: string[];
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Array<Array<string | number | null>>;
  /** Number of empty, styled input rows to leave under the data (templates). */
  blankRows?: number;
  /** A line of instructions shown above the header. */
  note?: string;
  hidden?: boolean;
  /** Style the first column as a locked label column (for field/value sheets). */
  labelColumn?: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B5B5B"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5B1A18"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3ECEB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9CFCF"/></left><right style="thin"><color rgb="FFD9CFCF"/></right><top style="thin"><color rgb="FFD9CFCF"/></top><bottom style="thin"><color rgb="FFD9CFCF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cell(ref: string, v: string | number | null, style: number): string {
  if (v === null || v === "") return `<c r="${ref}" s="${style}"/>`;
  if (typeof v === "number") return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(s: SheetSpec): string {
  const cols = s.columns;
  const headerRow = s.note ? 2 : 1;
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`);
  out.push(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`);
  out.push(`<sheetFormatPr defaultRowHeight="18"/>`);
  out.push(`<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 24}" customWidth="1"/>`).join("")}</cols>`);
  out.push(`<sheetData>`);
  if (s.note) out.push(`<row r="1" ht="48" customHeight="1">${cell("A1", s.note, 5)}</row>`);
  out.push(`<row r="${headerRow}" ht="32" customHeight="1">${cols.map((c, i) => cell(`${colName(i)}${headerRow}`, c.header, 1)).join("")}</row>`);
  let r = headerRow + 1;
  for (const row of s.rows) {
    out.push(`<row r="${r}">${cols.map((_, i) => cell(`${colName(i)}${r}`, row[i] ?? null, s.labelColumn && i === 0 ? 4 : s.hidden ? 0 : 2)).join("")}</row>`);
    r++;
  }
  const dataStart = headerRow + 1;
  for (let k = 0; k < (s.blankRows ?? 0); k++) {
    out.push(`<row r="${r}">${cols.map((_, i) => cell(`${colName(i)}${r}`, null, 3)).join("")}</row>`);
    r++;
  }
  out.push(`</sheetData>`);
  if (s.note && cols.length > 1) out.push(`<mergeCells count="1"><mergeCell ref="A1:${colName(cols.length - 1)}1"/></mergeCells>`);
  const lists = cols.map((c, i) => ({ c, i })).filter((x) => x.c.options?.length);
  if (lists.length) {
    const last = Math.max(r - 1, dataStart + 200);
    out.push(`<dataValidations count="${lists.length}">${lists.map(({ c, i }) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${colName(i)}${dataStart}:${colName(i)}${last}"><formula1>"${esc(c.options!.join(","))}"</formula1></dataValidation>`).join("")}</dataValidations>`);
  }
  out.push(`<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`);
  return out.join("");
}

export function buildXlsx(sheets: SheetSpec[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="veryHidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  files["xl/styles.xml"] = strToU8(STYLES);
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files, { level: 6 });
}

// ------------------------------------------------------------------ reader
export interface ReadSheet {
  name: string;
  hidden: boolean;
  /** Rows of cell text. Gaps are empty strings. Row index 0 is the first row of the sheet. */
  rows: string[][];
  /** The 1-based sheet row number of rows[0]. Always 1; kept so callers can quote real row numbers. */
  firstRow: number;
}
export interface ReadWorkbook {
  sheets: ReadSheet[];
}

const unesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Reads an .xlsx buffer. Throws if it is not a readable Excel workbook. */
export function readXlsx(buf: Uint8Array): ReadWorkbook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(f.name) });
  } catch {
    throw new Error("This file is not a valid Excel workbook (.xlsx).");
  }
  const wbXml = files["xl/workbook.xml"];
  if (!wbXml) throw new Error("This file is not a valid Excel workbook (.xlsx).");
  const rels = new Map<string, string>();
  const relXml = files["xl/_rels/workbook.xml.rels"];
  if (relXml) for (const m of strFromU8(relXml).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const shared: string[] = [];
  const ss = files["xl/sharedStrings.xml"];
  if (ss) for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unesc([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));

  const sheets: ReadSheet[] = [];
  for (const m of strFromU8(wbXml).matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(/name="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const state = /state="([^"]+)"/.exec(m[0])?.[1] ?? "visible";
    const path = rels.get(rid);
    const xml = path ? files[path] : undefined;
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rm of strFromU8(xml).matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNum = Number(/\br="(\d+)"/.exec(rm[0])?.[1] ?? rows.length + 1);
      const cells: string[] = [];
      for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1] ?? "";
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
        const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const body = cm[2] ?? "";
        let text = "";
        if (t === "s") text = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? -1)] ?? "";
        else if (t === "inlineStr") text = unesc([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
        else text = unesc(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        cells[ref ? colIndex(ref) : cells.length] = text.trim();
      }
      while (rows.length < rowNum - 1) rows.push([]);
      rows[rowNum - 1] = Array.from(cells, (c) => c ?? "");
    }
    sheets.push({ name, hidden: state !== "visible", rows, firstRow: 1 });
  }
  return { sheets };
}

/** Excel stores dates as day counts from 1899-12-30. Accepts that, ISO dates and dd/mm/yyyy. Returns YYYY-MM-DD or null. */
export function parseDateCell(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
  }
  return null;
}
