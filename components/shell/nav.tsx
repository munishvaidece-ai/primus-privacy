import Link from "next/link";

// Global navigation — PHASE A instructions §8: "Only show items that are
// actually supported. Do not build all pages yet." Dashboard/Engagements
// (as a standalone item)/Methodology/Administration are all real,
// planned nav destinations (PRODUCT_UX_BLUEPRINT.md §6) but have no page
// behind them yet in this slice — rendering a link to a page that
// doesn't exist would be worse than omitting it, so only "Organisations"
// appears until the screens behind the others are actually built.
export function GlobalNav() {
  return (
    <nav aria-label="Global" className="flex items-center gap-1">
      <Link
        href="/organisations"
        className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        Organisations
      </Link>
    </nav>
  );
}
