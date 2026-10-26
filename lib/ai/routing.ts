// Routing: decides whether an AI suggestion is applied by the autopilot or
// waits for a person. Pure and deterministic so it can be unit tested and
// explained to a client (DECISIONS.md R-184).
//
//   Level 1  Assist       — nothing is applied automatically.
//   Level 2  Supervised   — applied automatically only when confidence is at
//                           least the Supervised threshold AND the risk tier
//                           is low or medium.
//   Level 3  Full         — applied automatically when confidence is at least
//                           the Full threshold; a critical tier additionally
//                           needs 0.90.
//   Gates (if switched on) override every level.
import type { GateFlags, GateKey, AutopilotLevel, RiskTier, SuggestionKind } from "./types";

export interface RoutingInput {
  kind: SuggestionKind;
  proposed: Record<string, unknown>;
  confidence: number;
  tier: RiskTier;
  needsHuman?: string;
  level: AutopilotLevel;
  thresholdSupervised: number;
  thresholdFull: number;
  gates: GateFlags;
}

export interface RoutingDecision {
  mode: "auto_apply" | "queue";
  gate: GateKey | null;
  reason: string;
}

export function gateFor(kind: SuggestionKind, proposed: Record<string, unknown>, tier: RiskTier, gates: GateFlags): GateKey | null {
  if (kind === "evidence_review" && proposed.decision === "rejected" && tier === "critical" && gates.rejectCriticalEvidence) {
    return "reject_critical_evidence";
  }
  if (kind === "finding_create" && proposed.severity === "critical" && gates.releaseCriticalFindings) {
    return "release_critical_findings";
  }
  if (kind === "report_issue" && gates.issueFinalReport) return "issue_final_report";
  if (kind === "breach_notice" && gates.sendBreachNotices) return "send_breach_notices";
  return null;
}

export function route(input: RoutingInput): RoutingDecision {
  const gate = gateFor(input.kind, input.proposed, input.tier, input.gates);
  const pct = `${Math.round(input.confidence * 100)}%`;

  if (gate) {
    return { mode: "queue", gate, reason: `Sign-off gate: ${GATE_REASON[gate]}. Needs a person with release rights.` };
  }
  if (input.needsHuman) {
    return { mode: "queue", gate: null, reason: `The AI asked for a person: ${input.needsHuman}` };
  }
  if (input.level === 1) {
    return { mode: "queue", gate: null, reason: "Assist level: the AI prepares, a person applies." };
  }
  if (input.level === 2) {
    if (input.tier === "high" || input.tier === "critical") {
      return { mode: "queue", gate: null, reason: `Supervised level: ${input.tier}-risk work always goes to a person.` };
    }
    if (input.confidence < input.thresholdSupervised) {
      return {
        mode: "queue",
        gate: null,
        reason: `Confidence ${pct} is below the Supervised threshold of ${Math.round(input.thresholdSupervised * 100)}%.`,
      };
    }
    return { mode: "auto_apply", gate: null, reason: `Supervised level: confidence ${pct} is above threshold and risk is ${input.tier}.` };
  }
  const need = input.tier === "critical" ? Math.max(input.thresholdFull, 0.9) : input.thresholdFull;
  if (input.confidence < need) {
    return {
      mode: "queue",
      gate: null,
      reason: `Confidence ${pct} is below the ${input.tier === "critical" ? "critical-tier " : ""}threshold of ${Math.round(need * 100)}%.`,
    };
  }
  return { mode: "auto_apply", gate: null, reason: `Full autopilot: confidence ${pct} meets the ${Math.round(need * 100)}% threshold.` };
}

const GATE_REASON: Record<GateKey, string> = {
  reject_critical_evidence: "rejecting evidence on a critical control",
  release_critical_findings: "releasing a critical finding",
  issue_final_report: "issuing the final report",
  send_breach_notices: "sending a breach notice",
};
