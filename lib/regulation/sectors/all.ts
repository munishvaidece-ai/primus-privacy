import type { Sector } from "../types";

export const ALL: Sector = {
  key: "all",
  label: "Across all sectors",
  prefix: "CYB",
  blurb: "Rules that apply whatever the sector: the IT Act, the CERT-In cyber incident directions, and commercial-communication rules.",
  regulators: ["MeitY", "CERT-In", "TRAI"],
  instruments: [
    { id: "cert-in-2022", name: "CERT-In Directions of 28 April 2022 (IT Act s.70B(6))", regulator: "CERT-In, MeitY", kind: "directions", confirmed: true, source: "https://nishithdesai.com/research-and-articles/hotline/technology-law-analysis/cert-in-releases-faqs-explaining-the-direction-on-cybersecurity-6139", summary: "Report specified cyber incidents and data breaches within 6 hours of noticing them; keep ICT logs for a rolling 180 days within India; synchronise clocks to NIC or NPL time servers. Non-compliance can bring up to one year's imprisonment, a fine of up to ₹1 lakh, or both (s.70B(7))." },
    { id: "it-act", name: "Information Technology Act, 2000 and the SPDI Rules, 2011", regulator: "MeitY", kind: "law", confirmed: false, summary: "Section 43A (compensation for failing to protect sensitive personal data) and the SPDI Rules set the current baseline for body corporates. The DPDP Act amends the IT Act (s.44); check which parts are in force on the date you advise." },
    { id: "tccccpr", name: "TRAI Telecom Commercial Communications Customer Preference Regulations, 2018", regulator: "TRAI", kind: "regulation", confirmed: false, summary: "Promotional calls and SMS must go through registered headers and templates, honour customer preferences and Do Not Disturb, and keep consent records." },
  ],
  controls: [
    { code: "CYB-01", title: "Cyber incident reporting to CERT-In within six hours", type: "corrective", instrument: "cert-in-2022", description: "A documented procedure reports specified cyber incidents and personal data breaches to CERT-In within six hours of noticing them, with a named person responsible and a record of each report.", related: ["BRE-01", "BRE-02"] },
    { code: "CYB-02", title: "ICT log retention and time synchronisation", type: "detective", instrument: "cert-in-2022", description: "Logs of all ICT systems are enabled and kept for a rolling 180 days within India (or producible to CERT-In), and system clocks are synchronised to NIC or NPL time servers.", related: ["SEC-01"] },
    { code: "CYB-03", title: "Commercial communications consent and preference register", type: "preventive", instrument: "tccccpr", description: "Promotional calls and messages use registered headers and templates, respect customer Do Not Disturb preferences and are backed by a consent register.", related: ["CON-01", "CON-03"] },
  ],
  dpdpInterplay: [
    "The CERT-In six-hour report and the DPDP breach intimation (s.8(6), Rule 7) are separate duties to separate bodies. One incident can trigger both.",
    "DPDP Rule 8 asks for logs to be retained for one year; CERT-In asks for 180 days. Keep the longer period.",
  ],
  typicalEvidence: ["Incident response plan naming the CERT-In reporting contact", "Sample CERT-In incident report", "Log retention configuration or SIEM retention screenshot", "NTP configuration", "DLT registration and consent register"],
};
