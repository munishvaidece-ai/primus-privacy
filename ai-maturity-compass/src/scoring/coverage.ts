/**
 * Evidence confidence and coverage. "Evidence provided" is deliberately kept apart from
 * "evidence reviewed" and "evidence accepted (verified)": text typed into a reference box is
 * a claim, not proof — only an assessor's recorded status upgrades it.
 */
import { DIMENSIONS, QUESTIONS } from '../data/spec';
import type { Response } from '../domain/schema';
import { evalQuestion } from './questionState';
import { scoreDimensions } from './maturity';

export interface EvidenceCoverage {
  totalQuestions: number;
  applicable: number;
  notApplicable: number;
  // Self-report
  selfAnswered: number;
  selfDontKnow: number;
  selfNotApplicable: number;
  selfUnanswered: number;
  // Evidence
  withReference: number;
  reviewed: number;
  accepted: number;
  rejected: number;
  clarification: number;
  /** Applicable questions with no evidence reference at all. */
  missingEvidence: number;
  // Verification
  verifiedScored: number;
  awaitingAssessment: number;
  /** Questions marked Don't Know (self) or Not Verified (assessor) — an evidence gap, never zero. */
  dontKnowNotVerified: number;
  assessorNotVerified: number;
  // Dimension sufficiency
  sufficientDimensions: number;
  totalDimensions: number;
  // Confidence
  verifiedWithAcceptedEvidence: number;
  /** Share of verified scores backed by accepted evidence (null if no verified scores). */
  evidenceBackedShare: number | null;
  /** Share of applicable questions with accepted evidence. */
  acceptedShare: number | null;
  /** Share of applicable questions on which the assessor has taken a position (scored or not verified). */
  reviewCompletion: number | null;
  confidence: 'high' | 'moderate' | 'low' | 'very_low' | 'none';
}

const isRef = (r: Response) => r.evidence.reference.trim().length > 0;

export function computeCoverage(responses: Record<string, Response>, minDimensionCoverage: number): EvidenceCoverage {
  let notApplicable = 0, selfAnswered = 0, selfDontKnow = 0, selfNotApplicable = 0, selfUnanswered = 0;
  let withReference = 0, reviewed = 0, accepted = 0, rejected = 0, clarification = 0, missingEvidence = 0;
  let verifiedScored = 0, awaiting = 0, dkNv = 0, assessorNv = 0, backed = 0, applicable = 0;
  let acceptedApplicable = 0, positioned = 0;

  for (const q of QUESTIONS) {
    const r = responses[q.id];
    const ver = evalQuestion(r, 'verified');
    if (r.self.state === 'scored') selfAnswered++;
    else if (r.self.state === 'dont_know') selfDontKnow++;
    else if (r.self.state === 'not_applicable') selfNotApplicable++;
    else selfUnanswered++;

    if (ver.state === 'not_applicable') {
      notApplicable++;
      continue;
    }
    applicable++;
    if (isRef(r)) withReference++;
    else missingEvidence++;
    const st = r.evidence.status;
    if (st === 'reviewed' || st === 'accepted' || st === 'rejected' || st === 'clarification') reviewed++;
    if (st === 'accepted') {
      accepted++;
      acceptedApplicable++;
    }
    if (st === 'rejected') rejected++;
    if (st === 'clarification') clarification++;

    if (ver.state === 'scored') {
      verifiedScored++;
      positioned++;
      if (st === 'accepted') backed++;
    } else if (ver.state === 'unverified') {
      if (r.verified.state === 'not_verified') {
        positioned++;
        assessorNv++;
      }
    } else {
      awaiting++;
    }
    if (r.self.state === 'dont_know' || r.verified.state === 'not_verified') dkNv++;
  }

  const dims = scoreDimensions(responses, 'verified', { minDimensionCoverage });
  const acceptedShare = applicable > 0 ? acceptedApplicable / applicable : null;
  const confidence: EvidenceCoverage['confidence'] =
    acceptedShare === null ? 'none' : acceptedShare >= 0.75 ? 'high' : acceptedShare >= 0.5 ? 'moderate' : acceptedShare >= 0.25 ? 'low' : 'very_low';

  return {
    totalQuestions: QUESTIONS.length,
    applicable,
    notApplicable,
    selfAnswered,
    selfDontKnow,
    selfNotApplicable,
    selfUnanswered,
    withReference,
    reviewed,
    accepted,
    rejected,
    clarification,
    missingEvidence,
    verifiedScored,
    awaitingAssessment: awaiting,
    dontKnowNotVerified: dkNv,
    assessorNotVerified: assessorNv,
    sufficientDimensions: dims.filter((d) => d.sufficient).length,
    totalDimensions: DIMENSIONS.length,
    verifiedWithAcceptedEvidence: backed,
    evidenceBackedShare: verifiedScored > 0 ? backed / verifiedScored : null,
    acceptedShare,
    reviewCompletion: applicable > 0 ? positioned / applicable : null,
    confidence,
  };
}

export const CONFIDENCE_LABELS: Record<EvidenceCoverage['confidence'], string> = {
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
  very_low: 'Very low',
  none: 'No evidence',
};
