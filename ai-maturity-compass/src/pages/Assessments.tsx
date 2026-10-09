import { Copy, Download, FolderOpen, Lock, Pencil, Plus, RotateCcw, Trash2, Unlock, Upload, PlayCircle } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AssessmentStatusBadge, DemoTag } from '../components/shared';
import { Badge, Button, Callout, Card, ConfirmDialog, EmptyState, Modal, PageHeader, ProgressBar, TextField, formatDateTime, useDocumentTitle, useToast } from '../components/ui';
import type { Assessment } from '../domain/schema';
import { downloadText, saveMessage } from '../export/download';
import { exportFilename } from '../export/csv';
import { fmt1, orgTypeLabel } from '../export/narrative';
import { computeResults } from '../scoring/results';
import { useStore } from '../store/store';

export const LOCAL_NOTICE =
  'This prototype stores information locally in this browser (localStorage). It does not provide enterprise authentication, shared multi-user storage, backup, or production-grade access control. Clearing browser data removes it — export assessments you want to keep.';

export default function Assessments() {
  useDocumentTitle('Assessments');
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const order = useStore((s) => s.order);
  const assessments = useStore((s) => s.assessments);
  const currentId = useStore((s) => s.currentId);
  const st = useStore.getState;
  const [renaming, setRenaming] = useState<Assessment | null>(null);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Assessment | null>(null);
  const [submitting, setSubmitting] = useState<Assessment | null>(null);
  const [reopening, setReopening] = useState<Assessment | null>(null);
  const [resetDemo, setResetDemo] = useState(false);

  const list = useMemo(
    () => order.map((id) => assessments[id]).filter(Boolean).map((a) => ({ a, res: computeResults(a) })),
    [order, assessments],
  );

  const open = (a: Assessment) => {
    st().selectAssessment(a.id);
    navigate(a.status === 'draft' ? `/assessments/new?id=${a.id}` : '/');
  };

  const exportJson = async (a: Assessment) => {
    const m = saveMessage(await downloadText(exportFilename(a, 'assessment-export', 'json'), JSON.stringify({ app: 'AI Maturity Compass', exportVersion: 1, exportedAt: new Date().toISOString(), assessment: a }, null, 2), 'application/json;charset=utf-8'), 'Assessment JSON');
    toast(m.message, m.tone);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const r = st().importAssessmentJson(text);
    if (r.ok) toast('Assessment imported');
    else toast(r.error, 'bad');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <PageHeader
        title="Assessments"
        description="Create, open, duplicate, rename, submit and export assessments. Each assessment keeps its own profile, responses, evidence, notes, scores and reporting state."
        actions={
          <>
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import assessment JSON file" onChange={(e) => onImport(e.target.files?.[0])} />
            <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden /> Import JSON</Button>
            <Button onClick={() => setResetDemo(true)}><RotateCcw className="h-4 w-4" aria-hidden /> Reset demonstration data</Button>
            <Link to="/assessments/new" className="btn btn-md btn-primary"><Plus className="h-4 w-4" aria-hidden /> New assessment</Link>
          </>
        }
      />
      <Callout tone="info" className="mb-4" title="Local prototype storage">{LOCAL_NOTICE}</Callout>

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<FolderOpen className="h-10 w-10" />} title="No assessments" action={<div className="flex gap-2"><Link to="/assessments/new" className="btn btn-md btn-primary">Create an assessment</Link><Button onClick={() => st().resetDemo()}>Load illustrative demonstration</Button></div>}>
            Start a new assessment or restore the synthetic demonstration assessment.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4" aria-label="Assessments">
          {list.map(({ a, res }) => {
            const answered = res.coverage.selfAnswered + res.coverage.selfDontKnow;
            const isCurrent = a.id === currentId;
            return (
              <li key={a.id}>
                <Card className={isCurrent ? 'ring-2 ring-teal-500' : ''}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">{a.name}</h2>
                        <AssessmentStatusBadge status={a.status} />
                        {a.isDemo && <DemoTag />}
                        {isCurrent && <Badge tone="teal">Current</Badge>}
                      </div>
                      <p className="mt-0.5 text-sm text-muted">
                        {a.profile.organizationName || 'Organization not set'}
                        {a.profile.orgType && ` · ${orgTypeLabel(a.profile.orgType)}`}
                        {a.profile.industry && ` · ${a.profile.industry}`}
                        {a.profile.periodLabel && ` · ${a.profile.periodLabel}`}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">Created {formatDateTime(a.createdAt)} · Updated {formatDateTime(a.updatedAt)}{a.submittedAt && ` · Submitted ${formatDateTime(a.submittedAt)}`}</p>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <div><div className="text-xs text-muted">Verified index</div><div className="text-xl font-semibold tabular-nums">{fmt1(res.maturity.index)}</div><div className="text-[11px] text-muted">{res.maturity.classification?.label ?? '—'}{res.maturity.status === 'provisional' ? ' (prov.)' : ''}</div></div>
                      <div><div className="text-xs text-muted">Self-reported</div><div className="text-xl font-semibold tabular-nums">{fmt1(res.maturitySelf.index)}</div></div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 flex justify-between text-xs"><span>Self-reported answers</span><span>{answered} of {res.coverage.applicable}</span></div>
                      <ProgressBar value={res.coverage.applicable ? answered / res.coverage.applicable : 0} tone="orange" label="Self-reported progress" />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs"><span>Assessor-verified</span><span>{res.coverage.verifiedScored} of {res.coverage.applicable}</span></div>
                      <ProgressBar value={res.coverage.applicable ? res.coverage.verifiedScored / res.coverage.applicable : 0} tone="blue" label="Verification progress" />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                    {a.status === 'draft' ? (
                      <Button size="sm" variant="primary" onClick={() => open(a)}><PlayCircle className="h-4 w-4" aria-hidden /> Resume setup</Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => open(a)}><FolderOpen className="h-4 w-4" aria-hidden /> Open</Button>
                    )}
                    {a.status === 'in_progress' && (
                      <Button size="sm" onClick={() => { st().selectAssessment(a.id); navigate('/questionnaire'); }}><PlayCircle className="h-4 w-4" aria-hidden /> Resume questionnaire</Button>
                    )}
                    <Button size="sm" onClick={() => { const id = st().duplicateAssessment(a.id); if (id) toast('Assessment duplicated'); }}><Copy className="h-4 w-4" aria-hidden /> Duplicate</Button>
                    <Button size="sm" onClick={() => { setRenaming(a); setNewName(a.name); }}><Pencil className="h-4 w-4" aria-hidden /> Rename</Button>
                    {a.status === 'in_progress' && <Button size="sm" onClick={() => setSubmitting(a)}><Lock className="h-4 w-4" aria-hidden /> Mark submitted</Button>}
                    {a.status === 'submitted' && <Button size="sm" onClick={() => setReopening(a)}><Unlock className="h-4 w-4" aria-hidden /> Reopen for review</Button>}
                    <Button size="sm" onClick={() => exportJson(a)}><Download className="h-4 w-4" aria-hidden /> Export JSON</Button>
                    <Button size="sm" variant="danger-outline" className="ml-auto" onClick={() => setDeleting(a)}><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={!!renaming} onClose={() => setRenaming(null)} title="Rename assessment" size="sm"
        footer={<><Button onClick={() => setRenaming(null)}>Cancel</Button><Button variant="primary" disabled={!newName.trim()} onClick={() => { if (renaming) { st().renameAssessment(renaming.id, newName); toast('Assessment renamed'); } setRenaming(null); }}>Save name</Button></>}
      >
        <TextField label="Assessment name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && renaming && newName.trim()) { st().renameAssessment(renaming.id, newName); toast('Assessment renamed'); setRenaming(null); } }} />
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger title="Delete assessment?" confirmLabel="Delete assessment" onConfirm={() => { if (deleting) { st().deleteAssessment(deleting.id); toast('Assessment deleted'); } }}>
        <p>“{deleting?.name}” and all of its responses, evidence references, notes and roadmap edits will be permanently removed from this browser. This cannot be undone. Consider exporting it first.</p>
        {deleting?.isDemo && <p className="text-muted">The demonstration assessment can be restored with “Reset demonstration data”.</p>}
      </ConfirmDialog>

      <ConfirmDialog open={!!submitting} onClose={() => setSubmitting(null)} title="Mark assessment as submitted?" confirmLabel="Mark submitted" onConfirm={() => { if (submitting) { st().submitAssessment(submitting.id); toast('Assessment marked submitted'); } }}>
        <p>Submitting locks questionnaire, evidence, indicator and India-diagnostic edits until the assessment is reopened. Recommendations, roadmap and gate decisions remain editable.</p>
        {submitting && (() => { const r = computeResults(submitting); return <p className="text-muted">{r.coverage.awaitingAssessment} applicable question(s) await assessment and {r.coverage.dontKnowNotVerified} are marked Don’t Know / Not Verified; they stay unscored (not zero). You can review them first on the <button type="button" className="link" onClick={() => { st().selectAssessment(submitting.id); setSubmitting(null); navigate('/questionnaire/review'); }}>review screen</button>.</p>; })()}
      </ConfirmDialog>

      <ConfirmDialog open={!!reopening} onClose={() => setReopening(null)} title="Reopen for authorized review?" confirmLabel="Reopen" onConfirm={() => { if (reopening) { st().reopenAssessment(reopening.id); toast('Assessment reopened'); } }}>
        <p>This prototype has no user accounts, so “authorized” review is not enforced. Reopening makes the assessment editable again and records the event in its activity log.</p>
      </ConfirmDialog>

      <ConfirmDialog open={resetDemo} onClose={() => setResetDemo(false)} title="Reset demonstration data?" confirmLabel="Reset demonstration" onConfirm={() => { st().resetDemo(); toast('Demonstration assessment restored'); }}>
        <p>This replaces the illustrative demonstration assessment with a fresh synthetic copy (any edits to it are lost). Your other assessments are not changed.</p>
      </ConfirmDialog>
    </>
  );
}
