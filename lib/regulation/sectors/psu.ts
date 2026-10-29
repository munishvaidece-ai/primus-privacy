import type { Sector } from "../types";

export const PSU: Sector = {
  key: "psu",
  label: "Public sector undertakings (PSUs)",
  prefix: "PSU",
  blurb: "Central and state public sector enterprises: large workforces and customer bases, vigilance and audit oversight, RTI and a ministry above them. Ministries and departments are under Government.",
  regulators: ["Administrative ministry", "DPE", "CVC", "CAG", "CERT-In"],
  instruments: [
    { id: "dpdp-state-psu", name: "DPDP Act s.7(b) and (c), s.17(2) and Rule 5, as they apply to instrumentalities of the State", regulator: "MeitY", kind: "law", confirmed: true, summary: "The State and its instrumentalities may use data for subsidies, benefits, services, licences and permits without consent, to the standards in Rule 5. Whether a given PSU counts as an instrumentality, and whether any exemption applies, depends on its function and on a notification, so it needs a legal view." },
    { id: "rti-psu", name: "Right to Information Act, 2005, s.8(1)(j), as amended by the DPDP Act", regulator: "Central Information Commission", kind: "law", confirmed: false, summary: "Most PSUs are public authorities under RTI. The personal-information exemption was widened by the DPDP Act, so replies need a recorded privacy review." },
    { id: "dpe-cg", name: "DPE Guidelines on Corporate Governance for Central Public Sector Enterprises (2010)", regulator: "Department of Public Enterprises", kind: "guidelines", confirmed: false, summary: "Board, audit committee and disclosure practices for CPSEs, which give the Board a place in oversight of risk and compliance." },
    { id: "cvc-cag", name: "CVC vigilance guidelines and CAG audit under the Companies Act, 2013", regulator: "CVC, CAG", kind: "guidelines", confirmed: false, summary: "Vigilance inquiries and government audit need access to employee, vendor and customer records, so access must be allowed and also recorded and limited to need." },
    { id: "cert-in-gov-2023", name: "CERT-In Guidelines on Information Security Practices for Government Entities (2023)", regulator: "CERT-In", kind: "guidelines", confirmed: false, summary: "Information security practices expected of government entities, including a named security officer, asset inventory, logging, and incident reporting." },
    { id: "nciipc", name: "IT Act s.70A and NCIIPC guidelines for protected systems and critical information infrastructure", regulator: "NCIIPC", kind: "guidelines", confirmed: false, summary: "PSUs in power, oil and gas, transport, finance and similar areas may run protected systems with stricter security and reporting duties." },
  ],
  controls: [
    { code: "PSU-01", title: "Legal basis review for each function: State use or consent", type: "preventive", instrument: "dpdp-state-psu", description: "For each service and internal process the PSU records whether it relies on the State's legitimate use, on consent or on another ground, with legal sign-off, and does not assume a State exemption without a notification.", related: ["LEG-01", "CON-01", "PUR-01"] },
    { code: "PSU-02", title: "RTI replies reviewed for personal information", type: "preventive", instrument: "rti-psu", description: "RTI replies are checked for personal information before release and the decision under the amended exemption is recorded, with a named officer.", related: ["ACC-01", "RIG-02"] },
    { code: "PSU-03", title: "Employee and pensioner data at scale", type: "preventive", instrument: "dpe-cg", description: "Records of a large workforce and pensioners, including service books, medical and vigilance files, have role-based access, retention rules and a notice describing their use.", related: ["SEC-02", "RET-01", "NOT-01"] },
    { code: "PSU-04", title: "Vigilance and audit access to personal data", type: "detective", instrument: "cvc-cag", description: "Vigilance and audit requests for personal data are logged, limited to what the inquiry needs, and the data is returned or deleted when it is closed.", related: ["SEC-02", "PUR-01"] },
    { code: "PSU-05", title: "Security officer, asset inventory and incident reporting", type: "preventive", instrument: "cert-in-gov-2023", description: "A senior officer owns information security, an asset and data inventory is kept, logs are retained, and incidents are reported to CERT-In and the ministry, and to the Board where personal data is involved.", related: ["SEC-01", "BRE-01", "BRE-02", "CYB-01"] },
    { code: "PSU-06", title: "Tender, vendor and bidder personal data", type: "preventive", instrument: "dpe-cg", description: "Personal data in bids, e-procurement portals and vendor registrations is limited to what is needed, shared with evaluators on need, and covered by confidentiality terms.", related: ["PRO-01", "PUR-01"] },
    { code: "PSU-07", title: "Protected systems and critical information infrastructure", type: "preventive", instrument: "nciipc", description: "Where the PSU runs systems notified as protected or critical, the extra security, audit and reporting duties are listed, owned and tested, and personal data on them is covered.", related: ["SEC-01", "BRE-01"] },
  ],
  dpdpInterplay: [
    "A PSU is a company or body owned or controlled by government. It is not automatically the State for DPDP purposes. Treat the State's legitimate uses (s.7) and exemptions (s.17(2)) as available only after a legal view and, for exemptions, a notification.",
    "PSUs with large customer or citizen bases are strong candidates for Significant Data Fiduciary status.",
    "Public sector banks and insurers are assessed under Banking or Insurance as well as this sector. Select both and the controls will add up without repeating.",
    "Duties on security safeguards, breach intimation and accuracy apply even where the State's legitimate uses are used.",
  ],
  typicalEvidence: ["Function-wise legal basis register signed by legal", "RTI privacy review procedure", "Service book and pensioner record access matrix", "Vigilance and audit data request log", "CERT-In incident report and security officer appointment"],
};
