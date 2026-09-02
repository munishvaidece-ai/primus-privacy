import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Status badge — PRODUCT_UX_BLUEPRINT.md §20's recommended shared
// component, applied here first. Colour is paired with the visible text
// label itself (children), never colour alone — PHASE A instructions
// §24 / PRODUCT_UX_BLUEPRINT.md §19: "status indicators must never be
// colour-only."
const toneClasses: Record<"neutral" | "positive" | "warning" | "critical", string> = {
  neutral: "bg-slate-100 text-slate-700",
  positive: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof toneClasses;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Maps the handful of status enums this slice renders to a tone —
 * centralized so every screen's badge stays consistent (rather than each
 * page inventing its own colour mapping). */
export function statusTone(status: string): keyof typeof toneClasses {
  switch (status) {
    case "active":
    case "finalized":
    case "implemented":
    case "pass":
    case "accepted":
    case "published":
    case "locked":
    case "applicable":
      return "positive";
    case "draft":
    case "not_assessed":
    case "not_applicable":
    case "pending_review":
    case "undecided":
      return "neutral";
    case "partially_implemented":
    case "exception_noted":
    case "expired":
      return "warning";
    case "not_implemented":
    case "suspended":
    case "closed":
    case "fail":
    case "rejected":
      return "critical";
    default:
      return "neutral";
  }
}

/**
 * Slice C3 — `risk_rating` (low/medium/high/critical) tone, kept
 * separate from `statusTone` above rather than added to its switch:
 * `statusTone`'s existing `"accepted"`/`"closed"` cases already carry
 * different, unrelated meanings (Evidence review acceptance; engagement/
 * membership suspension) that would collide with Risk's own
 * `risk_status` enum values of the same names if this were merged into
 * one shared switch.
 */
export function riskRatingTone(rating: string): keyof typeof toneClasses {
  switch (rating) {
    case "low":
      return "positive";
    case "medium":
      return "warning";
    case "high":
    case "critical":
      return "critical";
    default:
      return "neutral";
  }
}

/** Slice C3 — `risk_status` (open/mitigating/accepted/closed) tone. A
 * risk register's own "closed" (successfully resolved) and "accepted"
 * (a deliberate risk-acceptance decision) read as positive outcomes in
 * this context — the opposite of what those same words mean elsewhere
 * in `statusTone` above, which is exactly why this is its own function
 * rather than a shared switch case. */
export function riskStatusTone(status: string): keyof typeof toneClasses {
  switch (status) {
    case "open":
      return "warning";
    case "mitigating":
      return "neutral";
    case "accepted":
    case "closed":
      return "positive";
    default:
      return "neutral";
  }
}

/** Slice C4 — `finding_status` (open/in_progress/resolved/accepted)
 * tone. `finding_severity` reuses `riskRatingTone` directly above (an
 * identical low/medium/high/critical scale — no separate function
 * needed), but `finding_status`'s own value set differs enough from
 * `risk_status` (in_progress/resolved vs. mitigating/closed) to warrant
 * its own function rather than an approximate reuse. */
export function findingStatusTone(status: string): keyof typeof toneClasses {
  switch (status) {
    case "open":
      return "warning";
    case "in_progress":
      return "neutral";
    case "resolved":
    case "accepted":
      return "positive";
    default:
      return "neutral";
  }
}

/** Slice C5 — `remediation_action_status`
 * (open/in_progress/evidence_submitted/validated/closed) tone. Its own
 * distinct five-value set (DATA_MODEL.md §8's own verbatim
 * `OPEN|IN_PROGRESS|EVIDENCE_SUBMITTED|VALIDATED|CLOSED`) doesn't match
 * `risk_status`/`finding_status`, so this is its own function rather
 * than an approximate reuse. `remediation_priority` reuses
 * `riskRatingTone` directly (an identical low/medium/high/critical
 * scale) — no separate function needed. */
export function remediationStatusTone(status: string): keyof typeof toneClasses {
  switch (status) {
    case "open":
      return "warning";
    case "in_progress":
    case "evidence_submitted":
      return "neutral";
    case "validated":
    case "closed":
      return "positive";
    default:
      return "neutral";
  }
}
