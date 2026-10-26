import type { Sector } from "../types";

export const INSURANCE: Sector = {
  key: "insurance",
  label: "Insurance",
  prefix: "INS",
  blurb: "Insurers, brokers and third-party administrators regulated by IRDAI: cyber resilience, policyholder data, outsourcing and claims records on top of DPDP.",
  regulators: ["IRDAI"],
  instruments: [
    { id: "irdai-cyber", name: "IRDAI Information and Cyber Security Guidelines (2023)", regulator: "IRDAI", kind: "guidelines", confirmed: false, summary: "Governance, risk assessment, security controls, incident reporting and audits for the information and cyber security of insurers and intermediaries." },
    { id: "irdai-ppi", name: "IRDAI (Protection of Policyholders' Interests, Operations and Allied Matters of Insurers) Regulations, 2024", regulator: "IRDAI", kind: "regulation", confirmed: false, summary: "Policyholder communication, claims handling and the safeguarding of policyholder information." },
    { id: "irdai-outsourcing", name: "IRDAI outsourcing guidelines for insurers", regulator: "IRDAI", kind: "guidelines", confirmed: false, summary: "Due diligence on outsourced partners, written agreements, confidentiality and access for the regulator." },
    { id: "irdai-records", name: "IRDAI record-keeping and electronic policy requirements", regulator: "IRDAI", kind: "regulation", confirmed: false, summary: "Policy, premium and claims records are maintained for the periods the regulations set, including in electronic form." },
  ],
  controls: [
    { code: "INS-01", title: "Information and cyber security governance", type: "preventive", instrument: "irdai-cyber", description: "A board-approved information and cyber security policy, a named responsible officer, periodic risk assessment and audits cover systems that hold policyholder data.", related: ["GOV-01", "SEC-01"] },
    { code: "INS-02", title: "Policyholder health and claims data protection", type: "preventive", instrument: "irdai-ppi", description: "Health, claims and medical records are collected for stated purposes, shared only with the people the claim needs, and protected with restricted access and encryption.", related: ["INV-01", "SEC-01", "SEC-02"] },
    { code: "INS-03", title: "Third-party administrators, agents and surveyors: data sharing", type: "preventive", instrument: "irdai-outsourcing", description: "Data shared with TPAs, agents, brokers, surveyors and hospitals goes under written agreements that bind them to security, confidentiality and return or deletion of data.", related: ["PRO-01", "PRO-02"] },
    { code: "INS-04", title: "Policy and claims records retention", type: "preventive", instrument: "irdai-records", description: "Policy, premium and claims records are kept for the period the regulations require, then erased, and the schedule names the legal basis for each period.", related: ["RET-01"] },
    { code: "INS-05", title: "Cyber incident reporting to IRDAI", type: "corrective", instrument: "irdai-cyber", description: "Cyber incidents are reported to IRDAI and CERT-In within the prescribed time, with a record and a root cause analysis.", related: ["BRE-01", "BRE-02", "CYB-01"] },
  ],
  dpdpInterplay: [
    "Insurers hold health and financial data at scale and share it widely with TPAs, hospitals and reinsurers. Each recipient is a Data Processor or Data Fiduciary and needs a contract.",
    "Regulatory retention for policy and claims records limits erasure (DPDP s.8(7)).",
    "Marketing to prospects falls under both the DPDP consent rules and TRAI preference rules (control CYB-03).",
  ],
  typicalEvidence: ["Board-approved cyber security policy", "TPA and hospital data sharing agreements", "Claims data access matrix", "Records retention schedule", "IRDAI cyber audit report"],
};
