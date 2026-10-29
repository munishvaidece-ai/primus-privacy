// The question bank: sector-specific question sets for the DPDP assessment.
// Pure data and pure functions (no database), so the client portal, the Primus
// question-bank page and the tests all read one definition.
//
// Clients see the common set plus the set for their own sector(s). Primus sees
// the whole bank and can filter it by sector. Answers are stored per set in
// `discovery_sections` under the key `sq_<sector>`, so no extra table is needed.
//
// Questions are written in the second person ("Do you ..."), because the client
// is the one answering. They only ask; they never state what the law requires.
// What a regulator requires is on the Resources page, where each instrument is
// marked as checked or not.

import { SELECTABLE_SECTORS, type SectorKey } from "@/lib/regulation";
import type { Field, Section } from "./discovery-sections";

export type BankSetKey = SectorKey | "common";

export interface BankQuestion extends Field {
  /** The theme the question belongs to, for grouping on the Primus page. */
  topic: string;
}

const CHOICE = [
  { value: "yes", label: "Yes" },
  { value: "partly", label: "Partly" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

/** A yes / partly / no / not-sure question. */
const q = (n: number, topic: string, label: string, help?: string): BankQuestion => ({ key: `q${n}`, topic, label, type: "choice", options: CHOICE, required: true, help });
/** A free-text question. */
const t = (n: number, topic: string, label: string, help?: string): BankQuestion => ({ key: `q${n}`, topic, label, type: "text", help });

export const COMMON_QUESTIONS: BankQuestion[] = [
  q(1, "Notice and consent", "Do you give people a clear notice, in plain language, before you collect their personal data?"),
  q(2, "Notice and consent", "Can people withdraw the consent they gave you as easily as they gave it?"),
  q(3, "Rights", "Do you have a named person or team that answers requests to access, correct or erase personal data?"),
  q(4, "Security", "Do you protect personal data with access controls, encryption and activity logs?"),
  q(5, "Breach", "Do you have a written plan for what to do, and who to tell, if personal data is breached?"),
  q(6, "Vendors", "Do your contracts with vendors who handle personal data include data protection terms?"),
];

const SETS: Partial<Record<SectorKey, BankQuestion[]>> = {
  broking: [
    q(1, "Client onboarding", "Do you collect KYC documents and client details through a process that records why each item is needed?"),
    q(2, "Cyber resilience", "Have you mapped your trading, back-office and client-facing systems to the cyber resilience expectations of your regulator?"),
    q(3, "Third parties", "Do you keep a register of the vendors, sub-brokers and authorised persons who can see client data?"),
    q(4, "Records", "Do you know how long each type of client record must be kept, and do you delete it after that?"),
    q(5, "Communications", "Do you record and protect client calls, chats and emails, and control who can listen to or read them?"),
    q(6, "Incidents", "Can you report a cyber incident to your regulator and to CERT-In within the time they ask for?"),
  ],
  banking: [
    q(1, "Customer data", "Do you hold KYC and account data in systems where you can see who accessed each record?"),
    q(2, "Outsourcing", "Do you review each outsourced service that touches customer data, including fintech and co-lending partners?"),
    q(3, "Data location", "Do you know where payment and customer data is stored, and is it kept in India where your regulator expects it?"),
    q(4, "Credit data", "Do you share data with credit information companies only under the permissions you hold?"),
    q(5, "Fraud and monitoring", "Do your fraud and monitoring tools process personal data under a recorded purpose and retention period?"),
    q(6, "Grievances", "Do customers have one place to raise a privacy complaint, with a response time that you track?"),
  ],
  insurance: [
    q(1, "Health and claims data", "Do you treat health and claims information as high-risk data, with tighter access than other customer data?"),
    q(2, "Intermediaries", "Do you control what personal data agents, brokers and aggregators can see and keep?"),
    q(3, "Underwriting", "Do you tell customers what personal data is used to price their policy, and why?"),
    q(4, "Third parties", "Do third-party administrators, surveyors and investigators sign data protection terms with you?"),
    q(5, "Retention", "Do you have a retention period for proposals that did not become policies?"),
    q(6, "Information security", "Have you checked your information and cyber security practice against the guidelines of your regulator?"),
  ],
  healthcare: [
    q(1, "Patient records", "Do you limit who can open a patient's record to the people involved in their care?"),
    q(2, "Emergencies", "Do you have a written rule for when you can use patient data without asking, for a medical emergency?"),
    q(3, "Digital health", "If you use a national digital health ID or record system, do you collect and share data through its consent process?"),
    q(4, "Diagnostics and labs", "Do you control who receives test results, and how they are sent?"),
    q(5, "Telemedicine", "Do you protect video, chat and prescription data from telemedicine services?"),
    q(6, "Children and guardians", "Do you collect a parent or guardian's consent for a child patient, and record it?"),
  ],
  pharma: [
    q(1, "Clinical trials", "Do you tell trial participants what data is collected, who sees it and how long it is kept, and record their consent?"),
    q(2, "Safety reporting", "Do you handle adverse event and safety reports in a way that protects the reporter and the patient?"),
    q(3, "Patient support programmes", "Do you collect patient data for support programmes only for the purposes you told the patient?"),
    q(4, "Health professionals", "Do you protect the data of doctors and pharmacists you engage, and do you know why you hold each item?"),
    q(5, "Research partners", "Do contract research organisations and labs follow your data protection terms?"),
    q(6, "Cross-border", "Do you know which clinical or safety data goes to your group or regulators outside India?"),
  ],
  telecom: [
    q(1, "Subscriber data", "Do you collect subscriber verification documents under a recorded purpose, and delete them when it ends?"),
    q(2, "Call and usage records", "Do you control who can see call, location and usage records?"),
    q(3, "Lawful requests", "Do you log every government or agency request for subscriber data, with the authority for it?"),
    q(4, "Marketing", "Do you honour marketing preferences and do-not-disturb choices across all your channels?"),
    q(5, "Network and vendors", "Do your network and billing vendors have access only to what they need?"),
    q(6, "Incidents", "Can you report a network or data incident to the telecom regulator within the time asked?"),
  ],
  ecommerce: [
    q(1, "Shoppers", "Do you ask for only the data you need to deliver an order?"),
    q(2, "Sellers", "Do you protect the personal data of sellers and delivery partners as carefully as that of shoppers?"),
    q(3, "Profiling and ads", "Do you tell shoppers about tracking, profiling and personalised ads, and let them say no?"),
    q(4, "Payments", "Do you avoid storing card details, or do you store them only as the payment rules allow?"),
    q(5, "Reviews and support", "Do you control who can see chat transcripts, support calls and order history?"),
    q(6, "Children", "Do you stop children from signing up, or get a parent's consent when they do?"),
  ],
  ott: [
    q(1, "Viewers", "Do you tell viewers what you collect about what they watch, and why?"),
    q(2, "Profiling", "Do you let viewers turn off personalised recommendations and targeted ads?"),
    q(3, "Children's profiles", "Do you handle child profiles with parental consent and without tracking or targeted ads?"),
    q(4, "Devices and accounts", "Do you protect account sharing, device and location data?"),
    q(5, "Ad partners", "Do you control which ad and analytics partners receive viewer data?"),
    q(6, "Content complaints", "Do you keep complainants' details separate from the content review team?"),
  ],
  aviation: [
    q(1, "Passenger data", "Do you collect passenger data for bookings, check-in and security only as needed, and delete it on a schedule?"),
    q(2, "Travel documents", "Do you protect passport and visa data with extra access controls?"),
    q(3, "Sharing", "Do you know which authorities, airports and partners receive passenger data, and under what legal basis?"),
    q(4, "Biometrics", "If you use face or fingerprint for boarding, do passengers choose it with a clear notice?"),
    q(5, "Loyalty", "Do you give loyalty members a way to see, correct and delete their profile?"),
    q(6, "Incidents", "Can you report a data or cyber incident to the aviation regulator and to CERT-In in time?"),
  ],
  logistics: [
    q(1, "Recipients and senders", "Do you limit who can see names, addresses and phone numbers of senders and recipients?"),
    q(2, "Delivery partners", "Do you protect the data of drivers and riders, including location tracking?"),
    q(3, "Proof of delivery", "Do you keep photos, signatures and OTPs for a fixed period and then delete them?"),
    q(4, "Subcontractors", "Do your last-mile partners and subcontractors sign data protection terms with you?"),
    q(5, "Tracking data", "Do you tell people when vehicles, devices or parcels are tracked and why?"),
    q(6, "Customs and borders", "Do you know what shipper and consignee data goes outside India?"),
  ],
  energy: [
    q(1, "Customers", "Do you protect customer and consumption data from smart meters, billing and apps?"),
    q(2, "Critical systems", "Have you separated control-system networks from systems that hold personal data?"),
    q(3, "Field workforce", "Do you protect the identity, location and biometric data of field staff and contractors?"),
    q(4, "Critical infrastructure", "Do you know whether your assets are protected under a critical infrastructure designation, and what that adds to your duties?"),
    q(5, "Vendors", "Do your operations technology vendors reach systems with personal data only through logged, time-limited access?"),
    q(6, "Incidents", "Do you know how a data incident is reported to the sector regulator and to CERT-In?"),
  ],
  manufacturing: [
    q(1, "Employees", "Do you collect biometrics, health records and CCTV of workers only for stated purposes, with a retention period?"),
    q(2, "Contract labour", "Do you hold personal data of contract workers with the same care as that of permanent staff?"),
    q(3, "Dealers and customers", "Do you protect dealer, distributor and warranty customer data in your systems?"),
    q(4, "Connected products", "If your products collect data from users, do you tell them what and why?"),
    q(5, "Plant systems", "Have you kept plant systems and employee data systems apart, with logged access?"),
    q(6, "Suppliers", "Do suppliers who handle your people's data sign data protection terms?"),
  ],
  realestate: [
    q(1, "Buyer leads", "Do you record where each enquiry came from and what the person agreed to be contacted for?"),
    q(2, "Brokers and channel partners", "Do your channel partners follow your rules when they collect and share buyer data?"),
    q(3, "Marketing calls", "Do you check do-not-disturb preferences before calling or messaging a lead?"),
    q(4, "Buyer documents", "Do you protect ID, income and bank documents with limited access and a deletion date?"),
    q(5, "Site visits", "Do you tell people about CCTV, visitor logs and biometric entry at sites and sales offices?"),
    q(6, "Public listings", "Do you publish owner or buyer details only with their permission?"),
  ],
  itbpo: [
    q(1, "Your role", "For each client, do you know whether you are the data fiduciary or only a processor acting on their instructions?"),
    q(2, "Client contracts", "Do your client contracts say what data you may use, for how long and where?"),
    q(3, "Offshore work", "Do you know which client data comes in from outside India, and how that is treated?"),
    q(4, "Employees' data", "Do you protect the personal data of your own staff, including screen and call monitoring?"),
    q(5, "Access", "Do you remove access to client data when a person leaves a project or the company, on the same day?"),
    q(6, "Sub-processors", "Do your own vendors follow the same terms you have with your clients?"),
  ],
  ai: [
    q(1, "Training data", "Do you know what personal data went into training or tuning your models, and where it came from?"),
    q(2, "Inputs", "Do you control what personal data staff and customers can enter into prompts?"),
    q(3, "Decisions about people", "Where your AI output affects a person (credit, hiring, pricing), can that person ask you for a human review?"),
    q(4, "Accuracy", "Do you test model outputs for wrong or made-up facts about real people?"),
    q(5, "Third-party models", "Do you know which AI providers receive your data and what they may do with it?"),
    q(6, "Records", "Do you keep a record of which systems use AI, who owns each, and what data it touches?"),
  ],
  education: [
    q(1, "Students and parents", "Do you collect a parent or guardian's consent for students under 18, and record it?"),
    q(2, "Learning platforms", "Do you stop learning apps from tracking children or showing them targeted ads?"),
    q(3, "Results and records", "Do you control who can see marks, attendance and counselling notes?"),
    q(4, "Admissions", "Do you delete applicants' data when admission cycles end?"),
    q(5, "Online classes", "Do you tell students and parents when sessions are recorded, and who can view the recordings?"),
    q(6, "Staff and alumni", "Do you protect staff and alumni records and tell them what you do with them?"),
  ],
  msme: [
    q(1, "What you hold", "Do you know what personal data you hold, where it is, and who can see it?"),
    q(2, "Basic security", "Do you use strong passwords, two-step sign-in and regular backups for the systems with personal data?"),
    q(3, "Customer messages", "Do you ask customers before sending marketing messages, and stop when asked?"),
    q(4, "Staff", "Do you collect only the staff data you need, and keep it only as long as needed?"),
    q(5, "Help", "Do you have one person who handles privacy requests and breach reports?"),
    q(6, "Tools and vendors", "Do you know which software and service providers hold your customers' data?"),
  ],
  government: [
    q(1, "Services", "For each service that collects citizen data, do you have a written reason for collecting it?"),
    q(2, "Identity numbers", "Do you collect and store Aadhaar and similar numbers only where the law allows, and mask or vault them?"),
    q(3, "Hosting", "Do you host citizen data only with approved providers, and keep it in India?"),
    q(4, "Information requests", "Do you check information requests for personal data before replying?"),
    q(5, "Corrections", "Can citizens correct their records through you, with a named officer and a time limit?"),
    q(6, "Contractors", "Do your contractors and system integrators sign confidentiality and security terms with you?"),
  ],
  psu: [
    q(1, "Statutory basis", "Do you know which of your processing rests on a statute or government function, and which needs consent?"),
    q(2, "Consumers and employees", "Do you treat consumer and employee data with the same notice and security standards?"),
    q(3, "Procurement and tenders", "Do you protect bidders' and vendors' personal data in tender processes?"),
    q(4, "Oversight", "Do your board, vigilance or audit committee review privacy and cyber risk?"),
    q(5, "Public requests", "Do you check personal data in replies to information requests and parliamentary questions?"),
    q(6, "Sector rules", "Do you also follow the rules of the sector you operate in (banking, energy, insurance, and so on)?"),
  ],
};

/** Display title of a set. */
export function bankTitle(key: BankSetKey): string {
  if (key === "common") return "Questions for every organisation";
  return `${SELECTABLE_SECTORS.find((s) => s.key === key)?.label ?? key}: sector questions`;
}

export function questionsFor(key: BankSetKey): BankQuestion[] {
  return key === "common" ? COMMON_QUESTIONS : SETS[key] ?? [];
}

/** A set as a questionnaire section, so the same save and validation code can handle it. */
export function bankSection(key: BankSetKey): Section {
  return {
    key: `sq_${key}`,
    step: 0,
    title: bankTitle(key),
    intro: key === "common" ? "These questions apply to every organisation, whatever the sector." : `These questions are for you because you work in ${SELECTABLE_SECTORS.find((s) => s.key === key)?.label.toLowerCase() ?? key}.`,
    fields: questionsFor(key),
  };
}

/** Every set key that can be saved. */
export const BANK_KEYS: BankSetKey[] = ["common", ...SELECTABLE_SECTORS.map((s) => s.key)];
export const BANK_SECTION_KEYS: string[] = BANK_KEYS.map((k) => `sq_${k}`);

export function bankKeyFromSection(sectionKey: string): BankSetKey | null {
  const k = sectionKey.replace(/^sq_/, "");
  return sectionKey.startsWith("sq_") && (BANK_KEYS as string[]).includes(k) ? (k as BankSetKey) : null;
}

/** Total number of questions in the bank, for the Primus page. */
export const BANK_TOTAL = BANK_KEYS.reduce((n, k) => n + questionsFor(k).length, 0);
