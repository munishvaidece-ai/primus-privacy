// Masking of personal data before any text reaches an AI model
// (DECISIONS.md R-186: the AI works on metadata and MASKED excerpts).
// Indian identifiers first, then generic ones. Masking is conservative:
// it prefers to over-mask. Replacement tokens keep the category so the
// model can still reason ("[AADHAAR]" is still an Aadhaar number).

interface Rule {
  name: string;
  re: RegExp;
  token: string;
}

const RULES: Rule[] = [
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, token: "[EMAIL]" },
  { name: "aadhaar", re: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, token: "[AADHAAR]" },
  { name: "pan", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, token: "[PAN]" },
  { name: "gstin", re: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, token: "[GSTIN]" },
  { name: "ifsc", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, token: "[IFSC]" },
  { name: "card", re: /\b(?:\d[ -]?){13,19}\b/g, token: "[CARD]" },
  { name: "phone", re: /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, token: "[PHONE]" },
  { name: "passport", re: /\b[A-PR-WY][1-9]\d{6,7}\b/g, token: "[PASSPORT]" },
  { name: "ipv4", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, token: "[IP]" },
];

export interface MaskResult {
  text: string;
  counts: Record<string, number>;
}

export function maskPii(input: string): MaskResult {
  let text = input;
  const counts: Record<string, number> = {};
  for (const rule of RULES) {
    text = text.replace(rule.re, () => {
      counts[rule.name] = (counts[rule.name] ?? 0) + 1;
      return rule.token;
    });
  }
  return { text, counts };
}

/** Detection only (used by scanners that must never keep the matched values). */
export function detectPiiCategories(input: string): string[] {
  const found: string[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    if (rule.re.test(input)) found.push(rule.name);
    rule.re.lastIndex = 0;
  }
  return found;
}
