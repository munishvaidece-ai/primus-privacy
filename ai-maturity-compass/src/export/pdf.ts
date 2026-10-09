/**
 * Client-side PDF report. Built with jsPDF + jspdf-autotable; charts are drawn as vector
 * primitives, so no screenshots, no network calls, and the output is crisp and searchable.
 * Every figure comes from AssessmentResults (the same object the dashboards use).
 */
import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import { DIMENSION_BY_ID, DIMENSIONS, RISK_COMPONENTS, VALUE_COMPONENTS, CLASSIFICATIONS, ROI_BANDS } from '../data/spec';
import { INDIA_DIAGNOSTICS, INDIA_DISCLAIMER } from '../data/india';
import { EVIDENCE_STATUS_LABELS, type Assessment } from '../domain/schema';
import { CONFIDENCE_LABELS } from '../scoring/coverage';
import { formatInr, formatIndicatorValue } from '../scoring/indicators';
import { BUCKET_LABELS, PRIORITY_LABELS, STATUS_LABELS, ADVISORY_NOTICE } from '../scoring/recommendations';
import type { AssessmentResults } from '../scoring/results';
import { LIMITATIONS, METHODOLOGY, executiveSummary, fmt1, pctText, profileRows } from './narrative';

// Palette (matches the app). RGB tuples.
const NAVY: [number, number, number] = [11, 31, 58];
const TEAL: [number, number, number] = [14, 124, 134];
const BLUE: [number, number, number] = [42, 120, 214];
const ORANGE: [number, number, number] = [235, 104, 52];
const GREY: [number, number, number] = [96, 108, 124];
const LIGHT: [number, number, number] = [243, 246, 249];
const RULE: [number, number, number] = [214, 220, 228];
const RED: [number, number, number] = [208, 59, 59];
const AMBER: [number, number, number] = [176, 112, 0];

const CP1252_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);

/** jsPDF's built-in fonts cover Latin-1/WinAnsi only; map or replace anything else. */
export function pdfSafe(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  const s = String(input)
    .replace(/₹\s?/g, 'INR ')
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/←/g, '<-').replace(/≈/g, '~')
    .replace(/−/g, '-').replace(/Σ/g, 'Sum').replace(/[‐‑‒]/g, '-').replace(/ /g, ' ').replace(/ /g, ' ')
    .replace(/✓/g, 'Yes').replace(/✗/g, 'No');
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c <= 0xff || CP1252_EXTRA.has(c) ? ch : '?';
  }
  return out;
}

const M = 16; // margin (mm)
const PW = 210;
const PH = 297;
const CW = PW - M * 2;

export interface PdfOptions {
  generatedAt?: Date;
  preparedBy?: string;
  /** Compress streams (default true). Tests disable it to inspect text content. */
  compress?: boolean;
}

class Writer {
  y = M;
  constructor(public doc: jsPDF) {}
  ensure(h: number) {
    if (this.y + h > PH - 20) this.page();
  }
  page() {
    this.doc.addPage();
    this.y = M + 6;
  }
  font(size: number, style: 'normal' | 'bold' | 'italic' = 'normal', color: [number, number, number] = NAVY) {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }
  h1(text: string) {
    if (this.y > M + 12) this.y += 3;
    this.ensure(18);
    this.font(15, 'bold', NAVY);
    this.doc.text(pdfSafe(text), M, this.y);
    this.doc.setDrawColor(...TEAL);
    this.doc.setLineWidth(0.6);
    this.doc.line(M, this.y + 2, M + 24, this.y + 2);
    this.y += 9;
  }
  h2(text: string) {
    this.ensure(12);
    this.font(10.5, 'bold', TEAL);
    this.doc.text(pdfSafe(text), M, this.y);
    this.y += 5.5;
  }
  para(text: string, opts?: { size?: number; color?: [number, number, number]; style?: 'normal' | 'bold' | 'italic'; gap?: number; indent?: number; width?: number }) {
    const size = opts?.size ?? 9;
    this.font(size, opts?.style ?? 'normal', opts?.color ?? NAVY);
    const w = (opts?.width ?? CW) - (opts?.indent ?? 0);
    const lines = this.doc.splitTextToSize(pdfSafe(text), w) as string[];
    const lh = size * 0.4 + 1;
    for (const line of lines) {
      this.ensure(lh + 1);
      this.doc.text(line, M + (opts?.indent ?? 0), this.y);
      this.y += lh;
    }
    this.y += opts?.gap ?? 2;
  }
  bullets(items: string[], opts?: { size?: number }) {
    const size = opts?.size ?? 9;
    for (const it of items) {
      this.font(size, 'normal', NAVY);
      const lines = this.doc.splitTextToSize(pdfSafe(it), CW - 5) as string[];
      const lh = size * 0.4 + 1;
      lines.forEach((line, i) => {
        this.ensure(lh + 1);
        if (i === 0) {
          this.doc.setFillColor(...TEAL);
          this.doc.circle(M + 1.2, this.y - 1, 0.6, 'F');
        }
        this.doc.text(line, M + 4.5, this.y);
        this.y += lh;
      });
      this.y += 0.8;
    }
    this.y += 1.5;
  }
  table(head: string[], body: RowInput[], opts?: { widths?: number[]; fontSize?: number; headFill?: [number, number, number]; rowColors?: (row: number) => [number, number, number] | null }) {
    this.ensure(14);
    autoTable(this.doc, {
      startY: this.y,
      head: [head.map(pdfSafe)],
      body: body.map((r) => (r as unknown[]).map((c) => (typeof c === 'string' || typeof c === 'number' ? pdfSafe(c) : c))) as RowInput[],
      margin: { left: M, right: M, top: M + 6, bottom: 20 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: opts?.fontSize ?? 8, cellPadding: 1.6, textColor: NAVY, lineColor: RULE, lineWidth: 0.15, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: opts?.headFill ?? NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: opts?.fontSize ?? 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: opts?.widths ? Object.fromEntries(opts.widths.map((w, i) => [i, { cellWidth: w }])) : undefined,
    });
    this.y = (this.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  }
}

function tile(doc: jsPDF, x: number, y: number, w: number, h: number, title: string, value: string, sub: string, color: [number, number, number], fraction: number | null) {
  doc.setFillColor(...LIGHT);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  doc.text(pdfSafe(title).toUpperCase(), x + 3, y + 5.5, { maxWidth: w - 6 });
  doc.setFontSize(22);
  doc.setTextColor(...NAVY);
  doc.text(pdfSafe(value), x + 3, y + 16);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...color);
  const lines = doc.splitTextToSize(pdfSafe(sub), w - 6) as string[];
  doc.text(lines.slice(0, 3), x + 3, y + 21);
  // progress bar
  doc.setFillColor(...RULE);
  doc.rect(x + 3, y + h - 5, w - 6, 1.6, 'F');
  if (fraction !== null) {
    doc.setFillColor(...color);
    doc.rect(x + 3, y + h - 5, (w - 6) * Math.max(0, Math.min(1, fraction)), 1.6, 'F');
  }
}

function radar(doc: jsPDF, cx: number, cy: number, R: number, labels: string[], series: { values: (number | null)[]; color: [number, number, number]; dashed?: boolean }[]) {
  const n = labels.length;
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i: number, r: number): [number, number] => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.15);
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const pts = Array.from({ length: n }, (_, i) => pt(i, R * frac));
    for (let i = 0; i < n; i++) doc.line(pts[i][0], pts[i][1], pts[(i + 1) % n][0], pts[(i + 1) % n][1]);
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, R);
    doc.line(cx, cy, x, y);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...GREY);
  [25, 50, 75, 100].forEach((v) => doc.text(String(v), cx + 1, cy - (R * v) / 100 + 2));
  doc.setFontSize(7);
  doc.setTextColor(...NAVY);
  labels.forEach((l, i) => {
    const [x, y] = pt(i, R + 4.5);
    const c = Math.cos(ang(i));
    const align = Math.abs(c) < 0.2 ? 'center' : c > 0 ? 'left' : 'right';
    doc.text(pdfSafe(l), x, y + 1, { align });
  });
  for (const s of series) {
    const pts = s.values.map((v, i) => pt(i, (R * (v ?? 0)) / 100));
    const rel: number[][] = [];
    for (let i = 1; i < pts.length; i++) rel.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
    rel.push([pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]]);
    doc.setLineWidth(0.7);
    doc.setDrawColor(...s.color);
    doc.setFillColor(...s.color);
    doc.saveGraphicsState();
    doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => object }).GState({ opacity: s.dashed ? 0.04 : 0.16 }));
    doc.lines(rel, pts[0][0], pts[0][1], [1, 1], 'F', true);
    doc.restoreGraphicsState();
    if (s.dashed) doc.setLineDashPattern([1.4, 1], 0);
    doc.lines(rel, pts[0][0], pts[0][1], [1, 1], 'S', true);
    doc.setLineDashPattern([], 0);
  }
}

function hbars(doc: jsPDF, x: number, y: number, w: number, rows: { label: string; verified: number | null; self: number | null; suffix?: string }[]) {
  const labelW = 30;
  const barW = w - labelW - 14;
  const rowH = 7.4;
  doc.setFontSize(7);
  rows.forEach((r, i) => {
    const yy = y + i * rowH;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...NAVY);
    doc.text(pdfSafe(r.label), x, yy + 3.4);
    doc.setFillColor(...LIGHT);
    doc.rect(x + labelW, yy, barW, 5.6, 'F');
    if (r.verified !== null) {
      doc.setFillColor(...BLUE);
      doc.rect(x + labelW, yy, (barW * r.verified) / 100, 2.7, 'F');
    }
    if (r.self !== null) {
      doc.setFillColor(...ORANGE);
      doc.rect(x + labelW, yy + 2.9, (barW * r.self) / 100, 2.7, 'F');
    }
    doc.setTextColor(...GREY);
    doc.text(r.verified === null ? 'unscored' : r.verified.toFixed(1), x + labelW + barW + 2, yy + 3.4);
  });
  return rows.length * rowH;
}

export function buildReportPdf(a: Assessment, res: AssessmentResults, opts: PdfOptions = {}): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: opts.compress ?? true });
  const w = new Writer(doc);
  const when = opts.generatedAt ?? new Date();
  const org = a.profile.organizationName || a.name;
  doc.setProperties({
    title: pdfSafe(`AI Maturity Assessment Report — ${org}`),
    subject: 'AI Maturity Compass — Assessment, Governance & Value Realization',
    author: 'Primus Partners — AI Maturity Compass',
    creator: 'AI Maturity Compass',
  });

  // ---------------------------------------------------------------- Cover
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PW, 118, 'F');
  doc.setFillColor(...TEAL);
  doc.rect(0, 118, PW, 2.2, 'F');
  w.font(9, 'bold', [160, 220, 224]);
  doc.text('PRIMUS PARTNERS  |  AI MATURITY COMPASS', M, 28);
  w.font(30, 'bold', [255, 255, 255]);
  doc.text('AI Maturity Assessment', M, 56);
  doc.text('Report', M, 69);
  w.font(13, 'normal', [220, 232, 242]);
  const orgLines = doc.splitTextToSize(pdfSafe(org), CW) as string[];
  doc.text(orgLines.slice(0, 2), M, 86);
  w.font(10, 'normal', [170, 190, 210]);
  doc.text(pdfSafe(`${a.name}`), M, 86 + orgLines.slice(0, 2).length * 6 + 3, { maxWidth: CW });
  const period = a.profile.periodLabel || (a.profile.periodStart ? `${a.profile.periodStart} to ${a.profile.periodEnd}` : 'Period not specified');
  doc.text(pdfSafe(`Assessment period: ${period}`), M, 106);

  w.y = 134;
  w.font(9, 'bold', GREY);
  doc.text('HEADLINE RESULTS', M, w.y);
  w.y += 4;
  const tw = (CW - 8) / 3;
  const m = res.maturity;
  tile(doc, M, w.y, tw, 36, 'AI Maturity Index', m.index === null ? 'n/a' : fmt1(m.index), m.index === null ? 'No verified scores yet' : `${(res.gates.finalClassification ?? m.classification)!.label}${m.status !== 'definitive' ? ' - provisional' : ''}`, TEAL, m.index === null ? null : m.index / 100);
  tile(doc, M + tw + 4, w.y, tw, 36, 'Risk & Governance Control Maturity', res.risk.score === null ? 'n/a' : fmt1(res.risk.score), 'Higher = stronger controls' + (res.risk.status === 'provisional' ? ' - provisional' : ''), BLUE, res.risk.score === null ? null : res.risk.score / 100);
  tile(doc, M + (tw + 4) * 2, w.y, tw, 36, 'AI Value Realization', res.value.score === null ? 'n/a' : fmt1(res.value.score), res.value.score === null ? 'No value evidence yet' : `${res.value.components.filter((c) => c.status !== 'unscored').length} of 6 components scored${res.value.status === 'provisional' ? ' - provisional' : ''}`, [26, 140, 100], res.value.score === null ? null : res.value.score / 100);
  w.y += 46;

  w.font(8.5, 'normal', GREY);
  const meta = [
    `Assessment status: ${a.status === 'submitted' ? 'Submitted' : a.status === 'draft' ? 'Draft' : 'In progress'}`,
    `Verified coverage: ${pctText(m.questionCoverage)} of applicable questions; ${res.coverage.sufficientDimensions} of 12 dimensions with sufficient coverage`,
    `Report generated: ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  ];
  meta.forEach((t, i) => doc.text(pdfSafe(t), M, w.y + i * 5));
  w.y += 22;

  if (a.isDemo) {
    doc.setFillColor(255, 244, 214);
    doc.setDrawColor(230, 190, 90);
    doc.roundedRect(M, w.y, CW, 18, 2, 2, 'FD');
    w.font(9, 'bold', AMBER);
    doc.text('ILLUSTRATIVE DEMONSTRATION - SYNTHETIC DATA', M + 4, w.y + 6.5);
    w.font(8, 'normal', NAVY);
    doc.text(doc.splitTextToSize('This report was generated from a fictional organization and synthetic responses. It is not a client finding and not a validated benchmark.', CW - 8) as string[], M + 4, w.y + 11);
    w.y += 24;
  }
  w.font(8, 'italic', GREY);
  doc.text(doc.splitTextToSize('Confidential - prepared for discussion with the assessed organization. Scores are advisory assessment outputs; recommendations require consulting judgement and client validation.', CW) as string[], M, PH - 24);
  doc.addPage();
  w.y = M + 6;

  // ---------------------------------------------------------------- Profile
  w.h1('1. Organization profile');
  w.table(['Attribute', 'Detail'], profileRows(a), { widths: [48, CW - 48] });

  // ---------------------------------------------------------------- Period & methodology
  w.h1('2. Assessment period and methodology');
  w.para(`Assessment period: ${period}. Status: ${a.status === 'submitted' ? 'submitted' : a.status === 'draft' ? 'draft' : 'in progress'}. Source: AI readiness assessment document (100 questions, 12 dimensions).`, { gap: 3 });
  w.bullets(METHODOLOGY, { size: 8.5 });

  // ---------------------------------------------------------------- Executive summary
  w.h1('3. Executive summary');
  for (const p of executiveSummary(a, res)) w.para(p, { gap: 2.5 });

  w.h2('Three principal scores');
  w.table(
    ['Score', 'Assessor-verified', 'Self-reported', 'Basis and coverage'],
    [
      ['AI Maturity Index (0-100)', m.index === null ? 'n/a' : `${fmt1(m.index)}  ${(m.classification!).label}`, res.maturitySelf.index === null ? 'n/a' : `${fmt1(res.maturitySelf.index)}  ${res.maturitySelf.classification!.label}`, `${m.status}; ${pctText(m.questionCoverage)} question coverage; ${pctText(m.weightCoverage)} of weight scored`],
      ['AI Risk & Governance Control Maturity (0-100; higher = stronger controls)', fmt1(res.risk.score), fmt1(res.riskSelf.score), `${res.risk.status}; ${pctText(res.risk.questionCoverage)} question coverage; ${pctText(res.risk.weightCoverage)} of weight scored`],
      ['AI Value Realization Score (0-100)', fmt1(res.value.score), fmt1(res.valueSelf.score), `${res.value.status}; ${pctText(res.value.weightCoverage)} of weight scored`],
    ],
    { widths: [58, 32, 32, CW - 122] },
  );
  w.h2('Overall maturity classification and coverage caveats');
  w.para(
    m.classification
      ? `Index classification: ${m.classification.label} (${m.classification.description}).${res.gates.finalClassification && res.gates.finalClassification.id !== m.classification.id ? ` Reported classification after confirmed gate: ${res.gates.finalClassification.label}.` : ''}`
      : 'No classification can be given without verified scores.',
    { gap: 1.5 },
  );
  const caveats = [...m.caveats, ...res.risk.caveats, ...res.value.caveats, ...res.indicators.periodWarnings];
  if (caveats.length === 0) w.para('No coverage caveats: every dimension, risk component and value component is scored with sufficient coverage.', { color: GREY });
  else w.bullets(caveats, { size: 8.5 });

  // ---------------------------------------------------------------- Scorecard
  w.h1('4. Twelve-dimension scorecard');
  w.table(
    ['#', 'Dimension', 'Weight', 'Verified (0-100)', 'Self (0-100)', 'Diff.', 'Coverage', 'Points', 'Status'],
    m.dimensions.map((d, i) => {
      const s = res.maturitySelf.dimensions[i];
      return [
        DIMENSIONS[i].number, d.name, `${d.weight}%`, d.normalized === null ? 'unscored' : fmt1(d.normalized), s.normalized === null ? '-' : fmt1(s.normalized),
        d.normalized !== null && s.normalized !== null ? (s.normalized - d.normalized >= 0 ? '+' : '') + (s.normalized - d.normalized).toFixed(1) : '-',
        pctText(d.coverage), d.contribution === null ? '-' : d.contribution.toFixed(2),
        d.status === 'unscored' ? (d.unscoredReason === 'all_not_applicable' ? 'Unscored (all N/A)' : 'Unscored') : d.status === 'partial' ? 'Limited coverage' : 'Scored',
      ];
    }),
    { widths: [8, 56, 14, 20, 17, 12, 17, 14, CW - 158], fontSize: 7.5 },
  );

  // Radar + bars
  w.ensure(100);
  w.h2('Radar: self-reported versus assessor-verified');
  const cy = w.y + 40;
  radar(
    doc, PW / 2, cy, 31,
    m.dimensions.map((d) => (d.normalized === null ? `${d.shortName} (n/s)` : d.shortName)),
    [
      { values: m.dimensions.map((d) => d.normalized), color: BLUE },
      { values: res.maturitySelf.dimensions.map((d) => d.normalized), color: ORANGE, dashed: true },
    ],
  );
  w.y = cy + 44;
  doc.setFillColor(...BLUE); doc.rect(M + 60, w.y - 3, 4, 2.4, 'F');
  w.font(7.5, 'normal', NAVY); doc.text('Assessor-verified', M + 66, w.y - 1);
  doc.setFillColor(...ORANGE); doc.rect(M + 100, w.y - 3, 4, 2.4, 'F');
  doc.text('Self-reported (unscored dimensions plotted at centre, marked n/s)', M + 106, w.y - 1);
  w.y += 5;

  w.ensure(104);
  w.h2('Dimension comparison (0-100)');
  const bh = hbars(doc, M, w.y, CW, m.dimensions.map((d, i) => ({ label: d.shortName, verified: d.normalized, self: res.maturitySelf.dimensions[i].normalized })));
  w.y += bh + 3;
  doc.setFillColor(...BLUE); doc.rect(M + 30, w.y - 1, 4, 2.4, 'F');
  w.font(7.5, 'normal', NAVY); doc.text('Assessor-verified (upper bar)', M + 36, w.y + 1);
  doc.setFillColor(...ORANGE); doc.rect(M + 84, w.y - 1, 4, 2.4, 'F');
  doc.text('Self-reported (lower bar)', M + 90, w.y + 1);
  w.y += 8;

  // ---------------------------------------------------------------- Risk & governance
  w.h1('5. Risk & governance and critical control deficiencies');
  w.para('Direction: a higher AI Risk & Governance Control Maturity score means stronger assessed controls. It is not a risk level.', { color: GREY, style: 'italic' });
  w.table(
    ['Component', 'Source questions', 'Weight', 'Verified (0-100)', 'Self (0-100)', 'Coverage', 'Not verified / awaiting'],
    res.risk.components.map((c, i) => [c.name, RISK_COMPONENTS[i].sourceLabel, `${c.weight}%`, c.normalized === null ? 'unscored' : fmt1(c.normalized), fmt1(res.riskSelf.components[i].normalized), pctText(c.coverage), c.unverifiedIds.join(' ') || '-']),
    { widths: [50, 34, 13, 20, 17, 16, CW - 150], fontSize: 7.5 },
  );
  const g = res.gates;
  w.h2('Risk-based maturity gate (advisory)');
  for (const t of g.explanation) w.para(t, { gap: 1.5, color: g.triggered ? RED : NAVY });
  if (g.deficiencies.length > 0) {
    w.table(
      ['ID', 'Gate', 'Critical control', 'Verified', 'Self', 'Evidence status'],
      g.deficiencies.map((d) => [d.questionId, d.gateName, d.text, d.verifiedScore, d.selfScore === null ? '-' : d.selfScore, EVIDENCE_STATUS_LABELS[d.evidenceStatus]]),
      { widths: [12, 28, CW - 100, 14, 12, 34], fontSize: 7.5, headFill: RED },
    );
  } else {
    w.para('No critical control is verified as deficient.', { color: GREY });
  }
  if (g.unverified.length > 0) w.para(`Critical controls without an assessor-verified score: ${g.unverified.map((c) => c.questionId).join(', ')}.`, { size: 8.5 });

  // ---------------------------------------------------------------- Value
  w.h1('6. Value realization');
  w.table(
    ['Component', 'Weight', 'Verified (0-100)', 'Self (0-100)', 'Items scored', 'Status'],
    res.value.components.map((c, i) => [c.name, `${c.weight}%`, c.normalized === null ? 'unscored' : fmt1(c.normalized), fmt1(res.valueSelf.components[i].normalized), `${c.scoredItems} of ${c.applicableItems}`, c.status === 'unscored' ? 'Unscored' : c.status === 'partial' ? 'Partial' : 'Scored']),
    { widths: [66, 14, 24, 20, 24, CW - 148], fontSize: 7.5 },
  );
  const roi = res.indicators.roi;
  w.para(
    roi.totalCosts === null || roi.totalCosts <= 0
      ? 'AI ROI could not be calculated: total AI costs are missing or zero. The financial component is unscored (not zero).'
      : `AI ROI = ((Verified AI benefits - Total AI costs) / Total AI costs) x 100. Total AI costs ${formatInr(roi.totalCosts, { ascii: true })}; ${roi.verifiedBenefits === null ? 'verified benefits not yet recorded (claimed benefits ' + formatInr(roi.claimedBenefits, { ascii: true }) + ' are not treated as verified)' : `verified benefits ${formatInr(roi.verifiedBenefits, { ascii: true })}`}; verified ROI ${roi.roiVerified === null ? 'n/a' : roi.roiVerified.toFixed(1) + '%'}${roi.scoreVerified === null ? '' : ` (provisional band ${roi.scoreVerified} of 4)`}.`,
    { size: 8.5 },
  );
  w.para('ROI bands are provisional assessment thresholds from the source document, not established industry benchmarks: ' + ROI_BANDS.map((b) => `${b.score} = ${b.description}`).join('; ') + '.', { size: 7.5, color: GREY });

  // ---------------------------------------------------------------- Evidence
  w.h1('7. Evidence coverage and confidence');
  const c = res.coverage;
  w.table(
    ['Indicator', 'Count', 'Share of applicable'],
    [
      ['Questions in the diagnostic', c.totalQuestions, ''],
      ['Applicable questions (excludes Not Applicable)', c.applicable, ''],
      ['Not Applicable', c.notApplicable, ''],
      ['Self-reported answers (scored)', c.selfAnswered, pctText(c.selfAnswered / c.applicable)],
      ['Questions with an evidence reference entered (not verification)', c.withReference, pctText(c.withReference / c.applicable)],
      ['Evidence reviewed by an assessor (any outcome)', c.reviewed, pctText(c.reviewed / c.applicable)],
      ['Evidence accepted / verified by an assessor', c.accepted, pctText(c.acceptedShare)],
      ['Evidence rejected / clarification required', `${c.rejected} / ${c.clarification}`, ''],
      ['Assessor-verified scores', c.verifiedScored, pctText(c.verifiedScored / c.applicable)],
      ["Marked Don't Know / Not Verified (evidence gap)", c.dontKnowNotVerified, pctText(c.dontKnowNotVerified / c.applicable)],
      ['Awaiting assessment', c.awaitingAssessment, pctText(c.awaitingAssessment / c.applicable)],
      ['Dimensions with sufficient verified coverage', `${c.sufficientDimensions} of ${c.totalDimensions}`, ''],
      ['Verified scores backed by accepted evidence', c.verifiedWithAcceptedEvidence, pctText(c.evidenceBackedShare)],
      ['Overall evidence confidence (prototype heuristic)', CONFIDENCE_LABELS[c.confidence], ''],
    ],
    { widths: [CW - 56, 26, 30], fontSize: 8 },
  );

  // ---------------------------------------------------------------- Indicators
  w.h1('8. Quantitative indicators');
  w.table(
    ['Indicator', 'Result', 'Numerator / denominator', 'Period', 'Verified', 'Source'],
    res.indicators.results.map((r) => {
      const e = a.indicators[r.id];
      const isRoi = r.def.kind === 'roi';
      const nd = isRoi
        ? `${formatInr(roi.verifiedBenefits ?? roi.claimedBenefits, { ascii: true })} / ${formatInr(roi.totalCosts, { ascii: true })}`
        : e?.numerator === null || e?.numerator === undefined ? '-' : `${e.numerator.toLocaleString('en-IN')} ${r.def.numeratorUnit}${e.denominator === null ? '' : ` / ${e.denominator.toLocaleString('en-IN')} ${r.def.denominatorUnit ?? ''}`}`;
      return [r.def.name, r.status === 'ok' ? formatIndicatorValue(r) : r.status === 'invalid' ? 'Invalid input' : 'Not captured', nd, r.periodStart ? `${r.periodStart} to ${r.periodEnd}` : '-', r.status === 'ok' ? (r.verified ? 'Yes' : 'No') : '-', isRoi ? a.roi.dataSource : e?.dataSource || '-'];
    }),
    { widths: [34, 22, 44, 30, 12, CW - 142], fontSize: 7 },
  );
  if (res.indicators.periodWarnings.length > 0) w.bullets(res.indicators.periodWarnings, { size: 8 });
  if (res.crossChecks.length > 0) {
    w.h2('Scores not corroborated by indicators (prompts for follow-up)');
    w.bullets(res.crossChecks.map((x) => x.message), { size: 8 });
  }
  w.para('Indicators should not be compared across organizations on raw spend or use-case counts without adjusting for scale, sector and AI opportunity.', { size: 7.5, color: GREY, style: 'italic' });

  // ---------------------------------------------------------------- India
  w.h1('9. India-specific diagnostic observations');
  w.para(INDIA_DISCLAIMER, { size: 8, color: AMBER, style: 'italic' });
  w.para(`Legal and regulatory position assessed as at: ${a.india.assessmentDate || 'not recorded'}. Supplementary India diagnostic index (verified): ${fmt1(res.india.verifiedIndex)}; self-reported: ${fmt1(res.india.selfIndex)}. This index is reported separately and is not part of the core 100-question index.`, { size: 8.5 });
  w.table(
    ['Area', 'Applicability', 'Self', 'Verified', 'Observation'],
    INDIA_DIAGNOSTICS.map((d) => {
      const it = a.india.items[d.id];
      return [d.area, it.applicability === 'applicable' ? 'Applicable' : it.applicability === 'not_applicable' ? 'Not applicable' : 'Not assessed', it.selfScore ?? '-', it.verifiedScore ?? '-', it.observations || '-'];
    }),
    { widths: [38, 24, 12, 14, CW - 88], fontSize: 7.5 },
  );

  // ---------------------------------------------------------------- Recommendations
  w.h1('10. Priority recommendations');
  w.para(ADVISORY_NOTICE, { size: 8, color: AMBER, style: 'italic' });
  const recs = res.recommendations.filter((r) => r.status !== 'dismissed').slice(0, 14);
  if (recs.length === 0) w.para('No recommendations were generated from the current data.', { color: GREY });
  recs.forEach((r, i) => {
    w.ensure(36);
    w.font(9.5, 'bold', r.priority === 'critical' ? RED : NAVY);
    const head = `${i + 1}. [${PRIORITY_LABELS[r.priority]}] ${r.title}`;
    const hl = doc.splitTextToSize(pdfSafe(head), CW) as string[];
    hl.forEach((l) => { w.ensure(5); doc.text(l, M, w.y); w.y += 4.6; });
    w.para(`${r.dimensionId ? DIMENSION_BY_ID[r.dimensionId].name + ' | ' : ''}${r.questionIds.length ? 'Questions: ' + r.questionIds.join(', ') + ' | ' : ''}Accountable: ${r.owner || r.role} | ${r.timeframe} | Status: ${STATUS_LABELS[r.status]}`, { size: 7.5, color: GREY, gap: 1 });
    w.para(`Gap: ${r.gap}`, { size: 8, gap: 1 });
    w.para(`Why it matters: ${r.why}`, { size: 8, gap: 1 });
    w.para(`Suggested intervention: ${r.intervention}`, { size: 8, gap: 1 });
    w.para(`Target outcome / KPI: ${r.kpi}${r.dependencies ? `  Dependencies: ${r.dependencies}` : ''}${r.evidenceGaps.length ? `  Related evidence gaps: ${r.evidenceGaps.join(', ')}` : ''}`, { size: 8, gap: 3.5 });
  });

  // ---------------------------------------------------------------- Roadmap
  w.h1('11. Roadmap: 6, 12 and 24 months');
  (['m0_6', 'm6_12', 'm12_24'] as const).forEach((b) => {
    w.h2(BUCKET_LABELS[b]);
    const items = res.roadmap[b];
    if (items.length === 0) w.para('No initiatives in this window.', { size: 8.5, color: GREY });
    else w.table(['Priority', 'Initiative', 'Accountable', 'Status'], items.map((r) => [PRIORITY_LABELS[r.priority], r.title, r.owner || r.role, STATUS_LABELS[r.status]]), { widths: [20, CW - 100, 56, 24], fontSize: 7.5 });
  });
  w.para('Roadmap items are advisory and require consulting judgement and client validation.', { size: 7.5, color: GREY, style: 'italic' });

  // ---------------------------------------------------------------- Methodology & limitations
  w.h1('12. Scoring methodology and limitations');
  w.h2('Dimension weights');
  w.table(['Dimension', 'Questions', 'Weight'], DIMENSIONS.map((d) => [`${d.number}. ${d.name}`, d.questionCount, `${d.weight}%`]), { widths: [CW - 50, 25, 25], fontSize: 7.5 });
  w.h2('Maturity classification');
  w.table(['Band', 'Index range', 'Meaning'], CLASSIFICATIONS.map((x) => [x.label, x.rangeLabel, x.description]), { widths: [34, 40, CW - 74], fontSize: 7.5 });
  w.h2('Risk & governance and value composition');
  w.table(['Score', 'Component', 'Weight'], [
    ...RISK_COMPONENTS.map((x) => ['Risk & Governance', `${x.name} (${x.sourceLabel})`, `${x.weight}%`]),
    ...VALUE_COMPONENTS.map((x) => ['Value Realization', `${x.name}${x.mappingSource === 'prototype' ? ' (prototype question mapping)' : ''}`, `${x.weight}%`]),
  ], { widths: [36, CW - 56, 20], fontSize: 7.5 });
  w.h2('Limitations');
  w.bullets(LIMITATIONS, { size: 8.5 });

  // ---------------------------------------------------------------- Footers
  const pages = doc.getNumberOfPages();
  for (let i = 2; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(M, PH - 14, PW - M, PH - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(pdfSafe(`AI Maturity Compass  |  ${org}${a.isDemo ? '  |  ILLUSTRATIVE DEMONSTRATION - synthetic data' : ''}`), M, PH - 9.5);
    doc.text(`Page ${i} of ${pages}`, PW - M, PH - 9.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEAL);
    doc.text('PRIMUS PARTNERS', PW - M, M - 4, { align: 'right' });
  }
  return doc;
}

export function reportPdfBlob(a: Assessment, res: AssessmentResults, opts?: PdfOptions): Blob {
  return buildReportPdf(a, res, opts).output('blob');
}
