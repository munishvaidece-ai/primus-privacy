// Report: the executive narrative for the final report.
import { z } from "zod";
import type { TaskDef } from "../engine";
import type { SuggestionDraft } from "../types";
import { inputHash } from "../text";

export interface ReportInput {
  assessmentId: string;
  organisationName: string;
  engagementName: string;
  periodLabel: string;
  controlsTotal: number;
  implemented: number;
  partial: number;
  notImplemented: number;
  notApplicable: number;
  notAssessed: number;
  findingsBySeverity: Record<"low" | "medium" | "high" | "critical", number>;
  openRemediation: number;
  maturityScore: string | null;
}

export const reportOutput = z.object({
  headline: z.string().min(5).max(200),
  narrative: z.string().min(40).max(4000),
  confidence: z.number().min(0).max(1),
});
export type ReportOutput = z.infer<typeof reportOutput>;

export function offlineReport(i: ReportInput): ReportOutput {
  const assessed = i.implemented + i.partial + i.notImplemented;
  const pct = assessed ? Math.round((i.implemented / assessed) * 100) : 0;
  const f = i.findingsBySeverity;
  const totalFindings = f.low + f.medium + f.high + f.critical;
  const tone = f.critical > 0 ? "requires urgent attention" : f.high > 0 ? "shows significant gaps" : pct >= 80 ? "is in good shape" : "has room to improve";
  const headline = `${i.organisationName}: ${pct}% of assessed controls fully implemented, ${totalFindings} finding(s)`;
  const lines = [
    `This report summarises the ${i.periodLabel} DPDP compliance assessment of ${i.organisationName} (${i.engagementName}).`,
    `Of ${i.controlsTotal} controls in scope, ${assessed} were assessed: ${i.implemented} implemented, ${i.partial} partially implemented and ${i.notImplemented} not implemented${i.notApplicable ? `; ${i.notApplicable} were found not applicable` : ""}${i.notAssessed ? `; ${i.notAssessed} remain not assessed` : ""}.`,
    totalFindings
      ? `${totalFindings} finding(s) were raised: ${f.critical} critical, ${f.high} high, ${f.medium} medium and ${f.low} low. ${i.openRemediation} remediation action(s) remain open.`
      : "No findings were raised.",
    i.maturityScore ? `The computed maturity score is ${i.maturityScore}.` : "A maturity score has not yet been computed.",
    `Overall, the programme ${tone}.`,
  ];
  return { headline, narrative: lines.join(" "), confidence: 0.9 };
}

export const reportTask: TaskDef<ReportInput, ReportOutput> = {
  kind: "report_issue",
  outputSchema: reportOutput,
  offline: offlineReport,
  maxTokens: 1500,
  system:
    "You write the executive summary of a DPDP (India) compliance assessment report for a client's leadership. Use only the numbers provided; never add figures, dates or claims that are not in the input. " +
    "Fields: headline (one line), narrative (one to three short paragraphs of plain language), confidence (0..1).",
  prompt(i) {
    return `Organisation: ${i.organisationName}\nEngagement: ${i.engagementName}\nPeriod: ${i.periodLabel}\nControls in scope: ${i.controlsTotal}\nImplemented: ${i.implemented}\nPartially implemented: ${i.partial}\nNot implemented: ${i.notImplemented}\nNot applicable: ${i.notApplicable}\nNot assessed: ${i.notAssessed}\nFindings: critical ${i.findingsBySeverity.critical}, high ${i.findingsBySeverity.high}, medium ${i.findingsBySeverity.medium}, low ${i.findingsBySeverity.low}\nOpen remediation actions: ${i.openRemediation}\nMaturity score: ${i.maturityScore ?? "not computed"}`;
  },
};

export function reportDraft(i: ReportInput, o: ReportOutput): SuggestionDraft {
  return {
    kind: "report_issue",
    subjectType: "assessment",
    subjectId: i.assessmentId,
    title: `Issue final report: ${i.organisationName} ${i.periodLabel}`,
    summary: o.headline,
    proposed: { headline: o.headline, narrative: o.narrative, assessmentId: i.assessmentId },
    rationale: "Executive summary generated from the finalized assessment's recorded figures.",
    citations: [],
    confidence: o.confidence,
    tier: "high",
    inputHash: inputHash({ k: "report", a: i.assessmentId, n: [i.implemented, i.partial, i.notImplemented, i.notApplicable, i.notAssessed], f: i.findingsBySeverity, r: i.openRemediation, m: i.maturityScore }),
  };
}
