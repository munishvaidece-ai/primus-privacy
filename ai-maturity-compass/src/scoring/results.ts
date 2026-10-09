/**
 * computeResults — the ONE function every page, chart, report and export derives from.
 * Nothing downstream recomputes or hardcodes a score.
 */
import { DIMENSIONS, RISK_COMPONENTS, VALUE_COMPONENTS, QUESTIONS, type DimensionId, type RiskComponentId, type ValueComponentId } from '../data/spec';
import type { Assessment, Bucket } from '../domain/schema';
import { computeCoverage, type EvidenceCoverage } from './coverage';
import { crossChecks, type CrossCheckFlag } from './crosscheck';
import { evaluateGates, criticalQuestionIds, type GateResult } from './gates';
import { compositeWithIndia, computeIndia, type IndiaResult } from './india';
import { computeIndicators, type IndicatorsComputation } from './indicators';
import { computeMaturityIndex, type DimensionScore, type IndexResult } from './maturity';
import { applyOverrides, generateRecommendations, roadmapBuckets, type Recommendation } from './recommendations';
import { computeRisk, type RiskResult } from './risk';
import { computeValue, type ValueResult } from './value';

export interface StrengthItem {
  dimensionId: DimensionId;
  name: string;
  shortName: string;
  normalized: number;
  mean: number;
  weight: number;
}

export interface GapItem {
  dimensionId: DimensionId;
  name: string;
  shortName: string;
  normalized: number;
  /** Index points not earned in this dimension (weight − contribution). */
  pointsAvailable: number;
  weight: number;
  weakest: { id: string; score: number }[];
}

export interface AssessmentResults {
  assessmentId: string;
  computedAt: string;
  maturity: IndexResult; // assessor-verified basis
  maturitySelf: IndexResult;
  /** self − verified, on the index; null unless both exist. */
  selfMinusVerified: number | null;
  risk: RiskResult;
  riskSelf: RiskResult;
  value: ValueResult;
  valueSelf: ValueResult;
  gates: GateResult;
  coverage: EvidenceCoverage;
  indicators: IndicatorsComputation;
  crossChecks: CrossCheckFlag[];
  india: IndiaResult;
  indiaComposite: number | null;
  strengths: StrengthItem[];
  priorityGaps: GapItem[];
  coverageGaps: DimensionScore[];
  /** Rule-generated recommendations before any user edits (used to compute override diffs). */
  generatedRecommendations: Recommendation[];
  recommendations: Recommendation[];
  roadmap: Record<Bucket, Recommendation[]>;
}

export function computeResults(a: Assessment): AssessmentResults {
  const { responses, config } = a;
  const maturity = computeMaturityIndex(responses, 'verified', config);
  const maturitySelf = computeMaturityIndex(responses, 'self', config);
  const risk = computeRisk(responses, 'verified', config);
  const riskSelf = computeRisk(responses, 'self', config);
  const indicators = computeIndicators(a.indicators, a.roi);
  const valueCtx = { responses, indicators: indicators.byId, roi: indicators.roi, valueEvidence: a.valueEvidence, config };
  const value = computeValue(valueCtx, 'verified');
  const valueSelf = computeValue(valueCtx, 'self');
  const gates = evaluateGates(responses, config, maturity.classification, a.gateDecision);
  const coverage = computeCoverage(responses, config.minDimensionCoverage);
  const checks = crossChecks(responses, indicators.byId);
  const india = computeIndia(a.india);

  const scoredDims = maturity.dimensions.filter((d) => d.normalized !== null);
  const strengths: StrengthItem[] = [...scoredDims]
    .sort((x, y) => (y.normalized as number) - (x.normalized as number) || y.weight - x.weight)
    .slice(0, 3)
    .map((d) => ({ dimensionId: d.id, name: d.name, shortName: d.shortName, normalized: d.normalized as number, mean: d.mean as number, weight: d.weight }));

  const priorityGaps: GapItem[] = [...scoredDims]
    .map((d) => ({ d, lost: d.weight - (d.contribution as number) }))
    .sort((x, y) => y.lost - x.lost)
    .slice(0, 5)
    .map(({ d, lost }) => ({
      dimensionId: d.id,
      name: d.name,
      shortName: d.shortName,
      normalized: d.normalized as number,
      pointsAvailable: lost,
      weight: d.weight,
      weakest: QUESTIONS.filter((q) => q.dimensionId === d.id)
        .map((q) => ({ id: q.id, score: responses[q.id].verified.state === 'scored' ? (responses[q.id].verified.score as number) : null }))
        .filter((x): x is { id: string; score: number } => x.score !== null)
        .sort((p, q) => p.score - q.score)
        .slice(0, 3),
    }));

  const generated = generateRecommendations({
    responses,
    maturityVerified: maturity,
    maturitySelf,
    gates,
    indicators,
    crossChecks: checks,
    india,
    coverageDimensionsInsufficient: maturity.dimensions.filter((d) => !d.sufficient).map((d) => d.id),
  });
  const recommendations = applyOverrides(generated, a.recommendationOverrides, a.customRecommendations);

  return {
    assessmentId: a.id,
    computedAt: new Date().toISOString(),
    maturity,
    maturitySelf,
    selfMinusVerified: maturity.index !== null && maturitySelf.index !== null ? maturitySelf.index - maturity.index : null,
    risk,
    riskSelf,
    value,
    valueSelf,
    gates,
    coverage,
    indicators,
    crossChecks: checks,
    india,
    indiaComposite: config.india.showComposite ? compositeWithIndia(maturity.index, india.verifiedIndex, config.india.compositeWeightPct) : null,
    strengths,
    priorityGaps,
    coverageGaps: maturity.dimensions.filter((d) => !d.sufficient),
    generatedRecommendations: generated,
    recommendations,
    roadmap: roadmapBuckets(recommendations),
  };
}

// ---------------------------------------------------------------------------
// Question tags (used by the questionnaire, evidence workspace and filters)
// ---------------------------------------------------------------------------
export type Criticality = 'critical' | 'high' | 'standard';

export interface QuestionTags {
  criticality: Criticality;
  riskComponents: RiskComponentId[];
  valueComponents: ValueComponentId[];
  gateRules: string[];
}

export function questionTags(config: Assessment['config']): Record<string, QuestionTags> {
  const critical = criticalQuestionIds(config);
  const out: Record<string, QuestionTags> = {};
  for (const q of QUESTIONS) {
    const riskComponents = RISK_COMPONENTS.filter((c) => c.questionIds.includes(q.id)).map((c) => c.id);
    const valueComponents = VALUE_COMPONENTS.filter((c) => c.questionIds.includes(q.id)).map((c) => c.id);
    out[q.id] = {
      criticality: critical.has(q.id) ? 'critical' : riskComponents.length > 0 || valueComponents.length > 0 ? 'high' : 'standard',
      riskComponents,
      valueComponents,
      gateRules: config.gates.rules.filter((r) => r.questionIds.includes(q.id)).map((r) => r.id),
    };
  }
  return out;
}

export const DIMENSION_ORDER: DimensionId[] = DIMENSIONS.map((d) => d.id);
