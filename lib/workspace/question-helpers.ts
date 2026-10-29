// Small builders for question-bank entries, shared by the bank and its extra sets.
import type { Field } from "./discovery-sections";

export interface BankQuestion extends Field {
  /** The theme the question belongs to, for grouping on the Primus page. */
  topic: string;
  /** The part of the DPDP Act or Rules the question checks, where it maps to one. */
  ref?: string;
}

export const CHOICE = [
  { value: "yes", label: "Yes" },
  { value: "partly", label: "Partly" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

/** The same choices plus "Not applicable to us", for questions that apply to only one type of organisation. */
export const CHOICE_NA = [...CHOICE, { value: "na", label: "Not applicable to us" }];

/** A yes / partly / no / not-sure question. */
export const q = (n: number, topic: string, label: string, help?: string): BankQuestion => ({ key: `q${n}`, topic, label, type: "choice", options: CHOICE, required: true, help });
/** A question that applies to one type of organisation in a sector; everyone else answers "Not applicable to us". */
export const qNA = (n: number, topic: string, label: string, help?: string): BankQuestion => ({ key: `q${n}`, topic, label, type: "choice", options: CHOICE_NA, required: true, help });
/** A free-text question. */
export const t = (n: number, topic: string, label: string, help?: string): BankQuestion => ({ key: `q${n}`, topic, label, type: "text", help });

