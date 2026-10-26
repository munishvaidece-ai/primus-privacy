// A minimal Word (.docx) writer for the demo document pack: headings,
// paragraphs, bullet-style lines and simple two-column tables. It reads back
// through lib/ai/extract.ts like any other Word file.
import { strToU8, zipSync } from "fflate";

export type DocBlock =
  | { t: "h1" | "h2" | "p" | "li"; text: string }
  | { t: "table"; rows: string[][] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function para(text: string, opts: { bold?: boolean; size?: number; bullet?: boolean } = {}): string {
  const rpr = `<w:rPr>${opts.bold ? "<w:b/>" : ""}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ""}</w:rPr>`;
  const ppr = opts.bullet ? `<w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>` : `<w:pPr><w:spacing w:after="120"/></w:pPr>`;
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${esc((opts.bullet ? "• " : "") + text)}</w:t></w:r></w:p>`;
}

export function buildDocx(blocks: DocBlock[]): Uint8Array {
  const body = blocks
    .map((b) => {
      if (b.t === "table") {
        const rows = b.rows
          .map((r) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${para(c)}</w:tc>`).join("")}</w:tr>`)
          .join("");
        return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`;
      }
      if (b.t === "h1") return para(b.text, { bold: true, size: 36 });
      if (b.t === "h2") return para(b.text, { bold: true, size: 28 });
      if (b.t === "li") return para(b.text, { bullet: true });
      return para(b.text);
    })
    .join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`),
  };
  return zipSync(files, { level: 6 });
}
