import type { Sector } from "../types";

export const BANKING: Sector = {
  key: "banking",
  label: "Banking, NBFC and payments",
  prefix: "BNK",
  blurb: "Banks, non-bank lenders and payment firms regulated by the RBI: IT governance, outsourcing, KYC, payment data and digital lending rules sit on top of DPDP.",
  regulators: ["RBI", "NPCI", "FIU-IND"],
  instruments: [
    { id: "rbi-it-gov", name: "RBI Master Direction on Information Technology Governance, Risk, Controls and Assurance Practices (2023)", regulator: "RBI", kind: "directions", confirmed: false, summary: "Board-level IT governance, a named head of information security, risk and control practices, and independent assurance over IT systems." },
    { id: "rbi-outsourcing", name: "RBI Master Direction on Outsourcing of Information Technology Services (2023)", regulator: "RBI", kind: "directions", confirmed: false, summary: "Due diligence, a written agreement, regulator and auditor access, data protection and exit plans for IT outsourcing and cloud." },
    { id: "rbi-kyc", name: "RBI Master Direction on Know Your Customer (KYC), 2016, as amended", regulator: "RBI", kind: "directions", confirmed: false, summary: "Customer identification, periodic KYC updating and record keeping for the periods the Direction sets." },
    { id: "rbi-payment-data", name: "RBI directive on storage of payment system data (April 2018)", regulator: "RBI", kind: "directions", confirmed: false, summary: "Payment system data is stored only in India, with a limited exception for the foreign leg of a cross-border transaction." },
    { id: "rbi-digital-lending", name: "RBI Digital Lending Directions (2025) and earlier guidelines", regulator: "RBI", kind: "directions", confirmed: false, summary: "Borrower data collection is need-based with prior consent, data is stored on servers in India, and lending apps disclose what they collect and why." },
    { id: "rbi-cyber", name: "RBI cyber security framework and incident reporting directions", regulator: "RBI", kind: "directions", confirmed: false, summary: "A cyber security policy, a security operations capability and prompt reporting of cyber incidents to the RBI." },
  ],
  controls: [
    { code: "BNK-01", title: "IT governance and a named head of information security", type: "preventive", instrument: "rbi-it-gov", description: "The board approves an IT and information security policy, a senior officer is accountable for information security, and independent assurance reviews the systems that hold customer data.", related: ["GOV-01", "SEC-01"] },
    { code: "BNK-02", title: "IT outsourcing and cloud: contract, data protection and exit", type: "preventive", instrument: "rbi-outsourcing", description: "Each IT or cloud provider that handles customer data is vetted, bound by a written agreement on security, data location and regulator access, monitored, and covered by an exit plan.", related: ["PRO-01", "PRO-02"] },
    { code: "BNK-03", title: "KYC records: collection, updating and retention", type: "preventive", instrument: "rbi-kyc", description: "Customer identity records are collected for the stated purpose, updated at the prescribed interval, protected, and kept for the periods the KYC Direction and PMLA set.", related: ["INV-01", "RET-01"] },
    { code: "BNK-04", title: "Payment data stored in India", type: "preventive", instrument: "rbi-payment-data", description: "Payment system data is stored in India only, and any foreign processing is limited to what the RBI permits and then deleted from foreign systems within the stated time.", related: ["XBR-01"] },
    { code: "BNK-05", title: "Digital lending: need-based data collection and consent", type: "preventive", instrument: "rbi-digital-lending", description: "Lending apps collect only borrower data the loan needs, ask for explicit consent for each purpose, do not read contacts or files without need, and keep data on servers in India.", related: ["CON-01", "PUR-01"] },
    { code: "BNK-06", title: "Cyber incident reporting to the RBI", type: "corrective", instrument: "rbi-cyber", description: "Cyber incidents are reported to the RBI within the prescribed time, in addition to the CERT-In and DPDP reports, with a record of each.", related: ["BRE-01", "BRE-02", "CYB-01"] },
  ],
  dpdpInterplay: [
    "KYC and transaction records kept under the RBI and PMLA limit a customer's erasure right (DPDP s.8(7)). The retention schedule must show the legal period for each record.",
    "The RBI payment data rule is stricter than DPDP s.16 cross-border transfer (which allows transfers except to restricted countries). Where both apply, follow the stricter one.",
    "Lenders collecting contacts, location or files through apps should check consent against DPDP s.6 and the RBI digital lending directions together.",
    "Banks and large lenders are strong candidates for Significant Data Fiduciary status.",
  ],
  typicalEvidence: ["Board-approved IT and information security policy", "IT outsourcing agreement and exit plan", "KYC policy and re-KYC schedule", "Data localisation attestation for payment data", "Digital lending app consent screens and privacy notice", "Cyber incident register with RBI reports"],
};
