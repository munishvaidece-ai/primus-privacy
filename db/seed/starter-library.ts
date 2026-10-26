// A STARTER control library for DPDP readiness assessments, loaded as a
// DRAFT. It is a working starting point written from the structure of the
// Digital Personal Data Protection Act, 2023 (section references below) —
// it is NOT legal advice and has not been reviewed by your practice.
// Review, edit and publish it (Methodology → Control Library) before using
// it on a real engagement. Published libraries are frozen, so review first.
//
// Wording matters: the AI derives how cautious to be about a control from
// its title/description (see lib/ai/tier.ts and the user guide).

export interface StarterControl {
  code: string;
  title: string;
  type: "preventive" | "detective" | "corrective";
  description: string;
  ref: string; // regulatory reference this control mainly supports
}

export const STARTER_REFERENCES: Array<{ citation: string; title: string }> = [
  { citation: "DPDP Act 2023, s.4", title: "Grounds for processing personal data" },
  { citation: "DPDP Act 2023, s.5", title: "Notice" },
  { citation: "DPDP Act 2023, s.6", title: "Consent" },
  { citation: "DPDP Act 2023, s.7", title: "Certain legitimate uses" },
  { citation: "DPDP Act 2023, s.8", title: "General obligations of Data Fiduciary" },
  { citation: "DPDP Act 2023, s.9", title: "Processing of personal data of children" },
  { citation: "DPDP Act 2023, s.10", title: "Additional obligations of Significant Data Fiduciary" },
  { citation: "DPDP Act 2023, s.11-14", title: "Rights and grievance redressal of Data Principals" },
  { citation: "DPDP Act 2023, s.16", title: "Processing of personal data outside India" },
];

export const STARTER_CONTROLS: StarterControl[] = [
  { code: "GOV-01", title: "Privacy governance and accountability", type: "preventive", ref: "DPDP Act 2023, s.8", description: "A named owner and a documented structure are accountable for data protection, with management reporting at a regular interval." },
  { code: "GOV-02", title: "Privacy policy governance", type: "preventive", ref: "DPDP Act 2023, s.8", description: "A written privacy policy approved by management, with an owner, version number and review date." },
  { code: "GOV-03", title: "Staff privacy awareness training", type: "preventive", ref: "DPDP Act 2023, s.8", description: "Staff who handle personal data complete induction and periodic refresher training, and attendance is recorded." },
  { code: "INV-01", title: "Personal data inventory and records of processing", type: "detective", ref: "DPDP Act 2023, s.8", description: "A maintained record of what personal data is held, why, where, who has it and how long it is kept." },
  { code: "NOT-01", title: "Privacy notice to Data Principals", type: "preventive", ref: "DPDP Act 2023, s.5", description: "A clear notice, given when personal data is requested, describing the data, the purpose, how to exercise rights and how to complain to the Board." },
  { code: "NOT-02", title: "Notice available in required languages", type: "preventive", ref: "DPDP Act 2023, s.5", description: "The notice is available in English and in the languages of the Eighth Schedule where the audience needs them." },
  { code: "CON-01", title: "Consent collection", type: "preventive", ref: "DPDP Act 2023, s.6", description: "Consent is free, specific, informed, unconditional and unambiguous, given by a clear affirmative action, and limited to the stated purpose." },
  { code: "CON-02", title: "Consent withdrawal", type: "preventive", ref: "DPDP Act 2023, s.6", description: "Withdrawing consent is as easy as giving it, and processing stops within a defined time after withdrawal." },
  { code: "CON-03", title: "Consent records", type: "detective", ref: "DPDP Act 2023, s.6", description: "Each consent is recorded with what was agreed, when, how and which notice version applied." },
  { code: "LEG-01", title: "Legitimate use basis register", type: "preventive", ref: "DPDP Act 2023, s.7", description: "Where processing relies on a legitimate use instead of consent, the basis is identified, documented and approved." },
  { code: "PUR-01", title: "Purpose limitation", type: "preventive", ref: "DPDP Act 2023, s.4", description: "Personal data is used only for the purpose notified; new purposes are reviewed before use." },
  { code: "ACC-01", title: "Data accuracy and completeness", type: "corrective", ref: "DPDP Act 2023, s.8", description: "Where personal data is used to decide about a Data Principal or shared, it is kept reasonably accurate and complete." },
  { code: "RET-01", title: "Retention schedule and erasure", type: "preventive", ref: "DPDP Act 2023, s.8", description: "A retention schedule sets how long each category is kept; data is erased when the purpose ends unless the law requires retention." },
  { code: "SEC-01", title: "Security safeguards for personal data", type: "preventive", ref: "DPDP Act 2023, s.8", description: "Reasonable security safeguards protect personal data, including encryption or masking, access control, logging and backups." },
  { code: "SEC-02", title: "Access control and least privilege", type: "preventive", ref: "DPDP Act 2023, s.8", description: "Access to personal data is granted by role, reviewed regularly, and removed promptly when people leave or change roles." },
  { code: "BRE-01", title: "Personal data breach detection and response plan", type: "detective", ref: "DPDP Act 2023, s.8", description: "A tested plan detects, contains and investigates a personal data breach, with named roles and escalation paths." },
  { code: "BRE-02", title: "Personal data breach notification", type: "corrective", ref: "DPDP Act 2023, s.8", description: "A procedure to inform the Data Protection Board and affected Data Principals within the prescribed timelines, with draft templates." },
  { code: "PRO-01", title: "Data processor and vendor contracts", type: "preventive", ref: "DPDP Act 2023, s.8", description: "Processors are engaged under a written contract that binds them to security, breach reporting, deletion and audit." },
  { code: "PRO-02", title: "Vendor due diligence and monitoring", type: "detective", ref: "DPDP Act 2023, s.8", description: "Vendors are assessed before onboarding and re-assessed periodically for how they handle personal data." },
  { code: "RIG-01", title: "Data Principal rights handling", type: "preventive", ref: "DPDP Act 2023, s.11-14", description: "A process receives, verifies and answers requests to access, correct, complete, update or erase personal data within the prescribed time." },
  { code: "RIG-02", title: "Grievance redressal and contact point", type: "corrective", ref: "DPDP Act 2023, s.11-14", description: "A published contact for questions and grievances, with a tracked response within the prescribed time and a nomination facility." },
  { code: "CHI-01", title: "Children's data and verifiable parental consent", type: "preventive", ref: "DPDP Act 2023, s.9", description: "Where the organisation may process data of anyone under 18, verifiable parental consent is obtained and tracking or targeted advertising to children is avoided." },
  { code: "XBR-01", title: "Cross-border transfer review", type: "preventive", ref: "DPDP Act 2023, s.16", description: "Transfers of personal data outside India are listed and checked against any restriction notified by the Government." },
  { code: "SDF-01", title: "Data Protection Officer and independent audit (Significant Data Fiduciaries)", type: "preventive", ref: "DPDP Act 2023, s.10", description: "If designated a Significant Data Fiduciary: an India-based Data Protection Officer, an independent data auditor and periodic impact assessments." },
  { code: "SDF-02", title: "Data protection impact assessment (Significant Data Fiduciaries)", type: "detective", ref: "DPDP Act 2023, s.10", description: "If designated a Significant Data Fiduciary: periodic data protection impact assessments of high-risk processing." },
];
