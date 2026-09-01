// Loading state for every route under the authenticated shell (PHASE A
// instructions §8/§17). `role="status"` + visually-hidden text keeps
// this accessible to screen readers, not just a visual spinner.
export default function ShellLoading() {
  return (
    <div role="status" className="flex items-center gap-2 py-12 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" aria-hidden="true" />
      Loading…
      <span className="sr-only">Loading page content</span>
    </div>
  );
}
