/** Pre-submission checks. Pure function over the assessment so it can be tested and reused. */
import { QUESTIONS, DIMENSIONS } from '../data/spec';
import type { Assessment } from '../domain/schema';
import { evalQuestion } from './questionState';
import type { AssessmentResults } from './results';

export interface ReviewIssue {
  id: string;
  level: 'blocker' | 'warning' | 'info';
  title: string;
  detail: string;
  questionIds: string[];
}

export function reviewAssessment(a: Assessment, res: AssessmentResults): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const ids = (pred: (id: string) => boolean) => QUESTIONS.map((q) => q.id).filter(pred);
  const R = a.responses;

  const unanswered = ids((id) => R[id].self.state === 'unanswered');
  if (unanswered.length)
    issues.push({ id: 'unanswered', level: 'warning', title: `${unanswered.length} question${unanswered.length > 1 ? 's have' : ' has'} no self-reported answer`, detail: 'Unanswered questions are not scored as zero; they reduce coverage and keep dimensions provisional.', questionIds: unanswered });

  const dk = ids((id) => R[id].self.state === 'dont_know' || R[id].verified.state === 'not_verified');
  if (dk.length) issues.push({ id: 'dk', level: 'info', title: `${dk.length} question${dk.length > 1 ? 's are' : ' is'} marked Don't Know / Not Verified`, detail: 'Shown as evidence gaps in the dashboard and recommendations. They are never counted as zero maturity.', questionIds: dk });

  const awaiting = ids((id) => evalQuestion(R[id], 'verified').state === 'pending');
  if (awaiting.length) issues.push({ id: 'awaiting', level: 'warning', title: `${awaiting.length} applicable question${awaiting.length > 1 ? 's await' : ' awaits'} assessor verification`, detail: 'The headline index uses assessor-verified scores only, so these questions do not yet contribute to it.', questionIds: awaiting });

  const acceptedNoRef = ids((id) => R[id].evidence.status === 'accepted' && !R[id].evidence.reference.trim());
  if (acceptedNoRef.length) issues.push({ id: 'accepted-no-ref', level: 'blocker', title: 'Evidence marked Accepted without a reference', detail: 'An assessor can only accept evidence that is identified. Add the reference or change the status.', questionIds: acceptedNoRef });

  const strongNoEvidence = ids((id) => R[id].verified.state === 'scored' && (R[id].verified.score as number) >= 3 && !['accepted', 'reviewed'].includes(R[id].evidence.status));
  if (strongNoEvidence.length) issues.push({ id: 'strong-no-evidence', level: 'warning', title: `${strongNoEvidence.length} verified score${strongNoEvidence.length > 1 ? 's' : ''} of 3 or 4 without reviewed evidence`, detail: 'High verified scores should be supported by evidence the assessor has reviewed.', questionIds: strongNoEvidence });

  const rejected = ids((id) => ['rejected', 'clarification'].includes(R[id].evidence.status));
  if (rejected.length) issues.push({ id: 'evidence-open', level: 'warning', title: `${rejected.length} item${rejected.length > 1 ? 's have' : ' has'} rejected or clarification-required evidence`, detail: 'Resolve these or revise the verified scores.', questionIds: rejected });

  const gap2 = ids((id) => R[id].self.state === 'scored' && R[id].verified.state === 'scored' && Math.abs((R[id].self.score as number) - (R[id].verified.score as number)) >= 2);
  if (gap2.length) issues.push({ id: 'gap2', level: 'info', title: `${gap2.length} question${gap2.length > 1 ? 's differ' : ' differs'} by two or more points between self-reported and verified`, detail: 'Make sure the assessor observation explains the difference.', questionIds: gap2 });

  const naUnconfirmed = ids((id) => R[id].self.state === 'not_applicable' && R[id].verified.state === 'pending');
  if (naUnconfirmed.length) issues.push({ id: 'na-unconfirmed', level: 'warning', title: `${naUnconfirmed.length} self-declared Not Applicable question${naUnconfirmed.length > 1 ? 's' : ''} not yet confirmed by an assessor`, detail: 'They are excluded from the denominators but should be confirmed.', questionIds: naUnconfirmed });

  if (res.gates.enabled && res.gates.unverified.length)
    issues.push({ id: 'critical-unverified', level: 'warning', title: `${res.gates.unverified.length} critical control${res.gates.unverified.length > 1 ? 's' : ''} without a verified score`, detail: 'The risk-based maturity gate cannot be cleared with confidence until these are verified.', questionIds: res.gates.unverified.map((c) => c.questionId) });
  if (res.gates.triggered && res.gates.status === 'review_required')
    issues.push({ id: 'gate-review', level: 'warning', title: 'Maturity gate needs an assessor decision', detail: 'Critical control deficiencies flag the classification for review. Confirm or override the advisory ceiling on the Risk & Governance page.', questionIds: res.gates.deficiencies.map((c) => c.questionId) });

  const insufficient = res.maturity.dimensions.filter((d) => !d.sufficient);
  if (insufficient.length)
    issues.push({ id: 'coverage', level: 'warning', title: `${insufficient.length} dimension${insufficient.length > 1 ? 's' : ''} below the verified-coverage threshold`, detail: `${insufficient.map((d) => d.shortName).join(', ')}. The index is provisional until coverage is sufficient.`, questionIds: [] });

  void DIMENSIONS;
  return issues;
}
