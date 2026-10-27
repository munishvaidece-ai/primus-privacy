// Which parts of the DPDP Act and Rules apply to one organisation, and which sector rules sit beside them.
//
// Pure functions: no database, no server code. The engagement screens, the client portal, the AI and the
// public microsite's "check" tool all call this one file, so the answer is the same everywhere.
//
// Everything here is indicative. "Applies" means the organisation's own answers put it inside the provision.
// "May apply" means it depends on something the organisation has not said, or on a decision by the Central
// Government (for example a notification as a Significant Data Fiduciary). It is not legal advice.
import { CONTROL_MAP, DPDP_RULES, RULE_PHASES, penaltyFor } from "./dpdp";
import type { PenaltyKey, SectorKey } from "./types";

export type Applies = "applies" | "may_apply" | "not_applicable";

/** The facts the engine needs. Every field is optional; a missing answer never becomes a "no". */
export interface OrgFacts {
  sectors: SectorKey[];
  /** From the discovery questionnaire or the live data landscape. */
  reliesOnConsent?: boolean | null;
  legitimateUses?: boolean | null;
  children?: boolean | null;
  largeOrSensitive?: boolean | null;
  notifiedSdf?: "yes" | "no" | "unsure" | null;
  usesProcessors?: boolean | null;
  crossBorder?: boolean | null;
  automatedDecisions?: boolean | null;
  employees?: string | null;
  /** Evidence from the data landscape, used as the reason where present. */
  evidence?: { childrenFrom?: string; processorsFrom?: string; crossBorderFrom?: string; sensitiveFrom?: string };
}

export interface Obligation {
  id: string;
  /** Sections of the Act, for example ["s.8(5)"]. */
  sections: string[];
  /** Rule numbers of the DPDP Rules, 2025. */
  rules: number[];
  title: string;
  /** One plain sentence on what it asks. */
  asks: string;
  status: Applies;
  /** Why, in this organisation's own terms. */
  reasons: string[];
  /** Date from which the duty can be enforced. */
  inForce: string;
  penalty: { key: PenaltyKey; text: string; section: string };
  /** Starter-library controls that test this obligation. */
  controls: string[];
  group: "basis" | "duties" | "children" | "rights" | "sdf" | "transfers" | "exemptions";
}

const phaseDate = (rules: number[]): string => {
  const dates = rules.map((n) => DPDP_RULES.find((r) => r.number === n)).filter(Boolean).map((r) => RULE_PHASES[r!.phase].date);
  return dates.length ? dates.sort().at(-1)! : RULE_PHASES["18m"].date;
};

const controlsFor = (sections: string[]): string[] =>
  Object.entries(CONTROL_MAP)
    .filter(([, m]) => m.sections.some((s) => sections.some((x) => s === x || s.startsWith(`${x}(`) || x.startsWith(`${s}(`))))
    .map(([code]) => code);

const yn = (v: boolean | null | undefined): "yes" | "no" | "unknown" => (v === true ? "yes" : v === false ? "no" : "unknown");

interface Def {
  id: string;
  sections: string[];
  rules: number[];
  title: string;
  asks: string;
  group: Obligation["group"];
  penalty: PenaltyKey;
  decide: (f: OrgFacts) => { status: Applies; reasons: string[] };
}

const ALWAYS = (why = "Applies to every Data Fiduciary that processes digital personal data in India."): Def["decide"] => () => ({ status: "applies", reasons: [why] });
const has = (f: OrgFacts, k: SectorKey) => f.sectors.includes(k);

const DEFS: Def[] = [
  { id: "ground", sections: ["s.4"], rules: [], title: "A lawful ground for every use of personal data", asks: "Process personal data only for a lawful purpose, on consent or under a listed legitimate use.", group: "basis", penalty: "other", decide: ALWAYS() },
  {
    id: "notice", sections: ["s.5"], rules: [3], title: "Notice before consent", asks: "Tell people what data you take, why, how to exercise their rights and how to complain to the Board.", group: "basis", penalty: "other",
    decide: (f) => {
      const c = yn(f.reliesOnConsent);
      return c === "yes" ? { status: "applies", reasons: ["Some processing relies on consent, and every consent request needs a notice."] }
        : c === "no" ? { status: "may_apply", reasons: ["You said you do not rely on consent, but a notice is still needed where consent is the basis for any use."] }
        : { status: "applies", reasons: ["A notice accompanies every consent request. You have not yet said whether you rely on consent."] };
    },
  },
  {
    id: "consent", sections: ["s.6"], rules: [3], title: "Valid, withdrawable consent", asks: "Consent must be free, specific, informed and unambiguous, and as easy to withdraw as to give.", group: "basis", penalty: "other",
    decide: (f) => {
      const c = yn(f.reliesOnConsent);
      return c === "yes" ? { status: "applies", reasons: ["Processing relies on consent."] }
        : c === "no" ? { status: "not_applicable", reasons: ["You said no processing relies on consent."] }
        : { status: "may_apply", reasons: ["Not yet answered: does any processing rely on consent?"] };
    },
  },
  {
    id: "legit", sections: ["s.7"], rules: [], title: "Certain legitimate uses", asks: "Some uses need no consent: a voluntary provision, legal obligations, medical emergencies, employment and State benefits. Each has conditions.", group: "basis", penalty: "other",
    decide: (f) => {
      const reasons: string[] = [];
      if (yn(f.legitimateUses) === "yes") reasons.push("You rely on at least one legitimate use.");
      if (has(f, "broking") || has(f, "banking") || has(f, "insurance")) reasons.push("Regulated financial firms process data to meet KYC, record-keeping and reporting duties.");
      if (has(f, "government")) reasons.push("State processing for subsidies, benefits and services falls under s.7(b) and Rule 5.");
      return reasons.length ? { status: "applies", reasons } : { status: "may_apply", reasons: ["Employment and legal-obligation uses are almost universal. Confirm which of your uses rest on s.7."] };
    },
  },
  { id: "accuracy", sections: ["s.8(3)"], rules: [], title: "Completeness and accuracy", asks: "Keep personal data complete, accurate and consistent where it is used to decide about a person or is shared.", group: "duties", penalty: "other", decide: ALWAYS() },
  {
    id: "processors", sections: ["s.8(2)"], rules: [6], title: "Processors only under a valid contract", asks: "Engage a processor only under a valid contract, and stay responsible for what it does.", group: "duties", penalty: "other",
    decide: (f) => {
      const p = yn(f.usesProcessors);
      return p === "yes" ? { status: "applies", reasons: [f.evidence?.processorsFrom ?? "Vendors process personal data on your behalf."] }
        : p === "no" ? { status: "not_applicable", reasons: ["You said no vendor processes personal data for you."] }
        : { status: "may_apply", reasons: ["Not yet answered: do vendors process personal data for you?"] };
    },
  },
  { id: "security", sections: ["s.8(5)"], rules: [6], title: "Reasonable security safeguards", asks: "Encrypt or mask, control access, log and monitor, back up, and keep logs for a year. This is the heaviest-penalty duty.", group: "duties", penalty: "security", decide: ALWAYS() },
  { id: "breach", sections: ["s.8(6)"], rules: [7], title: "Intimate every breach", asks: "Tell the Board and each affected person of a personal data breach, with a fuller report to the Board within 72 hours.", group: "duties", penalty: "breach", decide: ALWAYS() },
  { id: "erasure", sections: ["s.8(7)"], rules: [8], title: "Erase when the purpose is done", asks: "Erase personal data when the person withdraws consent or the purpose is served, unless the law requires you to keep it.", group: "duties", penalty: "other", decide: ALWAYS() },
  { id: "contact", sections: ["s.8(9)"], rules: [9], title: "Published contact point", asks: "Publish the business contact of someone who can answer questions about the processing.", group: "duties", penalty: "other", decide: ALWAYS() },
  { id: "grievance", sections: ["s.8(10)", "s.13"], rules: [14], title: "Grievance redressal", asks: "Run a grievance mechanism and answer within the time the Rules set.", group: "rights", penalty: "other", decide: ALWAYS() },
  { id: "rights", sections: ["s.11", "s.12", "s.14"], rules: [14], title: "Rights of access, correction, erasure and nomination", asks: "Give people a summary of their data, let them correct and erase it, and let them nominate someone.", group: "rights", penalty: "other", decide: ALWAYS() },
  {
    id: "children", sections: ["s.9"], rules: [10, 11, 12], title: "Children's data", asks: "Get verifiable parental or guardian consent, and never track, monitor behaviour or target advertising at a child.", group: "children", penalty: "children",
    decide: (f) => {
      const c = yn(f.children);
      return c === "yes" ? { status: "applies", reasons: [f.evidence?.childrenFrom ?? "You process data of people under 18."] }
        : c === "no" ? { status: "not_applicable", reasons: ["You said you do not process children's data."] }
        : { status: "may_apply", reasons: ["Not yet answered: do you process data of anyone under 18?"] };
    },
  },
  {
    id: "disability", sections: ["s.9"], rules: [11], title: "Persons with a disability and their lawful guardians", asks: "Verify the guardian before processing the data of a person who cannot make decisions for herself.", group: "children", penalty: "children",
    decide: (f) => (has(f, "healthcare") || has(f, "education") || has(f, "government")
      ? { status: "may_apply", reasons: ["This sector often serves people with a legal guardian."] }
      : { status: "not_applicable", reasons: ["Nothing in your answers points to guardian-led processing."] }),
  },
  {
    id: "sdf", sections: ["s.10"], rules: [13], title: "Significant Data Fiduciary duties", asks: "An India-based Data Protection Officer, an independent data auditor, periodic impact assessments and algorithmic checks.", group: "sdf", penalty: "sdf",
    decide: (f) => {
      if (f.notifiedSdf === "yes") return { status: "applies", reasons: ["You have been notified as a Significant Data Fiduciary."] };
      if (f.largeOrSensitive === true) return { status: "may_apply", reasons: [f.evidence?.sensitiveFrom ?? "High-volume or sensitive processing. The Central Government decides who is notified, on volume, sensitivity and risk to people."] };
      if (f.largeOrSensitive === false) return { status: "not_applicable", reasons: ["No high-volume or sensitive processing reported. It applies only if you are notified."] };
      return { status: "may_apply", reasons: ["Not yet answered: do you process large volumes of data, or sensitive data at scale?"] };
    },
  },
  {
    id: "transfers", sections: ["s.16"], rules: [15], title: "Transfers outside India", asks: "You may transfer data abroad except to countries the Government restricts. Stricter sector rules still apply.", group: "transfers", penalty: "other",
    decide: (f) => {
      const x = yn(f.crossBorder);
      return x === "yes" ? { status: "applies", reasons: [f.evidence?.crossBorderFrom ?? "Personal data is sent or held outside India."] }
        : x === "no" ? { status: "not_applicable", reasons: ["You said personal data stays in India."] }
        : { status: "may_apply", reasons: ["Not yet answered: does personal data leave India?"] };
    },
  },
  {
    id: "state", sections: ["s.7", "s.17(2)"], rules: [5], title: "State processing and State exemptions", asks: "State bodies processing data for subsidies, benefits and services follow the Rule 5 standards. The Government may exempt notified instrumentalities.", group: "exemptions", penalty: "other",
    decide: (f) => (has(f, "government")
      ? { status: "applies", reasons: ["You work in the government or public sector. Whether a specific exemption applies depends on a notification, so it should be confirmed."] }
      : { status: "not_applicable", reasons: ["Not a State body or a State instrumentality."] }),
  },
  {
    id: "startup", sections: ["s.17(3)"], rules: [], title: "Possible relief for small and start-up organisations", asks: "The Government may notify classes of fiduciaries, including start-ups, as exempt from s.5, s.8(3), s.8(7), s.10 and s.11.", group: "exemptions", penalty: "other",
    decide: (f) => (has(f, "msme") || f.employees === "lt_50"
      ? { status: "may_apply", reasons: ["Small organisations may fall in a class the Government notifies. No such notification is assumed here: treat those sections as applying until one is published."] }
      : { status: "not_applicable", reasons: ["Not a small or start-up organisation on your answers."] }),
  },
  { id: "info", sections: ["s.36"], rules: [23], title: "Giving information when the Government asks", asks: "Furnish information the Central Government calls for, within the time and manner it sets.", group: "duties", penalty: "other", decide: () => ({ status: "applies", reasons: ["Applies if and when information is called for."] }) },
];

export function applicableObligations(f: OrgFacts): Obligation[] {
  return DEFS.map((d) => {
    const r = d.decide(f);
    const p = penaltyFor(d.penalty);
    return {
      id: d.id, sections: d.sections, rules: d.rules, title: d.title, asks: d.asks, status: r.status, reasons: r.reasons,
      inForce: phaseDate(d.rules), penalty: { key: d.penalty, text: p.maxText, section: p.section }, controls: controlsFor(d.sections), group: d.group,
    };
  });
}

export interface ApplicabilitySummary {
  applies: number;
  mayApply: number;
  notApplicable: number;
  /** Rule numbers that bind this organisation (from obligations that apply or may apply). */
  rules: number[];
  /** Highest penalty ceiling among obligations that apply, in crore; null if none. */
  highestCeilingCrore: number | null;
  highestCeilingText: string | null;
  firstDuty: string;
  daysToFirstDuty: number;
}

export function summarise(list: Obligation[], today = new Date()): ApplicabilitySummary {
  const on = list.filter((o) => o.status === "applies");
  const rules = [...new Set(list.filter((o) => o.status !== "not_applicable").flatMap((o) => o.rules))].sort((a, b) => a - b);
  const top = on.map((o) => penaltyFor(o.penalty.key)).filter((p) => p.maxCrore !== null).sort((a, b) => (b.maxCrore ?? 0) - (a.maxCrore ?? 0))[0];
  const first = RULE_PHASES["18m"].date;
  return {
    applies: on.length,
    mayApply: list.filter((o) => o.status === "may_apply").length,
    notApplicable: list.filter((o) => o.status === "not_applicable").length,
    rules,
    highestCeilingCrore: top?.maxCrore ?? null,
    highestCeilingText: top?.maxText ?? null,
    firstDuty: first,
    daysToFirstDuty: Math.ceil((new Date(first).getTime() - today.getTime()) / 86400000),
  };
}

/** Rules (with titles) that bind the organisation, grouped by the date they come into force. */
export function rulesThatBind(list: Obligation[]) {
  const nums = new Set(list.filter((o) => o.status !== "not_applicable").flatMap((o) => o.rules));
  return DPDP_RULES.filter((r) => nums.has(r.number)).map((r) => ({ ...r, inForce: RULE_PHASES[r.phase].date, label: RULE_PHASES[r.phase].label }));
}

/** Answers from the discovery questionnaire, in the shape of OrgFacts. */
type Ans = Record<string, Record<string, string | string[] | boolean | null> | undefined>;
const yes = (a: Ans, s: string, k: string): boolean | null => {
  const v = a[s]?.[k];
  return v === true ? true : v === false ? false : null;
};
const incl = (a: Ans, s: string, k: string, v: string): boolean => {
  const x = a[s]?.[k];
  return Array.isArray(x) && x.includes(v);
};

export function factsFromAnswers(a: Ans, sectors: SectorKey[]): OrgFacts {
  const childrenYes = yes(a, "data_categories", "children_data");
  const sens = incl(a, "data_categories", "data_types", "health") || incl(a, "data_categories", "data_types", "biometric");
  const large = yes(a, "data_categories", "large_volume");
  const sdf = a["sector"]?.sdf;
  const emp = a["organisation_profile"]?.employees;
  return {
    sectors,
    reliesOnConsent: yes(a, "consent", "relies_on_consent"),
    legitimateUses: yes(a, "consent", "legitimate_uses"),
    children: childrenYes === true || incl(a, "data_categories", "principals", "children") ? true : childrenYes,
    largeOrSensitive: large === true || sens ? true : large,
    notifiedSdf: sdf === "yes" || sdf === "no" || sdf === "unsure" ? sdf : null,
    usesProcessors: yes(a, "vendors", "uses_processors"),
    crossBorder: yes(a, "vendors", "cross_border"),
    automatedDecisions: yes(a, "processing_activities", "automated_decisions"),
    employees: typeof emp === "string" ? emp : null,
  };
}
