// Part A: the Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025.
//
// Penalty amounts are from the Schedule to the Act (section 33(1)); the Rules'
// commencement dates are from the notification of 13 November 2025 as reported
// by law-firm summaries. Rule titles are short descriptions written for this
// product, not the official headings. Indicative; check the Gazette before
// relying on any of it with a client. Maximum penalties are ceilings: the Data
// Protection Board decides the actual amount after weighing the factors in
// section 33(2), so nothing here predicts what a firm would pay.
import type { ControlMapping, DpdpRule, PenaltyKey, PenaltyRow } from "./types";

export const DPDP_VERIFIED_ON = "2026-10-26";

export const PENALTY_SCHEDULE: PenaltyRow[] = [
  { key: "security", breach: "Failure to take reasonable security safeguards to prevent a personal data breach", section: "s.8(5)", maxCrore: 250, maxText: "up to ₹250 crore" },
  { key: "breach", breach: "Failure to notify the Board and affected Data Principals of a personal data breach", section: "s.8(6)", maxCrore: 200, maxText: "up to ₹200 crore" },
  { key: "children", breach: "Failure to meet the additional obligations for children's data", section: "s.9", maxCrore: 200, maxText: "up to ₹200 crore" },
  { key: "sdf", breach: "Failure to meet the additional obligations of a Significant Data Fiduciary", section: "s.10", maxCrore: 150, maxText: "up to ₹150 crore" },
  { key: "duties", breach: "A Data Principal failing to perform her duties", section: "s.15", maxCrore: null, maxText: "up to ₹10,000" },
  { key: "other", breach: "Breach of any other provision of the Act or Rules", section: "any other", maxCrore: 50, maxText: "up to ₹50 crore" },
];

export const penaltyFor = (key: PenaltyKey): PenaltyRow => PENALTY_SCHEDULE.find((p) => p.key === key)!;

/** Sections of the Act that the controls point to. */
export const DPDP_SECTIONS: Array<{ ref: string; title: string; summary: string }> = [
  { ref: "s.4", title: "Grounds for processing", summary: "Personal data may be processed only for a lawful purpose, with consent or for a certain legitimate use." },
  { ref: "s.5", title: "Notice", summary: "A notice must accompany or precede the request for consent, saying what data, why, how to exercise rights and how to complain to the Board." },
  { ref: "s.6", title: "Consent", summary: "Consent must be free, specific, informed, unconditional and unambiguous, and as easy to withdraw as to give." },
  { ref: "s.7", title: "Certain legitimate uses", summary: "Processing without consent for listed uses, such as a voluntary provision, State benefits, legal obligations, medical emergencies and employment." },
  { ref: "s.8", title: "General obligations of a Data Fiduciary", summary: "Accuracy, security safeguards (s.8(5)), breach intimation (s.8(6)), erasure when the purpose ends (s.8(7)), a contact point and a grievance mechanism." },
  { ref: "s.9", title: "Children's data", summary: "Verifiable parental consent; no tracking, behavioural monitoring or targeted advertising directed at children." },
  { ref: "s.10", title: "Significant Data Fiduciaries", summary: "A Data Protection Officer based in India, an independent data auditor and periodic impact assessments." },
  { ref: "s.11-14", title: "Rights and grievance redressal", summary: "Access, correction and erasure, grievance redressal, and the right to nominate." },
  { ref: "s.16", title: "Transfers outside India", summary: "Transfers are allowed except to countries the Government restricts by notification." },
  { ref: "s.17", title: "Exemptions", summary: "Exemptions for specified purposes and for notified State instrumentalities, research and certain classes such as startups." },
  { ref: "s.33", title: "Penalties", summary: "The Board may impose a penalty up to the amounts in the Schedule after an inquiry." },
];

/** DPDP Rules, 2025: commencement in three phases from the notification. */
export const DPDP_RULES: DpdpRule[] = [
  { number: 1, title: "Short title and commencement", phase: "immediate" },
  { number: 2, title: "Definitions", phase: "immediate" },
  { number: 3, title: "Notice to Data Principals", phase: "18m" },
  { number: 4, title: "Consent managers: registration and obligations", phase: "12m" },
  { number: 5, title: "Processing by the State for subsidies, benefits and services", phase: "18m" },
  { number: 6, title: "Reasonable security safeguards", phase: "18m" },
  { number: 7, title: "Intimation of a personal data breach", phase: "18m" },
  { number: 8, title: "Time limits for erasure and retention of logs", phase: "18m" },
  { number: 9, title: "Contact details of the person who answers questions", phase: "18m" },
  { number: 10, title: "Verifiable parental consent for children", phase: "18m" },
  { number: 11, title: "Verifiable consent for persons with a disability", phase: "18m" },
  { number: 12, title: "Exemptions from the children's provisions", phase: "18m" },
  { number: 13, title: "Additional obligations of Significant Data Fiduciaries", phase: "18m" },
  { number: 14, title: "Rights of Data Principals and the time to answer", phase: "18m" },
  { number: 15, title: "Transfer of personal data outside India", phase: "18m" },
  { number: 16, title: "Research, archiving and statistical purposes", phase: "18m" },
  { number: 17, title: "Data Protection Board: appointment", phase: "immediate" },
  { number: 18, title: "Data Protection Board: salary and terms", phase: "immediate" },
  { number: 19, title: "Data Protection Board: meetings and procedure", phase: "immediate" },
  { number: 20, title: "Data Protection Board: techno-legal working", phase: "immediate" },
  { number: 21, title: "Data Protection Board: officers and employees", phase: "immediate" },
  { number: 22, title: "Appeal to the Appellate Tribunal", phase: "18m" },
  { number: 23, title: "Calling for information", phase: "18m" },
];

export const RULE_PHASES = {
  immediate: { label: "In force from 13 November 2025", date: "2025-11-13" },
  "12m": { label: "In force from 13 November 2026", date: "2026-11-13" },
  "18m": { label: "In force from 13 May 2027", date: "2027-05-13" },
} as const;

/**
 * How each starter DPDP control maps to the Act and Rules, and which row of the
 * penalty Schedule is its ceiling. Controls whose obligation is not named in a
 * specific Schedule row fall under "any other provision" (₹50 crore).
 */
export const CONTROL_MAP: Record<string, ControlMapping> = {
  "GOV-01": { sections: ["s.8(1)", "s.8(9)"], rules: [9], penalty: "other" },
  "GOV-02": { sections: ["s.5", "s.8"], rules: [3], penalty: "other" },
  "GOV-03": { sections: ["s.8(5)"], rules: [6], penalty: "security" },
  "INV-01": { sections: ["s.8(1)", "s.8(4)"], rules: [6], penalty: "other" },
  "NOT-01": { sections: ["s.5"], rules: [3], penalty: "other" },
  "NOT-02": { sections: ["s.5(3)"], rules: [3], penalty: "other" },
  "CON-01": { sections: ["s.6(1)", "s.6(2)"], rules: [3], penalty: "other" },
  "CON-02": { sections: ["s.6(4)", "s.6(6)"], rules: [3], penalty: "other" },
  "CON-03": { sections: ["s.6(10)"], rules: [3], penalty: "other" },
  "LEG-01": { sections: ["s.7"], rules: [5], penalty: "other" },
  "PUR-01": { sections: ["s.4", "s.6(1)"], rules: [], penalty: "other" },
  "ACC-01": { sections: ["s.8(3)"], rules: [], penalty: "other" },
  "RET-01": { sections: ["s.8(7)"], rules: [8], penalty: "other" },
  "SEC-01": { sections: ["s.8(5)"], rules: [6], penalty: "security" },
  "SEC-02": { sections: ["s.8(5)"], rules: [6], penalty: "security" },
  "BRE-01": { sections: ["s.8(5)"], rules: [6, 7], penalty: "security" },
  "BRE-02": { sections: ["s.8(6)"], rules: [7], penalty: "breach" },
  "PRO-01": { sections: ["s.8(2)", "s.8(5)"], rules: [6], penalty: "security" },
  "PRO-02": { sections: ["s.8(2)"], rules: [6], penalty: "other" },
  "RIG-01": { sections: ["s.11", "s.12", "s.13"], rules: [14], penalty: "other" },
  "RIG-02": { sections: ["s.8(10)", "s.13", "s.14"], rules: [9, 14], penalty: "other" },
  "CHI-01": { sections: ["s.9"], rules: [10, 11, 12], penalty: "children" },
  "XBR-01": { sections: ["s.16"], rules: [15], penalty: "other" },
  "SDF-01": { sections: ["s.10"], rules: [13], penalty: "sdf" },
  "SDF-02": { sections: ["s.10(2)(c)"], rules: [13], penalty: "sdf" },
};

export const mappingFor = (code: string): ControlMapping | null => CONTROL_MAP[code] ?? null;
