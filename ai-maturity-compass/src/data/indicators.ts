/**
 * Quantitative indicator definitions (source §5). Names and "suggested measurement" are
 * verbatim from the source; input labels/units are product decisions.
 */
export type IndicatorKind =
  | 'pct' // numerator / denominator × 100, numerator must not exceed denominator
  | 'per_1000' // numerator / denominator × 1,000
  | 'per_100' // numerator / denominator × 100 (may exceed 100)
  | 'growth' // (current − prior) / prior × 100
  | 'per_unit_month' // numerator / (denominator × months in period)
  | 'cost_per_txn' // (₹ lakh × 100,000) / transactions
  | 'direct' // value is entered directly (numerator) — e.g. median days
  | 'roi'; // taken from the ROI calculator

export type PeriodRule = 'annual' | 'any';

export interface IndicatorDef {
  id: string;
  name: string;
  /** Source "Suggested measurement" wording. */
  measurement: string;
  kind: IndicatorKind;
  numeratorLabel: string;
  numeratorUnit: string;
  denominatorLabel?: string;
  denominatorUnit?: string;
  resultUnit: string;
  decimals: number;
  period: PeriodRule;
  /** Needs a prior-period range as well (growth). */
  needsPriorPeriod?: boolean;
  direction: 'higher' | 'lower' | 'neutral';
  help: string;
  /** Questions whose self-reported score this indicator can corroborate. */
  linkedQuestions: string[];
  /** For the dashboard cards. */
  short: string;
}

export const INDICATORS: readonly IndicatorDef[] = [
  {
    id: 'aiSpendIntensity', name: 'AI spending intensity', short: 'AI spend / IT spend',
    measurement: 'Annual AI expenditure as % of IT expenditure', kind: 'pct',
    numeratorLabel: 'Annual AI expenditure', numeratorUnit: '₹ lakh', denominatorLabel: 'Annual IT expenditure', denominatorUnit: '₹ lakh',
    resultUnit: '% of IT spend', decimals: 1, period: 'annual', direction: 'neutral',
    help: 'AI expenditure is normally a subset of IT expenditure. Compare only after adjusting for scale, sector and AI opportunity — do not rank organizations on raw spend.',
    linkedQuestions: ['V01'],
  },
  {
    id: 'aiInvestmentGrowth', name: 'AI investment growth', short: 'AI spend growth (YoY)',
    measurement: 'Year-on-year change in AI expenditure', kind: 'growth',
    numeratorLabel: 'AI expenditure — current period', numeratorUnit: '₹ lakh', denominatorLabel: 'AI expenditure — prior period', denominatorUnit: '₹ lakh',
    resultUnit: '% YoY', decimals: 1, period: 'annual', needsPriorPeriod: true, direction: 'neutral',
    help: 'The prior period must end before the current period starts and cover a similar length of time.',
    linkedQuestions: ['V01'],
  },
  {
    id: 'adoptionPenetration', name: 'AI adoption penetration', short: 'Active AI users',
    measurement: '% of employees actively using approved AI tools', kind: 'pct',
    numeratorLabel: 'Employees actively using approved AI tools', numeratorUnit: 'employees', denominatorLabel: 'Eligible employees', denominatorUnit: 'employees',
    resultUnit: '% of employees', decimals: 1, period: 'any', direction: 'higher',
    help: 'Count active use (not licences or registrations) within the reporting period.',
    linkedQuestions: ['U08', 'U03'],
  },
  {
    id: 'productionIntensity', name: 'Production AI intensity', short: 'Live use cases / 1,000 staff',
    measurement: 'Number of live AI use cases per 1,000 employees', kind: 'per_1000',
    numeratorLabel: 'Live AI use cases in production', numeratorUnit: 'use cases', denominatorLabel: 'Total employees', denominatorUnit: 'employees',
    resultUnit: 'per 1,000 employees', decimals: 2, period: 'any', direction: 'higher',
    help: 'Count only use cases live in production, not pilots or proofs of concept.',
    linkedQuestions: ['U02'],
  },
  {
    id: 'useCaseConversion', name: 'AI use-case conversion', short: 'Pilot → production',
    measurement: '% of AI pilots converted into production', kind: 'pct',
    numeratorLabel: 'Pilots converted to production', numeratorUnit: 'pilots', denominatorLabel: 'Pilots completed or approved in period', denominatorUnit: 'pilots',
    resultUnit: '% of pilots', decimals: 1, period: 'any', direction: 'higher',
    help: 'Use a consistent cohort of pilots; a low rate is not always poor — stopping weak pilots is healthy.',
    linkedQuestions: ['U10'],
  },
  {
    id: 'deploymentSpeed', name: 'AI deployment speed', short: 'Median days to production',
    measurement: 'Median time from approved pilot to production', kind: 'direct',
    numeratorLabel: 'Median time from approved pilot to production', numeratorUnit: 'days', denominatorLabel: 'Pilots in the sample (optional)', denominatorUnit: 'pilots',
    resultUnit: 'days (median)', decimals: 0, period: 'any', direction: 'lower',
    help: 'Enter the median (not the mean). Sample size is optional but recommended as evidence.',
    linkedQuestions: ['U10', 'T05'],
  },
  {
    id: 'productivityImpact', name: 'AI productivity impact', short: 'Hours saved / employee / month',
    measurement: 'Verified hours saved per employee per month', kind: 'per_unit_month',
    numeratorLabel: 'Total verified hours saved in the period', numeratorUnit: 'hours', denominatorLabel: 'Employees in scope', denominatorUnit: 'employees',
    resultUnit: 'hours / employee / month', decimals: 2, period: 'any', direction: 'higher',
    help: 'Hours must be verified (time studies, system logs), not estimated by users. Months are taken from the reporting period.',
    linkedQuestions: ['V05', 'U09'],
  },
  {
    id: 'financialReturns', name: 'AI financial returns', short: 'AI ROI',
    measurement: 'Net annual benefits relative to AI investment', kind: 'roi',
    numeratorLabel: 'Verified AI benefits', numeratorUnit: '₹ lakh', denominatorLabel: 'Total AI costs', denominatorUnit: '₹ lakh',
    resultUnit: '% ROI', decimals: 1, period: 'annual', direction: 'higher',
    help: 'Calculated in the ROI calculator on the Value Realization page: ROI (%) = ((Verified AI Benefits − Total AI Costs) / Total AI Costs) × 100.',
    linkedQuestions: ['V05', 'V06'],
  },
  {
    id: 'trainingCoverage', name: 'AI training coverage', short: 'Role-based AI training',
    measurement: '% of employees completing role-appropriate AI training', kind: 'pct',
    numeratorLabel: 'Employees completing role-appropriate AI training', numeratorUnit: 'employees', denominatorLabel: 'Employees requiring AI training', denominatorUnit: 'employees',
    resultUnit: '% of employees', decimals: 1, period: 'any', direction: 'higher',
    help: 'Count completion of training matched to role and AI exposure, not generic awareness sessions.',
    linkedQuestions: ['H03', 'H07'],
  },
  {
    id: 'dataReadiness', name: 'Data readiness', short: 'Priority data quality',
    measurement: '% of priority datasets meeting defined quality standards', kind: 'pct',
    numeratorLabel: 'Priority datasets meeting defined quality standards', numeratorUnit: 'datasets', denominatorLabel: 'Priority datasets', denominatorUnit: 'datasets',
    resultUnit: '% of datasets', decimals: 1, period: 'any', direction: 'higher',
    help: 'Quality standards must be defined and measurable (accuracy, completeness, timeliness, consistency).',
    linkedQuestions: ['D03', 'D02'],
  },
  {
    id: 'governanceCoverage', name: 'AI governance coverage', short: 'Systems inventoried & risk-assessed',
    measurement: '% of production AI systems inventoried and risk-assessed', kind: 'pct',
    numeratorLabel: 'Production AI systems inventoried and risk-assessed', numeratorUnit: 'systems', denominatorLabel: 'Production AI systems', denominatorUnit: 'systems',
    resultUnit: '% of systems', decimals: 1, period: 'any', direction: 'higher',
    help: 'Include externally procured AI services embedded in production processes.',
    linkedQuestions: ['G04', 'G05'],
  },
  {
    id: 'incidentFrequency', name: 'AI incident frequency', short: 'Incidents / 100 systems',
    measurement: 'AI-related incidents per 100 production systems', kind: 'per_100',
    numeratorLabel: 'AI-related incidents in the period', numeratorUnit: 'incidents', denominatorLabel: 'Production AI systems', denominatorUnit: 'systems',
    resultUnit: 'per 100 systems', decimals: 1, period: 'annual', direction: 'lower',
    help: 'A very low rate can indicate weak detection or reporting rather than strong control — read alongside C07 and R08.',
    linkedQuestions: ['C07', 'R08'],
  },
  {
    id: 'monitoringCoverage', name: 'AI monitoring coverage', short: 'Systems with monitoring',
    measurement: '% of production systems with defined monitoring controls', kind: 'pct',
    numeratorLabel: 'Production systems with defined monitoring controls', numeratorUnit: 'systems', denominatorLabel: 'Production AI systems', denominatorUnit: 'systems',
    resultUnit: '% of systems', decimals: 1, period: 'any', direction: 'higher',
    help: 'Monitoring should cover performance, drift, quality, cost and safety indicators.',
    linkedQuestions: ['F02'],
  },
  {
    id: 'infraEfficiency', name: 'AI infrastructure efficiency', short: 'Cost per AI transaction',
    measurement: 'Cost per successful AI transaction or workload unit', kind: 'cost_per_txn',
    numeratorLabel: 'AI infrastructure and inference cost', numeratorUnit: '₹ lakh', denominatorLabel: 'Successful AI transactions / workload units', denominatorUnit: 'transactions',
    resultUnit: '₹ per transaction', decimals: 2, period: 'any', direction: 'lower',
    help: 'Define the workload unit consistently across periods; do not compare unlike workloads.',
    linkedQuestions: ['T08'],
  },
  {
    id: 'vendorConcentration', name: 'AI vendor concentration', short: 'Largest AI vendor share',
    measurement: '% of AI spend with the largest provider', kind: 'pct',
    numeratorLabel: 'AI spend with the largest provider', numeratorUnit: '₹ lakh', denominatorLabel: 'Total AI spend', denominatorUnit: '₹ lakh',
    resultUnit: '% of AI spend', decimals: 1, period: 'annual', direction: 'lower',
    help: 'High concentration is not inherently bad but should be matched to exit and portability planning (T09).',
    linkedQuestions: ['T09', 'C05'],
  },
];

export const INDICATOR_BY_ID: Record<string, IndicatorDef> = Object.fromEntries(
  INDICATORS.map((i) => [i.id, i]),
);

/** Source §5 guidance verbatim — shown next to the module. */
export const INDICATOR_SOURCE_NOTE =
  'For financial and operational indicators, capture numerator, denominator, measurement period and evidence source. Do not compare organizations on raw spending or use-case counts without adjusting for scale, sector and AI opportunity.';

/** Source §9.C sector examples of outcome measures (verbatim). */
export const SECTOR_OUTCOME_EXAMPLES: readonly { sector: string; examples: string }[] = [
  { sector: 'Banking', examples: 'Fraud losses prevented, risk decisions improved, customer resolution time' },
  { sector: 'Manufacturing', examples: 'Defect reduction, downtime avoided, yield improvement' },
  { sector: 'Retail', examples: 'Incremental sales, conversion improvement, inventory efficiency' },
  { sector: 'Healthcare', examples: 'Reduced reporting time, improved workflow accuracy, patient service outcomes' },
  { sector: 'IT services / GCC', examples: 'Engineering productivity, delivery quality, time to market' },
  { sector: 'Government', examples: 'Citizen service turnaround, error reduction, grievance resolution, service accessibility' },
];
