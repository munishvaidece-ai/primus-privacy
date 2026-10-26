import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

export const INPUT = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";
export const LABEL = "block text-xs font-medium text-slate-700";
export const CARD = "rounded-xl border border-slate-200 bg-white p-5 shadow-card";
export const TH = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500";
export const TD = "px-3 py-2 align-top";
export const LINK = "font-medium text-slate-900 hover:underline";

export function PageHeader({ title, subtitle, actions, crumb }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <div className="rise mb-7 border-b border-slate-200 pb-5">
      {crumb ? <p className="text-sm text-slate-500">{crumb}</p> : null}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">{title}</h1>
          {subtitle ? <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-slate-600">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Flash({ saved, error }: { saved?: string; error?: string }) {
  return (
    <>
      {saved ? <p role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-800">{saved === "1" ? "Saved." : saved}</p> : null}
      {error ? <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{error}</p> : null}
    </>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: string; href?: string; tone?: "warn" | "bad" }) {
  const body = (
    <div className={`${CARD} h-full ${href ? "transition hover:-translate-y-0.5 hover:shadow-lift" : ""}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-copper">{label}</p>
      <p className={`mt-1.5 font-display text-3xl font-bold ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-slate-900"}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center text-sm text-slate-500">{children}</div>;
}

export function Table({ head, children, label }: { head: string[]; children: ReactNode; label?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
      <table className="min-w-full divide-y divide-slate-200 text-sm" aria-label={label}>
        <thead className="bg-slate-100/70">
          <tr>{head.map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progress"}>
        <div className="h-full rounded-full bg-gradient-to-r from-copper-light to-brand" style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-600">{v}%</span>
    </div>
  );
}

export function severityTone(s: string): "neutral" | "positive" | "warning" | "critical" {
  return s === "critical" || s === "high" ? "critical" : s === "medium" ? "warning" : "neutral";
}
export const Severity = ({ value }: { value: string }) => <Badge tone={severityTone(value)}>{value}</Badge>;

export function phaseTone(p: string): "neutral" | "positive" | "warning" | "critical" {
  return p === "Closed" ? "neutral" : p === "Remediation" ? "positive" : p === "Draft" ? "neutral" : "warning";
}
export const PhaseBadge = ({ phase }: { phase: string }) => <Badge tone={phaseTone(phase)}>{phase}</Badge>;

export const SideBadge = ({ side }: { side: "primus" | "client" }) => <Badge tone={side === "primus" ? "neutral" : "warning"}>{side === "primus" ? "Primus" : "Client"}</Badge>;

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00Z" : d) : d;
  return date.toISOString().slice(0, 10);
}
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A GET filter bar: plain form, no JavaScript needed. */
export function FilterBar({ children, reset }: { children: ReactNode; reset: string }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-card">
      {children}
      <button type="submit" className="h-9 rounded-lg bg-brand px-4 font-display text-xs font-semibold text-white hover:bg-brand-dark">Filter</button>
      <Link href={reset} className="text-xs text-slate-600 hover:underline">Clear</Link>
    </form>
  );
}

export function FilterSelect({ name, label, value, options }: { name: string; label: string; value?: string; options: { value: string; label: string }[] }) {
  return (
    <label className={LABEL}>
      {label}
      <select name={name} defaultValue={value ?? ""} className={`${INPUT} w-auto min-w-36`}>
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function FilterText({ name, label, value, placeholder }: { name: string; label: string; value?: string; placeholder?: string }) {
  return (
    <label className={LABEL}>
      {label}
      <input name={name} defaultValue={value ?? ""} placeholder={placeholder} className={`${INPUT} w-auto min-w-48`} />
    </label>
  );
}

export const includesCI = (hay: string | null | undefined, needle: string | undefined) => !needle || (hay ?? "").toLowerCase().includes(needle.toLowerCase());
