// Where the DPDP Act and a sector's own rules cover the same ground, and which one governs.
//
// The Act is cumulative: section 38(1) says it applies in addition to other laws, and 38(2)
// says it prevails to the extent of a conflict. It is NOT the case that a sector rule simply
// replaces it. But some provisions point back to other laws on purpose: erasure gives way to a
// legal duty to retain (s.8(7)), a stricter law on transfers abroad still applies (s.16(2)), and
// some uses are allowed without consent when the law requires them (s.7). This register records
// each such place, so the Resources page, the control notes, the applicability reasons and the
// assessment can all flag it instead of leaving it to be spotted.
//
// Every entry is a working note for the Primus team, not legal advice, and carries
// `legalReview: true` until a lawyer has confirmed it. Nothing here changes what is scored.

import type { SectorKey } from "./types";

export type OverlapEffect =
  | "both_apply"
  | "extra_reporting"
  | "sector_retention"
  | "sector_transfer"
  | "legal_duty"
  | "dpdp_carveout"
  | "needs_legal";

/** What each kind of overlap means, in plain words: which rule governs and what to do about it. */
export const EFFECT: Record<OverlapEffect, { label: string; governs: string; tone: "neutral" | "warning" | "positive" | "critical" }> = {
  both_apply: { label: "Both apply", governs: "Both the DPDP Act and the sector rule apply. Where they differ, follow the stricter one.", tone: "neutral" },
  extra_reporting: { label: "Report to each", governs: "Both apply. The sector report is in addition to the DPDP report, not instead of it.", tone: "warning" },
  sector_retention: { label: "Law lets you keep it", governs: "Erasure (s.8(7)) gives way where a law requires you to keep the record. Delete only what no law makes you keep, and write down the legal period.", tone: "warning" },
  sector_transfer: { label: "Sector rule is stricter", governs: "A stricter law on sending data outside India still applies (s.16(2)). Follow the sector rule.", tone: "critical" },
  legal_duty: { label: "Law requires this use", governs: "Where a law requires the use, consent is not needed for that use (s.7). Keep to what the law asks and no more.", tone: "neutral" },
  dpdp_carveout: { label: "DPDP carve-out", governs: "The DPDP Act or Rules themselves exempt this, narrowly. Use the exemption only as far as it reaches.", tone: "positive" },
  needs_legal: { label: "Take legal advice", governs: "The position is not settled or depends on a notification. Get a legal view before relying on either side.", tone: "critical" },
};

export interface Overlap {
  id: string;
  sector: SectorKey;
  /** What the two sets of rules both cover. */
  topic: string;
  /** The DPDP provision involved. */
  dpdp: string;
  /** The sector rule involved, in words. */
  sectorRule: string;
  /** The sector instrument it comes from, where it is listed in the catalogue. */
  instrument?: string;
  effect: OverlapEffect;
  /** What to do about it, in a sentence or two. */
  whatToDo: string;
  /** Controls this touches (DPDP or sector). */
  controls: string[];
  /** True until a lawyer has confirmed the entry. */
  legalReview: boolean;
}

const o = (id: string, sector: SectorKey, topic: string, dpdp: string, sectorRule: string, effect: OverlapEffect, whatToDo: string, controls: string[], instrument?: string): Overlap => ({ id, sector, topic, dpdp, sectorRule, instrument, effect, whatToDo, controls, legalReview: true });

export const OVERLAPS: Overlap[] = [
  // ---- every sector
  o("all-breach", "all", "Reporting a breach", "s.8(6); Rule 7", "CERT-In Directions, 2022: report within six hours", "extra_reporting", "Report to CERT-In within six hours. In addition, tell the Data Protection Board and each affected person as the Rules require. One incident can need several reports.", ["BRE-01", "BRE-02", "CYB-01"], "cert-in-2022"),
  o("all-logs", "all", "How long to keep logs", "Rule 8", "CERT-In Directions, 2022: keep ICT logs for 180 days", "both_apply", "Keep logs for the longer of the two periods, and say which rule sets each period in your retention schedule.", ["RET-01", "CYB-02"], "cert-in-2022"),
  o("all-marketing", "all", "Marketing calls and messages", "s.6", "TRAI commercial communications rules: preferences and do-not-disturb", "both_apply", "Check the person's DPDP consent and their telecom preference before you contact them. Honour whichever refuses.", ["CON-01", "CYB-03"], "tccccpr"),
  o("all-legal-retention", "all", "Deleting data you must keep under tax or company law", "s.8(7); Rule 8", "Tax, accounting and company law record-keeping periods", "sector_retention", "Do not delete records that tax, accounting or company law require you to keep. Write the law and the period next to each record type in your retention schedule.", ["RET-01"]),

  // ---- banking
  o("bnk-kyc", "banking", "Deleting KYC and transaction records", "s.8(7); s.12", "RBI KYC directions and the PMLA: keep KYC and transaction records for the prescribed period", "sector_retention", "A customer's erasure request does not reach KYC and transaction records you must keep. Say so in your reply, and delete once the legal period ends.", ["RET-01", "BNK-03"], "rbi-kyc"),
  o("bnk-payment", "banking", "Storing payment data outside India", "s.16", "RBI storage of payment system data: data stored only in India", "sector_transfer", "Keep payment data in India as the RBI requires. The Act's general freedom to transfer does not loosen that.", ["XBR-01", "BNK-04"], "rbi-payment-data"),
  o("bnk-lending", "banking", "Consent in digital lending", "s.6", "RBI digital lending directions: need-based data, explicit consent", "both_apply", "Check each permission you ask for against both. The tighter limit on what a lending app may collect applies.", ["CON-01", "BNK-05"], "rbi-digital-lending"),
  o("bnk-incident", "banking", "Reporting a cyber incident", "s.8(6); Rule 7", "RBI cyber incident reporting", "extra_reporting", "Report to the RBI as it requires and, separately, to the Board and the people affected.", ["BRE-01", "BNK-06"], "rbi-cyber"),
  o("bnk-outsourcing", "banking", "Service providers that handle customer data", "s.8(2)", "RBI outsourcing and IT governance directions", "both_apply", "Use one contract that meets both: the RBI's terms on audit and exit, and the DPDP duty to bind the processor.", ["PRO-01", "BNK-02"], "rbi-outsourcing"),

  // ---- broking
  o("brk-retention", "broking", "Deleting client and order records", "s.8(7); s.12", "SEBI record-keeping rules and the PMLA", "sector_retention", "Client records, order logs and recorded communications stay for the SEBI and PMLA period. Delete after it ends, not on request.", ["RET-01", "BRK-11", "BRK-12"], "pmla"),
  o("brk-incident", "broking", "Reporting a cyber incident", "s.8(6); Rule 7", "SEBI and exchange reporting within six hours", "extra_reporting", "One incident can need four reports: SEBI, the exchange, CERT-In and the Data Protection Board with the people affected.", ["BRE-01", "BRK-02"], "sebi-cyber-6h"),
  o("brk-outsourcing", "broking", "Cloud and outsourced providers", "s.8(2); s.16", "SEBI outsourcing and cloud rules, including where data sits", "both_apply", "Meet the SEBI terms on due diligence and data location, and bind the provider as the Act requires.", ["PRO-01", "XBR-01", "BRK-06"], "sebi-outsourcing"),

  // ---- insurance
  o("ins-retention", "insurance", "Deleting policy and claims records", "s.8(7); s.12", "IRDAI record-keeping rules", "sector_retention", "Policy and claims records stay for the IRDAI period. Delete after it ends.", ["RET-01", "INS-04"], "irdai-records"),
  o("ins-incident", "insurance", "Reporting a cyber incident", "s.8(6); Rule 7", "IRDAI cyber incident reporting", "extra_reporting", "Report to IRDAI as it requires and, separately, to the Board and the people affected.", ["BRE-01", "INS-05"], "irdai-cyber"),
  o("ins-outsourcing", "insurance", "Agents, TPAs and other intermediaries", "s.8(2)", "IRDAI outsourcing rules", "both_apply", "Meet the IRDAI terms and bind each intermediary as the Act requires.", ["PRO-01", "INS-03"], "irdai-outsourcing"),

  // ---- healthcare
  o("hlt-retention", "healthcare", "Deleting medical records", "s.8(7); s.12", "Clinical establishment and medical council rules on record retention", "sector_retention", "A patient's erasure request does not reach records you must keep. Say so, and delete after the legal period.", ["RET-01", "HLT-01"], "ce-act"),
  o("hlt-confidential", "healthcare", "Mental health and HIV records", "s.8(5)", "Special confidentiality rules for mental health and HIV", "both_apply", "Treat these records under the stricter confidentiality rules as well as the DPDP safeguards.", ["SEC-01", "HLT-02"], "special-confidentiality"),
  o("hlt-children", "healthcare", "Children's data in treatment", "s.9; Rule 12; Fourth Schedule", "Clinical practice duties to the child", "dpdp_carveout", "Parental consent is not needed for health services to the child, and only as far as needed to protect the child's health. Do not stretch it to marketing.", ["CHI-01"]),

  // ---- pharma
  o("pha-records", "pharma", "Deleting trial and quality records", "s.8(7)", "New Drugs and Clinical Trials Rules and good practice: keep trial records for the prescribed period", "sector_retention", "Trial and quality records stay for the prescribed period, whatever a participant later asks.", ["RET-01", "PHA-06"], "ndct"),
  o("pha-withdrawal", "pharma", "A participant withdraws consent", "s.6(4)", "Trial rules on data already collected", "sector_retention", "Stop further collection when a participant withdraws. Data already collected for the trial analysis may have to stay. Say so in the consent form.", ["CON-02", "PHA-01"], "icmr"),
  o("pha-transfer", "pharma", "Sending trial data to sponsors or labs abroad", "s.16", "Trial and research approvals on export of data and samples", "sector_transfer", "Check the approvals for exporting trial data in addition to the Act's freedom to transfer.", ["XBR-01", "PHA-04"], "ndct"),

  // ---- telecom
  o("tel-retention", "telecom", "Deleting subscriber and call records", "s.8(7); Rule 8", "Telecom licence and rules on KYC and call-record retention", "sector_retention", "Keep subscriber KYC and call records for the period the telecom rules set. Delete after it ends.", ["RET-01", "TEL-02", "TEL-03"], "subscriber-kyc"),
  o("tel-incident", "telecom", "Reporting a telecom cyber incident", "s.8(6); Rule 7", "Telecom cyber security rules", "extra_reporting", "Report to the telecom authority as the rules require and, separately, to the Board and the people affected.", ["BRE-01", "TEL-01"], "telecom-cyber-rules"),
  o("tel-marketing", "telecom", "Commercial messages and preferences", "s.6", "TRAI preference register rules", "both_apply", "Check both before sending a promotion.", ["CON-01", "TEL-04"], "tccccpr-tel"),

  // ---- e-commerce
  o("ecm-grievance", "ecommerce", "Handling complaints", "s.8(10); s.13", "Consumer Protection (E-Commerce) Rules: grievance officer and timelines", "both_apply", "One complaints route can serve both, if it meets the shorter timeline and names the officer.", ["RIG-02", "ECM-01"], "ecom-rules"),
  o("ecm-card", "ecommerce", "Storing card details", "s.8(5)", "RBI card tokenisation rules", "both_apply", "Do not store raw card numbers. The RBI rule is stricter than the general duty to secure data.", ["SEC-01", "ECM-03"], "card-token"),
  o("ecm-dark", "ecommerce", "Tricks in consent and sign-up screens", "s.6", "Guidelines on dark patterns", "both_apply", "A consent given through a misleading screen fails the Act's test as well as the guidelines.", ["CON-01", "ECM-02"], "dark-patterns"),

  // ---- OTT
  o("ott-grievance", "ott", "Complaints and takedowns", "s.8(10); s.13", "IT Rules 2021: grievance officer and timelines", "both_apply", "Run one route that meets the stricter timeline. Keep complainants' details apart from the review team.", ["RIG-02", "OTT-03"], "it-rules-2021"),
  o("ott-children", "ott", "Children's access and profiles", "s.9", "Age classification and parental locks under the IT Rules", "both_apply", "Meet the parental-lock rules and the Act's duty of verifiable parental consent and no tracking.", ["CHI-01", "OTT-01"], "it-rules-2021"),

  // ---- aviation
  o("avi-authorities", "aviation", "Sharing passenger data with border and security authorities", "s.7", "Passenger name record and advance passenger information rules", "legal_duty", "Share what the law requires with the authorities named. Do not share more, and tell passengers in the notice.", ["PUR-01", "LEG-01", "AVI-01"], "pnr"),
  o("avi-biometric", "aviation", "Face recognition at boarding", "s.6", "DigiYatra scheme: voluntary, with deletion", "both_apply", "Keep it opt-in with a real alternative, and delete the data as the scheme says.", ["CON-01", "AVI-02"], "digiyatra"),

  // ---- logistics
  o("log-records", "logistics", "Deleting shipment and e-way bill records", "s.8(7)", "Tax and e-way bill record-keeping", "sector_retention", "Keep shipment records that tax law requires. Mask or delete the rest on the schedule you set.", ["RET-01", "LOG-03"], "eway"),

  // ---- energy
  o("ene-incident", "energy", "Reporting an incident on critical systems", "s.8(6); Rule 7", "CEA cyber security rules and the critical information infrastructure regime", "extra_reporting", "Report to the sector and CERT-In as the rules require and, separately, to the Board and the people affected.", ["BRE-01", "ENE-04"], "cea-cyber"),
  o("ene-records", "energy", "Deleting billing and connection records", "s.8(7)", "Electricity Act record-keeping", "sector_retention", "Keep billing and connection records for the period the sector rules set.", ["RET-01", "ENE-02"], "electricity-act"),

  // ---- manufacturing
  o("mfg-records", "manufacturing", "Deleting worker and payroll records", "s.8(7)", "Labour codes and the Factories Act: record-keeping", "sector_retention", "Keep worker, attendance and payroll records for the legal period, and delete after it.", ["RET-01", "MFG-01"], "labour-codes"),
  o("mfg-employment", "manufacturing", "Using worker data for employment", "s.7", "Labour law duties", "legal_duty", "The Act allows use for employment without consent. Keep it to what the job and the law need, and tell workers.", ["LEG-01", "MFG-01"]),

  // ---- real estate
  o("rea-records", "realestate", "Deleting buyer and project records", "s.8(7)", "RERA record-keeping", "sector_retention", "Keep allottee and project records for the period RERA sets.", ["RET-01", "REA-02"], "rera"),
  o("rea-leads", "realestate", "Calling buyers and leads", "s.6", "TRAI rules on unsolicited calls", "both_apply", "Check consent and the preference register before calling.", ["CON-01", "REA-01"], "trai-leads"),

  // ---- IT, BPO and GCC
  o("itb-foreign", "itbpo", "Client data from outside India", "s.17(1); s.8(5)", "The client's own law and contract (for example the GDPR)", "both_apply", "Follow the client's law and contract as well as the Act. Where the Act exempts offshore processing, the security duty still applies.", ["PRO-01", "ITB-01", "ITB-02"], "dpdp-offshore"),
  o("itb-carveout", "itbpo", "Processing data of people outside India under a foreign contract", "s.17(1)", "Client contract terms", "dpdp_carveout", "The Act exempts many duties for this work, narrowly. Record which data is in and which is out.", ["ITB-01"], "dpdp-offshore"),

  // ---- AI
  o("ai-none", "ai", "Training and using AI on personal data", "s.4; s.6", "No AI-specific law yet; government advisories on deepfakes", "needs_legal", "The Act applies in full to personal data used in training and use. Advisories are guidance, not law. Take legal advice on new uses.", ["AIA-01", "AIA-05"], "deepfake-advisories"),

  // ---- education
  o("edu-records", "education", "Deleting student and exam records", "s.8(7)", "Board and university rules on student and exam records", "sector_retention", "Keep records for the period the board or university sets, and delete after it.", ["RET-01", "EDU-03"], "edu-records"),
  o("edu-children", "education", "Tracking and consent for students", "s.9; Rule 12; Fourth Schedule", "Educational activity and student safety", "dpdp_carveout", "The exemption covers tracking and monitoring needed for educational activity or safety, and no more. It does not cover marketing or analytics.", ["CHI-01", "EDU-01", "EDU-02"], "dpdp-children-edu"),
  o("edu-coaching", "education", "Coaching centre registration and student data", "s.5; s.6", "Ministry of Education coaching centre guidelines, adopted by States", "both_apply", "Follow your State's registration rules and the Act on enrolment, marketing and results.", ["EDU-07", "NOT-01"], "moe-coaching"),

  // ---- government and PSU
  o("gvt-state", "government", "Using citizen data for benefits and services", "s.7(b); s.17(2); Rule 5", "Rules for the State and its agencies", "dpdp_carveout", "The State can use data without consent for benefits and services. A wider exemption needs a notification for that agency, so do not assume one.", ["LEG-01", "GVT-01"], "dpdp-state"),
  o("gvt-rti", "government", "Releasing personal data under RTI", "s.44(3)", "RTI Act s.8(1)(j) as amended", "both_apply", "Review each reply for personal information under the amended exemption, and record the decision.", ["ACC-01", "GVT-04"], "rti"),
  o("gvt-aadhaar", "government", "Aadhaar numbers", "s.8(5)", "Aadhaar Act: collection, storage and authentication", "both_apply", "Follow the stricter Aadhaar Act rules on storage and use.", ["SEC-01", "GVT-02"], "aadhaar"),
  o("psu-state", "psu", "State function or commercial activity", "s.7(b); s.17(2)", "PSU status and notifications", "needs_legal", "Whether a function counts as State use depends on the function and any notification. Take legal advice for each, and do not assume it for commercial activity.", ["LEG-01", "PSU-01"], "dpdp-state-psu"),
  o("psu-rti", "psu", "Releasing personal data under RTI", "s.44(3)", "RTI Act s.8(1)(j) as amended", "both_apply", "Review each reply for personal information under the amended exemption.", ["ACC-01", "PSU-02"], "rti-psu"),
  o("psu-vigilance", "psu", "Vigilance and audit access", "s.7", "CVC and CAG access rights", "legal_duty", "Give vigilance and audit what the law entitles them to and keep the access logged.", ["LEG-01", "PSU-04"], "cvc-cag"),

  // ---- MSME
  o("msm-exempt", "msme", "A startup or small-business exemption", "s.17(3)", "Government notification (none assumed)", "needs_legal", "The Act exempts a class only after a notification. Until you have confirmed one covers the client, treat the Act as applying in full.", ["MSM-06"], "dpdp-msme"),
];

export const overlapsForSector = (key: SectorKey): Overlap[] => OVERLAPS.filter((x) => x.sector === key);

/** Overlaps that touch a control: the ones for every sector, plus the ones for the sectors in play (all sectors when none is given). */
export function overlapsForControl(code: string, sectors?: SectorKey[]): Overlap[] {
  return OVERLAPS.filter((x) => x.controls.includes(code) && (x.sector === "all" || !sectors || sectors.includes(x.sector)));
}

/** The overlaps that apply to an engagement: those for every sector, plus those of its sectors. */
export function overlapsForSectors(sectors: SectorKey[]): Overlap[] {
  return OVERLAPS.filter((x) => x.sector === "all" || sectors.includes(x.sector));
}
