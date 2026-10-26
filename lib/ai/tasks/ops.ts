// Operating-flow tasks: rights requests, breaches, consent reviews, vendor
// reviews. Timelines below are DEFAULTS taken from the DPDP Rules, 2025 as
// summarised by public law-firm alerts (grievance resolution within a
// reasonable time not exceeding 90 days; detailed breach report to the Board
// within 72 hours of becoming aware). They are constants a practice must
// verify against the current notified Rules before relying on them.
import { z } from "zod";
import type { TaskDef } from "../engine";
import type { RiskTier, SuggestionDraft } from "../types";
import { maskPii } from "../mask";
import { inputHash } from "../text";

export const RIGHTS_RESPONSE_DAYS = 90;
export const BREACH_REPORT_HOURS = 72;

const addHours = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 3600_000).toISOString();
const addDays = (iso: string, d: number) => addHours(iso, d * 24);

// ---------------------------------------------------------------- rights
export interface RightsInput {
  caseId: string;
  reference: string;
  requestType: "access" | "correction" | "erasure" | "grievance" | "nomination" | "withdraw_consent";
  receivedAt: string;
  identityVerified: boolean;
  retentionObligation: boolean;
  notes: string;
}
export const rightsOutput = z.object({
  summary: z.string().min(5).max(600),
  dueAt: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  steps: z.array(z.string()).min(1).max(10),
  draftResponse: z.string().min(20).max(3000),
  confidence: z.number().min(0).max(1),
  needsHuman: z.string().optional(),
});
export type RightsOutput = z.infer<typeof rightsOutput>;

const RIGHTS_LABEL: Record<RightsInput["requestType"], string> = {
  access: "a request for a summary of personal data and processing",
  correction: "a request to correct or complete personal data",
  erasure: "a request to erase personal data",
  grievance: "a grievance",
  nomination: "a request to nominate another person to exercise rights",
  withdraw_consent: "a withdrawal of consent",
};

export function offlineRights(i: RightsInput): RightsOutput {
  const label = RIGHTS_LABEL[i.requestType];
  const steps = [
    "Log the request and acknowledge receipt to the requester.",
    i.identityVerified ? "Identity is already verified." : "Verify the requester's identity using information already held; do not collect more than needed.",
    i.requestType === "access"
      ? "Collect, from each system holding the data, a summary of the personal data processed and the processing activities."
      : i.requestType === "erasure"
        ? "Locate the data across systems and processors; erase it unless a legal retention duty applies; instruct processors to erase."
        : i.requestType === "correction"
          ? "Correct or complete the data in each system and tell processors to do the same."
          : i.requestType === "withdraw_consent"
            ? "Stop processing that depended on the consent within a reasonable time and tell processors; keep the lawful retention records."
            : i.requestType === "nomination"
              ? "Record the nomination and the nominee's details."
              : "Investigate the grievance and decide the outcome.",
    `Respond to the requester within ${RIGHTS_RESPONSE_DAYS} days of receipt.`,
    "Record the outcome and close the case.",
  ];
  let needsHuman: string | undefined;
  if (i.requestType === "erasure" && i.retentionObligation) needsHuman = "a legal retention duty may override erasure; a person must decide";
  else if (!i.identityVerified && ["access", "erasure", "correction"].includes(i.requestType)) needsHuman = "the requester's identity is not verified yet";
  const sev: RiskTier = i.requestType === "grievance" ? "medium" : i.requestType === "erasure" ? "medium" : "low";
  return {
    summary: `${i.reference}: ${label}, to be answered by ${addDays(i.receivedAt, RIGHTS_RESPONSE_DAYS).slice(0, 10)}.`,
    dueAt: addDays(i.receivedAt, RIGHTS_RESPONSE_DAYS),
    severity: sev,
    steps,
    draftResponse: `Dear Data Principal,\n\nWe acknowledge receipt of your request (reference ${i.reference}) concerning ${label}. We will respond within ${RIGHTS_RESPONSE_DAYS} days of receipt. If you are not satisfied with our response you may raise a complaint with the Data Protection Board of India.\n\nRegards,\nData Protection Office`,
    confidence: needsHuman ? 0.55 : 0.9,
    needsHuman,
  };
}
export const rightsTask: TaskDef<RightsInput, RightsOutput> = {
  kind: "rights_triage",
  outputSchema: rightsOutput,
  offline: offlineRights,
  system:
    "You triage a data principal's rights request under India's DPDP Act for a Data Fiduciary. Produce a due date (default 90 days from receipt), the steps, and a short, polite acknowledgement draft. If a legal retention duty or unverified identity could change the answer, set needsHuman. Fields: summary, dueAt (ISO), severity, steps[], draftResponse, confidence, needsHuman.",
  prompt(i) {
    return `Reference: ${i.reference}\nType: ${i.requestType}\nReceived: ${i.receivedAt}\nIdentity verified: ${i.identityVerified}\nRetention obligation flagged: ${i.retentionObligation}\nNotes (masked): ${maskPii(i.notes).text.slice(0, 1500)}`;
  },
};
export function rightsDraft(i: RightsInput, o: RightsOutput): SuggestionDraft {
  return {
    kind: "rights_triage",
    subjectType: "ops_case",
    subjectId: i.caseId,
    title: `Triage ${i.requestType.replace(/_/g, " ")} request ${i.reference}`,
    summary: o.summary,
    proposed: { ...o },
    rationale: o.summary,
    citations: [],
    confidence: o.confidence,
    tier: i.requestType === "erasure" ? "high" : "low",
    needsHuman: o.needsHuman,
    inputHash: inputHash({ k: "rights", c: i.caseId, t: i.requestType, v: i.identityVerified, r: i.retentionObligation }),
  };
}

// ---------------------------------------------------------------- breach
export interface BreachInput {
  caseId: string;
  reference: string;
  discoveredAt: string;
  categories: string[]; // e.g. financial, health, credentials, identity, contact, children
  principalsAffected: number | null;
  encrypted: boolean;
  contained: boolean;
  description: string;
}
export const breachOutput = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]),
  notifyBoard: z.boolean(),
  notifyPrincipals: z.boolean(),
  boardReportDueAt: z.string(),
  rationale: z.string().min(5).max(1500),
  steps: z.array(z.string()).min(1).max(12),
  boardNoticeDraft: z.string().min(20).max(4000),
  principalNoticeDraft: z.string().min(20).max(4000),
  confidence: z.number().min(0).max(1),
});
export type BreachOutput = z.infer<typeof breachOutput>;

export function offlineBreach(i: BreachInput): BreachOutput {
  const cats = i.categories.map((c) => c.toLowerCase());
  const grave = cats.some((c) => ["financial", "health", "credentials", "children", "biometric"].includes(c));
  const n = i.principalsAffected ?? 0;
  let severity: RiskTier = "low";
  if (grave || n >= 10000) severity = "critical";
  else if ((!i.encrypted && n >= 1000) || cats.includes("identity")) severity = "high";
  else if (n >= 100 || !i.encrypted) severity = "medium";
  const due = addHours(i.discoveredAt, BREACH_REPORT_HOURS);
  const catText = i.categories.join(", ") || "unspecified categories";
  const body = (who: string) =>
    `${who}\n\nNotification of a personal data breach (reference ${i.reference}).\n\nWhat happened: ${maskPii(i.description).text.slice(0, 600) || "[describe the breach: nature, extent, timing and location]"}\nData involved: ${catText}${i.principalsAffected ? `; approximately ${i.principalsAffected} data principals` : ""}.\nBecame aware: ${i.discoveredAt}.\nMeasures taken: ${i.contained ? "the breach has been contained" : "containment is in progress"}${i.encrypted ? "; the affected data was encrypted" : ""}.\nContact: [name, role, email, phone of the person answering questions].`;
  return {
    severity,
    notifyBoard: true,
    notifyPrincipals: true,
    boardReportDueAt: due,
    rationale: `Severity ${severity}: ${grave ? "high-impact data categories involved" : n >= 1000 ? "a large number of data principals" : "limited categories and volume"}${i.encrypted ? ", but the data was encrypted" : ""}. Under the DPDP Rules the Board must be informed without delay and given a detailed report within ${BREACH_REPORT_HOURS} hours of becoming aware (here: by ${due.slice(0, 16).replace("T", " ")} UTC); each affected data principal must also be informed.`,
    steps: [
      "Contain the breach and preserve logs.",
      "Intimate the Data Protection Board without undue delay.",
      `File the detailed report to the Board within ${BREACH_REPORT_HOURS} hours of becoming aware.`,
      "Inform each affected data principal, in plain language, including what they can do to protect themselves.",
      "Record the root cause, remediation and lessons learned; update the risk register.",
    ],
    boardNoticeDraft: body("To: Data Protection Board of India"),
    principalNoticeDraft: body("To: the affected data principal"),
    confidence: i.principalsAffected === null ? 0.7 : 0.85,
  };
}
export const breachTask: TaskDef<BreachInput, BreachOutput> = {
  kind: "breach_assess",
  outputSchema: breachOutput,
  offline: offlineBreach,
  maxTokens: 2500,
  system:
    "You assess a personal data breach for a Data Fiduciary under India's DPDP Act and Rules: severity, whether the Board and the affected data principals must be informed, the deadline for the detailed Board report (72 hours from becoming aware), the response steps, and drafts of both notices with placeholders where facts are unknown. Never invent facts. Fields: severity, notifyBoard, notifyPrincipals, boardReportDueAt (ISO), rationale, steps[], boardNoticeDraft, principalNoticeDraft, confidence.",
  prompt(i) {
    return `Reference: ${i.reference}\nDiscovered: ${i.discoveredAt}\nData categories: ${i.categories.join(", ")}\nPrincipals affected: ${i.principalsAffected ?? "unknown"}\nEncrypted: ${i.encrypted}\nContained: ${i.contained}\nDescription (masked): ${maskPii(i.description).text.slice(0, 2000)}`;
  },
};
export function breachDrafts(i: BreachInput, o: BreachOutput): { assess: SuggestionDraft; notice: SuggestionDraft } {
  const hash = inputHash({ k: "breach", c: i.caseId, cat: i.categories, n: i.principalsAffected, e: i.encrypted, ct: i.contained });
  return {
    assess: {
      kind: "breach_assess",
      subjectType: "ops_case",
      subjectId: i.caseId,
      title: `Assess breach ${i.reference}: ${o.severity}`,
      summary: o.rationale,
      proposed: { severity: o.severity, rationale: o.rationale, steps: o.steps, boardReportDueAt: o.boardReportDueAt, notifyBoard: o.notifyBoard, notifyPrincipals: o.notifyPrincipals },
      rationale: o.rationale,
      citations: [],
      confidence: o.confidence,
      tier: o.severity,
      inputHash: hash,
    },
    notice: {
      kind: "breach_notice",
      subjectType: "ops_case",
      subjectId: i.caseId,
      title: `Approve breach notices for ${i.reference}`,
      summary: "Board intimation and data-principal notice drafted. Approval authorises the notices to be sent by the client's own channel.",
      proposed: { boardNoticeDraft: o.boardNoticeDraft, principalNoticeDraft: o.principalNoticeDraft, boardReportDueAt: o.boardReportDueAt },
      rationale: "Notices are drafted from the recorded breach facts; unknown facts are left as placeholders for a person to fill.",
      citations: [],
      confidence: o.confidence,
      tier: "critical",
      inputHash: hash + ":notice",
    },
  };
}

// --------------------------------------------------------------- consent
export interface ConsentInput {
  caseId: string;
  reference: string;
  consentText: string;
  languages: string[];
  preTicked: boolean;
  bundled: boolean;
  withdrawalAsEasy: boolean | null;
}
export const consentOutput = z.object({
  checks: z.array(z.object({ check: z.string(), pass: z.boolean(), note: z.string() })).min(1).max(15),
  verdict: z.enum(["compliant", "needs_changes", "non_compliant"]),
  summary: z.string().min(5).max(800),
  confidence: z.number().min(0).max(1),
});
export type ConsentOutput = z.infer<typeof consentOutput>;

export function offlineConsent(i: ConsentInput): ConsentOutput {
  const t = i.consentText.toLowerCase();
  const checks = [
    { check: "Consent is a clear affirmative action (not pre-ticked)", pass: !i.preTicked, note: i.preTicked ? "A pre-ticked box is not a clear affirmative action." : "Not pre-ticked." },
    { check: "Consent is not bundled with unrelated purposes", pass: !i.bundled, note: i.bundled ? "Consent appears bundled with other terms." : "Not bundled." },
    { check: "Notice lists the specific personal data and the purpose", pass: /purpose|we (collect|use|process)/.test(t) && /(data|information)/.test(t), note: "Looks for itemised data and purposes in the text." },
    { check: "Explains how to withdraw consent", pass: /withdraw/.test(t), note: /withdraw/.test(t) ? "Withdrawal is mentioned." : "No mention of withdrawing consent." },
    { check: "Withdrawal is as easy as giving consent", pass: i.withdrawalAsEasy === true, note: i.withdrawalAsEasy === null ? "Not confirmed - a person must check the live flow." : i.withdrawalAsEasy ? "Confirmed." : "Reported as harder than giving consent." },
    { check: "Says how to exercise rights and contact the fiduciary", pass: /(contact|grievance|data protection officer|dpo|email)/.test(t), note: "Looks for a contact or grievance route." },
    { check: "Mentions the right to complain to the Data Protection Board", pass: /data protection board|board/.test(t), note: "Looks for the Board complaint route." },
    { check: "Offered in English and a language of the Eighth Schedule", pass: i.languages.length >= 2, note: `Languages offered: ${i.languages.join(", ") || "none stated"}.` },
  ];
  const failed = checks.filter((c) => !c.pass);
  const verdict: ConsentOutput["verdict"] = failed.length === 0 ? "compliant" : failed.length <= 2 ? "needs_changes" : "non_compliant";
  return {
    checks,
    verdict,
    summary: failed.length ? `${failed.length} of ${checks.length} checks failed: ${failed.map((f) => f.check).join("; ")}.` : "All checks passed.",
    confidence: i.withdrawalAsEasy === null ? 0.7 : 0.82,
  };
}
export const consentTask: TaskDef<ConsentInput, ConsentOutput> = {
  kind: "consent_review",
  outputSchema: consentOutput,
  offline: offlineConsent,
  system:
    "You review a consent notice/flow against India's DPDP Act section 6 and the Rules: free, specific, informed, unconditional, unambiguous, clear affirmative action; itemised notice; withdrawal as easy as giving; contact and Board-complaint route; language options. Fields: checks[{check, pass, note}], verdict (compliant | needs_changes | non_compliant), summary, confidence.",
  prompt(i) {
    return `Reference: ${i.reference}\nPre-ticked: ${i.preTicked}\nBundled: ${i.bundled}\nWithdrawal as easy: ${i.withdrawalAsEasy}\nLanguages: ${i.languages.join(", ")}\nTEXT:\n${maskPii(i.consentText).text.slice(0, 6000)}`;
  },
};
export function consentDraft(i: ConsentInput, o: ConsentOutput): SuggestionDraft {
  return {
    kind: "consent_review",
    subjectType: "ops_case",
    subjectId: i.caseId,
    title: `Consent review ${i.reference}: ${o.verdict.replace(/_/g, " ")}`,
    summary: o.summary,
    proposed: { ...o },
    rationale: o.summary,
    citations: [],
    confidence: o.confidence,
    tier: "high",
    inputHash: inputHash({ k: "consent", c: i.caseId, t: i.consentText.length, p: i.preTicked, b: i.bundled, w: i.withdrawalAsEasy, l: i.languages }),
  };
}

// ---------------------------------------------------------------- vendor
export interface VendorInput {
  caseId: string;
  reference: string;
  vendorName: string;
  services: string;
  dataCategories: string[];
  answers: {
    hasDpa: boolean;
    breachNotificationHours: number | null;
    certifications: string[];
    crossBorder: boolean;
    encryptionAtRest: boolean;
    deletionOnExit: boolean;
    auditRights: boolean;
    subprocessorsDisclosed: boolean;
  };
}
export const vendorOutput = z.object({
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  score: z.number().min(0).max(100),
  recommendation: z.enum(["approve", "approve_with_conditions", "do_not_approve"]),
  gaps: z.array(z.string()).max(12),
  conditions: z.array(z.string()).max(12),
  summary: z.string().min(5).max(800),
  confidence: z.number().min(0).max(1),
});
export type VendorOutput = z.infer<typeof vendorOutput>;

export function offlineVendor(i: VendorInput): VendorOutput {
  const a = i.answers;
  let score = 100;
  const gaps: string[] = [];
  const penal = (cond: boolean, pts: number, gap: string) => {
    if (cond) {
      score -= pts;
      gaps.push(gap);
    }
  };
  penal(!a.hasDpa, 30, "No data processing agreement in place");
  penal(a.breachNotificationHours === null || a.breachNotificationHours > 48, 15, a.breachNotificationHours === null ? "No breach-notification commitment" : `Breach notification slower than 48 hours (${a.breachNotificationHours}h)`);
  penal(!a.encryptionAtRest, 15, "Data is not encrypted at rest");
  penal(!a.deletionOnExit, 10, "No commitment to delete or return data on exit");
  penal(!a.auditRights, 10, "No audit or inspection rights");
  penal(!a.subprocessorsDisclosed, 10, "Sub-processors not disclosed");
  penal(a.crossBorder, 5, "Data is transferred outside India (confirm it is permitted)");
  penal(a.certifications.length === 0, 5, "No independent security certification");
  score = Math.max(0, score);
  const sensitive = i.dataCategories.some((c) => ["financial", "health", "children", "credentials", "biometric"].includes(c.toLowerCase()));
  const riskLevel: VendorOutput["riskLevel"] = score >= 85 ? "low" : score >= 65 ? "medium" : score >= 40 ? "high" : "critical";
  const recommendation: VendorOutput["recommendation"] =
    !a.hasDpa || score < 40 ? "do_not_approve" : score >= 85 && !sensitive ? "approve" : "approve_with_conditions";
  return {
    riskLevel,
    score,
    recommendation,
    gaps,
    conditions: gaps.map((g) => `Resolve before go-live: ${g.toLowerCase()}.`),
    summary: `${i.vendorName}: score ${score}/100 (${riskLevel} risk), ${gaps.length} gap(s). Recommendation: ${recommendation.replace(/_/g, " ")}.`,
    confidence: 0.84,
  };
}
export const vendorTask: TaskDef<VendorInput, VendorOutput> = {
  kind: "vendor_review",
  outputSchema: vendorOutput,
  offline: offlineVendor,
  system:
    "You assess a data processor (vendor) for a Data Fiduciary under India's DPDP Act from questionnaire answers: a 0-100 score, risk level, gaps, conditions and a recommendation (approve | approve_with_conditions | do_not_approve). Only use the answers provided. Fields: riskLevel, score, recommendation, gaps[], conditions[], summary, confidence.",
  prompt(i) {
    return `Vendor: ${i.vendorName}\nServices: ${i.services.slice(0, 600)}\nData categories: ${i.dataCategories.join(", ")}\nAnswers: ${JSON.stringify(i.answers)}`;
  },
};
export function vendorDraft(i: VendorInput, o: VendorOutput): SuggestionDraft {
  return {
    kind: "vendor_review",
    subjectType: "ops_case",
    subjectId: i.caseId,
    title: `Vendor review ${i.vendorName}: ${o.recommendation.replace(/_/g, " ")}`,
    summary: o.summary,
    proposed: { ...o },
    rationale: o.summary,
    citations: [],
    confidence: o.confidence,
    tier: o.riskLevel === "critical" ? "critical" : o.riskLevel,
    inputHash: inputHash({ k: "vendor", c: i.caseId, a: i.answers, d: i.dataCategories }),
  };
}
