import { Download, FileJson, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NeedAssessment, NeedProfile, ResultStatusBadge } from '../components/shared';
import { Badge, Button, Callout, Card, CardHeader, PageHeader, useDocumentTitle, useToast } from '../components/ui';
import type { Assessment } from '../domain/schema';
import { dimensionScoresCsv, exportFilename, indiaCsv, indicatorsCsv, principalScoresCsv, questionnaireCsv, recommendationsCsv } from '../export/csv';
import { downloadBlob, downloadText } from '../export/download';
import { executiveSummary, fmt1 } from '../export/narrative';
import type { AssessmentResults } from '../scoring/results';
import { useCurrent, useResults } from '../store/hooks';

export const REPORT_SECTIONS = [
  'Cover page', 'Organization profile', 'Assessment period and methodology', 'Executive summary', 'Three principal scores',
  'Overall maturity classification and coverage caveats', 'Twelve-dimension scorecard', 'Radar chart and dimension comparison', 'Critical control deficiencies',
  'Evidence coverage and confidence', 'Quantitative indicators', 'India-specific diagnostic observations', 'Priority recommendations',
  '6-, 12- and 24-month roadmap', 'Scoring methodology and limitations',
];

export default function Reports() {
  useDocumentTitle('Reports');
  const a = useCurrent();
  const res = useResults(a);
  return <NeedAssessment a={a}>{(cur) => <NeedProfile a={cur}>{res && <Inner a={cur} res={res} />}</NeedProfile>}</NeedAssessment>;
}

function Inner({ a, res }: { a: Assessment; res: AssessmentResults }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const pdf = async () => {
    setBusy(true);
    try {
      const { reportPdfBlob } = await import('../export/pdf');
      downloadBlob(exportFilename(a, 'AI-maturity-report', 'pdf'), reportPdfBlob(a, res));
      toast('PDF report generated from the current results');
    } catch (e) {
      console.error(e);
      toast('The PDF could not be generated', 'bad');
    } finally {
      setBusy(false);
    }
  };

  const csvs: { key: string; label: string; desc: string; build: () => string; kind: string }[] = [
    { key: 'questionnaire', label: 'Questionnaire and responses', desc: 'All 100 questions with self-reported and verified scores, evidence and notes.', build: () => questionnaireCsv(a), kind: 'questionnaire' },
    { key: 'dimensions', label: 'Dimension-level scores', desc: '12 dimensions: weights, coverage, verified and self-reported scores, contribution to the index.', build: () => dimensionScoresCsv(res), kind: 'dimension-scores' },
    { key: 'principal', label: 'Principal scores and components', desc: 'Maturity, Risk & Governance control maturity and Value Realization with every component.', build: () => principalScoresCsv(res), kind: 'principal-scores' },
    { key: 'indicators', label: 'Quantitative indicators', desc: 'All 15 indicators with numerator, denominator, units, period, source and validation messages.', build: () => indicatorsCsv(a, res), kind: 'indicators' },
    { key: 'recs', label: 'Recommendations and roadmap', desc: 'Every recommendation with priority, owner, status, window, KPI and dependencies.', build: () => recommendationsCsv(res), kind: 'recommendations' },
    { key: 'india', label: 'India-specific diagnostics', desc: 'Applicability, scores and observations. Diagnostic only, not a legal opinion.', build: () => indiaCsv(a, res), kind: 'india-diagnostics' },
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description="Client-facing PDF, printable view and CSV exports — all generated on this device from the selected assessment's current calculated results."
        meta={<><Badge tone="teal">{a.name}</Badge><ResultStatusBadge status={res.maturity.status} /></>}
      />

      {res.maturity.status !== 'definitive' && (
        <Callout tone="warn" className="mb-4" title="This report will disclose provisional scores">
          {res.maturity.caveats[0] ?? 'Some scores are provisional.'} The PDF states coverage limitations prominently; nothing is scored as zero to fill gaps.
        </Callout>
      )}
      {a.isDemo && <Callout tone="warn" className="mb-4" title="Illustrative demonstration">Reports generated from the demonstration assessment are watermarked as synthetic and must not be shared as client findings.</Callout>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Assessment report" subtitle="Cover, profile, methodology, executive summary, scores, charts, deficiencies, evidence, indicators, India diagnostics, recommendations, roadmap and limitations" />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={pdf} disabled={busy}><FileText className="h-4 w-4" aria-hidden /> {busy ? 'Generating…' : 'Download PDF report'}</Button>
            <Link to="/reports/print" className="btn btn-md btn-secondary"><Printer className="h-4 w-4" aria-hidden /> Open printable view</Link>
          </div>
          <h3 className="mb-1 mt-5 text-sm font-semibold">Executive summary preview</h3>
          <div className="space-y-2 rounded-lg bg-navy-50 p-3.5 text-sm leading-relaxed">
            {executiveSummary(a, res).map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </Card>
        <Card>
          <CardHeader title="Report contents" />
          <ol className="list-decimal space-y-1 pl-5 text-sm">{REPORT_SECTIONS.map((s) => <li key={s}>{s}</li>)}</ol>
          <div className="mt-4 rounded-lg border border-line p-3 text-xs text-muted">
            Based on: index {fmt1(res.maturity.index)} (verified), risk &amp; governance {fmt1(res.risk.score)}, value realization {fmt1(res.value.score)}; {res.recommendations.length} recommendations. Calculated {new Date(res.computedAt).toLocaleString('en-IN')}.
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Data exports" subtitle="CSV files use UTF-8 and open in Excel. Text cells that start with = + - @ are neutralized so spreadsheets do not run them as formulas." />
        <ul className="grid gap-3 md:grid-cols-2">
          {csvs.map((c) => (
            <li key={c.key} className="flex items-start gap-3 rounded-lg border border-line p-3.5">
              <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden />
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{c.label}</div><p className="text-xs text-muted">{c.desc}</p></div>
              <Button size="sm" aria-label={`Download CSV: ${c.label}`} onClick={() => { downloadText(exportFilename(a, c.kind, 'csv'), c.build()); toast(`${c.label} exported`); }}><Download className="h-4 w-4" aria-hidden /> CSV</Button>
            </li>
          ))}
          <li className="flex items-start gap-3 rounded-lg border border-line p-3.5">
            <FileJson className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden />
            <div className="min-w-0 flex-1"><div className="text-sm font-semibold">Complete assessment (JSON)</div><p className="text-xs text-muted">Full record for backup or transfer. Can be re-imported on the Assessments page.</p></div>
            <Button size="sm" aria-label="Download JSON: complete assessment" onClick={() => { downloadText(exportFilename(a, 'assessment-export', 'json'), JSON.stringify({ app: 'AI Maturity Compass', exportVersion: 1, exportedAt: new Date().toISOString(), assessment: a }, null, 2), 'application/json;charset=utf-8'); toast('Assessment exported'); }}><Download className="h-4 w-4" aria-hidden /> JSON</Button>
          </li>
        </ul>
      </Card>
    </>
  );
}
