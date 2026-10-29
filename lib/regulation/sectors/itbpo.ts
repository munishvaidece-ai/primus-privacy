import type { Sector } from "../types";

export const ITBPO: Sector = {
  key: "itbpo",
  label: "IT services, BPO and global capability centres",
  prefix: "ITB",
  blurb: "Software and IT services firms, outsourcing companies and GCCs: mostly Data Processors for clients abroad, with real exposure on their own staff, candidates and Indian clients.",
  regulators: ["MeitY", "STPI and SEZ authorities", "Client regulators abroad (by contract)"],
  instruments: [
    { id: "dpdp-offshore", name: "DPDP Act s.17(1)(d) and s.8(2): processing for clients outside India, and Data Processors", regulator: "MeitY", kind: "law", confirmed: true, summary: "Most duties do not apply to personal data of people outside India that is processed in India under a contract with a person outside India. Security safeguards still apply in some respects, and data of people in India, such as your own staff, is fully covered. A Data Processor is engaged by a Data Fiduciary under a valid contract." },
    { id: "client-contracts", name: "Client contracts and foreign data-protection law flowed down by contract (GDPR, UK GDPR, HIPAA, CCPA)", regulator: "Clients and foreign regulators", kind: "policy", confirmed: false, summary: "Client contracts often require data-processing terms, sub-processor approval, audit rights, breach notice within days and return or deletion at exit." },
    { id: "iso", name: "ISO/IEC 27001 and 27701 as contractual assurance", regulator: "Certification bodies", kind: "policy", confirmed: false, summary: "Many clients ask for certification or a SOC 2 report as proof of controls." },
  ],
  controls: [
    { code: "ITB-01", title: "Mapping which client data is in and out of DPDP", type: "preventive", instrument: "dpdp-offshore", description: "For each client and project the firm records whose data is processed, where those people are and whether the offshore exemption applies, and treats staff and Indian-client data as fully covered.", related: ["INV-01", "LEG-01"] },
    { code: "ITB-02", title: "Processor contracts and sub-processor flow-down", type: "preventive", instrument: "client-contracts", description: "Contracts with clients and with the firm's own sub-processors carry data-protection terms, approval of sub-processors, audit rights, breach notice periods and return or deletion at exit.", related: ["PRO-01", "PRO-02"] },
    { code: "ITB-03", title: "Offshore delivery centre controls", type: "preventive", instrument: "client-contracts", description: "Delivery floors use restricted access, no personal devices or copying, data-loss controls and monitoring, and access is removed promptly when a person leaves a project.", related: ["SEC-01", "SEC-02"] },
    { code: "ITB-04", title: "Employee, candidate and background-check data", type: "preventive", instrument: "dpdp-offshore", description: "Recruitment, background verification, payroll and performance data of the firm's own people is covered by notice, vendor agreements and retention limits.", related: ["NOT-01", "PRO-01", "RET-01"] },
    { code: "ITB-05", title: "Client breach notice and incident coordination", type: "corrective", instrument: "client-contracts", description: "A procedure tells each client within the contract period and informs the Board and CERT-In where required, with one incident lead coordinating all parties.", related: ["BRE-01", "BRE-02", "CYB-01"] },
    { code: "ITB-06", title: "Independent assurance", type: "detective", instrument: "iso", description: "Controls are checked by internal audit and by an outside certification or SOC report, and findings are tracked to closure.", related: ["GOV-01", "SEC-01"] },
  ],
  dpdpInterplay: [
    "The offshore exemption in s.17(1)(d) is narrow: it covers data of people outside India processed under a contract with a party outside India. It does not cover the firm's own staff or Indian clients.",
    "A GCC that serves its own parent company is usually a Data Processor for the parent, and a Data Fiduciary for its local employees.",
    "Clients' foreign-law terms still bind the firm by contract even where DPDP is lighter.",
  ],
  typicalEvidence: ["Client and project data map", "Sample data-processing agreement and sub-processor list", "Delivery centre access control procedure", "Background-check vendor agreement", "ISO 27001 certificate or SOC 2 report"],
};
