/**
 * AI Value Realization Score (source §9).
 *
 * Each component is the mean of the items available for it (questionnaire scores and
 * quantitative evidence, all on 0–4). A component with no available item is UNSCORED — it is
 * never filled with zero and never given an invented financial return. Components then roll up
 * with the source weights, renormalized over scored components when the result is provisional.
 */
import { VALUE_COMPONENTS, QUESTION_BY_ID, type ScoringConfig, type ValueComponentId, type Score } from '../data/spec';
import type { Response, ValueEvidence } from '../domain/schema';
import { rollUp, type ComponentStatus, type ResultStatus } from './maturity';
import type { IndicatorResult, RoiResult } from './indicators';
import { evalQuestion, normalize, type Basis } from './questionState';

export type ItemState = 'scored' | 'unverified' | 'pending' | 'not_applicable' | 'missing';

export interface ValueItem {
  key: string;
  kind: 'question' | 'quant';
  label: string;
  state: ItemState;
  /** 0–4 (may be fractional for averaged outcome KPIs). */
  score: number | null;
  detail: string;
}

export interface ValueComponentScore {
  id: ValueComponentId;
  name: string;
  measurement: string;
  weight: number;
  mappingSource: 'source' | 'prototype';
  mappingNote: string;
  items: ValueItem[];
  applicableItems: number;
  scoredItems: number;
  mean: number | null;
  normalized: number | null;
  contribution: number | null;
  coverage: number | null;
  status: ComponentStatus;
}

export interface ValueResult {
  basis: Basis;
  components: ValueComponentScore[];
  score: number | null;
  eligibleWeight: number;
  weightCoverage: number;
  status: ResultStatus;
  caveats: string[];
}

export function bandScore(value: number, bounds: readonly [number, number, number, number]): Score {
  if (value >= bounds[3]) return 4;
  if (value >= bounds[2]) return 3;
  if (value >= bounds[1]) return 2;
  if (value >= bounds[0]) return 1;
  return 0;
}

export interface ValueInputs {
  responses: Record<string, Response>;
  indicators: Record<string, IndicatorResult>;
  roi: RoiResult;
  valueEvidence: ValueEvidence;
  config: Pick<ScoringConfig, 'quantBands' | 'minDimensionCoverage'>;
}

function quantItem(key: string, ctx: ValueInputs, basis: Basis): ValueItem {
  const verifiedOnly = basis === 'verified';
  const fromIndicator = (id: string, label: string, bounds: readonly [number, number, number, number], unit: string): ValueItem => {
    const r = ctx.indicators[id];
    if (!r || r.status !== 'ok' || r.value === null) {
      return { key, kind: 'quant', label, state: 'missing', score: null, detail: r?.status === 'invalid' ? 'Input invalid — not scored' : 'Not captured — component evidence missing' };
    }
    if (verifiedOnly && !r.verified) {
      return { key, kind: 'quant', label, state: 'unverified', score: null, detail: `Captured (${r.value.toFixed(2)} ${unit}) but not yet verified by an assessor` };
    }
    const score = bandScore(r.value, bounds);
    return { key, kind: 'quant', label, state: 'scored', score, detail: `${r.value.toFixed(2)} ${unit} → band ${score} (prototype default band)` };
  };

  switch (key) {
    case 'roiBand': {
      const label = 'Verified AI ROI (provisional source bands)';
      const roi = verifiedOnly ? ctx.roi.roiVerified : ctx.roi.roiClaimed;
      const score = verifiedOnly ? ctx.roi.scoreVerified : ctx.roi.scoreClaimed;
      if (roi === null || score === null) {
        const reason = ctx.roi.issues.find((i) => i.level === 'error')?.message
          ?? (ctx.roi.totalCosts === null || ctx.roi.totalCosts <= 0 ? 'Total AI costs missing — ROI undefined' : verifiedOnly && ctx.roi.verifiedBenefits === null && ctx.roi.claimedBenefits !== null ? 'Benefits claimed but not yet verified' : 'ROI inputs not captured');
        return { key, kind: 'quant', label, state: verifiedOnly && ctx.roi.claimedBenefits !== null && ctx.roi.verifiedBenefits === null ? 'unverified' : 'missing', score: null, detail: reason };
      }
      return { key, kind: 'quant', label, state: 'scored', score, detail: `ROI ${roi.toFixed(1)}% → band ${score}` };
    }
    case 'hoursSaved':
      return fromIndicator('productivityImpact', 'Hours saved per employee per month', ctx.config.quantBands.hoursSavedPerEmployeeMonth, 'h/employee/month');
    case 'adoptionPenetration':
      return fromIndicator('adoptionPenetration', 'AI adoption penetration', ctx.config.quantBands.adoptionPenetration, '% of employees');
    case 'outcomeKpis': {
      const label = 'Material outcome KPIs (assessor-rated)';
      const rated = ctx.valueEvidence.outcomeKpis.filter((k) => k.rating !== null && k.name.trim() !== '');
      const usable = verifiedOnly ? rated.filter((k) => k.verified) : rated;
      if (rated.length === 0) return { key, kind: 'quant', label, state: 'missing', score: null, detail: 'No outcome KPIs rated — source asks for 3–5 material outcome KPIs against baselines' };
      if (usable.length === 0) return { key, kind: 'quant', label, state: 'unverified', score: null, detail: `${rated.length} KPI(s) rated, none verified by an assessor` };
      const mean = usable.reduce((a, k) => a + (k.rating as number), 0) / usable.length;
      return { key, kind: 'quant', label, state: 'scored', score: mean, detail: `${usable.length} of ${ctx.valueEvidence.outcomeKpis.length} KPI(s) counted, mean rating ${mean.toFixed(2)}` };
    }
    case 'recurringBenefits': {
      const label = 'Evidence that benefits are recurring and stable';
      const r = ctx.valueEvidence.recurring;
      if (r.rating === null) return { key, kind: 'quant', label, state: 'missing', score: null, detail: 'Not rated' };
      if (verifiedOnly && !r.verified) return { key, kind: 'quant', label, state: 'unverified', score: null, detail: `Rated ${r.rating} but not yet verified by an assessor` };
      return { key, kind: 'quant', label, state: 'scored', score: r.rating, detail: `Rated ${r.rating}` };
    }
    default:
      return { key, kind: 'quant', label: key, state: 'missing', score: null, detail: '' };
  }
}

export function computeValue(ctx: ValueInputs, basis: Basis): ValueResult {
  const components: ValueComponentScore[] = VALUE_COMPONENTS.map((spec) => {
    const items: ValueItem[] = [];
    for (const qid of spec.questionIds) {
      const q = QUESTION_BY_ID[qid];
      const e = evalQuestion(ctx.responses[qid], basis);
      items.push({
        key: qid,
        kind: 'question',
        label: `${qid} — ${q.text}`,
        state: e.state === 'scored' ? 'scored' : e.state === 'unverified' ? 'unverified' : e.state === 'not_applicable' ? 'not_applicable' : 'pending',
        score: e.score,
        detail: e.state === 'scored' ? `Score ${e.score}` : e.state === 'unverified' ? 'Evidence gap (Don\'t Know / Not Verified)' : e.state === 'not_applicable' ? 'Not applicable — excluded' : 'Awaiting answer',
      });
    }
    for (const k of spec.quantItems) items.push(quantItem(k, ctx, basis));

    const applicable = items.filter((i) => i.state !== 'not_applicable');
    const scored = applicable.filter((i) => i.state === 'scored');
    const mean = scored.length > 0 ? scored.reduce((a, i) => a + (i.score as number), 0) / scored.length : null;
    const normalized = mean === null ? null : normalize(mean);
    const coverage = applicable.length > 0 ? scored.length / applicable.length : null;
    const sufficient = coverage !== null && coverage >= ctx.config.minDimensionCoverage;
    return {
      id: spec.id,
      name: spec.name,
      measurement: spec.measurement,
      weight: spec.weight,
      mappingSource: spec.mappingSource,
      mappingNote: spec.mappingNote,
      items,
      applicableItems: applicable.length,
      scoredItems: scored.length,
      mean,
      normalized,
      contribution: normalized === null ? null : (spec.weight * normalized) / 100,
      coverage,
      status: (mean === null ? 'unscored' : sufficient ? 'scored' : 'partial') as ComponentStatus,
    };
  });

  const roll = rollUp(components);
  const label = basis === 'verified' ? 'verified' : 'self-reported';
  const caveats: string[] = [];
  if (roll.status === 'insufficient') {
    caveats.push(`No ${label} value evidence is available yet, so no Value Realization Score can be calculated.`);
  } else {
    const unscored = components.filter((c) => c.status === 'unscored');
    if (unscored.length > 0) {
      caveats.push(
        `${unscored.length} of 6 components are unscored on the ${label} basis (${unscored.map((c) => c.name).join('; ')}). The score is renormalized over ${roll.eligibleWeight}% of weight and is provisional. Missing data is not treated as zero.`,
      );
    }
    const partial = components.filter((c) => c.status === 'partial');
    if (partial.length > 0) caveats.push(`Partial evidence coverage in: ${partial.map((c) => c.name).join('; ')}.`);
  }

  return { basis, components, score: roll.value, eligibleWeight: roll.eligibleWeight, weightCoverage: roll.weightCoverage, status: roll.status, caveats };
}
