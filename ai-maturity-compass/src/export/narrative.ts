/**
 * Shared report text. Both the PDF and the printable HTML view call these functions, so
 * wording and numbers can never diverge. Every figure is read from AssessmentResults.
 */
import { AI_STAGES, FOOTPRINTS, ORG_TYPES, SIZE_CATEGORIES } from '../data/options';
import { CLASSIFICATIONS, DIMENSION_BY_ID } from '../data/spec';
import type { Assessment } from '../domain/schema';
import { formatInr } from '../scoring/indicators';
import { CONFIDENCE_LABELS } from '../scoring/coverage';
import type { AssessmentResults } from '../scoring/results';

export const fmt1 = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : n.toFixed(1));
export const pctText = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : `${Math.round(n * 100)}%`);

export const orgTypeLabel = (v: string): string => ORG_TYPES.find((o) => o.value === v)?.label ?? (v || 'Not specified');
export const sizeLabel = (v: string): string => SIZE_CATEGORIES.find((o) => o.value === v)?.label ?? (v || 'Not specified');
export const footprintLabel = (v: string): string => FOOTPRINTS.find((o) => o.value === v)?.label ?? (v || 'Not specified');
export const stageLabel = (v: string): string => AI_STAGES.find((o) => o.value === v)?.label ?? (v || 'Not specified');

export function profileRows(a: Assessment): [string, string][] {
  const p = a.profile;
  return [
    ['Organization', p.organizationName || 'Not specified'],
    ['Industry / sector', [p.industry, p.subSector].filter(Boolean).join(' — ') || 'Not specified'],
    ['Organization type', orgTypeLabel(p.orgType) + (p.orgType === 'other' && p.orgTypeOther ? ` (${p.orgTypeOther})` : '')],
    ['Size and workforce', `${sizeLabel(p.sizeCategory)}; workforce ${p.workforceBand || 'band not specified'}${p.employeeCount ? ` (${p.employeeCount.toLocaleString('en-IN')} employees)` : ''}`],
    ['Annual revenue / budget band', p.revenueBand || 'Not specified'],
    ['Geography and footprint', [p.headquarters, footprintLabel(p.footprint), p.footprintNotes].filter(Boolean).join('; ') || 'Not specified'],
    ['Annual IT expenditure', p.itExpenditureLakh === null ? 'Not specified' : formatInr(p.itExpenditureLakh, { ascii: true })],
    ['Annual AI expenditure', p.aiExpenditureLakh === null ? 'Not specified' : formatInr(p.aiExpenditureLakh, { ascii: true })],
    ['AI investment / deployment stage', stageLabel(p.aiStage)],
    ['Assessment period', p.periodLabel ? `${p.periodLabel}${p.periodStart ? ` (${p.periodStart} to ${p.periodEnd})` : ''}` : p.periodStart ? `${p.periodStart} to ${p.periodEnd}` : 'Not specified'],
    ['Assessment owner', [p.assessmentOwner, p.ownerRole].filter(Boolean).join(', ') || 'Not specified'],
    ['Assessment team', p.team.filter((t) => t.name).map((t) => `${t.name}${t.role ? ` (${t.role})` : ''}`).join('; ') || 'Not specified'],
    ['Participating functions', p.participatingFunctions.join('; ') || 'Not specified'],
    ['Regulatory / sectoral context', [...p.regulatoryContext, p.regulatoryNotes].filter(Boolean).join('; ') || 'Not specified'],
  ];
}

export function executiveSummary(a: Assessment, res: AssessmentResults): string[] {
  const org = a.profile.organizationName || a.name;
  const m = res.maturity;
  const out: string[] = [];

  if (a.isDemo) {
    out.push('ILLUSTRATIVE DEMONSTRATION: this report is generated from synthetic data for a fictional organization. It does not describe any real client.');
  }

  if (m.index === null) {
    out.push(`${org} has no assessor-verified scores yet, so no AI Maturity Index can be reported. ${res.maturitySelf.index !== null ? `The self-reported index is ${fmt1(res.maturitySelf.index)} out of 100 (${res.maturitySelf.classification!.label}) but it has not been verified.` : 'No self-reported scores are available either.'}`);
  } else {
    const cls = res.gates.finalClassification ?? m.classification!;
    out.push(
      `${org} scores ${fmt1(m.index)} out of 100 on the assessor-verified AI Maturity Index, classified as ${m.classification!.label}${m.status === 'provisional' ? ' (provisional)' : ''}` +
        `, based on ${m.scoredQuestions} verified answers across ${m.applicableQuestions} applicable questions (${pctText(m.questionCoverage)} verified coverage; ${12 - m.unscoredDimensionIds.length} of 12 dimensions scored).` +
        (cls.id !== m.classification!.id ? ` After assessor confirmation of the risk-based gate, the reported classification is ${cls.label}.` : ''),
    );
  }

  if (res.selfMinusVerified !== null) {
    const d = res.selfMinusVerified;
    out.push(
      `The organization's own self-reported index is ${fmt1(res.maturitySelf.index)}, which is ${Math.abs(d).toFixed(1)} points ${d > 0.05 ? 'higher than' : d < -0.05 ? 'lower than' : 'in line with'} the verified index` +
        `${d > 0.05 ? ', indicating a degree of over-statement that evidence review has corrected' : ''}. The two figures are calculated independently and are never substituted for one another.`,
    );
  }

  if (res.strengths.length > 0 && res.priorityGaps.length > 0) {
    out.push(
      `Relative strengths are ${res.strengths.map((s) => `${s.shortName} (${fmt1(s.normalized)})`).join(', ')}. ` +
        `The largest remaining opportunities by index points are ${res.priorityGaps.slice(0, 3).map((g) => `${g.shortName} (${fmt1(g.pointsAvailable)} points available)`).join(', ')}.`,
    );
  }

  const g = res.gates;
  if (g.triggered) {
    out.push(
      `Risk-based gate: ${g.deficiencies.length} critical control${g.deficiencies.length > 1 ? 's are' : ' is'} verified as deficient (${g.deficiencies.map((d) => d.questionId).join(', ')}). ` +
        `${g.ceilingApplies ? `This flags the ${m.classification!.label} classification for review against an advisory ceiling of ${g.ceiling.label}. ` : ''}` +
        `The gate is an advisory policy rule and ${g.status === 'confirmed' ? 'has been confirmed by an assessor' : g.status === 'overridden' ? 'was overridden by an assessor' : 'requires assessor confirmation'}.`,
    );
  } else if (g.enabled && g.unverified.length > 0) {
    out.push(`No critical control is verified as deficient, but ${g.unverified.length} critical control${g.unverified.length > 1 ? 's remain' : ' remains'} unverified, so the gate cannot be cleared with confidence.`);
  }

  out.push(
    `AI Risk & Governance Control Maturity is ${res.risk.score === null ? 'not yet calculable' : `${fmt1(res.risk.score)} out of 100${res.risk.status === 'provisional' ? ' (provisional)' : ''}`} — a higher score means stronger assessed controls, not higher risk. ` +
      `The AI Value Realization Score is ${res.value.score === null ? 'not yet calculable' : `${fmt1(res.value.score)} out of 100${res.value.status === 'provisional' ? ' (provisional)' : ''}`}` +
      `${res.value.status !== 'definitive' && res.value.score !== null ? `, with ${res.value.components.filter((c) => c.status !== 'unscored').length} of 6 components scored; unscored components were not treated as zero` : ''}.`,
  );

  out.push(
    `Evidence confidence is ${CONFIDENCE_LABELS[res.coverage.confidence].toLowerCase()}: ${res.coverage.accepted} of ${res.coverage.applicable} applicable questions have evidence accepted by an assessor, ${res.coverage.reviewed} have been reviewed, and ${res.coverage.dontKnowNotVerified} are marked Don't Know / Not Verified (an evidence gap, not a zero).`,
  );
  return out;
}

export const METHODOLOGY: string[] = [
  'Questionnaire: 100 diagnostic questions across 12 dimensions, taken verbatim from the AI readiness assessment source document, each scored on a five-point scale (0 Not initiated, 1 Ad hoc, 2 Emerging, 3 Established, 4 Advanced).',
  'AI Maturity Index = Σ over dimensions of [dimension weight × (sum of applicable verified scores ÷ (4 × number of applicable verified questions))], on a 0–100 scale. Not Applicable questions are excluded from the denominator. Don\'t Know / Not Verified and unanswered questions are evidence gaps, never zero.',
  'Self-reported and assessor-verified scores are calculated independently. The headline index uses assessor-verified scores only. Dimensions with no verified scores are shown as unscored; a provisional index is renormalized over the weight that is scored and is labelled provisional.',
  'Classification: 0–20 AI Nascent; above 20 to 40 AI Exploring; above 40 to 60 AI Emerging; above 60 to 80 AI Advanced; above 80 to 100 AI Leading. Boundaries are applied to unrounded scores.',
  'AI Risk & Governance Control Maturity: weighted composition of governance (G01–G09, 25%), responsible AI (R01–R09, 25%), cybersecurity/privacy/resilience (C01–C08, 25%), data governance (D01–D10 emphasizing D02, D06, D08, D09, 10%), executive oversight (S04, S05, S09, S10, 5%) and lifecycle controls (F02–F05, 10%). Higher means stronger assessed controls.',
  'AI Value Realization Score: financial value 25%, productivity 20%, business and strategic impact 20%, adoption and utilization 15%, value measurement discipline 10%, value sustainability and scaling 10%, using the questionnaire items and quantitative evidence named in the source. Missing data leaves a component unscored.',
  'Risk-based gates are advisory policy rules: a verified deficiency in a critical security, privacy or responsible-AI control flags the classification for review and proposes a ceiling that takes effect only on assessor confirmation.',
];

export const LIMITATIONS: string[] = [
  'ROI scoring bands (0%, up to 10%, up to 25%, up to 50%, above 50%) are provisional assessment thresholds from the source document, not established industry benchmarks, and should be adjusted by sector, investment maturity and deployment stage.',
  'Where the source names no questionnaire items for a Value Realization component (productivity, business impact) the question mapping and the quantitative scoring bands are prototype interpretations, configurable per assessment.',
  'Recommendations and roadmap items are advisory outputs generated by transparent rules. They require consulting judgement and client validation and do not quote financial benefits or guarantee ROI.',
  'India-specific diagnostics are a diagnostic aid reported separately from the core index; they are not a legal opinion and must be confirmed against laws and rules in force at the assessment date.',
  'Benchmarks shown in this prototype are illustrative synthetic data, not industry averages or rankings. Comparisons should only be made within like-for-like sector, organization-type and size cohorts.',
  'Evidence references are recorded text. Only evidence an assessor has explicitly marked as accepted is treated as verified. This prototype stores data locally in the browser and has no authentication or multi-user access control.',
];

export function classificationLadder(): string {
  return CLASSIFICATIONS.map((c) => `${c.label} (${c.rangeLabel})`).join('; ');
}

export const dimName = (id: string): string => (DIMENSION_BY_ID as Record<string, { name: string }>)[id]?.name ?? '';
