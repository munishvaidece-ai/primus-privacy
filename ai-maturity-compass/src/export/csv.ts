/**
 * CSV exports. Pure functions returning strings so they can be unit-tested and reused.
 * Text cells starting with =, +, - or @ are prefixed with an apostrophe so spreadsheet
 * applications do not evaluate user-entered text as a formula. Numbers are never altered.
 */
import { DIMENSIONS, QUESTIONS, SCALE_BY_SCORE, DIMENSION_BY_ID, CLASSIFICATIONS, RISK_COMPONENTS, VALUE_COMPONENTS } from '../data/spec';
import { INDIA_DIAGNOSTICS } from '../data/india';
import { EVIDENCE_STATUS_LABELS, type Assessment } from '../domain/schema';
import { questionTags, type AssessmentResults } from '../scoring/results';
import { BUCKET_LABELS, PRIORITY_LABELS, STATUS_LABELS } from '../scoring/recommendations';

export type Cell = string | number | boolean | null | undefined;

function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const r2 = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? null : r2(n * 100, 1));

const SELF_LABEL = { unanswered: 'Unanswered', scored: 'Scored', not_applicable: 'Not applicable', dont_know: "Don't know" } as const;
const VER_LABEL = { pending: 'Awaiting assessment', scored: 'Scored', not_applicable: 'Not applicable', not_verified: 'Not verified' } as const;

export function questionnaireCsv(a: Assessment): string {
  const tags = questionTags(a.config);
  const rows: Cell[][] = [[
    'Question ID', 'Dimension #', 'Dimension', 'Dimension weight (%)', 'Diagnostic question', 'Criticality',
    'Self-reported status', 'Self-reported score (0-4)', 'Self-reported maturity',
    'Assessor status', 'Assessor-verified score (0-4)', 'Assessor-verified maturity', 'Self minus verified',
    'Evidence reference / description', 'Evidence status', 'Assessor observations', 'Improvement notes', 'Respondent', 'Last updated',
  ]];
  for (const q of QUESTIONS) {
    const r = a.responses[q.id];
    const d = DIMENSION_BY_ID[q.dimensionId];
    const ss = r.self.state === 'scored' ? r.self.score : null;
    const vs = r.verified.state === 'scored' ? r.verified.score : null;
    rows.push([
      q.id, d.number, d.name, d.weight, q.text, tags[q.id].criticality,
      SELF_LABEL[r.self.state], ss, ss === null ? '' : SCALE_BY_SCORE[ss].label,
      VER_LABEL[r.verified.state], vs, vs === null ? '' : SCALE_BY_SCORE[vs].label, ss !== null && vs !== null ? ss - vs : null,
      r.evidence.reference, EVIDENCE_STATUS_LABELS[r.evidence.status], r.observations, r.improvementNotes, r.respondent, r.updatedAt,
    ]);
  }
  return toCsv(rows);
}

export function dimensionScoresCsv(res: AssessmentResults): string {
  const rows: Cell[][] = [[
    'Dimension #', 'Dimension', 'Weight (%)', 'Questions',
    'Verified: applicable', 'Verified: scored', 'Verified: not verified / gap', 'Verified: awaiting assessment', 'Not applicable',
    'Verified coverage (%)', 'Verified mean (0-4)', 'Verified score (0-100)', 'Contribution to index (points)', 'Status',
    'Self-reported: scored', 'Self-reported mean (0-4)', 'Self-reported score (0-100)', 'Self-reported coverage (%)', 'Self minus verified (points)',
  ]];
  DIMENSIONS.forEach((d, i) => {
    const v = res.maturity.dimensions[i];
    const s = res.maturitySelf.dimensions[i];
    rows.push([
      d.number, d.name, d.weight, d.questionCount,
      v.applicable, v.scored, v.unverified, v.pending, v.notApplicable,
      pct(v.coverage), r2(v.mean), r2(v.normalized), r2(v.contribution, 3),
      v.status === 'unscored' ? `Unscored (${v.unscoredReason === 'all_not_applicable' ? 'all not applicable' : 'no verified scores'})` : v.status === 'partial' ? 'Scored — limited coverage' : 'Scored',
      s.scored, r2(s.mean), r2(s.normalized), pct(s.coverage), v.normalized !== null && s.normalized !== null ? r2(s.normalized - v.normalized) : null,
    ]);
  });
  const m = res.maturity;
  const ms = res.maturitySelf;
  rows.push([
    '', `AI Maturity Index (${m.status})`, 100, 100, m.applicableQuestions, m.scoredQuestions, '', '', '',
    pct(m.questionCoverage), '', r2(m.index), r2(m.rawContribution, 3), m.status === 'definitive' ? 'Definitive' : m.status === 'provisional' ? 'Provisional (renormalized over scored weight)' : 'Insufficient data',
    ms.scoredQuestions, '', r2(ms.index), pct(ms.questionCoverage), res.selfMinusVerified === null ? null : r2(res.selfMinusVerified),
  ]);
  return toCsv(rows);
}

/** Principal scores with their components — maturity, risk & governance control maturity, value realization. */
export function principalScoresCsv(res: AssessmentResults): string {
  const rows: Cell[][] = [['Score', 'Component', 'Weight (%)', 'Source / questions', 'Verified score (0-100)', 'Self-reported score (0-100)', 'Contribution (points)', 'Coverage (%)', 'Status']];
  const head = (name: string, score: number | null, self: number | null, status: string, cov: number | null) =>
    rows.push([name, 'TOTAL', 100, '', r2(score), r2(self), '', pct(cov), status]);
  head('AI Maturity Index', res.maturity.index, res.maturitySelf.index, res.maturity.status, res.maturity.questionCoverage);
  res.maturity.dimensions.forEach((d, i) => rows.push(['AI Maturity Index', d.name, d.weight, `${d.id}01–${d.id}${String(d.questionCount).padStart(2, '0')}`, r2(d.normalized), r2(res.maturitySelf.dimensions[i].normalized), r2(d.contribution, 3), pct(d.coverage), d.status]));
  head('AI Risk & Governance Control Maturity (higher = stronger controls)', res.risk.score, res.riskSelf.score, res.risk.status, res.risk.questionCoverage);
  res.risk.components.forEach((c, i) => rows.push(['AI Risk & Governance Control Maturity', c.name, c.weight, RISK_COMPONENTS[i].sourceLabel, r2(c.normalized), r2(res.riskSelf.components[i].normalized), r2(c.contribution, 3), pct(c.coverage), c.status]));
  head('AI Value Realization Score', res.value.score, res.valueSelf.score, res.value.status, res.value.weightCoverage);
  res.value.components.forEach((c, i) => rows.push(['AI Value Realization Score', c.name, c.weight, VALUE_COMPONENTS[i].questionIds.join(' '), r2(c.normalized), r2(res.valueSelf.components[i].normalized), r2(c.contribution, 3), pct(c.coverage), c.status]));
  return toCsv(rows);
}

export function indicatorsCsv(a: Assessment, res: AssessmentResults): string {
  const rows: Cell[][] = [[
    'Indicator', 'Suggested measurement (source)', 'Numerator', 'Numerator unit', 'Denominator', 'Denominator unit',
    'Result', 'Result unit', 'Period start', 'Period end', 'Prior period start', 'Prior period end', 'Data source', 'Evidence note', 'Verified by assessor', 'Status', 'Validation messages',
  ]];
  for (const r of res.indicators.results) {
    const e = a.indicators[r.id];
    const isRoi = r.def.kind === 'roi';
    rows.push([
      r.def.name, r.def.measurement,
      isRoi ? res.indicators.roi.verifiedBenefits ?? res.indicators.roi.claimedBenefits : e?.numerator, r.def.numeratorUnit,
      isRoi ? res.indicators.roi.totalCosts : e?.denominator, r.def.denominatorUnit ?? '',
      r.value === null ? '' : r2(r.value, 4), r.def.resultUnit,
      isRoi ? a.roi.periodStart : e?.periodStart, isRoi ? a.roi.periodEnd : e?.periodEnd, e?.priorStart, e?.priorEnd,
      isRoi ? a.roi.dataSource : e?.dataSource, isRoi ? a.roi.evidenceNote : e?.evidenceNote,
      r.verified, r.status === 'ok' ? 'Calculated' : r.status === 'invalid' ? 'Invalid input' : 'Not captured',
      r.issues.map((i) => `${i.level.toUpperCase()}: ${i.message}`).join(' | '),
    ]);
  }
  return toCsv(rows);
}

export function recommendationsCsv(res: AssessmentResults): string {
  const rows: Cell[][] = [[
    'ID', 'Title', 'Priority', 'Status', 'Roadmap window', 'Dimension', 'Question IDs', 'Gap description', 'Why it matters', 'Suggested intervention',
    'Suggested accountable role', 'Assigned owner', 'Suggested timeframe', 'Dependencies', 'Suggested KPI / target outcome', 'Related evidence gaps', 'Basis', 'Notes', 'Source',
  ]];
  for (const r of res.recommendations) {
    rows.push([
      r.id, r.title, PRIORITY_LABELS[r.priority], STATUS_LABELS[r.status], BUCKET_LABELS[r.bucket],
      r.dimensionId ? DIMENSION_BY_ID[r.dimensionId].name : '', r.questionIds.join(' '), r.gap, r.why, r.intervention,
      r.role, r.owner, r.timeframe, r.dependencies, r.kpi, r.evidenceGaps.join(' '), r.basisNote, r.notes,
      r.isCustom ? 'Added by assessor' : r.edited ? 'Generated, edited' : 'Generated (advisory)',
    ]);
  }
  return toCsv(rows);
}

export function indiaCsv(a: Assessment, res: AssessmentResults): string {
  const rows: Cell[][] = [['ID', 'Area', 'Additional diagnostic question (source)', 'Applicability', 'Self-reported score (0-4)', 'Verified score (0-4)', 'Evidence', 'Evidence status', 'Observations', 'Legal position assessed as at']];
  for (const d of INDIA_DIAGNOSTICS) {
    const it = a.india.items[d.id];
    rows.push([d.id, d.area, d.question, it.applicability.replace('_', ' '), it.selfScore, it.verifiedScore, it.evidence, EVIDENCE_STATUS_LABELS[it.evidenceStatus], it.observations, a.india.assessmentDate]);
  }
  rows.push([], ['Diagnostic only — not a legal opinion.', '', '', '', '', '', '', '', '', ''], ['Supplementary India diagnostic index (verified)', '', '', '', '', r2(res.india.verifiedIndex)]);
  return toCsv(rows);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/\(fictional\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'assessment';
}

export function exportFilename(a: Assessment, kind: string, ext: string): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${slug(a.profile.organizationName || a.name)}_${kind}_${d}.${ext}`;
}

export const CLASSIFICATION_LABELS = CLASSIFICATIONS.map((c) => c.label);
