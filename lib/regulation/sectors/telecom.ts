import type { Sector } from "../types";

export const TELECOM: Sector = {
  key: "telecom",
  label: "Telecom and internet services",
  prefix: "TEL",
  blurb: "Telecom licensees, ISPs and messaging platforms: subscriber verification, cyber security rules and commercial communication rules on top of DPDP.",
  regulators: ["DoT", "TRAI"],
  instruments: [
    { id: "telecom-act", name: "Telecommunications Act, 2023", regulator: "DoT", kind: "law", confirmed: false, summary: "Authorisation for telecom services, identification of users, and duties on authorised entities. Rules are being notified in phases, so check which provisions are in force." },
    { id: "telecom-cyber-rules", name: "Telecommunications (Telecom Cyber Security) Rules, 2024", regulator: "DoT", kind: "rules", confirmed: false, summary: "Telecom entities adopt a cyber security policy, report security incidents within the stated time, and cooperate with the government on security." },
    { id: "tccccpr-tel", name: "TRAI Telecom Commercial Communications Customer Preference Regulations, 2018", regulator: "TRAI", kind: "regulation", confirmed: false, summary: "Registered headers and templates, customer preferences and consent for commercial messages and calls." },
    { id: "subscriber-kyc", name: "DoT subscriber verification (KYC) instructions", regulator: "DoT", kind: "directions", confirmed: false, summary: "Subscriber identity is verified at enrolment and records are kept for the prescribed period." },
  ],
  controls: [
    { code: "TEL-01", title: "Telecom cyber security policy and incident reporting", type: "preventive", instrument: "telecom-cyber-rules", description: "A telecom cyber security policy is in place, a Chief Telecommunication Security Officer is named, and security incidents are reported to DoT within the prescribed time.", related: ["SEC-01", "BRE-01", "CYB-01"] },
    { code: "TEL-02", title: "Subscriber KYC records: collection, security and retention", type: "preventive", instrument: "subscriber-kyc", description: "Subscriber identity documents are collected for verification only, stored securely, and kept for the period the licence requires.", related: ["INV-01", "RET-01", "SEC-01"] },
    { code: "TEL-03", title: "Call detail and usage data: retention and access", type: "preventive", instrument: "telecom-act", description: "Call detail records and usage data are kept only for the legally required period, access is restricted and logged, and lawful requests from authorities are handled through a recorded process.", related: ["RET-01", "SEC-02"] },
    { code: "TEL-04", title: "Commercial communication preferences and consent", type: "preventive", instrument: "tccccpr-tel", description: "Promotional messages and calls are sent only to customers whose preference and consent allow it, using registered headers and templates.", related: ["CON-01", "CYB-03"] },
  ],
  dpdpInterplay: [
    "DPDP applies to subscriber and usage data alongside the telecom licence conditions. Where a licence requires longer retention, DPDP s.8(7) allows it.",
    "Lawful interception and information requests sit within the State exemptions of DPDP s.17(2). Keep a record of every request received.",
  ],
  typicalEvidence: ["Telecom cyber security policy", "CTSO appointment", "Subscriber KYC process note", "Data retention schedule for CDRs", "DLT registration and consent register"],
};
