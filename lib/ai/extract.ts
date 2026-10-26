// Text extraction from evidence files so the AI can read them.
// Supported: plain text / markdown / csv / json, html, PDF (text layer),
// Word (.docx) and Excel (.xlsx). NOT supported: scanned PDFs and images
// (no OCR is bundled) — those come back with very little text and the AI
// routes them to a person as "unreadable" rather than guessing.
import { unzipSync, strFromU8 } from "fflate";

export interface ExtractResult {
  text: string;
  method: string;
  truncated: boolean;
}

const MAX_CHARS = 200_000;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function stripHtml(html: string): string {
  return decodeXmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function docxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) return "";
  return decodeXmlEntities(
    strFromU8(xml)
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

function xlsxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf), {
    filter: (f) => f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name),
  });
  const shared: string[] = [];
  const ss = files["xl/sharedStrings.xml"];
  if (ss) {
    for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(decodeXmlEntities([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
    }
  }
  const out: string[] = [];
  for (const name of Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort()) {
    const xml = strFromU8(files[name]!);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1]!.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? "";
        const inner = c[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
        if (/t="s"/.test(attrs) && v !== undefined) cells.push(shared[Number(v)] ?? "");
        else if (inline !== undefined) cells.push(decodeXmlEntities(inline));
        else if (v !== undefined) cells.push(v);
      }
      if (cells.length) out.push(cells.join(" | "));
    }
  }
  return out.join("\n");
}

async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return pages.join("\n\n");
}

export async function extractText(buf: Buffer, mimeType: string, filename: string): Promise<ExtractResult> {
  const name = filename.toLowerCase();
  let text = "";
  let method = "none";
  try {
    if (mimeType === "application/pdf" || name.endsWith(".pdf")) {
      text = await pdfText(buf);
      method = "pdf-text-layer";
    } else if (name.endsWith(".docx")) {
      text = docxText(buf);
      method = "docx-xml";
    } else if (name.endsWith(".xlsx")) {
      text = xlsxText(buf);
      method = "xlsx-xml";
    } else if (mimeType.startsWith("text/html") || name.endsWith(".html") || name.endsWith(".htm")) {
      text = stripHtml(buf.toString("utf8"));
      method = "html-strip";
    } else if (mimeType.startsWith("text/") || /\.(txt|md|csv|json)$/.test(name)) {
      text = buf.toString("utf8");
      method = "plain-text";
    } else if (mimeType.startsWith("image/")) {
      method = "image-no-ocr";
    } else {
      method = "unsupported-format";
    }
  } catch (e) {
    method = `failed:${e instanceof Error ? e.message.slice(0, 60) : "error"}`;
    text = "";
  }
  text = text.replace(/\u0000/g, "");
  const truncated = text.length > MAX_CHARS;
  return { text: truncated ? text.slice(0, MAX_CHARS) : text, method, truncated };
}
