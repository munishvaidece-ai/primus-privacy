// Loading state for the invitation route — mirrors app/(shell)/loading.tsx's
// own shape/accessibility treatment for consistency with the rest of
// this application's existing conventions.
export default function InviteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div role="status" className="flex items-center gap-2 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" aria-hidden="true" />
        Loading…
        <span className="sr-only">Loading invitation</span>
      </div>
    </div>
  );
}
