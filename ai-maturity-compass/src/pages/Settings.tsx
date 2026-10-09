import { Download, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Callout, Card, CardHeader, Checkbox, ConfirmDialog, PageHeader, SelectField, TabPanel, Tabs, TextField, useDocumentTitle, useToast } from '../components/ui';
import { CLASSIFICATIONS, DIMENSIONS, QUESTION_BY_ID, RISK_COMPONENTS, SCHEMA_VERSION, SPEC_VERSION, VALUE_COMPONENTS, type ClassificationId } from '../data/spec';
import { downloadText, saveMessage } from '../export/download';
import { LIMITATIONS, METHODOLOGY } from '../export/narrative';
import { storageUsageBytes } from '../store/storage';
import { useCurrent } from '../store/hooks';
import { useStore } from '../store/store';
import { LOCAL_NOTICE } from './Assessments';

type Tab = 'profile' | 'scoring' | 'data' | 'about';
const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Assessor profile' },
  { id: 'scoring', label: 'Scoring policy' },
  { id: 'data', label: 'Data & storage' },
  { id: 'about', label: 'About & methodology' },
];

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'profile') as Tab;
  return (
    <>
      <PageHeader title="Settings" description="Assessor profile, scoring policy for the current assessment, local data management and methodology notes." />
      <Tabs label="Settings sections" tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      <TabPanel id="profile" active={tab === 'profile'}><ProfileTab /></TabPanel>
      <TabPanel id="scoring" active={tab === 'scoring'}><ScoringTab /></TabPanel>
      <TabPanel id="data" active={tab === 'data'}><DataTab /></TabPanel>
      <TabPanel id="about" active={tab === 'about'}><AboutTab /></TabPanel>
    </>
  );
}

function ProfileTab() {
  const assessor = useStore((s) => s.assessor);
  const set = useStore((s) => s.setAssessor);
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Assessor profile" subtitle="Shown in the top bar and used to attribute gate decisions. Prototype only — there is no sign-in." />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={assessor.name} onChange={(e) => set({ name: e.target.value })} />
        <TextField label="Role" value={assessor.role} onChange={(e) => set({ role: e.target.value })} />
        <TextField className="sm:col-span-2" label="Firm" value={assessor.firm} onChange={(e) => set({ firm: e.target.value })} />
      </div>
      <p className="mt-3 text-xs text-muted">No sensitive personal information is required or collected. Changes save automatically.</p>
    </Card>
  );
}

function RuleEditor({ rule, disabled, onChange }: { rule: { id: string; name: string; questionIds: string[] }; disabled: boolean; onChange: (ids: string[]) => void }) {
  const [text, setText] = useState('');
  const toast = useToast();
  const add = () => {
    const id = text.trim().toUpperCase();
    if (!QUESTION_BY_ID[id]) { toast(`“${text}” is not a question ID (e.g. C02)`, 'bad'); return; }
    if (!rule.questionIds.includes(id)) onChange([...rule.questionIds, id]);
    setText('');
  };
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-sm font-medium">{rule.name}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {rule.questionIds.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-navy-100 px-2 py-0.5 text-xs">{id}<button type="button" disabled={disabled} aria-label={`Remove ${id} from ${rule.name}`} onClick={() => onChange(rule.questionIds.filter((x) => x !== id))} className="rounded-full hover:bg-navy-300"><X className="h-3 w-3" aria-hidden /></button></span>
        ))}
        {rule.questionIds.length === 0 && <span className="text-xs text-muted">No controls — this gate cannot trigger.</span>}
      </div>
      <div className="mt-2 flex gap-2">
        <input className="input max-w-[140px] py-1.5" aria-label={`Add question ID to ${rule.name}`} placeholder="Add ID, e.g. C02" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button size="sm" disabled={disabled || !text.trim()} onClick={add}>Add</Button>
      </div>
    </div>
  );
}

function ScoringTab() {
  const a = useCurrent();
  const update = useStore((s) => s.updateConfig);
  const reset = useStore((s) => s.resetConfig);
  const toast = useToast();
  if (!a) return <Callout tone="info">Select an assessment to configure its scoring policy.</Callout>;
  const c = a.config;
  const locked = a.status === 'submitted';
  const bandErr = (b: number[]) => (b.every((x, i) => i === 0 || x > b[i - 1]) ? null : 'Bounds must be increasing');
  const setBand = (k: 'adoptionPenetration' | 'hoursSavedPerEmployeeMonth', i: number, v: number) =>
    update((cfg) => ({ ...cfg, quantBands: { ...cfg.quantBands, [k]: cfg.quantBands[k].map((x, j) => (j === i ? v : x)) as [number, number, number, number] } }));
  return (
    <div className="space-y-4">
      <Callout tone="info" title={`Scoring policy for “${a.name}”`}>The policy is stored with each assessment so a report can always be reproduced. Dimension, risk and value <strong>weights are source-defined and not configurable</strong>. {locked && 'This assessment is submitted — reopen it to change policy.'}</Callout>

      <Card>
        <CardHeader title="Coverage and emphasis" action={<Button size="sm" disabled={locked} onClick={() => { reset(); toast('Scoring policy reset to defaults', 'info'); }}><RotateCcw className="h-4 w-4" aria-hidden /> Reset to defaults</Button>} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Minimum verified coverage for a dimension to count as sufficient" value={String(c.minDimensionCoverage)} disabled={locked} onChange={(e) => update((x) => ({ ...x, minDimensionCoverage: Number(e.target.value) }))} options={[0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => ({ value: String(v), label: `${Math.round(v * 100)}% of applicable questions` }))} hint="Below this a dimension is flagged “limited coverage” and the index is provisional." />
          <SelectField label="Emphasis multiplier for D02, D06, D08, D09 (risk & governance)" value={String(c.emphasisMultiplier)} disabled={locked} onChange={(e) => update((x) => ({ ...x, emphasisMultiplier: Number(e.target.value) }))} options={[1, 1.5, 2, 3].map((v) => ({ value: String(v), label: v === 1 ? '1× (no emphasis)' : `${v}×${v === 2 ? ' (default)' : ''}` }))} hint="The source says to emphasize these questions but gives no factor." />
        </div>
      </Card>

      <Card>
        <CardHeader title="Risk-based maturity gates (advisory)" subtitle="Source §9: organizations with severe deficiencies in AI security, privacy or responsible AI should not receive the highest classification purely because of strong adoption." />
        <div className="space-y-4">
          <Checkbox checked={c.gates.enabled} disabled={locked} onChange={(v) => update((x) => ({ ...x, gates: { ...x.gates, enabled: v } }))} label="Enable maturity gates" hint="Gates flag the classification for assessor review. They never change a classification until an assessor confirms." />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Critical deficiency threshold" value={String(c.gates.deficiencyThreshold)} disabled={locked || !c.gates.enabled} onChange={(e) => update((x) => ({ ...x, gates: { ...x.gates, deficiencyThreshold: Number(e.target.value) as 0 | 1 | 2 } }))} options={[{ value: '0', label: 'Verified score of 0 (Not initiated)' }, { value: '1', label: 'Verified score of 1 or below (Ad hoc) — default' }, { value: '2', label: 'Verified score of 2 or below (Emerging)' }]} />
            <SelectField label="Advisory classification ceiling" value={c.gates.ceiling} disabled={locked || !c.gates.enabled} onChange={(e) => update((x) => ({ ...x, gates: { ...x.gates, ceiling: e.target.value as ClassificationId } }))} options={CLASSIFICATIONS.slice(0, 4).map((k) => ({ value: k.id, label: k.label }))} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {c.gates.rules.map((r) => <RuleEditor key={r.id} rule={r} disabled={locked || !c.gates.enabled} onChange={(ids) => update((x) => ({ ...x, gates: { ...x.gates, rules: x.gates.rules.map((y) => (y.id === r.id ? { ...y, questionIds: ids } : y)) } }))} />)}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Quantitative scoring bands used in Value Realization" subtitle="Prototype defaults — the source defines bands only for ROI. Lower bounds for scores 1, 2, 3 and 4." />
        <div className="grid gap-4 lg:grid-cols-2">
          {([
            ['adoptionPenetration', 'AI adoption penetration (% of employees)'],
            ['hoursSavedPerEmployeeMonth', 'Verified hours saved per employee per month'],
          ] as const).map(([k, label]) => {
            const err = bandErr(c.quantBands[k]);
            return (
              <fieldset key={k} className="rounded-lg border border-line p-3">
                <legend className="px-1 text-sm font-medium">{label}</legend>
                <div className="grid grid-cols-4 gap-2">
                  {c.quantBands[k].map((v, i) => (
                    <label key={i} className="block text-xs text-muted">Score {i + 1} from
                      <input type="number" step="any" min={0} className="input mt-1 py-1.5" disabled={locked} value={v} onChange={(e) => setBand(k, i, Number(e.target.value))} aria-label={`${label}: lower bound for score ${i + 1}`} />
                    </label>
                  ))}
                </div>
                {err && <p role="alert" className="mt-1 text-xs text-bad">{err}</p>}
              </fieldset>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">ROI bands (0%, 10%, 25%, 50%) are fixed from the source and labelled provisional, not industry benchmarks.</p>
      </Card>

      <Card>
        <CardHeader title="India-specific diagnostics" subtitle="Supplementary — never part of the core index unless you explicitly enable a composite." />
        <div className="space-y-3">
          <Checkbox checked={c.india.showComposite} disabled={locked} onChange={(v) => update((x) => ({ ...x, india: { ...x.india, showComposite: v } }))} label="Show a supplementary composite that blends in the India diagnostics" hint="The core 100-question index is never altered; the composite is displayed separately and labelled." />
          <SelectField className="max-w-xs" label="India diagnostic weight in the composite" value={String(c.india.compositeWeightPct)} disabled={locked || !c.india.showComposite} onChange={(e) => update((x) => ({ ...x, india: { ...x.india, compositeWeightPct: Number(e.target.value) } }))} options={[5, 10, 15, 20, 25].map((v) => ({ value: String(v), label: `${v}%` }))} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Source-defined weights (read-only)" />
        <div className="grid gap-4 lg:grid-cols-3">
          <table className="w-full text-sm"><caption className="mb-1 text-left text-xs font-semibold uppercase text-muted">Maturity dimensions</caption><tbody>{DIMENSIONS.map((d) => <tr key={d.id}><td className="td">{d.number}. {d.name}</td><td className="td text-right tabular-nums">{d.questionCount} q · {d.weight}%</td></tr>)}</tbody></table>
          <table className="w-full text-sm"><caption className="mb-1 text-left text-xs font-semibold uppercase text-muted">Risk &amp; governance</caption><tbody>{RISK_COMPONENTS.map((r) => <tr key={r.id}><td className="td">{r.name}<div className="text-[11px] text-muted">{r.sourceLabel}</div></td><td className="td text-right tabular-nums">{r.weight}%</td></tr>)}</tbody></table>
          <table className="w-full text-sm"><caption className="mb-1 text-left text-xs font-semibold uppercase text-muted">Value realization</caption><tbody>{VALUE_COMPONENTS.map((r) => <tr key={r.id}><td className="td">{r.name}{r.mappingSource === 'prototype' && <Badge tone="warn" className="ml-1">prototype mapping</Badge>}</td><td className="td text-right tabular-nums">{r.weight}%</td></tr>)}</tbody></table>
        </div>
      </Card>
    </div>
  );
}

function DataTab() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const order = useStore((s) => s.order);
  const assessments = useStore((s) => s.assessments);
  const lastSaved = useStore((s) => s.lastSavedAt);
  const st = useStore.getState;
  const [reset, setReset] = useState(false);
  const [clear, setClear] = useState(false);
  const kb = Math.round(storageUsageBytes() / 1024);

  const exportAll = async () => {
    const status = await downloadText(`ai-maturity-compass_all-assessments_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'AI Maturity Compass', exportVersion: 1, exportedAt: new Date().toISOString(), assessments: order.map((id) => assessments[id]) }, null, 2), 'application/json;charset=utf-8');
    const m = saveMessage(status, 'All assessments (JSON)');
    toast(m.message, m.tone);
  };
  const importOne = async (f: File | undefined) => {
    if (!f) return;
    const r = st().importAssessmentJson(await f.text());
    toast(r.ok ? 'Assessment imported' : r.error, r.ok ? 'good' : 'bad');
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <div className="space-y-4">
      <Callout tone="warn" title="Local prototype storage">{LOCAL_NOTICE}</Callout>
      <Card>
        <CardHeader title="Storage" />
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Assessments</dt><dd className="text-xl font-semibold">{order.length}</dd></div>
          <div><dt className="text-muted">Approx. size</dt><dd className="text-xl font-semibold">{kb} KB</dd></div>
          <div><dt className="text-muted">Schema version</dt><dd className="text-xl font-semibold">v{SCHEMA_VERSION}</dd></div>
          <div><dt className="text-muted">Last saved</dt><dd className="text-sm font-medium">{lastSaved ? new Date(lastSaved).toLocaleString('en-IN') : '—'}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-muted">Stored data is validated against the schema when loaded; invalid or newer-version data is backed up under a separate key and never silently overwritten.</p>
      </Card>
      <Card>
        <CardHeader title="Backup and restore" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportAll}><Download className="h-4 w-4" aria-hidden /> Export all assessments (JSON)</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import assessment JSON file" onChange={(e) => importOne(e.target.files?.[0])} />
          <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden /> Import assessment (JSON)</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Reset and clear" />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-line p-3.5"><div className="text-sm font-semibold">Reset demonstration data</div><p className="mb-2 text-xs text-muted">Restores the synthetic demonstration assessment. Other assessments are untouched.</p><Button onClick={() => setReset(true)}><RotateCcw className="h-4 w-4" aria-hidden /> Reset demonstration data</Button></div>
          <div className="rounded-lg border border-red-200 bg-bad-bg/40 p-3.5"><div className="text-sm font-semibold text-bad">Clear all local assessment data</div><p className="mb-2 text-xs text-muted">Permanently removes every assessment, including the demonstration, from this browser.</p><Button variant="danger" onClick={() => setClear(true)}><Trash2 className="h-4 w-4" aria-hidden /> Clear all local data</Button></div>
        </div>
      </Card>
      <ConfirmDialog open={reset} onClose={() => setReset(false)} title="Reset demonstration data?" confirmLabel="Reset" onConfirm={() => { st().resetDemo(); toast('Demonstration data restored'); }}><p>The demonstration assessment is replaced with a fresh synthetic copy. Your other assessments are not changed.</p></ConfirmDialog>
      <ConfirmDialog open={clear} onClose={() => setClear(false)} danger requireText="DELETE" title="Clear all local data?" confirmLabel="Delete everything" onConfirm={() => { st().clearAll(); toast('All local assessment data cleared', 'info'); }}><p>This permanently deletes all {order.length} assessment(s) stored in this browser. Export anything you want to keep first. This cannot be undone.</p></ConfirmDialog>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="AI Maturity Compass — Assessment, Governance & Value Realization Platform" subtitle="Prototype for Primus Partners" />
        <p className="text-sm">Assesses AI readiness and maturity across Indian enterprises, MSMEs, GCCs, PSUs and government institutions using the 100-question, 12-dimension diagnostic from the source document <em>AI readiness assessment</em>. Specification: {SPEC_VERSION}. Data schema v{SCHEMA_VERSION}.</p>
        <p className="mt-2 text-sm text-muted">Runs entirely in the browser. No data leaves the device; no external AI service, analytics or paid API is used.</p>
      </Card>
      <Card><CardHeader title="Methodology" /><ul className="list-disc space-y-1.5 pl-5 text-sm">{METHODOLOGY.map((t, i) => <li key={i}>{t}</li>)}</ul></Card>
      <Card><CardHeader title="Limitations" /><ul className="list-disc space-y-1.5 pl-5 text-sm">{LIMITATIONS.map((t, i) => <li key={i}>{t}</li>)}</ul></Card>
    </div>
  );
}
