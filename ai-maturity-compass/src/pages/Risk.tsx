import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ControlHeatmap, ScoreRing, type HeatGroup } from '../components/charts';
import { COLORS } from '../components/charts/colors';
import { EvidenceBadge, LockedBanner, NeedAssessment, NeedProfile, ResultStatusBadge, ScorePill } from '../components/shared';
import { Badge, Button, Callout, Card, CardHeader, PageHeader, ProgressBar, Stat, TextArea, useDocumentTitle, useToast } from '../components/ui';
import { RISK_COMPONENTS } from '../data/spec';
import type { Assessment } from '../domain/schema';
import { fmt1, pctText } from '../export/narrative';
import { criticalQuestionIds } from '../scoring/gates';
import type { AssessmentResults } from '../scoring/results';
import { useCurrent, useResults } from '../store/hooks';
import { useStore } from '../store/store';

export default function Risk() {
  useDocumentTitle('Risk & Governance');
  const a = useCurrent();
  const res = useResults(a);
  return <NeedAssessment a={a}>{(cur) => <NeedProfile a={cur}>{res && <Inner a={cur} res={res} />}</NeedProfile>}</NeedAssessment>;
}

function Inner({ a, res }: { a: Assessment; res: AssessmentResults }) {
  const navigate = useNavigate();
  const toast = useToast();
  const setDecision = useStore((s) => s.setGateDecision);
  const reopen = useStore((s) => s.reopenAssessment);
  const assessor = useStore((s) => s.assessor);
  const [note, setNote] = useState(a.gateDecision.note);
  const r = res.risk;
  const g = res.gates;
  const groups: HeatGroup[] = RISK_COMPONENTS.map((c) => ({ label: c.name, sub: `${c.sourceLabel} · ${c.weight}%`, ids: c.questionIds }));

  return (
    <>
      <PageHeader
        title="Risk & Governance"
        description="AI Risk & Governance Control Maturity — the strength of assessed AI controls."
        meta={<ResultStatusBadge status={r.status} />}
      />
      <LockedBanner a={a} onReopen={() => reopen(a.id)} />
      <Callout tone="info" className="mb-4" title="Direction: a higher score means stronger assessed controls">
        This is a 0–100 control-maturity score, not a risk level. It is never inverted. Components and weights follow the source: governance 25% · responsible AI 25% · cybersecurity, privacy and resilience 25% · data governance 10% (emphasizing D02, D06, D08, D09) · executive oversight 5% · lifecycle controls 10%.
      </Callout>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-center gap-4">
            <ScoreRing value={r.score} color="#1597A2" label="AI Risk and Governance Control Maturity" sub="of 100" dashed={r.status !== 'definitive'} />
            <div className="space-y-1.5">
              <div className="kicker">Assessor-verified</div>
              <div className="text-xs">{pctText(r.questionCoverage)} question coverage</div>
              <div className="text-xs">{pctText(r.weightCoverage)} of weight scored</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Stat label="Self-reported" value={fmt1(res.riskSelf.score)} sub="independent basis" />
            <Stat label="Unverified controls" value={r.unverifiedControls.length} sub="gap or awaiting" tone={r.unverifiedControls.length ? 'warn' : undefined} />
          </div>
          {r.caveats.map((c, i) => <p key={i} className="mt-2 text-xs text-muted">{c}</p>)}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Components" subtitle="Weighted per the source composition" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Risk and governance components</caption>
              <thead><tr><th className="th" scope="col">Component</th><th className="th text-right" scope="col">Weight</th><th className="th text-right" scope="col">Verified</th><th className="th text-right" scope="col">Self</th><th className="th" scope="col">Coverage</th><th className="th" scope="col">Not verified / awaiting</th></tr></thead>
              <tbody>
                {r.components.map((c, i) => (
                  <tr key={c.id}>
                    <th scope="row" className="td text-left font-medium">{c.name}<div className="text-[11px] font-normal text-muted">{c.sourceLabel}</div></th>
                    <td className="td text-right tabular-nums">{c.weight}%</td>
                    <td className="td text-right tabular-nums font-semibold">{c.normalized === null ? 'unscored' : c.normalized.toFixed(1)}</td>
                    <td className="td text-right tabular-nums text-muted">{fmt1(res.riskSelf.components[i].normalized)}</td>
                    <td className="td w-32"><div className="flex items-center gap-2"><ProgressBar value={c.coverage} tone="blue" label={`${c.name} coverage`} /><span className="w-9 text-xs tabular-nums">{pctText(c.coverage)}</span></div></td>
                    <td className="td text-xs">{c.unverifiedIds.length === 0 ? <span className="text-muted">—</span> : <div className="flex flex-wrap gap-1">{c.unverifiedIds.map((q) => <Link key={q} to={`/questionnaire?q=${q}`} className="rounded bg-warn-bg px-1.5 py-0.5 text-[11px] hover:underline">{q}</Link>)}</div>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-navy-50 font-semibold"><td className="td">Control maturity</td><td className="td text-right">100%</td><td className="td text-right tabular-nums">{fmt1(r.score)}</td><td className="td text-right tabular-nums">{fmt1(res.riskSelf.score)}</td><td className="td" colSpan={2} /></tr></tfoot>
            </table>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={<span className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-bad" aria-hidden /> Risk-based maturity gate</span>}
          subtitle={`Advisory policy rule: a verified critical-control score of ${g.threshold} or below flags the classification for review (ceiling ${g.ceiling.label}).`}
          action={<Link to="/settings?tab=scoring" className="link text-sm">Configure gate</Link>}
        />
        {!g.enabled ? (
          <Callout tone="info">{g.explanation[0]}</Callout>
        ) : (
          <>
            <div className={`rounded-lg border p-3.5 ${g.triggered ? 'border-red-300 bg-bad-bg' : 'border-green-300 bg-good-bg'}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {g.triggered ? <AlertTriangle className="h-4 w-4 text-bad" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-good" aria-hidden />}
                {g.status === 'review_required' && 'Classification flagged for assessor review'}
                {g.status === 'confirmed' && 'Gate confirmed — advisory ceiling applied'}
                {g.status === 'overridden' && 'Gate overridden by assessor'}
                {g.status === 'not_triggered' && 'No critical control is verified as deficient'}
                {g.indexClassification && <Badge tone="navy">{g.indexClassification.label} by index</Badge>}
                {g.ceilingApplies && <Badge tone="bad">Advisory ceiling: {g.ceiling.label}</Badge>}
                {g.finalClassification && <Badge tone="teal">Reported: {g.finalClassification.label}</Badge>}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{g.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>

            {g.deficiencies.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold">Critical control deficiencies (verified)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead><tr><th className="th" scope="col">ID</th><th className="th" scope="col">Gate</th><th className="th" scope="col">Control</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Self</th><th className="th" scope="col">Evidence</th></tr></thead>
                    <tbody>
                      {g.deficiencies.map((d) => (
                        <tr key={d.gateId + d.questionId}>
                          <td className="td"><Link to={`/questionnaire?q=${d.questionId}`} className="font-semibold text-teal-700 hover:underline">{d.questionId}</Link></td>
                          <td className="td"><Badge tone="bad">{d.gateName}</Badge></td>
                          <td className="td max-w-[420px]">{d.text}</td>
                          <td className="td"><ScorePill score={d.verifiedScore} /></td>
                          <td className="td"><ScorePill score={d.selfScore} /></td>
                          <td className="td"><EvidenceBadge status={d.evidenceStatus} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {g.triggered && (
              <div className="mt-4 rounded-lg border border-line bg-navy-50/50 p-3.5">
                <h3 className="text-sm font-semibold">Assessor decision</h3>
                <p className="text-xs text-muted">The ceiling is advisory. It only changes the reported classification after an assessor confirms it; an override must state the reason (for example a compensating control).</p>
                <TextArea className="mt-2" label="Decision note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rationale for confirming or overriding" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => { setDecision({ status: 'confirmed', note, decidedBy: assessor.name }); toast('Gate confirmed: advisory ceiling applied'); }}>Confirm advisory ceiling</Button>
                  <Button disabled={!note.trim()} title={note.trim() ? undefined : 'Enter a reason to override'} onClick={() => { setDecision({ status: 'overridden', note, decidedBy: assessor.name }); toast('Gate overridden', 'info'); }}>Override — keep index classification</Button>
                  {a.gateDecision.status !== 'unreviewed' && <Button variant="ghost" onClick={() => { setDecision({ status: 'unreviewed', note: '', decidedBy: '' }); setNote(''); toast('Decision cleared', 'info'); }}>Reset to unreviewed</Button>}
                </div>
                {a.gateDecision.decidedAt && <p className="mt-2 text-xs text-muted">Last decision: {a.gateDecision.status} by {a.gateDecision.decidedBy || 'assessor'} on {new Date(a.gateDecision.decidedAt).toLocaleString('en-IN')}.</p>}
              </div>
            )}

            {(g.selfReportedDeficiencies.length > 0 || g.unverified.length > 0) && (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-semibold">Critical controls not yet verified</h3>
                <p className="mb-2 text-xs text-muted">These do not trigger the gate (nothing is scored as zero), but the gate cannot be cleared with confidence until they are verified.</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.unverified.map((c) => (
                    <Link key={c.gateId + c.questionId} to={`/questionnaire?q=${c.questionId}`} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs hover:border-teal-500">
                      <strong>{c.questionId}</strong> <span className="text-muted">{c.gateName}</span>
                      {c.severity === 'self_reported_deficient' && <Badge tone="warn" title="Self-reported at or below the threshold; not verified">self-reported deficient</Badge>}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Control-gap heatmap" subtitle="Every control in the composition, coloured by assessor-verified score. Select a control to open it." />
        <ControlHeatmap responses={a.responses} groups={groups} criticalIds={criticalQuestionIds(a.config)} deficiencyThreshold={g.threshold} onSelect={(id) => navigate(`/questionnaire?q=${id}`)} />
        <p className="mt-3 text-xs" style={{ color: COLORS.axis }}>Self-reported scores are not shown here: gaps are judged on verified evidence.</p>
      </Card>
    </>
  );
}
