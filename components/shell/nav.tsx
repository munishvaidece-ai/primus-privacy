import Link from "next/link";

// Global navigation — PHASE A instructions §8: "Only show items that are
// actually supported. Do not build all pages yet." Dashboard/Engagements
// (as a standalone item)/Administration are all real, planned nav
// destinations (PRODUCT_UX_BLUEPRINT.md §6) but have no page behind them
// yet — rendering a link to a page that doesn't exist would be worse
// than omitting it.
//
// Slice D1 adds "Methodology": shown to every signed-in PRACTICE-side
// user — the `/methodology` pages themselves perform the real,
// server-side authorization check (a tenant member with no
// `methodology.manage` grant sees the same read-only content everyone
// else with tenant access sees; a non-tenant-member sees a clean
// not-found), matching instructions §7's own "UI hiding is not
// authorization" rule: this link is a navigation convenience, never the
// access boundary. `/methodology` is in fact already unreachable for a
// client user regardless of this component (its own page gates on
// `requireTenantAccess`, which a client's OrganisationMembership/
// EngagementMembership alone never satisfies — no TenantMembership-
// granting mechanism exists for client users anywhere in this codebase)
// — `isClient` below hides it anyway, per P2B.5's own explicit brief
// ("Client users must not see... methodology authoring... leave it out
// of client navigation"), purely so a client user is never offered a
// link that can only ever 404 for them, not because hiding it is what
// makes it safe.
export function GlobalNav({ isClient }: { isClient: boolean }) {
  return (
    <nav aria-label="Global" className="flex items-center gap-1">
      <Link
        href="/organisations"
        className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        {isClient ? "Home" : "Organisations"}
      </Link>
      {isClient ? null : (
        <Link
          href="/methodology"
          className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Methodology
        </Link>
      )}
    </nav>
  );
}
