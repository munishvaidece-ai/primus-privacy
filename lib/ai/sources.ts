// Builds the evidence trail for each kind of AI output: every item the AI
// read, who supplied it, which feature put it in front of the AI, and why it
// was chosen. Pure functions over the same inputs the AI task received, so the
// trail can never describe something other than what the AI actually saw.
import { maskPii } from "./mask";
import { who, SIDE_WORDS, type Actor } from "./provenance";
import { textStems, topicTerms } from "./text";
import type { EvidenceReviewInput } from "./tasks/evidence-review";
import type { RatingInput } from "./tasks/rating";
import type { ApplicabilityInput } from "./tasks/applicability";
import type { FindingInput } from "./tasks/finding";
import type { ReportInput } from "./tasks/report";
import type { Source, SuggestionDraft } from "./types";

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "date unknown");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()} …` : s);
const SYSTEM: Actor = { name: null, side: "system" };

export function withSources(draft: SuggestionDraft, sources: Source[]): SuggestionDraft {
  return { ...draft, sources };
}

function controlSource(c: { code: string; title: string; description: string | null; tier: string }, why: string, extra?: string): Source {
  return {
    type: "control",
    label: `Control ${c.code}: ${c.title}`,
    origin: "Control library (the published standard the engagement is measured against)",
    providedBy: { name: "Primus Partners methodology", side: "primus" },
    channel: "Primus workspace, Methodology → Control library",
    why,
    detail: [c.description ? `Requirement: ${c.description}` : null, `Stakes: ${c.tier}`, extra].filter(Boolean).join(" · "),
  };
}

function answerSource(a: { actor: Actor; at: string | null } | null | undefined, rating: string | null | undefined): Source | null {
  if (!a) return null;
  return {
    type: "response",
    label: `The answer given on this control${rating ? `: ${rating.replace(/_/g, " ")}` : ""}`,
    origin: `Answered by ${who(a.actor)} on ${day(a.at)}`,
    providedBy: { name: a.actor.name, side: a.actor.side },
    channel: a.actor.side === "client" ? "Client portal, Assessment" : a.actor.side === "system" ? "Written by the AI under autopilot (Rating)" : "Primus workspace, Assessment",
    at: a.at ?? undefined,
    why: "The rating is judged against what the organisation itself said about this control.",
  };
}

// ---------------------------------------------------------------- evidence
export function evidenceReviewSources(i: EvidenceReviewInput): Source[] {
  const p = i.prov;
  const out: Source[] = [];
  const masked = maskPii(i.text.slice(0, 700)).text;
  out.push({
    type: "document",
    label: `Document: ${i.title}${p?.filename ? ` (${p.filename})` : i.filename ? ` (${i.filename})` : ""}`,
    origin: p ? `Uploaded by ${who(p.actor)} on ${day(p.uploadedAt)}${p.requestRef ? `, in reply to evidence request ${p.requestRef}` : ""}` : "Evidence record in this engagement",
    providedBy: p ? { name: p.actor.name, side: p.actor.side } : undefined,
    channel: p?.channel ?? "Evidence upload",
    at: p?.uploadedAt ?? undefined,
    ref: i.evidenceId,
    why: i.controls.length
      ? `It is linked to ${i.controls.map((c) => c.code).join(", ")} and was waiting for review, so the AI picked it up.`
      : "It was waiting for review, but is not linked to any control.",
    detail: `${i.evidenceType.replace(/_/g, " ")} · ${i.text.length.toLocaleString("en-IN")} characters read (${i.textMethod})${i.validUntil ? ` · valid until ${day(i.validUntil)}` : " · no expiry date stated"}`,
    excerpt: masked ? cut(masked, 700) : undefined,
    link: "/evidence-review",
  });
  for (const c of i.controls) {
    const terms = [...new Set(topicTerms(`${c.title} ${c.title} ${c.description ?? ""}`, 8))];
    const stems = textStems(i.text);
    const present = terms.filter((t) => stems.has(t));
    const missing = terms.filter((t) => !stems.has(t));
    out.push(
      controlSource(
        c,
        `The document is linked to this control, so the control's own wording is the yardstick for "does it prove this is in place?".`,
        terms.length ? `Topic check: looked for ${terms.join(", ")}; found ${present.length} of ${terms.length}${missing.length ? ` (not found: ${missing.join(", ")})` : ""}` : undefined,
      ),
    );
  }
  return out;
}

// ------------------------------------------------------------------ rating
export function ratingSources(i: RatingInput): Source[] {
  const out: Source[] = [controlSource(i.control, "This is the control being rated.")];
  const ans = answerSource(i.answeredBy, i.currentRating);
  if (ans) out.push(ans);
  for (const e of i.evidence) {
    const expired = e.validUntil ? new Date(e.validUntil) < new Date(i.now) : false;
    const counted = e.reviewStatus === "accepted" && !expired;
    out.push({
      type: "evidence",
      label: `Evidence: ${e.title}${e.prov?.filename ? ` (${e.prov.filename})` : ""}`,
      origin: e.prov ? `Uploaded by ${who(e.prov.actor)} on ${day(e.prov.uploadedAt)}${e.prov.requestRef ? `, in reply to ${e.prov.requestRef}` : ""}` : "Evidence record linked to this control",
      providedBy: e.prov ? { name: e.prov.actor.name, side: e.prov.actor.side } : undefined,
      channel: e.prov?.channel,
      at: e.prov?.uploadedAt ?? undefined,
      ref: e.id,
      why: counted ? "Linked to this control and accepted by a reviewer, so it counts towards the rating." : expired ? "Linked to this control but expired, so it does not count." : `Linked to this control but its review status is "${e.reviewStatus.replace(/_/g, " ")}", so it does not count yet.`,
      detail: `Review status: ${e.reviewStatus.replace(/_/g, " ")} · quality: ${e.quality ?? "not rated"}${e.validUntil ? ` · valid until ${day(e.validUntil)}` : ""}`,
      link: "/evidence-review",
    });
  }
  for (const t of i.tests) {
    out.push({
      type: "test",
      label: `Control test (${t.methodology}): ${t.result.replace(/_/g, " ")}`,
      origin: `Recorded${t.by ? ` by ${who(t.by)}` : ""} on ${day(t.testedAt)}`,
      providedBy: t.by ? { name: t.by.name, side: t.by.side } : { name: null, side: "primus" },
      channel: "Primus workspace, Control tests",
      at: t.testedAt ?? undefined,
      ref: t.id,
      why: t.result === "fail" ? "A failed test is the strongest signal that the control does not work as described." : "Test results are weighed with the documents: passes support the control, exceptions and failures weaken it.",
    });
  }
  return out;
}

// ----------------------------------------------------------- applicability
export function applicabilitySources(i: ApplicabilityInput): Source[] {
  const p = i.profile;
  const names = (p.contributors ?? []).map((c) => who(c));
  const sides = new Set((p.contributors ?? []).map((c) => c.side));
  return [
    controlSource(i.control, "This is the control whose applicability is being decided."),
    {
      type: "record",
      label: "The client's data landscape (what personal data is processed, and how)",
      origin: names.length ? `Entered by ${names.join("; ")}` : "Data landscape records for this engagement",
      providedBy: names.length === 1 && p.contributors?.[0] ? { name: p.contributors[0].name, side: p.contributors[0].side } : { name: null, side: sides.has("client") && !sides.has("primus") ? "client" : "primus" },
      channel: "Data Landscape (processing activities, data categories, processors)",
      why: "By default every DPDP obligation applies. The AI marks a control not applicable only on positive evidence in this landscape.",
      detail: `${p.activities} processing activit${p.activities === 1 ? "y" : "ies"}${p.principalCategories.length ? ` · people: ${p.principalCategories.join(", ")}` : ""}${p.dataElements.length ? ` · data: ${p.dataElements.join(", ")}` : ""} · outside processors: ${p.hasProcessors ? "yes" : "none recorded"} · transfers outside India hinted: ${p.crossBorderHints ? "yes" : "no"} · children's data hinted: ${p.childrenHints ? "yes" : "no"}`,
    },
  ];
}

// ----------------------------------------------------------------- finding
export function findingSources(i: FindingInput): Source[] {
  const out: Source[] = [controlSource(i.control, "This control is rated weak, which is what triggers a finding.")];
  const ans = answerSource(i.answeredBy, i.rating);
  if (ans) out.push(ans);
  out.push({
    type: "record",
    label: `Rating on this control: ${i.rating.replace(/_/g, " ")}`,
    origin: i.ratingRationale ? `Reason recorded with the rating: ${cut(i.ratingRationale, 240)}` : "Assessment response",
    providedBy: { name: null, side: "system" },
    channel: "Assessment (rating, possibly set earlier by the AI or a reviewer)",
    why: `A ${i.rating.replace(/_/g, " ")} rating with ${Math.round(i.ratingConfidence * 100)}% confidence is what the severity and the proposed action are based on.`,
  });
  return out;
}

// ------------------------------------------------------------------ report
export function reportSources(i: ReportInput): Source[] {
  const f = i.findingsBySeverity;
  return [
    {
      type: "summary",
      label: `Assessment results for ${i.periodLabel}`,
      origin: "Counted from the finalised assessment (answers given by the client, validated by Primus)",
      providedBy: { name: null, side: "system" },
      channel: "Assessment",
      why: "The report summary describes the assessment outcome, so the AI is given the counts, not the underlying documents.",
      detail: `${i.controlsTotal} controls: ${i.implemented} implemented, ${i.partial} partly, ${i.notImplemented} not implemented, ${i.notApplicable} not applicable, ${i.notAssessed} not assessed`,
    },
    {
      type: "summary",
      label: "Findings and remediation",
      origin: "Counted from the findings and remediation records of this engagement",
      providedBy: { name: null, side: "system" },
      channel: "Findings, Remediation",
      why: "The report states how serious the findings are and how much work is still open.",
      detail: `Findings: ${f.critical} critical, ${f.high} high, ${f.medium} medium, ${f.low} low · ${i.openRemediation} remediation actions still open`,
    },
    {
      type: "summary",
      label: "Maturity score",
      origin: "Calculated from the finalised assessment by the maturity method",
      providedBy: { name: null, side: "system" },
      channel: "Maturity scoring",
      why: "Included only if a maturity score has been calculated.",
      detail: i.maturityScore ?? "No maturity score has been calculated for this assessment.",
    },
  ];
}

// --------------------------------------------------------------- ops cases
export function caseSources(kind: "rights" | "breach" | "consent" | "vendor", c: { reference: string }, detail: string, logged: { actor: Actor | null; at: string | null; channelWord: string }): Source[] {
  const label = { rights: "Rights request", breach: "Breach report", consent: "Consent text under review", vendor: "Vendor under review" }[kind];
  const a = logged.actor;
  return [
    {
      type: "case",
      label: `${label} ${c.reference}`,
      origin: a ? `Logged by ${who(a)} on ${day(logged.at)}` : `Logged on ${day(logged.at)}`,
      providedBy: a ? { name: a.name, side: a.side } : SYSTEM,
      channel: logged.channelWord,
      at: logged.at ?? undefined,
      why: "A new case was waiting, so the AI read the case record to triage it.",
      detail,
    },
  ];
}

export { SIDE_WORDS };
