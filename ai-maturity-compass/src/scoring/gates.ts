/**
 * Risk-based maturity gates (source §9: "Apply risk-based scoring gates").
 *
 * These are ADVISORY policy rules. When a critical security, privacy or responsible-AI control
 * is deficient on the assessor-verified basis, the overall classification is flagged for review
 * and an advisory ceiling is proposed. The ceiling only takes effect when an assessor confirms
 * it (GateDecision). Nothing here is applied silently.
 */
import { CLASSIFICATION_BY_ID, DIMENSION_BY_ID, QUESTION_BY_ID, type Classification, type DimensionId, type ScoringConfig } from '../data/spec';
import type { EvidenceStatus, GateDecision, Response, Score } from '../domain/schema';
import { evalQuestion } from './questionState';

export type ControlSeverity = 'deficient' | 'self_reported_deficient' | 'unverified' | 'ok' | 'not_applicable';

export interface CriticalControl {
  questionId: string;
  gateId: string;
  gateName: string;
  dimensionId: DimensionId;
  text: string;
  verifiedScore: Score | null;
  selfScore: Score | null;
  evidenceStatus: EvidenceStatus;
  severity: ControlSeverity;
}

export type GateStatus = 'disabled' | 'not_triggered' | 'review_required' | 'confirmed' | 'overridden';

export interface GateResult {
  enabled: boolean;
  threshold: Score;
  controls: CriticalControl[];
  /** Verified-basis deficiencies — these trigger the gate. */
  deficiencies: CriticalControl[];
  /** Self-reported deficiencies not yet verified — a watch list, not a trigger. */
  selfReportedDeficiencies: CriticalControl[];
  /** Critical controls with no assessor-verified answer. */
  unverified: CriticalControl[];
  triggered: boolean;
  ceiling: Classification;
  ceilingApplies: boolean;
  indexClassification: Classification | null;
  /** What the classification would be if the ceiling were applied. */
  advisoryClassification: Classification | null;
  decision: GateDecision;
  /** Classification to present as "overall": ceiling only after an assessor has confirmed it. */
  finalClassification: Classification | null;
  status: GateStatus;
  explanation: string[];
}

export function criticalQuestionIds(config: Pick<ScoringConfig, 'gates'>): Set<string> {
  return new Set(config.gates.rules.flatMap((r) => r.questionIds));
}

export function evaluateGates(
  responses: Record<string, Response>,
  config: Pick<ScoringConfig, 'gates'>,
  indexClassification: Classification | null,
  decision: GateDecision,
): GateResult {
  const { gates } = config;
  const ceiling = CLASSIFICATION_BY_ID[gates.ceiling];
  const controls: CriticalControl[] = [];
  const seen = new Set<string>();

  for (const rule of gates.rules) {
    for (const qid of rule.questionIds) {
      const key = `${rule.id}:${qid}`;
      if (seen.has(key) || !responses[qid]) continue;
      seen.add(key);
      const r = responses[qid];
      const ver = evalQuestion(r, 'verified');
      const self = evalQuestion(r, 'self');
      let severity: ControlSeverity;
      if (ver.state === 'not_applicable') severity = 'not_applicable';
      else if (ver.state === 'scored') severity = (ver.score as number) <= gates.deficiencyThreshold ? 'deficient' : 'ok';
      else if (self.state === 'scored' && (self.score as number) <= gates.deficiencyThreshold) severity = 'self_reported_deficient';
      else severity = 'unverified';
      controls.push({
        questionId: qid,
        gateId: rule.id,
        gateName: rule.name,
        dimensionId: QUESTION_BY_ID[qid].dimensionId,
        text: QUESTION_BY_ID[qid].text,
        verifiedScore: ver.state === 'scored' ? ver.score : null,
        selfScore: self.state === 'scored' ? self.score : null,
        evidenceStatus: r.evidence.status,
        severity,
      });
    }
  }

  const deficiencies = controls.filter((c) => c.severity === 'deficient');
  const selfReportedDeficiencies = controls.filter((c) => c.severity === 'self_reported_deficient');
  const unverified = controls.filter((c) => c.severity === 'unverified' || c.severity === 'self_reported_deficient');
  const triggered = gates.enabled && deficiencies.length > 0;
  const ceilingApplies = triggered && indexClassification !== null && indexClassification.rank > ceiling.rank;
  const advisoryClassification = ceilingApplies ? ceiling : indexClassification;

  let status: GateStatus;
  if (!gates.enabled) status = 'disabled';
  else if (!triggered) status = 'not_triggered';
  else if (decision.status === 'confirmed') status = 'confirmed';
  else if (decision.status === 'overridden') status = 'overridden';
  else status = 'review_required';

  const finalClassification =
    status === 'confirmed' && ceilingApplies ? ceiling : indexClassification;

  const explanation: string[] = [];
  if (!gates.enabled) {
    explanation.push('Risk-based maturity gates are switched off for this assessment (Settings → Scoring policy).');
  } else if (!triggered) {
    explanation.push(
      unverified.length > 0
        ? `No critical control is verified as deficient. ${unverified.length} critical control${unverified.length > 1 ? 's are' : ' is'} not yet verified, so the gate cannot be cleared with confidence.`
        : 'No critical security, privacy or responsible-AI control is verified as deficient.',
    );
  } else {
    const ids = deficiencies.map((d) => d.questionId).join(', ');
    explanation.push(
      `${deficiencies.length} critical control${deficiencies.length > 1 ? 's are' : ' is'} verified at or below the deficiency threshold (score ≤ ${gates.deficiencyThreshold}): ${ids}.`,
    );
    explanation.push(
      ceilingApplies
        ? `The index classification (${indexClassification!.label}) is above the advisory ceiling of ${ceiling.label}. The classification is flagged for review.`
        : `The index classification is not above the advisory ceiling of ${ceiling.label}, so no change is proposed, but the deficiencies should still be remediated.`,
    );
    explanation.push('This is an advisory policy rule. It requires assessor confirmation before the ceiling is applied to the reported classification.');
    if (decision.status === 'confirmed') explanation.push(`Assessor confirmed the gate${decision.decidedBy ? ` (${decision.decidedBy})` : ''}.`);
    if (decision.status === 'overridden') explanation.push(`Assessor overrode the gate${decision.note ? `: ${decision.note}` : '.'}`);
  }

  return {
    enabled: gates.enabled,
    threshold: gates.deficiencyThreshold,
    controls,
    deficiencies,
    selfReportedDeficiencies,
    unverified,
    triggered,
    ceiling,
    ceilingApplies,
    indexClassification,
    advisoryClassification,
    decision,
    finalClassification,
    status,
    explanation,
  };
}

export const dimensionNameOf = (id: DimensionId): string => DIMENSION_BY_ID[id].name;
