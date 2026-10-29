// The client discovery questionnaire: 13 steps. Pure data and pure functions,
// no database access, so the screens, the server code and the tests share
// one definition.

import { SELECTABLE_SECTORS } from "@/lib/regulation";

export type FieldType = "text" | "yesno" | "choice" | "multi" | "line";

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  /** Must be filled before the step counts as complete. */
  required?: boolean;
}

export interface Section {
  key: string;
  step: number;
  title: string;
  intro: string;
  fields: Field[];
  /** Each choice question also takes a short note. A note is needed to complete the set when the answer is Partly or No. */
  notes?: boolean;
}

/** The key under which the note for a choice question is saved. */
export const noteKey = (fieldKey: string) => `${fieldKey}_note`;
/** Answers that need a note before a set with notes can be marked complete. */
export const NOTE_NEEDED_FOR = ["partly", "no"];

const YES_NO_NOT_SURE = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

const opt = (...pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));

export const SECTIONS: Section[] = [
  {
    key: "organisation_profile",
    step: 1,
    title: "Organisation profile",
    intro: "Tell us about your organisation, its services and its customers.",
    fields: [
      { key: "summary", label: "Summarise the organisation, its services and customer base", type: "text", required: true },
      { key: "sector", label: "Your main sector", type: "choice", required: true, help: "The questions you are asked later, and the rules we show you, follow this choice. If you run a small business, choose your industry here. Primus can add the small-business essentials as well.", options: [...SELECTABLE_SECTORS.map((x) => ({ value: x.key, label: x.label })), { value: "other", label: "Other" }] },
      { key: "employees", label: "Approximate number of employees", type: "choice", required: true, options: opt(["lt_50", "Under 50"], ["50_250", "50 to 250"], ["250_1000", "250 to 1,000"], ["1000_5000", "1,000 to 5,000"], ["gt_5000", "More than 5,000"]) },
      { key: "website", label: "Website", type: "line" },
    ],
  },
  {
    key: "business_units",
    step: 2,
    title: "Business units",
    intro: "List the business units or functions that handle personal data. You can also record them on the Business units page.",
    fields: [
      { key: "units", label: "Business units and what each one does (one per line)", type: "text", required: true },
      { key: "owners", label: "Who owns privacy in each unit?", type: "text" },
    ],
  },
  {
    key: "processing_activities",
    step: 3,
    title: "Processing activities & purposes",
    intro: "What do you do with personal data, and why? The detailed register is kept on the Processing activities page.",
    fields: [
      { key: "activities", label: "Main processing activities (one per line)", type: "text", required: true },
      { key: "purposes", label: "Purposes for which the data is used", type: "text", required: true },
      { key: "automated_decisions", label: "Do any decisions about individuals rely on automated processing?", type: "yesno", required: true },
    ],
  },
  {
    key: "data_categories",
    step: 4,
    title: "Data & Data Principal categories",
    intro: "What kinds of personal data do you hold, and about whom?",
    fields: [
      { key: "data_types", label: "Types of personal data", type: "multi", required: true, options: opt(["identity", "Identity details"], ["contact", "Contact details"], ["financial", "Financial data"], ["health", "Health data"], ["biometric", "Biometric data"], ["location", "Location data"], ["online", "Device and online identifiers"], ["employee", "Employee records"]) },
      { key: "principals", label: "Whose data is it?", type: "multi", required: true, options: opt(["customers", "Customers"], ["employees", "Employees"], ["vendor_contacts", "Vendor and partner contacts"], ["patients", "Patients"], ["visitors", "Website or app visitors"], ["children", "Children (under 18)"]) },
      { key: "children_data", label: "Do you process personal data of children?", type: "yesno", required: true },
      { key: "large_volume", label: "Do you process a large volume of personal data, or sensitive data at scale?", type: "yesno", required: true },
    ],
  },
  {
    key: "systems",
    step: 5,
    title: "Systems & integrations",
    intro: "Which systems hold or move personal data?",
    fields: [
      { key: "systems", label: "Main systems and applications that hold personal data (one per line)", type: "text", required: true },
      { key: "cloud", label: "Is personal data held with a cloud provider?", type: "yesno", required: true },
      { key: "integrations", label: "Important integrations with other systems or partners", type: "text" },
    ],
  },
  {
    key: "lifecycle",
    step: 6,
    title: "Collection, use, sharing, retention",
    intro: "How does personal data move through its life?",
    fields: [
      { key: "collection", label: "How and where is personal data collected?", type: "text", required: true },
      { key: "sharing", label: "Who is personal data shared with?", type: "text", required: true },
      { key: "retention_schedule", label: "Do you have a retention schedule that says how long each type of data is kept?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "erasure_process", label: "Is data erased when it is no longer needed?", type: "choice", required: true, options: YES_NO_NOT_SURE },
    ],
  },
  {
    key: "consent",
    step: 7,
    title: "Consent & processing conditions",
    intro: "On what basis do you process personal data?",
    fields: [
      { key: "relies_on_consent", label: "Do you rely on consent for some or all processing?", type: "yesno", required: true },
      { key: "consent_how", label: "How is consent collected and recorded?", type: "text" },
      { key: "withdrawal", label: "Can people withdraw consent as easily as they gave it?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "notice", label: "Do you give a privacy notice before collecting data?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "legitimate_uses", label: "Do you process data under the 'certain legitimate uses' (for example for employment or by the State)?", type: "yesno" },
    ],
  },
  {
    key: "vendors",
    step: 8,
    title: "Vendors & third parties",
    intro: "Who processes personal data on your behalf?",
    fields: [
      { key: "uses_processors", label: "Do vendors or other third parties process personal data for you?", type: "yesno", required: true },
      { key: "vendor_list", label: "Main vendors that handle personal data (one per line)", type: "text" },
      { key: "contracts", label: "Do all of them have a contract with data protection terms?", type: "choice", required: true, options: opt(["all", "Yes, all"], ["some", "Some"], ["none", "No"], ["unsure", "Not sure"]) },
      { key: "cross_border", label: "Is personal data sent or stored outside India?", type: "yesno", required: true },
      { key: "countries", label: "Which countries?", type: "line" },
    ],
  },
  {
    key: "governance",
    step: 9,
    title: "Governance & policies",
    intro: "Who is accountable, and what is written down?",
    fields: [
      { key: "owner", label: "Who is accountable for data protection (name and role)?", type: "line", required: true },
      { key: "dpo", label: "Is a Data Protection Officer appointed?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "policy", label: "Is there a written privacy policy approved by management?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "training", label: "Do staff complete privacy training each year?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "oversight", label: "Does a board or senior committee review privacy risk?", type: "choice", required: true, options: YES_NO_NOT_SURE },
    ],
  },
  {
    key: "rights",
    step: 10,
    title: "Rights & grievances",
    intro: "How do people exercise their rights?",
    fields: [
      { key: "rights_process", label: "Is there a process to handle access, correction and erasure requests?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "grievance", label: "Is there a grievance redressal mechanism with response times?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "nominee", label: "Can a person nominate someone to exercise their rights?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "volume", label: "About how many rights requests do you receive in a month?", type: "choice", options: opt(["none", "None"], ["lt_10", "Fewer than 10"], ["10_100", "10 to 100"], ["gt_100", "More than 100"]) },
    ],
  },
  {
    key: "incidents",
    step: 11,
    title: "Incident & breach management",
    intro: "What happens when something goes wrong?",
    fields: [
      { key: "breach_plan", label: "Is there a written personal data breach response plan?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "incident_log", label: "Are incidents logged and reviewed?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "cert_in", label: "Do you report cyber incidents to CERT-In within the required time?", type: "choice", required: true, options: YES_NO_NOT_SURE },
      { key: "past_breaches", label: "Describe any personal data breach in the last 3 years", type: "text" },
    ],
  },
  {
    key: "sector",
    step: 12,
    title: "Sector & regulatory applicability",
    intro: "Which sector regulators apply to you?",
    fields: [
      { key: "rbi", label: "Are you regulated by the RBI?", type: "yesno", required: true },
      { key: "sebi", label: "Are you regulated by SEBI?", type: "yesno", required: true },
      { key: "irdai", label: "Are you regulated by IRDAI?", type: "yesno" },
      { key: "other_regulators", label: "Other regulators or standards that apply", type: "text" },
      { key: "sdf", label: "Have you been notified as a Significant Data Fiduciary?", type: "choice", options: YES_NO_NOT_SURE },
    ],
  },
  {
    key: "scope_confirmation",
    step: 13,
    title: "Scope confirmation",
    intro: "Confirm what the assessment should cover. Primus reviews this and approves the final scope.",
    fields: [
      { key: "scope", label: "What should the assessment cover (entities, locations, systems)?", type: "text", required: true },
      { key: "exclusions", label: "Anything that should be left out, and why", type: "text" },
      { key: "confirm", label: "I confirm the answers above are accurate to the best of my knowledge", type: "yesno", required: true },
    ],
  },
];

/** Values the sector question used before it followed the regulation catalogue. */
export const LEGACY_SECTOR_VALUES: Record<string, string> = {
  financial_services: "banking",
  retail_ecommerce: "ecommerce",
  technology: "itbpo",
  media_ott: "ott",
  aviation_travel: "aviation",
};

export const SECTION_KEYS = SECTIONS.map((s) => s.key);
export const sectionByKey = (key: string): Section | undefined => SECTIONS.find((s) => s.key === key);

export type Answers = Record<string, string | string[] | boolean | null>;

/** Cleans an answer set against the section definition. Unknown keys are dropped; bad values become empty. */
export function sanitizeAnswers(section: Section, raw: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const f of section.fields) {
    let v = raw[f.key];
    if (section.key === "organisation_profile" && f.key === "sector" && typeof v === "string" && LEGACY_SECTOR_VALUES[v]) v = LEGACY_SECTOR_VALUES[v];
    if (f.type === "yesno") {
      out[f.key] = v === true || v === "yes" ? true : v === false || v === "no" ? false : null;
    } else if (f.type === "choice") {
      const ok = (f.options ?? []).some((o) => o.value === v);
      out[f.key] = ok ? String(v) : null;
    } else if (f.type === "multi") {
      const allowed = new Set((f.options ?? []).map((o) => o.value));
      const list = Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
      out[f.key] = Array.from(new Set(list.map(String).filter((x) => allowed.has(x))));
    } else {
      out[f.key] = String(v ?? "").trim().slice(0, f.type === "line" ? 300 : 4000);
    }
    if (section.notes && f.type === "choice") out[noteKey(f.key)] = String(raw[noteKey(f.key)] ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  }
  return out;
}

export function isFieldFilled(f: Field, a: Answers): boolean {
  const v = a[f.key];
  if (f.type === "yesno") return v === true || v === false;
  if (f.type === "multi") return Array.isArray(v) && v.length > 0;
  return typeof v === "string" && v.trim().length > 0;
}

/** Fields still needed before a step can be marked complete. */
export function missingFields(section: Section, answers: Answers): Field[] {
  const missing = section.fields.filter((f) => f.required && !isFieldFilled(f, answers));
  if (!section.notes) return missing;
  const needNote = section.fields
    .filter((f) => f.type === "choice" && typeof answers[f.key] === "string" && NOTE_NEEDED_FOR.includes(answers[f.key] as string) && !String(answers[noteKey(f.key)] ?? "").trim())
    .map((f) => ({ ...f, label: `A short note for "${f.label.slice(0, 60)}${f.label.length > 60 ? "…" : ""}"` }));
  return [...missing, ...needNote];
}

/** The confirmation tick must be a yes. */
export function sectionComplete(section: Section, answers: Answers): boolean {
  if (missingFields(section, answers).length > 0) return false;
  if (section.key === "scope_confirmation" && answers.confirm !== true) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Indicative obligations, worked out from the answers. This is a preview for
// the client; the Primus team makes the real applicability decision.
// ---------------------------------------------------------------------------
export type Likelihood = "applicable" | "potential" | "not_applicable";
export interface ObligationPreview {
  ref: string;
  title: string;
  source: "Act" | "Rules" | "Sector" | "Good practice";
  status: Likelihood;
  reason: string;
}

export type AllAnswers = Record<string, Answers>;
const yes = (a: AllAnswers, section: string, key: string) => a[section]?.[key] === true;
const answered = (a: AllAnswers, section: string, key: string) => a[section]?.[key] !== undefined && a[section]?.[key] !== null && a[section]?.[key] !== "";
const has = (a: AllAnswers, section: string, key: string, value: string) => {
  const v = a[section]?.[key];
  return Array.isArray(v) ? v.includes(value) : v === value;
};

export function previewObligations(a: AllAnswers): ObligationPreview[] {
  const usesConsent = yes(a, "consent", "relies_on_consent");
  const children = yes(a, "data_categories", "children_data") || has(a, "data_categories", "principals", "children");
  const large = yes(a, "data_categories", "large_volume") || has(a, "data_categories", "data_types", "health") || has(a, "data_categories", "data_types", "biometric");
  const processors = yes(a, "vendors", "uses_processors");
  const crossBorder = yes(a, "vendors", "cross_border");
  const rbi = yes(a, "sector", "rbi");
  const sebi = yes(a, "sector", "sebi");
  const always = "Applies to every organisation that processes digital personal data.";
  const list: ObligationPreview[] = [
    { ref: "Section 4", title: "Grounds for processing", source: "Act", status: "applicable", reason: always },
    { ref: "Section 5", title: "Notice", source: "Act", status: usesConsent || !answered(a, "consent", "relies_on_consent") ? "applicable" : "potential", reason: usesConsent ? "Processing relies on consent, so a notice is needed." : "A notice is needed wherever consent is the basis." },
    { ref: "Section 6", title: "Consent", source: "Act", status: usesConsent ? "applicable" : answered(a, "consent", "relies_on_consent") ? "not_applicable" : "potential", reason: usesConsent ? "Processing relies on consent." : answered(a, "consent", "relies_on_consent") ? "You said you do not rely on consent." : "Not yet answered." },
    { ref: "Section 7", title: "Certain legitimate uses", source: "Act", status: "applicable", reason: always },
    { ref: "Section 8(1)", title: "Accountability of the Data Fiduciary", source: "Act", status: "applicable", reason: always },
    { ref: "Section 8(2)", title: "Engagement of Data Processors", source: "Act", status: processors ? "applicable" : answered(a, "vendors", "uses_processors") ? "not_applicable" : "potential", reason: processors ? "Vendors process personal data on your behalf." : answered(a, "vendors", "uses_processors") ? "You said no vendor processes personal data for you." : "Not yet answered." },
    { ref: "Section 8(3)", title: "Completeness and accuracy", source: "Act", status: "applicable", reason: always },
    { ref: "Section 8(5)", title: "Reasonable security safeguards", source: "Act", status: "applicable", reason: always },
    { ref: "Section 8(6)", title: "Breach intimation", source: "Act", status: "applicable", reason: always },
    { ref: "Section 8(7)", title: "Erasure when the purpose is fulfilled", source: "Act", status: "applicable", reason: always },
    { ref: "Section 8(9)", title: "Published contact information", source: "Act", status: "applicable", reason: always },
    { ref: "Section 8(10)", title: "Grievance redressal mechanism", source: "Act", status: "applicable", reason: always },
    { ref: "Section 9", title: "Children's personal data", source: "Act", status: children ? "applicable" : answered(a, "data_categories", "children_data") ? "not_applicable" : "potential", reason: children ? "You process data of children." : answered(a, "data_categories", "children_data") ? "No processing of children's data confirmed." : "Not yet answered." },
    { ref: "Section 10", title: "Significant Data Fiduciary obligations", source: "Act", status: large || a["sector"]?.sdf === "yes" ? "potential" : "not_applicable", reason: large ? "High volume or sensitive processing. Applies only if you are notified as a Significant Data Fiduciary." : "No high-volume or sensitive processing reported." },
    { ref: "Section 11", title: "Right to access information", source: "Act", status: "applicable", reason: always },
    { ref: "Section 12", title: "Right to correction and erasure", source: "Act", status: "applicable", reason: always },
    { ref: "Section 13", title: "Right of grievance redressal", source: "Act", status: "applicable", reason: always },
    { ref: "Section 14", title: "Right to nominate", source: "Act", status: "applicable", reason: always },
    { ref: "Section 16", title: "Processing outside India", source: "Act", status: crossBorder ? "applicable" : answered(a, "vendors", "cross_border") ? "not_applicable" : "potential", reason: crossBorder ? "Personal data goes outside India." : answered(a, "vendors", "cross_border") ? "No transfers outside India reported." : "Not yet answered." },
    { ref: "DPDP Rules", title: "Procedural requirements under the Rules", source: "Rules", status: "applicable", reason: always },
    { ref: "RBI Master Direction", title: "IT governance and data security for regulated entities", source: "Sector", status: rbi ? "applicable" : answered(a, "sector", "rbi") ? "not_applicable" : "potential", reason: rbi ? "You are regulated by the RBI." : answered(a, "sector", "rbi") ? "Not RBI-regulated." : "Not yet answered." },
    { ref: "CERT-In Directions", title: "Cyber incident reporting", source: "Sector", status: "potential", reason: "Likely applies to a body corporate in India. Confirm with legal review." },
    { ref: "SEBI Framework", title: "Cyber resilience for SEBI regulated entities", source: "Sector", status: sebi ? "applicable" : answered(a, "sector", "sebi") ? "not_applicable" : "potential", reason: sebi ? "You are regulated by SEBI." : answered(a, "sector", "sebi") ? "Not SEBI-regulated." : "Not yet answered." },
    { ref: "GP-01", title: "Privacy governance oversight", source: "Good practice", status: "applicable", reason: "Primus good practice, not a legal requirement." },
    { ref: "GP-02", title: "Record of processing activities", source: "Good practice", status: "applicable", reason: "Primus good practice, not a legal requirement." },
    { ref: "GP-03", title: "Privacy awareness training", source: "Good practice", status: "applicable", reason: "Primus good practice, not a legal requirement." },
  ];
  return list;
}

/** An answer in words, for read-only screens. */
export function describeAnswer(f: Field, a: Answers): string {
  const v = a[f.key];
  if (f.type === "yesno") return v === true ? "Yes" : v === false ? "No" : "";
  if (f.type === "multi") return Array.isArray(v) ? v.map((x) => f.options?.find((o) => o.value === x)?.label ?? x).join(", ") : "";
  if (f.type === "choice") return f.options?.find((o) => o.value === v)?.label ?? "";
  return typeof v === "string" ? v : "";
}
