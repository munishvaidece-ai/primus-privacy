import { CheckCircle2, ChevronLeft, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LockedBanner, NeedAssessment, NeedProfile, ResultStatusBadge } from '../components/shared';
import { Badge, Button, Callout, Card, CardHeader, ConfirmDialog, PageHeader, ProgressBar, Stat, useDocumentTitle, useToast } from '../components/ui';
import { DIMENSIONS, QUESTIONS } from '../data/spec';
import type { Assessment } from '../domain/schema';
import { pctText, fmt1 } from '../export/narrative';
import { reviewAssessment } from '../scoring/review';
import { computeResults } from '../scoring/results';
import { useCurrent } from '../store/hooks';
import { useStore } from '../store/store';

export default function Review() {
  useDocumentTitle('Review & submit');
  const a = useCurrent();
  return <NeedAssessment a={a}>{(cur) => <NeedProfile a={cur}><Inner a={cur} /></NeedProfile>}</NeedAssessment>;
}

function Inner({ a }: { a: Assessment }) {
  const navigate = useNavigate();
  const toast = useToast();
  const submit = useStore((s) => s.submitAssessment);
  const reopen = useStore((s) => s.reopenAssessment);
  const [confirm, setConfirm] = useState(false);
  const res = useMemo(() => computeResults(a), [a]);
  const issues = useMemo(() => reviewAssessment(a, res), [a, res]);
  const blockers = issues.filter((i) => i.level === 'blocker');
  const c = res.coverage;

  return (
    <>
      <PageHeader
        title="Review & submit"
        description="Check completeness and evidence before marking the assessment submitted. Submission locks data entry until reopened."
        actions={<Link to="/questionnaire" className="btn btn-md btn-secondary"><ChevronLeft className="h-4 w-4" aria-hidden /> Back to questionnaire</Link>}
      />
      <LockedBanner a={a} onReopen={() => reopen(a.id)} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Self-reported answers" value={`${c.selfAnswered + c.selfDontKnow + c.selfNotApplicable} / ${c.totalQuestions}`} sub={`${c.selfUnanswered} unanswered`} tone={c.selfUnanswered ? 'warn' : 'good'} />
        <Stat label="Assessor-verified" value={`${c.verifiedScored} / ${c.applicable}`} sub={`${c.awaitingAssessment} awaiting`} />
        <Stat label="Evidence accepted" value={`${c.accepted}`} sub={`${pctText(c.acceptedShare)} of applicable`} />
        <Stat label="Dimensions with sufficient coverage" value={`${c.sufficientDimensions} / 12`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Checks before submission" subtitle={issues.length === 0 ? 'Everything required is in place.' : `${issues.length} item${issues.length > 1 ? 's' : ''} to consider`} />
          {issues.length === 0 ? (
            <Callout tone="good" title="No issues found">All questions are answered, verified and supported by evidence.</Callout>
          ) : (
            <ul className="space-y-3">
              {issues.map((i) => (
                <li key={i.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start gap-2">
                    <Badge tone={i.level === 'blocker' ? 'bad' : i.level === 'warning' ? 'warn' : 'info'}>{i.level === 'blocker' ? 'Fix before submitting' : i.level === 'warning' ? 'Warning' : 'Note'}</Badge>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{i.title}</div>
                      <p className="text-xs text-muted mt-0.5">{i.detail}</p>
                      {i.questionIds.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {i.questionIds.slice(0, 40).map((q) => <Link key={q} to={`/questionnaire?q=${q}`} className="rounded bg-navy-100 px-1.5 py-0.5 text-[11px] hover:bg-navy-200">{q}</Link>)}
                          {i.questionIds.length > 40 && <span className="text-[11px] text-muted">+{i.questionIds.length - 40} more</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Current results" subtitle="As they stand if submitted now" />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">AI Maturity Index (verified)</dt><dd className="font-semibold tabular-nums">{fmt1(res.maturity.index)} <ResultStatusBadge status={res.maturity.status} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">Self-reported index</dt><dd className="tabular-nums">{fmt1(res.maturitySelf.index)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Risk & governance control maturity</dt><dd className="tabular-nums">{fmt1(res.risk.score)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Value realization</dt><dd className="tabular-nums">{fmt1(res.value.score)}</dd></div>
          </dl>
          {res.maturity.caveats.map((cv, i) => <p key={i} className="mt-2 text-xs text-muted">{cv}</p>)}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Completeness by dimension" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr><th className="th" scope="col">Dimension</th><th className="th" scope="col">Self-reported</th><th className="th" scope="col">Verified coverage</th><th className="th" scope="col">Open questions</th></tr></thead>
            <tbody>
              {DIMENSIONS.map((d, i) => {
                const qs = QUESTIONS.filter((q) => q.dimensionId === d.id);
                const open = qs.filter((q) => a.responses[q.id].self.state === 'unanswered').map((q) => q.id);
                const v = res.maturity.dimensions[i];
                return (
                  <tr key={d.id}>
                    <th scope="row" className="td text-left font-medium">{d.number}. {d.name}</th>
                    <td className="td w-48"><div className="flex items-center gap-2"><ProgressBar value={(qs.length - open.length) / qs.length} tone="orange" label={`${d.name} self-reported`} /><span className="text-xs tabular-nums whitespace-nowrap">{qs.length - open.length}/{qs.length}</span></div></td>
                    <td className="td w-48"><div className="flex items-center gap-2"><ProgressBar value={v.coverage} tone="blue" label={`${d.name} verified coverage`} /><span className="text-xs tabular-nums whitespace-nowrap">{pctText(v.coverage)}</span></div></td>
                    <td className="td">{open.length === 0 ? <span className="inline-flex items-center gap-1 text-xs text-good"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> none</span> : <div className="flex flex-wrap gap-1">{open.map((q) => <Link key={q} to={`/questionnaire?q=${q}`} className="rounded bg-warn-bg px-1.5 py-0.5 text-[11px] hover:underline">{q}</Link>)}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {blockers.length > 0 && <span className="text-sm text-bad">Resolve the blocking item{blockers.length > 1 ? 's' : ''} above to submit.</span>}
        {a.status === 'submitted' ? (
          <Button onClick={() => reopen(a.id)}>Reopen for review</Button>
        ) : (
          <Button variant="primary" disabled={blockers.length > 0} onClick={() => setConfirm(true)}><Lock className="h-4 w-4" aria-hidden /> Mark assessment submitted</Button>
        )}
      </div>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Submit this assessment?" confirmLabel="Mark submitted" onConfirm={() => { submit(a.id); toast('Assessment marked submitted'); navigate('/'); }}>
        <p>Questionnaire, evidence, indicator and India-diagnostic edits will be locked. You can reopen the assessment later for authorized review.</p>
        {issues.filter((i) => i.level === 'warning').length > 0 && <p className="text-muted">{issues.filter((i) => i.level === 'warning').length} warning(s) remain; unscored questions stay unscored and will be disclosed in reports.</p>}
      </ConfirmDialog>
    </>
  );
}
