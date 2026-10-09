/**
 * India-specific diagnostics (source §6). Area names and diagnostic questions are
 * verbatim from the source (via the generated module). The hints are product guidance
 * only — this section is a diagnostic, not a legal opinion.
 */
import { SOURCE_SPEC } from './sourceSpec.generated';

export interface IndiaDiagnosticSpec {
  id: string; // IN01..IN10
  area: string;
  question: string;
  /** Prompts for the assessor. Informational; not statements of law. */
  prompts: string[];
  /** Organization types for which the area is most commonly relevant (a hint, never an automatic N/A). */
  usuallyRelevantTo: string[];
}

const PROMPTS: Record<string, { prompts: string[]; relevant: string[] }> = {
  'Indian privacy framework': {
    prompts: ['Which personal data does AI processing touch, and under what lawful basis?', 'Is there a record of which provisions have commenced and been mapped to AI use cases at the assessment date?', 'Who owns data-principal rights handling for AI systems?'],
    relevant: ['all'],
  },
  'Sector regulation': {
    prompts: ['Which regulators supervise the organization (e.g. RBI, SEBI, IRDAI, health, telecom)?', 'Are model-risk, outsourcing and customer-protection expectations reflected in AI approvals?'],
    relevant: ['private_enterprise', 'gcc', 'psu'],
  },
  'IndiaAI ecosystem': {
    prompts: ['Has the organization reviewed publicly available IndiaAI Mission compute, datasets or model initiatives for fit?', 'Are there ecosystem partners (academia, startups, incubators) in the AI plan?'],
    relevant: ['all'],
  },
  'Indian languages': {
    prompts: ['Which Indian languages do employees, customers or citizens use?', 'How is accuracy tested per language and script, including code-mixed input?'],
    relevant: ['government', 'psu', 'private_enterprise', 'msme'],
  },
  'Digital Public Infrastructure': {
    prompts: ['Which DPI services (Aadhaar, UPI, DigiLocker, Account Aggregator, others) are relevant to the service?', 'Are consent, security and authorization requirements for each integration documented?'],
    relevant: ['private_enterprise', 'government', 'psu'],
  },
  'Data sovereignty': {
    prompts: ['Where are training, fine-tuning, inference and log data stored and processed?', 'Which contracts or sector rules restrict cross-border transfer or require local processing?'],
    relevant: ['all'],
  },
  'Indian workforce': {
    prompts: ['Are training materials available in the languages staff work in?', 'Is training matched to varying digital-literacy levels, including frontline staff?'],
    relevant: ['all'],
  },
  'MSME readiness': {
    prompts: ['Is the total cost of ownership affordable on current margins?', 'Can the solution be maintained without scarce specialist skills (vendor lock-in, support model)?'],
    relevant: ['msme'],
  },
  'Public-sector applicability': {
    prompts: ['Has citizen impact (including exclusion risk) been assessed before deployment?', 'Are decisions explainable and is there a grievance route?'],
    relevant: ['government', 'psu'],
  },
  'Accessibility': {
    prompts: ['Have AI interfaces been tested with assistive technologies?', 'Are there alternatives for users without smartphones, connectivity or literacy in the primary language?'],
    relevant: ['all'],
  },
};

export const INDIA_DIAGNOSTICS: readonly IndiaDiagnosticSpec[] = SOURCE_SPEC.india.map((row, i) => ({
  id: `IN${String(i + 1).padStart(2, '0')}`,
  area: row.area,
  question: row.question,
  prompts: PROMPTS[row.area]?.prompts ?? [],
  usuallyRelevantTo: PROMPTS[row.area]?.relevant ?? ['all'],
}));

export const INDIA_BY_ID: Record<string, IndiaDiagnosticSpec> = Object.fromEntries(
  INDIA_DIAGNOSTICS.map((d) => [d.id, d]),
);

export const INDIA_SOURCE_NOTE =
  'These supplementary questions should be scored separately or incorporated into the core index through a documented sector-specific methodology. Compliance assessments should reflect laws and rules actually in force at the assessment date.';

export const INDIA_DISCLAIMER =
  'This section is a diagnostic aid, not a legal opinion. It does not state or interpret what laws or rules apply to a particular organization. Regulatory position must be confirmed by qualified counsel as at the assessment date recorded below.';
