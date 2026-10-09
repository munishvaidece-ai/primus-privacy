/**
 * Illustrative demonstration assessment.
 *
 * Everything here is SYNTHETIC. The organization is fictional and the answers are authored to
 * look realistic. No score is stored: the dashboard computes every figure from these responses
 * with the same engine used for real assessments.
 */
import { DEFAULT_SCORING_CONFIG, QUESTIONS } from '../../data/spec';
import { createAssessment } from '../../domain/factory';
import type { Assessment, EvidenceStatus, Response, Score } from '../../domain/schema';
import { SAMPLE_PROFILES } from './profiles';

export const DEMO_ID = 'demo-bharat-prime';
export const DEMO_LABEL = 'Illustrative demonstration — synthetic data, not client findings';

/**
 * Verified score per question in order. Codes: 0-4 = verified score,
 * n = Not Applicable (assessor-confirmed), x = Not Verified (assessor), p = pending assessor review,
 * N = self-declared Not Applicable awaiting assessor.
 */
const VERIFIED: Record<string, string> = {
  S: '3 3 3 3 3 2 2 3 2 2',
  G: '3 3 2 2 3 3 2 3 3',
  D: '3 3 3 3 3 2 3 2 3 2',
  T: '3 3 3 3 2 2 3 x 2',
  U: '3 3 3 3 3 3 2 3 3 2',
  H: '2 2 3 3 3 2 3 2 p',
  R: '3 3 1 2 3 2 n 3 2',
  C: '3 3 3 3 3 1 3 3',
  V: '3 3 2 3 2 2 2 2',
  I: '3 3 3 2 2 3',
  O: '3 3 N 2 3 x',
  F: '2 2 3 2 2 p',
};

/** Self-reported uplift over the verified score, cycling — organizations tend to over-state. */
const UPLIFT = [0, 1, 0, 1, 1, 0, 2, 0, 1, 0, 1, 0];

const REFS: Record<string, string[]> = {
  S: ['AI Strategy 2025–28 (Board paper, Jun 2025)', 'Executive Committee minutes — AI review, Q3 FY26', 'Annual operating plan FY26 — AI KPIs'],
  G: ['AI Governance Policy v2.1', 'AI Steering Committee charter and minutes', 'AI system register (extract, Jan 2026)'],
  D: ['Data Governance Policy v4', 'Enterprise data catalogue export', 'Data quality dashboard — priority datasets'],
  T: ['Target AI reference architecture v1.3', 'MLOps platform runbook', 'Cloud capacity plan FY26'],
  U: ['Use-case portfolio tracker (Dec 2025)', 'Production release notes — AI services', 'Adoption analytics dashboard (monthly)'],
  H: ['AI literacy programme design and attendance', 'Skills inventory (Data & AI)', 'Leadership AI workshop deck'],
  R: ['Responsible AI Principles (Board-approved)', 'Model risk classification matrix', 'Fairness test report — retail credit scoring'],
  C: ['AI security standard v1.0', 'Third-party AI vendor assessment register', 'Incident response playbook — AI addendum'],
  V: ['AI business-case template and approved cases', 'FY26 AI budget pack', 'Benefits tracking workbook — Finance'],
  I: ['Innovation lab charter', 'Partnership MoUs — academia and startups', 'Technology radar Q4 FY26'],
  O: ['CEO town-hall transcript — AI', 'Change management plan — contact-centre AI', 'Employee pulse survey results'],
  F: ['Model monitoring dashboard (prod)', 'Model/prompt version control standard', 'Annual high-impact model review plan'],
};

const OBS: Record<string, { obs: string; improve: string }> = {
  C06: {
    obs: 'Red-team exercise covered two customer-facing assistants only; no adversarial testing evidenced for credit decisioning or fraud models.',
    improve: 'Extend security evaluation and adversarial testing to all high-impact models before release and annually thereafter.',
  },
  R03: {
    obs: 'Bias evaluation performed once for retail credit scoring; no recurring testing, thresholds or documented remediation.',
    improve: 'Define fairness metrics and thresholds per use-case tier; schedule recurring evaluation with sign-off.',
  },
  G04: {
    obs: 'AI register covers internally built models; embedded third-party AI features are not systematically captured.',
    improve: 'Extend inventory to externally procured AI and embedded vendor features; assign owners.',
  },
  D08: {
    obs: 'Labeling and dataset versioning are team-specific; no enterprise standard for bias assessment of training data.',
    improve: 'Publish dataset standards covering labeling, versioning and bias checks.',
  },
  U07: {
    obs: 'Agentic workflows are at evaluation stage in two functions; no controlled production use yet.',
    improve: 'Define guardrails and an approval path for agentic use cases before pilots.',
  },
  H07: {
    obs: 'Safe-use training is available but completion is concentrated in technology and risk functions.',
    improve: 'Mandate role-based safe-use training for all staff with access to approved GenAI tools.',
  },
  V06: {
    obs: 'Actual-versus-approved comparisons exist for the three largest use cases only.',
    improve: 'Extend benefits reviews to every use case above the materiality threshold.',
  },
  F02: {
    obs: 'Monitoring is in place for most models; GenAI applications lack drift and quality monitoring.',
    improve: 'Add quality and safety monitoring for GenAI applications.',
  },
};

function evidenceFor(index: number, dimId: string, hasScore: boolean): { status: EvidenceStatus; reference: string } {
  const pool = REFS[dimId];
  const ref = pool[index % pool.length];
  if (!hasScore) return { status: index % 2 === 0 ? 'provided' : 'none', reference: index % 2 === 0 ? ref : '' };
  // Deterministic spread: ~65% accepted, rest reviewed/provided/clarification/rejected/none.
  const k = index % 20;
  if (k === 3 || k === 11) return { status: 'reviewed', reference: ref };
  if (k === 7 || k === 15) return { status: 'provided', reference: ref };
  if (k === 5) return { status: 'clarification', reference: ref };
  if (k === 13) return { status: 'rejected', reference: ref };
  if (k === 17) return { status: 'none', reference: '' };
  return { status: 'accepted', reference: ref };
}

export function createDemoAssessment(): Assessment {
  const base = SAMPLE_PROFILES[0].profile;
  const a = createAssessment({
    id: DEMO_ID,
    name: 'FY2025-26 AI Maturity Assessment (illustrative)',
    isDemo: true,
    profile: {
      ...base,
      organizationName: 'Bharat Prime Financial Services Ltd (fictional)',
      periodLabel: 'FY2025-26',
      periodStart: '2025-04-01',
      periodEnd: '2026-03-31',
      assessmentOwner: 'Head of Enterprise Risk (fictional)',
      ownerRole: 'Client assessment owner',
      team: [
        { name: 'Lead assessor (Primus Partners)', role: 'Assessor' },
        { name: 'Analyst (Primus Partners)', role: 'Assessor support' },
        { name: 'Head of Data (client)', role: 'Respondent — data' },
      ],
      regulatoryNotes: 'Synthetic illustration. Confirm any regulatory position with counsel as at the assessment date.',
    },
  });
  const created = '2026-08-18T09:30:00.000Z';
  a.createdAt = created;
  a.updatedAt = '2026-09-22T11:05:00.000Z';
  a.status = 'in_progress';
  a.wizardStep = 4;
  a.activity = [
    { at: created, event: 'Created', detail: 'Illustrative demonstration assessment (synthetic data)' },
    { at: '2026-09-22T11:05:00.000Z', event: 'Verification in progress', detail: 'Assessor review of evidence ongoing' },
  ];
  a.config = JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG));

  const posByDim = new Map<string, number>();
  QUESTIONS.forEach((q) => {
    const pos = posByDim.get(q.dimensionId) ?? 0;
    posByDim.set(q.dimensionId, pos + 1);
    const codes = VERIFIED[q.dimensionId].split(' ');
    const code = codes[pos];
    const dimIdx = 'SGDTUHRCVIOF'.indexOf(q.dimensionId);
    const r: Response = a.responses[q.id];

    const isScore = /^[0-4]$/.test(code);
    const v = isScore ? (Number(code) as Score) : null;
    // Verified side
    if (isScore) r.verified = { state: 'scored', score: v, at: '2026-09-15T10:00:00.000Z' };
    else if (code === 'n') r.verified = { state: 'not_applicable', score: null, at: '2026-09-15T10:00:00.000Z' };
    else if (code === 'x') r.verified = { state: 'not_verified', score: null, at: '2026-09-15T10:00:00.000Z' };
    // 'p' and 'N' remain pending.

    // Self-reported side
    if (code === 'N' || code === 'n') {
      r.self = { state: 'not_applicable', score: null };
    } else if (['D06', 'H05', 'F04'].includes(q.id)) {
      r.self = { state: 'dont_know', score: null };
    } else {
      const basis = v ?? 2; // unverified items: respondent's own estimate
      let s = Math.min(4, basis + UPLIFT[(pos + dimIdx) % UPLIFT.length]);
      // Respondents rated the two weakest critical controls higher than the assessor found.
      if (q.id === 'C06' || q.id === 'R03') s = 3;
      if (q.id === 'H07') s = 3;
      r.self = { state: 'scored', score: s as Score };
    }

    // Evidence
    const ev = evidenceFor(pos + dimIdx * 3, q.dimensionId, isScore);
    if (code === 'n') r.evidence = { status: 'none', reference: '' };
    else r.evidence = ev;
    if (q.id === 'C06') r.evidence = { status: 'reviewed', reference: 'Red-team summary report (two assistants), Nov 2025' };
    if (q.id === 'R03') r.evidence = { status: 'accepted', reference: 'Fairness test report — retail credit scoring (single run)' };
    if (code === 'x') r.evidence = { status: 'clarification', reference: REFS[q.dimensionId][0] };

    const o = OBS[q.id];
    if (o) {
      r.observations = o.obs;
      r.improvementNotes = o.improve;
    } else if (isScore && v !== null && v <= 2 && pos % 2 === 0) {
      r.observations = 'Documented in part; coverage and measurement are not yet consistent across functions.';
      r.improvementNotes = 'Formalize the process across functions and add a measurable KPI.';
    }
    r.respondent = ['CIO office', 'CDO office', 'CISO office', 'Risk & Compliance', 'HR'][(pos + dimIdx) % 5];
    r.updatedAt = '2026-09-10T09:00:00.000Z';
  });

  // Quantitative indicators (FY2025-26 unless noted).
  const P = { periodStart: '2025-04-01', periodEnd: '2026-03-31' };
  const set = (id: string, v: Partial<Assessment['indicators'][string]>) => {
    a.indicators[id] = { ...a.indicators[id], ...v };
  };
  set('aiSpendIntensity', { numerator: 3150, denominator: 42000, ...P, dataSource: 'Finance — IT & AI cost centres (FY26 actuals)', evidenceNote: 'AI cost centres mapped by Finance; excludes shared cloud overheads.', verified: true });
  set('aiInvestmentGrowth', { numerator: 3150, denominator: 2100, ...P, priorStart: '2024-04-01', priorEnd: '2025-03-31', dataSource: 'Finance — FY25 and FY26 actuals', evidenceNote: 'Same cost-centre mapping applied to both years.', verified: true });
  set('adoptionPenetration', { numerator: 7400, denominator: 18500, periodStart: '2026-01-01', periodEnd: '2026-03-31', dataSource: 'Identity-provider logs for approved AI tools', evidenceNote: 'Active = at least one session per week in the quarter.', verified: true });
  set('productionIntensity', { numerator: 46, denominator: 18500, periodStart: '2026-03-31', periodEnd: '2026-03-31', dataSource: 'AI system register', evidenceNote: 'Point-in-time count at 31 Mar 2026.', verified: true });
  set('useCaseConversion', { numerator: 14, denominator: 31, ...P, dataSource: 'Use-case portfolio tracker', evidenceNote: 'Pilots approved FY25–FY26.', verified: true });
  set('deploymentSpeed', { numerator: 112, denominator: 14, ...P, dataSource: 'Use-case portfolio tracker', evidenceNote: 'Median of 14 pilots that reached production.', verified: true });
  set('productivityImpact', { numerator: 300000, denominator: 6000, ...P, dataSource: 'Time-and-motion studies with process owners', evidenceNote: 'Hours verified through sampled time studies in three functions.', verified: true });
  set('trainingCoverage', { numerator: 5200, denominator: 18500, ...P, dataSource: 'LMS completion report', evidenceNote: 'Role-appropriate courses only; generic awareness excluded.', verified: false });
  set('dataReadiness', { numerator: 34, denominator: 60, periodStart: '2026-03-31', periodEnd: '2026-03-31', dataSource: 'Data quality dashboard', evidenceNote: 'Priority datasets as defined by the CDO office.', verified: false });
  set('governanceCoverage', { numerator: 38, denominator: 46, periodStart: '2026-03-31', periodEnd: '2026-03-31', dataSource: 'AI system register', evidenceNote: 'Register + risk-assessment log.', verified: true });
  set('incidentFrequency', { numerator: 7, denominator: 46, ...P, dataSource: 'Operational risk incident log', evidenceNote: 'Includes model errors reaching customers and data-handling events.', verified: true });
  set('monitoringCoverage', { numerator: 29, denominator: 46, periodStart: '2026-03-31', periodEnd: '2026-03-31', dataSource: 'Monitoring platform inventory', evidenceNote: 'GenAI applications largely unmonitored.', verified: true });
  set('infraEfficiency', { numerator: 650, denominator: 41000000, ...P, dataSource: 'Cloud cost reports and API logs', evidenceNote: 'Successful inference calls across production services.', verified: false });
  set('vendorConcentration', { numerator: 1180, denominator: 3150, ...P, dataSource: 'Procurement — AI vendor spend', evidenceNote: 'Largest single provider by FY26 spend.', verified: true });

  a.roi = {
    ...P,
    claimed: { revenue: 1100, costSavings: 2300, productivity: 900 },
    verifiedBenefits: 3620,
    costs: { platform: 900, compute: 650, integration: 480, people: 820, governance: 180, other: 120 },
    dataSource: 'Finance benefits-tracking workbook, reviewed by assessor',
    evidenceNote: 'Claimed ₹43 crore; assessor accepted ₹36.2 crore after removing overlapping productivity and revenue attribution (double-counting).',
  };
  a.valueEvidence = {
    outcomeKpis: [
      { id: 'kpi-1', name: 'Card fraud loss rate (bps of volume)', baseline: '14.2', current: '9.8', rating: 3, verified: true, note: 'Pre-AI baseline FY23; reviewed with Fraud Risk.' },
      { id: 'kpi-2', name: 'Customer query resolution time (hours)', baseline: '26', current: '11', rating: 4, verified: true, note: 'Contact-centre analytics.' },
      { id: 'kpi-3', name: 'Loan pre-approval turnaround (days)', baseline: '3.5', current: '1.4', rating: 3, verified: false, note: 'Awaiting independent verification.' },
    ],
    recurring: { rating: 3, verified: true, note: 'Benefits stable for four consecutive quarters on the two largest use cases.' },
  };

  const india = (id: string, applicability: 'applicable' | 'not_applicable', self: Score | null, ver: Score | null, evidence = '', obs = '') => {
    a.india.items[id] = {
      applicability, selfScore: self, verifiedScore: ver, evidence,
      evidenceStatus: evidence ? 'reviewed' : 'none', observations: obs,
    };
  };
  a.india.assessmentDate = '2026-09-15';
  india('IN01', 'applicable', 3, 2, 'DPDP readiness gap analysis (internal)', 'Obligation mapping exists; AI-specific processing not yet mapped end-to-end.');
  india('IN02', 'applicable', 3, 3, 'Model risk management framework', 'Sector expectations reflected in model approval.');
  india('IN03', 'applicable', 2, 2, '', 'Ecosystem resources reviewed informally.');
  india('IN04', 'applicable', 3, 2, 'Multilingual test report (4 languages)', 'Accuracy testing stronger in Hindi than in Tamil, Telugu and Bengali.');
  india('IN05', 'applicable', 3, 3, 'DPI integration register', 'Account Aggregator and UPI integrations documented.');
  india('IN06', 'applicable', 3, 3, 'Data-location register and vendor contracts', 'Production inference hosted in India regions.');
  india('IN07', 'applicable', 3, 2, 'Training catalogue', 'Local-language material limited to two languages.');
  india('IN08', 'not_applicable', null, null);
  india('IN09', 'not_applicable', null, null);
  india('IN10', 'applicable', 2, 1, 'Accessibility audit (web only)', 'No accessibility testing of voice and chat assistants.');

  a.recommendationOverrides = {
    'crit-security': { owner: 'CISO (illustrative)', status: 'in_progress', notes: 'Red-team scope extension agreed for Q1.' },
    'crit-responsibleAi': { owner: 'Chief Risk Officer (illustrative)', status: 'in_progress' },
  };
  a.notes = 'Synthetic illustration for demonstration. Scores shown are calculated from the seeded responses.';
  return a;
}
