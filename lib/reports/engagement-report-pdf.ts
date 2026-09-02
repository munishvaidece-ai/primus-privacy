import "server-only";
import PDFDocument from "pdfkit";
import type { EngagementReportData } from "@/lib/domain/reports";

// Slice R1 — Basic Engagement Report: the PDF rendering layer.
//
// Library choice (PHASE R1 instructions §17 — "prefer a mature, minimal
// dependency that works reliably in the existing Next.js/Vercel
// architecture, not a large reporting framework"): `pdfkit` — pure
// JavaScript (its own dependencies — fontkit, linebreak, png-js, fflate,
// @noble/hashes, @noble/ciphers — are themselves pure JS, no native
// bindings), so it runs in a plain Node.js server runtime with no
// headless browser (rules out Puppeteer/Playwright+HTML-to-PDF) and no
// native compilation step (rules out canvas-backed alternatives) —
// exactly the "works reliably in the existing Vercel serverless
// architecture" bar instructions §17 sets. It writes directly to a
// binary stream, matching PRODUCT_UX_BLUEPRINT.md §15's own "Route
// Handler (returns a binary/PDF stream)" mechanism for this feature.
//
// Visual identity (instructions §15/§16 — "client-ready... without
// inventing a new visual identity"): this project has no logo asset and
// no dedicated brand-colour token file; the only established visual
// language is the existing UI's own Tailwind palette
// (components/ui/badge.tsx: slate for text/structure, blue-600 as the
// one accent colour, e.g. the "Create Assessment"/focus-ring blue used
// throughout every page in app/(shell)). This module reuses those exact
// hex values rather than choosing new ones, so the PDF reads as the
// same product, not a separately art-directed document.
const COLOR_HEADING = "#0f172a"; // Tailwind slate-900
const COLOR_BODY = "#334155"; // Tailwind slate-700
const COLOR_MUTED = "#64748b"; // Tailwind slate-500
const COLOR_ACCENT = "#2563eb"; // Tailwind blue-600
const COLOR_RULE = "#cbd5e1"; // Tailwind slate-300

const PAGE_MARGIN = 56;

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

function formatDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** Every enum/status value in this report is rendered exactly as the
 * schema stores it (PHASE R1 instructions §6/§9 — "use actual schema
 * terminology," "preserve terminology") — no relabeling table, matching
 * how every existing screen (e.g. `<Badge>{engagement.status}</Badge>`)
 * already displays these same values verbatim. */
function raw(value: string | null | undefined): string {
  return value ?? "—";
}

export interface EngagementReportRenderMeta {
  generatedByEmail: string | null;
}

/**
 * Renders one Engagement Report as a PDF, returned as an in-memory
 * `Buffer` (the Route Handler streams this to the response — see
 * app/.../reports/route.ts). Takes only already-authorized,
 * already-loaded data (`EngagementReportData` — lib/domain/reports.ts):
 * this module performs no database access, no authorization check, and
 * no I/O of its own — a pure function from data to bytes, so it can be
 * unit-tested (tests/app/engagement-report.test.ts) without a database
 * connection at all.
 */
export function renderEngagementReportPdf(
  data: EngagementReportData,
  meta: EngagementReportRenderMeta,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // --- footer, drawn on every page ------------------------------------
    function drawFooter() {
      // Real bug this slice's own manual PDF inspection (instructions
      // §36) found: a y position at or beyond `doc.page.height -
      // PAGE_MARGIN` (pdfkit's own bottom-margin boundary) is treated
      // as page overflow — pdfkit silently starts a NEW page and draws
      // the footer at ITS top instead, leaving a spurious near-blank
      // page after every section. `-14` keeps the footer's baseline
      // safely inside the printable area, just above the margin line,
      // while still reading as a bottom-of-page footer.
      const bottom = doc.page.height - PAGE_MARGIN - 14;
      doc
        .fontSize(8)
        .fillColor(COLOR_MUTED)
        .text(`PRIMUS PRIVACY — Confidential — ${data.engagement.name}`, PAGE_MARGIN, bottom, {
          width: doc.page.width - PAGE_MARGIN * 2,
          align: "left",
          lineBreak: false,
        });
    }

    function newPage() {
      doc.addPage();
    }

    function sectionHeading(title: string) {
      doc
        .fontSize(15)
        .fillColor(COLOR_HEADING)
        .font("Helvetica-Bold")
        .text(title, { align: "left" });
      doc
        .moveDown(0.2)
        .strokeColor(COLOR_ACCENT)
        .lineWidth(1.5)
        .moveTo(doc.x, doc.y)
        .lineTo(doc.page.width - PAGE_MARGIN, doc.y)
        .stroke();
      doc.moveDown(0.8);
      doc.font("Helvetica").fillColor(COLOR_BODY).fontSize(10);
    }

    function subHeading(title: string) {
      doc.moveDown(0.6);
      doc.fontSize(11).fillColor(COLOR_HEADING).font("Helvetica-Bold").text(title);
      doc.moveDown(0.2);
      doc.font("Helvetica").fillColor(COLOR_BODY).fontSize(10);
    }

    function kv(label: string, value: string) {
      doc.font("Helvetica-Bold").fillColor(COLOR_MUTED).fontSize(9).text(label, { continued: true });
      doc.font("Helvetica").fillColor(COLOR_BODY).fontSize(10).text(`  ${value}`);
    }

    function bodyText(text: string) {
      doc.font("Helvetica").fillColor(COLOR_BODY).fontSize(10).text(text);
    }

    function emptyNote(text: string) {
      doc.font("Helvetica-Oblique").fillColor(COLOR_MUTED).fontSize(9.5).text(text);
      doc.font("Helvetica").fillColor(COLOR_BODY).fontSize(10);
    }

    /** A minimal, hand-rolled table — no charting/table library
     * (instructions §17's "no framework bloat"): a header row plus one
     * row per record, columns positioned by explicit width fractions of
     * the printable page width. Rows wrap onto a new page automatically
     * (pdfkit's own flowing-text behaviour) once `doc.y` nears the
     * bottom margin — checked explicitly here since a manual multi-
     * column layout does not auto-paginate the way single-column
     * `doc.text()` does. */
    function table(headers: string[], widths: number[], rows: string[][]) {
      const startX = PAGE_MARGIN;
      const usableWidth = doc.page.width - PAGE_MARGIN * 2;
      const colWidths = widths.map((w) => w * usableWidth);

      function drawRow(cells: string[], opts: { bold?: boolean; fill?: boolean } = {}) {
        const rowTop = doc.y;
        if (opts.fill) {
          doc.rect(startX, rowTop - 2, usableWidth, 16).fill("#f1f5f9");
        }
        doc.fillColor(opts.bold ? COLOR_HEADING : COLOR_BODY).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
        let x = startX;
        const heights: number[] = [];
        for (let i = 0; i < cells.length; i++) {
          doc.text(cells[i] ?? "", x + 2, rowTop, { width: colWidths[i]! - 4 });
          heights.push(doc.y - rowTop);
          x += colWidths[i]!;
        }
        const rowHeight = Math.max(...heights, 14);
        doc.y = rowTop + rowHeight + 4;
      }

      if (doc.y > doc.page.height - PAGE_MARGIN - 60) newPage();
      drawRow(headers, { bold: true, fill: true });
      doc
        .strokeColor(COLOR_RULE)
        .lineWidth(0.5)
        .moveTo(startX, doc.y - 2)
        .lineTo(startX + usableWidth, doc.y - 2)
        .stroke();

      for (const row of rows) {
        if (doc.y > doc.page.height - PAGE_MARGIN - 40) {
          newPage();
          drawRow(headers, { bold: true, fill: true });
          doc
            .strokeColor(COLOR_RULE)
            .lineWidth(0.5)
            .moveTo(startX, doc.y - 2)
            .lineTo(startX + usableWidth, doc.y - 2)
            .stroke();
        }
        drawRow(row);
      }
    }

    // === Cover page ========================================================
    doc.moveDown(6);
    doc.fontSize(11).fillColor(COLOR_ACCENT).font("Helvetica-Bold").text("PRIMUS PRIVACY", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor(COLOR_MUTED).font("Helvetica").text("DPDP Advisory & Continuous Compliance", { align: "center" });
    doc.moveDown(3);
    doc.fontSize(24).fillColor(COLOR_HEADING).font("Helvetica-Bold").text("Engagement Report", { align: "center" });
    doc.moveDown(1);
    doc.fontSize(16).fillColor(COLOR_BODY).font("Helvetica").text(data.engagement.name, { align: "center" });
    doc.fontSize(11).fillColor(COLOR_MUTED).text(data.engagement.organisationName, { align: "center" });
    doc.moveDown(2);
    doc
      .fontSize(9)
      .fillColor(COLOR_MUTED)
      .text(`Generated ${formatDateTime(data.generatedAt)}${meta.generatedByEmail ? ` by ${meta.generatedByEmail}` : ""}`, {
        align: "center",
      });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor(COLOR_MUTED)
      .text(
        `Reports on Assessment: ${raw(data.selectedAssessment.assessmentType)} — ${raw(data.selectedAssessment.periodLabel)} (${raw(data.selectedAssessment.status)})`,
        { align: "center" },
      );
    doc.moveDown(3);
    doc
      .fontSize(8.5)
      .fillColor(COLOR_MUTED)
      .text(
        "Confidential. Generated from live system data as of the timestamp above; re-generating this report later may reflect changes made since. This is a point-in-time artifact, not a frozen historical record in its own right.",
        { align: "center", width: doc.page.width - PAGE_MARGIN * 4, indent: PAGE_MARGIN },
      );
    drawFooter();

    // === Executive Summary ================================================
    newPage();
    sectionHeading("Executive Summary");
    bodyText(
      "This section is a deterministic tally of the current governance-loop state for this Engagement's most recent Assessment. It is generated directly from stored records — no narrative or interpretation has been added or inferred.",
    );
    doc.moveDown(0.6);

    const controlTotal = data.selectedAssessment.progress.total;
    const controlCompleted = data.selectedAssessment.progress.completed;
    const ratingCounts: Record<string, number> = {};
    for (const row of data.selectedAssessment.controlRows) {
      const key = row.response?.effectivenessRating ?? "not_recorded";
      ratingCounts[key] = (ratingCounts[key] ?? 0) + 1;
    }
    const riskCounts: Record<string, number> = {};
    for (const r of data.risks) riskCounts[r.status] = (riskCounts[r.status] ?? 0) + 1;
    const findingCounts: Record<string, number> = {};
    for (const f of data.findings) findingCounts[f.status] = (findingCounts[f.status] ?? 0) + 1;
    const remediationCounts: Record<string, number> = {};
    for (const r of data.remediationActions) remediationCounts[r.status] = (remediationCounts[r.status] ?? 0) + 1;
    const validationOutcomeCounts: Record<string, number> = {};
    for (const v of data.validationRecords) validationOutcomeCounts[v.outcome] = (validationOutcomeCounts[v.outcome] ?? 0) + 1;

    subHeading("Assessment Control Coverage");
    kv("Controls responded:", `${controlCompleted} / ${controlTotal}`);
    for (const [rating, count] of Object.entries(ratingCounts)) {
      kv(`  ${raw(rating)}:`, String(count));
    }

    subHeading("Risk Register");
    kv("Total risks recorded:", String(data.risks.length));
    for (const [status, count] of Object.entries(riskCounts)) {
      kv(`  ${raw(status)}:`, String(count));
    }

    subHeading("Findings");
    kv("Total findings recorded:", String(data.findings.length));
    for (const [status, count] of Object.entries(findingCounts)) {
      kv(`  ${raw(status)}:`, String(count));
    }

    subHeading("Remediation Actions");
    kv("Total remediation actions recorded:", String(data.remediationActions.length));
    for (const [status, count] of Object.entries(remediationCounts)) {
      kv(`  ${raw(status)}:`, String(count));
    }

    subHeading("Validation");
    kv("Total validation records recorded:", String(data.validationRecords.length));
    for (const [outcome, count] of Object.entries(validationOutcomeCounts)) {
      kv(`  ${raw(outcome)}:`, String(count));
    }

    subHeading("Evidence");
    kv("Total evidence items recorded:", String(data.evidenceItems.length));

    drawFooter();

    // === Engagement Overview ==============================================
    newPage();
    sectionHeading("Engagement Overview");
    kv("Engagement:", data.engagement.name);
    kv("Organisation:", data.engagement.organisationName);
    kv("Engagement type:", raw(data.engagement.engagementType));
    kv("Status:", raw(data.engagement.status));
    kv("Period:", `${formatDate(data.engagement.periodStart)} – ${formatDate(data.engagement.periodEnd)}`);
    kv("Control library:", data.engagement.controlLibraryVersionLabel ?? "not pinned");
    drawFooter();

    // === Assessment Results ================================================
    newPage();
    sectionHeading("Assessment Results");
    bodyText(
      "This report reflects the Engagement's most recently created Assessment, selected automatically (most recent by creation date). No other Assessment on this Engagement is included.",
    );
    doc.moveDown(0.4);
    kv("Assessment ID:", data.selectedAssessment.id);
    kv("Assessment type:", raw(data.selectedAssessment.assessmentType));
    kv("Period:", raw(data.selectedAssessment.periodLabel));
    kv("Status:", raw(data.selectedAssessment.status));
    kv("Control library version:", data.selectedAssessment.controlLibraryVersionLabel ?? "—");
    kv("Progress:", `${controlCompleted} / ${controlTotal} controls responded`);
    kv("Last updated:", formatDateTime(data.selectedAssessment.lastUpdatedAt));
    doc.moveDown(0.6);

    if (data.selectedAssessment.controlRows.length === 0) {
      emptyNote("No controls are populated on this Assessment.");
    } else {
      table(
        ["Control", "Type", "Effectiveness", "Rationale", "Respondent"],
        [0.18, 0.13, 0.16, 0.35, 0.18],
        data.selectedAssessment.controlRows.map((c) => [
          `${c.controlCode} — ${c.controlTitle}`,
          raw(c.controlType),
          c.response ? raw(c.response.effectivenessRating) : "not responded",
          c.response?.decisionRationale ?? "—",
          c.response?.respondentEmail ?? "—",
        ]),
      );
    }
    drawFooter();

    // === Risk Register ======================================================
    newPage();
    sectionHeading("Risk Register");
    if (data.risks.length === 0) {
      emptyNote("No risks have been recorded for this Engagement.");
    } else {
      table(
        ["Risk", "Source Control", "Inherent", "Residual", "Status", "Owner"],
        [0.28, 0.18, 0.11, 0.11, 0.12, 0.2],
        data.risks.map((r) => [
          r.title,
          r.sourceControlCode ? `${r.sourceControlCode} — ${r.sourceControlTitle ?? ""}` : "—",
          raw(r.inherentRating),
          raw(r.residualRating),
          raw(r.status),
          r.ownerEmail ?? "—",
        ]),
      );
    }
    drawFooter();

    // === Findings ===========================================================
    newPage();
    sectionHeading("Findings");
    if (data.findings.length === 0) {
      emptyNote("No findings have been recorded for this Engagement.");
    } else {
      table(
        ["Finding", "Source Risk", "Severity", "Status", "Owner"],
        [0.32, 0.24, 0.14, 0.14, 0.16],
        data.findings.map((f) => [f.title, f.sourceRiskTitle ?? "—", raw(f.severity), raw(f.status), f.ownerEmail ?? "—"]),
      );
    }
    drawFooter();

    // === Remediation ========================================================
    newPage();
    sectionHeading("Remediation");
    if (data.remediationActions.length === 0) {
      emptyNote("No remediation actions have been recorded for this Engagement.");
    } else {
      table(
        ["Remediation Action", "Source Finding", "Priority", "Status", "Due", "Owner"],
        [0.26, 0.2, 0.11, 0.14, 0.11, 0.18],
        data.remediationActions.map((r) => [
          r.title,
          r.sourceFindingTitle ?? "—",
          raw(r.priority),
          raw(r.status),
          formatDate(r.dueDate),
          r.ownerEmail ?? "—",
        ]),
      );
    }
    drawFooter();

    // === Validation ==========================================================
    newPage();
    sectionHeading("Validation");
    if (data.validationRecords.length === 0) {
      emptyNote("No validation records have been recorded for this Engagement.");
    } else {
      table(
        ["Remediation Action", "Outcome", "Validated By", "Validated At", "Rationale"],
        [0.24, 0.13, 0.2, 0.16, 0.27],
        data.validationRecords.map((v) => [
          v.remediationActionTitle,
          raw(v.outcome),
          v.validatedByEmail ?? "—",
          formatDate(v.validatedAt),
          v.rationale ?? "—",
        ]),
      );
    }
    drawFooter();

    // === Evidence Summary ====================================================
    newPage();
    sectionHeading("Evidence Summary");
    bodyText("Metadata only — no file contents are embedded in this report and no signed download links are included.");
    doc.moveDown(0.4);
    if (data.evidenceItems.length === 0) {
      emptyNote("No evidence has been recorded for this Engagement.");
    } else {
      table(
        ["Title", "Type", "Review Status", "Quality", "Collected", "File"],
        [0.26, 0.14, 0.16, 0.12, 0.12, 0.2],
        data.evidenceItems.map((e) => [
          e.title,
          raw(e.evidenceType),
          raw(e.reviewStatus),
          raw(e.qualityRating),
          formatDate(e.collectedAt),
          e.originalFilename,
        ]),
      );
    }
    drawFooter();

    // === Appendix ============================================================
    newPage();
    sectionHeading("Appendix");
    subHeading("About this report");
    bodyText(
      "This report was generated by PRIMUS PRIVACY directly from the Engagement's live governance-loop data (Assessment, Risk, Finding, Remediation, Validation, and Evidence records) at the time shown on the cover page. It is not an AI-generated narrative — every figure above is a direct count or field value read from the system of record.",
    );
    doc.moveDown(0.5);
    subHeading("Scope note");
    bodyText(
      "This report covers this Engagement's most recently created Assessment only. An Engagement with more than one Assessment (for example, successive annual cycles) will show only the latest one here.",
    );
    doc.moveDown(0.5);
    subHeading("Report metadata");
    kv("Generated at:", formatDateTime(data.generatedAt));
    kv("Generated by:", meta.generatedByEmail ?? "—");
    kv("Selected Assessment ID:", data.selectedAssessment.id);
    drawFooter();

    doc.end();
  });
}
