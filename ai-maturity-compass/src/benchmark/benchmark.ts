/**
 * Benchmarking data model and the SYNTHETIC demonstration dataset.
 *
 * Three provenance classes are kept apart everywhere in the app:
 *   synthetic_demo     — generated here with a seeded PRNG. Illustrative only. NOT real industry data.
 *   local_assessment   — assessments actually stored in this browser (demo assessments excluded).
 *   external_supplied  — records a user imports with provenance. This app cannot independently
 *                        validate them; the import only records what the supplier attests.
 *
 * Real anonymized records can be introduced later by importing a file in the documented schema
 * (see `externalBenchmarkFileSchema`) or by replacing `generateSyntheticBenchmarks`.
 */
import { DIMENSIONS, classify, type ClassificationId } from '../data/spec';
import type { Assessment, BenchmarkRecord } from '../domain/schema';
import { computeResults } from '../scoring/results';

export const SYNTHETIC_NOTICE =
  'Illustrative demonstration benchmarks: generated pseudo-randomly by this prototype. They are not real organizations, not industry averages and not national rankings.';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (n: number, lo = 3, hi = 96) => Math.min(hi, Math.max(lo, n));

interface SectorProfile {
  sector: string;
  base: number;
  types: { type: string; w: number }[];
  weight: number;
}

const SECTOR_PROFILES: SectorProfile[] = [
  { sector: 'Banking & Financial Services', base: 0.6, weight: 16, types: [{ type: 'private_enterprise', w: 8 }, { type: 'psu', w: 3 }, { type: 'gcc', w: 1 }] },
  { sector: 'Insurance', base: 0.54, weight: 8, types: [{ type: 'private_enterprise', w: 6 }, { type: 'psu', w: 2 }] },
  { sector: 'Manufacturing & Industrial', base: 0.46, weight: 14, types: [{ type: 'private_enterprise', w: 6 }, { type: 'msme', w: 6 }, { type: 'psu', w: 1 }] },
  { sector: 'Retail & Consumer Goods', base: 0.5, weight: 10, types: [{ type: 'private_enterprise', w: 7 }, { type: 'msme', w: 3 }] },
  { sector: 'Healthcare & Life Sciences', base: 0.44, weight: 8, types: [{ type: 'private_enterprise', w: 6 }, { type: 'msme', w: 2 }, { type: 'government', w: 1 }] },
  { sector: 'IT Services & GCC', base: 0.68, weight: 12, types: [{ type: 'private_enterprise', w: 5 }, { type: 'gcc', w: 6 }, { type: 'msme', w: 1 }] },
  { sector: 'Telecom & Media', base: 0.58, weight: 6, types: [{ type: 'private_enterprise', w: 5 }, { type: 'psu', w: 1 }] },
  { sector: 'Energy, Power & Utilities', base: 0.41, weight: 7, types: [{ type: 'psu', w: 5 }, { type: 'private_enterprise', w: 3 }] },
  { sector: 'Central / State Government', base: 0.37, weight: 12, types: [{ type: 'government', w: 1 }] },
  { sector: 'Public Sector (Other)', base: 0.4, weight: 7, types: [{ type: 'psu', w: 3 }, { type: 'government', w: 1 }] },
];

const SIZE_OFFSET: Record<string, number> = { micro_small: -0.09, medium: -0.03, large: 0.03, very_large: 0.07 };
const TYPE_OFFSET: Record<string, number> = { gcc: 0.05, msme: -0.05, government: -0.02, psu: -0.01, private_enterprise: 0.01 };
/** Relative strength per dimension (S,G,D,T,U,H,R,C,V,I,O,F). Illustrative texture only. */
const DIM_SHAPE = [0.03, 0.01, -0.01, 0.02, 0.0, -0.03, -0.04, 0.0, -0.05, 0.02, 0.01, -0.03];

function pick<T extends { w: number }>(rand: () => number, items: T[]): T {
  const total = items.reduce((a, b) => a + b.w, 0);
  let r = rand() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export function generateSyntheticBenchmarks(count = 360, seed = 20260101): BenchmarkRecord[] {
  const rand = mulberry32(seed);
  const out: BenchmarkRecord[] = [];
  const sizesFor = (type: string) =>
    type === 'msme' ? [{ s: 'micro_small', w: 8 }, { s: 'medium', w: 2 }]
      : type === 'government' ? [{ s: 'large', w: 5 }, { s: 'very_large', w: 3 }, { s: 'medium', w: 2 }]
        : [{ s: 'micro_small', w: 2 }, { s: 'medium', w: 4 }, { s: 'large', w: 5 }, { s: 'very_large', w: 4 }];

  for (let i = 0; i < count; i++) {
    const sec = pick(rand, SECTOR_PROFILES.map((s) => ({ ...s, w: s.weight })));
    const type = pick(rand, sec.types.map((t) => ({ ...t })));
    const size = pick(rand, sizesFor(type.type).map((x) => ({ ...x }))).s;
    const period = rand() < 0.4 ? 'FY2024-25' : 'FY2025-26';
    const level = sec.base + (SIZE_OFFSET[size] ?? 0) + (TYPE_OFFSET[type.type] ?? 0) + (period === 'FY2025-26' ? 0.03 : 0) + gaussian(rand) * 0.07;
    const dims = DIMENSIONS.map((_, di) => clamp((level + DIM_SHAPE[di] + gaussian(rand) * 0.06) * 100));
    const maturity = DIMENSIONS.reduce((s, d, di) => s + (d.weight * dims[di]) / 100, 0);
    const idx = (ids: string[]) => ids.map((id) => dims[DIMENSIONS.findIndex((d) => d.id === id)]);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const risk = clamp(avg(idx(['G', 'R', 'C'])) * 0.75 + avg(idx(['D', 'F', 'S'])) * 0.25 + gaussian(rand) * 3);
    const value = clamp(avg(idx(['V', 'U', 'F'])) * 0.9 + gaussian(rand) * 5 - 4);
    out.push({
      id: `syn-${String(i + 1).padStart(4, '0')}`,
      source: 'synthetic_demo',
      sector: sec.sector,
      orgType: type.type,
      sizeCategory: size,
      period,
      dimensionScores: dims.map((d) => Math.round(d * 100) / 100),
      maturityIndex: Math.round(maturity * 100) / 100,
      riskGovernance: Math.round(risk * 100) / 100,
      valueRealization: Math.round(value * 100) / 100,
      label: `Synthetic record ${i + 1}`,
    });
  }
  return out;
}

let cache: BenchmarkRecord[] | null = null;
export function syntheticBenchmarks(): BenchmarkRecord[] {
  cache ??= generateSyntheticBenchmarks();
  return cache;
}

/** Local assessments → benchmark records. Provisional/unscored assessments are excluded and counted. */
export function localBenchmarkRecords(assessments: Assessment[]): { records: BenchmarkRecord[]; excluded: { id: string; name: string; reason: string }[] } {
  const records: BenchmarkRecord[] = [];
  const excluded: { id: string; name: string; reason: string }[] = [];
  for (const a of assessments) {
    if (a.isDemo) {
      excluded.push({ id: a.id, name: a.name, reason: 'Illustrative demonstration assessment (synthetic) — not an actual assessment' });
      continue;
    }
    if (a.status === 'draft') {
      excluded.push({ id: a.id, name: a.name, reason: 'Draft — profile not complete' });
      continue;
    }
    const r = computeResults(a);
    if (r.maturity.index === null || r.maturity.dimensions.some((d) => d.normalized === null)) {
      excluded.push({ id: a.id, name: a.name, reason: 'Not every dimension has a verified score — cannot be compared dimension by dimension' });
      continue;
    }
    records.push({
      id: a.id,
      source: 'local_assessment',
      sector: a.profile.industry || 'Unspecified',
      orgType: a.profile.orgType || 'other',
      sizeCategory: a.profile.sizeCategory || 'unspecified',
      period: a.profile.periodLabel || 'Unspecified',
      dimensionScores: r.maturity.dimensions.map((d) => d.normalized as number),
      maturityIndex: r.maturity.index,
      riskGovernance: r.risk.score ?? 0,
      valueRealization: r.value.score ?? 0,
      label: a.name,
    });
  }
  return { records, excluded };
}

export interface BenchmarkFilters {
  sector: string;
  orgType: string;
  size: string;
  period: string;
  classification: string;
}
export const ANY = 'any';
export const EMPTY_FILTERS: BenchmarkFilters = { sector: ANY, orgType: ANY, size: ANY, period: ANY, classification: ANY };

export function applyFilters(records: BenchmarkRecord[], f: BenchmarkFilters): BenchmarkRecord[] {
  return records.filter(
    (r) =>
      (f.sector === ANY || r.sector === f.sector) &&
      (f.orgType === ANY || r.orgType === f.orgType) &&
      (f.size === ANY || r.sizeCategory === f.size) &&
      (f.period === ANY || r.period === f.period) &&
      (f.classification === ANY || classify(r.maturityIndex).id === (f.classification as ClassificationId)),
  );
}

export interface Dist {
  n: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function distribution(values: number[]): Dist {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, mean: null, median: null, p25: null, p75: null, min: null, max: null };
  return {
    n: v.length,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    median: quantile(v, 0.5),
    p25: quantile(v, 0.25),
    p75: quantile(v, 0.75),
    min: v[0],
    max: v[v.length - 1],
  };
}

/** Smallest cohort for which summary statistics are shown without a warning. */
export const MIN_COHORT = 8;

export function percentileRank(values: number[], x: number): number | null {
  if (values.length === 0) return null;
  const below = values.filter((v) => v < x).length;
  const equal = values.filter((v) => v === x).length;
  return ((below + 0.5 * equal) / values.length) * 100;
}

export function histogram(values: number[], bins = 10): { from: number; to: number; count: number }[] {
  const out = Array.from({ length: bins }, (_, i) => ({ from: (100 / bins) * i, to: (100 / bins) * (i + 1), count: 0 }));
  for (const v of values) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(v / (100 / bins))));
    out[i].count++;
  }
  return out;
}
