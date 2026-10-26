import type { Sector } from "../types";

export const AVIATION: Sector = {
  key: "aviation",
  label: "Aviation and travel",
  prefix: "AVI",
  blurb: "Airlines, airports, travel agencies and ground handlers: passenger data, biometric boarding and aviation security rules on top of DPDP.",
  regulators: ["DGCA", "BCAS", "Ministry of Civil Aviation"],
  instruments: [
    { id: "pnr", name: "Passenger Name Record Information Regulations, 2022", regulator: "Ministry of Civil Aviation", kind: "regulation", confirmed: false, summary: "Airlines provide passenger name record data to the Passenger Information Unit and protect it as the regulations require." },
    { id: "digiyatra", name: "DigiYatra biometric boarding framework", regulator: "Ministry of Civil Aviation", kind: "policy", confirmed: false, summary: "Consent-based facial recognition for boarding, with passenger data kept in the passenger's own wallet and deleted after the journey as the policy specifies." },
    { id: "bcas", name: "BCAS aviation security requirements", regulator: "BCAS", kind: "directions", confirmed: false, summary: "Security programmes for airports and airlines, including cyber security for critical aviation systems." },
  ],
  controls: [
    { code: "AVI-01", title: "Passenger data: collection, sharing with authorities and retention", type: "preventive", instrument: "pnr", description: "Passenger data is collected for booking and travel, shared with authorities only as the regulations require, and kept for no longer than the stated period.", related: ["INV-01", "RET-01", "PUR-01"] },
    { code: "AVI-02", title: "Biometric boarding: consent and deletion", type: "preventive", instrument: "digiyatra", description: "Biometric boarding is opt-in with recorded consent, an alternative is offered, and biometric data is deleted after the journey as the framework specifies.", related: ["CON-01", "RET-01"] },
    { code: "AVI-03", title: "Cyber security for aviation and booking systems", type: "preventive", instrument: "bcas", description: "Booking, check-in and operational systems have a cyber security programme, access controls and incident reporting in line with aviation security requirements.", related: ["SEC-01", "BRE-01"] },
    { code: "AVI-04", title: "Travel partners and international data sharing", type: "preventive", instrument: "pnr", description: "Data shared with travel agents, airlines abroad and ground handlers goes under agreements, with foreign transfers checked against DPDP s.16.", related: ["PRO-01", "XBR-01"] },
  ],
  dpdpInterplay: [
    "Passenger data crosses borders every day. DPDP s.16 allows transfers except to countries the Government restricts, and sector rules may add duties.",
    "Passenger sharing with security authorities falls under the State exemptions of DPDP s.17(2).",
  ],
  typicalEvidence: ["Passenger privacy notice", "DigiYatra consent screen", "Passenger data retention schedule", "Agreements with travel partners", "Aviation cyber security programme"],
};
