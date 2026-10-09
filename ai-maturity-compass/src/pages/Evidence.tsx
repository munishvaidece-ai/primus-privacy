import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AssessorPanel, EvidencePanel, QuestionHeader, SelfBadge, VerBadge } from '../components/QuestionEditor';
import { EvidenceBadge, LockedBanner, NeedAssessment, NeedProfile } from '../components/shared';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Modal, PageHeader, ProgressBar, Stat, useDocumentTitle } from '../components/ui';
import { DIMENSIONS, QUESTIONS, QUESTION_BY_ID, DIMENSION_BY_ID, SCALE_BY_SCORE } from '../data/spec';
import { EVIDENCE_STATUS_LABELS, evidenceStatusSchema, type Assessment, type EvidenceStatus } from '../domain/schema';
import { pctText } from '../export/narrative';
import { evalQuestion } from '../scoring/questionState';
import { computeResults, questionTags } from '../scoring/results';
import { isEditable, useCurrent } from '../store/hooks';
import { useStore } from '../store/store';

function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    h();
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

export default function Evidence() {
  useDocumentTitle('Evidence & Verification');
  const a = useCurrent();
  return <NeedAssessment a={a}>{(cur) => <NeedProfile a={cur}><Inner a={cur} /></NeedProfile>}</NeedAssessment>;
}

function Inner({ a }: { a: Assessment }) {
  const [params, setParams] = useSearchParams();
  const reopen = useStore((s) => s.reopenAssessment);
  const editable = isEditable(a);
  const wide = useMediaQuery('(min-width: 1280px)');
  const tags = useMemo(() => questionTags(a.config), [a.config]);
  const res = useMemo(() => computeResults(a), [a]);

  const dim = params.get('dimension') ?? 'all';
  const text = params.get('q') ?? '';
  const ev = params.get('evidence') ?? 'any';
  const crit = params.get('crit') ?? 'any';
  const missing = params.get('missing') === '1';
  const na = params.get('na') === '1';
  const dk = params.get('dk') === '1';
  const awaiting = params.get('awaiting') === '1';
  const setP = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v === null || v === '' || v === 'any' || v === 'all' || v === '0') p.delete(k); else p.set(k, v); setParams(p, { replace: true }); };
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return QUESTIONS.filter((q) => {
      const r = a.responses[q.id];
      if (dim !== 'all' && q.dimensionId !== dim) return false;
      if (t && !(q.id.toLowerCase().includes(t) || q.text.toLowerCase().includes(t))) return false;
      if (ev !== 'any' && r.evidence.status !== ev) return false;
      if (crit !== 'any' && tags[q.id].criticality !== crit) return false;
      const ver = evalQuestion(r, 'verified');
      if (missing && (r.evidence.reference.trim() || ver.state === 'not_applicable')) return false;
      if (na && ver.state !== 'not_applicable') return false;
      if (dk && !(r.self.state === 'dont_know' || r.verified.state === 'not_verified')) return false;
      if (awaiting && ver.state !== 'pending') return false;
      return true;
    });
  }, [a, dim, text, ev, crit, missing, na, dk, awaiting, tags]);

  const selIdx = rows.findIndex((q) => q.id === selected);
  const c = res.coverage;
  const statusCounts = useMemo(() => {
    const m: Record<EvidenceStatus, number> = { none: 0, provided: 0, reviewed: 0, accepted: 0, rejected: 0, clarification: 0 };
    for (const q of QUESTIONS) if (evalQuestion(a.responses[q.id], 'verified').state !== 'not_applicable') m[a.responses[q.id].evidence.status]++;
    return m;
  }, [a.responses]);

  const detail = selected && QUESTION_BY_ID[selected] ? (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <QuestionHeader a={a} qid={selected} />
        <button type="button" onClick={() => setSelected(null)} aria-label="Close detail panel" className="rounded-md p-1 text-muted hover:bg-navy-100 xl:block hidden"><X className="h-5 w-5" /></button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg border border-line bg-white p-2.5"><div className="text-xs text-muted">Self-reported</div><div className="mt-1 flex items-center gap-1.5"><SelfBadge r={a.responses[selected]} />{a.responses[selected].self.state === 'scored' && <span className="text-xs">{SCALE_BY_SCORE[a.responses[selected].self.score as 0].label}</span>}</div></div>
        <div className="rounded-lg border border-line bg-white p-2.5"><div className="text-xs text-muted">Assessor-verified</div><div className="mt-1 flex items-center gap-1.5"><VerBadge r={a.responses[selected]} />{a.responses[selected].verified.state === 'scored' && <span className="text-xs">{SCALE_BY_SCORE[a.responses[selected].verified.score as 0].label}</span>}</div></div>
      </div>
      <EvidencePanel qid={selected} r={a.responses[selected]} disabled={!editable} />
      <div className="rounded-xl border border-blue-200 bg-info-bg/40 p-4"><AssessorPanel qid={selected} r={a.responses[selected]} disabled={!editable} /></div>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <Button size="sm" disabled={selIdx <= 0} onClick={() => setSelected(rows[selIdx - 1].id)}><ChevronLeft className="h-4 w-4" aria-hidden /> Previous</Button>
        <span className="text-xs text-muted">{selIdx >= 0 ? `${selIdx + 1} of ${rows.length} in this view` : 'Not in current filter'}</span>
        <Button size="sm" disabled={selIdx < 0 || selIdx >= rows.length - 1} onClick={() => setSelected(rows[selIdx + 1].id)}>Next <ChevronRight className="h-4 w-4" aria-hidden /></Button>
      </div>
      <Link to={`/questionnaire?q=${selected}`} className="link text-sm">Open in questionnaire</Link>
    </div>
  ) : null;

  return (
    <>
      <PageHeader title="Evidence & Verification" description="Review self-reported scores, record evidence references and determine verified scores. Evidence is only treated as verified when an assessor marks it Accepted." />
      <LockedBanner a={a} onReopen={() => reopen(a.id)} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Review completion" value={pctText(c.reviewCompletion)} sub="assessor has taken a position" />
        <Stat label="Evidence referenced" value={c.withReference} sub={`${c.missingEvidence} with no reference`} />
        <Stat label="Reviewed by assessor" value={c.reviewed} sub="any outcome" />
        <Stat label="Accepted (verified)" value={c.accepted} sub={pctText(c.acceptedShare)} tone="good" />
        <Stat label="Rejected / clarification" value={`${c.rejected} / ${c.clarification}`} tone={c.rejected + c.clarification ? 'warn' : undefined} />
      </div>
      <Card className="mt-3" pad={false}>
        <div className="p-3.5">
          <div className="mb-1 flex justify-between text-xs text-muted"><span>Assessor review completion (scored or recorded as not verified, of applicable questions)</span><span>{c.verifiedScored + c.assessorNotVerified} of {c.applicable}</span></div>
          <ProgressBar value={c.reviewCompletion} tone="blue" label="Assessor review completion" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {evidenceStatusSchema.options.map((s) => (
              <button key={s} type="button" onClick={() => setP('evidence', ev === s ? null : s)} aria-pressed={ev === s} className={clsx('rounded-full border px-2.5 py-1 text-xs', ev === s ? 'border-teal-600 bg-teal-50 font-medium' : 'border-navy-200 bg-white hover:bg-navy-50')}>
                {EVIDENCE_STATUS_LABELS[s]} · {statusCounts[s]}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="mt-4" pad={false}>
        <div className="grid gap-3 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block"><span className="label">Dimension</span>
            <select className="input" value={dim} onChange={(e) => setP('dimension', e.target.value)}>
              <option value="all">All dimensions</option>
              {DIMENSIONS.map((d) => <option key={d.id} value={d.id}>{d.number}. {d.name}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Question ID or text</span>
            <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden /><input className="input pl-8" type="search" value={text} onChange={(e) => setP('q', e.target.value)} placeholder="e.g. C04" /></div>
          </label>
          <label className="block"><span className="label">Verification status</span>
            <select className="input" value={ev} onChange={(e) => setP('evidence', e.target.value)}>
              <option value="any">Any status</option>
              {evidenceStatusSchema.options.map((s) => <option key={s} value={s}>{EVIDENCE_STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Criticality</span>
            <select className="input" value={crit} onChange={(e) => setP('crit', e.target.value)}>
              <option value="any">Any criticality</option>
              <option value="critical">Critical controls</option>
              <option value="high">Feeds principal scores</option>
              <option value="standard">Standard</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line px-3.5 py-3">
          <Checkbox checked={missing} onChange={(v) => setP('missing', v ? '1' : null)} label="Missing evidence" />
          <Checkbox checked={na} onChange={(v) => setP('na', v ? '1' : null)} label="Not applicable" />
          <Checkbox checked={dk} onChange={(v) => setP('dk', v ? '1' : null)} label="Don't know / not verified" />
          <Checkbox checked={awaiting} onChange={(v) => setP('awaiting', v ? '1' : null)} label="Awaiting assessment" />
          {(dim !== 'all' || text || ev !== 'any' || crit !== 'any' || missing || na || dk || awaiting) && <button type="button" className="text-sm link" onClick={() => setParams({}, { replace: true })}>Clear all filters</button>}
        </div>
      </Card>

      <div className={clsx('mt-4 grid gap-4', wide && selected ? 'xl:grid-cols-[minmax(0,1fr)_480px]' : '')}>
        <Card pad={false} className="min-w-0">
          <div className="flex items-center justify-between px-4 pt-3"><CardHeader title={`${rows.length} question${rows.length === 1 ? '' : 's'}`} subtitle="Select a row to review and verify" /></div>
          {rows.length === 0 ? (
            <EmptyState icon={<Search className="h-9 w-9" />} title="No questions match these filters">Adjust or clear the filters to see more questions.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <caption className="sr-only">Questions with self-reported score, verified score and evidence status</caption>
                <thead><tr><th className="th" scope="col">ID</th><th className="th" scope="col">Question</th><th className="th" scope="col">Self</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Δ</th><th className="th" scope="col">Evidence</th></tr></thead>
                <tbody>
                  {rows.map((q) => {
                    const r = a.responses[q.id];
                    const t = tags[q.id];
                    const d = r.self.state === 'scored' && r.verified.state === 'scored' ? (r.self.score as number) - (r.verified.score as number) : null;
                    return (
                      <tr key={q.id} className={clsx('cursor-pointer hover:bg-navy-50', selected === q.id && 'bg-teal-50')} onClick={() => setSelected(q.id)}>
                        <td className="td whitespace-nowrap">
                          <button type="button" className="font-semibold text-teal-700 hover:underline" onClick={(e) => { e.stopPropagation(); setSelected(q.id); }} aria-label={`Review ${q.id}`}>{q.id}</button>
                          {t.criticality === 'critical' && <div><Badge tone="bad" className="mt-1">Critical</Badge></div>}
                        </td>
                        <td className="td max-w-[420px]"><div className="line-clamp-2">{q.text}</div><div className="mt-0.5 text-[11px] text-muted">{DIMENSION_BY_ID[q.dimensionId].shortName}</div></td>
                        <td className="td"><SelfBadge r={r} /></td>
                        <td className="td"><VerBadge r={r} /></td>
                        <td className="td tabular-nums text-xs">{d === null ? '—' : <span className={d >= 2 ? 'font-semibold text-warn' : ''}>{d > 0 ? '+' : ''}{d}</span>}</td>
                        <td className="td"><EvidenceBadge status={r.evidence.status} />{r.evidence.reference && <div className="mt-0.5 max-w-[200px] truncate text-[11px] text-muted" title={r.evidence.reference}>{r.evidence.reference}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {wide && selected && <aside aria-label="Question detail" className="card card-pad xl:sticky xl:top-20 xl:self-start xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">{detail}</aside>}
      </div>

      {!wide && <Modal open={!!selected} onClose={() => setSelected(null)} title={`Review ${selected ?? ''}`} size="lg">{detail}</Modal>}
    </>
  );
}
