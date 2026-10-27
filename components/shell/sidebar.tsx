"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item { href: string; label: string; badge?: number; icon: string }
interface Group { title?: string; items: Item[] }

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

function groupsFor(isClient: boolean, unread: number, demo: boolean): Group[] {
  if (isClient) {
    return [
      { items: [{ href: "/portal", label: "Overview", icon: "home" }, { href: "/portal/tasks", label: "Tasks & milestones", icon: "check" }, { href: "/notifications", label: "Notifications", badge: unread, icon: "bell" }] },
      {
        title: "My programme",
        items: [
          { href: "/portal/profile", label: "Company profile", icon: "building" },
          { href: "/portal/business-units", label: "Business units", icon: "layers" },
          { href: "/portal/processing", label: "Data & processing", icon: "layers" },
          { href: "/portal/journey", label: "Live journey", icon: "chart" },
          { href: "/portal/discovery", label: "Discovery", icon: "search" },
          { href: "/portal/regulations", label: "What applies to you", icon: "scale" },
          { href: "/portal/assessment", label: "Assessment", icon: "list" },
          { href: "/portal/evidence", label: "Evidence centre", icon: "upload" },
          { href: "/portal/clarifications", label: "Clarifications", icon: "chat" },
        ],
      },
      {
        title: "Results",
        items: [
          { href: "/portal/findings", label: "Findings", icon: "alert" },
          { href: "/portal/remediation", label: "Remediation", icon: "wrench" },
          { href: "/portal/risks", label: "Risks", icon: "chart" },
          { href: "/portal/reports", label: "Reports", icon: "file" },
          { href: "/portal/rights", label: "Rights requests", icon: "scale" },
        ],
      },
    ];
  }
  return [
    { items: [{ href: "/dashboard", label: "Dashboard", icon: "home" }, { href: "/tasks", label: "Tasks & milestones", icon: "check" }, { href: "/notifications", label: "Notifications", badge: unread, icon: "bell" }] },
    {
      title: "Portfolio",
      items: [
        { href: "/organisations", label: "Organisations", icon: "building" },
        { href: "/engagements", label: "Engagements", icon: "layers" },
        { href: "/stakeholders", label: "Stakeholders", icon: "users" },
      ],
    },
    {
      title: "Delivery",
      items: [
        { href: "/discovery", label: "Discovery", icon: "search" },
        { href: "/assessments", label: "Assessments", icon: "list" },
        { href: "/evidence-review", label: "Evidence review", icon: "upload" },
        { href: "/findings", label: "Findings", icon: "alert" },
        { href: "/risks", label: "Risks", icon: "chart" },
        { href: "/remediation", label: "Remediation", icon: "wrench" },
        { href: "/clarifications", label: "Clarifications", icon: "chat" },
      ],
    },
    {
      title: "Governance",
      items: [
        { href: "/audit", label: "Audit trail", icon: "audit" },
        { href: "/regulations", label: "Regulations", icon: "scale" },
        { href: "/methodology", label: "Methodology", icon: "book" },
        { href: "/connectors", label: "Connectors", icon: "plug" },
        ...(demo ? [{ href: "/demo", label: "Demo environment", icon: "wrench" }] : []),
      ],
    },
  ];
}

export function Sidebar({ isClient, unread, demo = false }: { isClient: boolean; unread: number; demo?: boolean }) {
  const path = usePathname() ?? "";
  const groups = groupsFor(isClient, unread, demo);
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  // the longest matching link wins, so "/portal" is not lit up on "/portal/tasks"
  const active = allHrefs.filter((h) => path === h || path.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
  return (
    <nav aria-label="Main" className="w-full shrink-0 md:w-60">
      <div className="flex gap-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-card md:sticky md:top-24 md:flex-col md:gap-4 md:overflow-visible">
        {groups.map((g, i) => (
          <div key={i} className="min-w-max md:min-w-0">
            {g.title ? <p className="mb-1 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-copper">{g.title}</p> : null}
            <ul className="flex gap-1 md:flex-col md:gap-0.5">
              {g.items.map((it) => {
                const on = it.href === active;
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      aria-current={on ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${on ? "bg-brand text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"}`}
                    >
                      <NavIcon name={it.icon} className={`h-4 w-4 shrink-0 ${on ? "text-[#f0c9a0]" : "text-slate-400"}`} />
                      <span className="flex-1">{it.label}</span>
                      {it.badge ? <span className="rounded-full bg-copper px-2 py-0.5 text-xs font-semibold text-white" aria-label={`${it.badge} unread`}>{it.badge}</span> : null}
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
