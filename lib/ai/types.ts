// Shared types for the AI layer (DECISIONS.md R-182..R-190).
import { z } from "zod";

export type AutopilotLevel = 1 | 2 | 3;
export const LEVEL_NAMES: Record<AutopilotLevel, string> = { 1: "Assist", 2: "Supervised", 3: "Full autopilot" };

export type RiskTier = "low" | "medium" | "high" | "critical";

export const SUGGESTION_KINDS = [
  "applicability",
  "evidence_review",
  "rating",
  "finding_create",
  "report_issue",
  "rights_triage",
  "breach_assess",
  "breach_notice",
  "consent_review",
  "vendor_review",
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const KIND_LABELS: Record<SuggestionKind, string> = {
  applicability: "Applicability decision",
  evidence_review: "Evidence review",
  rating: "Control rating",
  finding_create: "Finding & risk",
  report_issue: "Final report",
  rights_triage: "Rights request triage",
  breach_assess: "Breach assessment",
  breach_notice: "Breach notice",
  consent_review: "Consent review",
  vendor_review: "Vendor review",
};

export type GateKey =
  | "reject_critical_evidence"
  | "release_critical_findings"
  | "issue_final_report"
  | "send_breach_notices";

export const GATE_LABELS: Record<GateKey, string> = {
  reject_critical_evidence: "Reject evidence on a critical control",
  release_critical_findings: "Release critical findings",
  issue_final_report: "Issue the final report",
  send_breach_notices: "Send breach notices",
};

export interface GateFlags {
  rejectCriticalEvidence: boolean;
  releaseCriticalFindings: boolean;
  issueFinalReport: boolean;
  sendBreachNotices: boolean;
}

export interface EngagementAiSettings {
  engagementId: string;
  organisationId: string;
  tenantId: string;
  enabled: boolean;
  level: AutopilotLevel;
  paused: boolean;
  thresholdSupervised: number;
  thresholdFull: number;
  gates: GateFlags;
  allowExternalAi: boolean;
}

export interface Citation {
  quote: string;
  locator?: string;
  verified: boolean;
}

/**
 * One thing the AI looked at to reach a suggestion. Stored with the suggestion
 * so a reviewer can always see what it read, where that came from and why it
 * was chosen.
 */
export interface Source {
  type: "document" | "evidence" | "control" | "test" | "response" | "record" | "questionnaire" | "case" | "summary";
  /** What it is, in plain words. */
  label: string;
  /** Where the data came from, in words (system, person, date). */
  origin: string;
  /** Who supplied it: the Primus team, the client organisation, or the system. */
  providedBy?: { name: string | null; side: "primus" | "client" | "system" };
  /** The screen or feature that fed it to the AI (e.g. "Client portal, Evidence centre upload"). */
  channel?: string;
  /** When it was supplied (ISO). */
  at?: string;
  /** Id of the underlying record, so the same item can be traced across outputs. */
  ref?: string;
  /** Why this was selected for this output. */
  why: string;
  /** Facts read from it. */
  detail?: string;
  /** Text actually read (personal identifiers masked), shortened. */
  excerpt?: string;
  /** Screen inside the product where the original can be opened. */
  link?: string;
}

/** What a task produces, ready to be routed and stored. */
export interface SuggestionDraft {
  kind: SuggestionKind;
  subjectType: string;
  subjectId: string | null;
  title: string;
  summary: string;
  proposed: Record<string, unknown>;
  rationale: string;
  citations: Citation[];
  /** The evidence trail (what was read, from where, why). */
  sources?: Source[];
  confidence: number;
  tier: RiskTier;
  /** The task itself is unsure and wants a person regardless of policy. */
  needsHuman?: string;
  inputHash: string;
}

export const confidenceSchema = z.number().min(0).max(1);
