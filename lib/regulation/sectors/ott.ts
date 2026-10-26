import type { Sector } from "../types";

export const OTT: Sector = {
  key: "ott",
  label: "OTT, media and gaming",
  prefix: "OTT",
  blurb: "Streaming, publishing, social media and online gaming: viewer profiling, children's access controls and platform rules on top of DPDP.",
  regulators: ["MeitY", "Ministry of Information and Broadcasting"],
  instruments: [
    { id: "it-rules-2021", name: "Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021", regulator: "MeitY, MIB", kind: "rules", confirmed: false, summary: "Grievance redressal, content classification and age ratings, parental locks and access control for content rated for older audiences." },
    { id: "dpdp-third-schedule-ott", name: "DPDP Rules, Third Schedule: retention for social media and online gaming", regulator: "MeitY", kind: "rules", confirmed: true, summary: "Social media intermediaries and online gaming intermediaries above stated user thresholds erase data after three years of inactivity, with 48 hours' advance notice." },
  ],
  controls: [
    { code: "OTT-01", title: "Age classification, parental locks and child access", type: "preventive", instrument: "it-rules-2021", description: "Content is age-rated, parental locks and access controls exist for older-rated content, and child profiles do not track or target behaviour.", related: ["CHI-01"] },
    { code: "OTT-02", title: "Viewer profiling and recommendation transparency", type: "preventive", instrument: "it-rules-2021", description: "Viewing history profiling and recommendations are disclosed in the notice, rest on withdrawable consent, and can be switched off.", related: ["NOT-01", "CON-01", "PUR-01"] },
    { code: "OTT-03", title: "User grievance officer and takedown handling", type: "corrective", instrument: "it-rules-2021", description: "A grievance officer is named, user complaints are answered in the prescribed time, and records are kept.", related: ["RIG-02"] },
    { code: "OTT-04", title: "Inactivity erasure for gaming and social platforms", type: "preventive", instrument: "dpdp-third-schedule-ott", description: "Where the Third Schedule applies, accounts and data are erased after three years of inactivity with advance notice, subject to legal retention.", related: ["RET-01"] },
  ],
  dpdpInterplay: [
    "DPDP s.9 bars tracking, behavioural monitoring and targeted advertising directed at children. Child profiles on streaming and gaming services need specific design attention.",
    "Gaming platforms handle payments and sometimes minors' data. Check both the children's controls and the Third Schedule.",
  ],
  typicalEvidence: ["Parental lock settings screenshot", "Recommendation settings and notice text", "Grievance officer page", "Age verification flow description", "Inactivity erasure job configuration"],
};
