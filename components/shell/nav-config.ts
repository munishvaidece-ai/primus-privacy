// One definition of the navigation for both portals. The sidebar shows one entry per hub; the strip above the page
// shows the pages inside the hub you are in. Nothing is hidden: every page that existed is still one click away.
export interface NavTab { href: string; label: string; match?: string[] }
export interface NavHub { key: string; label: string; icon: string; href: string; tabs: NavTab[]; /** extra path prefixes that belong to this hub */ also?: RegExp[]; badge?: "unread"; demoOnly?: boolean }
export interface NavGroup { title?: string; hubs: NavHub[] }

const hub = (key: string, label: string, icon: string, tabs: NavTab[], extra: Partial<NavHub> = {}): NavHub => ({ key, label, icon, href: tabs[0]!.href, tabs, ...extra });

export const CLIENT_NAV: NavGroup[] = [
  { hubs: [
    hub("home", "Home", "home", [{ href: "/portal", label: "Home" }]),
    hub("todo", "To-do", "check", [{ href: "/portal/tasks", label: "To-do" }]),
    hub("notes", "Notifications", "bell", [{ href: "/notifications", label: "Notifications" }], { badge: "unread" }),
  ] },
  { title: "Your engagement", hubs: [
    hub("org", "Your organisation", "building", [
      { href: "/portal/profile", label: "Company profile" },
      { href: "/portal/business-units", label: "Business units" },
      { href: "/portal/processing", label: "Data & processing" },
      { href: "/portal/rights", label: "Rights requests" },
    ]),
    hub("questions", "Questionnaire", "list", [
      { href: "/portal/discovery", label: "Discovery steps" },
      { href: "/portal/questions", label: "Question sets" },
    ]),
    hub("docs", "Documents & connections", "upload", [
      { href: "/portal/data-connections", label: "Guide" },
      { href: "/portal/journey", label: "Steps and uploads" },
      { href: "/portal/evidence", label: "Evidence" },
    ]),
    hub("assessment", "Assessment", "scale", [
      { href: "/portal/assessment", label: "Your answers" },
      { href: "/portal/regulations", label: "What applies to you" },
    ]),
    hub("ask", "Clarifications", "chat", [{ href: "/portal/clarifications", label: "Clarifications" }]),
  ] },
  { title: "Results", hubs: [
    hub("findings", "Findings & risks", "alert", [
      { href: "/portal/findings", label: "Findings" },
      { href: "/portal/risks", label: "Risks" },
    ]),
    hub("fix", "Remediation", "wrench", [{ href: "/portal/remediation", label: "Remediation" }]),
    hub("reports", "Reports", "file", [{ href: "/portal/reports", label: "Reports" }]),
  ] },
  { title: "Help", hubs: [
    hub("resources", "Resources", "book", [{ href: "/portal/resources", label: "Resources" }]),
    hub("dpo", "DPO Mate", "chat", [{ href: "/portal/dpo-mate", label: "DPO Mate" }]),
  ] },
];

export const PRIMUS_NAV: NavGroup[] = [
  { hubs: [
    hub("home", "Dashboard", "home", [{ href: "/dashboard", label: "Dashboard" }]),
    hub("todo", "To-do", "check", [{ href: "/tasks", label: "To-do" }]),
    hub("notes", "Notifications", "bell", [{ href: "/notifications", label: "Notifications" }], { badge: "unread" }),
  ] },
  { title: "Run the engagement", hubs: [
    hub("clients", "Clients", "building", [
      { href: "/organisations", label: "Organisations" },
      { href: "/engagements", label: "Engagements" },
      { href: "/stakeholders", label: "Stakeholders" },
    ], { also: [/^\/organisations\/[^/]+\/engagements\/[^/]+/] }),
    hub("discovery", "Discovery & questions", "search", [
      { href: "/discovery", label: "Discovery" },
      { href: "/question-bank", label: "Question bank" },
    ]),
    hub("docs", "Documents & connections", "plug", [
      { href: "/data-connections", label: "Guide and requests" },
      { href: "/evidence-review", label: "Evidence review" },
      { href: "/connectors", label: "Connector catalogue" },
    ]),
    hub("assessments", "Assessments", "scale", [{ href: "/assessments", label: "Assessments" }]),
    hub("findings", "Findings & risks", "alert", [
      { href: "/findings", label: "Findings" },
      { href: "/risks", label: "Risks" },
    ]),
    hub("fix", "Remediation", "wrench", [{ href: "/remediation", label: "Remediation" }]),
    hub("inbox", "Inbox", "chat", [
      { href: "/clarifications", label: "Clarifications" },
      { href: "/consultations", label: "Consultation requests" },
    ]),
  ] },
  { title: "Reference", hubs: [
    hub("ref", "Reference", "book", [
      { href: "/resources", label: "Resources" },
      { href: "/regulations", label: "Regulations" },
      { href: "/methodology", label: "Methodology" },
    ]),
    hub("audit", "Audit trail", "audit", [{ href: "/audit", label: "Audit trail" }]),
    hub("demo", "Demo environment", "wrench", [{ href: "/demo", label: "Demo environment" }], { demoOnly: true }),
  ] },
];

const under = (path: string, href: string) => path === href || path.startsWith(href + "/");

/** The hub and tab the current path belongs to (longest matching link wins, so "/portal" is not lit on "/portal/tasks"). */
export function locate(groups: NavGroup[], path: string): { hub: NavHub; tab: NavTab } | null {
  // engagement pages sit under /organisations/... but belong with Engagements, so they are checked first
  for (const g of groups) for (const h of g.hubs) if (h.also?.some((r) => r.test(path))) return { hub: h, tab: h.tabs.find((t) => t.href === "/engagements") ?? h.tabs[0]! };
  let best: { hub: NavHub; tab: NavTab; len: number } | null = null;
  for (const g of groups) for (const h of g.hubs) {
    for (const t of h.tabs) if (under(path, t.href) && (!best || t.href.length > best.len)) best = { hub: h, tab: t, len: t.href.length };
  }
  return best ? { hub: best.hub, tab: best.tab } : null;
}
