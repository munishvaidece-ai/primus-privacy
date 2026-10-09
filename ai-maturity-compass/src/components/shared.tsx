import clsx from 'clsx';
import { FlaskConical, Lock, PencilLine, CircleDashed, CheckCircle2, FileSearch, XCircle, HelpCircle, MinusCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SCALE_BY_SCORE, type Score } from '../data/spec';
import { EVIDENCE_STATUS_LABELS, type Assessment, type EvidenceStatus } from '../domain/schema';
import type { ResultStatus } from '../scoring/maturity';
import { Badge, Button, EmptyState, type Tone } from './ui';
import { useStore } from '../store/store';
import { SCORE_FILL, SCORE_TEXT } from './charts/colors';

export function DemoTag({ className }: { className?: string }) {
  return (
    <Badge tone="warn" className={className} icon={<FlaskConical className="h-3 w-3" aria-hidden />} title="Synthetic data — illustrative demonstration, not client findings">
      Illustrative demo
    </Badge>
  );
}

export function AssessmentStatusBadge({ status }: { status: Assessment['status'] }) {
  if (status === 'submitted') return <Badge tone="good" icon={<Lock className="h-3 w-3" aria-hidden />}>Submitted</Badge>;
  if (status === 'draft') return <Badge tone="neutral" icon={<PencilLine className="h-3 w-3" aria-hidden />}>Draft</Badge>;
  return <Badge tone="info" icon={<CircleDashed className="h-3 w-3" aria-hidden />}>In progress</Badge>;
}

export function ResultStatusBadge({ status }: { status: ResultStatus }) {
  if (status === 'definitive') return <Badge tone="good">Definitive</Badge>;
  if (status === 'provisional') return <Badge tone="warn" title="Computed over the dimensions or components that could be scored; see coverage caveats">Provisional</Badge>;
  return <Badge tone="neutral">Insufficient data</Badge>;
}

const EV_TONE: Record<EvidenceStatus, { tone: Tone; icon: ReactNode }> = {
  none: { tone: 'neutral', icon: <MinusCircle className="h-3 w-3" aria-hidden /> },
  provided: { tone: 'info', icon: <FileSearch className="h-3 w-3" aria-hidden /> },
  reviewed: { tone: 'teal', icon: <FileSearch className="h-3 w-3" aria-hidden /> },
  accepted: { tone: 'good', icon: <CheckCircle2 className="h-3 w-3" aria-hidden /> },
  rejected: { tone: 'bad', icon: <XCircle className="h-3 w-3" aria-hidden /> },
  clarification: { tone: 'warn', icon: <HelpCircle className="h-3 w-3" aria-hidden /> },
};
export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  const t = EV_TONE[status];
  return <Badge tone={t.tone} icon={t.icon}>{EVIDENCE_STATUS_LABELS[status]}</Badge>;
}

export function ScorePill({ score, label, className }: { score: Score | null; label?: string; className?: string }) {
  if (score === null) return <span className={clsx('inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs text-muted border border-dashed border-navy-300', className)} title={label ?? 'No score'}>–</span>;
  return (
    <span
      className={clsx('inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs font-semibold tabular-nums', className)}
      style={{ background: SCORE_FILL[score], color: SCORE_TEXT[score] }}
      title={`${score} — ${SCALE_BY_SCORE[score].label}`}
    >
      {score}
    </span>
  );
}

export function SourceNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted mt-2">{children}</p>;
}

/** Render children only when an assessment is selected; otherwise a useful empty state. */
export function NeedAssessment({ a, children }: { a: Assessment | null; children: (a: Assessment) => ReactNode }) {
  const resetDemo = useStore((s) => s.resetDemo);
  if (!a) {
    return (
      <div className="card">
        <EmptyState
          title="No assessment selected"
          action={
            <div className="flex flex-wrap gap-2 justify-center">
              <Link to="/assessments/new" className="btn btn-md btn-primary">Create an assessment</Link>
              <Button onClick={resetDemo}>Load illustrative demonstration</Button>
              <Link to="/assessments" className="btn btn-md btn-secondary">Open assessments</Link>
            </div>
          }
        >
          Create a new assessment, open an existing one, or load the synthetic demonstration assessment.
        </EmptyState>
      </div>
    );
  }
  return <>{children(a)}</>;
}

export function NeedProfile({ a, children }: { a: Assessment; children: ReactNode }) {
  if (a.status === 'draft') {
    return (
      <div className="card">
        <EmptyState title="Finish the organization profile first" action={<Link to={`/assessments/new?id=${a.id}`} className="btn btn-md btn-primary">Resume setup</Link>}>
          “{a.name}” is still a draft. Complete the profile wizard to open the questionnaire.
        </EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}

export function LockedBanner({ a, onReopen }: { a: Assessment; onReopen: () => void }) {
  if (a.status !== 'submitted') return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-300 bg-good-bg px-3.5 py-2.5 text-sm no-print">
      <span className="flex items-center gap-2"><Lock className="h-4 w-4 text-good" aria-hidden /> This assessment is submitted and read-only. Reopen it for authorized review to change responses.</span>
      <Button size="sm" onClick={onReopen}>Reopen for review</Button>
    </div>
  );
}
