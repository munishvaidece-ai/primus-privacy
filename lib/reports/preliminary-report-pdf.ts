import "server-only";
import PDFDocument from "pdfkit";
import type { EngagementReportData } from "@/lib/domain/reports";

// The preliminary report: a short, plain-language read-out that the client can
// pass around inside their organisation while they work through the full report.
// It is built from the same released records as the final report and adds
// nothing new. It does not give a legal opinion or a score; it counts what is
// recorded and lists the first things to do.

const HEADING = "#4a1511";
const BODY = "#334155";
const MUTED = "#64748b";
const ACCENT = "#8f5424";
const MARGIN = 56;
const SEVERITY: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface PreliminarySummary {
  headline: string;
  narrative: string;
}

export interface PreliminaryFacts {
  controlsAssessed: number;
  controlsTotal: number;
  ratings: Array<{ label: string; count: number }>;
  openFindings: number;
  topFindings: Array<{ title: string; severity: string }>;
  openActions: number;
  firstActions: Array<{ title: string; priority: string | null; dueDate: string | null }>;
}

/** Counts from the records. Pure, so it can be tested without a database. */
export function preliminaryFacts(data: EngagementReportData): PreliminaryFacts {
  const rows = data.selectedAssessment.controlRows;
  const ratingCount: Record<string, number> = {};
  for (const r of rows) {
    if (!r.response) continue;
    const k = r.response.effectivenessRating;
    ratingCount[k] = (ratingCount[k] ?? 0) + 1;
  }
  const open = data.findings.filter((f) => f.status !== "closed");
  const topFindings = [...open].sort((a, b) => (SEVERITY[a.severity] ?? 9) - (SEVERITY[b.severity] ?? 9)).slice(0, 5).map((f) => ({ title: f.title, severity: f.severity }));
  const openActions = data.remediationActions.filter((a) => a.status !== "validated" && a.status !== "closed");
  const firstActions = [...openActions]
    .sort((a, b) => (SEVERITY[a.priority ?? ""] ?? 9) - (SEVERITY[b.priority ?? ""] ?? 9) || String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999")))
    .slice(0, 5)
    .map((a) => ({ title: a.title, priority: a.priority, dueDate: a.dueDate }));
  return {
    controlsAssessed: data.selectedAssessment.progress.completed,
    controlsTotal: data.selectedAssessment.progress.total,
    ratings: Object.entries(ratingCount).map(([label, count]) => ({ label: label.replace(/_/g, " "), count })).sort((a, b) => b.count - a.count),
    openFindings: open.length,
    topFindings,
    openActions: openActions.length,
    firstActions,
  };
}

export function renderPreliminaryReportPdf(data: EngagementReportData, summary: PreliminarySummary | null): Promise<Buffer> {
  const facts = preliminaryFacts(data);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const width = doc.page.width - MARGIN * 2;

    doc.fontSize(10).fillColor(ACCENT).font("Helvetica-Bold").text("PRIMUS PRIVACY", { characterSpacing: 1 });
    doc.moveDown(0.8);
    doc.fontSize(22).fillColor(HEADING).text("Your preliminary report");
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor(BODY).font("Helvetica").text(`${data.engagement.organisationName} · ${data.engagement.name}`);
    doc.fontSize(9).fillColor(MUTED).text(`Prepared ${data.generatedAt.toISOString().slice(0, 10)} from the records Primus has released to you. The full report has the detail.`);
    doc.moveDown(1.2);

    const heading = (t: string) => {
      doc.moveDown(0.8);
      doc.fontSize(13).fillColor(HEADING).font("Helvetica-Bold").text(t);
      doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + width, doc.y + 2).strokeColor(ACCENT).lineWidth(1).stroke();
      doc.moveDown(0.6);
      doc.font("Helvetica").fontSize(10).fillColor(BODY);
    };
    const bullet = (t: string) => doc.fontSize(10).fillColor(BODY).font("Helvetica").text(`•  ${t}`, { indent: 0, paragraphGap: 3 });

    heading("In short");
    if (summary && (summary.headline || summary.narrative)) {
      if (summary.headline) doc.font("Helvetica-Bold").fontSize(11).fillColor(HEADING).text(summary.headline);
      doc.moveDown(0.3);
      if (summary.narrative) doc.font("Helvetica").fontSize(10).fillColor(BODY).text(summary.narrative);
    } else {
      doc.text(`Primus has looked at ${facts.controlsAssessed} of ${facts.controlsTotal} controls. ${facts.openFindings} finding${facts.openFindings === 1 ? " is" : "s are"} still open and ${facts.openActions} action${facts.openActions === 1 ? " is" : "s are"} still to be done.`);
    }

    heading("Where you stand");
    bullet(`Controls looked at: ${facts.controlsAssessed} of ${facts.controlsTotal}.`);
    if (facts.ratings.length) bullet(`How they were rated: ${facts.ratings.map((r) => `${r.count} ${r.label}`).join(", ")}.`);
    bullet(`Findings still open: ${facts.openFindings}.`);
    bullet(`Actions still to do: ${facts.openActions}.`);

    heading("What needs your attention first");
    if (facts.topFindings.length === 0) doc.font("Helvetica-Oblique").fillColor(MUTED).text("There are no open findings in the records released to you.");
    for (const f of facts.topFindings) bullet(`${f.title} (${f.severity})`);

    heading("Your first actions");
    if (facts.firstActions.length === 0) doc.font("Helvetica-Oblique").fillColor(MUTED).text("There are no open actions in the records released to you.");
    for (const a of facts.firstActions) bullet(`${a.title}${a.priority ? ` · ${a.priority} priority` : ""}${a.dueDate ? ` · due ${a.dueDate}` : ""}`);

    heading("Want to go deeper?");
    doc.font("Helvetica").fontSize(10).fillColor(BODY).text("This report counts what is recorded. It does not tell you how the Act applies to your particular business, and it is not legal advice. For deeper insights, a review of how your practices line up with the DPDP Act, or help with the first actions above, book a 30 minute consultation with our experts. Open \"DPO Mate\" in your Primus portal and choose \"Connect with us\".");

    doc.end();
  });
}
