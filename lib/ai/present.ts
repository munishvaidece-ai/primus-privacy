// Turns a stored suggestion into plain-language lines for the screens.
// Pure and dependency-free so it can be tested and used anywhere.
import type { RiskTier, SuggestionKind } from "./types";

const LABELS: Record<string, string> = {
  decision: "Decision",
  rationale: "Reason",
  reviewRationale: "Reason",
  quality: "Quality",
  rating: "Rating",
  severity: "Severity",
  title: "Title",
  description: "Description",
  headline: "Headline",
  narrative: "Report summary",
  summary: "Summary",
  steps: "Steps",
  dueAt: "Reply due by",
  boardReportDueAt: "Report to the Board due by",
  draftResponse: "Draft reply",
  boardNoticeDraft: "Notice to the Data Protection Board",
  principalNoticeDraft: "Notice to affected people",
  verdict: "Verdict",
  issues: "Issues found",
  recommendation: "Recommendation",
  riskLevel: "Risk level",
  concerns: "Concerns",
  actions: "Suggested actions",
  likelihood: "Likelihood",
  impact: "Impact",
};

const FIRST = ["decision", "rating", "verdict", "recommendation", "severity", "riskLevel", "headline", "title", "summary", "rationale", "reviewRationale", "issues", "concerns", "steps", "actions", "dueAt", "boardReportDueAt", "description", "narrative", "draftResponse", "boardNoticeDraft", "principalNoticeDraft"];

export const humanise = (k: string) =>
  LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

export interface Line { key: string; label: string; value: string; long: boolean }

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 16).replace("T", " ") + " UTC";
    return v.replace(/_/g, " ");
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x) => `• ${asText(x)}`).join("\n");
  return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${humanise(k)}: ${asText(x)}`).join("; ");
}

export function describeProposal(kind: SuggestionKind | string, proposed: Record<string, unknown>, hideTexts: string[] = []): Line[] {
  const keys = Object.keys(proposed).filter((k) => !/(^|[a-z])Ids?$/.test(k) && k !== "kind" && k !== "by" && proposed[k] !== null && proposed[k] !== "");
  keys.sort((a, b) => {
    const ia = FIRST.indexOf(a), ib = FIRST.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return keys
    .map((k) => {
      const value = asText(proposed[k]);
      return { key: k, label: humanise(k), value, long: value.length > 140 || value.includes("\n") };
    })
    .filter((l) => !hideTexts.includes(l.value));
}

export const percent = (n: number | string) => `${Math.round(Number(n) * 100)}%`;

export function confidenceWord(n: number | string): string {
  const c = Number(n);
  return c >= 0.9 ? "very confident" : c >= 0.75 ? "confident" : c >= 0.6 ? "unsure" : "low confidence";
}

export const TIER_WORDS: Record<RiskTier, string> = { low: "Low stakes", medium: "Medium stakes", high: "High stakes", critical: "Critical" };

export const JOB_LABELS: Record<string, string> = {
  plan: "Looking for work to do",
  evidence_review: "Reading evidence",
  applicability: "Deciding which controls apply",
  rating: "Rating controls",
  finding_create: "Writing findings",
  report_issue: "Preparing the final report",
  ops_case: "Triaging cases",
  connector_test: "Testing a connector",
  connector_scan: "Scanning a connector",
};

export const SOURCE_WORDS: Record<string, string> = {
  auto_applied: "Done by the AI under autopilot",
  approved: "Approved by a person",
  overridden: "Changed by a person",
  rejected: "Rejected by a person",
  pending_review: "Waiting for a person",
  failed: "Could not be applied",
  superseded: "Replaced by a newer suggestion",
};
