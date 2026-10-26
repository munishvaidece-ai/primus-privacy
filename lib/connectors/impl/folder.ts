import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { extractText } from "@/lib/ai/extract";
import { maskPii } from "@/lib/ai/mask";
import { sensitivityOf, unique } from "../classify";
import type { ConnectorContext, ConnectorImpl, DiscoveredAsset, ScanResult, TestResult } from "../types";

const cfg = z.object({
  path: z.string().min(1),
  maxFiles: z.coerce.number().int().min(1).max(20000).default(500),
});

const MAX_BYTES = 8 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json",
  ".html": "text/html", ".htm": "text/html", ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".tif": "image/tiff", ".tiff": "image/tiff",
};

function allowedRoots(env: NodeJS.ProcessEnv): string[] {
  return (env.CONNECTOR_FOLDER_ROOTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Resolves the folder and proves it sits inside an allowed root (symlinks followed). */
async function resolveFolder(ctx: ConnectorContext) {
  const c = cfg.parse(ctx.config);
  const roots = allowedRoots(ctx.env);
  if (roots.length === 0) throw new Error("Folder scanning is switched off: your devops team must set CONNECTOR_FOLDER_ROOTS to the mounted folders that may be scanned.");
  const real = await fs.realpath(c.path).catch(() => { throw new Error(`Folder not found: ${c.path}`); });
  const realRoots = await Promise.all(roots.map((r) => fs.realpath(r).catch(() => r)));
  const inside = realRoots.some((r) => real === r || real.startsWith(r.endsWith(path.sep) ? r : r + path.sep));
  if (!inside) throw new Error("That folder is outside the allowed scan locations (CONNECTOR_FOLDER_ROOTS).");
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new Error("The path is not a folder.");
  return { real, realRoots, maxFiles: c.maxFiles };
}

async function* walk(dir: string, roots: string[]): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      // Follow only links that stay inside an allowed root.
      const target = await fs.realpath(p).catch(() => null);
      if (!target || !roots.some((r) => target === r || target.startsWith(r + path.sep))) continue;
      const st = await fs.stat(target);
      if (st.isDirectory()) continue; // never recurse through links (loops)
      yield target;
    } else if (e.isDirectory()) {
      yield* walk(p, roots);
    } else if (e.isFile()) {
      yield p;
    }
  }
}

export const folderConnector: ConnectorImpl = {
  async test(ctx): Promise<TestResult> {
    try {
      const { real, realRoots, maxFiles } = await resolveFolder(ctx);
      let n = 0;
      for await (const _ of walk(real, realRoots)) { if (++n >= maxFiles) break; }
      return { ok: true, message: n >= maxFiles ? `Folder readable; at least ${n} files found.` : `Folder readable; ${n} file(s) found.` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async scan(ctx): Promise<ScanResult> {
    const { real, realRoots, maxFiles } = await resolveFolder(ctx);
    const assets: DiscoveredAsset[] = [];
    let files = 0, unreadable = 0, withPii = 0, skippedLarge = 0, truncated = false;
    for await (const file of walk(real, realRoots)) {
      if (files >= maxFiles) { truncated = true; break; }
      files++;
      const rel = path.relative(real, file) || path.basename(file);
      const ext = path.extname(file).toLowerCase();
      const st = await fs.stat(file);
      const base = { sizeBytes: st.size, modified: st.mtime.toISOString(), extension: ext || null };
      if (st.size > MAX_BYTES) {
        skippedLarge++;
        assets.push({ assetType: "file", name: path.basename(file), location: rel, attributes: { ...base, readable: false, reason: "larger than the 8 MB scan limit" }, piiCategories: [], sensitivity: "unclassified" });
        continue;
      }
      const mime = MIME[ext];
      if (!mime) {
        unreadable++;
        assets.push({ assetType: "file", name: path.basename(file), location: rel, attributes: { ...base, readable: false, reason: "file type not supported" }, piiCategories: [], sensitivity: "unclassified" });
        continue;
      }
      let text = "", method = "";
      try {
        const r = await extractText(await fs.readFile(file), mime, path.basename(file));
        text = r.text; method = r.method;
      } catch {
        text = "";
      }
      if (text.trim().length < 20) {
        unreadable++;
        assets.push({ assetType: "file", name: path.basename(file), location: rel, attributes: { ...base, readable: false, reason: method === "image-no-ocr" ? "image / scan (no text reading available)" : "no readable text" }, piiCategories: [], sensitivity: "unclassified" });
        continue;
      }
      const { counts } = maskPii(text); // counts only; the text is dropped here
      const cats = unique(Object.keys(counts));
      if (cats.length) withPii++;
      assets.push({
        assetType: "file", name: path.basename(file), location: rel,
        attributes: { ...base, readable: true, textMethod: method, matches: counts },
        piiCategories: cats, sensitivity: sensitivityOf(cats),
      });
    }
    return { assets, stats: { filesScanned: files, filesWithPersonalData: withPii, unreadable, skippedLarge, truncated: truncated ? "yes" : "no" } };
  },
};
