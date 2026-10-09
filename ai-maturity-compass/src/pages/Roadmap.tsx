import clsx from 'clsx';
import { ChevronDown, Download, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NeedAssessment, NeedProfile } from '../components/shared';
import { Badge, Button, Callout, Card, EmptyState, Modal, PageHeader, ProgressBar, SelectField, Tabs, TabPanel, TextArea, TextField, useDocumentTitle, useToast, type Tone } from '../components/ui';
import { DIMENSIONS, DIMENSION_BY_ID } from '../data/spec';
import { bucketSchema, prioritySchema, recStatusSchema, type Assessment, type Bucket, type Priority, type RecOverride, type RecStatus } from '../domain/schema';
import { downloadText, saveMessage } from '../export/download';
import { exportFilename, recommendationsCsv } from '../export/csv';
import { ADVISORY_NOTICE, BUCKET_LABELS, PRIORITY_LABELS, STATUS_LABELS, type Recommendation } from '../scoring/recommendations';
import type { AssessmentResults } from '../scoring/results';
import { useCurrent, useResults } from '../store/hooks';
import { useStore } from '../store/store';

const PRIORITY_TONE: Record<Priority, Tone> = { critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' };
type Tab = 'recommendations' | 'roadmap';

export default function Roadmap() {
  useDocumentTitle('Recommendations & Roadmap');
  const a = useCurrent();
  const res = useResults(a);
  return <NeedAssessment a={a}>{(cur) => <NeedProfile a={cur}>{res && <Inner a={cur} res={res} />}</NeedProfile>}</NeedAssessment>;
}

const EDIT_FIELDS = ['title', 'gap', 'why', 'intervention', 'role', 'timeframe', 'dependencies', 'kpi'] as const;

function Inner({ a, res }: { a: Assessment; res: AssessmentResults }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'roadmap' ? 'roadmap' : 'recommendations';
  const focusRec = params.get('rec');
  const setOverride = useStore((s) => s.setRecOverride);
  const clearOverride = useStore((s) => s.clearRecOverride);
  const updateCustom = useStore((s) => s.updateCustomRec);
  const deleteCustom = useStore((s) => s.deleteCustomRec);
  const addCustom = useStore((s) => s.addCustomRec);

  const [fp, setFp] = useState<'any' | Priority>('any');
  const [fs, setFs] = useState<'any' | RecStatus>('any');
  const [fd, setFd] = useState('any');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Recommendation | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(focusRec ? [focusRec] : []));

  useEffect(() => {
    if (focusRec) {
      setExpanded((s) => new Set(s).add(focusRec));
      setTimeout(() => document.getElementById(`rec-${focusRec}`)?.scrollIntoView({ block: 'center' }), 60);
    }
  }, [focusRec]);

  const recs = res.recommendations;
  const filtered = useMemo(() => recs.filter((r) =>
    (fp === 'any' || r.priority === fp) && (fs === 'any' || r.status === fs) && (fd === 'any' || r.dimensionId === fd) &&
    (!q.trim() || (r.title + r.gap + r.questionIds.join(' ')).toLowerCase().includes(q.trim().toLowerCase())),
  ), [recs, fp, fs, fd, q]);

  const patch = (r: Recommendation, p: RecOverride) => {
    if (r.isCustom) updateCustom(r.id, (p.bucket ? { ...p, timeframe: BUCKET_LABELS[p.bucket] } : p) as never);
    else setOverride(r.id, p);
  };

  const setTab = (t: Tab) => { const p = new URLSearchParams(params); p.set('tab', t); p.delete('rec'); setParams(p, { replace: true }); };
  const done = recs.filter((r) => r.status === 'completed').length;
  const active = recs.filter((r) => r.status !== 'dismissed').length;

  return (
    <>
      <PageHeader
        title="Recommendations & Roadmap"
        description="Prioritized by deficient controls, low-maturity high-weight dimensions and missing evidence before lighter enhancements."
        actions={
          <>
            <Button onClick={async () => { const m = saveMessage(await downloadText(exportFilename(a, 'recommendations', 'csv'), recommendationsCsv(res)), 'Recommendations CSV'); toast(m.message, m.tone); }}><Download className="h-4 w-4" aria-hidden /> Export CSV</Button>
            <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add initiative</Button>
          </>
        }
      />
      <Callout tone="warn" className="mb-4" title="Advisory outputs">{ADVISORY_NOTICE}</Callout>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {(['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => (
          <button key={p} type="button" onClick={() => { setFp(fp === p ? 'any' : p); setTab('recommendations'); }} className={clsx('rounded-lg border bg-white px-3.5 py-3 text-left', fp === p ? 'border-teal-600 ring-2 ring-teal-500/30' : 'border-line hover:border-navy-300')}>
            <div className="flex items-center gap-2"><Badge tone={PRIORITY_TONE[p]}>{PRIORITY_LABELS[p]}</Badge></div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{recs.filter((r) => r.priority === p && r.status !== 'dismissed').length}</div>
          </button>
        ))}
      </div>
      <div className="mb-4 max-w-md"><div className="mb-1 flex justify-between text-xs text-muted"><span>Completed initiatives</span><span>{done} of {active}</span></div><ProgressBar value={active ? done / active : 0} tone="good" label="Completed initiatives" /></div>

      <Tabs label="Recommendations and roadmap" value={tab} onChange={setTab} tabs={[{ id: 'recommendations', label: `Recommendations (${recs.length})` }, { id: 'roadmap', label: 'Roadmap: 6 / 12 / 24 months' }]} />

      <TabPanel id="recommendations" active={tab === 'recommendations'}>
        <Card className="mb-4" pad={false}>
          <div className="grid gap-3 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2 lg:col-span-1"><label className="label" htmlFor="rec-search">Search</label><Search className="pointer-events-none absolute left-2.5 top-[34px] h-4 w-4 text-muted" aria-hidden /><input id="rec-search" className="input pl-8" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, gap or question ID" /></div>
            <SelectField label="Priority" value={fp} onChange={(e) => setFp(e.target.value as 'any')} options={[{ value: 'any', label: 'Any priority' }, ...prioritySchema.options.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))]} />
            <SelectField label="Status" value={fs} onChange={(e) => setFs(e.target.value as 'any')} options={[{ value: 'any', label: 'Any status' }, ...recStatusSchema.options.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]} />
            <SelectField label="Dimension" value={fd} onChange={(e) => setFd(e.target.value)} options={[{ value: 'any', label: 'Any dimension' }, ...DIMENSIONS.map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
        </Card>

        {filtered.length === 0 ? (
          <Card><EmptyState title="No recommendations match" action={<Button onClick={() => { setFp('any'); setFs('any'); setFd('any'); setQ(''); }}>Clear filters</Button>}>{recs.length === 0 ? 'Nothing was generated from the current data. Add answers and verification to produce recommendations.' : 'Adjust the filters to see more.'}</EmptyState></Card>
        ) : (
          <ul className="space-y-3" aria-label="Recommendations">
            {filtered.map((r) => {
              const open = expanded.has(r.id);
              return (
                <li key={r.id} id={`rec-${r.id}`} className={clsx('card', focusRec === r.id && 'ring-2 ring-teal-500/50', r.status === 'dismissed' && 'opacity-60')}>
                  <div className="flex flex-wrap items-start gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge>
                        <Badge tone="neutral">{BUCKET_LABELS[r.bucket]}</Badge>
                        {r.isCustom && <Badge tone="teal">Added by assessor</Badge>}
                        {r.edited && !r.isCustom && <Badge tone="info">Edited</Badge>}
                        {r.dimensionId && <span className="text-xs text-muted">{DIMENSION_BY_ID[r.dimensionId].shortName}</span>}
                      </div>
                      <h3 className="mt-1.5 text-[15px] font-semibold leading-snug">{r.title}</h3>
                      {r.questionIds.length > 0 && <div className="mt-1 text-xs text-muted">Questions: {r.questionIds.join(', ')}</div>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[150px_150px_170px]">
                      <label className="block"><span className="sr-only">Priority for {r.title}</span><select className="input py-1.5 text-[13px]" value={r.priority} onChange={(e) => patch(r, { priority: e.target.value as Priority })}>{prioritySchema.options.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]} priority</option>)}</select></label>
                      <label className="block"><span className="sr-only">Status for {r.title}</span><select className="input py-1.5 text-[13px]" value={r.status} onChange={(e) => patch(r, { status: e.target.value as RecStatus })}>{recStatusSchema.options.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
                      <label className="col-span-2 block sm:col-span-1"><span className="sr-only">Owner for {r.title}</span><input className="input py-1.5 text-[13px]" value={r.owner} placeholder={`Owner (suggested: ${r.role.split(',')[0].split('/')[0].trim()})`} onChange={(e) => patch(r, { owner: e.target.value })} /></label>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-t border-line px-4 py-2">
                    <button type="button" aria-expanded={open} className="inline-flex items-center gap-1 text-sm text-teal-700" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}>
                      {open ? 'Hide detail' : 'Show detail'}<ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
                    </button>
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
                      {r.edited && !r.isCustom && <Button size="sm" variant="ghost" onClick={() => { clearOverride(r.id); toast('Edits reset to the generated recommendation', 'info'); }}><RotateCcw className="h-4 w-4" aria-hidden /> Reset</Button>}
                      {r.isCustom && <Button size="sm" variant="danger-outline" onClick={() => { deleteCustom(r.id); toast('Initiative removed'); }}><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>}
                    </div>
                  </div>
                  {open && (
                    <div className="grid gap-x-8 gap-y-3 border-t border-line bg-navy-50/50 p-4 text-sm md:grid-cols-2">
                      {([
                        ['Gap description', r.gap], ['Why it matters', r.why], ['Suggested intervention', r.intervention], ['Suggested KPI / target outcome', r.kpi],
                        ['Suggested accountable role', r.role], ['Suggested timeframe', r.timeframe], ['Dependencies', r.dependencies || '—'], ['Related evidence gaps', r.evidenceGaps.length ? r.evidenceGaps.join(', ') : 'None identified'],
                      ] as [string, string][]).map(([k, v]) => <div key={k}><div className="kicker">{k}</div><p className="mt-0.5">{v}</p></div>)}
                      <div className="md:col-span-2"><div className="kicker">Basis</div><p className="mt-0.5 text-muted">{r.basisNote} Advisory — requires consulting judgement and client validation.</p></div>
                      <div className="md:col-span-2"><TextArea label="Notes" rows={2} value={r.notes} onChange={(e) => patch(r, { notes: e.target.value })} placeholder="Decisions, blockers, links" /></div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </TabPanel>

      <TabPanel id="roadmap" active={tab === 'roadmap'}>
        <div className="grid gap-4 lg:grid-cols-3">
          {(['m0_6', 'm6_12', 'm12_24'] as Bucket[]).map((b) => {
            const items = res.roadmap[b];
            const doneN = items.filter((i) => i.status === 'completed').length;
            return (
              <section key={b} aria-labelledby={`col-${b}`} className="rounded-xl border border-line bg-navy-50/60 p-3.5">
                <div className="mb-3 flex items-center justify-between"><h2 id={`col-${b}`} className="text-[15px] font-semibold">{BUCKET_LABELS[b]}</h2><span className="text-xs text-muted">{doneN} of {items.length} done</span></div>
                {items.length === 0 ? <p className="rounded-lg border border-dashed border-navy-300 p-4 text-center text-sm text-muted">No initiatives in this window.</p> : (
                  <ul className="space-y-2.5">
                    {items.map((r) => (
                      <li key={r.id} className="card p-3">
                        <div className="flex flex-wrap items-center gap-1.5"><Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge>{r.dimensionId && <span className="text-[11px] text-muted">{DIMENSION_BY_ID[r.dimensionId].shortName}</span>}</div>
                        <div className="mt-1.5 text-[13.5px] font-medium leading-snug">{r.title}</div>
                        <div className="mt-1 text-xs text-muted">Owner: {r.owner || `${r.role.split(',')[0].split('/')[0].trim()} (suggested)`}</div>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          <label className="block"><span className="sr-only">Window for {r.title}</span><select className="input py-1 text-xs" value={r.bucket} onChange={(e) => patch(r, { bucket: e.target.value as Bucket })}>{bucketSchema.options.map((x) => <option key={x} value={x}>{BUCKET_LABELS[x]}</option>)}</select></label>
                          <label className="block"><span className="sr-only">Status for {r.title}</span><select className="input py-1 text-xs" value={r.status} onChange={(e) => patch(r, { status: e.target.value as RecStatus })}>{recStatusSchema.options.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
                        </div>
                        <Button size="sm" variant="ghost" className="mt-1.5 -ml-1" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">Dismissed initiatives are hidden from the roadmap. Roadmap windows are suggestions generated from priority and dimension; change a window to re-sequence.</p>
      </TabPanel>

      {editing && <EditModal rec={editing} base={res.generatedRecommendations.find((g) => g.id === editing.id)} onClose={() => setEditing(null)} onSave={(p) => { patch(editing, p); toast('Recommendation updated'); setEditing(null); }} />}
      {adding && <AddModal onClose={() => setAdding(false)} onAdd={(r) => { addCustom(r); setAdding(false); toast('Initiative added'); }} />}
    </>
  );
}

function EditModal({ rec, base, onClose, onSave }: { rec: Recommendation; base: Recommendation | undefined; onClose: () => void; onSave: (p: RecOverride) => void }) {
  const [d, setD] = useState({ ...rec });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = () => {
    const p: RecOverride = { status: d.status, owner: d.owner, notes: d.notes };
    if (rec.isCustom || d.priority !== base?.priority) p.priority = d.priority;
    if (rec.isCustom || d.bucket !== base?.bucket) p.bucket = d.bucket;
    for (const f of EDIT_FIELDS) {
      const baseVal = rec.isCustom ? undefined : base?.[f];
      if (rec.isCustom || d[f] !== baseVal) (p as Record<string, string>)[f] = d[f];
    }
    onSave(p);
  };
  return (
    <Modal open onClose={onClose} title="Edit recommendation" size="xl" description={rec.isCustom ? 'Initiative added by an assessor.' : 'Generated from the assessment data. Your edits are saved separately and survive regeneration.'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!d.title.trim()}>Save changes</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField className="md:col-span-2" label="Title" value={d.title} onChange={(e) => set('title', e.target.value)} />
        <SelectField label="Priority" value={d.priority} onChange={(e) => set('priority', e.target.value as Priority)} options={prioritySchema.options.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
        <SelectField label="Roadmap window" value={d.bucket} onChange={(e) => { set('bucket', e.target.value as Bucket); set('timeframe', BUCKET_LABELS[e.target.value as Bucket]); }} options={bucketSchema.options.map((b) => ({ value: b, label: BUCKET_LABELS[b] }))} />
        <SelectField label="Status" value={d.status} onChange={(e) => set('status', e.target.value as RecStatus)} options={recStatusSchema.options.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
        <TextField label="Assigned owner" value={d.owner} onChange={(e) => set('owner', e.target.value)} placeholder="Person or role" />
        <TextField label="Suggested accountable role" value={d.role} onChange={(e) => set('role', e.target.value)} />
        <TextField label="Suggested timeframe" value={d.timeframe} onChange={(e) => set('timeframe', e.target.value)} />
        <TextArea className="md:col-span-2" label="Gap description" rows={3} value={d.gap} onChange={(e) => set('gap', e.target.value)} />
        <TextArea className="md:col-span-2" label="Why it matters" rows={2} value={d.why} onChange={(e) => set('why', e.target.value)} />
        <TextArea className="md:col-span-2" label="Suggested intervention" rows={3} value={d.intervention} onChange={(e) => set('intervention', e.target.value)} />
        <TextArea label="Dependencies" rows={2} value={d.dependencies} onChange={(e) => set('dependencies', e.target.value)} />
        <TextArea label="Suggested KPI / target outcome" rows={2} value={d.kpi} onChange={(e) => set('kpi', e.target.value)} />
        <TextArea className="md:col-span-2" label="Notes" rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
    </Modal>
  );
}

function AddModal({ onClose, onAdd }: { onClose: () => void; onAdd: (r: Parameters<ReturnType<typeof useStore.getState>['addCustomRec']>[0]) => void }) {
  const [d, setD] = useState({ title: '', dimensionId: '', gap: '', why: '', intervention: '', role: '', dependencies: '', kpi: '', priority: 'medium' as Priority, bucket: 'm6_12' as Bucket, owner: '' });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <Modal open onClose={onClose} title="Add initiative" size="lg" description="Add your own initiative to the roadmap. It is saved with this assessment and is marked as assessor-added."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!d.title.trim()} onClick={() => onAdd({ ...d, questionIds: [], timeframe: BUCKET_LABELS[d.bucket], status: 'not_started', notes: '' })}>Add initiative</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField className="md:col-span-2" label="Title" required value={d.title} onChange={(e) => set('title', e.target.value)} />
        <SelectField label="Priority" value={d.priority} onChange={(e) => set('priority', e.target.value as Priority)} options={prioritySchema.options.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
        <SelectField label="Roadmap window" value={d.bucket} onChange={(e) => set('bucket', e.target.value as Bucket)} options={bucketSchema.options.map((b) => ({ value: b, label: BUCKET_LABELS[b] }))} />
        <SelectField label="Dimension (optional)" placeholder="None" value={d.dimensionId} onChange={(e) => set('dimensionId', e.target.value)} options={DIMENSIONS.map((x) => ({ value: x.id, label: x.name }))} />
        <TextField label="Owner" value={d.owner} onChange={(e) => set('owner', e.target.value)} />
        <TextArea className="md:col-span-2" label="Gap description" rows={2} value={d.gap} onChange={(e) => set('gap', e.target.value)} />
        <TextArea className="md:col-span-2" label="Why it matters" rows={2} value={d.why} onChange={(e) => set('why', e.target.value)} />
        <TextArea className="md:col-span-2" label="Suggested intervention" rows={2} value={d.intervention} onChange={(e) => set('intervention', e.target.value)} />
        <TextField label="Accountable role" value={d.role} onChange={(e) => set('role', e.target.value)} />
        <TextField label="KPI / target outcome" value={d.kpi} onChange={(e) => set('kpi', e.target.value)} />
        <TextField className="md:col-span-2" label="Dependencies" value={d.dependencies} onChange={(e) => set('dependencies', e.target.value)} />
      </div>
    </Modal>
  );
}
