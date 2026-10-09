/**
 * India-specific diagnostics scoring. Reported SEPARATELY from the 100-question core index.
 * A supplementary composite is only produced when the assessment's policy explicitly enables
 * it, and it never replaces or modifies the core index.
 */
import { INDIA_DIAGNOSTICS } from '../data/india';
import type { IndiaState } from '../domain/schema';
import type { ResultStatus } from './maturity';
import { normalize } from './questionState';

export interface IndiaItemResult {
  id: string;
  area: string;
  applicability: 'applicable' | 'not_applicable' | 'not_assessed';
  selfScore: number | null;
  verifiedScore: number | null;
}

export interface IndiaResult {
  items: IndiaItemResult[];
  applicable: number;
  notApplicable: number;
  notAssessed: number;
  /** 0–100 on the assessor-verified basis, or null. */
  verifiedIndex: number | null;
  selfIndex: number | null;
  verifiedScored: number;
  selfScored: number;
  status: ResultStatus;
  assessmentDate: string;
  caveats: string[];
}

export function computeIndia(india: IndiaState): IndiaResult {
  const items: IndiaItemResult[] = INDIA_DIAGNOSTICS.map((d) => {
    const it = india.items[d.id];
    return {
      id: d.id,
      area: d.area,
      applicability: it?.applicability ?? 'not_assessed',
      selfScore: it?.selfScore ?? null,
      verifiedScore: it?.verifiedScore ?? null,
    };
  });
  const applicableItems = items.filter((i) => i.applicability === 'applicable');
  const mean = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  const vScores = applicableItems.map((i) => i.verifiedScore).filter((s): s is number => s !== null);
  const sScores = applicableItems.map((i) => i.selfScore).filter((s): s is number => s !== null);
  const vMean = mean(vScores);
  const sMean = mean(sScores);
  const notAssessed = items.filter((i) => i.applicability === 'not_assessed').length;
  const notApplicable = items.filter((i) => i.applicability === 'not_applicable').length;

  const caveats: string[] = [
    'Diagnostic only — not a legal opinion. Regulatory position must be confirmed as at the assessment date.',
  ];
  if (!india.assessmentDate) caveats.push('No assessment date recorded: record the date the legal and regulatory position was assessed.');
  if (notAssessed > 0) caveats.push(`${notAssessed} area${notAssessed > 1 ? 's are' : ' is'} not yet assessed for applicability.`);
  if (applicableItems.length > 0 && vScores.length < applicableItems.length) {
    caveats.push(`${applicableItems.length - vScores.length} applicable area${applicableItems.length - vScores.length > 1 ? 's' : ''} without an assessor-verified score.`);
  }

  return {
    items,
    applicable: applicableItems.length,
    notApplicable,
    notAssessed,
    verifiedIndex: vMean === null ? null : normalize(vMean),
    selfIndex: sMean === null ? null : normalize(sMean),
    verifiedScored: vScores.length,
    selfScored: sScores.length,
    status:
      vMean === null ? 'insufficient' : notAssessed === 0 && vScores.length === applicableItems.length ? 'definitive' : 'provisional',
    assessmentDate: india.assessmentDate,
    caveats,
  };
}

/** Optional supplementary composite: (1 − w) × core + w × India. Never replaces the core index. */
export function compositeWithIndia(core: number | null, india: number | null, weightPct: number): number | null {
  if (core === null || india === null) return null;
  const w = Math.min(Math.max(weightPct, 0), 50) / 100;
  return (1 - w) * core + w * india;
}
