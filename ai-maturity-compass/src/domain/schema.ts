/**
 * Domain model. Zod schemas double as (a) the TypeScript types and (b) the validators used
 * when reading assessments back from localStorage or importing exported JSON.
 *
 * Self-reported and assessor-verified answers are always separate fields — nothing in the
 * model collapses one into the other.
 */
import { z } from 'zod';

export const scoreSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type Score = z.infer<typeof scoreSchema>;

// ---------------------------------------------------------------------------
// Question responses
// ---------------------------------------------------------------------------
export const selfStateSchema = z.enum(['unanswered', 'scored', 'not_applicable', 'dont_know']);
export const verifiedStateSchema = z.enum(['pending', 'scored', 'not_applicable', 'not_verified']);
export const evidenceStatusSchema = z.enum(['none', 'provided', 'reviewed', 'accepted', 'rejected', 'clarification']);

export type SelfState = z.infer<typeof selfStateSchema>;
export type VerifiedState = z.infer<typeof verifiedStateSchema>;
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const responseSchema = z.object({
  self: z.object({ state: selfStateSchema.default('unanswered'), score: scoreSchema.nullable().default(null) }).default({}),
  verified: z
    .object({
      state: verifiedStateSchema.default('pending'),
      score: scoreSchema.nullable().default(null),
      at: z.string().nullable().default(null),
    })
    .default({}),
  evidence: z
    .object({ reference: z.string().default(''), status: evidenceStatusSchema.default('none') })
    .default({}),
  observations: z.string().default(''),
  improvementNotes: z.string().default(''),
  respondent: z.string().default(''),
  updatedAt: z.string().nullable().default(null),
});
export type Response = z.infer<typeof responseSchema>;

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  none: 'No evidence',
  provided: 'Provided (not yet reviewed)',
  reviewed: 'Reviewed by assessor',
  accepted: 'Accepted — verified by assessor',
  rejected: 'Rejected by assessor',
  clarification: 'Clarification required',
};

// ---------------------------------------------------------------------------
// Organization profile
// ---------------------------------------------------------------------------
const numOrNull = z.number().finite().nullable().default(null);

export const profileSchema = z.object({
  organizationName: z.string().default(''),
  industry: z.string().default(''),
  subSector: z.string().default(''),
  orgType: z.enum(['private_enterprise', 'msme', 'gcc', 'psu', 'government', 'other', '']).default(''),
  orgTypeOther: z.string().default(''),
  sizeCategory: z.enum(['micro_small', 'medium', 'large', 'very_large', '']).default(''),
  workforceBand: z.string().default(''),
  employeeCount: numOrNull,
  revenueBand: z.string().default(''),
  headquarters: z.string().default(''),
  footprint: z.string().default(''),
  footprintNotes: z.string().default(''),
  itExpenditureLakh: numOrNull,
  aiExpenditureLakh: numOrNull,
  aiStage: z.string().default(''),
  periodLabel: z.string().default(''),
  periodStart: z.string().default(''),
  periodEnd: z.string().default(''),
  assessmentOwner: z.string().default(''),
  ownerRole: z.string().default(''),
  team: z.array(z.object({ name: z.string().default(''), role: z.string().default('') })).default([]),
  participatingFunctions: z.array(z.string()).default([]),
  regulatoryContext: z.array(z.string()).default([]),
  regulatoryNotes: z.string().default(''),
});
export type Profile = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// Quantitative indicators
// ---------------------------------------------------------------------------
export const indicatorEntrySchema = z.object({
  numerator: numOrNull,
  denominator: numOrNull,
  periodStart: z.string().default(''),
  periodEnd: z.string().default(''),
  priorStart: z.string().default(''),
  priorEnd: z.string().default(''),
  dataSource: z.string().default(''),
  evidenceNote: z.string().default(''),
  /** Assessor has verified this figure against source evidence. */
  verified: z.boolean().default(false),
});
export type IndicatorEntry = z.infer<typeof indicatorEntrySchema>;

export const roiInputsSchema = z.object({
  periodStart: z.string().default(''),
  periodEnd: z.string().default(''),
  /** Benefits as claimed by the organization (₹ lakh). */
  claimed: z
    .object({ revenue: numOrNull, costSavings: numOrNull, productivity: numOrNull })
    .default({}),
  /** Total benefits after assessor verification (₹ lakh). Null until an assessor enters it. */
  verifiedBenefits: numOrNull,
  /** Fully loaded costs (₹ lakh). */
  costs: z
    .object({ platform: numOrNull, compute: numOrNull, integration: numOrNull, people: numOrNull, governance: numOrNull, other: numOrNull })
    .default({}),
  dataSource: z.string().default(''),
  evidenceNote: z.string().default(''),
});
export type RoiInputs = z.infer<typeof roiInputsSchema>;

export const outcomeKpiSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  baseline: z.string().default(''),
  current: z.string().default(''),
  /** Assessor/organization rating of the outcome 0–4. */
  rating: scoreSchema.nullable().default(null),
  verified: z.boolean().default(false),
  note: z.string().default(''),
});
export type OutcomeKpi = z.infer<typeof outcomeKpiSchema>;

export const valueEvidenceSchema = z.object({
  outcomeKpis: z.array(outcomeKpiSchema).default([]),
  recurring: z
    .object({ rating: scoreSchema.nullable().default(null), verified: z.boolean().default(false), note: z.string().default('') })
    .default({}),
});
export type ValueEvidence = z.infer<typeof valueEvidenceSchema>;

// ---------------------------------------------------------------------------
// India-specific diagnostics (supplementary — never part of the core index)
// ---------------------------------------------------------------------------
export const indiaApplicabilitySchema = z.enum(['not_assessed', 'applicable', 'not_applicable']);
export type IndiaApplicability = z.infer<typeof indiaApplicabilitySchema>;

export const indiaItemSchema = z.object({
  applicability: indiaApplicabilitySchema.default('not_assessed'),
  selfScore: scoreSchema.nullable().default(null),
  verifiedScore: scoreSchema.nullable().default(null),
  evidence: z.string().default(''),
  evidenceStatus: evidenceStatusSchema.default('none'),
  observations: z.string().default(''),
});
export type IndiaItem = z.infer<typeof indiaItemSchema>;

export const indiaSchema = z.object({
  assessmentDate: z.string().default(''),
  items: z.record(indiaItemSchema).default({}),
});
export type IndiaState = z.infer<typeof indiaSchema>;

// ---------------------------------------------------------------------------
// Recommendations (generated from results; user edits are stored as overrides)
// ---------------------------------------------------------------------------
export const prioritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type Priority = z.infer<typeof prioritySchema>;
export const recStatusSchema = z.enum(['not_started', 'in_progress', 'completed', 'deferred', 'dismissed']);
export type RecStatus = z.infer<typeof recStatusSchema>;
export const bucketSchema = z.enum(['m0_6', 'm6_12', 'm12_24']);
export type Bucket = z.infer<typeof bucketSchema>;

export const recOverrideSchema = z.object({
  priority: prioritySchema.optional(),
  status: recStatusSchema.optional(),
  owner: z.string().optional(),
  notes: z.string().optional(),
  bucket: bucketSchema.optional(),
  title: z.string().optional(),
  gap: z.string().optional(),
  why: z.string().optional(),
  intervention: z.string().optional(),
  role: z.string().optional(),
  timeframe: z.string().optional(),
  dependencies: z.string().optional(),
  kpi: z.string().optional(),
});
export type RecOverride = z.infer<typeof recOverrideSchema>;

export const customRecSchema = z.object({
  id: z.string(),
  title: z.string(),
  dimensionId: z.string().default(''),
  questionIds: z.array(z.string()).default([]),
  gap: z.string().default(''),
  why: z.string().default(''),
  intervention: z.string().default(''),
  role: z.string().default(''),
  timeframe: z.string().default(''),
  dependencies: z.string().default(''),
  kpi: z.string().default(''),
  priority: prioritySchema.default('medium'),
  bucket: bucketSchema.default('m6_12'),
  status: recStatusSchema.default('not_started'),
  owner: z.string().default(''),
  notes: z.string().default(''),
});
export type CustomRec = z.infer<typeof customRecSchema>;

// ---------------------------------------------------------------------------
// Scoring policy (per assessment, so a report is reproducible)
// ---------------------------------------------------------------------------
export const scoringConfigSchema = z.object({
  minDimensionCoverage: z.number().min(0).max(1).default(0.7),
  emphasisMultiplier: z.number().min(1).max(5).default(2),
  gates: z
    .object({
      enabled: z.boolean().default(true),
      deficiencyThreshold: scoreSchema.default(1),
      ceiling: z.enum(['nascent', 'exploring', 'emerging', 'advanced', 'leading']).default('emerging'),
      rules: z
        .array(z.object({ id: z.enum(['security', 'privacy', 'responsibleAi']), name: z.string(), questionIds: z.array(z.string()) }))
        .default([
          { id: 'security', name: 'AI security', questionIds: ['C01', 'C02', 'C03', 'C05', 'C06', 'C07'] },
          { id: 'privacy', name: 'Privacy & lawful data use', questionIds: ['C04', 'D09'] },
          { id: 'responsibleAi', name: 'Responsible AI', questionIds: ['R02', 'R03', 'R05', 'R06'] },
        ]),
    })
    .default({}),
  quantBands: z
    .object({
      adoptionPenetration: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([5, 20, 40, 60]),
      hoursSavedPerEmployeeMonth: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([0.5, 2, 4, 8]),
    })
    .default({}),
  india: z.object({ showComposite: z.boolean().default(false), compositeWeightPct: z.number().min(0).max(50).default(10) }).default({}),
});

export const gateDecisionSchema = z.object({
  status: z.enum(['unreviewed', 'confirmed', 'overridden']).default('unreviewed'),
  note: z.string().default(''),
  decidedBy: z.string().default(''),
  decidedAt: z.string().nullable().default(null),
});
export type GateDecision = z.infer<typeof gateDecisionSchema>;

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------
export const assessmentStatusSchema = z.enum(['draft', 'in_progress', 'submitted']);
export type AssessmentStatus = z.infer<typeof assessmentStatusSchema>;

export const assessmentSchema = z.object({
  id: z.string(),
  name: z.string().default('Untitled assessment'),
  status: assessmentStatusSchema.default('draft'),
  isDemo: z.boolean().default(false),
  wizardStep: z.number().int().min(0).default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  submittedAt: z.string().nullable().default(null),
  profile: profileSchema.default({}),
  responses: z.record(responseSchema).default({}),
  indicators: z.record(indicatorEntrySchema).default({}),
  roi: roiInputsSchema.default({}),
  valueEvidence: valueEvidenceSchema.default({}),
  india: indiaSchema.default({}),
  gateDecision: gateDecisionSchema.default({}),
  recommendationOverrides: z.record(recOverrideSchema).default({}),
  customRecommendations: z.array(customRecSchema).default([]),
  config: scoringConfigSchema.default({}),
  notes: z.string().default(''),
  activity: z.array(z.object({ at: z.string(), event: z.string(), detail: z.string().default('') })).default([]),
});
export type Assessment = z.infer<typeof assessmentSchema>;
export type ScoringConfigStored = z.infer<typeof scoringConfigSchema>;

// ---------------------------------------------------------------------------
// Benchmark records — the shape genuine anonymized records must follow.
// ---------------------------------------------------------------------------
export const benchmarkSourceSchema = z.enum(['synthetic_demo', 'local_assessment', 'external_supplied']);
export type BenchmarkSource = z.infer<typeof benchmarkSourceSchema>;

export const benchmarkRecordSchema = z.object({
  id: z.string(),
  source: benchmarkSourceSchema,
  sector: z.string(),
  orgType: z.string(),
  sizeCategory: z.string(),
  period: z.string(),
  /** 12 dimension scores on 0–100 in canonical dimension order (S,G,D,T,U,H,R,C,V,I,O,F). */
  dimensionScores: z.array(z.number().min(0).max(100)).length(12),
  maturityIndex: z.number().min(0).max(100),
  riskGovernance: z.number().min(0).max(100),
  valueRealization: z.number().min(0).max(100),
  label: z.string().optional(),
});
export type BenchmarkRecord = z.infer<typeof benchmarkRecordSchema>;

export const externalBenchmarkFileSchema = z.object({
  provenance: z.object({
    publisher: z.string().min(1),
    methodology: z.string().min(1),
    collectedOn: z.string().min(1),
    sampleDescription: z.string().default(''),
  }),
  records: z.array(benchmarkRecordSchema.omit({ source: true })).min(1),
});
export type ExternalBenchmarkFile = z.infer<typeof externalBenchmarkFileSchema>;

export const assessorProfileSchema = z.object({
  name: z.string().default('Demo Assessor'),
  role: z.string().default('Lead Assessor'),
  firm: z.string().default('Primus Partners'),
});
export type AssessorProfile = z.infer<typeof assessorProfileSchema>;
