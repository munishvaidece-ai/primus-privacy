/**
 * Shared editors for one question. The three panels are kept visually and logically separate:
 *   1. Self-reported maturity (the organization's own answer)
 *   2. Evidence (a reference is a claim — not verification)
 *   3. Assessor verification (the only thing that produces a verified score)
 */
import clsx from 'clsx';
import { Ban, CheckCircle2, CircleHelp, Eraser, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { DIMENSION_BY_ID, MATURITY_SCALE, QUESTION_BY_ID, SCALE_BY_SCORE, VALUE_COMPONENTS, RISK_COMPONENTS, type Score } from '../data/spec';
import { EVIDENCE_STATUS_LABELS, evidenceStatusSchema, type EvidenceStatus, type Response } from '../domain/schema';
import { questionTags } from '../scoring/results';
import { useStore } from '../store/store';
import type { Assessment } from '../domain/schema';
import { EvidenceBadge, ScorePill } from './shared';
import { SCORE_FILL, SCORE_TEXT } from './charts/colors';
import { Badge, Button, TextArea } from './ui';

// ------------------------------------------------------------------ Score radiogroup
export function ScoreRadio({ value, onChange, disabled, label, clearable }: { value: Score | null; onChange: (s: Score) => void; disabled?: boolean; label: string; clearable?: boolean }) {
  void clearable;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const map: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (e.key in map) {
      e.preventDefault();
      const cur = value ?? (map[e.key] > 0 ? -1 : 5);
      const n = Math.max(0, Math.min(4, cur + map[e.key]));
      onChange(n as Score);
      const btn = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-score="${n}"]`);
      btn?.focus();
    }
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className="grid gap-2 sm:grid-cols-5">
      {MATURITY_SCALE.map((lvl) => {
        const on = value === lvl.score;
        return (
          <button
            key={lvl.score} type="button" role="radio" aria-checked={on} data-score={lvl.score} disabled={disabled}
            tabIndex={on || (value === null && lvl.score === 0) ? 0 : -1}
            onClick={() => onChange(lvl.score)}
            className={clsx(
              'flex flex-row sm:flex-col items-start gap-2 sm:gap-1 rounded-lg border p-2.5 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
              on ? 'border-teal-600 ring-2 ring-teal-500/40 bg-teal-50' : 'border-navy-200 bg-white hover:border-navy-400 hover:bg-navy-50',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded text-sm font-bold" style={{ background: SCORE_FILL[lvl.score], color: SCORE_TEXT[lvl.score] }}>{lvl.score}</span>
              <span className="text-[13px] font-semibold">{lvl.label}</span>
            </span>
            <span className="text-xs leading-snug text-muted">{lvl.description}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ helpers
export function useResponseActions(qid: string) {
  const update = useStore((s) => s.updateResponse);
  return {
    patch: (fn: (r: Response) => Response) => update(qid, fn),
  };
}

const RISK_SHORT: Record<string, string> = { governance: 'Governance', responsibleAi: 'Responsible AI', cyber: 'Cyber & privacy', dataGovernance: 'Data governance', executiveOversight: 'Exec. oversight', lifecycle: 'Lifecycle controls' };
const VALUE_SHORT: Record<string, string> = { financial: 'Financial', productivity: 'Productivity', strategic: 'Strategic impact', adoption: 'Adoption', discipline: 'Measurement', sustainability: 'Sustainability' };

export function QuestionHeader({ a, qid, showText = true }: { a: Assessment; qid: string; showText?: boolean }) {
  const q = QUESTION_BY_ID[qid];
  const d = DIMENSION_BY_ID[q.dimensionId];
  const tags = useMemo(() => questionTags(a.config)[qid], [a.config, qid]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="navy">{q.id}</Badge>
        <span className="text-xs text-muted">{d.name} · weight {d.weight}% · question {q.position} of {d.questionCount}</span>
        {tags.criticality === 'critical' && <Badge tone="bad" title="Critical control: a verified deficiency triggers the advisory maturity gate">Critical control</Badge>}
        {tags.criticality === 'high' && <Badge tone="info" title="Contributes to the Risk & Governance or Value Realization score">Feeds principal scores</Badge>}
        {tags.riskComponents.map((c) => <Badge key={c} tone="teal" title={`Risk & Governance composition: ${RISK_COMPONENTS.find((x) => x.id === c)!.name}`}>Risk: {RISK_SHORT[c]}</Badge>)}
        {tags.valueComponents.map((c) => <Badge key={c} tone="neutral" title={`Value Realization composition: ${VALUE_COMPONENTS.find((x) => x.id === c)!.name}`}>Value: {VALUE_SHORT[c]}</Badge>)}
      </div>
      {showText && <p className="mt-2 text-[17px] leading-snug font-medium text-ink">{q.text}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ 1. Self-reported
export function SelfPanel({ qid, r, disabled }: { qid: string; r: Response; disabled?: boolean }) {
  const { patch } = useResponseActions(qid);
  const set = (self: Response['self']) => patch((x) => ({ ...x, self }));
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#eb6834' }} aria-hidden />
        Self-reported maturity <span className="font-normal text-muted">(the organization's own answer)</span>
      </legend>
      <ScoreRadio label="Self-reported maturity score" value={r.self.state === 'scored' ? r.self.score : null} disabled={disabled} onChange={(s) => set({ state: 'scored', score: s })} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button" aria-pressed={r.self.state === 'not_applicable'} disabled={disabled} onClick={() => set({ state: 'not_applicable', score: null })}
          className={clsx('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm', r.self.state === 'not_applicable' ? 'border-navy-700 bg-navy-100 font-medium' : 'border-navy-200 bg-white hover:bg-navy-50')}
        >
          <Ban className="h-4 w-4" aria-hidden /> Not applicable
        </button>
        <button
          type="button" aria-pressed={r.self.state === 'dont_know'} disabled={disabled} onClick={() => set({ state: 'dont_know', score: null })}
          className={clsx('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm', r.self.state === 'dont_know' ? 'border-amber-600 bg-warn-bg font-medium' : 'border-navy-200 bg-white hover:bg-navy-50')}
        >
          <CircleHelp className="h-4 w-4" aria-hidden /> Don't know / not verified
        </button>
        {r.self.state !== 'unanswered' && (
          <button type="button" disabled={disabled} onClick={() => set({ state: 'unanswered', score: null })} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <Eraser className="h-4 w-4" aria-hidden /> Clear answer
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        {r.self.state === 'unanswered' && 'Not yet answered. A blank answer is never scored as zero.'}
        {r.self.state === 'scored' && r.self.score !== null && `Selected ${r.self.score} — ${SCALE_BY_SCORE[r.self.score].label}: ${SCALE_BY_SCORE[r.self.score].description}.`}
        {r.self.state === 'not_applicable' && 'Not applicable: excluded from the applicable-question denominator (not treated as zero).'}
        {r.self.state === 'dont_know' && "Don't know / not verified: stays visible as an evidence gap and is not counted as zero maturity."}
      </p>
      <label className="block">
        <span className="label">Answered by (function or role, optional)</span>
        <input className="input max-w-sm" value={r.respondent} disabled={disabled} onChange={(e) => patch((x) => ({ ...x, respondent: e.target.value }))} placeholder="e.g. CIO office" />
      </label>
    </fieldset>
  );
}

// ------------------------------------------------------------------ 2. Evidence reference
export function EvidencePanel({ qid, r, disabled }: { qid: string; r: Response; disabled?: boolean }) {
  const { patch } = useResponseActions(qid);
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-semibold text-ink">Evidence reference</legend>
      <TextArea
        label="Document, system or demonstration that supports the score" value={r.evidence.reference} rows={2} disabled={disabled}
        placeholder="e.g. AI Governance Policy v2.1, section 4; steering-committee minutes, 12 Mar 2026"
        hint="Entering a reference records a claim only. It becomes verified evidence solely when an assessor marks it Accepted."
        onChange={(e) => {
          const text = e.target.value;
          patch((x) => ({
            ...x,
            evidence: { reference: text, status: text.trim() && x.evidence.status === 'none' ? 'provided' : !text.trim() && x.evidence.status === 'provided' ? 'none' : x.evidence.status },
          }));
        }}
      />
      <div className="flex items-center gap-2 text-sm"><span className="text-muted">Status:</span><EvidenceBadge status={r.evidence.status} /></div>
    </fieldset>
  );
}

// ------------------------------------------------------------------ 3. Assessor verification
export function AssessorPanel({ qid, r, disabled }: { qid: string; r: Response; disabled?: boolean }) {
  const { patch } = useResponseActions(qid);
  // "Verified score" is only a valid stored state once a score exists, so choosing it first opens a picker locally.
  const [picking, setPicking] = useState(false);
  useEffect(() => setPicking(false), [qid]);
  const now = () => new Date().toISOString();
  const setVer = (verified: Partial<Response['verified']>) => patch((x) => ({ ...x, verified: { ...x.verified, ...verified, at: verified.state === 'pending' ? null : now() } }));
  const states: { v: Response['verified']['state']; label: string }[] = [
    { v: 'pending', label: 'Awaiting assessment' },
    { v: 'scored', label: 'Verified score' },
    { v: 'not_applicable', label: 'Not applicable' },
    { v: 'not_verified', label: "Don't know / not verified" },
  ];
  const shown = picking && r.verified.state !== 'scored' ? 'scored' : r.verified.state;
  const choose = (v: Response['verified']['state']) => {
    if (v === 'scored') {
      if (r.verified.state !== 'scored') { setVer({ state: 'pending', score: null }); setPicking(true); }
      return;
    }
    setPicking(false);
    setVer({ state: v, score: null });
  };
  const selfScore = r.self.state === 'scored' ? r.self.score : null;
  const verScore = r.verified.state === 'scored' ? r.verified.score : null;
  const noRef = !r.evidence.reference.trim();
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#2a78d6' }} aria-hidden />
        Assessor verification <span className="font-normal text-muted">(determines the verified score)</span>
      </legend>
      <div role="radiogroup" aria-label="Assessor determination" className="flex flex-wrap gap-2">
        {states.map((s) => (
          <button
            key={s.v} type="button" role="radio" aria-checked={shown === s.v} disabled={disabled}
            onClick={() => choose(s.v)}
            className={clsx('rounded-lg border px-3 py-1.5 text-sm', shown === s.v ? 'border-series-verified bg-info-bg font-medium text-navy-900' : 'border-navy-200 bg-white hover:bg-navy-50')}
          >
            {s.label}
          </button>
        ))}
      </div>
      {shown === 'scored' && (
        <ScoreRadio label="Assessor-verified maturity score" value={r.verified.state === 'scored' ? r.verified.score : null} disabled={disabled} onChange={(s) => { setPicking(false); setVer({ state: 'scored', score: s }); }} />
      )}
      {shown === 'scored' && r.verified.state !== 'scored' && <p className="text-xs text-muted">Choose the verified maturity score. Until one is chosen the question remains awaiting assessment (not zero).</p>}
      {r.verified.state === 'pending' && !picking && selfScore !== null && (
        <Button size="sm" disabled={disabled} onClick={() => setVer({ state: 'scored', score: selfScore })}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Agree with self-reported score ({selfScore}) after review
        </Button>
      )}
      {r.verified.state === 'pending' && !picking && r.self.state === 'not_applicable' && (
        <Button size="sm" disabled={disabled} onClick={() => setVer({ state: 'not_applicable', score: null })}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirm “not applicable”
        </Button>
      )}
      <p className="text-xs text-muted">
        {r.verified.state === 'pending' && !picking && 'No verified score yet — this question does not contribute to the verified index and is not treated as zero.'}
        {r.verified.state === 'not_applicable' && 'Confirmed not applicable: excluded from the verified denominator.'}
        {r.verified.state === 'not_verified' && 'Recorded as an evidence gap: remains visible and is not counted as zero.'}
        {r.verified.state === 'scored' && verScore !== null && `Verified ${verScore} — ${SCALE_BY_SCORE[verScore].label}.${selfScore !== null ? ` Self-reported ${selfScore} (difference ${selfScore - verScore >= 0 ? '+' : ''}${selfScore - verScore}).` : ''}`}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="label">Evidence verification status</span>
          <select
            className="input" value={r.evidence.status} disabled={disabled}
            onChange={(e) => { const status = e.target.value as EvidenceStatus; patch((x) => ({ ...x, evidence: { ...x.evidence, status } })); }}
          >
            {evidenceStatusSchema.options.map((s) => (
              <option key={s} value={s} disabled={s === 'accepted' && noRef}>{EVIDENCE_STATUS_LABELS[s]}</option>
            ))}
          </select>
          <span className="hint block">{noRef ? '“Accepted” needs an evidence reference to point to.' : 'Only “Accepted” counts as verified evidence.'}</span>
        </label>
        <div className="flex items-end">
          {verScore !== null && r.evidence.status !== 'accepted' && (
            <p className="flex items-start gap-1.5 rounded-lg bg-warn-bg px-2.5 py-1.5 text-xs text-navy-900"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden /> Verified score is not yet backed by accepted evidence.</p>
          )}
        </div>
      </div>
      <TextArea label="Assessor observations" rows={2} value={r.observations} disabled={disabled} onChange={(e) => patch((x) => ({ ...x, observations: e.target.value }))} placeholder="What was reviewed, interviewed or demonstrated; limitations of the evidence." />
      <TextArea label="Improvement / remediation notes" rows={2} value={r.improvementNotes} disabled={disabled} onChange={(e) => patch((x) => ({ ...x, improvementNotes: e.target.value }))} placeholder="Suggested actions to reach the next maturity level." />
    </fieldset>
  );
}

// ------------------------------------------------------------------ summary chips
export function ScoreSummary({ r }: { r: Response }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1 text-muted">Self <SelfBadge r={r} /></span>
      <span className="flex items-center gap-1 text-muted">Verified <VerBadge r={r} /></span>
    </div>
  );
}
export function SelfBadge({ r }: { r: Response }) {
  if (r.self.state === 'scored') return <ScorePill score={r.self.score} />;
  if (r.self.state === 'not_applicable') return <Badge>N/A</Badge>;
  if (r.self.state === 'dont_know') return <Badge tone="warn">DK</Badge>;
  return <ScorePill score={null} label="Unanswered" />;
}
export function VerBadge({ r }: { r: Response }) {
  if (r.verified.state === 'scored') return <ScorePill score={r.verified.score} />;
  if (r.verified.state === 'not_applicable') return <Badge>N/A</Badge>;
  if (r.verified.state === 'not_verified') return <Badge tone="warn">Not verified</Badge>;
  return <ScorePill score={null} label="Awaiting assessment" />;
}
