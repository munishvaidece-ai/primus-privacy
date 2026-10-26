import { detectPiiCategories } from "@/lib/ai/mask";
import type { Sensitivity } from "./types";

// Categories whose presence makes an asset "sensitive" in practice
// (identity numbers, financial and health data, children, credentials).
const SENSITIVE = new Set(["aadhaar", "pan", "passport", "card", "bank_account", "health", "biometric", "credentials", "children", "financial"]);

const NAME_RULES: Array<[string, RegExp]> = [
  ["email", /e[-_ ]?mail/i],
  ["phone", /(phone|mobile|msisdn|contact[-_ ]?(no|number)|whatsapp)/i],
  ["name", /(^|[_\s])(full[_ ]?name|first[_ ]?name|last[_ ]?name|surname|given[_ ]?name|customer[_ ]?name|employee[_ ]?name|name)($|[_\s])/i],
  ["address", /(address|street|pincode|pin[_ ]?code|postal|zip)/i],
  ["dob", /(dob|date[_ ]?of[_ ]?birth|birth[_ ]?date|birthday)/i],
  ["aadhaar", /(aadhaar|aadhar|uidai|uid[_ ]?no)/i],
  ["pan", /(^|[_\s])pan($|[_\s])|pan[_ ]?(no|number|card)/i],
  ["passport", /passport/i],
  ["card", /(card[_ ]?(no|number|num)|credit[_ ]?card|debit[_ ]?card|cvv|pan[_ ]?number)/i],
  ["bank_account", /(account[_ ]?(no|number|num)|iban|ifsc|upi)/i],
  ["health", /(diagnos|medical|health|disease|prescription|blood[_ ]?group|patient|allerg)/i],
  ["biometric", /(biometric|fingerprint|face[_ ]?id|retina|iris)/i],
  ["credentials", /(password|passwd|pwd|secret|token|api[_ ]?key)/i],
  ["location", /(latitude|longitude|geo|gps|location)/i],
  ["ip", /(^|[_\s])ip([_\s]|$)|ip[_ ]?address/i],
  ["children", /(guardian|parent[_ ]?consent|minor|child)/i],
  ["financial", /(salary|income|ctc|payslip|loan|credit[_ ]?score)/i],
];

/** Guess from a column / field NAME. A hint, not proof. */
export function classifyName(name: string): string[] {
  const out = new Set<string>();
  for (const [cat, re] of NAME_RULES) if (re.test(name)) out.add(cat);
  return [...out];
}

/** Recognise identifier shapes in a VALUE. The value is not kept. */
export function classifyValue(value: string): string[] {
  return detectPiiCategories(value);
}

export function sensitivityOf(categories: string[]): Sensitivity {
  if (categories.length === 0) return "none";
  return categories.some((c) => SENSITIVE.has(c)) ? "sensitive" : "personal";
}

export const unique = (xs: string[]) => [...new Set(xs)].sort();
