import { SECTORS } from "../lib/regulation";
import { STARTER_CONTROLS } from "../db/seed/starter-library";
import { EVIDENCE } from "../lib/demo/orchid/evidence";
import { docBytes } from "../lib/demo/orchid/files";
import { extractText } from "../lib/ai/extract";
import { offlineEvidenceReview } from "../lib/ai/tasks/evidence-review";
import { mimeFor } from "../lib/demo/orchid/files";

const all = [...STARTER_CONTROLS, ...SECTORS.flatMap((s) => s.controls.map((c) => ({ code: c.code, title: c.title, description: c.description })))];
(async () => {
  for (const d of EVIDENCE) {
    if (d.role === "not_uploaded") continue;
    const buf = Buffer.from(await docBytes(d));
    const x = await extractText(buf, mimeFor(d.format), d.file);
    const ctrls = d.controls.map((c) => all.find((a) => a.code === c)!).filter(Boolean).map((c) => ({ code: c.code, title: c.title, description: c.description, tier: "medium" as const }));
    const r = offlineEvidenceReview({ evidenceId: "x", title: d.title, evidenceType: "other", filename: d.file, validUntil: null, now: new Date().toISOString(), text: x.text, textMethod: x.method, controls: ctrls, maxChars: 20000 });
    console.log(d.role.padEnd(11), d.file.padEnd(46), d.controls.join(",").padEnd(14), r.verdict.padEnd(16), r.quality.padEnd(8), r.confidence.toFixed(2), `${x.text.length}c`);
  }
})();
