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
      return "positive";
    case "draft":
    case "not_assessed":
      return "neutral";
    case "partially_implemented":
      return "warning";
    case "not_implemented":
    case "suspended":
    case "closed":
      return "critical";
    default:
      return "neutral";
  }
}
