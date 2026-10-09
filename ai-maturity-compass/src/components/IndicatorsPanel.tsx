import clsx from 'clsx';
import { AlertTriangle, ChevronDown, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { INDICATOR_SOURCE_NOTE, INDICATORS, type IndicatorDef } from '../data/indicators';
import type { Assessment, IndicatorEntry } from '../domain/schema';
import { formatIndicatorValue, formatNumber, type IndicatorResult } from '../scoring/indicators';
import type { AssessmentResults } from '../scoring/results';
import { useStore } from '../store/store';
import { Badge, Button, Callout, Card, Checkbox, NumberField, ProgressBar, TextArea, TextField } from './ui';

function statusBadge(r: IndicatorResult) {
  if (r.status === 'ok') return r.verified ? <Badge tone="good">Verified by assessor</Badge> : <Badge tone="info">Self-reported · unverified</Badge>;
  if (r.status === 'invalid') return <Badge tone="bad" icon={<AlertTriangle className="h-3 w-3" aria-hidden />}>Invalid input</Badge>;
  return <Badge>Not captured</Badge>;
}

function IndicatorCard({ a, def, r, editable }: { a: Assessment; def: IndicatorDef; r: IndicatorResult; editable: boolean }) {
  const [open, setOpen] = useState(r.status === 'invalid');
  const update = useStore((s) => s.updateIndicator);
  const e: IndicatorEntry = a.indicators[def.id];
  const isRoi = def.kind === 'roi';
  const emp = a.profile.employeeCount;

  const fillFromProfile = () => {
    const p = a.profile;
    if (def.id === 'aiSpendIntensity') update(def.id, { numerator: p.aiExpenditureLakh, denominator: p.itExpenditureLakh });
    else if (emp !== null && ['adoptionPenetration', 'trainingCoverage'].includes(def.id)) update(def.id, { denominator: emp });
    else if (emp !== null && def.id === 'productionIntensity') update(def.id, { denominator: emp });
    else if (emp !== null && def.id === 'productivityImpact') update(def.id, { denominator: emp });
  };
  const canFill =
    (def.id === 'aiSpendIntensity' && (a.profile.aiExpenditureLakh !== null || a.profile.itExpenditureLakh !== null)) ||
    (['adoptionPenetration', 'trainingCoverage', 'productionIntensity', 'productivityImpact'].includes(def.id) && emp !== null);

  return (
    <li className="card">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-semibold">{def.name}</h3>{statusBadge(r)}</div>
          <p className="mt-0.5 text-xs text-muted">{def.measurement}</p>
        </div>
        <div className="text-right">
          <div className={clsx('text-2xl font-semibold tabular-nums', r.status !== 'ok' && 'text-navy-400')}>{r.status === 'ok' ? formatIndicatorValue(r) : '—'}</div>
          <div className="text-[11px] text-muted">{def.resultUnit}</div>
        </div>
        <Button size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide inputs' : isRoi ? 'View' : 'Edit inputs'}<ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden /></Button>
      </div>
      {r.issues.length > 0 && !open && (
        <ul className="px-4 pb-3 space-y-1">{r.issues.map((i, k) => <li key={k} className={clsx('text-xs flex gap-1.5', i.level === 'error' ? 'text-bad' : 'text-warn')}><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />{i.message}</li>)}</ul>
      )}
      {open && (
        <div className="border-t border-line bg-navy-50/40 p-4 space-y-3">
          <p className="text-xs text-muted">{def.help}</p>
          {isRoi ? (
            <Callout tone="info" action={<Link to="/value" className="btn btn-sm btn-secondary">Open ROI calculator</Link>}>
              This indicator is calculated in the ROI calculator on the Value Realization page from verified benefits and fully loaded costs.
            </Callout>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField label={def.numeratorLabel} unit={def.numeratorUnit} value={e.numerator} onChange={(n) => update(def.id, { numerator: n })} disabled={!editable} />
                {def.denominatorLabel && <NumberField label={def.denominatorLabel} unit={def.denominatorUnit} value={e.denominator} onChange={(n) => update(def.id, { denominator: n })} disabled={!editable} />}
                <TextField label="Reporting period start" type="date" value={e.periodStart} disabled={!editable} onChange={(ev) => update(def.id, { periodStart: ev.target.value })} />
                <TextField label="Reporting period end" type="date" value={e.periodEnd} disabled={!editable} onChange={(ev) => update(def.id, { periodEnd: ev.target.value })} />
                {def.needsPriorPeriod && (
                  <>
                    <TextField label="Prior period start" type="date" value={e.priorStart} disabled={!editable} onChange={(ev) => update(def.id, { priorStart: ev.target.value })} />
                    <TextField label="Prior period end" type="date" value={e.priorEnd} disabled={!editable} onChange={(ev) => update(def.id, { priorEnd: ev.target.value })} />
                  </>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Data source" value={e.dataSource} disabled={!editable} onChange={(ev) => update(def.id, { dataSource: ev.target.value })} placeholder="System, report or owner" />
                <TextArea label="Evidence note" rows={2} value={e.evidenceNote} disabled={!editable} onChange={(ev) => update(def.id, { evidenceNote: ev.target.value })} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Checkbox checked={e.verified} disabled={!editable} onChange={(v) => update(def.id, { verified: v })} label="Verified by an assessor against source evidence" hint="Unverified figures are shown but are not used in the verified Value Realization score." />
                {canFill && editable && <Button size="sm" onClick={fillFromProfile}><Wand2 className="h-4 w-4" aria-hidden /> Fill from profile</Button>}
              </div>
            </>
          )}
          {r.issues.length > 0 && (
            <ul className="space-y-1" aria-label="Validation messages">{r.issues.map((i, k) => <li key={k} className={clsx('text-xs flex gap-1.5', i.level === 'error' ? 'text-bad' : 'text-warn')}><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden /><span><strong>{i.level === 'error' ? 'Error: ' : 'Warning: '}</strong>{i.message}</span></li>)}</ul>
          )}
        </div>
      )}
    </li>
  );
}

export function IndicatorsPanel({ a, res, editable }: { a: Assessment; res: AssessmentResults; editable: boolean }) {
  const ind = res.indicators;
  return (
    <div className="space-y-4">
      <Callout tone="info" title="Source guidance">{INDICATOR_SOURCE_NOTE}</Callout>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="text-sm font-semibold">{ind.captured} of {ind.total} indicators captured with valid inputs</div><div className="text-xs text-muted">{ind.results.filter((r) => r.status === 'ok' && r.verified).length} verified by an assessor</div></div>
          <div className="w-56"><ProgressBar value={ind.captured / ind.total} tone="teal" label="Indicators captured" /></div>
        </div>
      </Card>
      {ind.periodWarnings.map((w, i) => <Callout key={i} tone="warn" title="Reporting periods differ">{w}</Callout>)}
      {res.crossChecks.length > 0 && (
        <Callout tone="warn" title={`${res.crossChecks.length} questionnaire score${res.crossChecks.length > 1 ? 's are' : ' is'} not corroborated by the indicators`}>
          <ul className="list-disc pl-4 space-y-1">{res.crossChecks.map((c) => <li key={c.questionId + c.indicatorId}><Link className="link" to={`/questionnaire?q=${c.questionId}`}>{c.questionId}</Link>: {c.message}</li>)}</ul>
          <p className="mt-1 text-xs text-muted">Heuristic prompts for assessor follow-up (prototype thresholds, not source-defined benchmarks).</p>
        </Callout>
      )}
      <ul className="space-y-3" aria-label="Quantitative indicators">
        {INDICATORS.map((def) => <IndicatorCard key={def.id} a={a} def={def} r={ind.byId[def.id]} editable={editable} />)}
      </ul>
      <p className="text-xs text-muted">Amounts are entered in ₹ lakh (1 crore = 100 lakh). Currently {formatNumber(ind.captured)} indicator(s) are computable.</p>
    </div>
  );
}
