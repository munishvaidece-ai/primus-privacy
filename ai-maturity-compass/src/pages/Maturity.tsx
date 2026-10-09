import clsx from 'clsx';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChartTable, ClassificationLadder, ContributionBars, DimensionBars, DistributionStack, RadarDimensions, ScoreRing, maturityRows } from '../components/charts';
import { COLORS } from '../components/charts/colors';
import { IndiaPanel } from '../components/IndiaPanel';
import { IndicatorsPanel } from '../components/IndicatorsPanel';
import { EvidenceBadge, LockedBanner, NeedAssessment, NeedProfile, ResultStatusBadge, ScorePill } from '../components/shared';
import { Badge, Callout, Card, CardHeader, PageHeader, ProgressBar, Stat, TabPanel, Tabs, useDocumentTitle } from '../components/ui';
import { DIMENSIONS, DIMENSION_BY_ID, QUESTIONS, type DimensionId } from '../data/spec';
import type { Assessment } from '../domain/schema';
import { fmt1, pctText } from '../export/narrative';
import type { AssessmentResults } from '../scoring/results';
import { isEditable, useCurrent, useResults } from '../store/hooks';
import { useStore } from '../store/store';

type Tab = 'overview' | 'dimensions' | 'indicators' | 'india';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Maturity index' },
  { id: 'dimensions', label: 'Dimension drill-down' },
  { id: 'indicators', label: 'Quantitative indicators' },
  { id: 'india', label: 'India-specific diagnostics' },
];

export default function Maturity() {
  useDocumentTitle('AI Maturity Analysis');
  const a = useCurrent();
  const res = useResults(a);
  return <NeedAssessment a={a}>{(cur) => <NeedProfile a={cur}>{res && <Inner a={cur} res={res} />}</NeedProfile>}</NeedAssessment>;
}

function Inner({ a, res }: { a: Assessment; res: AssessmentResults }) {
  const [params, setParams] = useSearchParams();
  const reopen = useStore((s) => s.reopenAssessment);
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as Tab;
  const dim = (DIMENSIONS.find((d) => d.id === params.get('dimension'))?.id ?? 'S') as DimensionId;
  const setTab = (t: Tab) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true }); };
  const setDim = (d: DimensionId) => { const p = new URLSearchParams(params); p.set('tab', 'dimensions'); p.set('dimension', d); setParams(p, { replace: true }); };
  const editable = isEditable(a);

  return (
    <>
      <PageHeader
        title="AI Maturity Analysis"
        description="AI Maturity Index = Σ over 12 dimensions of [weight × (sum of applicable verified scores ÷ (4 × number of applicable verified questions))]."
        meta={<><ResultStatusBadge status={res.maturity.status} /><span className="text-muted">Headline uses assessor-verified scores only.</span></>}
      />
      <LockedBanner a={a} onReopen={() => reopen(a.id)} />
      <Tabs label="Maturity analysis sections" tabs={TABS} value={tab} onChange={setTab} />
      <TabPanel id="overview" active={tab === 'overview'}><Overview a={a} res={res} onDim={setDim} /></TabPanel>
      <TabPanel id="dimensions" active={tab === 'dimensions'}><Dimensions a={a} res={res} dim={dim} onDim={setDim} /></TabPanel>
      <TabPanel id="indicators" active={tab === 'indicators'}><IndicatorsPanel a={a} res={res} editable={editable} /></TabPanel>
      <TabPanel id="india" active={tab === 'india'}><IndiaPanel a={a} res={res} editable={editable} /></TabPanel>
    </>
  );
}

function Overview({ a, res, onDim }: { a: Assessment; res: AssessmentResults; onDim: (d: DimensionId) => void }) {
  const m = res.maturity;
  const rows = maturityRows(res);
  const g = res.gates;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-4">
            <ScoreRing value={m.index} label="AI Maturity Index" sub="of 100" color={COLORS.verified} dashed={m.status !== 'definitive'} />
            <div className="space-y-1.5">
              <div className="kicker">Assessor-verified</div>
              {m.classification ? <Badge tone="navy" className="px-2.5 text-[13px]">{m.classification.label}</Badge> : <Badge>Not classified</Badge>}
              <div className="text-xs text-muted">{m.classification?.description}</div>
              <div className="text-xs">{pctText(m.questionCoverage)} question coverage · {pctText(m.weightCoverage)} of weight scored</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Stat label="Self-reported index" value={fmt1(res.maturitySelf.index)} sub={res.maturitySelf.classification?.label ?? '—'} />
            <Stat label="Self minus verified" value={res.selfMinusVerified === null ? '—' : `${res.selfMinusVerified >= 0 ? '+' : ''}${res.selfMinusVerified.toFixed(1)}`} sub="points" tone={res.selfMinusVerified !== null && res.selfMinusVerified > 10 ? 'warn' : undefined} />
          </div>
          {res.indiaComposite !== null && <p className="mt-3 text-xs text-muted">Supplementary composite including India diagnostics ({a.config.india.compositeWeightPct}% weight): <strong>{res.indiaComposite.toFixed(1)}</strong>. The core index above is unchanged.</p>}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Classification and risk-based gate" subtitle="Boundaries: 0–20 · >20–40 · >40–60 · >60–80 · >80–100, applied to the unrounded index" />
          <ClassificationLadder index={m.index} provisional={m.status !== 'definitive'} ceiling={g.ceilingApplies ? g.ceiling : null} />
          {g.triggered ? (
            <Callout tone="warn" title={g.status === 'review_required' ? 'Classification flagged for review' : g.status === 'confirmed' ? 'Gate confirmed by assessor' : 'Gate overridden by assessor'} action={<Link to="/risk" className="btn btn-sm btn-secondary">Open gate</Link>}>
              {g.explanation.join(' ')}
            </Callout>
          ) : (
            <p className="text-sm text-muted">{g.explanation[0]}</p>
          )}
        </Card>
      </div>

      {m.caveats.length > 0 && <Callout tone="warn" title="Coverage caveats"><ul className="list-disc pl-4 space-y-1">{m.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></Callout>}

      <Card>
        <CardHeader title="Dimension scorecard" subtitle="Click a dimension for question-level detail" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Twelve-dimension scorecard with weights, verified and self-reported scores</caption>
            <thead>
              <tr>
                <th className="th" scope="col">Dimension</th><th className="th text-right" scope="col">Weight</th><th className="th text-right" scope="col">Verified mean (0–4)</th>
                <th className="th text-right" scope="col">Verified (0–100)</th><th className="th text-right" scope="col">Points</th><th className="th text-right" scope="col">Self (0–100)</th>
                <th className="th text-right" scope="col">Δ</th><th className="th" scope="col">Coverage</th><th className="th" scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {m.dimensions.map((d, i) => {
                const s = res.maturitySelf.dimensions[i];
                return (
                  <tr key={d.id} className="hover:bg-navy-50">
                    <th scope="row" className="td text-left font-medium"><button type="button" className="text-left hover:underline" onClick={() => onDim(d.id)}>{DIMENSIONS[i].number}. {d.name}</button></th>
                    <td className="td text-right tabular-nums">{d.weight}%</td>
                    <td className="td text-right tabular-nums">{d.mean === null ? '—' : d.mean.toFixed(2)}</td>
                    <td className="td text-right tabular-nums font-semibold">{d.normalized === null ? 'unscored' : d.normalized.toFixed(1)}</td>
                    <td className="td text-right tabular-nums">{d.contribution === null ? '—' : d.contribution.toFixed(2)}</td>
                    <td className="td text-right tabular-nums text-muted">{s.normalized === null ? '—' : s.normalized.toFixed(1)}</td>
                    <td className="td text-right tabular-nums text-muted">{d.normalized !== null && s.normalized !== null ? `${s.normalized - d.normalized >= 0 ? '+' : ''}${(s.normalized - d.normalized).toFixed(1)}` : '—'}</td>
                    <td className="td w-36"><div className="flex items-center gap-2"><ProgressBar value={d.coverage} tone="blue" label={`${d.name} verified coverage`} /><span className="w-9 text-xs tabular-nums">{pctText(d.coverage)}</span></div></td>
                    <td className="td whitespace-nowrap">{d.status === 'scored' ? <Badge tone="good">Scored</Badge> : d.status === 'partial' ? <Badge tone="warn" title="Scored, but fewer than the configured share of applicable questions are verified">Limited coverage</Badge> : <Badge tone="neutral" title={d.unscoredReason === 'all_not_applicable' ? 'All questions not applicable' : 'No verified scores'}>Unscored</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-navy-50 font-semibold">
                <td className="td">AI Maturity Index</td><td className="td text-right tabular-nums">100%</td><td className="td" /><td className="td text-right tabular-nums">{fmt1(m.index)}</td>
                <td className="td text-right tabular-nums">{m.rawContribution.toFixed(2)}</td><td className="td text-right tabular-nums">{fmt1(res.maturitySelf.index)}</td><td className="td" /><td className="td text-xs">{pctText(m.questionCoverage)}</td><td className="td"><ResultStatusBadge status={m.status} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
        {m.status === 'provisional' && <p className="mt-2 text-xs text-muted">Provisional: the index is renormalized over the {m.eligibleWeight}% of weight that is scored (points shown are raw contributions; index = points ÷ {m.eligibleWeight} × 100).</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Contribution to the index" subtitle="Points earned against the weight of each dimension" /><ContributionBars rows={m.dimensions.map((d) => ({ id: d.id, name: d.shortName, weight: d.weight, contribution: d.contribution, status: d.status }))} onSelect={(id) => onDim(id as DimensionId)} /></Card>
        <Card><CardHeader title="Maturity distribution" subtitle="Verified-basis outcomes for all 100 questions" /><DistributionStack responses={a.responses} onSelect={onDim} /></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Dimension profile" /><RadarDimensions rows={rows} onSelect={onDim} /><ChartTable rows={rows} caption="Dimension scores" /></Card>
        <Card><CardHeader title="Verified vs self-reported" /><DimensionBars rows={rows} onSelect={onDim} height={380} /></Card>
      </div>
    </div>
  );
}

function Dimensions({ a, res, dim, onDim }: { a: Assessment; res: AssessmentResults; dim: DimensionId; onDim: (d: DimensionId) => void }) {
  const navigate = useNavigate();
  const d = DIMENSION_BY_ID[dim];
  const i = DIMENSIONS.findIndex((x) => x.id === dim);
  const v = res.maturity.dimensions[i];
  const s = res.maturitySelf.dimensions[i];
  const qs = QUESTIONS.filter((q) => q.dimensionId === dim);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a dimension">
        {DIMENSIONS.map((x) => (
          <button key={x.id} type="button" aria-pressed={x.id === dim} onClick={() => onDim(x.id)} className={clsx('rounded-full border px-3 py-1.5 text-sm', x.id === dim ? 'border-navy-900 bg-navy-900 text-white' : 'border-navy-200 bg-white hover:bg-navy-50')}>{x.number}. {x.shortName}</button>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold">{d.number}. {d.name}</h2><p className="text-sm text-muted">{d.questionCount} questions · weight {d.weight}% · source heading: “{d.sourceHeading}”</p></div>
          <Link to={`/questionnaire?q=${qs[0].id}`} className="btn btn-md btn-secondary" onClick={(e) => { e.preventDefault(); navigate(`/questionnaire?q=${qs[0].id}`); }}>Open in questionnaire</Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-5">
          <Stat label="Verified score" value={v.normalized === null ? 'Unscored' : v.normalized.toFixed(1)} sub={v.mean === null ? undefined : `mean ${v.mean.toFixed(2)} of 4`} />
          <Stat label="Self-reported" value={s.normalized === null ? '—' : s.normalized.toFixed(1)} />
          <Stat label="Points toward index" value={v.contribution === null ? '—' : `${v.contribution.toFixed(2)} / ${d.weight}`} />
          <Stat label="Verified coverage" value={pctText(v.coverage)} sub={`${v.scored} of ${v.applicable} applicable`} />
          <Stat label="Gaps / awaiting / N/A" value={`${v.unverified} / ${v.pending} / ${v.notApplicable}`} />
        </div>
      </Card>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <caption className="sr-only">Questions in {d.name}</caption>
            <thead><tr><th className="th" scope="col">ID</th><th className="th" scope="col">Question</th><th className="th" scope="col">Self</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Evidence</th><th className="th" scope="col">Assessor observation</th></tr></thead>
            <tbody>
              {qs.map((q) => {
                const r = a.responses[q.id];
                return (
                  <tr key={q.id} className="hover:bg-navy-50">
                    <td className="td whitespace-nowrap"><Link to={`/questionnaire?q=${q.id}`} className="font-semibold text-teal-700 hover:underline">{q.id}</Link></td>
                    <td className="td max-w-[380px]">{q.text}</td>
                    <td className="td">{r.self.state === 'scored' ? <ScorePill score={r.self.score} /> : <Badge>{r.self.state === 'dont_know' ? "Don't know" : r.self.state === 'not_applicable' ? 'N/A' : 'Open'}</Badge>}</td>
                    <td className="td">{r.verified.state === 'scored' ? <ScorePill score={r.verified.score} /> : <Badge tone={r.verified.state === 'not_verified' ? 'warn' : 'neutral'}>{r.verified.state === 'not_applicable' ? 'N/A' : r.verified.state === 'not_verified' ? 'Not verified' : 'Awaiting'}</Badge>}</td>
                    <td className="td"><EvidenceBadge status={r.evidence.status} /></td>
                    <td className="td text-xs text-muted max-w-[260px]">{r.observations || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
