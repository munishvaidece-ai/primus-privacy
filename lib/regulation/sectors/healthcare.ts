import type { Sector } from "../types";

export const HEALTHCARE: Sector = {
  key: "healthcare",
  label: "Healthcare and health technology",
  prefix: "HLT",
  blurb: "Hospitals, clinics, labs, telemedicine and health apps: patient confidentiality, health records and the ABDM digital health framework on top of DPDP.",
  regulators: ["Ministry of Health", "National Health Authority (ABDM)", "NMC"],
  instruments: [
    { id: "abdm", name: "Ayushman Bharat Digital Mission Health Data Management Policy", regulator: "National Health Authority", kind: "policy", confirmed: false, summary: "Consent-based sharing of health records through the ABDM, with consent artefacts, purpose limits and security practices for participating entities." },
    { id: "telemed", name: "Telemedicine Practice Guidelines (2020)", regulator: "NMC, Ministry of Health", kind: "guidelines", confirmed: false, summary: "Patient identification, consent, record keeping and confidentiality for teleconsultations." },
    { id: "ce-act", name: "Clinical Establishments (Registration and Regulation) Act and Rules", regulator: "State authorities", kind: "law", confirmed: false, summary: "Clinical establishments maintain patient records and make them available to patients on request." },
    { id: "special-confidentiality", name: "Mental Healthcare Act, 2017 and HIV and AIDS (Prevention and Control) Act, 2017: confidentiality", regulator: "Ministry of Health", kind: "law", confirmed: false, summary: "Special confidentiality for mental health and HIV records, with narrow grounds for disclosure." },
  ],
  controls: [
    { code: "HLT-01", title: "Patient health records: collection, consent and access", type: "preventive", instrument: "abdm", description: "Patient records are collected with explicit consent, shared only through recorded consent, and visible to staff only to the extent their role needs.", related: ["CON-01", "SEC-02", "ACC-01"] },
    { code: "HLT-02", title: "Special confidentiality for mental health and HIV records", type: "preventive", instrument: "special-confidentiality", description: "Mental health and HIV records are kept separately with tighter access, and disclosed only on the narrow legal grounds the Acts allow.", related: ["SEC-02"] },
    { code: "HLT-03", title: "Teleconsultation records and patient identification", type: "preventive", instrument: "telemed", description: "Teleconsultations identify the patient, record consent, and the consultation records are stored securely and shared only with the patient and care team.", related: ["CON-01", "SEC-01"] },
    { code: "HLT-04", title: "Patient right to a copy of their record", type: "corrective", instrument: "ce-act", description: "Patients can obtain a copy of their medical record on request within a defined time, and the request is logged.", related: ["RIG-01"] },
    { code: "HLT-05", title: "Lab, pharmacy and insurer data sharing", type: "preventive", instrument: "abdm", description: "Patient data shared with labs, pharmacies, insurers and research partners goes under written agreements, with identifiable data limited to what each recipient needs.", related: ["PRO-01", "PUR-01"] },
  ],
  dpdpInterplay: [
    "DPDP Rule 12 and the Fourth Schedule exempt clinical establishments, healthcare professionals and allied health services from the parental consent requirement for children, but only for health services to the child and only as far as needed to protect the child's health.",
    "Health data is among the most sensitive personal data. Look closely at whether a firm could be notified as a Significant Data Fiduciary.",
    "Medical record retention periods under clinical rules limit erasure (DPDP s.8(7)).",
  ],
  typicalEvidence: ["Patient consent form", "Role-based access matrix for the hospital information system", "Telemedicine consent record", "Records retention policy", "Lab and pharmacy data sharing agreement"],
};
