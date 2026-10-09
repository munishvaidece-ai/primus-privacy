import { AlertTriangle, ArrowRight, ShieldAlert } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ChartTable, ClassificationLadder, ControlHeatmap, DimensionBars, DistributionStack, RadarDimensions, ScoreRing, maturityRows, type HeatGroup } from '../components/charts';
import { COLORS } from '../components/charts/colors';
import { NeedAssessment, ResultStatusBadge, AssessmentStatusBadge, DemoTag } from '../components/shared';
import { Badge, Card, CardHeader, PageHeader, ProgressBar, Stat, formatDateTime, useDocumentTitle } from '../components/ui';
import { CONFIDENCE_LABELS } from '../scoring/coverage';
import { formatIndicatorValue } from '../scoring/indicators';
import { BUCKET_LABELS, PRIORITY_LABELS } from '../scoring/recommendations';
import { criticalQuestionIds } from '../scoring/gates';
import type { AssessmentResults } from '../scoring/results';
import { RISK_COMPONENTS, type DimensionId } from '../data/spec';
import { useCurrent, useResults } from '../store/hooks';
import { fmt1, pctText } from '../export/narrative';
import type { Assessment } from '../domain/schema';
import type { Tone } from '../components/ui';

const PRIORITY_TONE: Record<string, Tone> = { critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' };

const KPI_IDS = ['aiSpendIntensity', 'adoptionPenetration', 'productionIntensity', 'useCaseConversion', 'financialReturns', 'governanceCoverage', 'monitoringCoverage', 'incidentFrequency'];

function ScoreCard({ to, title, value, ringColor, sub, status, children }: { to: string; title: string; value: number | null; ringColor: string; sub: string; status: Parameters<typeof ResultStatusBadge>[0]['status']; children?: React.ReactNode }) {
  return (
    <Link to={to} className="card card-pad block transition-shadow hover:shadow-pop focus-visible:shadow-pop" aria-label={`${title}: open details`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
      </div>
      <div className="mt-3 flex items-center gap-4">
        <ScoreRing value={value} color={ringColor} label={title} sub="of 100" dashed={status !== 'definitive'} />
        <div className="min-w-0 space-y-1.5">
          <ResultStatusBadge status={status} />
          {children}
          <p className="text-xs text-muted leading-snug">{sub}</p>
        </div>
      </div>
    </Link>
  );
}

function Dashboard({ a, res }: { a: Assessment; res: AssessmentResults }) {
  const navigate = useNavigate();
  const rows = maturityRows(res);
  const goDim = (id: DimensionId) => navigate(`/maturity?tab=dimensions&dimension=${id}`);
  const m = res.maturity;
  const g = res.gates;
  const final = g.finalClassification ?? m.classification;
  const critical = criticalQuestionIds(a.config);
  const groups: HeatGroup[] = [
    ...RISK_COMPONENTS.map((c) => ({ label: c.name, sub: c.sourceLabel, ids: c.questionIds })),
  ];
  const nextActions = res.recommendations.filter((r) => r.status !== 'completed' && r.status !== 'dismissed').slice(0, 5);

  return (
    <>
      <PageHeader
        title={a.profile.organizationName || a.name}
        description={`${a.name}${a.profile.periodLabel ? ` · ${a.profile.periodLabel}` : ''}`}
        meta={<><AssessmentStatusBadge status={a.status} />{a.isDemo && <DemoTag />}<span className="text-muted">Last saved {formatDateTime(a.updatedAt)}</span></>}
        actions={<><Link to="/questionnaire" className="btn btn-md btn-secondary">Continue questionnaire</Link><Link to="/reports" className="btn btn-md btn-primary">Generate report</Link></>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <ScoreCard
          to="/maturity" title="AI Maturity Index" value={m.index} ringColor={COLORS.verified} status={m.status}
          sub={`Assessor-verified · ${pctText(m.questionCoverage)} question coverage · ${12 - m.unscoredDimensionIds.length}/12 dimensions scored`}
        >
          {final ? <Badge tone="navy" className="text-[13px] px-2.5">{final.label}</Badge> : <Badge>Not classified</Badge>}
          {g.triggered && (
            <div className="flex items-start gap-1 text-xs text-warn font-medium"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />{g.status === 'confirmed' ? 'Gate confirmed: classification capped' : g.status === 'overridden' ? 'Gate overridden by assessor' : 'Flagged for review: critical control deficiency'}</div>
          )}
        </ScoreCard>
        <ScoreCard
          to="/risk" title="AI Risk & Governance Control Maturity" value={res.risk.score} ringColor="#1597A2" status={res.risk.status}
          sub={`Higher = stronger assessed controls · ${pctText(res.risk.questionCoverage)} coverage`}
        >
          <div className="text-xs"><span className="font-medium">{g.deficiencies.length}</span> critical deficienc{g.deficiencies.length === 1 ? 'y' : 'ies'} · <span className="font-medium">{g.unverified.length}</span> unverified</div>
        </ScoreCard>
        <ScoreCard
          to="/value" title="AI Value Realization Score" value={res.value.score} ringColor={COLORS.bench} status={res.value.status}
          sub={`${res.value.components.filter((c) => c.status !== 'unscored').length} of 6 components scored · ${pctText(res.value.weightCoverage)} of weight`}
        >
          <div className="text-xs">ROI (verified): <span className="font-medium">{res.indicators.roi.roiVerified === null ? 'not calculable' : `${res.indicators.roi.roiVerified.toFixed(1)}%`}</span></div>
        </ScoreCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Classification" subtitle="Where the verified index sits on the source bands (boundaries applied to unrounded scores)" />
          <ClassificationLadder index={m.index} provisional={m.status !== 'definitive'} ceiling={g.ceilingApplies ? g.ceiling : null} />
          {m.caveats.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-muted space-y-0.5">{m.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Self-reported vs verified" subtitle="Calculated independently — never substituted" />
          <table className="w-full text-sm">
            <thead><tr><th className="th" scope="col">Score</th><th className="th text-right" scope="col">Verified</th><th className="th text-right" scope="col">Self</th><th className="th text-right" scope="col">Δ</th></tr></thead>
            <tbody>
              {[
                ['Maturity index', m.index, res.maturitySelf.index, `/maturity`],
                ['Risk & governance', res.risk.score, res.riskSelf.score, `/risk`],
                ['Value realization', res.value.score, res.valueSelf.score, `/value`],
              ].map(([label, v, s, to]) => (
                <tr key={label as string}>
                  <td className="td"><Link className="link" to={to as string}>{label as string}</Link></td>
                  <td className="td text-right tabular-nums font-medium">{fmt1(v as number | null)}</td>
                  <td className="td text-right tabular-nums">{fmt1(s as number | null)}</td>
                  <td className="td text-right tabular-nums text-muted">{v === null || s === null ? '—' : `${(s as number) - (v as number) >= 0 ? '+' : ''}${((s as number) - (v as number)).toFixed(1)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 space-y-2">
            <div><div className="mb-1 flex justify-between text-xs"><span>Verified coverage</span><span>{pctText(m.questionCoverage)}</span></div><ProgressBar value={m.questionCoverage} tone="blue" label="Verified coverage" /></div>
            <div><div className="mb-1 flex justify-between text-xs"><span>Self-reported coverage</span><span>{pctText(res.maturitySelf.questionCoverage)}</span></div><ProgressBar value={res.maturitySelf.questionCoverage} tone="orange" label="Self-reported coverage" /></div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Twelve-dimension profile" subtitle="Click a dimension label to drill in" />
          <RadarDimensions rows={rows} onSelect={goDim} />
          <ChartTable rows={rows} caption="Dimension scores" />
        </Card>
        <Card>
          <CardHeader title="Dimension score comparison" subtitle="0–100, assessor-verified vs self-reported" />
          <DimensionBars rows={rows} onSelect={goDim} height={400} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Maturity distribution" subtitle="Question outcomes per dimension (verified basis)" />
          <DistributionStack responses={a.responses} onSelect={goDim} />
        </Card>
        <Card>
          <CardHeader title="Evidence & coverage" subtitle="Provided ≠ reviewed ≠ verified" action={<Link to="/evidence" className="link text-sm">Open workspace</Link>} />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Stat label="Self-reported answers" value={`${res.coverage.selfAnswered}`} sub={`of ${res.coverage.applicable} applicable`} />
            <Link to="/evidence?missing=1" className="block"><Stat label="With evidence reference" value={`${res.coverage.withReference}`} sub="entered, not verified" /></Link>
            <Stat label="Reviewed by assessor" value={`${res.coverage.reviewed}`} sub={pctText(res.coverage.reviewed / Math.max(1, res.coverage.applicable))} />
            <Stat label="Evidence accepted" value={`${res.coverage.accepted}`} sub="verified by assessor" tone="good" />
            <Link to="/evidence?dk=1" className="block"><Stat label="Don't know / not verified" value={`${res.coverage.dontKnowNotVerified}`} sub="evidence gap, not zero" tone={res.coverage.dontKnowNotVerified ? 'warn' : undefined} /></Link>
            <Link to="/evidence?na=1" className="block"><Stat label="Not applicable" value={`${res.coverage.notApplicable}`} sub="excluded from scoring" /></Link>
            <Link to="/evidence?awaiting=1" className="block"><Stat label="Awaiting assessment" value={`${res.coverage.awaitingAssessment}`} sub="no verified score yet" /></Link>
            <Stat label="Dimensions covered" value={`${res.coverage.sufficientDimensions}/${res.coverage.totalDimensions}`} sub={`≥ ${Math.round(a.config.minDimensionCoverage * 100)}% verified`} />
            <Stat label="Evidence confidence" value={CONFIDENCE_LABELS[res.coverage.confidence]} sub={`${pctText(res.coverage.acceptedShare)} accepted`} />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Risk and control-gap heatmap" subtitle="Controls in the Risk & Governance composition, coloured by assessor-verified score"
          action={<Link to="/risk" className="link text-sm">Risk & governance</Link>}
        />
        <ControlHeatmap
          responses={a.responses} groups={groups} criticalIds={critical} deficiencyThreshold={a.config.gates.deficiencyThreshold}
          onSelect={(id) => navigate(`/questionnaire?q=${id}`)}
        />
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Quantitative KPIs" subtitle={`${res.indicators.captured} of ${res.indicators.total} source indicators captured`}
          action={<Link to="/maturity?tab=indicators" className="link text-sm">All indicators</Link>}
        />
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {KPI_IDS.map((id) => {
            const r = res.indicators.byId[id];
            return (
              <Link key={id} to="/maturity?tab=indicators" className="block rounded-lg border border-line bg-white px-3.5 py-3 hover:border-teal-500">
                <div className="text-xs text-muted">{r.def.short}</div>
                <div className={`mt-0.5 text-xl font-semibold tabular-nums ${r.status === 'ok' ? '' : 'text-navy-400'}`}>{r.status === 'ok' ? formatIndicatorValue(r) : r.status === 'invalid' ? 'Invalid' : '—'}</div>
                <div className="mt-0.5 text-[11px] text-muted">{r.status === 'ok' ? (r.verified ? 'Verified by assessor' : 'Self-reported (unverified)') : r.status === 'invalid' ? 'Check inputs' : 'Not captured'}</div>
              </Link>
            );
          })}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Top strengths" subtitle="Highest verified dimension scores" />
          {res.strengths.length === 0 ? <p className="text-sm text-muted">No verified dimension scores yet.</p> : (
            <ul className="space-y-3">
              {res.strengths.map((s) => (
                <li key={s.dimensionId}>
                  <Link to={`/maturity?tab=dimensions&dimension=${s.dimensionId}`} className="block hover:underline">
                    <div className="flex justify-between text-sm"><span className="font-medium">{s.name}</span><span className="tabular-nums">{s.normalized.toFixed(1)}</span></div>
                    <ProgressBar value={s.normalized / 100} tone="blue" label={s.name} className="mt-1" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Priority gaps" subtitle="Most index points not yet earned" />
          {res.priorityGaps.length === 0 ? <p className="text-sm text-muted">No verified dimension scores yet.</p> : (
            <ul className="space-y-3">
              {res.priorityGaps.map((g2) => (
                <li key={g2.dimensionId}>
                  <Link to={`/maturity?tab=dimensions&dimension=${g2.dimensionId}`} className="block hover:underline">
                    <div className="flex justify-between gap-2 text-sm"><span className="font-medium">{g2.name}</span><span className="tabular-nums text-muted">−{g2.pointsAvailable.toFixed(1)} pts</span></div>
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g2.weakest.map((w) => <Link key={w.id} to={`/questionnaire?q=${w.id}`} className="rounded bg-navy-100 px-1.5 py-0.5 text-[11px] hover:bg-navy-200">{w.id} · {w.score}</Link>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recommended next actions" subtitle="Advisory — requires client validation" action={<Link to="/roadmap" className="link text-sm">Roadmap</Link>} />
          {nextActions.length === 0 ? <p className="text-sm text-muted">No open recommendations.</p> : (
            <ul className="space-y-2.5">
              {nextActions.map((r) => (
                <li key={r.id}>
                  <Link to={`/roadmap?tab=recommendations&rec=${encodeURIComponent(r.id)}`} className="block rounded-lg border border-line px-3 py-2 hover:border-teal-500">
                    <div className="flex items-center gap-2"><Badge tone={PRIORITY_TONE[r.priority]} icon={r.priority === 'critical' ? <ShieldAlert className="h-3 w-3" aria-hidden /> : undefined}>{PRIORITY_LABELS[r.priority]}</Badge><span className="text-[11px] text-muted">{BUCKET_LABELS[r.bucket]}</span></div>
                    <div className="mt-1 text-[13.5px] font-medium leading-snug">{r.title}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export default function Overview() {
  useDocumentTitle('Executive Overview');
  const a = useCurrent();
  const res = useResults(a);
  return <NeedAssessment a={a}>{(cur) => (res ? <Dashboard a={cur} res={res} /> : null)}</NeedAssessment>;
}
