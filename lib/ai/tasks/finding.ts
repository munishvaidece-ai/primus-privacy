// Finding: turns a weak rating into a risk and a finding with a remediation.
import { z } from "zod";
import type { TaskDef } from "../engine";
import type { RiskTier, SuggestionDraft } from "../types";
import { inputHash } from "../text";

export interface FindingInput {
  assessmentId: string;
  assessmentControlId: string;
  controlId: string;
  control: { code: string; title: string; description: string | null; tier: RiskTier };
  rating: "partially_implemented" | "not_implemented";
  ratingRationale: string | null;
  ratingConfidence: number;
}

export const findingOutput = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(10).max(3000),
  severity: z.enum(["low", "medium", "high", "critical"]),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  recommendedAction: z.string().min(5).max(1500),
  confidence: z.number().min(0).max(1),
});
export type FindingOutput = z.infer<typeof findingOutput>;

const SEVERITY_GRID: Record<RiskTier, Record<"not_implemented" | "partially_implemented", FindingOutput["severity"]>> = {
  critical: { not_implemented: "critical", partially_implemented: "high" },
  high: { not_implemented: "high", partially_implemented: "medium" },
  medium: { not_implemented: "medium", partially_implemented: "low" },
  low: { not_implemented: "low", partially_implemented: "low" },
};
const LI: Record<FindingOutput["severity"], [number, number]> = { low: [2, 2], medium: [3, 3], high: [4, 4], critical: [4, 5] };

/** Simple, transparent banding of likelihood × impact (see DECISIONS.md R-187). */
export function bandRating(likelihood: number, impact: number): FindingOutput["severity"] {
  const s = likelihood * impact;
  return s <= 4 ? "low" : s <= 9 ? "medium" : s <= 16 ? "high" : "critical";
}

export function offlineFinding(i: FindingInput): FindingOutput {
  const severity = SEVERITY_GRID[i.control.tier][i.rating];
  const [likelihood, impact] = LI[severity];
  const gap = i.rating === "not_implemented" ? "is not in place" : "is only partly in place";
  return {
    title: `${i.control.title} ${gap}`.slice(0, 200),
    description: `Control ${i.control.code} (${i.control.title}) ${gap}. ${i.ratingRationale ?? ""}`.trim(),
    severity,
    likelihood,
    impact,
    recommendedAction:
      i.rating === "not_implemented"
        ? `Design and implement the control "${i.control.title}", assign an owner, and provide evidence of operation.`
        : `Close the gaps in "${i.control.title}": complete the missing elements, document them, and provide evidence of operation.`,
    confidence: Math.min(0.9, Math.max(0.5, i.ratingConfidence)),
  };
}

export const findingTask: TaskDef<FindingInput, FindingOutput> = {
  kind: "finding_create",
  outputSchema: findingOutput,
  offline: offlineFinding,
  system:
    "You write one audit finding for a DPDP (India) control that is not fully implemented. Severity reflects how much harm the gap could cause to data principals and the fiduciary (low|medium|high|critical). " +
    "likelihood and impact are integers 1-5. Be specific and factual; do not invent facts that are not in the rating rationale. Fields: title, description, severity, likelihood, impact, recommendedAction, confidence (0..1).",
  prompt(i) {
    return `CONTROL ${i.control.code}: ${i.control.title}\n${i.control.description ?? ""}\nRATING: ${i.rating}\nWHY: ${i.ratingRationale ?? "n/a"}\nCONTROL RISK TIER: ${i.control.tier}`;
  },
};

export function findingDraft(i: FindingInput, o: FindingOutput): SuggestionDraft {
  const inherentRating = bandRating(o.likelihood, o.impact);
  return {
    kind: "finding_create",
    subjectType: "assessment_control",
    subjectId: i.assessmentControlId,
    title: `Finding (${o.severity}): ${o.title}`,
    summary: o.description,
    proposed: {
      title: o.title,
      description: o.description,
      severity: o.severity,
      likelihood: o.likelihood,
      impact: o.impact,
      inherentRating,
      recommendedAction: o.recommendedAction,
      assessmentId: i.assessmentId,
      controlId: i.controlId,
      controlCode: i.control.code,
    },
    rationale: `Control ${i.control.code} rated ${i.rating.replace(/_/g, " ")}. ${i.ratingRationale ?? ""}`.trim(),
    citations: [],
    confidence: o.confidence,
    tier: i.control.tier,
    inputHash: inputHash({ k: "finding", a: i.assessmentControlId, r: i.rating, c: i.control.code }),
  };
}
