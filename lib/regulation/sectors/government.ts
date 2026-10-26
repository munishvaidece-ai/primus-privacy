import type { Sector } from "../types";

export const GOVERNMENT: Sector = {
  key: "government",
  label: "Government and public bodies",
  prefix: "GVT",
  blurb: "Departments, public sector undertakings and instrumentalities: the State has its own exemptions and legitimate uses, but duties on security and accuracy remain.",
  regulators: ["MeitY", "CERT-In", "NIC"],
  instruments: [
    { id: "dpdp-state", name: "DPDP Act s.7 (certain legitimate uses), s.17(2) (State exemptions) and Rule 5", regulator: "MeitY", kind: "law", confirmed: true, summary: "The State and its instrumentalities may process data without consent for a subsidy, benefit, service, licence or permit when the data principal has already given it or it is in State records, subject to standards under Rule 5 and the Second Schedule. Notified agencies can be exempted for sovereignty, security and public order (s.17(2)(a))." },
    { id: "rti", name: "Right to Information Act, 2005, s.8(1)(j), as amended by the DPDP Act", regulator: "Central Information Commission", kind: "law", confirmed: false, summary: "The personal information exemption under RTI was widened by DPDP. Public authorities should check how the amended section affects disclosures." },
    { id: "aadhaar", name: "Aadhaar Act, 2016 and Aadhaar (Authentication) Regulations", regulator: "UIDAI", kind: "law", confirmed: false, summary: "Aadhaar numbers are collected, stored and used only under the Act, with consent for authentication and secure storage in the vault." },
    { id: "cert-in-govt", name: "CERT-In guidelines for government entities and MeitY cloud (MeghRaj) policy", regulator: "CERT-In, MeitY", kind: "guidelines", confirmed: false, summary: "Government entities follow CERT-In security guidelines and use empanelled cloud services." },
  ],
  controls: [
    { code: "GVT-01", title: "Legal basis for each citizen-facing service", type: "preventive", instrument: "dpdp-state", description: "Each service that collects citizen data names its legal basis, whether consent or the State's legitimate use for benefits and services, and follows the Rule 5 standards.", related: ["LEG-01", "PUR-01"] },
    { code: "GVT-02", title: "Aadhaar collection and storage under the Act", type: "preventive", instrument: "aadhaar", description: "Aadhaar numbers are collected only where the law allows, stored in the vault or masked, and access is restricted and logged.", related: ["SEC-01", "SEC-02"] },
    { code: "GVT-03", title: "Cloud and vendor use: empanelled providers and data location", type: "preventive", instrument: "cert-in-govt", description: "Government data is hosted only on empanelled cloud services or NIC, vendors are bound by security and confidentiality agreements, and data stays in India.", related: ["PRO-01", "XBR-01"] },
    { code: "GVT-04", title: "RTI and personal data disclosure review", type: "preventive", instrument: "rti", description: "RTI replies are reviewed for personal information before release, with a recorded decision under the amended exemption.", related: ["ACC-01"] },
    { code: "GVT-05", title: "Citizen grievance and data correction route", type: "corrective", instrument: "dpdp-state", description: "Citizens can ask for correction of their records and raise a grievance, with a named officer and an answer within a stated time.", related: ["RIG-01", "RIG-02"] },
  ],
  dpdpInterplay: [
    "Many government services can process data without consent under s.7. Security safeguards, breach intimation and accuracy duties still apply unless the entity is specifically exempted under s.17(2).",
    "State exemptions under s.17(2)(a) need a Government notification for the particular agency. Do not assume one applies.",
    "Government bodies holding citizen data at scale are strong candidates for Significant Data Fiduciary status.",
  ],
  typicalEvidence: ["Service-wise legal basis register", "Aadhaar vault configuration", "Cloud empanelment evidence", "RTI personal data review procedure", "Citizen grievance procedure"],
};
