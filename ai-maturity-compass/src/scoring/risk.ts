/**
 * AI Risk & Governance **Control Maturity** (source §9).
 *
 * Direction: a HIGHER score means STRONGER assessed controls — it is not a risk level and is
 * never inverted. Components and weights are the source-defined composition. The source says
 * Data governance should "emphasize" D02, D06, D08 and D09; the factor is a configurable
 * policy (default 2×) because the source gives no number.
 */
import { RISK_COMPONENTS, type RiskComponentId, type ScoringConfig } from '../data/spec';
import type { Response } from '../domain/schema';
import { rollUp, type ComponentStatus, type ResultStatus } from './maturity';
import { evalQuestion, normalize, tally, type Basis, type QEval, type Tally } from './questionState';

export interface RiskComponentScore extends Tally {
  id: RiskComponentId;
  name: string;
  sourceLabel: string;
  weight: number;
  questionIds: string[];
  emphasisIds: string[];
  mean: number | null;
  normalized: number | null;
  contribution: number | null;
  status: ComponentStatus;
  sufficient: boolean;
  /** Question IDs that are unverified or still awaiting assessment (evidence gaps). */
  unverifiedIds: string[];
}

export interface RiskResult {
  basis: Basis;
  components: RiskComponentScore[];
  /** 0–100 control-maturity score; null when nothing is scored. */
  score: number | null;
  eligibleWeight: number;
  weightCoverage: number;
  questionCoverage: number | null;
  status: ResultStatus;
  /** Every control question in the composition that is not scored (gap or awaiting). */
  unverifiedControls: string[];
  caveats: string[];
}

export function computeRisk(
  responses: Record<string, Response>,
  basis: Basis,
  config: Pick<ScoringConfig, 'minDimensionCoverage' | 'emphasisMultiplier'>,
): RiskResult {
  const components: RiskComponentScore[] = RISK_COMPONENTS.map((c) => {
    const evals: { id: string; weight: number; eval: QEval }[] = c.questionIds.map((id) => ({
      id,
      weight: c.emphasisIds.includes(id) ? config.emphasisMultiplier : 1,
      eval: evalQuestion(responses[id], basis),
    }));
    const t = tally(evals);
    const normalized = t.mean === null ? null : normalize(t.mean);
    const sufficient = t.coverage !== null && t.coverage >= config.minDimensionCoverage;
    return {
      ...t,
      id: c.id,
      name: c.name,
      sourceLabel: c.sourceLabel,
      weight: c.weight,
      questionIds: c.questionIds,
      emphasisIds: c.emphasisIds,
      normalized,
      contribution: normalized === null ? null : (c.weight * normalized) / 100,
      status: (t.mean === null ? 'unscored' : sufficient ? 'scored' : 'partial') as ComponentStatus,
      sufficient,
      unverifiedIds: evals.filter((e) => e.eval.state === 'unverified' || e.eval.state === 'pending').map((e) => e.id),
    };
  });

  const roll = rollUp(components);
  const applicable = components.reduce((a, c) => a + c.applicable, 0);
  const scored = components.reduce((a, c) => a + c.scored, 0);
  const unverifiedControls = Array.from(new Set(components.flatMap((c) => c.unverifiedIds)));

  const caveats: string[] = [];
  const label = basis === 'verified' ? 'assessor-verified' : 'self-reported';
  if (roll.status === 'insufficient') {
    caveats.push(`No ${label} control scores are available, so the control-maturity score cannot be calculated.`);
  } else {
    const unscored = components.filter((c) => c.status === 'unscored');
    if (unscored.length > 0) {
      caveats.push(
        `${unscored.length} of 6 components are unscored on the ${label} basis (${unscored.map((c) => c.name).join('; ')}). The score is renormalized over ${roll.eligibleWeight}% of component weight and is provisional.`,
      );
    }
    const partial = components.filter((c) => c.status === 'partial');
    if (partial.length > 0) {
      caveats.push(`${partial.length} component${partial.length > 1 ? 's have' : ' has'} limited ${label} coverage: ${partial.map((c) => c.name).join('; ')}.`);
    }
  }

  return {
    basis,
    components,
    score: roll.value,
    eligibleWeight: roll.eligibleWeight,
    weightCoverage: roll.weightCoverage,
    questionCoverage: applicable > 0 ? scored / applicable : null,
    status: roll.status,
    unverifiedControls,
    caveats,
  };
}
