/**
 * Single place that decides how a question response counts toward a score.
 *
 * Rules (from the source document and the product brief):
 *  - Not Applicable is excluded from the applicable-question denominator.
 *  - Don't Know / Not Verified stays visible as an evidence gap and is NEVER a zero.
 *  - A blank answer is "pending", not zero.
 *  - Self-reported and assessor-verified are separate bases; one never substitutes for the other.
 */
import type { Response, Score } from '../domain/schema';

export type Basis = 'verified' | 'self';
export type QState = 'scored' | 'not_applicable' | 'unverified' | 'pending';

export interface QEval {
  state: QState;
  /** Present only when state === 'scored'. */
  score: Score | null;
  /** Self-declared N/A that no assessor has confirmed (verified basis only). */
  naUnconfirmed?: boolean;
}

export function evalQuestion(r: Response, basis: Basis): QEval {
  if (basis === 'self') {
    switch (r.self.state) {
      case 'scored':
        return r.self.score === null ? { state: 'pending', score: null } : { state: 'scored', score: r.self.score };
      case 'not_applicable':
        return { state: 'not_applicable', score: null };
      case 'dont_know':
        return { state: 'unverified', score: null };
      default:
        return { state: 'pending', score: null };
    }
  }
  // Verified basis — only the assessor's determination can produce a score.
  switch (r.verified.state) {
    case 'scored':
      return r.verified.score === null ? { state: 'pending', score: null } : { state: 'scored', score: r.verified.score };
    case 'not_applicable':
      return { state: 'not_applicable', score: null };
    case 'not_verified':
      return { state: 'unverified', score: null };
    default:
      // Assessor has not acted yet.
      if (r.self.state === 'not_applicable') return { state: 'not_applicable', score: null, naUnconfirmed: true };
      if (r.self.state === 'dont_know') return { state: 'unverified', score: null };
      return { state: 'pending', score: null };
  }
}

export interface Tally {
  applicable: number;
  scored: number;
  unverified: number;
  pending: number;
  notApplicable: number;
  /** Weighted sum of scores and of weights over scored items only. */
  weightedScoreSum: number;
  scoredWeight: number;
  /** Weighted mean on the 0–4 scale, or null when nothing is scored. */
  mean: number | null;
  /** scored / applicable, or null when nothing is applicable. */
  coverage: number | null;
}

export function tally(items: { weight: number; eval: QEval }[]): Tally {
  let scored = 0;
  let unverified = 0;
  let pending = 0;
  let notApplicable = 0;
  let sum = 0;
  let w = 0;
  for (const it of items) {
    switch (it.eval.state) {
      case 'scored':
        scored++;
        sum += it.weight * (it.eval.score as number);
        w += it.weight;
        break;
      case 'unverified':
        unverified++;
        break;
      case 'pending':
        pending++;
        break;
      case 'not_applicable':
        notApplicable++;
        break;
    }
  }
  const applicable = scored + unverified + pending;
  return {
    applicable,
    scored,
    unverified,
    pending,
    notApplicable,
    weightedScoreSum: sum,
    scoredWeight: w,
    mean: scored > 0 ? sum / w : null,
    coverage: applicable > 0 ? scored / applicable : null,
  };
}

/** Normalize a 0–4 mean to 0–100 without rounding. */
export const normalize = (mean: number): number => (mean / 4) * 100;
