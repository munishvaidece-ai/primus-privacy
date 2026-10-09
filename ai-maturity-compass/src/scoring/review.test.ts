import { describe, expect, it } from 'vitest';
import { createAssessment, repairResponse } from '../domain/factory';
import { createDemoAssessment } from '../store/seed/demo';
import { computeResults } from './results';
import { reviewAssessment } from './review';

describe('pre-submission review', () => {
  it('flags unanswered, awaiting and unconfirmed items on a blank assessment — without blockers', () => {
    const a = createAssessment({ name: 'Blank' });
    const issues = reviewAssessment(a, computeResults(a));
    expect(issues.find((i) => i.id === 'unanswered')!.questionIds).toHaveLength(100);
    expect(issues.find((i) => i.id === 'awaiting')!.questionIds).toHaveLength(100);
    expect(issues.some((i) => i.level === 'blocker')).toBe(false);
  });

  it('blocks submission when evidence is accepted without a reference', () => {
    const a = createAssessment({ name: 'X' });
    a.responses.S01.evidence = { status: 'accepted', reference: '' };
    const blockers = reviewAssessment(a, computeResults(a)).filter((i) => i.level === 'blocker');
    expect(blockers).toHaveLength(1);
    expect(blockers[0].questionIds).toEqual(['S01']);
  });

  it('reports the demo gate needing a decision and critical-control gaps', () => {
    const a = createDemoAssessment();
    const issues = reviewAssessment(a, computeResults(a));
    expect(issues.some((i) => i.id === 'gate-review')).toBe(true);
    expect(issues.some((i) => i.id === 'gap2')).toBe(true);
  });
});

describe('response invariants', () => {
  it('never keeps a scored state without a score (a gap is not silently a zero)', () => {
    const a = createAssessment({ name: 'X' });
    const broken = { ...a.responses.S01, self: { state: 'scored' as const, score: null }, verified: { state: 'scored' as const, score: null, at: null } };
    const fixed = repairResponse(broken);
    expect(fixed.self).toEqual({ state: 'unanswered', score: null });
    expect(fixed.verified.state).toBe('pending');
    const ok = repairResponse({ ...a.responses.S01, self: { state: 'dont_know', score: 3 } });
    expect(ok.self.score).toBeNull();
  });
});
