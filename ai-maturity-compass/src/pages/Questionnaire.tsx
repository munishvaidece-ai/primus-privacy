import clsx from 'clsx';
import { AlertCircle, ArrowLeft, ArrowRight, ChevronDown, ClipboardCheck, List, Rows3, Save, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AssessorPanel, EvidencePanel, QuestionHeader, ScoreSummary, SelfBadge, SelfPanel, VerBadge } from '../components/QuestionEditor';
import { LockedBanner, NeedAssessment, NeedProfile } from '../components/shared';
import { Badge, Button, Card, EmptyState, PageHeader, ProgressBar, useDocumentTitle, useToast } from '../components/ui';
import { DIMENSIONS, DIMENSION_BY_ID, QUESTIONS, QUESTION_BY_ID, SCALE_BY_SCORE, type DimensionId, type Score } from '../data/spec';
import type { Assessment, Response } from '../domain/schema';
import { questionTags } from '../scoring/results';
import { isEditable, useCurrent } from '../store/hooks';
import { useStore } from '../store/store';

type QFilter = 'all' | 'unanswered' | 'answered' | 'na' | 'dk' | 'noevidence' | 'awaiting' | 'critical';
const FILTERS: { v: QFilter; label: string }[] = [
  { v: 'all', label: 'All questions' },
  { v: 'unanswered', label: 'Unanswered (incomplete)' },
  { v: 'answered', label: 'Answered' },
  { v: 'noevidence', label: 'No evidence reference' },
  { v: 'awaiting', label: 'Awaiting assessor' },
  { v: 'dk', label: "Don't know / not verified" },
  { v: 'na', label: 'Not applicable' },
  { v: 'critical', label: 'Critical controls' },
];

const answered = (r: Response) => r.self.state !== 'unanswered';

function matches(a: Assessment, qid: string, f: QFilter, text: string, tags: ReturnType<typeof questionTags>): boolean {
  const r = a.responses[qid];
  const q = QUESTION_BY_ID[qid];
  const t = text.trim().toLowerCase();
  if (t && !(q.id.toLowerCase().includes(t) || q.text.toLowerCase().includes(t) || r.evidence.reference.toLowerCase().includes(t) || r.observations.toLowerCase().includes(t))) return false;
  switch (f) {
    case 'unanswered': return r.self.state === 'unanswered';
    case 'answered': return answered(r);
    case 'na': return r.self.state === 'not_applicable' || r.verified.state === 'not_applicable';
    case 'dk': return r.self.state === 'dont_know' || r.verified.state === 'not_verified';
    case 'noevidence': return !r.evidence.reference.trim() && r.self.state !== 'not_applicable' && r.verified.state !== 'not_applicable';
    case 'awaiting': return r.verified.state === 'pending' && r.self.state !== 'not_applicable';
    case 'critical': return tags[qid].criticality === 'critical';
    default: return true;
  }
}

function QuestionCard({ a, qid, disabled, assessor }: { a: Assessment; qid: string; disabled: boolean; assessor: boolean }) {
  const r = a.responses[qid];
  return (
    <div className="space-y-5">
      <SelfPanel qid={qid} r={r} disabled={disabled} />
      <div className="border-t border-line pt-4"><EvidencePanel qid={qid} r={r} disabled={disabled} /></div>
      {assessor && <div className="rounded-xl border border-blue-200 bg-info-bg/40 p-4"><AssessorPanel qid={qid} r={r} disabled={disabled} /></div>}
    </div>
  );
}

export default function Questionnaire() {
  useDocumentTitle('Assessment Questionnaire');
  const a = useCurrent();
  return <NeedAssessment a={a}>{(cur) => <NeedProfile a={cur}><Inner a={cur} /></NeedProfile>}</NeedAssessment>;
}

function Inner({ a }: { a: Assessment }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const reopen = useStore((s) => s.reopenAssessment);
  const flush = useStore((s) => s.flush);
  const lastSaved = useStore((s) => s.lastSavedAt);
  const editable = isEditable(a);
  const tags = useMemo(() => questionTags(a.config), [a.config]);

  const [mode, setMode] = useState<'single' | 'list'>(params.get('mode') === 'list' ? 'list' : 'single');
  const [dim, setDim] = useState<DimensionId | 'all'>('all');
  const [filter, setFilter] = useState<QFilter>('all');
  const [search, setSearch] = useState('');
  const [assessor, setAssessor] = useState(true);
  const [currentQ, setCurrentQ] = useState<string>(() => {
    const q = params.get('q');
    return q && QUESTION_BY_ID[q] ? q : (QUESTIONS.find((x) => a.responses[x.id].self.state === 'unanswered') ?? QUESTIONS[0]).id;
  });
  const [openRows, setOpenRows] = useState<Set<string>>(() => new Set(params.get('q') ? [params.get('q') as string] : []));

  // Deep link (?q=ID) from other pages.
  const qParam = params.get('q');
  useEffect(() => {
    if (qParam && QUESTION_BY_ID[qParam]) {
      setCurrentQ(qParam);
      setOpenRows((s) => new Set(s).add(qParam));
      setFilter('all'); setSearch(''); setDim('all');
      setTimeout(() => document.getElementById(`row-${qParam}`)?.scrollIntoView({ block: 'center' }), 80);
    }
  }, [qParam]);

  const visible = useMemo(
    () => QUESTIONS.filter((q) => (dim === 'all' || q.dimensionId === dim) && matches(a, q.id, filter, search, tags)),
    [a, dim, filter, search, tags],
  );
  const idx = visible.findIndex((q) => q.id === currentQ);
  const cur = idx >= 0 ? visible[idx] : visible[0];
  const qid = cur?.id;

  const progress = useMemo(() => {
    const per = DIMENSIONS.map((d) => {
      const qs = QUESTIONS.filter((q) => q.dimensionId === d.id);
      const done = qs.filter((q) => answered(a.responses[q.id])).length;
      return { d, done, total: qs.length };
    });
    const done = per.reduce((s, p) => s + p.done, 0);
    return { per, done, total: QUESTIONS.length };
  }, [a.responses]);

  const go = (id: string) => { setCurrentQ(id); const p = new URLSearchParams(params); p.set('q', id); setParams(p, { replace: true }); };
  const nextUnanswered = () => {
    const start = Math.max(0, idx);
    const order = [...visible.slice(start + 1), ...visible.slice(0, start)];
    const hit = order.find((q) => a.responses[q.id].self.state === 'unanswered');
    if (hit) go(hit.id); else toast('Every visible question has a self-reported answer.', 'info');
  };

  // Number keys 0–4 select a self-reported score in one-at-a-time mode (not while typing).
  const setSelf = useStore((s) => s.updateResponse);
  const qidRef = useRef(qid);
  qidRef.current = qid;
  useEffect(() => {
    if (mode !== 'single' || !editable) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-4]$/.test(e.key) && qidRef.current) setSelf(qidRef.current, (r) => ({ ...r, self: { state: 'scored', score: Number(e.key) as Score } }));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [mode, editable, setSelf]);

  const saveExit = () => { flush(); toast('Progress saved'); navigate('/assessments'); };

  return (
    <>
      <PageHeader
        title="Assessment Questionnaire"
        description="100 diagnostic questions across 12 dimensions. Answers save automatically as you go."
        actions={
          <>
            <Button onClick={saveExit}><Save className="h-4 w-4" aria-hidden /> Save & exit</Button>
            <Link to="/questionnaire/review" className="btn btn-md btn-primary"><ClipboardCheck className="h-4 w-4" aria-hidden /> Review & submit</Link>
          </>
        }
      />
      <LockedBanner a={a} onReopen={() => reopen(a.id)} />

      <Card className="mb-4" pad={false}>
        <div className="flex flex-wrap items-center gap-3 p-3.5">
          <div role="group" aria-label="Question view mode" className="inline-flex rounded-lg border border-navy-200 bg-white p-0.5">
            <button type="button" aria-pressed={mode === 'single'} onClick={() => setMode('single')} className={clsx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', mode === 'single' ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50')}><Rows3 className="h-4 w-4" aria-hidden /> One at a time</button>
            <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')} className={clsx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', mode === 'list' ? 'bg-navy-900 text-white' : 'text-navy-700 hover:bg-navy-50')}><List className="h-4 w-4" aria-hidden /> Compact list</button>
          </div>
          <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
            <input className="input pl-8" type="search" aria-label="Search questions by ID or text" placeholder="Search by ID or text (e.g. C04, vendor)" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm"><span className="sr-only sm:not-sr-only text-muted">Filter</span>
            <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as QFilter)} aria-label="Filter questions">
              {FILTERS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-navy-300 text-teal-600" checked={assessor} onChange={(e) => setAssessor(e.target.checked)} /> Show assessor panel</label>
        </div>
        <div className="border-t border-line px-3.5 py-2.5">
          <div className="mb-1 flex justify-between text-xs text-muted"><span>Self-reported progress: {progress.done} of {progress.total} questions answered</span><span aria-live="polite">{lastSaved ? 'All changes saved automatically' : ''}</span></div>
          <ProgressBar value={progress.done / progress.total} tone="teal" label="Overall questionnaire progress" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
        <nav aria-label="Dimensions" className="lg:sticky lg:top-20 lg:self-start">
          <label className="lg:hidden block"><span className="label">Dimension</span>
            <select className="input" value={dim} onChange={(e) => { const v = e.target.value as DimensionId | 'all'; setDim(v); const f = QUESTIONS.find((q) => v === 'all' || q.dimensionId === v); if (f) go(f.id); }}>
              <option value="all">All dimensions</option>
              {progress.per.map((p) => <option key={p.d.id} value={p.d.id}>{p.d.number}. {p.d.name} ({p.done}/{p.total})</option>)}
            </select>
          </label>
          <ul className="hidden lg:block space-y-1">
            <li>
              <button type="button" onClick={() => setDim('all')} aria-current={dim === 'all'} className={clsx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm', dim === 'all' ? 'bg-navy-900 text-white' : 'hover:bg-navy-100')}>
                <span>All dimensions</span><span className="text-xs opacity-80">{progress.done}/{progress.total}</span>
              </button>
            </li>
            {progress.per.map((p) => {
              const incomplete = p.total - p.done;
              return (
                <li key={p.d.id}>
                  <button
                    type="button" aria-current={dim === p.d.id}
                    onClick={() => { setDim(p.d.id); const first = QUESTIONS.find((q) => q.dimensionId === p.d.id && a.responses[q.id].self.state === 'unanswered') ?? QUESTIONS.find((q) => q.dimensionId === p.d.id)!; go(first.id); }}
                    className={clsx('w-full rounded-lg px-3 py-2 text-left text-sm', dim === p.d.id ? 'bg-navy-900 text-white' : 'hover:bg-navy-100')}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="leading-snug">{p.d.number}. {p.d.name}</span>
                      {incomplete > 0 ? <span title={`${incomplete} unanswered`} className={clsx('mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-[11px]', dim === p.d.id ? 'text-amber-300' : 'text-warn')}><AlertCircle className="h-3 w-3" aria-hidden />{incomplete}</span> : <span className="mt-0.5 text-[11px] text-teal-400" aria-label="complete">✓</span>}
                    </span>
                    <ProgressBar value={p.done / p.total} tone="teal" label={`${p.d.name} progress`} height="h-1" className={clsx('mt-1.5', dim === p.d.id && 'bg-white/20')} />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          {visible.length === 0 ? (
            <Card><EmptyState icon={<Search className="h-9 w-9" />} title="No questions match" action={<Button onClick={() => { setFilter('all'); setSearch(''); setDim('all'); }}>Clear filters</Button>}>Try a different search term or filter.</EmptyState></Card>
          ) : mode === 'single' && cur ? (
            <Card>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                <span>Question {idx >= 0 ? idx + 1 : 1} of {visible.length}{dim !== 'all' ? ` in ${DIMENSION_BY_ID[dim].shortName}` : ''}{filter !== 'all' || search ? ' (filtered)' : ''}</span>
                <ScoreSummary r={a.responses[cur.id]} />
              </div>
              <QuestionHeader a={a} qid={cur.id} />
              <div className="mt-5"><QuestionCard a={a} qid={cur.id} disabled={!editable} assessor={assessor} /></div>
              <p className="mt-3 text-xs text-muted">Tip: press 0–4 to set the self-reported score (when not typing in a field).</p>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                <Button disabled={idx <= 0} onClick={() => go(visible[idx - 1].id)}><ArrowLeft className="h-4 w-4" aria-hidden /> Previous</Button>
                <div className="flex items-center gap-2">
                  <select className="input w-auto max-w-[190px]" aria-label="Jump to question" value={cur.id} onChange={(e) => go(e.target.value)}>
                    {visible.map((q) => <option key={q.id} value={q.id}>{q.id}{answered(a.responses[q.id]) ? ' ✓' : ''}</option>)}
                  </select>
                  <Button onClick={nextUnanswered}>Next unanswered</Button>
                </div>
                {idx < visible.length - 1 ? (
                  <Button variant="primary" onClick={() => go(visible[idx + 1].id)}>Next <ArrowRight className="h-4 w-4" aria-hidden /></Button>
                ) : (
                  <Link to="/questionnaire/review" className="btn btn-md btn-primary">Review & submit <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                )}
              </div>
            </Card>
          ) : (
            <div>
              <p className="mb-2 text-sm text-muted" aria-live="polite">{visible.length} question{visible.length === 1 ? '' : 's'} shown</p>
              <ul className="space-y-2.5">
                {visible.map((q, i) => {
                  const r = a.responses[q.id];
                  const open = openRows.has(q.id);
                  const newDim = i === 0 || visible[i - 1].dimensionId !== q.dimensionId;
                  const tag = tags[q.id];
                  return (
                    <li key={q.id}>
                      {newDim && <h2 className="mb-2 mt-3 text-sm font-semibold text-teal-700">{DIMENSION_BY_ID[q.dimensionId].number}. {DIMENSION_BY_ID[q.dimensionId].name} <span className="font-normal text-muted">· {DIMENSION_BY_ID[q.dimensionId].weight}%</span></h2>}
                      <div id={`row-${q.id}`} className={clsx('card', currentQ === q.id && 'ring-2 ring-teal-500/50')}>
                        <div className="flex flex-wrap items-start gap-3 p-3">
                          <div className="w-14 shrink-0">
                            <Badge tone="navy">{q.id}</Badge>
                            {r.self.state === 'unanswered' && <div className="mt-1 flex items-center gap-0.5 text-[11px] text-warn" title="Not yet answered"><AlertCircle className="h-3 w-3" aria-hidden />open</div>}
                          </div>
                          <div className="min-w-[220px] flex-1">
                            <p className="text-sm leading-snug">{q.text}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {tag.criticality === 'critical' && <Badge tone="bad">Critical control</Badge>}
                              <span className="flex items-center gap-1 text-xs text-muted">Self <SelfBadge r={r} /></span>
                              <span className="flex items-center gap-1 text-xs text-muted">Verified <VerBadge r={r} /></span>
                              {r.evidence.reference.trim() ? <Badge tone={r.evidence.status === 'accepted' ? 'good' : 'info'}>{r.evidence.status === 'accepted' ? 'Evidence accepted' : 'Evidence referenced'}</Badge> : <Badge tone="neutral">No evidence</Badge>}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Quick answer for ${q.id}`}>
                            {[0, 1, 2, 3, 4].map((s) => (
                              <button
                                key={s} type="button" disabled={!editable} aria-label={`${q.id}: score ${s}`} title={`${s} — ${SCALE_BY_SCORE[s as Score].label}: ${SCALE_BY_SCORE[s as Score].description}`} aria-pressed={r.self.state === 'scored' && r.self.score === s}
                                onClick={() => useStore.getState().updateResponse(q.id, (x) => ({ ...x, self: { state: 'scored', score: s as Score } }))}
                                className={clsx('h-8 w-8 rounded-md border text-sm font-semibold', r.self.state === 'scored' && r.self.score === s ? 'border-teal-600 bg-teal-600 text-white' : 'border-navy-200 bg-white hover:bg-navy-50')}
                              >{s}</button>
                            ))}
                            <button type="button" disabled={!editable} aria-pressed={r.self.state === 'not_applicable'} onClick={() => useStore.getState().updateResponse(q.id, (x) => ({ ...x, self: { state: 'not_applicable', score: null } }))} className={clsx('h-8 rounded-md border px-2 text-xs', r.self.state === 'not_applicable' ? 'border-navy-700 bg-navy-100 font-medium' : 'border-navy-200 bg-white hover:bg-navy-50')}>N/A</button>
                            <button type="button" disabled={!editable} aria-pressed={r.self.state === 'dont_know'} onClick={() => useStore.getState().updateResponse(q.id, (x) => ({ ...x, self: { state: 'dont_know', score: null } }))} className={clsx('h-8 rounded-md border px-2 text-xs', r.self.state === 'dont_know' ? 'border-amber-600 bg-warn-bg font-medium' : 'border-navy-200 bg-white hover:bg-navy-50')} title="Don't know / not verified">DK</button>
                            <button
                              type="button" aria-expanded={open} aria-controls={`detail-${q.id}`}
                              onClick={() => { setCurrentQ(q.id); setOpenRows((s) => { const n = new Set(s); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; }); }}
                              className="ml-1 inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-teal-700 hover:bg-teal-50"
                            >Details <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden /></button>
                          </div>
                        </div>
                        {open && <div id={`detail-${q.id}`} className="border-t border-line bg-navy-50/50 p-4"><QuestionCard a={a} qid={q.id} disabled={!editable} assessor={assessor} /></div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
