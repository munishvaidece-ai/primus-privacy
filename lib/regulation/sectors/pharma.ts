import type { Sector } from "../types";

export const PHARMA: Sector = {
  key: "pharma",
  label: "Pharmaceuticals and life sciences",
  prefix: "PHA",
  blurb: "Drug makers, CROs, clinical-trial sponsors and pharma marketers: trial participants, adverse-event reports and prescriber data on top of DPDP. Hospitals and clinics are under Healthcare.",
  regulators: ["CDSCO", "DCGI", "ICMR", "NPPA", "State drug controllers"],
  instruments: [
    { id: "ndct", name: "New Drugs and Clinical Trials Rules, 2019", regulator: "CDSCO", kind: "rules", confirmed: false, summary: "Informed consent, ethics committee oversight, confidentiality of participant identity, serious adverse event reporting and record keeping for clinical trials and bioavailability studies." },
    { id: "icmr", name: "ICMR National Ethical Guidelines for Biomedical and Health Research Involving Human Participants (2017)", regulator: "ICMR", kind: "guidelines", confirmed: false, summary: "Informed consent, privacy and confidentiality of participants, secondary use of data and biological samples, and data sharing with sponsors and researchers." },
    { id: "pvpi", name: "Pharmacovigilance Programme of India (PvPI) adverse drug reaction reporting", regulator: "IPC, CDSCO", kind: "guidelines", confirmed: false, summary: "Marketing authorisation holders collect, assess and report adverse drug reactions, which carry patient and reporter details." },
    { id: "ucpmp", name: "Uniform Code for Pharmaceutical Marketing Practices", regulator: "Department of Pharmaceuticals", kind: "policy", confirmed: false, summary: "Conduct rules for contact with healthcare professionals, including records of payments and engagements that name individual practitioners." },
    { id: "dpdp-health-research", name: "DPDP Act s.17(2)(b) (research, archiving and statistical purposes) and Rule 16", regulator: "MeitY", kind: "law", confirmed: true, summary: "Processing for research, archiving or statistics is exempt from most duties only if the data is not used to take decisions about a person and the standards in the Second Schedule are followed." },
  ],
  controls: [
    { code: "PHA-01", title: "Clinical-trial participant consent and confidentiality", type: "preventive", instrument: "ndct", description: "Participants give informed consent that also covers how their data is used and shared. Their identity is replaced by a code in what goes to sponsors, CROs and regulators, and the key is held separately.", related: ["CON-01", "SEC-02", "PUR-01"] },
    { code: "PHA-02", title: "Adverse event and pharmacovigilance data handling", type: "preventive", instrument: "pvpi", description: "Adverse event reports are collected only with the detail needed, shared with regulators and partners under agreements, and the reporter and patient details are protected and kept only as long as the rules require.", related: ["SEC-01", "RET-01"] },
    { code: "PHA-03", title: "Research and secondary use of trial data", type: "preventive", instrument: "dpdp-health-research", description: "Each secondary use of trial or real-world data is checked against its consent and the research exemption, with a record of the decision, and data is not used for decisions about individuals.", related: ["PUR-01", "LEG-01"] },
    { code: "PHA-04", title: "Sharing with sponsors, CROs and labs abroad", type: "preventive", instrument: "icmr", description: "Transfers of participant and sample data to sponsors, CROs and central labs outside India are listed, covered by written agreements and limited to coded data where possible.", related: ["XBR-01", "PRO-01"] },
    { code: "PHA-05", title: "Healthcare professional and patient-support programme data", type: "preventive", instrument: "ucpmp", description: "Records on doctors, pharmacists and patients enrolled in support programmes are kept for a stated purpose, with notice and consent where needed, and not used for unrelated promotion.", related: ["NOT-01", "CON-01"] },
    { code: "PHA-06", title: "Trial and quality record retention", type: "corrective", instrument: "ndct", description: "Trial and quality records are kept for the period the rules require and then erased or archived under a written schedule, with legal holds recorded.", related: ["RET-01"] },
  ],
  dpdpInterplay: [
    "Trial participants' health data is among the most sensitive personal data. Consider whether the organisation may be notified as a Significant Data Fiduciary.",
    "Clinical trial rules require records to be kept for fixed periods, which limits erasure under DPDP s.8(7).",
    "The research exemption in s.17(2)(b) is narrow. It does not cover marketing or decisions about a person.",
    "Coded (pseudonymised) trial data is still personal data when the sponsor or CRO can link the code back to the person.",
  ],
  typicalEvidence: ["Informed consent form and participant information sheet", "Trial data-sharing agreement with sponsor or CRO", "Pharmacovigilance SOP and safety database access list", "Records retention schedule", "Healthcare professional engagement register"],
};
