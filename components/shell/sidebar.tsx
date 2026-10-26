import Link from "next/link";

interface Item { href: string; label: string; badge?: number }
interface Group { title?: string; items: Item[] }

export function navFor(isClient: boolean, unread: number): Group[] {
  if (isClient) {
    return [
      { items: [{ href: "/portal", label: "Overview" }, { href: "/portal/tasks", label: "Tasks & milestones" }, { href: "/notifications", label: "Notifications", badge: unread }] },
      {
        title: "My programme",
        items: [
          { href: "/portal/profile", label: "Company profile" },
          { href: "/portal/business-units", label: "Business units" },
          { href: "/portal/processing", label: "Data & processing" },
          { href: "/portal/discovery", label: "Discovery" },
          { href: "/portal/assessment", label: "Assessment" },
          { href: "/portal/evidence", label: "Evidence centre" },
          { href: "/portal/clarifications", label: "Clarifications" },
        ],
      },
      {
        title: "Results",
        items: [
          { href: "/portal/findings", label: "Findings" },
          { href: "/portal/remediation", label: "Remediation" },
          { href: "/portal/risks", label: "Risks" },
          { href: "/portal/reports", label: "Reports" },
          { href: "/portal/rights", label: "Rights requests" },
        ],
      },
    ];
  }
  return [
    { items: [{ href: "/dashboard", label: "Dashboard" }, { href: "/tasks", label: "Tasks & milestones" }, { href: "/notifications", label: "Notifications", badge: unread }] },
    {
      title: "Portfolio",
      items: [
        { href: "/organisations", label: "Organisations" },
        { href: "/engagements", label: "Engagements" },
        { href: "/stakeholders", label: "Stakeholders" },
      ],
    },
    {
      title: "Delivery",
      items: [
        { href: "/discovery", label: "Discovery" },
        { href: "/assessments", label: "Assessments" },
        { href: "/evidence-review", label: "Evidence review" },
        { href: "/findings", label: "Findings" },
        { href: "/risks", label: "Risks" },
        { href: "/remediation", label: "Remediation" },
        { href: "/clarifications", label: "Clarifications" },
      ],
    },
    {
      title: "Governance",
      items: [
        { href: "/audit", label: "Audit trail" },
        { href: "/methodology", label: "Methodology" },
        { href: "/connectors", label: "Connectors" },
      ],
    },
  ];
}

export function Sidebar({ isClient, unread }: { isClient: boolean; unread: number }) {
  const groups = navFor(isClient, unread);
  return (
    <nav aria-label="Main" className="w-full shrink-0 md:w-56">
      <div className="flex gap-4 overflow-x-auto pb-2 md:flex-col md:gap-5 md:overflow-visible md:pb-0">
        {groups.map((g, i) => (
          <div key={i} className="min-w-max md:min-w-0">
            {g.title ? <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</p> : null}
            <ul className="flex gap-1 md:flex-col">
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link href={it.href} className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
                    <span>{it.label}</span>
                    {it.badge ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800" aria-label={`${it.badge} unread`}>{it.badge}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
