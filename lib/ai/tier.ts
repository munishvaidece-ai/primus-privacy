// Control risk tier (how much harm a wrong decision on this control can do).
// The control library has no criticality field and published libraries are
// immutable, so the tier is derived from the control's own wording. This is
// deliberately simple, transparent and listed in the user guide; it can be
// replaced by a per-control override table without changing callers.
import type { RiskTier } from "./types";

const CRITICAL = [
  "breach",
  "incident",
  "consent",
  "child",
  "minor",
  "security safeguard",
  "encrypt",
  "cross-border",
  "cross border",
  "transfer",
  "significant data fiduciary",
  "sensitive",
];
const HIGH = [
  "retention",
  "erasure",
  "deletion",
  "grievance",
  "data principal right",
  "rights",
  "access control",
  "processor",
  "vendor",
  "third part",
  "impact assessment",
  "dpia",
  "purpose limitation",
];
const MEDIUM = ["notice", "privacy policy", "training", "awareness", "inventory", "record", "audit", "governance", "accountab"];

export interface TierResult {
  tier: RiskTier;
  matched: string[];
}

export function controlTier(control: { code?: string | null; title: string; description?: string | null }): TierResult {
  const text = `${control.code ?? ""} ${control.title} ${control.description ?? ""}`.toLowerCase();
  const hit = (words: string[]) => words.filter((w) => text.includes(w));
  const c = hit(CRITICAL);
  if (c.length) return { tier: "critical", matched: c };
  const h = hit(HIGH);
  if (h.length) return { tier: "high", matched: h };
  const m = hit(MEDIUM);
  if (m.length) return { tier: "medium", matched: m };
  return { tier: "low", matched: [] };
}

export const TIER_ORDER: Record<RiskTier, number> = { low: 0, medium: 1, high: 2, critical: 3 };
