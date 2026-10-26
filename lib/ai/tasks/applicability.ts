// Applicability: is this control in scope for this client?
// DPDP obligations apply to every Data Fiduciary by default, so the engine
// only marks a control "not applicable" on positive evidence from the
// client's own data landscape — and says what that evidence was.
import { z } from "zod";
import type { Actor } from "../provenance";
import type { TaskDef } from "../engine";
import type { RiskTier, SuggestionDraft } from "../types";
import { inputHash } from "../text";
import { sectorOfControl, sectorByKey, type SectorKey } from "../../regulation";

export interface LandscapeProfile {
  activities: number;
  principalCategories: string[];
  dataElements: string[];
  hasProcessors: boolean;
  crossBorderHints: boolean;
  childrenHints: boolean;
  /** Who entered the data-landscape records (for the evidence trail only). */
  contributors?: Actor[];
  /** Sectors the people on the engagement chose (Regulations page). Undefined or empty = none chosen yet. */
  sectors?: SectorKey[];
  /** Who chose the sectors, for the evidence trail. */
  sectorChosenBy?: Actor[];
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
  /** "sector" when the decision follows the sectors people chose, not a judgement about the client's data. */
  basis: z.enum(["landscape", "sector"]).optional(),
});
export type ApplicabilityOutput = z.infer<typeof applicabilityOutput>;

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

export function offlineApplicability(i: ApplicabilityInput): ApplicabilityOutput {
  const text = `${i.control.title} ${i.control.description ?? ""}`.toLowerCase();
  const p = i.profile;
  const controlSector = sectorOfControl(i.control.code);
  if (controlSector !== null && controlSector !== "all") {
    const label = sectorByKey(controlSector)?.label ?? controlSector;
    const chosen = p.sectors ?? [];
    if (chosen.includes(controlSector)) {
      return {
        decision: "applicable",
        confidence: 0.95,
        basis: "sector",
        rationale: `This is a ${label} rule. The engagement's sectors include ${label}, so it applies on top of the DPDP controls.`,
      };
    }
    if (chosen.length === 0) {
      return {
        decision: "not_applicable",
        confidence: 0.6,
        basis: "sector",
        rationale: `This is a ${label} rule, but no sector has been chosen for this engagement yet. Left out until a person picks the client's sector(s) on the Regulations page.`,
        needsHuman: "no sector has been chosen for this engagement, so the AI cannot tell whether sector rules apply",
      };
    }
    const names = chosen.map((k) => sectorByKey(k)?.label ?? k).join(", ");
    return {
      decision: "not_applicable",
      confidence: 0.95,
      basis: "sector",
      rationale: `This is a ${label} rule. The engagement's sectors are ${names}, which do not include ${label}, so the rule is out of scope. It follows the sector choice made by the team, not a view on the client's data.`,
    };
  }
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
    "Controls whose code starts with a sector prefix (BRK, BNK, INS, HLT, TEL, ECM, OTT, AVI, AIA, EDU, MSM, GVT) apply only if that sector was chosen for the engagement. " +
    "Fields: decision (applicable | not_applicable), confidence (0..1), rationale, needsHuman (optional string: set when only a person can decide).",
  prompt(i) {
    const p = i.profile;
    return `CONTROL ${i.control.code}: ${i.control.title}\n${i.control.description ?? ""}\n\nCLIENT DATA LANDSCAPE SUMMARY:\n- processing activities recorded: ${p.activities}\n- data principal categories: ${p.principalCategories.join(", ") || "none"}\n- personal data elements: ${p.dataElements.slice(0, 40).join(", ") || "none"}\n- processors recorded: ${p.hasProcessors ? "yes" : "no"}\n- children's data indicated: ${p.childrenHints ? "yes" : "no"}\n- overseas transfers indicated: ${p.crossBorderHints ? "yes" : "no"}\n- sectors chosen for the engagement: ${(p.sectors ?? []).join(", ") || "none yet"}`;
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
    tier: o.basis === "sector" ? "low" : o.decision === "not_applicable" ? (i.control.tier === "low" ? "medium" : "high") : "low",
    needsHuman: o.needsHuman,
    inputHash: inputHash({ k: "applicability", s: i.engagementScopeControlId, p: i.profile }),
  };
}
