// Small text helpers used by the offline engine and citation checks.
import { createHash } from "node:crypto";

const STOP = new Set(
  (
    "a an and are as at be by for from has have in is it its of on or that the this to was were will with " +
    "shall should must may can not no all any each per into than then their there these those which who whom " +
    "within without under over such other more most less also etc using use used based including include includes " +
    "ensure ensures ensured organisation organization entity entities data personal"
  ).split(" "),
);

export function normalise(s: string): string {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

export function stem(w: string): string {
  return w
    .replace(/(ational|ization|isation)$/, "ate")
    .replace(/(ing|ed|es|s|ly)$/, "")
    .slice(0, 12);
}

export function topicTerms(text: string, max = 10): string[] {
  const counts = new Map<string, number>();
  for (const raw of normalise(text).split(/[^a-z0-9']+/)) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    const s = stem(raw);
    if (s.length < 3) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([w]) => w);
}

export function textStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of normalise(text).split(/[^a-z0-9']+/)) {
    if (raw.length < 4) continue;
    out.add(stem(raw));
  }
  return out;
}

/** Splits into sentences, keeping them verbatim (so quotes verify). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n{2,}|\n(?=\s*[-•*\d])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function inputHash(v: unknown): string {
  return sha256(stableStringify(v));
}

export interface RawCitation {
  quote: string;
  locator?: string;
}

/** A citation is "verified" only if its quote really occurs in the source. */
export function verifyCitations(cites: RawCitation[], source: string): Array<RawCitation & { verified: boolean }> {
  const hay = normalise(source);
  return cites
    .filter((c) => c.quote && c.quote.trim().length > 0)
    .slice(0, 5)
    .map((c) => {
      const q = normalise(c.quote);
      return { quote: c.quote.trim().slice(0, 400), locator: c.locator, verified: q.length >= 8 && hay.includes(q) };
    });
}
