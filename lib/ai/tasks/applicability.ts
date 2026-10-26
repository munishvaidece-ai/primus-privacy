// Applicability: is this control in scope for this client?
// DPDP obligations apply to every Data Fiduciary by default, so the engine
// only marks a control "not applicable" on positive evidence from the
// client's own data landscape — and says what that evidence was.
import { z } from "zod";
import type { TaskDef } from "../engine";
import type { RiskTier, SuggestionDraft } from "../types";
import { inputHash } from "../text";

export interface LandscapeProfile {
  activities: number;
  principalCategories: string[];
  dataElements: string[];
  hasProcessors: boolean;
  crossBorderHints: boolean;
  childrenHints: boolean;
}

export interface ApplicabilityInput {
  engagementScopeControlId: string;
  control: { code: string; title: string; description: string | null; tier: RiskTier };
  profile: LandscapeProfile;
}

export const applicabilityOutput = z.object({
  decision: z.enum(["applicable", "not_applicable"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(5).max(1500),
  needsHuman: z.string().optional(),
});
export type ApplicabilityOutput = z.infer<typeof applicabilityOutput>;

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

export function offlineApplicability(i: ApplicabilityInput): ApplicabilityOutput {
  const text = `${i.control.title} ${i.control.description ?? ""}`.toLowerCase();
  const p = i.profile;
  if (p.activities === 0) {
    return {
      decision: "applicable",
      confidence: 0.85,
      rationale:
        "The client's data landscape is empty so nothing can rule this control out. DPDP obligations apply to every Data Fiduciary by default, and keeping a control in scope is the conservative choice; applicable pending discovery.",
    };
  }
  if (has(text, "child", "minor", "parental") && !p.childrenHints) {
    return {
      decision: "not_applicable",
      confidence: 0.82,
      rationale: `This control is about children's data. None of the ${p.activities} recorded processing activities involves children or minors (data principal categories: ${p.principalCategories.join(", ") || "none recorded"}). Not applicable unless discovery finds children's data.`,
    };
  }
  if (has(text, "cross-border", "cross border", "overseas", "outside india", "transfer outside") && !p.crossBorderHints) {
    return {
      decision: "not_applicable",
      confidence: 0.72,
      rationale: `This control covers transfers outside India. None of the ${p.activities} recorded processing activities mentions an overseas transfer or recipient.`,
    };
  }
  if (has(text, "significant data fiduciary", "sdf")) {
    return {
      decision: "applicable",
      confidence: 0.5,
      rationale: "Whether this client is a Significant Data Fiduciary is a Government notification, not something the AI can determine from records.",
      needsHuman: "only a person can confirm whether the client has been notified as a Significant Data Fiduciary",
    };
  }
  if (has(text, "processor", "vendor", "third part") && !p.hasProcessors) {
    return {
      decision: "applicable",
      confidence: 0.6,
      rationale: "No processors are recorded in the landscape yet, but vendors are rarely absent entirely; kept applicable until a person confirms.",
      needsHuman: "no processors are recorded, so the AI cannot tell whether vendor controls apply",
    };
  }
  return {
    decision: "applicable",
    confidence: 0.93,
    rationale: "No exemption or scope limit applies: DPDP obligations apply to every Data Fiduciary by default and nothing in the client's data landscape rules this control out.",
  };
}

export const applicabilityTask: TaskDef<ApplicabilityInput, ApplicabilityOutput> = {
  kind: "applicability",
  outputSchema: applicabilityOutput,
  offline: offlineApplicability,
  system:
    "You decide whether a DPDP (India) compliance control applies to a client, using only the client's data-landscape summary. " +
    "DPDP obligations apply to every Data Fiduciary by default: mark a control not_applicable ONLY if the summary gives positive evidence that its subject matter does not occur, and say what that evidence is. " +
    "Fields: decision (applicable | not_applicable), confidence (0..1), rationale, needsHuman (optional string: set when only a person can decide).",
  prompt(i) {
    const p = i.profile;
    return `CONTROL ${i.control.code}: ${i.control.title}\n${i.control.description ?? ""}\n\nCLIENT DATA LANDSCAPE SUMMARY:\n- processing activities recorded: ${p.activities}\n- data principal categories: ${p.principalCategories.join(", ") || "none"}\n- personal data elements: ${p.dataElements.slice(0, 40).join(", ") || "none"}\n- processors recorded: ${p.hasProcessors ? "yes" : "no"}\n- children's data indicated: ${p.childrenHints ? "yes" : "no"}\n- overseas transfers indicated: ${p.crossBorderHints ? "yes" : "no"}`;
  },
};

export function applicabilityDraft(i: ApplicabilityInput, o: ApplicabilityOutput): SuggestionDraft {
  return {
    kind: "applicability",
    subjectType: "engagement_scope_control",
    subjectId: i.engagementScopeControlId,
    title: `${o.decision === "applicable" ? "Applicable" : "Not applicable"}: ${i.control.code} ${i.control.title}`,
    summary: o.rationale,
    proposed: { decision: o.decision, rationale: o.rationale },
    rationale: o.rationale,
    citations: [],
    confidence: o.confidence,
    // A wrong "not applicable" removes a control from the assessment, so it
    // is treated one tier higher than the control's own.
    tier: o.decision === "not_applicable" ? (i.control.tier === "low" ? "medium" : "high") : "low",
    needsHuman: o.needsHuman,
    inputHash: inputHash({ k: "applicability", s: i.engagementScopeControlId, p: i.profile }),
  };
}
