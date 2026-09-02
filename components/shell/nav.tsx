import Link from "next/link";

// Global navigation — PHASE A instructions §8: "Only show items that are
// actually supported. Do not build all pages yet." Dashboard/Engagements
// (as a standalone item)/Administration are all real, planned nav
// destinations (PRODUCT_UX_BLUEPRINT.md §6) but have no page behind them
// yet — rendering a link to a page that doesn't exist would be worse
// than omitting it.
//
// Slice D1 adds "Methodology": shown to every signed-in user, the same
// way "Organisations" is — the `/methodology` pages themselves perform
// the real, server-side authorization check (a tenant member with no
// `methodology.manage` grant sees the same read-only content everyone
// else with tenant access sees; a non-tenant-member sees a clean
// not-found), matching instructions §7's own "UI hiding is not
// authorization" rule: this link is a navigation convenience, never the
// access boundary.
export function GlobalNav() {
  return (
    <nav aria-label="Global" className="flex items-center gap-1">
      <Link
        href="/organisations"
        className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        Organisations
      </Link>
      <Link
        href="/methodology"
        className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        Methodology
      </Link>
    </nav>
  );
}
