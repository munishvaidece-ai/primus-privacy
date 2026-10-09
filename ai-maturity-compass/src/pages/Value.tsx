import clsx from 'clsx';
import { AlertTriangle, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ScoreRing } from '../components/charts';
import { COLORS } from '../components/charts/colors';
import { MiniScore } from '../components/MiniScore';
import { LockedBanner, NeedAssessment, NeedProfile, ResultStatusBadge } from '../components/shared';
import { Badge, Button, Callout, Card, CardHeader, Checkbox, NumberField, PageHeader, ProgressBar, Stat, TextArea, TextField, useDocumentTitle } from '../components/ui';
import { SECTOR_OUTCOME_EXAMPLES } from '../data/indicators';
import { ROI_BANDS } from '../data/spec';
import type { Assessment } from '../domain/schema';
import { uid } from '../domain/factory';
import { fmt1, pctText } from '../export/narrative';
import { formatInr } from '../scoring/indicators';
import type { AssessmentResults } from '../scoring/results';
import { isEditable, useCurrent, useResults } from '../store/hooks';
import { useStore } from '../store/store';

export default function Value() {
  useDocumentTitle('Value Realization');
  const a = useCurrent();
  const res = useResults(a);
  return <NeedAssessment a={a}>{(cur) => <NeedProfile a={cur}>{res && <Inner a={cur} res={res} />}</NeedProfile>}</NeedAssessment>;
}

function Inner({ a, res }: { a: Assessment; res: AssessmentResults }) {
  const v = res.value;
  const editable = isEditable(a);
  const reopen = useStore((s) => s.reopenAssessment);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Value Realization" description="AI Value Realization Score: verified financial value, productivity, strategic impact, adoption, measurement discipline and sustainability." meta={<ResultStatusBadge status={v.status} />} />
      <LockedBanner a={a} onReopen={() => reopen(a.id)} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-center gap-4">
            <ScoreRing value={v.score} color={COLORS.bench} label="AI Value Realization Score" sub="of 100" dashed={v.status !== 'definitive'} />
            <div className="space-y-1.5"><div className="kicker">Verified basis</div><div className="text-xs">{pctText(v.weightCoverage)} of weight scored</div><div className="text-xs">{v.components.filter((c) => c.status !== 'unscored').length} of 6 components scored</div></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5"><Stat label="Self-reported" value={fmt1(res.valueSelf.score)} sub="independent basis" /><Stat label="Verified ROI" value={res.indicators.roi.roiVerified === null ? 'n/a' : `${res.indicators.roi.roiVerified.toFixed(1)}%`} sub="provisional bands" /></div>
          {v.caveats.map((c, i) => <p key={i} className="mt-2 text-xs text-muted">{c}</p>)}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Components" subtitle="Each component is the mean of its available items (0–4). Items with missing data are left out — never scored as zero." />
          <ul className="space-y-2">
            {v.components.map((c, i) => (
              <li key={c.id} className="rounded-lg border border-line">
                <button type="button" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full flex-wrap items-center gap-3 px-3.5 py-2.5 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{c.name}<span className="text-xs font-normal text-muted">{c.weight}%</span>{c.mappingSource === 'prototype' && <Badge tone="warn" title={c.mappingNote}>prototype mapping</Badge>}</div>
                    <div className="text-xs text-muted">{c.measurement}</div>
                  </div>
                  <div className="w-28"><ProgressBar value={c.normalized === null ? null : c.normalized / 100} tone="good" label={`${c.name} score`} /></div>
                  <div className="w-20 text-right text-sm tabular-nums"><span className="font-semibold">{c.normalized === null ? 'unscored' : c.normalized.toFixed(1)}</span><div className="text-[11px] text-muted">self {fmt1(res.valueSelf.components[i].normalized)}</div></div>
                  <ChevronDown className={clsx('h-4 w-4 text-muted transition-transform', open === c.id && 'rotate-180')} aria-hidden />
                </button>
                {open === c.id && (
                  <div className="border-t border-line bg-navy-50/50 px-3.5 py-3">
                    <p className="mb-2 text-xs text-muted">{c.mappingNote} Items scored: {c.scoredItems} of {c.applicableItems}.</p>
                    <ul className="space-y-1">
                      {c.items.map((it) => (
                        <li key={it.key} className="flex flex-wrap items-start gap-2 text-xs">
                          <Badge tone={it.state === 'scored' ? 'good' : it.state === 'unverified' ? 'warn' : 'neutral'}>{it.state === 'scored' ? `score ${typeof it.score === 'number' ? (Number.isInteger(it.score) ? it.score : it.score.toFixed(2)) : ''}` : it.state === 'not_applicable' ? 'N/A' : it.state}</Badge>
                          <span className="min-w-0 flex-1">{it.kind === 'question' ? <Link className="link" to={`/questionnaire?q=${it.key}`}>{it.label}</Link> : it.label}<span className="block text-muted">{it.detail}</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <RoiCalculator a={a} res={res} editable={editable} />
      <OutcomeKpis a={a} editable={editable} />
    </>
  );
}

function RoiCalculator({ a, res, editable }: { a: Assessment; res: AssessmentResults; editable: boolean }) {
  const updateRoi = useStore((s) => s.updateRoi);
  const r = res.indicators.roi;
  const roi = a.roi;
  const costs: [keyof typeof roi.costs, string][] = [
    ['platform', 'Platform, licensing and tooling'], ['compute', 'Compute and infrastructure'], ['integration', 'Integration and data preparation'],
    ['people', 'People (build, run, change)'], ['governance', 'Governance, risk and compliance'], ['other', 'Other operating costs'],
  ];
  const benefits: [keyof typeof roi.claimed, string][] = [['revenue', 'Attributable revenue contribution'], ['costSavings', 'Verified cost savings'], ['productivity', 'Monetized productivity benefits']];
  const band = (s: number | null) => (s === null ? 'none' : String(s));
  return (
    <Card className="mt-4">
      <CardHeader title="AI ROI calculator" subtitle="ROI (%) = ((Verified AI Benefits − Total AI Costs) ÷ Total AI Costs) × 100 · amounts in ₹ lakh" />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Period start" type="date" value={roi.periodStart} disabled={!editable} onChange={(e) => updateRoi((x) => ({ ...x, periodStart: e.target.value }))} />
            <TextField label="Period end" type="date" value={roi.periodEnd} disabled={!editable} onChange={(e) => updateRoi((x) => ({ ...x, periodEnd: e.target.value }))} hint="Benefits and costs must cover the same period — generally the most recent 12 months." />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">Total AI costs (fully loaded implementation and operating)</legend>
            <div className="grid gap-3 sm:grid-cols-2">{costs.map(([k, label]) => <NumberField key={k} label={label} unit="₹ lakh" value={roi.costs[k]} disabled={!editable} onChange={(n) => updateRoi((x) => ({ ...x, costs: { ...x.costs, [k]: n } }))} />)}</div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">Benefits claimed by the organization</legend>
            <div className="grid gap-3 sm:grid-cols-3">{benefits.map(([k, label]) => <NumberField key={k} label={label} unit="₹ lakh" value={roi.claimed[k]} disabled={!editable} onChange={(n) => updateRoi((x) => ({ ...x, claimed: { ...x.claimed, [k]: n } }))} />)}</div>
            <p className="hint">Avoid double-counting across categories. Claimed benefits are not verified benefits.</p>
          </fieldset>
          <NumberField label="Verified AI benefits (after assessor review)" unit="₹ lakh" value={roi.verifiedBenefits} disabled={!editable} onChange={(n) => updateRoi((x) => ({ ...x, verifiedBenefits: n }))} hint="Leave blank until an assessor has verified the benefits. The source ROI is calculated on verified benefits." />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Data source" value={roi.dataSource} disabled={!editable} onChange={(e) => updateRoi((x) => ({ ...x, dataSource: e.target.value }))} />
            <TextArea label="Evidence note" rows={2} value={roi.evidenceNote} disabled={!editable} onChange={(e) => updateRoi((x) => ({ ...x, evidenceNote: e.target.value }))} />
          </div>
        </div>
        <div className="space-y-3 lg:col-span-2">
          <div className="rounded-xl border border-line bg-navy-50/60 p-4">
            <div className="kicker">Calculation</div>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Total AI costs</dt><dd className="tabular-nums font-medium">{r.totalCosts === null ? 'not entered' : formatInr(r.totalCosts)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Benefits claimed</dt><dd className="tabular-nums">{r.claimedBenefits === null ? '—' : formatInr(r.claimedBenefits)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Verified benefits</dt><dd className="tabular-nums">{r.verifiedBenefits === null ? 'not verified' : formatInr(r.verifiedBenefits)}</dd></div>
            </dl>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Stat label="ROI on verified benefits" value={r.roiVerified === null ? 'n/a' : `${r.roiVerified.toFixed(1)}%`} sub={r.scoreVerified === null ? 'unscored' : `band ${r.scoreVerified} of 4`} />
              <Stat label="ROI on claimed (not verified)" value={r.roiClaimed === null ? 'n/a' : `${r.roiClaimed.toFixed(1)}%`} sub={r.scoreClaimed === null ? 'unscored' : `band ${r.scoreClaimed}`} />
            </div>
            {r.issues.map((i, k) => <p key={k} className={clsx('mt-2 flex gap-1.5 text-xs', i.level === 'error' ? 'text-bad' : 'text-warn')}><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{i.message}</p>)}
            {r.totalCosts === null && !r.hasInput && <p className="mt-2 text-xs text-muted">Enter costs and benefits to calculate ROI. Missing data leaves the financial component unscored.</p>}
          </div>
          <div>
            <h3 className="text-sm font-semibold">Provisional ROI scoring bands</h3>
            <p className="mb-2 text-xs text-muted">Source §9.A: proposed assessment thresholds — <strong>not established Indian industry benchmarks</strong>; adjust by sector, investment maturity and deployment stage.</p>
            <table className="w-full text-sm">
              <thead><tr><th className="th" scope="col">Score</th><th className="th" scope="col">Verified AI ROI</th></tr></thead>
              <tbody>
                {ROI_BANDS.map((b) => (
                  <tr key={b.score} className={band(r.scoreVerified) === String(b.score) ? 'bg-teal-50 font-medium' : ''}>
                    <td className="td tabular-nums">{b.score}{band(r.scoreVerified) === String(b.score) && <Badge tone="teal" className="ml-2">this assessment</Badge>}</td>
                    <td className="td">{b.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}

function OutcomeKpis({ a, editable }: { a: Assessment; editable: boolean }) {
  const update = useStore((s) => s.updateValueEvidence);
  const ve = a.valueEvidence;
  const kpis = ve.outcomeKpis;
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Material outcome KPIs" subtitle="Source §9.C: define three to five outcome KPIs before assessment, ideally against pre-AI baselines or valid comparison groups."
          action={<Button size="sm" disabled={!editable || kpis.length >= 5} onClick={() => update((v) => ({ ...v, outcomeKpis: [...v.outcomeKpis, { id: uid('kpi'), name: '', baseline: '', current: '', rating: null, verified: false, note: '' }] }))}><Plus className="h-4 w-4" aria-hidden /> Add KPI</Button>}
        />
        {kpis.length === 0 && <p className="text-sm text-muted">No outcome KPIs defined. The business-impact component will rely on questionnaire items only.</p>}
        {kpis.length > 0 && kpis.length < 3 && <Callout tone="warn" className="mb-3">Source guidance suggests three to five material outcome KPIs; {kpis.length} defined.</Callout>}
        <ul className="space-y-3">
          {kpis.map((k, i) => {
            const set = (patch: Partial<typeof k>) => update((v) => ({ ...v, outcomeKpis: v.outcomeKpis.map((x) => (x.id === k.id ? { ...x, ...patch } : x)) }));
            return (
              <li key={k.id} className="rounded-lg border border-line p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_110px_110px_auto] sm:items-end">
                  <TextField label={`KPI ${i + 1} name`} value={k.name} disabled={!editable} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Fraud loss rate" />
                  <TextField label="Baseline" value={k.baseline} disabled={!editable} onChange={(e) => set({ baseline: e.target.value })} />
                  <TextField label="Current" value={k.current} disabled={!editable} onChange={(e) => set({ current: e.target.value })} />
                  <Button size="sm" variant="danger-outline" disabled={!editable} aria-label={`Remove KPI ${i + 1}`} onClick={() => update((v) => ({ ...v, outcomeKpis: v.outcomeKpis.filter((x) => x.id !== k.id) }))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <MiniScore label="Outcome rating (0–4)" value={k.rating} disabled={!editable} onChange={(s) => set({ rating: s })} />
                  <div className="space-y-2"><Checkbox checked={k.verified} disabled={!editable} onChange={(v) => set({ verified: v })} label="Verified by an assessor" hint="Only verified KPIs count toward the verified score." /><TextField label="Note" value={k.note} disabled={!editable} onChange={(e) => set({ note: e.target.value })} /></div>
                </div>
              </li>
            );
          })}
        </ul>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-teal-700">Source examples of sector outcomes</summary>
          <ul className="mt-2 space-y-1 text-xs">{SECTOR_OUTCOME_EXAMPLES.map((s) => <li key={s.sector}><strong>{s.sector}:</strong> {s.examples}</li>)}</ul>
        </details>
      </Card>

      <Card>
        <CardHeader title="Value sustainability evidence" subtitle="Source §9.F: evidence that benefits are recurring and remain stable after deployment." />
        <MiniScore label="Recurring-benefit evidence rating (0–4)" value={ve.recurring.rating} disabled={!editable} onChange={(s) => update((v) => ({ ...v, recurring: { ...v.recurring, rating: s } }))} />
        <div className="mt-3 space-y-3">
          <Checkbox checked={ve.recurring.verified} disabled={!editable} onChange={(c) => update((v) => ({ ...v, recurring: { ...v.recurring, verified: c } }))} label="Verified by an assessor" />
          <TextArea label="Evidence note" rows={3} value={ve.recurring.note} disabled={!editable} onChange={(e) => update((v) => ({ ...v, recurring: { ...v.recurring, note: e.target.value } }))} placeholder="e.g. Benefit stable across four consecutive quarters on the two largest use cases." />
        </div>
        <Callout tone="info" className="mt-4" title="Other quantitative evidence">
          Productivity (hours saved per employee per month) and adoption penetration are captured in the <Link className="link" to="/maturity?tab=indicators">quantitative indicators</Link>; they feed the productivity and adoption components when verified.
        </Callout>
      </Card>
    </div>
  );
}
