/**
 * Chart components. Every chart takes computed results as props — nothing is hardcoded.
 * Identity is never colour-alone: legends, direct labels, hatching for gaps, and per-mark tooltips.
 */
import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CLASSIFICATIONS, DIMENSIONS, QUESTIONS, SCALE_BY_SCORE, type Classification, type DimensionId } from '../../data/spec';
import type { Response } from '../../domain/schema';
import type { IndexResult } from '../../scoring/maturity';
import { evalQuestion } from '../../scoring/questionState';
import { COLORS, SCORE_FILL, SCORE_TEXT } from './colors';

// ------------------------------------------------------------------ Score ring
export function ScoreRing({ value, size = 132, stroke = 11, color = COLORS.verified, label, sub, dashed }: {
  value: number | null; size?: number; stroke?: number; color?: string; label: string; sub?: string; dashed?: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${value === null ? 'not available' : `${value.toFixed(1)} out of 100`}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E4EBF3" strokeWidth={stroke} />
        {value !== null && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={dashed ? `${c * pct * 0.97} ${c}` : `${c * pct} ${c}`} style={{ transition: 'stroke-dasharray .4s' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-semibold leading-none tabular-nums text-ink">{value === null ? '—' : value.toFixed(1)}</span>
        {sub && <span className="mt-1 text-[11px] text-muted">{sub}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Radar
export interface RadarRow { id: DimensionId; name: string; verified: number | null; self: number | null; bench?: number | null }

export function RadarDimensions({ rows, onSelect, height = 340, benchLabel = 'Cohort median (synthetic)' }: { rows: RadarRow[]; onSelect?: (id: DimensionId) => void; height?: number; benchLabel?: string }) {
  const hasBench = rows.some((r) => r.bench !== undefined && r.bench !== null);
  const W = 560;
  const H = Math.max(300, height - 36);
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W / 2 - 92, H / 2 - 30);
  const n = rows.length;
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i: number, v: number): [number, number] => [cx + ((R * v) / 100) * Math.cos(ang(i)), cy + ((R * v) / 100) * Math.sin(ang(i))];
  const poly = (vals: (number | null | undefined)[]) => vals.map((v, i) => pt(i, v ?? 0).join(',')).join(' ');
  const series = [
    ...(hasBench ? [{ key: 'bench', name: benchLabel, color: COLORS.bench, vals: rows.map((r) => r.bench), fill: 0.07, dash: undefined as string | undefined }] : []),
    { key: 'verified', name: 'Assessor-verified', color: COLORS.verified, vals: rows.map((r) => r.verified), fill: 0.2, dash: undefined as string | undefined },
    { key: 'self', name: 'Self-reported', color: COLORS.self, vals: rows.map((r) => r.self), fill: 0.03, dash: '5 3' },
  ].filter((s) => s.vals.some((v) => v !== null && v !== undefined));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[640px]" role="img" aria-label="Radar chart of twelve dimension scores. A data table with the same values is available below the chart." style={{ maxHeight: height }}>
        {[25, 50, 75, 100].map((v) => <polygon key={v} points={rows.map((_, i) => pt(i, v).join(',')).join(' ')} fill="none" stroke={COLORS.grid} strokeWidth={1} />)}
        {rows.map((_, i) => <line key={i} x1={cx} y1={cy} x2={pt(i, 100)[0]} y2={pt(i, 100)[1]} stroke={COLORS.grid} strokeWidth={1} />)}
        {[25, 50, 75, 100].map((v) => <text key={v} x={cx + 3} y={cy - (R * v) / 100 + 11} fontSize={9.5} fill={COLORS.axis}>{v}</text>)}
        {series.map((s) => (
          <g key={s.key}>
            <polygon points={poly(s.vals)} fill={s.color} fillOpacity={s.fill} stroke={s.color} strokeWidth={s.key === 'verified' ? 2.25 : 2} strokeDasharray={s.dash} strokeLinejoin="round" />
            {s.key !== 'self' && s.vals.map((v, i) => v === null || v === undefined ? null : (
              <circle key={i} cx={pt(i, v)[0]} cy={pt(i, v)[1]} r={3.5} fill={s.color} stroke="#fff" strokeWidth={1.5}><title>{`${rows[i].name} — ${s.name}: ${v.toFixed(1)}`}</title></circle>
            ))}
          </g>
        ))}
        {rows.map((r, i) => {
          const [x, y] = pt(i, 100);
          const dx = Math.cos(ang(i));
          const dy = Math.sin(ang(i));
          const lx = x + dx * 12;
          const ly = y + dy * 12 + 4;
          const anchor = Math.abs(dx) < 0.25 ? 'middle' : dx > 0 ? 'start' : 'end';
          const label = r.verified === null ? `${r.name} (n/s)` : r.name;
          return (
            <g
              key={r.id} tabIndex={onSelect ? 0 : undefined} role={onSelect ? 'link' : undefined} aria-label={`${r.name}: verified ${r.verified === null ? 'unscored' : r.verified.toFixed(1)}, self-reported ${r.self === null ? 'unscored' : r.self.toFixed(1)}${onSelect ? '. Open dimension' : ''}`}
              onClick={() => onSelect?.(r.id)} onKeyDown={(e) => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(r.id); } }}
              style={{ cursor: onSelect ? 'pointer' : 'default' }} className="outline-none focus-visible:[&>text]:underline"
            >
              <text x={lx} y={ly} textAnchor={anchor} fontSize={12} fill={COLORS.ink}>{label}</text>
              <title>{`${r.name} — verified ${r.verified === null ? 'unscored' : r.verified.toFixed(1)}; self-reported ${r.self === null ? 'unscored' : r.self.toFixed(1)}`}</title>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-ink" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} /></svg>
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ Dimension bars
export function DimensionBars({ rows, onSelect, height = 420 }: { rows: RadarRow[]; onSelect?: (id: DimensionId) => void; height?: number }) {
  const data = rows.map((r) => ({ ...r, verifiedPlot: r.verified ?? 0, selfPlot: r.self ?? 0 }));
  return (
    <div style={{ height }} role="img" aria-label="Bar chart comparing verified and self-reported scores for each of the twelve dimensions.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 8 }} barCategoryGap={7} barGap={2}>
          <CartesianGrid horizontal={false} stroke={COLORS.grid} />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: COLORS.axis }} tickLine={false} axisLine={{ stroke: COLORS.grid }} />
          <YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 12, fill: COLORS.ink }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: 'rgba(11,31,58,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as RadarRow;
              return (
                <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-pop">
                  <div className="font-semibold mb-1">{p.name}</div>
                  <div>Verified: {p.verified === null ? 'unscored' : p.verified.toFixed(1)}</div>
                  <div>Self-reported: {p.self === null ? 'unscored' : p.self.toFixed(1)}</div>
                  {onSelect && <div className="mt-1 text-muted">Click to open</div>}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar name="Assessor-verified" dataKey="verifiedPlot" fill={COLORS.verified} barSize={9} radius={[0, 4, 4, 0]} onClick={(d) => onSelect?.((d as unknown as RadarRow).id)} cursor={onSelect ? 'pointer' : undefined} />
          <Bar name="Self-reported" dataKey="selfPlot" fill={COLORS.self} barSize={9} radius={[0, 4, 4, 0]} onClick={(d) => onSelect?.((d as unknown as RadarRow).id)} cursor={onSelect ? 'pointer' : undefined} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------ Distribution (stacked, per dimension)
export function DistributionStack({ responses, onSelect, basis = 'verified' }: { responses: Record<string, Response>; onSelect?: (id: DimensionId) => void; basis?: 'verified' | 'self' }) {
  const rows = DIMENSIONS.map((d) => {
    const counts = { s0: 0, s1: 0, s2: 0, s3: 0, s4: 0, na: 0, gap: 0, pending: 0 };
    for (const q of QUESTIONS.filter((x) => x.dimensionId === d.id)) {
      const e = evalQuestion(responses[q.id], basis);
      if (e.state === 'scored') counts[`s${e.score}` as 's0'] += 1;
      else if (e.state === 'not_applicable') counts.na += 1;
      else if (e.state === 'unverified') counts.gap += 1;
      else counts.pending += 1;
    }
    return { d, counts };
  });
  const segs: { key: keyof (typeof rows)[0]['counts']; label: string; cls?: string; style?: React.CSSProperties; text?: string }[] = [
    ...[0, 1, 2, 3, 4].map((s) => ({ key: `s${s}` as 's0', label: `${s} — ${SCALE_BY_SCORE[s as 0].label}`, style: { background: SCORE_FILL[s], color: SCORE_TEXT[s] } })),
    { key: 'na', label: 'Not applicable (excluded)', cls: 'hatch-na', text: '#0B1F3A' },
    { key: 'gap', label: "Don't know / not verified (evidence gap)", cls: 'hatch-gap', text: '#0B1F3A' },
    { key: 'pending', label: 'Awaiting assessment', cls: 'bg-white border border-dashed border-navy-300', text: '#52627A' },
  ];
  return (
    <div>
      <ul className="space-y-1.5" aria-label="Distribution of question outcomes by dimension">
        {rows.map(({ d, counts }) => (
          <li key={d.id} className="flex items-center gap-2">
            <button type="button" onClick={() => onSelect?.(d.id)} className="w-28 shrink-0 truncate text-left text-xs text-ink hover:underline" title={d.name}>{d.shortName}</button>
            <div className="flex h-6 flex-1 overflow-hidden rounded">
              {segs.map((s) => {
                const n = counts[s.key];
                if (!n) return null;
                return (
                  <div
                    key={s.key} className={clsx('flex items-center justify-center text-[11px] font-medium border-r border-white/80 last:border-r-0', s.cls)}
                    style={{ width: `${(n / d.questionCount) * 100}%`, ...(s.style ?? {}), color: s.style?.color ?? s.text }}
                    title={`${d.name}: ${n} question${n > 1 ? 's' : ''} — ${s.label}`}
                  >
                    {n}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted" aria-label="Legend">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={clsx('inline-block h-3 w-4 rounded-sm', s.cls)} style={s.style} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ Control heatmap
export interface HeatGroup { label: string; sub?: string; ids: string[] }

export function ControlHeatmap({ responses, groups, criticalIds, deficiencyThreshold, onSelect, basis = 'verified' }: {
  responses: Record<string, Response>; groups: HeatGroup[]; criticalIds: Set<string>; deficiencyThreshold: number; onSelect?: (id: string) => void; basis?: 'verified' | 'self';
}) {
  return (
    <div>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.label} className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-x-3 gap-y-1 items-center">
            <div>
              <div className="text-[13px] font-medium leading-tight">{g.label}</div>
              {g.sub && <div className="text-[11px] text-muted">{g.sub}</div>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.ids.map((id) => {
                const e = evalQuestion(responses[id], basis);
                const deficient = e.state === 'scored' && criticalIds.has(id) && (e.score as number) <= deficiencyThreshold;
                const base = 'relative h-9 w-11 rounded-md text-[11px] leading-tight flex flex-col items-center justify-center transition-transform hover:scale-105';
                let content: ReactNode;
                let style: React.CSSProperties | undefined;
                let cls = '';
                let label: string;
                if (e.state === 'scored') {
                  const s = e.score as number;
                  style = { background: SCORE_FILL[s], color: SCORE_TEXT[s] };
                  content = <><span className="opacity-80">{id}</span><span className="text-[13px] font-bold">{s}</span></>;
                  label = `${id}: score ${s}, ${SCALE_BY_SCORE[s as 0].label}${deficient ? ', critical deficiency' : ''}`;
                } else if (e.state === 'not_applicable') {
                  cls = 'hatch-na text-navy-800';
                  content = <><span>{id}</span><span className="font-bold">N/A</span></>;
                  label = `${id}: not applicable, excluded`;
                } else if (e.state === 'unverified') {
                  cls = 'hatch-gap text-navy-900';
                  content = <><span>{id}</span><span className="font-bold">?</span></>;
                  label = `${id}: evidence gap, don't know or not verified`;
                } else {
                  cls = 'bg-white border border-dashed border-navy-300 text-muted';
                  content = <><span>{id}</span><span>…</span></>;
                  label = `${id}: awaiting assessment`;
                }
                return (
                  <button
                    key={id} type="button" onClick={() => onSelect?.(id)} className={clsx(base, cls, deficient && 'ring-2 ring-offset-1')}
                    style={{ ...style, ...(deficient ? { ['--tw-ring-color' as string]: COLORS.critical } : {}) }}
                    aria-label={label} title={label}
                  >
                    {content}
                    {deficient && <AlertTriangle className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-white text-bad" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted" aria-label="Heatmap legend">
        {[0, 1, 2, 3, 4].map((s) => (
          <li key={s} className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: SCORE_FILL[s] }} />{s} {SCALE_BY_SCORE[s as 0].label}</li>
        ))}
        <li className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-5 rounded-sm hatch-gap" />? evidence gap</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-5 rounded-sm hatch-na" />N/A excluded</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-5 rounded-sm border border-dashed border-navy-300 bg-white" />… awaiting</li>
        <li className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-bad" aria-hidden />critical control at or below threshold</li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ Classification ladder
export function ClassificationLadder({ index, provisional, ceiling }: { index: number | null; provisional?: boolean; ceiling?: Classification | null }) {
  const pos = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
  const shade = ['#E4EBF3', '#C9D5E3', '#9BB0C9', '#47658F', '#0B1F3A'];
  return (
    <div className="pt-7 pb-2 px-1" role="img" aria-label={index === null ? 'Classification ladder; no index yet' : `Classification ladder; index ${index.toFixed(1)}${ceiling ? `; advisory ceiling ${ceiling.label}` : ''}`}>
      <div className="relative">
        <div className="flex h-3.5 overflow-hidden rounded-full">
          {CLASSIFICATIONS.map((c, i) => <div key={c.id} style={{ width: '20%', background: shade[i] }} className="border-r border-white last:border-r-0" />)}
        </div>
        {index !== null && (
          <div className="absolute -top-7 -translate-x-1/2 flex flex-col items-center" style={{ left: pos(index) }}>
            <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white', provisional ? 'bg-amber-600' : 'bg-teal-700')}>{index.toFixed(1)}{provisional ? ' (prov.)' : ''}</span>
            <span className={clsx('h-3 w-0.5', provisional ? 'bg-amber-600' : 'bg-teal-700')} />
          </div>
        )}
        {ceiling && <div className="absolute -top-1 bottom-[-4px] w-0.5 bg-bad" style={{ left: pos(ceiling.upperInclusive) }} aria-hidden />}
      </div>
      <div className="mt-1.5 flex text-center">
        {CLASSIFICATIONS.map((c) => (
          <div key={c.id} style={{ width: '20%' }} className="px-0.5">
            <div className="text-[11.5px] font-medium leading-tight">{c.label}</div>
            <div className="text-[10.5px] text-muted">{c.rangeLabel}</div>
          </div>
        ))}
      </div>
      {ceiling && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-bad font-medium">
          <span className="inline-block h-3 w-0.5 bg-bad" aria-hidden />
          Red line: advisory ceiling ({ceiling.label}, up to {ceiling.upperInclusive}) — applies only if an assessor confirms the gate
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Contribution bars
export function ContributionBars({ rows, onSelect }: { rows: { id: string; name: string; weight: number; contribution: number | null; status: string }[]; onSelect?: (id: string) => void }) {
  const max = Math.max(...rows.map((r) => r.weight));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2">
          <button type="button" onClick={() => onSelect?.(r.id)} className="w-40 shrink-0 truncate text-left text-xs hover:underline" title={r.name}>{r.name}</button>
          <div className="relative h-5 flex-1 rounded bg-navy-50">
            <div className="absolute inset-y-0 left-0 rounded border border-navy-200 bg-white" style={{ width: `${(r.weight / max) * 100}%` }} title={`Weight ${r.weight} points`} />
            {r.contribution !== null ? (
              <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(r.contribution / max) * 100}%`, background: COLORS.verified }} title={`Contribution ${r.contribution.toFixed(2)} of ${r.weight}`} />
            ) : (
              <div className="absolute inset-y-0 left-0 rounded hatch-gap" style={{ width: `${(r.weight / max) * 100}%` }} title="Unscored" />
            )}
          </div>
          <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted">{r.contribution === null ? `unscored / ${r.weight}` : `${r.contribution.toFixed(2)} / ${r.weight}`}</span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Histogram with marker
export function Histogram({ bins, marker, markerLabel, color = COLORS.bench, height = 220 }: { bins: { from: number; to: number; count: number }[]; marker?: number | null; markerLabel?: string; color?: string; height?: number }) {
  const data = bins.map((b) => ({ label: `${b.from}–${b.to}`, count: b.count, from: b.from, to: b.to }));
  const mk = marker === null || marker === undefined ? null : data.find((d) => marker >= d.from && (marker < d.to || d.to === 100))?.label ?? null;
  return (
    <div style={{ height }} role="img" aria-label="Histogram of cohort maturity index values">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke={COLORS.grid} />
          <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: COLORS.axis }} tickLine={false} axisLine={{ stroke: COLORS.grid }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: COLORS.axis }} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: 'rgba(11,31,58,0.04)' }} formatter={(v) => [`${v} organizations`, 'Count']} labelFormatter={(l) => `Index ${l}`} />
          <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]}>
            {data.map((d) => <Cell key={d.label} fill={d.label === mk ? COLORS.verified : color} />)}
          </Bar>
          {mk && <ReferenceLine x={mk} stroke={COLORS.verified} strokeWidth={2} label={{ value: markerLabel ?? 'This assessment', position: 'top', fontSize: 11, fill: COLORS.verified }} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------------ Benchmark comparison bars
export function CompareBars({ rows, ownLabel = 'This assessment', cohortLabel = 'Cohort median', height }: { rows: { name: string; own: number | null; median: number | null; p25?: number | null; p75?: number | null }[]; ownLabel?: string; cohortLabel?: string; height?: number }) {
  const data = rows.map((r) => ({ ...r, ownPlot: r.own ?? 0, medianPlot: r.median ?? 0 }));
  return (
    <div style={{ height: height ?? Math.max(180, rows.length * 38 + 50) }} role="img" aria-label={`Bar chart comparing ${ownLabel} with ${cohortLabel}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 30, bottom: 4, left: 8 }} barCategoryGap={6} barGap={2}>
          <CartesianGrid horizontal={false} stroke={COLORS.grid} />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: COLORS.axis }} tickLine={false} axisLine={{ stroke: COLORS.grid }} />
          <YAxis type="category" dataKey="name" width={122} tick={{ fontSize: 12, fill: COLORS.ink }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: 'rgba(11,31,58,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof rows)[0];
              return (
                <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-pop">
                  <div className="font-semibold mb-1">{p.name}</div>
                  <div>{ownLabel}: {p.own === null ? 'n/a' : p.own.toFixed(1)}</div>
                  <div>{cohortLabel}: {p.median === null ? 'n/a' : p.median.toFixed(1)}</div>
                  {p.p25 !== null && p.p25 !== undefined && p.p75 !== null && p.p75 !== undefined && <div className="text-muted">Interquartile range: {p.p25.toFixed(1)}–{p.p75.toFixed(1)}</div>}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar name={ownLabel} dataKey="ownPlot" fill={COLORS.verified} barSize={9} radius={[0, 4, 4, 0]} />
          <Bar name={cohortLabel} dataKey="medianPlot" fill={COLORS.bench} barSize={9} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function maturityRows(res: { maturity: IndexResult; maturitySelf: IndexResult }): RadarRow[] {
  return res.maturity.dimensions.map((d, i) => ({ id: d.id, name: d.shortName, verified: d.normalized, self: res.maturitySelf.dimensions[i].normalized }));
}

export function ChartTable({ rows, caption }: { rows: RadarRow[]; caption: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 no-print">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-xs link">{open ? 'Hide' : 'Show'} data table</button>
      {open && (
        <table className="mt-2 w-full text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th className="th" scope="col">Dimension</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Self-reported</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}><th scope="row" className="td font-normal">{r.name}</th><td className="td tabular-nums">{r.verified === null ? 'unscored' : r.verified.toFixed(1)}</td><td className="td tabular-nums">{r.self === null ? 'unscored' : r.self.toFixed(1)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
