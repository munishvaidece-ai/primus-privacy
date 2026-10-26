// Rating: how effective is this control, given the reviewed evidence and tests?
import { z } from "zod";
import type { TaskDef } from "../engine";
import type { RiskTier, SuggestionDraft } from "../types";
import { inputHash } from "../text";
import type { Actor, EvidenceProv } from "../provenance";

export interface RatingInput {
  assessmentControlId: string;
  control: { code: string; title: string; description: string | null; tier: RiskTier };
  currentRating: string | null;
  evidence: Array<{ id: string; title: string; reviewStatus: string; quality: string | null; aiVerdict: string | null; validUntil: string | null; prov?: EvidenceProv }>;
  tests: Array<{ id?: string; result: "pass" | "fail" | "exception_noted"; methodology: string; by?: Actor | null; testedAt?: string | null }>;
  now: string;
  /** Who gave the current answer on this control (for the evidence trail only). */
  answeredBy?: { actor: Actor; at: string | null } | null;
  assessmentId?: string;
}

export const ratingOutput = z.object({
  rating: z.enum(["implemented", "partially_implemented", "not_implemented"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(5).max(1800),
});
export type RatingOutput = z.infer<typeof ratingOutput>;

export function offlineRating(i: RatingInput): RatingOutput {
  const live = (e: RatingInput["evidence"][number]) => !e.validUntil || new Date(e.validUntil) >= new Date(i.now);
  const accepted = i.evidence.filter((e) => e.reviewStatus === "accepted" && live(e));
  const rejected = i.evidence.filter((e) => e.reviewStatus === "rejected");
  const strong = accepted.filter((e) => e.quality === "strong" || e.quality === "adequate");
  const fails = i.tests.filter((t) => t.result === "fail").length;
  const exceptions = i.tests.filter((t) => t.result === "exception_noted").length;
  const passes = i.tests.filter((t) => t.result === "pass").length;

  const bits: string[] = [];
  if (accepted.length) bits.push(`${accepted.length} accepted evidence item(s)`);
  if (rejected.length) bits.push(`${rejected.length} rejected`);
  if (i.tests.length) bits.push(`tests: ${passes} pass, ${exceptions} exception, ${fails} fail`);
  const basis = bits.join("; ") || "no usable evidence";

  if (fails > 0) {
    return accepted.length > 0
      ? { rating: "partially_implemented", confidence: 0.72, rationale: `A control test failed although documents exist (${basis}). The control exists on paper but did not operate as described.` }
      : { rating: "not_implemented", confidence: 0.82, rationale: `A control test failed and nothing accepted supports the control (${basis}).` };
  }
  if (accepted.length === 0 && passes > 0 && exceptions === 0 && rejected.length === 0) {
    return { rating: "partially_implemented", confidence: 0.6, rationale: `The control test passed, but no accepted evidence supports the control yet (${basis}). It cannot be rated implemented until the evidence is reviewed.` };
  }
  if (accepted.length === 0) {
    return {
      rating: "not_implemented",
      confidence: rejected.length > 0 ? 0.74 : 0.55,
      rationale: rejected.length > 0 ? `All submitted evidence was rejected (${basis}); nothing demonstrates the control.` : `No accepted evidence yet (${basis}).`,
    };
  }
  if (strong.length === 0 || exceptions > 0) {
    return { rating: "partially_implemented", confidence: 0.76, rationale: `Evidence is thin or tests noted exceptions (${basis}).` };
  }
  const conf = Math.min(0.95, 0.84 + 0.04 * (strong.length - 1) + (passes > 0 ? 0.04 : 0));
  return { rating: "implemented", confidence: conf, rationale: `Accepted evidence of adequate or strong quality${passes ? " and passing tests" : ""} supports the control (${basis}).` };
}

export const ratingTask: TaskDef<RatingInput, RatingOutput> = {
  kind: "rating",
  outputSchema: ratingOutput,
  offline: offlineRating,
  system:
    "You rate the effectiveness of one DPDP (India) compliance control from a summary of its reviewed evidence and control tests. " +
    "implemented = operating and evidenced; partially_implemented = exists but incomplete, thinly evidenced, or tests noted exceptions; not_implemented = not evidenced or tests failed. " +
    "Never rate 'implemented' on evidence that has not been accepted or has expired. Fields: rating, confidence (0..1), rationale.",
  prompt(i) {
    const ev = i.evidence.map((e) => `- "${e.title}" status=${e.reviewStatus} quality=${e.quality ?? "n/a"} valid_until=${e.validUntil ?? "n/a"}`).join("\n");
    const t = i.tests.map((x) => `- ${x.result}: ${x.methodology.slice(0, 160)}`).join("\n");
    return `CONTROL ${i.control.code}: ${i.control.title}\n${i.control.description ?? ""}\n\nTODAY: ${i.now.slice(0, 10)}\nEVIDENCE:\n${ev || "(none)"}\n\nTESTS:\n${t || "(none)"}`;
  },
};

export function ratingDraft(i: RatingInput, o: RatingOutput): SuggestionDraft {
  return {
    kind: "rating",
    subjectType: "assessment_control",
    subjectId: i.assessmentControlId,
    title: `Rate ${i.control.code} ${i.control.title}: ${o.rating.replace(/_/g, " ")}`,
    summary: o.rationale,
    proposed: { rating: o.rating, rationale: o.rationale, controlCode: i.control.code },
    rationale: o.rationale,
    citations: [],
    confidence: o.confidence,
    tier: i.control.tier,
    inputHash: inputHash({
      k: "rating",
      a: i.assessmentControlId,
      e: i.evidence.map((e) => [e.id, e.reviewStatus, e.quality, e.validUntil]).sort(),
      t: i.tests.map((t) => [t.result, t.methodology]),
    }),
  };
}
