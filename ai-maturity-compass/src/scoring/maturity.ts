/**
 * AI Maturity Index (source §4):
 *   Index = Σ_d  W_d × ( Σ S_di / (4 × N_d) )
 * W_d = dimension weight in percentage points, S_di = applicable question score (0–4),
 * N_d = number of applicable, scored questions in the dimension.
 *
 * The verified basis uses assessor-verified scores; the self-reported basis uses the
 * organization's own scores. They are computed independently with their own coverage.
 */
import { CLASSIFICATIONS, classify, DIMENSIONS, QUESTIONS, type Classification, type DimensionId, type ScoringConfig } from '../data/spec';
import type { Response } from '../domain/schema';
import { evalQuestion, normalize, tally, type Basis, type Tally } from './questionState';

export type ComponentStatus = 'scored' | 'partial' | 'unscored';
export type ResultStatus = 'definitive' | 'provisional' | 'insufficient';

export interface DimensionScore extends Tally {
  id: DimensionId;
  name: string;
  shortName: string;
  weight: number;
  questionCount: number;
  /** Mean on 0–4 (null → unscored). */
  mean: number | null;
  /** 0–100 (null → unscored). */
  normalized: number | null;
  /** Percentage points contributed to the index, 0..weight (null → unscored). */
  contribution: number | null;
  status: ComponentStatus;
  unscoredReason: 'none_scored' | 'all_not_applicable' | null;
  /** Coverage meets the configured minimum. */
  sufficient: boolean;
}

export interface IndexResult {
  basis: Basis;
  dimensions: DimensionScore[];
  /** 0–100, unrounded. Renormalized over eligible weight when provisional. Null when nothing is scored. */
  index: number | null;
  /** Plain Σ contributions before renormalization (equals `index` when every dimension is scored). */
  rawContribution: number;
  eligibleWeight: number;
  /** Share of total weight that is scored (0–1). */
  weightCoverage: number;
  /** Scored ÷ applicable across all questions (0–1, null when nothing is applicable). */
  questionCoverage: number | null;
  scoredQuestions: number;
  applicableQuestions: number;
  status: ResultStatus;
  classification: Classification | null;
  unscoredDimensionIds: DimensionId[];
  partialDimensionIds: DimensionId[];
  caveats: string[];
}

export function scoreDimensions(
  responses: Record<string, Response>,
  basis: Basis,
  config: Pick<ScoringConfig, 'minDimensionCoverage'>,
): DimensionScore[] {
  return DIMENSIONS.map((d) => {
    const qs = QUESTIONS.filter((q) => q.dimensionId === d.id);
    const t = tally(qs.map((q) => ({ weight: 1, eval: evalQuestion(responses[q.id], basis) })));
    const normalized = t.mean === null ? null : normalize(t.mean);
    const contribution = normalized === null ? null : (d.weight * normalized) / 100;
    const sufficient = t.coverage !== null && t.coverage >= config.minDimensionCoverage;
    const status: ComponentStatus = t.mean === null ? 'unscored' : sufficient ? 'scored' : 'partial';
    return {
      ...t,
      id: d.id,
      name: d.name,
      shortName: d.shortName,
      weight: d.weight,
      questionCount: d.questionCount,
      normalized,
      contribution,
      status,
      unscoredReason: t.mean !== null ? null : t.applicable === 0 ? 'all_not_applicable' : 'none_scored',
      sufficient,
    };
  });
}

/** Shared roll-up used by the maturity, risk and value scores. */
export function rollUp<T extends { weight: number; normalized: number | null; contribution: number | null; status: ComponentStatus }>(
  parts: T[],
): { value: number | null; rawContribution: number; eligibleWeight: number; weightCoverage: number; totalWeight: number; status: ResultStatus } {
  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  let raw = 0;
  let eligible = 0;
  for (const p of parts) {
    if (p.contribution !== null) {
      raw += p.contribution;
      eligible += p.weight;
    }
  }
  const allSolid = parts.every((p) => p.status === 'scored');
  const status: ResultStatus = eligible === 0 ? 'insufficient' : allSolid ? 'definitive' : 'provisional';
  return {
    value: eligible === 0 ? null : (raw / eligible) * 100,
    rawContribution: raw,
    eligibleWeight: eligible,
    weightCoverage: totalWeight > 0 ? eligible / totalWeight : 0,
    totalWeight,
    status,
  };
}

export function computeMaturityIndex(
  responses: Record<string, Response>,
  basis: Basis,
  config: Pick<ScoringConfig, 'minDimensionCoverage'>,
): IndexResult {
  const dimensions = scoreDimensions(responses, basis, config);
  const roll = rollUp(dimensions);
  const scoredQuestions = dimensions.reduce((a, d) => a + d.scored, 0);
  const applicableQuestions = dimensions.reduce((a, d) => a + d.applicable, 0);
  const unscored = dimensions.filter((d) => d.status === 'unscored');
  const partial = dimensions.filter((d) => d.status === 'partial');

  const caveats: string[] = [];
  const label = basis === 'verified' ? 'assessor-verified' : 'self-reported';
  if (roll.status === 'insufficient') {
    caveats.push(`No ${label} scores are available yet, so no index can be calculated. Nothing has been scored as zero.`);
  } else {
    if (unscored.length > 0) {
      const w = unscored.reduce((a, d) => a + d.weight, 0);
      caveats.push(
        `${unscored.length} of 12 dimensions are unscored on the ${label} basis (${unscored.map((d) => d.shortName).join(', ')}; ${w}% of total weight). ` +
          `The index is renormalized over the ${roll.eligibleWeight}% of weight that is scored and is provisional.`,
      );
    }
    if (partial.length > 0) {
      caveats.push(
        `${partial.length} scored dimension${partial.length > 1 ? 's have' : ' has'} less than ${Math.round(config.minDimensionCoverage * 100)}% of applicable questions covered on the ${label} basis (${partial.map((d) => d.shortName).join(', ')}).`,
      );
    }
    const allNa = unscored.filter((d) => d.unscoredReason === 'all_not_applicable');
    if (allNa.length > 0) {
      caveats.push(`All questions are Not Applicable in: ${allNa.map((d) => d.shortName).join(', ')}. Those dimensions are excluded, not scored as zero.`);
    }
  }

  return {
    basis,
    dimensions,
    index: roll.value,
    rawContribution: roll.rawContribution,
    eligibleWeight: roll.eligibleWeight,
    weightCoverage: roll.weightCoverage,
    questionCoverage: applicableQuestions > 0 ? scoredQuestions / applicableQuestions : null,
    scoredQuestions,
    applicableQuestions,
    status: roll.status,
    classification: roll.value === null ? null : classify(roll.value),
    unscoredDimensionIds: unscored.map((d) => d.id),
    partialDimensionIds: partial.map((d) => d.id),
    caveats,
  };
}

export const classificationRank = (c: Classification | null): number => (c ? c.rank : -1);
export const CLASSIFICATION_ORDER = CLASSIFICATIONS;
