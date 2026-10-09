import { ArrowLeft, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DimensionBars, RadarDimensions, maturityRows } from '../components/charts';
import { NeedAssessment } from '../components/shared';
import { Button, useDocumentTitle, useToast } from '../components/ui';
import { INDIA_DIAGNOSTICS, INDIA_DISCLAIMER } from '../data/india';
import { CLASSIFICATIONS, DIMENSIONS, DIMENSION_BY_ID, RISK_COMPONENTS, ROI_BANDS, VALUE_COMPONENTS } from '../data/spec';
import { EVIDENCE_STATUS_LABELS, type Assessment } from '../domain/schema';
import { exportFilename } from '../export/csv';
import { downloadBlob, saveMessage } from '../export/download';
import { IS_ARTIFACT } from '../env';
import { LIMITATIONS, METHODOLOGY, executiveSummary, fmt1, pctText, profileRows } from '../export/narrative';
import { CONFIDENCE_LABELS } from '../scoring/coverage';
import { formatIndicatorValue, formatInr } from '../scoring/indicators';
import { ADVISORY_NOTICE, BUCKET_LABELS, PRIORITY_LABELS, STATUS_LABELS } from '../scoring/recommendations';
import type { AssessmentResults } from '../scoring/results';
import { useCurrent, useResults } from '../store/hooks';

const H = ({ n, children }: { n: number; children: string }) => <h2 className="mb-3 mt-8 border-b-2 border-teal-600 pb-1 text-xl font-semibold avoid-break">{n}. {children}</h2>;

export default function PrintReport() {
  useDocumentTitle('Printable report');
  const a = useCurrent();
  const res = useResults(a);
  return <NeedAssessment a={a}>{(cur) => (res ? <Report a={cur} res={res} /> : null)}</NeedAssessment>;
}

function Report({ a, res }: { a: Assessment; res: AssessmentResults }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const m = res.maturity;
  const rows = maturityRows(res);
  const roi = res.indicators.roi;
  const period = a.profile.periodLabel || 'Period not specified';

  const pdf = async () => {
    setBusy(true);
    try {
      const { reportPdfBlob } = await import('../export/pdf');
      const m = saveMessage(await downloadBlob(exportFilename(a, 'AI-maturity-report', 'pdf'), reportPdfBlob(a, res)), 'PDF report');
      toast(m.message, m.tone);
    } catch { toast('The PDF could not be generated', 'bad'); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur">
        <Link to="/reports" className="btn btn-sm btn-secondary"><ArrowLeft className="h-4 w-4" aria-hidden /> Back to reports</Link>
        <span className="text-sm text-muted">{IS_ARTIFACT ? 'Report view — use Download PDF to keep a copy.' : "Printable report view — use your browser's Print dialog (choose “Save as PDF” to keep a copy)."}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={pdf} disabled={busy}><Download className="h-4 w-4" aria-hidden /> Download PDF</Button>
          {!IS_ARTIFACT && <Button size="sm" variant="primary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</Button>}
        </div>
      </div>

      <article className="mx-auto max-w-[900px] px-6 py-8 text-[13px] leading-relaxed" aria-label="AI maturity assessment report">
        <header className="rounded-xl bg-navy-900 p-8 text-white avoid-break">
          <div className="text-xs font-semibold tracking-widest text-teal-300">PRIMUS PARTNERS | AI MATURITY COMPASS</div>
          <h1 className="mt-6 text-4xl font-semibold text-white">AI Maturity Assessment Report</h1>
          <div className="mt-4 text-lg text-navy-100">{a.profile.organizationName || a.name}</div>
          <div className="text-sm text-navy-300">{a.name} · {period}</div>
        </header>
        {a.isDemo && <div className="mt-4 rounded-lg border border-amber-300 bg-warn-bg p-3 font-medium text-warn">ILLUSTRATIVE DEMONSTRATION — synthetic data for a fictional organization. Not a client finding and not a validated benchmark.</div>}

        <section className="mt-6 grid grid-cols-3 gap-3 avoid-break" aria-label="Principal scores">
          {[
            { t: 'AI Maturity Index', v: m.index, s: m.classification ? `${(res.gates.finalClassification ?? m.classification).label}${m.status !== 'definitive' ? ' — provisional' : ''}` : 'No verified scores yet' },
            { t: 'Risk & Governance Control Maturity', v: res.risk.score, s: `Higher = stronger controls${res.risk.status === 'provisional' ? ' — provisional' : ''}` },
            { t: 'AI Value Realization', v: res.value.score, s: `${res.value.components.filter((c) => c.status !== 'unscored').length} of 6 components scored${res.value.status === 'provisional' ? ' — provisional' : ''}` },
          ].map((x) => (
            <div key={x.t} className="rounded-xl border border-line bg-navy-50 p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{x.t}</div><div className="mt-1 text-3xl font-semibold tabular-nums">{fmt1(x.v)}</div><div className="text-xs text-muted">{x.s}</div></div>
          ))}
        </section>

        <H n={1}>Organization profile</H>
        <table className="w-full"><tbody>{profileRows(a).map(([k, v]) => <tr key={k}><th scope="row" className="w-48 border-b border-line py-1.5 pr-3 text-left font-medium text-muted align-top">{k}</th><td className="border-b border-line py-1.5">{v}</td></tr>)}</tbody></table>

        <H n={2}>Assessment period and methodology</H>
        <p>Assessment period: {period}. Status: {a.status.replace('_', ' ')}. Source: AI readiness assessment document (100 questions, 12 dimensions).</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">{METHODOLOGY.map((t, i) => <li key={i}>{t}</li>)}</ul>

        <H n={3}>Executive summary</H>
        <div className="space-y-2">{executiveSummary(a, res).map((p, i) => <p key={i}>{p}</p>)}</div>
        <table className="mt-4 w-full avoid-break">
          <thead><tr><th className="th" scope="col">Score</th><th className="th" scope="col">Assessor-verified</th><th className="th" scope="col">Self-reported</th><th className="th" scope="col">Basis and coverage</th></tr></thead>
          <tbody>
            <tr><td className="td">AI Maturity Index (0–100)</td><td className="td">{fmt1(m.index)} {m.classification?.label}</td><td className="td">{fmt1(res.maturitySelf.index)} {res.maturitySelf.classification?.label}</td><td className="td">{m.status}; {pctText(m.questionCoverage)} question coverage; {pctText(m.weightCoverage)} of weight scored</td></tr>
            <tr><td className="td">Risk & Governance Control Maturity (higher = stronger controls)</td><td className="td">{fmt1(res.risk.score)}</td><td className="td">{fmt1(res.riskSelf.score)}</td><td className="td">{res.risk.status}; {pctText(res.risk.questionCoverage)} coverage</td></tr>
            <tr><td className="td">AI Value Realization Score</td><td className="td">{fmt1(res.value.score)}</td><td className="td">{fmt1(res.valueSelf.score)}</td><td className="td">{res.value.status}; {pctText(res.value.weightCoverage)} of weight scored</td></tr>
          </tbody>
        </table>
        <h3 className="mb-1 mt-4 font-semibold text-teal-700">Classification and coverage caveats</h3>
        {m.classification && <p>Index classification: <strong>{m.classification.label}</strong> ({m.classification.description}).{res.gates.finalClassification && res.gates.finalClassification.id !== m.classification.id ? ` Reported after confirmed gate: ${res.gates.finalClassification.label}.` : ''}</p>}
        {[...m.caveats, ...res.risk.caveats, ...res.value.caveats, ...res.indicators.periodWarnings].length === 0 ? <p className="text-muted">No coverage caveats.</p> : <ul className="list-disc space-y-1 pl-5">{[...m.caveats, ...res.risk.caveats, ...res.value.caveats, ...res.indicators.periodWarnings].map((c, i) => <li key={i}>{c}</li>)}</ul>}

        <H n={4}>Twelve-dimension scorecard</H>
        <table className="w-full">
          <thead><tr><th className="th" scope="col">#</th><th className="th" scope="col">Dimension</th><th className="th" scope="col">Weight</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Self</th><th className="th" scope="col">Coverage</th><th className="th" scope="col">Points</th><th className="th" scope="col">Status</th></tr></thead>
          <tbody>{m.dimensions.map((d, i) => <tr key={d.id}><td className="td">{DIMENSIONS[i].number}</td><td className="td">{d.name}</td><td className="td">{d.weight}%</td><td className="td tabular-nums">{d.normalized === null ? 'unscored' : fmt1(d.normalized)}</td><td className="td tabular-nums">{fmt1(res.maturitySelf.dimensions[i].normalized)}</td><td className="td">{pctText(d.coverage)}</td><td className="td tabular-nums">{d.contribution === null ? '—' : d.contribution.toFixed(2)}</td><td className="td">{d.status === 'scored' ? 'Scored' : d.status === 'partial' ? 'Limited coverage' : 'Unscored'}</td></tr>)}</tbody>
        </table>
        <div className="mt-4 grid grid-cols-2 gap-4 avoid-break"><RadarDimensions rows={rows} height={320} /><DimensionBars rows={rows} height={320} /></div>

        <H n={5}>Risk & governance and critical control deficiencies</H>
        <p className="italic text-muted">A higher control-maturity score means stronger assessed controls; it is not a risk level.</p>
        <table className="mt-2 w-full"><thead><tr><th className="th" scope="col">Component</th><th className="th" scope="col">Source</th><th className="th" scope="col">Weight</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Self</th><th className="th" scope="col">Coverage</th></tr></thead>
          <tbody>{res.risk.components.map((c, i) => <tr key={c.id}><td className="td">{c.name}</td><td className="td">{RISK_COMPONENTS[i].sourceLabel}</td><td className="td">{c.weight}%</td><td className="td tabular-nums">{c.normalized === null ? 'unscored' : fmt1(c.normalized)}</td><td className="td tabular-nums">{fmt1(res.riskSelf.components[i].normalized)}</td><td className="td">{pctText(c.coverage)}</td></tr>)}</tbody></table>
        <ul className="mt-3 list-disc space-y-1 pl-5">{res.gates.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
        {res.gates.deficiencies.length > 0 && <table className="mt-2 w-full"><thead><tr><th className="th" scope="col">ID</th><th className="th" scope="col">Gate</th><th className="th" scope="col">Control</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Self</th><th className="th" scope="col">Evidence</th></tr></thead><tbody>{res.gates.deficiencies.map((d) => <tr key={d.questionId + d.gateId}><td className="td font-semibold">{d.questionId}</td><td className="td">{d.gateName}</td><td className="td">{d.text}</td><td className="td">{d.verifiedScore}</td><td className="td">{d.selfScore ?? '—'}</td><td className="td">{EVIDENCE_STATUS_LABELS[d.evidenceStatus]}</td></tr>)}</tbody></table>}

        <H n={6}>Value realization</H>
        <table className="w-full"><thead><tr><th className="th" scope="col">Component</th><th className="th" scope="col">Weight</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Self</th><th className="th" scope="col">Items scored</th></tr></thead>
          <tbody>{res.value.components.map((c, i) => <tr key={c.id}><td className="td">{c.name}{VALUE_COMPONENTS[i].mappingSource === 'prototype' ? ' (prototype question mapping)' : ''}</td><td className="td">{c.weight}%</td><td className="td tabular-nums">{c.normalized === null ? 'unscored' : fmt1(c.normalized)}</td><td className="td tabular-nums">{fmt1(res.valueSelf.components[i].normalized)}</td><td className="td">{c.scoredItems} of {c.applicableItems}</td></tr>)}</tbody></table>
        <p className="mt-2">{roi.totalCosts === null || roi.totalCosts <= 0 ? 'AI ROI could not be calculated: total AI costs are missing or zero; the financial component is unscored (not zero).' : `ROI = ((Verified AI benefits − Total AI costs) ÷ Total AI costs) × 100. Total AI costs ${formatInr(roi.totalCosts)}; verified benefits ${roi.verifiedBenefits === null ? 'not yet recorded' : formatInr(roi.verifiedBenefits)}; verified ROI ${roi.roiVerified === null ? 'n/a' : `${roi.roiVerified.toFixed(1)}%`}${roi.scoreVerified === null ? '' : ` (provisional band ${roi.scoreVerified} of 4)`}.`}</p>
        <p className="text-xs text-muted">ROI bands are provisional assessment thresholds from the source document, not established industry benchmarks: {ROI_BANDS.map((b) => `${b.score} = ${b.description}`).join('; ')}.</p>

        <H n={7}>Evidence coverage and confidence</H>
        <table className="w-full"><tbody>
          {([
            ['Applicable questions (excludes Not Applicable)', res.coverage.applicable], ['Not Applicable', res.coverage.notApplicable], ['Evidence reference entered (not verification)', res.coverage.withReference],
            ['Evidence reviewed by an assessor', res.coverage.reviewed], ['Evidence accepted / verified by an assessor', `${res.coverage.accepted} (${pctText(res.coverage.acceptedShare)})`], ['Assessor-verified scores', res.coverage.verifiedScored],
            ["Don't Know / Not Verified (evidence gap)", res.coverage.dontKnowNotVerified], ['Awaiting assessment', res.coverage.awaitingAssessment], ['Dimensions with sufficient verified coverage', `${res.coverage.sufficientDimensions} of 12`], ['Evidence confidence (prototype heuristic)', CONFIDENCE_LABELS[res.coverage.confidence]],
          ] as [string, string | number][]).map(([k, v]) => <tr key={k}><th scope="row" className="border-b border-line py-1.5 pr-3 text-left font-medium text-muted">{k}</th><td className="border-b border-line py-1.5 tabular-nums">{v}</td></tr>)}
        </tbody></table>

        <H n={8}>Quantitative indicators</H>
        <table className="w-full"><thead><tr><th className="th" scope="col">Indicator</th><th className="th" scope="col">Result</th><th className="th" scope="col">Period</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Data source</th></tr></thead>
          <tbody>{res.indicators.results.map((r) => { const e = a.indicators[r.id]; return <tr key={r.id}><td className="td">{r.def.name}<div className="text-[11px] text-muted">{r.def.measurement}</div></td><td className="td font-medium">{r.status === 'ok' ? formatIndicatorValue(r) : r.status === 'invalid' ? 'Invalid input' : 'Not captured'}</td><td className="td">{r.periodStart ? `${r.periodStart} → ${r.periodEnd}` : '—'}</td><td className="td">{r.status === 'ok' ? (r.verified ? 'Yes' : 'No') : '—'}</td><td className="td">{r.def.kind === 'roi' ? a.roi.dataSource : e?.dataSource || '—'}</td></tr>; })}</tbody></table>
        {res.crossChecks.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{res.crossChecks.map((c) => <li key={c.questionId + c.indicatorId}>{c.message}</li>)}</ul>}

        <H n={9}>India-specific diagnostic observations</H>
        <p className="italic text-warn">{INDIA_DISCLAIMER}</p>
        <p className="mt-1">Position assessed as at: {a.india.assessmentDate || 'not recorded'}. Supplementary index (verified): {fmt1(res.india.verifiedIndex)}; self-reported: {fmt1(res.india.selfIndex)} — reported separately from the core index.</p>
        <table className="mt-2 w-full"><thead><tr><th className="th" scope="col">Area</th><th className="th" scope="col">Applicability</th><th className="th" scope="col">Self</th><th className="th" scope="col">Verified</th><th className="th" scope="col">Observation</th></tr></thead>
          <tbody>{INDIA_DIAGNOSTICS.map((d) => { const it = a.india.items[d.id]; return <tr key={d.id}><td className="td">{d.area}</td><td className="td">{it.applicability.replace('_', ' ')}</td><td className="td">{it.selfScore ?? '—'}</td><td className="td">{it.verifiedScore ?? '—'}</td><td className="td">{it.observations || '—'}</td></tr>; })}</tbody></table>

        <H n={10}>Priority recommendations</H>
        <p className="italic text-warn">{ADVISORY_NOTICE}</p>
        <ol className="mt-2 space-y-4">
          {res.recommendations.filter((r) => r.status !== 'dismissed').slice(0, 14).map((r) => (
            <li key={r.id} className="avoid-break">
              <div className="font-semibold">[{PRIORITY_LABELS[r.priority]}] {r.title}</div>
              <div className="text-xs text-muted">{r.dimensionId ? `${DIMENSION_BY_ID[r.dimensionId].name} · ` : ''}{r.questionIds.length ? `Questions: ${r.questionIds.join(', ')} · ` : ''}Accountable: {r.owner || r.role} · {r.timeframe} · {STATUS_LABELS[r.status]}</div>
              <p><strong>Gap:</strong> {r.gap}</p><p><strong>Why it matters:</strong> {r.why}</p><p><strong>Suggested intervention:</strong> {r.intervention}</p>
              <p><strong>Target outcome / KPI:</strong> {r.kpi}{r.dependencies ? ` Dependencies: ${r.dependencies}` : ''}{r.evidenceGaps.length ? ` Related evidence gaps: ${r.evidenceGaps.join(', ')}` : ''}</p>
            </li>
          ))}
        </ol>

        <H n={11}>Roadmap: 6, 12 and 24 months</H>
        {(['m0_6', 'm6_12', 'm12_24'] as const).map((b) => (
          <div key={b} className="mb-3 avoid-break"><h3 className="font-semibold text-teal-700">{BUCKET_LABELS[b]}</h3>{res.roadmap[b].length === 0 ? <p className="text-muted">No initiatives in this window.</p> : <ul className="list-disc pl-5">{res.roadmap[b].map((r) => <li key={r.id}>[{PRIORITY_LABELS[r.priority]}] {r.title} — {r.owner || r.role} ({STATUS_LABELS[r.status]})</li>)}</ul>}</div>
        ))}

        <H n={12}>Scoring methodology and limitations</H>
        <table className="w-full"><thead><tr><th className="th" scope="col">Band</th><th className="th" scope="col">Index range</th><th className="th" scope="col">Meaning</th></tr></thead><tbody>{CLASSIFICATIONS.map((c) => <tr key={c.id}><td className="td">{c.label}</td><td className="td">{c.rangeLabel}</td><td className="td">{c.description}</td></tr>)}</tbody></table>
        <h3 className="mb-1 mt-3 font-semibold text-teal-700">Limitations</h3>
        <ul className="list-disc space-y-1 pl-5">{LIMITATIONS.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <p className="mt-6 text-xs text-muted">Generated {new Date(res.computedAt).toLocaleString('en-IN')} by AI Maturity Compass (prototype) from the current assessment results.</p>
      </article>
    </div>
  );
}
