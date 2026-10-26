// Turns the demo document specs into real files (Word, PDF, Excel, text, image).
import { deflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import { buildDocx, type DocBlock } from "@/lib/templates/docx";
import { buildXlsx } from "@/lib/templates/xlsx";
import type { DocSpec } from "./evidence";

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  png: "image/png",
};
export const mimeFor = (format: string) => MIME[format] ?? "application/octet-stream";

function blocks(lines: string[]): DocBlock[] {
  return lines.map((l, i): DocBlock => (l.startsWith("# ") ? { t: i === 0 ? "h1" : "h2", text: l.slice(2) } : l.startsWith("- ") ? { t: "li", text: l.slice(2) } : { t: "p", text: l }));
}

async function pdf(lines: string[]): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((r) => doc.on("end", () => r()));
  lines.forEach((l, i) => {
    if (l.startsWith("# ")) doc.font("Helvetica-Bold").fontSize(i === 0 ? 17 : 13).text(l.slice(2)).moveDown(0.5);
    else if (l.startsWith("- ")) doc.font("Helvetica").fontSize(10.5).text(`•  ${l.slice(2)}`, { indent: 10 }).moveDown(0.3);
    else doc.font("Helvetica").fontSize(10.5).text(l, { align: "left" }).moveDown(0.6);
  });
  doc.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

const crcTable = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); }
  return t;
})();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** A grey "scanned page": ruled lines and a stamp box, no text layer. */
export function scanPng(): Uint8Array {
  const w = 620, h = 800;
  const raw = Buffer.alloc((w + 1) * h, 238);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    const line = y > 90 && y < 640 && y % 22 < 5 && y % 110 > 14;
    const stamp = y > 660 && y < 740;
    for (let x = 0; x < w; x++) {
      let v = 238 - ((x * 7 + y * 13) % 9);
      if (line && x > 60 && x < 560 - ((y * 37) % 160)) v = 70;
      if (stamp && (x === 380 || x === 540 || y === 661 || y === 739) && x >= 380 && x <= 540) v = 40;
      raw[y * (w + 1) + 1 + x] = v;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

export async function docBytes(s: DocSpec): Promise<Uint8Array> {
  switch (s.format) {
    case "docx": return buildDocx(blocks(s.lines ?? []));
    case "pdf": return pdf(s.lines ?? [s.title]);
    case "txt": return new TextEncoder().encode((s.lines ?? []).join("\n\n"));
    case "png": return scanPng();
    case "xlsx": {
      const t = s.table!;
      const data = { name: t.sheet, columns: t.header.map((h) => ({ header: h, width: 22 })), rows: t.rows };
      return buildXlsx(t.intro ? [{ name: "About this document", columns: [{ header: s.title, width: 120 }], rows: t.intro.map((x) => [x]) }, data] : [data]);
    }
  }
}
