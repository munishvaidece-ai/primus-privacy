// Evidence review: does this document support the control(s) it is linked to?
import { z } from "zod";
import type { TaskDef } from "../engine";
import type { SuggestionDraft, RiskTier } from "../types";
import { maskPii } from "../mask";
import { inputHash, normalise, sentences, textStems, topicTerms, verifyCitations } from "../text";
import { TIER_ORDER } from "../tier";
import type { EvidenceProv } from "../provenance";

export interface EvidenceReviewInput {
  evidenceId: string;
  title: string;
  evidenceType: string;
  filename: string;
  validUntil: string | null; // ISO
  now: string; // ISO (injected for determinism)
  text: string; // extracted text (UNMASKED here; masked in prompt())
  textMethod: string;
  controls: Array<{ code: string; title: string; description: string | null; tier: RiskTier }>;
  maxChars: number;
  /** Who supplied the document and through which feature (for the evidence trail only). */
  prov?: EvidenceProv;
}

export const evidenceReviewOutput = z.object({
  verdict: z.enum(["supports", "partial", "does_not_support", "unreadable"]),
  quality: z.enum(["strong", "adequate", "weak"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(5).max(2000),
  citations: z.array(z.object({ quote: z.string(), locator: z.string().optional() })).max(5).default([]),
});
export type EvidenceReviewOutput = z.infer<typeof evidenceReviewOutput>;

const STRUCTURE_SIGNALS: Array<[RegExp, string]> = [
  [/\b(approved|approval|approved by|signed|signature|authori[sz]ed)\b/i, "approval or signature"],
  [/\b(version|v\d+(\.\d+)?|revision|rev\.)\b/i, "version control"],
  [/\b(effective (from|date|as of)|dated|date of issue|last reviewed|review date|next review)\b/i, "dates"],
  [/\b(owner|responsible|accountable|dpo|data protection officer|privacy officer)\b/i, "named responsibility"],
  [/\b(scope|applies to|applicability)\b/i, "stated scope"],
];

export function offlineEvidenceReview(i: EvidenceReviewInput): EvidenceReviewOutput {
  const text = i.text;
  if (i.validUntil && new Date(i.validUntil) < new Date(i.now)) {
    return {
      verdict: "does_not_support",
      quality: "weak",
      confidence: 0.9,
      rationale: `The evidence expired on ${i.validUntil.slice(0, 10)}; expired evidence cannot support a current control.`,
      citations: [],
    };
  }
  if (text.trim().length < 200) {
    return {
      verdict: "unreadable",
      quality: "weak",
      confidence: 0.3,
      rationale: `Only ${text.trim().length} characters could be read from this ${i.evidenceType.replace(/_/g, " ")} (${i.textMethod}); it may be a scan or image. A person should look at it.`,
      citations: [],
    };
  }
  const terms = i.controls.length
    ? [...new Set(i.controls.flatMap((c) => topicTerms(`${c.title} ${c.title} ${c.description ?? ""}`, 8)))]
    : topicTerms(i.title, 5);
  const stems = textStems(text);
  const present = terms.filter((t) => stems.has(t));
  const coverage = terms.length ? present.length / terms.length : 0;
  const signals = STRUCTURE_SIGNALS.filter(([re]) => re.test(text)).map(([, n]) => n);

  // Quote the sentences that best match the control's topic terms.
  const scored = sentences(text)
    .map((s) => {
      const st = textStems(s);
      return { s, n: present.filter((t) => st.has(t)).length };
    })
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 2);
  const citations = scored.map((x) => ({ quote: x.s.slice(0, 300) }));

  let verdict: EvidenceReviewOutput["verdict"];
  let quality: EvidenceReviewOutput["quality"];
  let confidence: number;
  if (!i.controls.length) {
    verdict = "partial";
    quality = "weak";
    confidence = 0.4;
    return {
      verdict,
      quality,
      confidence,
      rationale: "This evidence is not linked to any control, so there is nothing to test it against.",
      citations: [],
    };
  }
  if (coverage >= 0.6 && signals.length >= 2 && citations.length > 0) {
    verdict = "supports";
    quality = signals.length >= 4 && coverage >= 0.8 ? "strong" : "adequate";
    confidence = Math.min(0.95, 0.62 + 0.28 * coverage + 0.03 * signals.length);
  } else if (coverage >= 0.35) {
    verdict = "partial";
    quality = "weak";
    confidence = 0.6;
  } else {
    verdict = "does_not_support";
    quality = "weak";
    confidence = text.length >= 1500 ? Math.min(0.9, 0.55 + 0.35 * (1 - coverage)) : 0.55;
  }
  const missing = terms.filter((t) => !stems.has(t)).slice(0, 5);
  const rationale =
    verdict === "supports"
      ? `The document covers ${present.length} of ${terms.length} topics the control is about and shows ${signals.join(", ") || "no formal markers"}.`
      : verdict === "partial"
        ? `The document touches ${present.length} of ${terms.length} topics the control is about; it does not clearly cover: ${missing.join(", ") || "n/a"}.`
        : `The document does not appear to address this control: only ${present.length} of ${terms.length} of its topics appear in the text${missing.length ? ` (missing: ${missing.join(", ")})` : ""}.`;
  return { verdict, quality, confidence, rationale, citations };
}

export const evidenceReviewTask: TaskDef<EvidenceReviewInput, EvidenceReviewOutput> = {
  kind: "evidence_review",
  outputSchema: evidenceReviewOutput,
  offline: offlineEvidenceReview,
  system:
    "You are a privacy compliance auditor reviewing a piece of evidence against one or more controls from a DPDP (India) compliance control library. " +
    "Decide whether the document actually demonstrates that the control is in place. Be sceptical: policies that merely mention a topic are not proof of operation. " +
    "Fields: verdict (supports | partial | does_not_support | unreadable), quality (strong | adequate | weak), confidence (0..1, your honest probability that the verdict is right), rationale (2-3 sentences), citations (up to 3 verbatim quotes from the text with an optional locator such as a section heading).",
  prompt(i) {
    const masked = maskPii(i.text.slice(0, i.maxChars)).text;
    const ctrl = i.controls.map((c) => `- ${c.code}: ${c.title}${c.description ? ` — ${c.description}` : ""}`).join("\n");
    return `CONTROLS:\n${ctrl || "(none linked)"}\n\nEVIDENCE TITLE: ${i.title}\nTYPE: ${i.evidenceType}\nVALID UNTIL: ${i.validUntil ?? "not stated"}\nTODAY: ${i.now.slice(0, 10)}\n\nEXTRACTED TEXT (personal identifiers masked):\n"""\n${masked}\n"""`;
  },
};

export function evidenceReviewDraft(i: EvidenceReviewInput, o: EvidenceReviewOutput): SuggestionDraft {
  const tier = i.controls.reduce<RiskTier>((t, c) => (TIER_ORDER[c.tier] > TIER_ORDER[t] ? c.tier : t), "low");
  const citations = verifyCitations(o.citations, i.text);
  let confidence = Math.min(0.97, o.confidence);
  let needsHuman: string | undefined;
  const decision = o.verdict === "supports" ? "accepted" : o.verdict === "does_not_support" ? "rejected" : null;

  if (o.verdict === "supports") {
    const ok = citations.filter((c) => c.verified);
    if (ok.length === 0) {
      confidence = Math.min(confidence, 0.6);
      needsHuman = "the AI could not point to a passage in the document that proves the control";
    }
  }
  if (o.verdict === "partial") needsHuman = "the document only partly covers the control";
  if (o.verdict === "unreadable") needsHuman = "the document could not be read reliably";
  if (!i.controls.length) needsHuman = "the evidence is not linked to a control";

  return {
    kind: "evidence_review",
    subjectType: "evidence",
    subjectId: i.evidenceId,
    title: `${decision === "rejected" ? "Reject" : decision === "accepted" ? "Accept" : "Review"} evidence: ${i.title}`,
    summary: o.rationale,
    proposed: {
      decision: decision ?? "accepted",
      verdict: o.verdict,
      quality: o.quality,
      reviewRationale: o.rationale,
      controls: i.controls.map((c) => c.code),
    },
    rationale: o.rationale,
    citations,
    confidence,
    tier,
    needsHuman,
    inputHash: inputHash({ k: "evidence_review", e: i.evidenceId, t: normalise(i.text).length, v: i.validUntil, c: i.controls.map((c) => c.code) }),
  };
}
