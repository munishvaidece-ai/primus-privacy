import type { ReactNode } from "react";
import { Wordmark } from "@/components/shell/logo";

// Shared frame for the sign-in screens: the microsite's header, hero grid
// and warm gradient, so the first thing a viewer sees matches the site.
export function LoginFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#fdf2f0] via-[#fdf8f6] to-white">
      <div className="hero-grid-bg pointer-events-none absolute inset-0 opacity-35" aria-hidden="true" />
      <div className="app-bg" aria-hidden="true"><i /><i /><i /></div>
      <header className="relative z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <a href="/site/index.html" aria-label="Primus Privacy site"><Wordmark /></a>
          <a href="/site/index.html" className="rounded-lg border border-slate-200 px-3.5 py-2 font-display text-xs font-semibold text-slate-900 transition hover:border-copper hover:text-copper">&larr; Back to the site</a>
        </div>
      </header>
      <main className={`relative z-10 mx-auto px-6 py-12 sm:py-16 ${wide ? "max-w-6xl" : "max-w-xl"}`}>{children}</main>
      <footer className="relative z-10 pb-8 text-center text-xs text-slate-500">Primus Privacy is a Primus Partners platform. All demo organisations and people are fictional.</footer>
    </div>
  );
}

export function DemoBanner() {
  return (
    <p role="note" className="mx-auto mb-8 w-fit rounded-full border border-copper/30 bg-copper-soft px-4 py-1.5 text-xs font-semibold text-copper-deep">
      Demo mode · no password needed · works only on this computer
    </p>
  );
}

const ROLE_BLURB: Record<string, string> = {
  "Platform Administrator": "Runs everything: all clients, users, reviews and releases",
  "Engagement Manager": "Leads the engagement, validates answers and releases reports",
  "Practice Partner": "Oversees the whole portfolio and approves releases",
  Consultant: "Configures assessments and prepares findings",
  Auditor: "Read-only review and the audit trail",
  "Client Administrator": "Runs the programme inside the organisation",
  "Privacy Officer": "Answers questions, uploads evidence, logs rights requests",
  "CXO / Executive Viewer": "Leadership view: reads results, cannot change anything",
  "Business Owner": "Answers the questions for their own business area",
};
export const roleBlurb = (roles: string[]) => roles.map((r) => ROLE_BLURB[r]).find(Boolean) ?? "";

export function Avatar({ name, tone = "brand" }: { name: string; tone?: "brand" | "copper" }) {
  const parts = name.split(/\s+/).filter(Boolean);
  const t = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  return (
    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full font-display text-sm font-semibold text-white ${tone === "brand" ? "bg-gradient-to-br from-[#8a3a2f] to-brand" : "bg-gradient-to-br from-copper-light to-copper-deep"}`} aria-hidden="true">{t}</span>
  );
}
