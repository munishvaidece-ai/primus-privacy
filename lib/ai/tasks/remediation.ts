// Phase 7: (a) turns released findings into remediation actions with owners' due dates,
// (b) reads the client's proof for each action it says is finished and proposes to
// close it, or says what is missing. Offline rules only.
import { z } from "zod";
import type { TaskDef } from "../engine";
import type { RiskTier, Source, SuggestionDraft } from "../types";
import { inputHash, normalise, textStems, topicTerms } from "../text";
import { who, type Actor } from "../provenance";

// -------------------------------------------------------------- plan
export interface RemediationPlanInput {
  findingId: string;
  title: string;
  description: string;
  severity: RiskTier;
  controlCode: string | null;
  controlTitle: string | null;
  releasedAt: string | null;
  today: string; // YYYY-MM-DD
}
export const remediationPlanOutput = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(5).max(3000),
  priority: z.enum(["low", "medium", "high", "critical"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueInDays: z.number(),
  confidence: z.number().min(0).max(1),
});
export type RemediationPlanOutput = z.infer<typeof remediationPlanOutput>;

const DAYS: Record<RiskTier, number> = { critical: 30, high: 60, medium: 90, low: 180 };
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

export function offlineRemediationPlan(i: RemediationPlanInput): RemediationPlanOutput {
  const m = /Recommended action:\s*([\s\S]*?)(?:\n\n|\[AI-assisted|$)/i.exec(i.description);
  const action = m?.[1]?.trim();
  const days = DAYS[i.severity];
  return {
    title: `Fix: ${i.title}`.slice(0, 200),
    description: `${action ?? `Close the gap described in the finding${i.controlCode ? ` for control ${i.controlCode}` : ""}.`}\n\nDone when: the client provides proof (a policy, a record or a screenshot) that shows the change is in place and running.`,
    priority: i.severity,
    dueDate: addDays(i.today, days),
    dueInDays: days,
    confidence: action ? 0.88 : 0.72,
  };
}
export const remediationPlanTask: TaskDef<RemediationPlanInput, RemediationPlanOutput> = {
  kind: "remediation_plan",
  outputSchema: remediationPlanOutput,
  offline: offlineRemediationPlan,
  system: "Turn a privacy compliance finding into one remediation action: a clear title, what must be done, how the client proves it, a priority and a due date proportionate to severity (critical 30 days, high 60, medium 90, low 180).",
  prompt: (i) => `FINDING (${i.severity}): ${i.title}\n${i.description}\nCONTROL: ${i.controlCode ?? "-"} ${i.controlTitle ?? ""}\nTODAY: ${i.today}`,
};

export function remediationPlanSources(i: RemediationPlanInput, by: Actor | null): Source[] {
  return [
    {
      type: "record",
      label: `Finding: ${i.title}`,
      origin: by ? `Written by ${who(by)}${i.releasedAt ? `, released to the client on ${i.releasedAt.slice(0, 10)}` : ""}` : "Finding in this engagement",
      providedBy: by ? { name: by.name, side: by.side } : undefined,
      channel: "Phase 6, Findings released",
      ref: i.findingId,
      why: "A released finding with no remediation action yet, so the AI picked it up.",
      detail: `${i.severity} severity${i.controlCode ? ` · control ${i.controlCode}` : ""}`,
      link: `/findings/${i.findingId}`,
    },
    { type: "summary", label: "Due date rule", origin: "Primus house standard", why: `Due dates follow severity: critical 30 days, high 60, medium 90, low 180. This one is ${i.severity}.` },
  ];
}
export function remediationPlanDraft(i: RemediationPlanInput, o: RemediationPlanOutput): SuggestionDraft {
  return {
    kind: "remediation_plan",
    subjectType: "finding",
    subjectId: i.findingId,
    title: `Remediation action: ${o.title}`,
    summary: `${o.priority} priority, due ${o.dueDate} (${o.dueInDays} days after today).`,
    proposed: { findingId: i.findingId, title: o.title, description: o.description, priority: o.priority, dueDate: o.dueDate },
    rationale: `Finding "${i.title}" is ${i.severity} severity, so the action is ${o.priority} priority and due in ${o.dueInDays} days.`,
    citations: [],
    confidence: o.confidence,
    tier: i.severity === "critical" ? "high" : "medium",
    inputHash: inputHash({ k: "remediation_plan", f: i.findingId }),
  };
}

// -------------------------------------------------------------- closure
export interface ClosureInput {
  actionId: string;
  actionTitle: string;
  actionDescription: string;
  priority: string | null;
  status: string;
  claim: { done: string; date: string; by: string; proofFile: string; row: number };
  closureFileId: string;
  closureFileName: string;
  uploadedAt: string;
  uploadedBy: Actor;
  proof: { fileId: string; filename: string; text: string; method: string; uploadedBy: Actor; uploadedAt: string } | null;
  now: string;
}
export const closureOutput = z.object({
  decision: z.enum(["close", "needs_more", "reject"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(5).max(2000),
  missing: z.array(z.string()),
  matched: z.array(z.string()),
});
export type ClosureOutput = z.infer<typeof closureOutput>;

const BOILERPLATE = textStems("place partly complete completed document elements evidence operation provide implement design assign owner missing gaps close closing proof client");

export function offlineClosure(i: ClosureInput): ClosureOutput {
  if (!i.proof) {
    return { decision: "needs_more", confidence: 0.9, rationale: `The closure log names the proof file "${i.claim.proofFile}", but no file with that name was uploaded.`, missing: [`the file "${i.claim.proofFile}"`], matched: [] };
  }
  const text = i.proof.text;
  if (text.trim().length < 150) {
    return { decision: "needs_more", confidence: 0.35, rationale: `Only ${text.trim().length} characters could be read from "${i.proof.filename}" (${i.proof.method}). It may be a scan or an image, so a person should look at it.`, missing: ["a readable copy of the proof"], matched: [] };
  }
  // The topics are the action's own subject. Boilerplate words that every action carries ("in place", "evidence of
  // operation", "complete the missing elements") say nothing about the subject, so they are not counted.
  const want = [...new Set(topicTerms(`${i.actionTitle} ${i.actionTitle} ${i.actionDescription.replace(/Done when:.*/is, "")}`, 14))].filter((t) => !BOILERPLATE.has(t)).slice(0, 8);
  // Only the proof is read. What the client says it did is a claim, not evidence, so it does not count towards coverage.
  const stems = textStems(text);
  const present = want.filter((t) => stems.has(t));
  const missing = want.filter((t) => !stems.has(t));
  const cover = want.length ? present.length / want.length : 0;
  const dated = /\b(20\d{2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text);
  const approved = /\b(approved|signed|authori[sz]ed|adopted|effective|version|resolved by)\b/i.test(text);
  const evidence = [dated ? "dated" : null, approved ? "approved or signed" : null].filter(Boolean) as string[];
  if (cover >= 0.6 && dated && approved) {
    return {
      decision: "close",
      confidence: Math.min(0.93, 0.7 + cover * 0.2 + 0.05),
      rationale: `The proof covers ${present.length} of the ${want.length} topics the action asked for (${present.join(", ")}), and it is ${evidence.join(" and ")}. It matches what the client says was done.`,
      missing,
      matched: present,
    };
  }
  if (cover >= 0.6) {
    const lacks = [!dated ? "a date" : null, !approved ? "an approval, version or sign-off" : null].filter(Boolean).join(" and ");
    return { decision: "needs_more", confidence: 0.72, rationale: `The proof mentions the topic (${present.join(", ")}) but is missing ${lacks}. A note that talks about the subject is not proof that the change is in place and approved.`, missing: [lacks, ...missing], matched: present };
  }
  if (cover >= 0.35) {
    return { decision: "needs_more", confidence: 0.7, rationale: `The proof covers only ${present.length} of ${want.length} topics (${present.join(", ") || "none"}). Not found: ${missing.join(", ")}.${dated ? "" : " It also carries no date."}`, missing, matched: present };
  }
  return { decision: "reject", confidence: 0.75, rationale: `"${i.proof.filename}" does not appear to relate to this action. It covers ${present.length} of ${want.length} topics the action asked for.`, missing, matched: present };
}
export const closureTask: TaskDef<ClosureInput, ClosureOutput> = {
  kind: "closure_check",
  outputSchema: closureOutput,
  offline: offlineClosure,
  system: "You check whether a client's proof document shows that a remediation action was really completed. Be sceptical: a document that only mentions the topic is not proof. Decide close | needs_more | reject.",
  prompt: (i) => `ACTION: ${i.actionTitle}\n${i.actionDescription}\nCLIENT SAYS: ${i.claim.done} (by ${i.claim.by} on ${i.claim.date})\nPROOF TEXT:\n"""\n${i.proof?.text.slice(0, 6000) ?? "(no file)"}\n"""`,
};

export function closureSources(i: ClosureInput): Source[] {
  const out: Source[] = [
    {
      type: "document",
      label: `Closure log (${i.closureFileName}), row ${i.claim.row}`,
      origin: `Uploaded by ${who(i.uploadedBy)} on ${i.uploadedAt.slice(0, 10)}`,
      providedBy: { name: i.uploadedBy.name, side: i.uploadedBy.side === "system" ? "primus" : i.uploadedBy.side },
      channel: "Live Run, phase 7 (Remediation and final report): Closure log upload",
      at: i.uploadedAt,
      ref: i.closureFileId,
      why: "The client says this action is finished and names the proof.",
      detail: `"${i.claim.done}" · by ${i.claim.by} on ${i.claim.date} · proof file: ${i.claim.proofFile}`,
      link: "/live",
    },
  ];
  if (i.proof) {
    out.push({
      type: "document",
      label: `Proof: ${i.proof.filename}`,
      origin: `Uploaded by ${who(i.proof.uploadedBy)} on ${i.proof.uploadedAt.slice(0, 10)}`,
      providedBy: { name: i.proof.uploadedBy.name, side: i.proof.uploadedBy.side === "system" ? "primus" : i.proof.uploadedBy.side },
      channel: "Live Run, phase 7: proof file upload",
      at: i.proof.uploadedAt,
      ref: i.proof.fileId,
      why: "The file the client named as proof.",
      detail: `${i.proof.text.length.toLocaleString("en-IN")} characters read (${i.proof.method})`,
      excerpt: i.proof.text.replace(/\s+/g, " ").slice(0, 600),
      link: "/live",
    });
  }
  out.push({ type: "record", label: `Remediation action: ${i.actionTitle}`, origin: "Created in phase 7 from a released finding", ref: i.actionId, why: "This is what the proof is judged against.", detail: i.actionDescription.slice(0, 300), link: `/remediation/${i.actionId}` });
  return out;
}
export function closureDraft(i: ClosureInput, o: ClosureOutput): SuggestionDraft {
  const verdict = o.decision === "close" ? "Close" : o.decision === "needs_more" ? "Needs more proof" : "Proof does not match";
  return {
    kind: "closure_check",
    subjectType: "remediation_action",
    subjectId: i.actionId,
    title: `${verdict}: ${i.actionTitle}`,
    summary: o.rationale,
    proposed: { decision: o.decision, rationale: o.rationale, missing: o.missing, proofFile: i.proof?.filename ?? i.claim.proofFile },
    rationale: o.rationale,
    citations: [],
    sources: closureSources(i),
    confidence: o.confidence,
    tier: "medium",
    needsHuman: o.decision === "close" ? "Closing an action is a Primus validation decision, so a person confirms it." : o.decision === "reject" ? "The proof looks unrelated, so a person decides what to tell the client." : undefined,
    inputHash: inputHash({ k: "closure_check", a: i.actionId, f: i.closureFileId, p: i.proof?.fileId ?? null }),
  };
}
void normalise;
