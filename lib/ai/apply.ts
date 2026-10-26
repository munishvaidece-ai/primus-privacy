import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { RequestDb } from "@/lib/db/request-client";
import { aiReportIssuances, assessmentControls, assessmentResponses, opsCases } from "@/db/schema";
import { reviewEvidence } from "@/lib/domain/evidence";
import { updateAssessmentResponse } from "@/lib/domain/assessments";
import { updateControlApplicability } from "@/lib/domain/applicability";
import { createRisk } from "@/lib/domain/risks";
import { createFinding } from "@/lib/domain/findings";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import type { SuggestionKind } from "./types";
import { bandRating } from "./tasks/finding";
import { applyClosureCheck, applyDiscoveryPrefill, applyLandscape, applyRemediationPlan, applyScopeSector, applyScopeUnits } from "./apply-intake";

export interface ApplyContext {
  actorUserId: string;
  /** "ai" when the autopilot applies it; "human" when a person approved it. */
  actorType: "ai" | "human";
  suggestion: {
    id: string;
    kind: SuggestionKind;
    subjectId: string | null;
    tenantId: string;
    organisationId: string;
    engagementId: string;
    proposed: Record<string, unknown>;
    provider: string;
  };
}

/** Fields a person may change when overriding, per kind. Anything else is ignored. */
export const OVERRIDABLE: Partial<Record<SuggestionKind, string[]>> = {
  applicability: ["decision", "rationale"],
  evidence_review: ["decision", "reviewRationale"],
  rating: ["rating", "rationale"],
  finding_create: ["title", "description", "severity"],
  report_issue: ["headline", "narrative"],
  breach_notice: ["boardNoticeDraft", "principalNoticeDraft"],
  rights_triage: ["draftResponse", "dueAt", "severity"],
};

export function mergeOverride(kind: SuggestionKind, proposed: Record<string, unknown>, final: Record<string, unknown> | null): Record<string, unknown> {
  if (!final) return proposed;
  const allowed = OVERRIDABLE[kind] ?? [];
  const out = { ...proposed };
  for (const k of allowed) if (final[k] !== undefined && final[k] !== null && final[k] !== "") out[k] = final[k];
  return out;
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : Number(v ?? fallback));

function who(c: ApplyContext): string {
  return c.actorType === "ai" ? `AI-assisted (${c.suggestion.provider}), applied under autopilot` : `AI-assisted (${c.suggestion.provider}), approved by a reviewer`;
}

/** Applies a suggestion to the real records through the SAME domain functions a person would use. Returns a reference to what was created/changed. */
export async function applySuggestion(db: RequestDb, c: ApplyContext, proposed: Record<string, unknown>): Promise<Record<string, unknown>> {
  const s = c.suggestion;
  switch (s.kind) {
    case "applicability": {
      if (!s.subjectId) throw new NotFoundOrForbiddenError();
      await updateControlApplicability(db, c.actorUserId, {
        engagementScopeControlId: s.subjectId,
        decision: str(proposed.decision) as "applicable" | "not_applicable",
        rationale: `${str(proposed.rationale)} [${who(c)}]`,
      });
      return { table: "engagement_scope_controls", id: s.subjectId };
    }
    case "evidence_review": {
      if (!s.subjectId) throw new NotFoundOrForbiddenError();
      const decision = str(proposed.decision) as "accepted" | "rejected";
      await reviewEvidence(db, c.actorUserId, {
        organisationId: s.organisationId,
        engagementId: s.engagementId,
        evidenceId: s.subjectId,
        reviewStatus: decision,
        reviewRationale: `${str(proposed.reviewRationale)} [${who(c)}]`,
      });
      return { table: "evidence", id: s.subjectId };
    }
    case "rating": {
      if (!s.subjectId) throw new NotFoundOrForbiddenError();
      const rating = str(proposed.rating) as "implemented" | "partially_implemented" | "not_implemented";
      await updateAssessmentResponse(db, c.actorUserId, {
        assessmentControlId: s.subjectId,
        effectivenessRating: rating,
        decisionRationale: `${str(proposed.rationale)} [${who(c)}]`,
      });
      // Record what the AI itself suggested in the column the data model reserves for it.
      await db
        .update(assessmentResponses)
        .set({ systemSuggestedRating: (str(s.proposed.rating) || rating) as "implemented" | "partially_implemented" | "not_implemented" })
        .where(eq(assessmentResponses.assessmentControlId, s.subjectId));
      return { table: "assessment_responses", assessmentControlId: s.subjectId };
    }
    case "finding_create": {
      if (!s.subjectId) throw new NotFoundOrForbiddenError();
      const [ac] = await db
        .select({ assessmentId: assessmentControls.assessmentId, controlId: assessmentControls.controlId })
        .from(assessmentControls)
        .where(eq(assessmentControls.id, s.subjectId))
        .limit(1);
      if (!ac) throw new NotFoundOrForbiddenError();
      const likelihood = num(proposed.likelihood, 3);
      const impact = num(proposed.impact, 3);
      const risk = await createRisk(db, c.actorUserId, {
        assessmentId: ac.assessmentId,
        controlId: ac.controlId,
        title: str(proposed.title).slice(0, 200),
        description: `${str(proposed.description)}\n\nRecommended action: ${str(proposed.recommendedAction)}\n\n[${who(c)}]`,
        likelihood,
        impact,
        inherentRating: bandRating(likelihood, impact),
        residualLikelihood: null,
        residualImpact: null,
        residualRating: null,
        assignOwnerToSelf: false,
      });
      const finding = await createFinding(db, c.actorUserId, {
        riskId: risk.id,
        title: str(proposed.title).slice(0, 200),
        description: `${str(proposed.description)}\n\nRecommended action: ${str(proposed.recommendedAction)}\n\n[${who(c)}]`,
        severity: str(proposed.severity) as "low" | "medium" | "high" | "critical",
        assignOwnerToSelf: false,
      });
      return { table: "findings", riskId: risk.id, findingId: finding.id };
    }
    case "report_issue": {
      if (!s.subjectId) throw new NotFoundOrForbiddenError();
      const [last] = await db
        .select({ version: aiReportIssuances.version })
        .from(aiReportIssuances)
        .where(eq(aiReportIssuances.assessmentId, s.subjectId))
        .orderBy(desc(aiReportIssuances.version))
        .limit(1);
      const version = (last?.version ?? 0) + 1;
      const [row] = await db
        .insert(aiReportIssuances)
        .values({
          tenantId: s.tenantId,
          organisationId: s.organisationId,
          engagementId: s.engagementId,
          assessmentId: s.subjectId,
          version,
          headline: str(proposed.headline),
          narrative: str(proposed.narrative),
          suggestionId: s.id,
          issuedBy: c.actorUserId,
        })
        .returning({ id: aiReportIssuances.id });
      return { table: "ai_report_issuances", id: row!.id, version };
    }
    case "rights_triage": {
      await updateCase(db, c, {
        status: "triaged",
        dueAt: str(proposed.dueAt) ? new Date(str(proposed.dueAt)) : undefined,
        severity: (str(proposed.severity) || "low") as "low" | "medium" | "high" | "critical",
        aiAssessment: { kind: "rights_triage", summary: proposed.summary, steps: proposed.steps, by: who(c) },
        draftResponse: str(proposed.draftResponse),
      });
      return { table: "ops_cases", id: s.subjectId };
    }
    case "breach_assess": {
      await updateCase(db, c, {
        status: "triaged",
        dueAt: str(proposed.boardReportDueAt) ? new Date(str(proposed.boardReportDueAt)) : undefined,
        severity: (str(proposed.severity) || "medium") as "low" | "medium" | "high" | "critical",
        aiAssessment: { kind: "breach_assess", ...proposed, by: who(c) },
      });
      return { table: "ops_cases", id: s.subjectId };
    }
    case "breach_notice": {
      const text = `BOARD NOTICE\n\n${str(proposed.boardNoticeDraft)}\n\n------\nDATA PRINCIPAL NOTICE\n\n${str(proposed.principalNoticeDraft)}`;
      if (c.actorType === "human") {
        // A person with release rights approving: the notice is authorised.
        await updateCase(db, c, { status: "in_progress", draftResponse: text, responseApprovedAt: new Date(), responseApprovedBy: c.actorUserId });
      } else {
        // The AI can prepare the notice but never authorises it (database-enforced).
        await updateCase(db, c, { status: "awaiting_approval", draftResponse: text });
      }
      return { table: "ops_cases", id: s.subjectId };
    }
    case "consent_review":
    case "vendor_review": {
      const sev =
        s.kind === "consent_review"
          ? proposed.verdict === "compliant" ? "low" : proposed.verdict === "needs_changes" ? "medium" : "high"
          : (str(proposed.riskLevel) || "medium");
      await updateCase(db, c, { status: "triaged", severity: sev as "low" | "medium" | "high" | "critical", aiAssessment: { kind: s.kind, ...proposed, by: who(c) } });
      return { table: "ops_cases", id: s.subjectId };
    }
    case "scope_sector": return applyScopeSector(db, c, proposed);
    case "scope_units": return applyScopeUnits(db, c, proposed);
    case "landscape_load": return applyLandscape(db, c, proposed);
    case "discovery_prefill": return applyDiscoveryPrefill(db, c, proposed);
    case "remediation_plan": return applyRemediationPlan(db, c, proposed);
    case "closure_check": return applyClosureCheck(db, c, proposed);
  }
}

async function updateCase(
  db: RequestDb,
  c: ApplyContext,
  set: Partial<typeof opsCases.$inferInsert>,
): Promise<void> {
  const id = c.suggestion.subjectId;
  if (!id) throw new NotFoundOrForbiddenError();
  const clean = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
  const rows = await db
    .update(opsCases)
    .set({ ...clean, updatedBy: c.actorUserId, updatedAt: new Date() })
    .where(and(eq(opsCases.id, id), eq(opsCases.engagementId, c.suggestion.engagementId)))
    .returning({ id: opsCases.id });
  if (rows.length === 0) throw new NotFoundOrForbiddenError();
}
