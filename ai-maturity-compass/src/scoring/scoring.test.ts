import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATIONS, DIMENSIONS, QUESTIONS, QUESTION_BY_ID, RISK_COMPONENTS, ROI_BANDS, TOTAL_WEIGHT, VALUE_COMPONENTS,
  classify, range, roiToScore, type DimensionId, type Score,
} from '../data/spec';
import { createAssessment } from '../domain/factory';
import type { Assessment, Response } from '../domain/schema';
import { computeResults } from './results';
import { computeMaturityIndex } from './maturity';
import { computeRisk } from './risk';
import { computeCoverage } from './coverage';
import { computeIndicators, computeRoi, roiPercent } from './indicators';
import { INDICATOR_BY_ID } from '../data/indicators';

const CFG = { minDimensionCoverage: 0.7, emphasisMultiplier: 2 };

/** Build an assessment and let the test set responses. */
function make(fn: (set: Setters, a: Assessment) => void): Assessment {
  const a = createAssessment({ name: 'Test' });
  const set: Setters = {
    verified: (id, s) => { a.responses[id].verified = { state: 'scored', score: s, at: null }; },
    self: (id, s) => { a.responses[id].self = { state: 'scored', score: s }; },
    selfNa: (id) => { a.responses[id].self = { state: 'not_applicable', score: null }; },
    selfDk: (id) => { a.responses[id].self = { state: 'dont_know', score: null }; },
    verNa: (id) => { a.responses[id].verified = { state: 'not_applicable', score: null, at: null }; },
    verNv: (id) => { a.responses[id].verified = { state: 'not_verified', score: null, at: null }; },
    evidence: (id, status, ref = 'Doc') => { a.responses[id].evidence = { status, reference: ref }; },
    allVerified: (s, ids) => (ids ?? QUESTIONS.map((q) => q.id)).forEach((id) => set.verified(id, s)),
    allSelf: (s, ids) => (ids ?? QUESTIONS.map((q) => q.id)).forEach((id) => set.self(id, s)),
  };
  fn(set, a);
  return a;
}
interface Setters {
  verified(id: string, s: Score): void; self(id: string, s: Score): void;
  selfNa(id: string): void; selfDk(id: string): void; verNa(id: string): void; verNv(id: string): void;
  evidence(id: string, status: Response['evidence']['status'], ref?: string): void;
  allVerified(s: Score, ids?: string[]): void; allSelf(s: Score, ids?: string[]): void;
}
const dimIds = (id: DimensionId) => QUESTIONS.filter((q) => q.dimensionId === id).map((q) => q.id);

describe('source specification', () => {
  it('has all 100 questions with the exact source IDs per dimension', () => {
    expect(QUESTIONS).toHaveLength(100);
    const expected: Record<string, string[]> = {
      S: range('S', 1, 10), G: range('G', 1, 9), D: range('D', 1, 10), T: range('T', 1, 9), U: range('U', 1, 10),
      H: range('H', 1, 9), R: range('R', 1, 9), C: range('C', 1, 8), V: range('V', 1, 8), I: range('I', 1, 6),
      O: range('O', 1, 6), F: range('F', 1, 6),
    };
    for (const [dim, ids] of Object.entries(expected)) expect(dimIds(dim as DimensionId)).toEqual(ids);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(100);
    for (const q of QUESTIONS) expect(q.id[0]).toBe(q.dimensionId);
  });

  it('matches the dimension question counts and weights in the source', () => {
    expect(DIMENSIONS.map((d) => d.questionCount)).toEqual([10, 9, 10, 9, 10, 9, 9, 8, 8, 6, 6, 6]);
    expect(DIMENSIONS.map((d) => d.weight)).toEqual([10, 10, 12, 10, 12, 8, 10, 10, 8, 4, 3, 3]);
    expect(TOTAL_WEIGHT).toBe(100);
    for (const d of DIMENSIONS) expect(QUESTIONS.filter((q) => q.dimensionId === d.id)).toHaveLength(d.questionCount);
    expect(DIMENSIONS.map((d) => d.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('preserves verbatim source wording (spot checks)', () => {
    expect(QUESTION_BY_ID.S01.text).toBe('Does the organization have a formally documented AI strategy aligned with its overall business or institutional strategy?');
    expect(QUESTION_BY_ID.U03.text).toContain("organization's major functions");
    expect(QUESTION_BY_ID.F06.text).toContain('forward-looking AI roadmap');
  });

  it('risk and value compositions sum to 100', () => {
    expect(RISK_COMPONENTS.reduce((a, c) => a + c.weight, 0)).toBe(100);
    expect(VALUE_COMPONENTS.reduce((a, c) => a + c.weight, 0)).toBe(100);
    expect(RISK_COMPONENTS.map((c) => c.weight)).toEqual([25, 25, 25, 10, 5, 10]);
    expect(VALUE_COMPONENTS.map((c) => c.weight)).toEqual([25, 20, 20, 15, 10, 10]);
    expect(RISK_COMPONENTS.find((c) => c.id === 'lifecycle')!.questionIds).toEqual(['F02', 'F03', 'F04', 'F05']);
    expect(VALUE_COMPONENTS.find((c) => c.id === 'adoption')!.questionIds).toEqual(['U02', 'U03', 'U04', 'U08', 'U10']);
    expect(VALUE_COMPONENTS.find((c) => c.id === 'discipline')!.questionIds).toEqual(range('V', 2, 8));
    expect(VALUE_COMPONENTS.find((c) => c.id === 'sustainability')!.questionIds).toEqual(['U09', 'U10', 'V07', 'V08', 'F01', 'F02']);
  });
});

describe('maturity classification boundaries (no intermediate rounding)', () => {
  it.each([
    [0, 'AI Nascent'], [20, 'AI Nascent'], [20.0000001, 'AI Exploring'], [40, 'AI Exploring'], [40.0001, 'AI Emerging'],
    [60, 'AI Emerging'], [60.0001, 'AI Advanced'], [80, 'AI Advanced'], [80.0001, 'AI Leading'], [100, 'AI Leading'],
  ])('index %s → %s', (idx, label) => {
    expect(classify(idx).label).toBe(label);
  });
  it('defines five contiguous bands', () => {
    expect(CLASSIFICATIONS).toHaveLength(5);
  });
});

describe('AI Maturity Index', () => {
  it('scores 4 everywhere as 100 and 0 everywhere as 0 (definitive, not "unscored")', () => {
    const top = computeMaturityIndex(make((s) => s.allVerified(4)).responses, 'verified', CFG);
    expect(top.index).toBeCloseTo(100, 10);
    expect(top.status).toBe('definitive');
    expect(top.classification!.label).toBe('AI Leading');
    const zero = computeMaturityIndex(make((s) => s.allVerified(0)).responses, 'verified', CFG);
    expect(zero.index).toBe(0);
    expect(zero.status).toBe('definitive');
    expect(zero.classification!.label).toBe('AI Nascent');
  });

  it('applies the formula Σ W_d × (Σ S / 4N)', () => {
    // S (10%) all 4 → 10 pts; G (10%) all 2 → 5 pts; D (12%) mean 3 → 9 pts; rest zero.
    const a = make((s) => {
      s.allVerified(0);
      s.allVerified(4, dimIds('S'));
      s.allVerified(2, dimIds('G'));
      s.allVerified(3, dimIds('D'));
    });
    const r = computeMaturityIndex(a.responses, 'verified', CFG);
    expect(r.index).toBeCloseTo(10 + 5 + 9, 10);
    expect(r.dimensions.find((d) => d.id === 'D')!.contribution).toBeCloseTo(9, 10);
  });

  it('excludes Not Applicable from the denominator instead of scoring it zero', () => {
    const a = make((s) => {
      s.allVerified(4, dimIds('S').slice(0, 9));
      s.verNa('S10');
    });
    const s = computeMaturityIndex(a.responses, 'verified', CFG).dimensions.find((d) => d.id === 'S')!;
    expect(s.applicable).toBe(9);
    expect(s.notApplicable).toBe(1);
    expect(s.normalized).toBeCloseTo(100, 10); // would be 90 if N/A were zero
    expect(s.coverage).toBe(1);
  });

  it('treats a self-declared N/A as excluded but flags it as unconfirmed on the verified basis', () => {
    const a = make((s) => {
      s.allVerified(4, dimIds('S').slice(0, 9));
      s.selfNa('S10');
    });
    const s = computeMaturityIndex(a.responses, 'verified', CFG).dimensions.find((d) => d.id === 'S')!;
    expect(s.applicable).toBe(9);
    expect(s.normalized).toBeCloseTo(100, 10);
  });

  it("does not turn Don't Know / Not Verified into zero — it lowers coverage, not the mean", () => {
    const a = make((s) => {
      dimIds('S').slice(0, 5).forEach((id) => s.verified(id, 4));
      dimIds('S').slice(5, 8).forEach((id) => s.verNv(id));
      s.selfDk('S09');
    });
    const d = computeMaturityIndex(a.responses, 'verified', CFG).dimensions.find((x) => x.id === 'S')!;
    expect(d.scored).toBe(5);
    expect(d.unverified).toBe(4);
    expect(d.pending).toBe(1);
    expect(d.mean).toBe(4); // gaps not averaged in as zeros
    expect(d.normalized).toBeCloseTo(100, 10);
    expect(d.coverage).toBeCloseTo(0.5, 10);
    expect(d.status).toBe('partial');
  });

  it('keeps self-reported and verified scoring distinct', () => {
    const a = make((s) => {
      s.allSelf(4);
      s.allVerified(2);
    });
    const v = computeMaturityIndex(a.responses, 'verified', CFG);
    const sf = computeMaturityIndex(a.responses, 'self', CFG);
    expect(v.index).toBeCloseTo(50, 10);
    expect(sf.index).toBeCloseTo(100, 10);
    expect(computeResults(a).selfMinusVerified).toBeCloseTo(50, 10);
  });

  it('never substitutes self-reported scores when nothing is verified (no false zero)', () => {
    const a = make((s) => s.allSelf(4));
    const v = computeMaturityIndex(a.responses, 'verified', CFG);
    expect(v.index).toBeNull();
    expect(v.classification).toBeNull();
    expect(v.status).toBe('insufficient');
    expect(v.dimensions.every((d) => d.status === 'unscored' && d.normalized === null && d.contribution === null)).toBe(true);
    expect(v.caveats[0]).toMatch(/Nothing has been scored as zero/);
    expect(computeMaturityIndex(a.responses, 'self', CFG).index).toBeCloseTo(100, 10);
  });

  it('shows unscored dimensions and renormalizes a provisional index over eligible weight only', () => {
    const a = make((s) => {
      s.allVerified(4, dimIds('S'));
      s.allVerified(2, dimIds('G'));
    });
    const r = computeMaturityIndex(a.responses, 'verified', CFG);
    expect(r.status).toBe('provisional');
    expect(r.eligibleWeight).toBe(20);
    expect(r.weightCoverage).toBeCloseTo(0.2, 10);
    expect(r.rawContribution).toBeCloseTo(10 + 5, 10);
    expect(r.index).toBeCloseTo((15 / 20) * 100, 10); // 75
    expect(r.unscoredDimensionIds).toHaveLength(10);
    expect(r.caveats.join(' ')).toMatch(/provisional/);
  });

  it('marks the index provisional when a dimension is below the coverage threshold', () => {
    const a = make((s, x) => {
      s.allVerified(3);
      dimIds('T').slice(0, 5).forEach((id) => (x.responses[id].verified = { state: 'pending', score: null, at: null }));
    });
    const r = computeMaturityIndex(a.responses, 'verified', CFG);
    expect(r.dimensions.find((d) => d.id === 'T')!.status).toBe('partial');
    expect(r.status).toBe('provisional');
  });

  it('treats an all-Not-Applicable dimension as excluded, not zero', () => {
    const a = make((s) => {
      s.allVerified(4);
      dimIds('I').forEach((id) => s.verNa(id));
    });
    const r = computeMaturityIndex(a.responses, 'verified', CFG);
    const i = r.dimensions.find((d) => d.id === 'I')!;
    expect(i.status).toBe('unscored');
    expect(i.unscoredReason).toBe('all_not_applicable');
    expect(r.index).toBeCloseTo(100, 10);
    expect(r.status).toBe('provisional');
  });
});

describe('AI Risk & Governance Control Maturity', () => {
  it('scores higher for stronger controls (4 → 100, 0 → 0) with the source weights', () => {
    expect(computeRisk(make((s) => s.allVerified(4)).responses, 'verified', CFG).score).toBeCloseTo(100, 10);
    expect(computeRisk(make((s) => s.allVerified(0)).responses, 'verified', CFG).score).toBe(0);
    // Only governance (25%) at 4, everything else 0 → 25.
    const a = make((s) => { s.allVerified(0); s.allVerified(4, range('G', 1, 9)); });
    expect(computeRisk(a.responses, 'verified', CFG).score).toBeCloseTo(25, 10);
  });

  it('applies the emphasis multiplier to D02, D06, D08 and D09 inside the data component only', () => {
    const a = make((s) => { s.allVerified(0, range('D', 1, 10)); s.verified('D02', 4); });
    const r = computeRisk(a.responses, 'verified', CFG);
    const comp = r.components.find((c) => c.id === 'dataGovernance')!;
    // weights: 6 normal + 4 emphasized(2) = 14; weighted score sum = 2*4 = 8
    expect(comp.mean).toBeCloseTo(8 / 14, 10);
    expect(comp.contribution).toBeCloseTo(10 * (8 / 14 / 4), 10);
    expect(computeRisk(a.responses, 'verified', { ...CFG, emphasisMultiplier: 1 }).components.find((c) => c.id === 'dataGovernance')!.mean).toBeCloseTo(0.4, 10);
  });

  it('keeps unverified controls visible and does not score them as zero', () => {
    const a = make((s) => { s.allVerified(4, range('G', 1, 9)); s.verNv('G04'); });
    const r = computeRisk(a.responses, 'verified', CFG);
    expect(r.unverifiedControls).toContain('G04');
    expect(r.components.find((c) => c.id === 'governance')!.mean).toBe(4);
    expect(r.components.find((c) => c.id === 'cyber')!.status).toBe('unscored');
    expect(r.status).toBe('provisional');
  });
});

describe('risk-based maturity gates (advisory)', () => {
  const strong = (extra?: (s: Setters) => void) =>
    make((s) => { s.allVerified(4); extra?.(s); });

  it('flags the classification for review when a critical control is deficient', () => {
    const res = computeResults(strong((s) => s.verified('C02', 1)));
    expect(res.maturity.classification!.label).toBe('AI Leading');
    expect(res.gates.triggered).toBe(true);
    expect(res.gates.deficiencies.map((d) => d.questionId)).toEqual(['C02']);
    expect(res.gates.ceilingApplies).toBe(true);
    expect(res.gates.advisoryClassification!.label).toBe('AI Emerging');
    expect(res.gates.status).toBe('review_required');
    // Advisory: the reported classification is NOT capped until an assessor confirms.
    expect(res.gates.finalClassification!.label).toBe('AI Leading');
    expect(res.gates.explanation.join(' ')).toMatch(/assessor confirmation/);
  });

  it('applies the ceiling only after assessor confirmation, and respects an override', () => {
    const a = strong((s) => s.verified('R03', 0));
    a.gateDecision = { status: 'confirmed', note: '', decidedBy: 'QA', decidedAt: null };
    expect(computeResults(a).gates.finalClassification!.label).toBe('AI Emerging');
    a.gateDecision = { status: 'overridden', note: 'Compensating control', decidedBy: 'QA', decidedAt: null };
    const r = computeResults(a);
    expect(r.gates.status).toBe('overridden');
    expect(r.gates.finalClassification!.label).toBe('AI Leading');
  });

  it('does not trigger on self-reported or unverified deficiencies — it lists them as a watch list', () => {
    const a = make((s, x) => { s.allVerified(4); s.self('C03', 0); x.responses.C03.verified = { state: 'pending', score: null, at: null }; });
    const r = computeResults(a);
    expect(r.gates.triggered).toBe(false);
    expect(r.gates.selfReportedDeficiencies.map((c) => c.questionId)).toContain('C03');
    expect(r.gates.unverified.map((c) => c.questionId)).toContain('C03');
  });

  it('is configurable and can be disabled', () => {
    const a = strong((s) => s.verified('C04', 0));
    a.config.gates.enabled = false;
    expect(computeResults(a).gates.status).toBe('disabled');
    a.config.gates.enabled = true;
    a.config.gates.deficiencyThreshold = 0;
    a.responses.C04.verified.score = 1;
    expect(computeResults(a).gates.triggered).toBe(false);
  });

  it('does not propose a ceiling when the index is already at or below it', () => {
    const a = make((s) => { s.allVerified(2); s.verified('C02', 0); });
    const r = computeResults(a);
    expect(r.gates.triggered).toBe(true);
    expect(r.gates.ceilingApplies).toBe(false);
  });
});

describe('AI Value Realization Score', () => {
  it('maps ROI to the provisional source bands', () => {
    expect(ROI_BANDS).toHaveLength(5);
    expect([-50, -100, 0].map(roiToScore)).toEqual([0, 0, 0]);
    expect([0.0001, 10].map(roiToScore)).toEqual([1, 1]);
    expect([10.0001, 25].map(roiToScore)).toEqual([2, 2]);
    expect([25.0001, 50].map(roiToScore)).toEqual([3, 3]);
    expect([50.0001, 400].map(roiToScore)).toEqual([4, 4]);
  });

  it('leaves the financial component unscored without cost data (never zero or invented)', () => {
    const a = make((s) => s.allVerified(4));
    const r = computeResults(a);
    const fin = r.value.components.find((c) => c.id === 'financial')!;
    expect(fin.status).toBe('unscored');
    expect(fin.normalized).toBeNull();
    expect(r.value.status).toBe('provisional');
    expect(r.value.eligibleWeight).toBeLessThan(100);
    expect(r.value.caveats.join(' ')).toMatch(/not treated as zero/);
  });

  it('computes the financial component from verified ROI only', () => {
    const a = make((s) => s.allVerified(4));
    a.roi.costs = { platform: 100, compute: null, integration: null, people: null, governance: null, other: null };
    a.roi.claimed = { revenue: 300, costSavings: null, productivity: null };
    // Claimed but not verified → unverified on the verified basis, not scored.
    let r = computeResults(a);
    expect(r.value.components.find((c) => c.id === 'financial')!.status).toBe('unscored');
    expect(r.valueSelf.components.find((c) => c.id === 'financial')!.scoredItems).toBe(1);
    a.roi.verifiedBenefits = 160; // ROI 60% → band 4
    r = computeResults(a);
    expect(r.indicators.roi.roiVerified).toBeCloseTo(60, 10);
    expect(r.value.components.find((c) => c.id === 'financial')!.mean).toBe(4);
  });

  it('is consistent: component weights roll up to the score', () => {
    const a = make((s) => s.allVerified(4));
    a.roi.costs.platform = 100; a.roi.verifiedBenefits = 200; a.roi.claimed.revenue = 200;
    a.indicators.adoptionPenetration = { ...a.indicators.adoptionPenetration, numerator: 700, denominator: 1000, verified: true };
    a.indicators.productivityImpact = { ...a.indicators.productivityImpact, numerator: 120000, denominator: 1000, periodStart: '2025-04-01', periodEnd: '2026-03-31', verified: true };
    a.valueEvidence.outcomeKpis = [{ id: 'k1', name: 'Fraud loss', baseline: '', current: '', rating: 4, verified: true, note: '' }];
    a.valueEvidence.recurring = { rating: 4, verified: true, note: '' };
    const v = computeResults(a).value;
    expect(v.status).toBe('definitive');
    expect(v.score).toBeCloseTo(100, 10);
    expect(v.components.reduce((s, c) => s + (c.contribution ?? 0), 0)).toBeCloseTo(100, 10);
  });
});

describe('coverage and evidence confidence', () => {
  it('distinguishes evidence referenced, reviewed and accepted', () => {
    const a = make((s) => {
      s.allVerified(3, ['S01', 'S02', 'S03', 'S04']);
      s.evidence('S01', 'accepted'); s.evidence('S02', 'reviewed'); s.evidence('S03', 'provided'); s.evidence('S04', 'none', '');
      s.verNa('S05'); s.selfDk('S06'); s.verNv('S07');
    });
    const c = computeCoverage(a.responses, 0.7);
    expect(c.totalQuestions).toBe(100);
    expect(c.notApplicable).toBe(1);
    expect(c.applicable).toBe(99);
    expect(c.withReference).toBe(3);
    expect(c.accepted).toBe(1);
    expect(c.reviewed).toBe(2); // reviewed + accepted
    expect(c.verifiedScored).toBe(4);
    expect(c.dontKnowNotVerified).toBe(2);
    expect(c.assessorNotVerified).toBe(1);
    expect(c.awaitingAssessment).toBe(99 - 4 - 2);
    expect(c.verifiedWithAcceptedEvidence).toBe(1);
    expect(c.evidenceBackedShare).toBeCloseTo(0.25, 10);
    expect(c.sufficientDimensions).toBe(0);
  });

  it('does not count typed text as verified evidence', () => {
    const a = make((s) => { s.allVerified(4, ['G01']); s.evidence('G01', 'provided', 'Policy v3'); });
    const c = computeCoverage(a.responses, 0.7);
    expect(c.withReference).toBe(1);
    expect(c.accepted).toBe(0);
    expect(c.confidence).toBe('very_low');
  });
});

describe('quantitative indicators and ROI', () => {
  const entries = (over: Record<string, Partial<Assessment['indicators'][string]>>) => {
    const a = createAssessment();
    for (const [k, v] of Object.entries(over)) a.indicators[k] = { ...a.indicators[k], ...v };
    return computeIndicators(a.indicators, a.roi);
  };

  it('calculates the 15 source indicators from numerator/denominator', () => {
    const c = entries({
      aiSpendIntensity: { numerator: 300, denominator: 4000, periodStart: '2025-04-01', periodEnd: '2026-03-31' },
      productionIntensity: { numerator: 24, denominator: 12000 },
      aiInvestmentGrowth: { numerator: 300, denominator: 200, periodStart: '2025-04-01', periodEnd: '2026-03-31', priorStart: '2024-04-01', priorEnd: '2025-03-31' },
      infraEfficiency: { numerator: 50, denominator: 10_000_000 },
      deploymentSpeed: { numerator: 95 },
    });
    expect(c.total).toBe(15);
    expect(c.byId.aiSpendIntensity.value).toBeCloseTo(7.5, 10);
    expect(c.byId.productionIntensity.value).toBeCloseTo(2, 10);
    expect(c.byId.aiInvestmentGrowth.value).toBeCloseTo(50, 10);
    expect(c.byId.infraEfficiency.value).toBeCloseTo(0.5, 10); // ₹50 lakh / 1 crore txns
    expect(c.byId.deploymentSpeed.value).toBe(95);
    expect(c.captured).toBe(5);
  });

  it('rejects zero denominators, negatives and numerators above denominators — as invalid, never as zero', () => {
    const c = entries({
      adoptionPenetration: { numerator: 10, denominator: 0 },
      trainingCoverage: { numerator: 120, denominator: 100 },
      dataReadiness: { numerator: -1, denominator: 10 },
      governanceCoverage: { numerator: 5.5, denominator: 10 },
      aiInvestmentGrowth: { numerator: 10, denominator: 0, periodStart: '2025-04-01', periodEnd: '2026-03-31', priorStart: '2024-04-01', priorEnd: '2025-03-31' },
    });
    for (const id of ['adoptionPenetration', 'trainingCoverage', 'dataReadiness', 'governanceCoverage', 'aiInvestmentGrowth']) {
      expect(c.byId[id].status).toBe('invalid');
      expect(c.byId[id].value).toBeNull();
      expect(c.byId[id].issues.some((i) => i.level === 'error')).toBe(true);
    }
  });

  it('reports missing data as not captured (null), not zero', () => {
    const c = entries({});
    expect(c.results.every((r) => r.value === null && r.status === 'missing')).toBe(true);
    const partial = entries({ monitoringCoverage: { numerator: 3 } });
    expect(partial.byId.monitoringCoverage.status).toBe('missing');
  });

  it('requires a period for monthly rates and validates prior-period ordering', () => {
    const noPeriod = entries({ productivityImpact: { numerator: 1000, denominator: 100 } });
    expect(noPeriod.byId.productivityImpact.status).toBe('invalid');
    const ok = entries({ productivityImpact: { numerator: 1200, denominator: 100, periodStart: '2025-04-01', periodEnd: '2026-03-31' } });
    expect(ok.byId.productivityImpact.value).toBeCloseTo(1200 / (100 * (365 / 30.4375)), 6);
    const overlap = entries({ aiInvestmentGrowth: { numerator: 2, denominator: 1, periodStart: '2025-04-01', periodEnd: '2026-03-31', priorStart: '2025-01-01', priorEnd: '2025-12-31' } });
    expect(overlap.byId.aiInvestmentGrowth.status).toBe('invalid');
  });

  it('warns when annual indicators cover different reporting periods', () => {
    const c = entries({
      aiSpendIntensity: { numerator: 1, denominator: 10, periodStart: '2025-04-01', periodEnd: '2026-03-31' },
      vendorConcentration: { numerator: 4, denominator: 10, periodStart: '2023-04-01', periodEnd: '2024-03-31' },
    });
    expect(c.periodWarnings).toHaveLength(1);
    expect(c.periodWarnings[0]).toMatch(/Reporting periods differ/);
  });

  it('warns when an annual indicator is not a 12-month period', () => {
    const c = entries({ aiSpendIntensity: { numerator: 1, denominator: 10, periodStart: '2025-04-01', periodEnd: '2025-09-30' } });
    expect(c.byId.aiSpendIntensity.issues.some((i) => /annual basis/.test(i.message))).toBe(true);
  });

  it('computes ROI = ((benefits − costs) / costs) × 100 and handles zero or missing costs safely', () => {
    expect(roiPercent(150, 100)).toBe(50);
    expect(roiPercent(50, 100)).toBe(-50);
    expect(roiPercent(0, 100)).toBe(-100);
    expect(roiPercent(100, 0)).toBeNull();
    expect(roiPercent(100, -5)).toBeNull();
    expect(roiPercent(-1, 100)).toBeNull();
    const a = createAssessment();
    a.roi.verifiedBenefits = 500;
    const noCost = computeRoi(a.roi);
    expect(noCost.roiVerified).toBeNull();
    expect(noCost.issues.some((i) => /ROI is undefined/.test(i.message))).toBe(true);
    a.roi.costs.platform = 0;
    expect(computeRoi(a.roi).roiVerified).toBeNull();
    a.roi.costs = { platform: 100, compute: 50, integration: 25, people: 25, governance: null, other: null };
    a.roi.verifiedBenefits = 300;
    const r = computeRoi(a.roi);
    expect(r.totalCosts).toBe(200);
    expect(r.roiVerified).toBe(50);
    expect(r.scoreVerified).toBe(3);
    a.roi.costs.other = -5;
    expect(computeRoi(a.roi).roiVerified).toBeNull();
  });

  it('keeps definitions faithful to the source list', () => {
    expect(INDICATOR_BY_ID.aiSpendIntensity.measurement).toBe('Annual AI expenditure as % of IT expenditure');
    expect(INDICATOR_BY_ID.vendorConcentration.measurement).toBe('% of AI spend with the largest provider');
  });
});

describe('recommendations and results consistency', () => {
  it('puts critical control remediation first and in the 0–6 month bucket', () => {
    const a = make((s) => { s.allVerified(3); s.verified('C02', 1); s.verified('D05', 1); });
    const r = computeResults(a);
    expect(r.recommendations[0].priority).toBe('critical');
    expect(r.recommendations[0].bucket).toBe('m0_6');
    expect(r.recommendations[0].questionIds).toContain('C02');
    expect(r.recommendations.every((x) => x.why && x.intervention && x.role && x.kpi && x.dependencies !== undefined)).toBe(true);
    expect(r.roadmap.m0_6[0].id).toBe(r.recommendations[0].id);
  });

  it('applies persisted user edits over generated recommendations', () => {
    const a = make((s) => { s.allVerified(3); s.verified('C02', 1); });
    const first = computeResults(a).recommendations[0];
    a.recommendationOverrides[first.id] = { priority: 'low', owner: 'CISO', status: 'in_progress', bucket: 'm12_24', notes: 'Edited' };
    const edited = computeResults(a).recommendations.find((x) => x.id === first.id)!;
    expect(edited.priority).toBe('low');
    expect(edited.owner).toBe('CISO');
    expect(edited.status).toBe('in_progress');
    expect(edited.edited).toBe(true);
    expect(computeResults(a).roadmap.m12_24.map((x) => x.id)).toContain(first.id);
  });

  it('derives every headline figure from one computation', () => {
    const a = make((s) => { s.allVerified(3); s.allSelf(4); });
    const r = computeResults(a);
    expect(r.maturity.index).toBeCloseTo(75, 10);
    expect(r.maturitySelf.index).toBeCloseTo(100, 10);
    expect(r.risk.score).toBeCloseTo(75, 10);
    expect(r.maturity.dimensions.reduce((s, d) => s + (d.contribution ?? 0), 0)).toBeCloseTo(75, 10);
    expect(r.strengths).toHaveLength(3);
    expect(r.priorityGaps.length).toBeGreaterThan(0);
  });

  it('keeps India diagnostics out of the core index', () => {
    const a = make((s) => s.allVerified(2));
    const before = computeResults(a).maturity.index;
    a.india.items.IN01 = { ...a.india.items.IN01, applicability: 'applicable', selfScore: 4, verifiedScore: 4 };
    a.india.items.IN02 = { ...a.india.items.IN02, applicability: 'not_applicable' };
    const r = computeResults(a);
    expect(r.maturity.index).toBe(before);
    expect(r.india.verifiedIndex).toBe(100);
    expect(r.india.applicable).toBe(1);
    expect(r.india.notApplicable).toBe(1);
    expect(r.indiaComposite).toBeNull(); // composite disabled by default
    a.config.india.showComposite = true;
    a.config.india.compositeWeightPct = 10;
    const withComp = computeResults(a);
    expect(withComp.indiaComposite).toBeCloseTo(0.9 * 50 + 0.1 * 100, 10);
    expect(withComp.maturity.index).toBe(before); // core still untouched
  });
});
