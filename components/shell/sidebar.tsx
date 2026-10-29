"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CLIENT_NAV, PRIMUS_NAV, locate } from "./nav-config";

// Small line icons (same stroke style as the microsite).
const ICONS: Record<string, string> = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  check: "M9 12l2 2 4-4M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0",
  building: "M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  users: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  alert: "M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z",
  audit: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5V21h16",
  plug: "M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4",
  upload: "M12 16V4m0 0L7 9m5-5l5 5M4 20h16",
  shield: "M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z",
  scale: "M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z",
};

export function NavIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.list} />
    </svg>
  );
}

export function Sidebar({ isClient, unread, demo = false }: { isClient: boolean; unread: number; demo?: boolean }) {
  const path = usePathname() ?? "";
  const groups = (isClient ? CLIENT_NAV : PRIMUS_NAV).map((g) => ({ ...g, hubs: g.hubs.filter((h) => demo || !h.demoOnly) }));
  const here = locate(groups, path);
  return (
    <nav aria-label="Main" className="w-full shrink-0 md:w-60">
      <div className="side-panel flex gap-4 overflow-x-auto rounded-2xl p-3 md:sticky md:top-24 md:flex-col md:gap-4 md:overflow-visible">
        {groups.map((g, i) => (
          <div key={i} className="min-w-max md:min-w-0">
            {g.title ? <p className="mb-1 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[#e9bd8c]">{g.title}</p> : null}
            <ul className="flex gap-1 md:flex-col md:gap-0.5">
              {g.hubs.map((h) => {
                const on = here?.hub.key === h.key;
                const badge = h.badge === "unread" ? unread : 0;
                return (
                  <li key={h.key}>
                    <Link
                      href={h.href}
                      aria-current={on ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${on ? "bg-gradient-to-r from-[#c88a4a] to-[#8f5424] text-white shadow-[0_10px_22px_-10px_rgba(200,138,74,.95)]" : "text-[#f3dcd6]/90 hover:bg-white/10 hover:text-white"}`}
                    >
                      <NavIcon name={h.icon} className={`h-4 w-4 shrink-0 ${on ? "text-white" : "text-[#e9bd8c]/80"}`} />
                      <span className="flex-1">{h.label}</span>
                      {badge ? <span className="rounded-full bg-[#f0c9a0] px-2 py-0.5 text-xs font-semibold text-[#3a0f0c]" aria-label={`${badge} unread`}>{badge}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/** The pages inside the hub you are in, shown once above the page. Keeps the chosen engagement (?e=) when you move between them. */
export function HubTabs({ isClient, demo = false }: { isClient: boolean; demo?: boolean }) {
  const path = usePathname() ?? "";
  const search = useSearchParams();
  const groups = (isClient ? CLIENT_NAV : PRIMUS_NAV).map((g) => ({ ...g, hubs: g.hubs.filter((h) => demo || !h.demoOnly) }));
  const here = locate(groups, path);
  if (!here || here.hub.tabs.length < 2) return null;
  const e = search?.get("e");
  return (
    <nav aria-label={here.hub.label} className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
      {here.hub.tabs.map((t) => {
        const on = t.href === here.tab.href;
        return (
          <Link
            key={t.href}
            href={e ? `${t.href}?e=${encodeURIComponent(e)}` : t.href}
            aria-current={on ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${on ? "border-copper-deep text-copper-deep" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
