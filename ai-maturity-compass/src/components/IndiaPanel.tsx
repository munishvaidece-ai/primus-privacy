import clsx from 'clsx';
import { useState } from 'react';
import { INDIA_DIAGNOSTICS, INDIA_DISCLAIMER, INDIA_SOURCE_NOTE } from '../data/india';
import { EVIDENCE_STATUS_LABELS, evidenceStatusSchema, type Assessment, type IndiaApplicability } from '../domain/schema';
import { fmt1 } from '../export/narrative';
import type { AssessmentResults } from '../scoring/results';
import { useStore } from '../store/store';
import { Badge, Callout, Card, Stat, TextArea, TextField } from './ui';
import { MiniScore } from './MiniScore';
import { ResultStatusBadge } from './shared';

function ResultsNote({ items }: { items: string[] }) {
  return <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-muted">{items.map((c, i) => <li key={i}>{c}</li>)}</ul>;
}

const APPL: { v: IndiaApplicability; label: string }[] = [
  { v: 'not_assessed', label: 'Not assessed' },
  { v: 'applicable', label: 'Applicable' },
  { v: 'not_applicable', label: 'Not applicable' },
];

export function IndiaPanel({ a, res, editable }: { a: Assessment; res: AssessmentResults; editable: boolean }) {
  const update = useStore((s) => s.updateIndiaItem);
  const setDate = useStore((s) => s.setIndiaDate);
  const [openPrompts, setOpenPrompts] = useState<Set<string>>(new Set());
  const ind = res.india;
  return (
    <div className="space-y-4">
      <Callout tone="warn" title="Diagnostic, not a legal opinion">{INDIA_DISCLAIMER}</Callout>
      <Callout tone="info" title="Reported separately from the core index">{INDIA_SOURCE_NOTE} Here the India diagnostics are scored on their own and never alter the 100-question index{a.config.india.showComposite ? ` (a supplementary composite at ${a.config.india.compositeWeightPct}% weight is shown because it is enabled in Settings)` : ''}.</Callout>
      <Card>
        <div className="grid gap-4 sm:grid-cols-[260px_1fr] sm:items-end">
          <TextField label="Legal and regulatory position assessed as at" type="date" value={a.india.assessmentDate} disabled={!editable} onChange={(e) => setDate(e.target.value)} hint="Compliance assessments should reflect laws and rules actually in force on this date." />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Supplementary index (verified)" value={fmt1(ind.verifiedIndex)} sub={<ResultStatusBadge status={ind.status} />} />
            <Stat label="Self-reported" value={fmt1(ind.selfIndex)} />
            <Stat label="Applicable / N/A" value={`${ind.applicable} / ${ind.notApplicable}`} sub={`${ind.notAssessed} not assessed`} />
            <Stat label="Composite (optional)" value={res.indiaComposite === null ? 'Off' : fmt1(res.indiaComposite)} sub="Settings → Scoring policy" />
          </div>
        </div>
        <ResultsNote items={ind.caveats} />
      </Card>

      <ul className="space-y-3" aria-label="India-specific diagnostics">
        {INDIA_DIAGNOSTICS.map((d) => {
          const it = a.india.items[d.id];
          const open = openPrompts.has(d.id);
          const off = it.applicability !== 'applicable';
          return (
            <li key={d.id} className="card card-pad">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><Badge tone="navy">{d.id}</Badge><h3 className="text-[15px] font-semibold">{d.area}</h3></div>
                  <p className="mt-1 text-sm">{d.question}</p>
                  <button type="button" className="mt-1 text-xs link" aria-expanded={open} onClick={() => setOpenPrompts((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}>{open ? 'Hide' : 'Show'} assessor prompts</button>
                  {open && <ul className="mt-1 list-disc pl-5 text-xs text-muted">{d.prompts.map((p) => <li key={p}>{p}</li>)}<li>Usually relevant to: {d.usuallyRelevantTo.join(', ').replace(/_/g, ' ')} (a hint, not a determination).</li></ul>}
                </div>
                <div role="radiogroup" aria-label={`${d.area} applicability`} className="flex gap-1">
                  {APPL.map((o) => (
                    <button key={o.v} type="button" role="radio" aria-checked={it.applicability === o.v} disabled={!editable} onClick={() => update(d.id, { applicability: o.v, ...(o.v === 'not_applicable' ? { selfScore: null, verifiedScore: null } : {}) })}
                      className={clsx('rounded-lg border px-2.5 py-1.5 text-xs', it.applicability === o.v ? 'border-teal-600 bg-teal-50 font-medium' : 'border-navy-200 bg-white hover:bg-navy-50')}>{o.label}</button>
                  ))}
                </div>
              </div>
              {!off && (
                <div className="mt-3 grid gap-4 border-t border-line pt-3 md:grid-cols-2">
                  <MiniScore label="Self-reported score" value={it.selfScore} disabled={!editable} onChange={(s) => update(d.id, { selfScore: s })} />
                  <MiniScore label="Assessor-verified score" value={it.verifiedScore} disabled={!editable} onChange={(s) => update(d.id, { verifiedScore: s })} />
                  <TextField label="Evidence reference" value={it.evidence} disabled={!editable} onChange={(e) => update(d.id, { evidence: e.target.value, evidenceStatus: e.target.value.trim() && it.evidenceStatus === 'none' ? 'provided' : it.evidenceStatus })} />
                  <label className="block"><span className="label">Evidence status</span>
                    <select className="input" value={it.evidenceStatus} disabled={!editable} onChange={(e) => update(d.id, { evidenceStatus: e.target.value as typeof it.evidenceStatus })}>
                      {evidenceStatusSchema.options.map((s) => <option key={s} value={s} disabled={s === 'accepted' && !it.evidence.trim()}>{EVIDENCE_STATUS_LABELS[s]}</option>)}
                    </select>
                  </label>
                  <TextArea className="md:col-span-2" label="Observations" rows={2} value={it.observations} disabled={!editable} onChange={(e) => update(d.id, { observations: e.target.value })} />
                </div>
              )}
              {it.applicability === 'not_applicable' && <p className="mt-2 text-xs text-muted">Marked not applicable — excluded from the India diagnostic index (not scored as zero).</p>}
              {it.applicability === 'not_assessed' && <p className="mt-2 text-xs text-muted">Applicability not yet assessed — not counted either way.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

