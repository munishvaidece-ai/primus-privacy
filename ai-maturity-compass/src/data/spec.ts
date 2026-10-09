/**
 * Assessment specification — the single source of truth for dimensions, questions,
 * weights, maturity bands and the composition of the three principal scores.
 *
 * Question IDs, wording, question counts and weights come from the source document via
 * `sourceSpec.generated.ts` (produced by scripts/extract_questions.py). Nothing in this
 * file re-types a question.
 */
import { SOURCE_SPEC } from './sourceSpec.generated';

// ---------------------------------------------------------------------------
// Maturity scale (source §2)
// ---------------------------------------------------------------------------
export type Score = 0 | 1 | 2 | 3 | 4;
export const SCORES: readonly Score[] = [0, 1, 2, 3, 4] as const;

export interface ScaleLevel {
  score: Score;
  label: string;
  description: string;
}

export const MATURITY_SCALE: readonly ScaleLevel[] = SOURCE_SPEC.scale.map((s) => ({
  score: s.score as Score,
  label: s.label,
  description: s.description,
}));

export const SCALE_BY_SCORE: Record<Score, ScaleLevel> = Object.fromEntries(
  MATURITY_SCALE.map((s) => [s.score, s]),
) as Record<Score, ScaleLevel>;

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------
export type DimensionId = 'S' | 'G' | 'D' | 'T' | 'U' | 'H' | 'R' | 'C' | 'V' | 'I' | 'O' | 'F';

export interface Dimension {
  id: DimensionId;
  number: number;
  /** Product name (as specified for this application). */
  name: string;
  /** Compact label for charts. */
  shortName: string;
  /** Name as printed in the source document's summary table. */
  sourceTableName: string;
  /** Heading as printed above the question table in the source document. */
  sourceHeading: string;
  /** Weight in percentage points (sums to 100). */
  weight: number;
  questionCount: number;
}

const DIMENSION_META: Record<number, { id: DimensionId; name: string; shortName: string }> = {
  1: { id: 'S', name: 'AI Strategy & Leadership', shortName: 'Strategy' },
  2: { id: 'G', name: 'Governance & Operating Model', shortName: 'Governance' },
  3: { id: 'D', name: 'Data Readiness & Governance', shortName: 'Data' },
  4: { id: 'T', name: 'Technology & AI Infrastructure', shortName: 'Technology' },
  5: { id: 'U', name: 'AI Adoption & Use Cases', shortName: 'Adoption' },
  6: { id: 'H', name: 'Talent, Skills & Workforce Readiness', shortName: 'Talent' },
  7: { id: 'R', name: 'Responsible AI, Ethics & Trust', shortName: 'Responsible AI' },
  8: { id: 'C', name: 'Cybersecurity, Privacy & Operational Resilience', shortName: 'Cyber & Privacy' },
  9: { id: 'V', name: 'AI Investments, ROI & Value Realization', shortName: 'Value & ROI' },
  10: { id: 'I', name: 'Innovation, R&D & Ecosystem', shortName: 'Innovation' },
  11: { id: 'O', name: 'Organizational Culture & Change Management', shortName: 'Culture' },
  12: { id: 'F', name: 'AI Scaling, Monitoring & Future Readiness', shortName: 'Scaling' },
};

export const DIMENSIONS: readonly Dimension[] = SOURCE_SPEC.summary.map((s) => {
  const meta = DIMENSION_META[s.number];
  return {
    id: meta.id,
    number: s.number,
    name: meta.name,
    shortName: meta.shortName,
    sourceTableName: s.sourceTableName,
    sourceHeading: s.sourceHeading,
    weight: s.weight,
    questionCount: s.questions,
  };
});

export const DIMENSION_BY_ID: Record<DimensionId, Dimension> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.id, d]),
) as Record<DimensionId, Dimension>;

export const TOTAL_WEIGHT = DIMENSIONS.reduce((a, d) => a + d.weight, 0);

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------
export interface Question {
  id: string;
  dimensionId: DimensionId;
  /** 1-based position within its dimension. */
  position: number;
  /** Verbatim diagnostic question from the source document. */
  text: string;
}

const dimByNumber = new Map(DIMENSIONS.map((d) => [d.number, d]));

export const QUESTIONS: readonly Question[] = (() => {
  const counters = new Map<number, number>();
  return SOURCE_SPEC.questions.map((q) => {
    const n = (counters.get(q.dimension) ?? 0) + 1;
    counters.set(q.dimension, n);
    return {
      id: q.id,
      dimensionId: dimByNumber.get(q.dimension)!.id,
      position: n,
      text: q.text,
    };
  });
})();

export const QUESTION_BY_ID: Record<string, Question> = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, q]),
);

export const QUESTION_IDS: readonly string[] = QUESTIONS.map((q) => q.id);

export function questionsOf(dimensionId: DimensionId): Question[] {
  return QUESTIONS.filter((q) => q.dimensionId === dimensionId);
}

/** Expand an inclusive ID range such as G01–G09 into its question IDs. */
export function range(prefix: DimensionId, from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${prefix}${String(i).padStart(2, '0')}`);
  return out;
}

// ---------------------------------------------------------------------------
// Maturity classification (source §4, boundary rule from the product brief)
// ---------------------------------------------------------------------------
export type ClassificationId = 'nascent' | 'exploring' | 'emerging' | 'advanced' | 'leading';

export interface Classification {
  id: ClassificationId;
  label: string;
  rank: number;
  /** Exclusive lower bound (index must be strictly greater), except the first band, which starts at 0 inclusive. */
  lowerExclusive: number;
  /** Inclusive upper bound. */
  upperInclusive: number;
  description: string;
  rangeLabel: string;
}

export const CLASSIFICATIONS: readonly Classification[] = [
  { id: 'nascent', label: 'AI Nascent', rank: 0, lowerExclusive: -Infinity, upperInclusive: 20, rangeLabel: '0–20', description: 'Little formal adoption or institutional capability' },
  { id: 'exploring', label: 'AI Exploring', rank: 1, lowerExclusive: 20, upperInclusive: 40, rangeLabel: 'Above 20 to 40', description: 'Early pilots and fragmented capabilities' },
  { id: 'emerging', label: 'AI Emerging', rank: 2, lowerExclusive: 40, upperInclusive: 60, rangeLabel: 'Above 40 to 60', description: 'Structured adoption in selected functions' },
  { id: 'advanced', label: 'AI Advanced', rank: 3, lowerExclusive: 60, upperInclusive: 80, rangeLabel: 'Above 60 to 80', description: 'Scaled AI adoption with governance and measured outcomes' },
  { id: 'leading', label: 'AI Leading', rank: 4, lowerExclusive: 80, upperInclusive: 100, rangeLabel: 'Above 80 to 100', description: 'Enterprise-wide, optimized and continuously improving' },
];

export const CLASSIFICATION_BY_ID: Record<ClassificationId, Classification> = Object.fromEntries(
  CLASSIFICATIONS.map((c) => [c.id, c]),
) as Record<ClassificationId, Classification>;

/**
 * Classify an unrounded 0–100 index. Boundaries: 0–20 Nascent; >20–40 Exploring;
 * >40–60 Emerging; >60–80 Advanced; >80–100 Leading. A score of exactly 20 is Nascent,
 * exactly 40 Exploring, and so on — no intermediate rounding is applied.
 */
export function classify(index: number): Classification {
  if (index > 80) return CLASSIFICATION_BY_ID.leading;
  if (index > 60) return CLASSIFICATION_BY_ID.advanced;
  if (index > 40) return CLASSIFICATION_BY_ID.emerging;
  if (index > 20) return CLASSIFICATION_BY_ID.exploring;
  return CLASSIFICATION_BY_ID.nascent;
}

// ---------------------------------------------------------------------------
// AI Risk & Governance Control Maturity — source §9 composition
// ---------------------------------------------------------------------------
export type RiskComponentId =
  | 'governance'
  | 'responsibleAi'
  | 'cyber'
  | 'dataGovernance'
  | 'executiveOversight'
  | 'lifecycle';

export interface RiskComponentSpec {
  id: RiskComponentId;
  name: string;
  sourceLabel: string;
  weight: number;
  questionIds: string[];
  /** Questions the source says to emphasize within the component. */
  emphasisIds: string[];
}

export const RISK_COMPONENTS: readonly RiskComponentSpec[] = [
  { id: 'governance', name: 'AI governance and accountability', sourceLabel: 'G01–G09', weight: 25, questionIds: range('G', 1, 9), emphasisIds: [] },
  { id: 'responsibleAi', name: 'Responsible AI and ethical safeguards', sourceLabel: 'R01–R09', weight: 25, questionIds: range('R', 1, 9), emphasisIds: [] },
  { id: 'cyber', name: 'AI cybersecurity, privacy and resilience', sourceLabel: 'C01–C08', weight: 25, questionIds: range('C', 1, 8), emphasisIds: [] },
  { id: 'dataGovernance', name: 'Data governance and protection', sourceLabel: 'D01–D10, emphasizing D02, D06, D08, D09', weight: 10, questionIds: range('D', 1, 10), emphasisIds: ['D02', 'D06', 'D08', 'D09'] },
  { id: 'executiveOversight', name: 'Executive oversight and strategic risk management', sourceLabel: 'S04, S05, S09, S10', weight: 5, questionIds: ['S04', 'S05', 'S09', 'S10'], emphasisIds: [] },
  { id: 'lifecycle', name: 'AI lifecycle controls and monitoring', sourceLabel: 'F02–F05', weight: 10, questionIds: range('F', 2, 5), emphasisIds: [] },
];

// ---------------------------------------------------------------------------
// AI Value Realization Score — source §9 composition
// ---------------------------------------------------------------------------
export type ValueComponentId =
  | 'financial'
  | 'productivity'
  | 'strategic'
  | 'adoption'
  | 'discipline'
  | 'sustainability';

export type QuantItemId = 'roiBand' | 'hoursSaved' | 'adoptionPenetration' | 'outcomeKpis' | 'recurringBenefits';

export interface ValueComponentSpec {
  id: ValueComponentId;
  name: string;
  measurement: string;
  weight: number;
  questionIds: string[];
  quantItems: QuantItemId[];
  /** Whether the question mapping is stated in the source document or is a prototype interpretation. */
  mappingSource: 'source' | 'prototype';
  mappingNote: string;
}

export const VALUE_COMPONENTS: readonly ValueComponentSpec[] = [
  {
    id: 'financial', name: 'Financial value delivered', measurement: 'Verified net benefits against AI investment', weight: 25,
    questionIds: [], quantItems: ['roiBand'], mappingSource: 'source',
    mappingNote: 'Source §9.A: scored from verified AI ROI using the provisional bands. No questionnaire items are blended in; with no cost/benefit data the component stays unscored.',
  },
  {
    id: 'productivity', name: 'Productivity and efficiency gains', measurement: 'Measured time, cost and process improvements', weight: 20,
    questionIds: ['V04', 'V05', 'U09'], quantItems: ['hoursSaved'], mappingSource: 'prototype',
    mappingNote: 'Source §9.B names no questions. Prototype mapping: V04 (baselines), V05 (realized benefits), U09 (quality vs baseline) plus verified hours saved per employee per month.',
  },
  {
    id: 'strategic', name: 'Business and strategic impact', measurement: 'Revenue, customer experience, service quality or mission outcomes', weight: 20,
    questionIds: ['V05', 'V06'], quantItems: ['outcomeKpis'], mappingSource: 'prototype',
    mappingNote: 'Source §9.C asks for 3–5 outcome KPIs against baselines. Prototype mapping: V05, V06 plus assessor-rated outcome KPIs.',
  },
  {
    id: 'adoption', name: 'AI adoption and utilization', measurement: 'Meaningful usage of production AI solutions', weight: 15,
    questionIds: ['U02', 'U03', 'U04', 'U08', 'U10'], quantItems: ['adoptionPenetration'], mappingSource: 'source',
    mappingNote: 'Source §9.D: U02, U03, U04, U08 and U10, supplemented by actual usage data (adoption penetration).',
  },
  {
    id: 'discipline', name: 'Value measurement discipline', measurement: 'Baselines, KPIs, ROI reviews and investment decisions', weight: 10,
    questionIds: range('V', 2, 8), quantItems: [], mappingSource: 'source',
    mappingNote: 'Source §9.E: V02–V08.',
  },
  {
    id: 'sustainability', name: 'Value sustainability and scaling', measurement: 'Recurring benefits and replication of successful use cases', weight: 10,
    questionIds: ['U09', 'U10', 'V07', 'V08', 'F01', 'F02'], quantItems: ['recurringBenefits'], mappingSource: 'source',
    mappingNote: 'Source §9.F: U09, U10, V07, V08, F01 and F02, with evidence that benefits are recurring and stable (assessor rating).',
  },
];

/** Provisional AI ROI scoring bands (source §9.A) — NOT established industry benchmarks. */
export interface RoiBand {
  score: Score;
  description: string;
}
export const ROI_BANDS: readonly RoiBand[] = [
  { score: 0, description: 'No measurable financial benefit or material negative ROI' },
  { score: 1, description: 'ROI greater than 0% and up to 10%' },
  { score: 2, description: 'ROI greater than 10% and up to 25%' },
  { score: 3, description: 'ROI greater than 25% and up to 50%' },
  { score: 4, description: 'ROI greater than 50%' },
];

export function roiToScore(roiPercent: number): Score {
  if (roiPercent > 50) return 4;
  if (roiPercent > 25) return 3;
  if (roiPercent > 10) return 2;
  if (roiPercent > 0) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Scoring policy defaults
// ---------------------------------------------------------------------------
export interface GateRule {
  id: 'security' | 'privacy' | 'responsibleAi';
  name: string;
  /** Critical controls (question IDs) in this gate. */
  questionIds: string[];
}

export interface ScoringConfig {
  /** Minimum share of applicable questions with a score for a dimension to count as sufficiently covered. */
  minDimensionCoverage: number;
  /** Risk & governance: weight multiplier for source-emphasized questions inside a component. */
  emphasisMultiplier: number;
  gates: {
    enabled: boolean;
    /** A critical control scoring at or below this value is a critical deficiency. */
    deficiencyThreshold: Score;
    /** Highest classification an organization with a confirmed critical deficiency should receive. */
    ceiling: ClassificationId;
    rules: GateRule[];
  };
  quantBands: {
    /** Lower bounds for scores 1–4 (value must be >= bound). Prototype default, not from source. */
    adoptionPenetration: [number, number, number, number];
    hoursSavedPerEmployeeMonth: [number, number, number, number];
  };
  /** Show a supplementary composite that blends in the India diagnostics. Never alters the core index. */
  india: { showComposite: boolean; compositeWeightPct: number };
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  minDimensionCoverage: 0.7,
  emphasisMultiplier: 2,
  gates: {
    enabled: true,
    deficiencyThreshold: 1,
    ceiling: 'emerging',
    rules: [
      { id: 'security', name: 'AI security', questionIds: ['C01', 'C02', 'C03', 'C05', 'C06', 'C07'] },
      { id: 'privacy', name: 'Privacy & lawful data use', questionIds: ['C04', 'D09'] },
      { id: 'responsibleAi', name: 'Responsible AI', questionIds: ['R02', 'R03', 'R05', 'R06'] },
    ],
  },
  quantBands: {
    adoptionPenetration: [5, 20, 40, 60],
    hoursSavedPerEmployeeMonth: [0.5, 2, 4, 8],
  },
  india: { showComposite: false, compositeWeightPct: 10 },
};

export const SCHEMA_VERSION = 1;
export const SPEC_VERSION = 'AI-Readiness-Assessment-v1 (source docx)';
