import { DEFAULT_SCORING_CONFIG, QUESTION_IDS } from '../data/spec';
import { INDICATORS } from '../data/indicators';
import { INDIA_DIAGNOSTICS } from '../data/india';
import {
  assessmentSchema,
  indicatorEntrySchema,
  indiaItemSchema,
  profileSchema,
  responseSchema,
  scoringConfigSchema,
  type Assessment,
  type IndicatorEntry,
  type Profile,
  type Response,
  type Score,
} from './schema';

export function uid(prefix = 'a'): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const rand =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`;
}

export const nowIso = (): string => new Date().toISOString();

export function blankResponse(): Response {
  return responseSchema.parse({});
}

export function blankIndicator(): IndicatorEntry {
  return indicatorEntrySchema.parse({});
}

export function blankProfile(): Profile {
  return profileSchema.parse({});
}

/** Fills every structure an assessment needs so the UI never has to handle missing keys. */
export function fillAssessment(a: Assessment): Assessment {
  const responses: Record<string, Response> = {};
  for (const id of QUESTION_IDS) responses[id] = repairResponse(a.responses[id] ?? blankResponse());
  const indicators: Record<string, IndicatorEntry> = {};
  for (const i of INDICATORS) indicators[i.id] = a.indicators[i.id] ?? blankIndicator();
  const items: Assessment['india']['items'] = {};
  for (const d of INDIA_DIAGNOSTICS) items[d.id] = a.india.items[d.id] ?? indiaItemSchema.parse({});
  return { ...a, responses, indicators, india: { ...a.india, items } };
}

/**
 * Enforce the invariants the scoring engine relies on: a score is present exactly when
 * the state is "scored". Never invents a score, never turns a gap into a zero.
 */
export function repairResponse(r: Response): Response {
  const selfScore = r.self.state === 'scored' ? r.self.score : null;
  const self =
    r.self.state === 'scored' && selfScore === null
      ? { state: 'unanswered' as const, score: null }
      : { state: r.self.state, score: selfScore };
  const verifiedScore = r.verified.state === 'scored' ? r.verified.score : null;
  const verified =
    r.verified.state === 'scored' && verifiedScore === null
      ? { ...r.verified, state: 'pending' as const, score: null }
      : { ...r.verified, score: verifiedScore };
  return { ...r, self, verified };
}

export function createAssessment(partial?: { name?: string; profile?: Partial<Profile>; id?: string; isDemo?: boolean }): Assessment {
  const now = nowIso();
  const base = assessmentSchema.parse({
    id: partial?.id ?? uid('asm'),
    name: partial?.name ?? 'New assessment',
    createdAt: now,
    updatedAt: now,
    isDemo: partial?.isDemo ?? false,
    profile: { ...blankProfile(), ...(partial?.profile ?? {}) },
    config: scoringConfigSchema.parse(DEFAULT_SCORING_CONFIG),
    activity: [{ at: now, event: 'Created', detail: '' }],
  });
  return fillAssessment(base);
}

export function setSelfScore(r: Response, score: Score): Response {
  return { ...r, self: { state: 'scored', score } };
}

/** Parse + repair arbitrary stored JSON. Returns null when the record is unusable. */
export function parseAssessment(raw: unknown): Assessment | null {
  const res = assessmentSchema.safeParse(raw);
  if (!res.success) return null;
  return fillAssessment(res.data);
}
