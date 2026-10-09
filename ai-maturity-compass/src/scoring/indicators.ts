/**
 * Quantitative indicators (source §5) and the ROI calculator (source §9.A).
 *
 * Principles: never divide by zero, never accept negative counts, never let a numerator exceed
 * its denominator for a percentage, never silently mix reporting periods, never turn missing
 * data into zero. Invalid or missing inputs yield `value: null`.
 */
import { INDICATORS, type IndicatorDef } from '../data/indicators';
import { roiToScore, type Score } from '../data/spec';
import type { IndicatorEntry, RoiInputs } from '../domain/schema';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

export type IndicatorStatus = 'ok' | 'missing' | 'invalid';

export interface IndicatorResult {
  id: string;
  def: IndicatorDef;
  status: IndicatorStatus;
  value: number | null;
  issues: Issue[];
  verified: boolean;
  periodStart: string;
  periodEnd: string;
  hasInput: boolean;
}

const DAY_MS = 86_400_000;
export const DAYS_PER_MONTH = 30.4375;

export function parseDate(s: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

/** Inclusive length of a period in days; null when the dates are missing or inverted. */
export function periodDays(start: string, end: string): number | null {
  const a = parseDate(start);
  const b = parseDate(end);
  if (a === null || b === null || b < a) return null;
  return Math.round((b - a) / DAY_MS) + 1;
}

const isNum = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

function periodIssues(def: IndicatorDef, entry: IndicatorEntry, needsMonths: boolean): Issue[] {
  const issues: Issue[] = [];
  const { periodStart: s, periodEnd: e } = entry;
  if (!s && !e) {
    issues.push({
      level: needsMonths ? 'error' : 'warning',
      message: needsMonths ? 'A reporting period is required to convert to a monthly rate.' : 'Reporting period not recorded.',
    });
    return issues;
  }
  const days = periodDays(s, e);
  if (days === null) {
    issues.push({ level: 'error', message: 'Reporting period is incomplete or the end date is before the start date.' });
    return issues;
  }
  if (def.period === 'annual' && (days < 350 || days > 380)) {
    issues.push({ level: 'warning', message: `This indicator is defined on an annual basis, but the period spans ${days} days.` });
  }
  if (def.needsPriorPeriod) {
    const pd = periodDays(entry.priorStart, entry.priorEnd);
    if (pd === null) {
      issues.push({ level: 'error', message: 'Prior period is required (and its end date must not precede its start date).' });
    } else {
      const ps = parseDate(entry.priorStart)!;
      const pe = parseDate(entry.priorEnd)!;
      const cs = parseDate(s)!;
      if (pe >= cs) issues.push({ level: 'error', message: 'Prior period must end before the current period starts.' });
      if (Math.abs(pd - days) / days > 0.15) {
        issues.push({ level: 'warning', message: `Prior period (${pd} days) and current period (${days} days) differ in length — growth would not be like-for-like.` });
      }
      if (ps > pe) issues.push({ level: 'error', message: 'Prior period dates are inverted.' });
    }
  }
  return issues;
}

export function computeIndicator(def: IndicatorDef, entry: IndicatorEntry, roi?: RoiResult): IndicatorResult {
  const base = {
    id: def.id,
    def,
    verified: entry.verified,
    periodStart: entry.periodStart,
    periodEnd: entry.periodEnd,
  };

  if (def.kind === 'roi') {
    const r = roi ?? computeRoi(undefined);
    const value = r.roiVerified ?? r.roiClaimed;
    return {
      ...base,
      status: value === null ? (r.hasInput ? 'invalid' : 'missing') : 'ok',
      value,
      issues: r.issues,
      verified: r.roiVerified !== null,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      hasInput: r.hasInput,
    };
  }

  const n = entry.numerator;
  const d = entry.denominator;
  const hasInput = isNum(n) || isNum(d);
  const issues: Issue[] = [];

  // Direct entry indicators only need the numerator.
  const needsDen = def.kind !== 'direct';
  if (!hasInput || !isNum(n) || (needsDen && !isNum(d))) {
    if (hasInput) {
      issues.push({
        level: 'warning',
        message: `Enter both ${def.numeratorLabel.toLowerCase()} and ${def.denominatorLabel?.toLowerCase() ?? 'the denominator'} to calculate this indicator.`,
      });
    }
    return { ...base, status: 'missing', value: null, issues, hasInput };
  }

  let invalid = false;
  const fail = (message: string) => {
    issues.push({ level: 'error', message });
    invalid = true;
  };

  if (n < 0) fail(`${def.numeratorLabel} cannot be negative.`);
  if (isNum(d) && d < 0) fail(`${def.denominatorLabel} cannot be negative.`);
  if (needsDen && isNum(d) && d === 0) {
    fail(`${def.denominatorLabel} must be greater than zero — a ratio against zero is undefined (not zero).`);
  }
  if ((def.numeratorUnit === 'employees' || def.numeratorUnit === 'pilots' || def.numeratorUnit === 'systems' || def.numeratorUnit === 'datasets' || def.numeratorUnit === 'use cases' || def.numeratorUnit === 'incidents') && Number.isFinite(n) && !Number.isInteger(n)) {
    fail(`${def.numeratorLabel} must be a whole number of ${def.numeratorUnit}.`);
  }
  if (def.denominatorUnit && ['employees', 'pilots', 'systems', 'datasets', 'transactions'].includes(def.denominatorUnit) && isNum(d) && !Number.isInteger(d)) {
    fail(`${def.denominatorLabel} must be a whole number of ${def.denominatorUnit}.`);
  }
  if (def.kind === 'pct' && isNum(d) && d > 0 && n > d) {
    fail(`${def.numeratorLabel} (${n}) cannot exceed ${def.denominatorLabel?.toLowerCase()} (${d}) for a percentage.`);
  }
  if (def.kind === 'direct' && isNum(d) && d < 0) fail('Sample size cannot be negative.');

  issues.push(...periodIssues(def, entry, def.kind === 'per_unit_month'));
  if (issues.some((i) => i.level === 'error')) invalid = true;
  if (invalid) return { ...base, status: 'invalid', value: null, issues, hasInput };

  let value: number;
  const den = d as number;
  switch (def.kind) {
    case 'pct':
      value = (n / den) * 100;
      break;
    case 'per_1000':
      value = (n / den) * 1000;
      break;
    case 'per_100':
      value = (n / den) * 100;
      break;
    case 'growth':
      value = ((n - den) / den) * 100;
      break;
    case 'per_unit_month': {
      const days = periodDays(entry.periodStart, entry.periodEnd)!;
      value = n / (den * (days / DAYS_PER_MONTH));
      break;
    }
    case 'cost_per_txn':
      value = (n * 100_000) / den;
      break;
    case 'direct':
      value = n;
      break;
    default:
      value = NaN;
  }
  if (!Number.isFinite(value)) {
    return { ...base, status: 'invalid', value: null, issues: [...issues, { level: 'error', message: 'Result is not a finite number.' }], hasInput };
  }
  return { ...base, status: 'ok', value, issues, hasInput };
}

// ---------------------------------------------------------------------------
// ROI calculator
// ---------------------------------------------------------------------------
export interface RoiResult {
  hasInput: boolean;
  claimedBenefits: number | null;
  verifiedBenefits: number | null;
  totalCosts: number | null;
  /** ROI on assessor-verified benefits (the source definition). Null when not computable. */
  roiVerified: number | null;
  /** ROI on benefits claimed by the organization — shown separately, never substituted. */
  roiClaimed: number | null;
  scoreVerified: Score | null;
  scoreClaimed: Score | null;
  issues: Issue[];
  periodStart: string;
  periodEnd: string;
}

const sum = (vals: (number | null | undefined)[]): number | null => {
  const nums = vals.filter(isNum);
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
};

/** ROI (%) = ((Verified AI Benefits − Total AI Costs) / Total AI Costs) × 100 */
export function roiPercent(benefits: number, costs: number): number | null {
  if (!Number.isFinite(benefits) || !Number.isFinite(costs) || costs <= 0 || benefits < 0) return null;
  return ((benefits - costs) / costs) * 100;
}

export function computeRoi(inputs: RoiInputs | undefined): RoiResult {
  const empty: RoiResult = {
    hasInput: false, claimedBenefits: null, verifiedBenefits: null, totalCosts: null,
    roiVerified: null, roiClaimed: null, scoreVerified: null, scoreClaimed: null, issues: [],
    periodStart: '', periodEnd: '',
  };
  if (!inputs) return empty;
  const claimedParts = Object.values(inputs.claimed);
  const costParts = Object.values(inputs.costs);
  const all = [...claimedParts, ...costParts, inputs.verifiedBenefits];
  const hasInput = all.some(isNum);
  const issues: Issue[] = [];

  const negative = all.some((v) => isNum(v) && v < 0);
  if (negative) issues.push({ level: 'error', message: 'Benefits and costs cannot be negative. Enter reductions as zero benefit, not negative cost.' });

  const claimedBenefits = sum(claimedParts);
  const totalCosts = sum(costParts);
  const verifiedBenefits = isNum(inputs.verifiedBenefits) ? inputs.verifiedBenefits : null;

  if (hasInput && (inputs.periodStart || inputs.periodEnd)) {
    const days = periodDays(inputs.periodStart, inputs.periodEnd);
    if (days === null) issues.push({ level: 'error', message: 'ROI period is incomplete or inverted.' });
    else if (days < 350 || days > 380) issues.push({ level: 'warning', message: `Source guidance is the most recent 12 months; this period spans ${days} days. Benefits and costs must cover the same period.` });
  } else if (hasInput) {
    issues.push({ level: 'warning', message: 'Record the period the benefits and costs relate to (generally the most recent 12 months). Benefits and costs must cover the same period.' });
  }

  if (hasInput && (totalCosts === null || totalCosts <= 0)) {
    issues.push({ level: 'warning', message: 'Total AI costs are missing or zero, so ROI is undefined. Enter fully loaded implementation and operating costs.' });
  }
  if (verifiedBenefits !== null && claimedBenefits !== null && verifiedBenefits > claimedBenefits) {
    issues.push({ level: 'warning', message: 'Verified benefits exceed claimed benefits — confirm the verified figure and avoid double-counting.' });
  }

  const blocked = negative || issues.some((i) => i.level === 'error');
  const roiVerified = !blocked && verifiedBenefits !== null && totalCosts !== null ? roiPercent(verifiedBenefits, totalCosts) : null;
  const roiClaimed = !blocked && claimedBenefits !== null && totalCosts !== null ? roiPercent(claimedBenefits, totalCosts) : null;
  return {
    hasInput,
    claimedBenefits,
    verifiedBenefits,
    totalCosts,
    roiVerified,
    roiClaimed,
    scoreVerified: roiVerified === null ? null : roiToScore(roiVerified),
    scoreClaimed: roiClaimed === null ? null : roiToScore(roiClaimed),
    issues,
    periodStart: inputs.periodStart,
    periodEnd: inputs.periodEnd,
  };
}

// ---------------------------------------------------------------------------
// Whole-module computation + cross-indicator period consistency
// ---------------------------------------------------------------------------
export interface IndicatorsComputation {
  results: IndicatorResult[];
  byId: Record<string, IndicatorResult>;
  roi: RoiResult;
  periodWarnings: string[];
  captured: number;
  total: number;
}

export function computeIndicators(entries: Record<string, IndicatorEntry>, roiInputs: RoiInputs): IndicatorsComputation {
  const roi = computeRoi(roiInputs);
  const results = INDICATORS.map((def) => computeIndicator(def, entries[def.id] ?? ({} as IndicatorEntry), roi));
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));

  // Annual-basis indicators should describe the same 12 months.
  const periodWarnings: string[] = [];
  const annual = results.filter((r) => r.def.period === 'annual' && r.status === 'ok' && r.periodStart && r.periodEnd);
  if (annual.length > 1) {
    const ref = annual[0];
    const rs = parseDate(ref.periodStart);
    const re = parseDate(ref.periodEnd);
    const mismatched = annual.filter((r) => {
      const s = parseDate(r.periodStart);
      const e = parseDate(r.periodEnd);
      return s !== null && e !== null && rs !== null && re !== null && (Math.abs(s - rs) > 31 * DAY_MS || Math.abs(e - re) > 31 * DAY_MS);
    });
    if (mismatched.length > 0) {
      const msg = `Reporting periods differ across annual indicators (${ref.def.name}: ${ref.periodStart} to ${ref.periodEnd}; ${mismatched
        .map((m) => `${m.def.name}: ${m.periodStart} to ${m.periodEnd}`)
        .join('; ')}). Do not compare or combine them without aligning the period.`;
      periodWarnings.push(msg);
      for (const m of mismatched) {
        results[results.findIndex((x) => x.id === m.id)].issues.push({ level: 'warning', message: 'Reporting period differs from other annual indicators.' });
      }
    }
  }

  return {
    results,
    byId,
    roi,
    periodWarnings,
    captured: results.filter((r) => r.status === 'ok').length,
    total: results.length,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const nf = (decimals: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function formatIndicatorValue(r: IndicatorResult): string {
  if (r.value === null) return r.status === 'invalid' ? 'Invalid input' : 'Not captured';
  const text = nf(r.def.decimals).format(r.value);
  switch (r.def.kind) {
    case 'cost_per_txn':
      return `₹${text}`;
    case 'direct':
      return `${text} days`;
    case 'per_unit_month':
      return `${text} h`;
    case 'pct':
    case 'growth':
    case 'roi':
      return `${text}%`;
    default:
      return text;
  }
}

/** Format an amount held in ₹ lakh using Indian units. */
export function formatInr(lakh: number | null | undefined, opts?: { ascii?: boolean }): string {
  if (lakh === null || lakh === undefined || !Number.isFinite(lakh)) return '—';
  const sign = lakh < 0 ? '-' : '';
  const v = Math.abs(lakh);
  const prefix = opts?.ascii ? 'INR ' : '₹';
  if (v >= 100) return `${sign}${prefix}${nf(2).format(v / 100)} crore`;
  return `${sign}${prefix}${nf(2).format(v)} lakh`;
}

export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return nf(decimals).format(n);
}
