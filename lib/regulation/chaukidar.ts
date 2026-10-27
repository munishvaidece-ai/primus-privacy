// Chaukidar: the guided DPDP conversation on the public microsite.
//
// This file is only data and a checker. There is no free text and no language model: every question, every
// answer and every follow-up is written here, and the numbers (dates, penalty ceilings, who to tell after an
// incident, which duties apply) are worked out by the same catalogue and engine the product uses. That keeps
// each answer checkable. Indicative, not legal advice; the Gazette is the source.
//
// The screen (site-src/chaukidar.js) reads this graph: it shows a node, the visitor picks an option, the option
// names the next node. Some options also record a fact (for example "we use vendors"), which feeds the engine.
import { DPDP_RULES, DPDP_SECTIONS } from "./dpdp";

export const CH_NAME = "Chaukidar";
export const CH_START = "root";

export type FactKey = "consent" | "children" | "processors" | "abroad" | "large";
export type FactValue = "yes" | "no" | "unsure";

export interface ChOption {
  label: string;
  /** A short line under the label. */
  hint?: string;
  /** The node to show next. */
  next: string;
  /** Facts this answer records. */
  set?: Partial<Record<FactKey, FactValue>>;
  /** What Chaukidar says straight after the visitor picks this. */
  reply?: string;
  /** Hours since the organisation became aware of an incident. */
  aware?: number;
}

export type ChNode =
  | { id: string; kind: "ask"; say: string; options: ChOption[] }
  | { id: string; kind: "sectors"; say: string; hint?: string; single?: boolean; next: string }
  | { id: string; kind: "tell"; title: string; body: string[]; cite: string[]; takeaway?: string; follow: ChOption[] }
  | { id: string; kind: "map" | "who" | "dates" | "penalties" | "sectorbrief"; say: string; follow: ChOption[] };

const ROOT: ChOption = { label: "Start over with a different question", next: "root" };
const MAP: ChOption = { label: "Does the DPDP Act apply to us?", hint: "Six quick questions, then your own map", next: "a_sectors" };

export const CH_NODES: Record<string, ChNode> = {};
const add = (n: ChNode): void => { CH_NODES[n.id] = n; };

// ------------------------------------------------------------------ the front door
add({
  id: "root", kind: "ask",
  say: "Namaste. I am Chaukidar. I keep watch over your data and I explain the DPDP rules one question at a time. What brings you here?",
  options: [
    { label: "Does the DPDP Act apply to us?", hint: "Six questions, then a map of your own duties", next: "a_sectors" },
    { label: "We have had a data breach", hint: "Who to tell, and how long you have", next: "b_sectors" },
    { label: "Someone has asked for their data", hint: "Access, correction, erasure, complaints", next: "c_ask" },
    { label: "Explain DPDP to my board", hint: "Five short cards, no jargon", next: "d_1" },
    { label: "What does my sector add on top?", hint: "Broking, banking, health, telecom and more", next: "s_pick" },
    { label: "Key dates and penalties", hint: "What is already in force, and what is not", next: "k_dates" },
  ],
});

// ------------------------------------------------------------------ A. does it apply to us
add({ id: "a_sectors", kind: "sectors", say: "Which sectors are you in? Pick all that fit. Sector regulators add their own rules on top of the DPDP Act.", hint: "You can pick more than one, or none if you are unsure.", next: "a_consent" });
add({
  id: "a_consent", kind: "ask",
  say: "Do you collect personal data on the basis of people's consent, for example forms, tick boxes or app permissions?",
  options: [
    { label: "Yes, for most of it", next: "a_children", set: { consent: "yes" }, reply: "Then notice (s.5) and valid, withdrawable consent (s.6) apply to you." },
    { label: "No, we rely on law or contract", next: "a_children", set: { consent: "no" }, reply: "Then consent may not be your main ground, but section 7 lists the only uses that need none, and each has conditions." },
    { label: "Not sure yet", next: "a_children", set: { consent: "unsure" }, reply: "That is fine. I will mark consent as one that may apply, and you can firm it up later." },
  ],
});
add({
  id: "a_children", kind: "ask",
  say: "Do you process the data of anyone under 18?",
  options: [
    { label: "Yes", hint: "Students, minors as customers, family accounts", next: "a_proc", set: { children: "yes" }, reply: "Section 9 applies: verifiable parental consent, and no tracking, behavioural monitoring or targeted advertising aimed at a child. The penalty ceiling is up to ₹200 crore." },
    { label: "No", next: "a_proc", set: { children: "no" }, reply: "Good. The children's provisions fall away for you." },
    { label: "Not sure yet", next: "a_proc", set: { children: "unsure" }, reply: "I will keep it as a question mark. Many organisations find minors in their data later." },
  ],
});
add({
  id: "a_proc", kind: "ask",
  say: "Do vendors or partners process personal data on your behalf, such as cloud, payroll, marketing or support tools?",
  options: [
    { label: "Yes", next: "a_abroad", set: { processors: "yes" }, reply: "You stay responsible for what they do, and you may use a processor only under a valid contract." },
    { label: "No", next: "a_abroad", set: { processors: "no" }, reply: "Then the processor-contract duty does not apply to you." },
    { label: "Not sure yet", next: "a_abroad", set: { processors: "unsure" }, reply: "Worth checking. Cloud and software tools usually count." },
  ],
});
add({
  id: "a_abroad", kind: "ask",
  say: "Does personal data leave India, for example to a cloud region, a parent company or an overseas vendor?",
  options: [
    { label: "Yes", next: "a_large", set: { abroad: "yes" }, reply: "Transfers are allowed unless the Government restricts a country, and stricter sector rules may still apply." },
    { label: "No, it stays in India", next: "a_large", set: { abroad: "no" }, reply: "Then the cross-border provision does not apply to you." },
    { label: "Not sure yet", next: "a_large", set: { abroad: "unsure" }, reply: "Check where your cloud and vendors store data. It is a common surprise." },
  ],
});
add({
  id: "a_large", kind: "ask",
  say: "Last one. Do you handle large volumes of personal data, or sensitive data such as health or biometrics, at scale?",
  options: [
    { label: "Yes", next: "a_map", set: { large: "yes" }, reply: "You may be notified as a Significant Data Fiduciary. The Government decides, based on volume, sensitivity and risk to people." },
    { label: "No", next: "a_map", set: { large: "no" }, reply: "Then Significant Data Fiduciary duties apply only if you are notified." },
    { label: "Not sure yet", next: "a_map", set: { large: "unsure" }, reply: "I will mark it as one that may apply." },
  ],
});
add({
  id: "a_map", kind: "map",
  say: "Here is your map, worked out by the same engine the Primus Privacy platform uses.",
  follow: [
    { label: "How big can the penalties be?", next: "k_pen" },
    { label: "What is already in force, and what is not?", next: "k_dates" },
    { label: "Tell me about notice and consent", next: "t_consent" },
    { label: "Tell me about breaches", next: "t_breach" },
    { label: "Tell me about children's data", next: "t_children" },
    ROOT,
  ],
});

// ------------------------------------------------------------------ B. we have had a breach
add({ id: "b_sectors", kind: "sectors", say: "I am sorry to hear that. First, which sectors are you in? Sector regulators often want to be told too, and sooner.", hint: "Pick all that fit.", next: "b_what" });
add({
  id: "b_what", kind: "ask",
  say: "What happened?",
  options: [
    { label: "Data went to the wrong person", hint: "A misdirected email or file", next: "b_clock", reply: "Common, and still a breach if the data is personal. Ask the recipient in writing to delete it and confirm, and keep a record." },
    { label: "Systems were hacked or locked", hint: "Intrusion, ransomware", next: "b_clock", reply: "Isolate the affected systems and preserve logs before anything is wiped. Logs are your evidence." },
    { label: "A device or documents were lost or stolen", next: "b_clock", reply: "Find out what was on it and whether it was encrypted. That decides how serious the exposure is." },
    { label: "A vendor or processor was breached", next: "b_clock", reply: "You remain responsible for your vendors. Ask them for the facts in writing, today." },
    { label: "I am not sure yet", next: "b_clock", reply: "Then treat it as a breach until you know otherwise. The clock may already be running." },
  ],
});
add({
  id: "b_clock", kind: "ask",
  say: "When did you first become aware of it?",
  options: [
    { label: "Just now", hint: "Under an hour ago", next: "b_who", aware: 0.5 },
    { label: "A few hours ago", next: "b_who", aware: 6 },
    { label: "Yesterday", next: "b_who", aware: 24 },
    { label: "More than two days ago", next: "b_who", aware: 60 },
  ],
});
add({
  id: "b_who", kind: "who",
  say: "Here is the clock, and who you may have to tell.",
  follow: [
    { label: "What counts as a breach under DPDP?", next: "t_breach" },
    { label: "What should we tell the affected people?", next: "t_notice_people" },
    { label: "How big can the penalties be?", next: "k_pen" },
    ROOT,
  ],
});
add({
  id: "t_breach", kind: "tell",
  title: "What counts as a personal data breach, and what you must do",
  body: [
    "A breach is any unauthorised processing, or accidental disclosure, loss or destruction of personal data that compromises its confidentiality, integrity or availability.",
    "Every Data Fiduciary must tell the Data Protection Board without delay and follow up with a detailed report within 72 hours of becoming aware, and must tell each affected person in plain language.",
    "Failing to do so carries a penalty of up to ₹200 crore. Failing to keep reasonable security safeguards in the first place carries up to ₹250 crore, the highest in the Schedule.",
  ],
  cite: ["s.8(5)", "s.8(6)", "Rule 6", "Rule 7"],
  takeaway: "Decide now who in your organisation detects a breach, who decides it is one, and who files the report. The 72 hours go quickly.",
  follow: [
    { label: "Who would we have to tell? (my sectors)", next: "b_sectors" },
    MAP,
    ROOT,
  ],
});
add({
  id: "t_notice_people", kind: "tell",
  title: "What to tell the affected people",
  body: [
    "Section 8(6) requires you to tell each affected person. In practice that means plain language, in a form they can act on.",
    "A good notice typically says what happened, what data was involved, what you have done about it, what they can do to protect themselves, and who they can contact.",
    "Keep a copy of every notice and the time it was sent. The Board may ask for it.",
  ],
  cite: ["s.8(6)", "Rule 7"],
  takeaway: "Draft the notice early, even before every fact is known. You can update it, but you cannot get the hours back.",
  follow: [{ label: "Who else would we have to tell?", next: "b_sectors" }, ROOT],
});

// ------------------------------------------------------------------ C. someone has asked for their data
add({
  id: "c_ask", kind: "ask",
  say: "What is the person asking for?",
  options: [
    { label: "A copy or summary of their data", next: "t_access" },
    { label: "To correct or erase their data", next: "t_erase" },
    { label: "To withdraw their consent", next: "t_withdraw" },
    { label: "They want to complain", next: "t_grievance" },
    { label: "To nominate someone to act for them", next: "t_nominate" },
  ],
});
add({
  id: "t_access", kind: "tell",
  title: "A request for their data",
  body: [
    "A person may ask for a summary of the personal data you process about them, the processing activities, and who you have shared it with.",
    "Give them a clear answer through the contact point you have published. The Rules set the time within which you must respond to a request or grievance, so know that period and meet it.",
  ],
  cite: ["s.11", "s.8(9)", "Rule 9", "Rule 14"],
  takeaway: "Log every request the day it arrives, name one owner, and write down the date you answered.",
  follow: [{ label: "How should we run requests like this?", next: "t_rights_process" }, ROOT],
});
add({
  id: "t_erase", kind: "tell",
  title: "Correct or erase their data",
  body: [
    "A person may ask you to correct inaccurate or incomplete data, and to erase data that is no longer needed. You must also erase data when the person withdraws consent or the purpose is served, unless the law requires you to keep it.",
    "Think about your vendors too. If a processor holds the data for you, the request has to reach them.",
  ],
  cite: ["s.12", "s.8(7)", "Rule 8"],
  takeaway: "Know in advance where a person's data lives, including in vendor systems and backups.",
  follow: [{ label: "How should we run requests like this?", next: "t_rights_process" }, ROOT],
});
add({
  id: "t_withdraw", kind: "tell",
  title: "Withdrawing consent",
  body: [
    "Consent must be as easy to withdraw as it was to give. Once a person withdraws, you must stop processing on that basis and erase the data, unless the law requires you to keep it.",
    "If giving consent took one tap, withdrawing it should not need an email to a helpdesk.",
  ],
  cite: ["s.6", "s.8(7)"],
  takeaway: "Test it yourself: how many steps does it take to withdraw consent in your own product?",
  follow: [{ label: "Tell me about notice and consent", next: "t_consent" }, ROOT],
});
add({
  id: "t_grievance", kind: "tell",
  title: "A complaint from a Data Principal",
  body: [
    "You must run a grievance mechanism and answer within the time the Rules set. A person who is not satisfied with your answer can then complain to the Data Protection Board.",
    "Publish your contact point so people know where to go before they escalate.",
  ],
  cite: ["s.8(10)", "s.13", "Rule 14"],
  takeaway: "A fast, fair answer from you is the best way to keep a complaint from reaching the Board.",
  follow: [{ label: "How should we run requests like this?", next: "t_rights_process" }, ROOT],
});
add({
  id: "t_nominate", kind: "tell",
  title: "Nominating someone to act",
  body: [
    "A person may nominate someone to exercise their rights if they die or become unable to do so. You should be ready to recognise a valid nomination and act on it.",
  ],
  cite: ["s.14"],
  takeaway: "Add a nomination option to your rights process, even if it is rarely used.",
  follow: [{ label: "How should we run requests like this?", next: "t_rights_process" }, ROOT],
});
add({
  id: "t_rights_process", kind: "tell",
  title: "Running rights requests without chaos",
  body: [
    "Keep one register: who asked, what for, the date received, the date due, the owner and the outcome. One owner per request. A reminder before the deadline.",
    "The Primus Privacy platform keeps exactly this log for each client, with the deadline shown against every request.",
  ],
  cite: ["s.11", "s.12", "s.13", "Rule 14"],
  follow: [MAP, ROOT],
});

// ------------------------------------------------------------------ D. explain DPDP to my board
add({
  id: "d_1", kind: "tell",
  title: "1 of 5. What the law is",
  body: [
    "The Digital Personal Data Protection Act, 2023 sets rules for how organisations handle the digital personal data of people in India. The DPDP Rules, 2025 add the detail.",
    "The organisation that decides why and how data is used is called a Data Fiduciary. The person the data is about is the Data Principal.",
  ],
  cite: ["s.4", "Rule 1"],
  takeaway: "In short: collect only what you need, tell people why, protect it, and be ready to answer for it.",
  follow: [{ label: "Next: who is accountable", next: "d_2" }, ROOT],
});
add({
  id: "d_2", kind: "tell",
  title: "2 of 5. Who is accountable",
  body: [
    "The organisation is accountable, not the vendor it hired. A Data Fiduciary stays responsible for what its processors do.",
    "Larger or riskier organisations can be notified as Significant Data Fiduciaries, which adds an India-based Data Protection Officer, an independent data auditor and periodic impact assessments.",
  ],
  cite: ["s.8(2)", "s.10", "Rule 13"],
  takeaway: "Ask who in the organisation owns data protection, and whether they have the authority to act.",
  follow: [{ label: "Next: the money", next: "d_3" }, ROOT],
});
add({ id: "d_3", kind: "penalties", say: "3 of 5. The money. These are ceilings set in the Schedule. The Data Protection Board decides the actual amount after an inquiry.", follow: [{ label: "Next: the dates", next: "d_4" }, ROOT] });
add({ id: "d_4", kind: "dates", say: "4 of 5. The dates. The law is coming in stages.", follow: [{ label: "Next: five questions for Monday", next: "d_5" }, ROOT] });
add({
  id: "d_5", kind: "tell",
  title: "5 of 5. Five questions to put to your team on Monday",
  body: [
    "1. Where is our personal data, and which systems and vendors hold it?",
    "2. Are our notices and consent requests clear, specific and as easy to withdraw as to give?",
    "3. If we had a breach today, could we report it within 72 hours, and who would do it?",
    "4. Who answers a person's request for their data, and how fast?",
    "5. Does any of our data belong to children, or leave India?",
  ],
  cite: ["s.5", "s.6", "s.8(6)", "s.11", "s.9", "s.16"],
  takeaway: "If three of these draw a blank, that is where a gap assessment should start.",
  follow: [MAP, ROOT],
});

// ------------------------------------------------------------------ S. sector
add({ id: "s_pick", kind: "sectors", say: "Which sector would you like to look at?", hint: "Pick one.", single: true, next: "s_brief" });
add({
  id: "s_brief", kind: "sectorbrief",
  say: "Here is what your sector adds on top of the DPDP Act.",
  follow: [
    { label: "Who would we have to tell after an incident?", next: "b_what" },
    { label: "Does the DPDP Act apply to us?", next: "a_consent" },
    ROOT,
  ],
});

// ------------------------------------------------------------------ K. key dates and penalties
add({ id: "k_dates", kind: "dates", say: "Here is the timeline. The law is coming in stages.", follow: [{ label: "How big can the penalties be?", next: "k_pen" }, MAP, ROOT] });
add({ id: "k_pen", kind: "penalties", say: "These are the ceilings in the Schedule to the Act. The Data Protection Board decides the actual amount after an inquiry.", follow: [{ label: "What is already in force?", next: "k_dates" }, MAP, ROOT] });

// ------------------------------------------------------------------ topic cards
add({
  id: "t_consent", kind: "tell",
  title: "Notice and consent",
  body: [
    "Before you ask for consent you must give a notice saying what data you take, why, how people can exercise their rights and how to complain to the Board.",
    "Consent must be free, specific, informed, unconditional and unambiguous, limited to the data needed for the stated purpose, and as easy to withdraw as to give.",
  ],
  cite: ["s.5", "s.6", "Rule 3"],
  takeaway: "Read your own consent screen as a stranger would. Is it clear what they are agreeing to?",
  follow: [{ label: "What if someone withdraws consent?", next: "t_withdraw" }, MAP, ROOT],
});
add({
  id: "t_children", kind: "tell",
  title: "Children's data",
  body: [
    "For anyone under 18 you need verifiable consent from a parent or lawful guardian before processing, and you must not track them, monitor their behaviour or target advertising at them.",
    "The penalty ceiling for failing the children's obligations is up to ₹200 crore. The Rules allow some exemptions, so check whether one fits your use.",
  ],
  cite: ["s.9", "Rule 10", "Rule 11", "Rule 12"],
  takeaway: "If minors can sign up to your service, ask how you would verify the parent. Many organisations have no answer yet.",
  follow: [MAP, ROOT],
});

/** Sections and Rules a card may cite. */
export function citeKnown(cite: string): boolean {
  const sec = cite.match(/^s\.(\d+)(?:\(\d+\))?$/);
  if (sec) return DPDP_SECTIONS.some((s) => s.ref === `s.${sec[1]}` || s.ref.startsWith(`s.${sec[1]}-`) || (s.ref.includes("-") && inRange(s.ref, Number(sec[1]))));
  const rule = cite.match(/^Rule (\d+)$/);
  return rule ? DPDP_RULES.some((r) => r.number === Number(rule[1])) : false;
}

function inRange(ref: string, n: number): boolean {
  const m = ref.match(/^s\.(\d+)-(\d+)$/);
  return m ? n >= Number(m[1]) && n <= Number(m[2]) : false;
}

/** Problems in the graph: a missing next node, an empty option list, a node nobody can reach, an unknown citation. Empty means sound. */
export function checkGraph(nodes: Record<string, ChNode> = CH_NODES): string[] {
  const problems: string[] = [];
  const reach = new Set<string>();
  const links = (n: ChNode): string[] => (n.kind === "ask" ? n.options.map((o) => o.next) : n.kind === "sectors" ? [n.next] : n.follow.map((o) => o.next));
  const walk = (id: string): void => {
    if (reach.has(id) || !nodes[id]) return;
    reach.add(id);
    for (const next of links(nodes[id]!)) walk(next);
  };
  walk(CH_START);
  for (const n of Object.values(nodes)) {
    if (!reach.has(n.id)) problems.push(`${n.id}: nobody can reach it`);
    for (const next of links(n)) if (!nodes[next]) problems.push(`${n.id}: points to a node that does not exist (${next})`);
    if (n.kind === "ask" && n.options.length < 2) problems.push(`${n.id}: a question needs at least two options`);
    if (n.kind === "tell") {
      if (!n.body.length) problems.push(`${n.id}: no body`);
      for (const c of n.cite) if (!citeKnown(c)) problems.push(`${n.id}: cites ${c}, which is not in the catalogue`);
    }
  }
  return problems;
}
