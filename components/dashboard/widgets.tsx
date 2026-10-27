import type { ReactNode } from "react";
import Link from "next/link";

// Shared building blocks for the Primus dashboard and the client portal overview. Server components, plain SVG,
// no charting library: every figure on these screens is drawn from live records.

export const PALETTE = { brand: "#5c1a16", copper: "#a3652e", copperLight: "#d9a064", good: "#0f7a58", warn: "#c98a1b", bad: "#b42318", mute: "#e4c3bb" };

/** The deep-maroon band at the top of a dashboard: headline, a DPDP countdown, and a row of key figures. */
export function DashHero({ eyebrow, title, sub, daysToDuties, dutiesDate, children }: { eyebrow: string; title: string; sub?: ReactNode; daysToDuties: number; dutiesDate: string; children?: ReactNode }) {
  return (
    <section className="rise relative overflow-hidden rounded-2xl bg-[radial-gradient(900px_400px_at_85%_0%,rgba(200,138,74,.35),transparent_60%),linear-gradient(150deg,#2a0706_0%,#4a1411_60%,#3a0f0c_100%)] p-6 text-white shadow-lift sm:p-8">
      <svg viewBox="0 0 220 240" aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-72 w-64 text-white/10">
        <path d="M110 12 20 46v68c0 58 38 98 90 114 52-16 90-56 90-114V46z" fill="none" stroke="currentColor" strokeWidth="2" />
        {Array.from({ length: 9 }).flatMap((_, r) => Array.from({ length: 7 }).map((__, c) => <circle key={`${r}-${c}`} cx={36 + c * 25} cy={62 + r * 19} r="2" fill="currentColor" />))}
      </svg>
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#e9bd8c]">{eyebrow}</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {sub ? <p className="mt-2 max-w-2xl text-[15px] text-[#ffebe4]/80">{sub}</p> : null}
          {children ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div> : null}
        </div>
        <div className="rounded-2xl bg-white/10 p-5 ring-1 ring-inset ring-white/15 backdrop-blur-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#e9bd8c]">DPDP main duties</p>
          <p className="mt-1 font-display text-5xl font-bold leading-none tracking-tight">{Math.max(daysToDuties, 0).toLocaleString("en-IN")}</p>
          <p className="mt-1 text-sm text-[#ffebe4]/80">days to {dutiesDate}</p>
          <p className="mt-3 border-t border-white/15 pt-2 text-xs text-[#ffebe4]/70">Notice, consent, security, breach reporting, children, rights and penalties.</p>
        </div>
      </div>
    </section>
  );
}

export function HeroStat({ n, label, tone }: { n: ReactNode; label: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-inset ring-white/15">
      <p className={`font-display text-2xl font-bold sm:text-3xl ${tone ?? "text-white"}`}>{n}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f0c9a0]">{label}</p>
    </div>
  );
}

export function Panel({ title, hint, action, children, className = "" }: { title: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rise rounded-2xl border border-slate-200 bg-white p-5 shadow-card ${className}`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export interface Slice { label: string; value: number; color: string }

/** A donut with a total in the middle and a legend beside it. */
export function Donut({ slices, centre, caption }: { slices: Slice[]; centre?: ReactNode; caption?: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <figure className="relative h-36 w-36 shrink-0" aria-label={caption}>
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(", ") || "No data"}>
          <circle cx="70" cy="70" r={R} fill="none" stroke="#f3dcd6" strokeWidth="16" />
          {total > 0 ? slices.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * C;
            const el = <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`} strokeDashoffset={-off} />;
            off += len;
            return el;
          }) : null}
        </svg>
        <figcaption className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-2xl font-bold text-slate-900">{centre ?? total}</span>
          {caption ? <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{caption}</span> : null}
        </figcaption>
      </figure>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-700"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One horizontal stacked bar with a legend underneath. */
export function StackBar({ slices, empty }: { slices: Slice[]; empty?: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  if (!total) return <p className="text-sm text-slate-500">{empty ?? "Nothing to show yet."}</p>;
  return (
    <div>
      <div className="flex h-3.5 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(", ")}>
        {slices.filter((s) => s.value > 0).map((s) => <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.value}`} />)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
        {slices.map((s) => <li key={s.label} className="flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label} <b className="tabular-nums text-slate-900">{s.value}</b></li>)}
      </ul>
    </div>
  );
}

/** Horizontal bars, one row per label, scaled to the largest. */
export function BarList({ rows, empty }: { rows: Array<{ label: string; value: number; href?: string }>; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-slate-500">{empty ?? "Nothing to show yet."}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const row = (
          <div>
            <div className="flex justify-between text-sm"><span className="text-slate-700">{r.label}</span><span className="font-semibold tabular-nums text-slate-900">{r.value}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-copper-light to-brand" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          </div>
        );
        return <li key={r.label}>{r.href ? <Link href={r.href} className="block rounded-md hover:bg-slate-50">{row}</Link> : row}</li>;
      })}
    </ul>
  );
}

/** A small ring for a percentage. */
export function Ring({ value, size = 56 }: { value: number; size?: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const R = 20, C = 2 * Math.PI * R;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${v}%`}>
      <svg viewBox="0 0 48 48" className="-rotate-90">
        <circle cx="24" cy="24" r={R} fill="none" stroke="#f3dcd6" strokeWidth="5" />
        <circle cx="24" cy="24" r={R} fill="none" stroke="url(#ringg)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(v / 100) * C} ${C}`} />
        <defs><linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d9a064" /><stop offset="1" stopColor="#5c1a16" /></linearGradient></defs>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-[11px] font-bold text-slate-900">{v}%</span>
    </span>
  );
}

export interface Step { n: number; name: string; state: "done" | "now" | "todo"; who?: "you" | "primus" }

/** The seven phases as a connected stepper. */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-7" aria-label="Engagement phases">
      {steps.map((s) => (
        <li key={s.n} className="relative flex items-start gap-3 sm:flex-col sm:gap-2">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ring-4 ring-white ${s.state === "done" ? "bg-emerald-600 text-white" : s.state === "now" ? "bg-gradient-to-br from-copper-light to-brand text-white" : "bg-slate-200 text-slate-600"}`}>{s.state === "done" ? "✓" : s.n}</span>
          <span className="min-w-0">
            <span className={`block text-sm font-semibold leading-tight ${s.state === "todo" ? "text-slate-500" : "text-slate-900"}`}>{s.name}</span>
            {s.who ? <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-wider text-copper">{s.who === "you" ? "Your step" : "Primus"}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Needs({ items, empty }: { items: Array<{ label: string; detail?: string; n?: number; href: string }>; empty: string }) {
  if (!items.length) return <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((a) => (
        <li key={a.label}>
          <Link href={a.href} className="group flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-slate-50">
            <span className="min-w-0"><span className="block font-medium text-slate-900">{a.label}</span>{a.detail ? <span className="block text-xs text-slate-500">{a.detail}</span> : null}</span>
            <span className="flex items-center gap-2">{a.n !== undefined ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{a.n}</span> : null}<span aria-hidden className="text-copper transition-transform group-hover:translate-x-0.5">→</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Feed({ items }: { items: Array<{ id: string; text: string; sub?: string; at: string }> }) {
  if (!items.length) return <p className="text-sm text-slate-500">No activity yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-5">
      {items.map((a) => (
        <li key={a.id} className="relative text-sm">
          <span aria-hidden className="absolute -left-[26px] top-1.5 h-2 w-2 rounded-full bg-copper ring-4 ring-white" />
          <p className="text-slate-800">{a.text}</p>
          <p className="text-xs text-slate-500">{a.sub ? `${a.sub} · ` : ""}{a.at}</p>
        </li>
      ))}
    </ol>
  );
}
