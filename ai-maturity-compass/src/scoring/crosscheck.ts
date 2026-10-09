/**
 * Cross-validation of questionnaire scores against quantitative indicators (source §5: the
 * indicators exist "to validate self-reported maturity"). The thresholds below are prototype
 * heuristics for prompting assessor follow-up — they are not source-defined benchmarks.
 */
import type { Response } from '../domain/schema';
import type { IndicatorResult } from './indicators';
import { evalQuestion } from './questionState';

interface Rule {
  questionId: string;
  indicatorId: string;
  /** Flag when the maturity score is at least this high … */
  minScore: number;
  /** … but the indicator fails this test. */
  failsWhen: (v: number) => boolean;
  expectation: string;
}

const RULES: Rule[] = [
  { questionId: 'U08', indicatorId: 'adoptionPenetration', minScore: 3, failsWhen: (v) => v < 20, expectation: 'active use by at least ~20% of eligible employees' },
  { questionId: 'U10', indicatorId: 'useCaseConversion', minScore: 3, failsWhen: (v) => v < 25, expectation: 'a pilot-to-production conversion of at least ~25%' },
  { questionId: 'H03', indicatorId: 'trainingCoverage', minScore: 3, failsWhen: (v) => v < 40, expectation: 'role-appropriate training completed by at least ~40% of employees' },
  { questionId: 'H07', indicatorId: 'trainingCoverage', minScore: 3, failsWhen: (v) => v < 40, expectation: 'role-appropriate training completed by at least ~40% of employees' },
  { questionId: 'D03', indicatorId: 'dataReadiness', minScore: 3, failsWhen: (v) => v < 50, expectation: 'at least ~50% of priority datasets meeting quality standards' },
  { questionId: 'G04', indicatorId: 'governanceCoverage', minScore: 3, failsWhen: (v) => v < 60, expectation: 'at least ~60% of production AI systems inventoried and risk-assessed' },
  { questionId: 'G05', indicatorId: 'governanceCoverage', minScore: 3, failsWhen: (v) => v < 60, expectation: 'at least ~60% of production AI systems inventoried and risk-assessed' },
  { questionId: 'F02', indicatorId: 'monitoringCoverage', minScore: 3, failsWhen: (v) => v < 60, expectation: 'at least ~60% of production systems with defined monitoring controls' },
  { questionId: 'V05', indicatorId: 'financialReturns', minScore: 3, failsWhen: (v) => v <= 0, expectation: 'a positive verified ROI' },
  { questionId: 'V06', indicatorId: 'financialReturns', minScore: 3, failsWhen: (v) => v <= 0, expectation: 'a positive verified ROI' },
  { questionId: 'T09', indicatorId: 'vendorConcentration', minScore: 3, failsWhen: (v) => v > 80, expectation: 'AI spend not concentrated above ~80% with one provider, or documented exit planning' },
];

export interface CrossCheckFlag {
  questionId: string;
  indicatorId: string;
  indicatorName: string;
  score: number;
  scoreBasis: 'verified' | 'self-reported';
  indicatorValue: number;
  message: string;
}

export function crossChecks(responses: Record<string, Response>, indicators: Record<string, IndicatorResult>): CrossCheckFlag[] {
  const flags: CrossCheckFlag[] = [];
  for (const rule of RULES) {
    const ind = indicators[rule.indicatorId];
    if (!ind || ind.status !== 'ok' || ind.value === null) continue;
    const r = responses[rule.questionId];
    const ver = evalQuestion(r, 'verified');
    const self = evalQuestion(r, 'self');
    const useVerified = ver.state === 'scored';
    const e = useVerified ? ver : self;
    if (e.state !== 'scored' || (e.score as number) < rule.minScore) continue;
    if (!rule.failsWhen(ind.value)) continue;
    flags.push({
      questionId: rule.questionId,
      indicatorId: rule.indicatorId,
      indicatorName: ind.def.name,
      score: e.score as number,
      scoreBasis: useVerified ? 'verified' : 'self-reported',
      indicatorValue: ind.value,
      message: `${rule.questionId} is ${useVerified ? 'verified' : 'self-reported'} at ${e.score}, but ${ind.def.name.toLowerCase()} is ${ind.value.toFixed(ind.def.decimals)} (${ind.def.resultUnit}). A score of ${rule.minScore}+ would usually be expected to coincide with ${rule.expectation}. Prompt for follow-up.`,
    });
  }
  return flags;
}
