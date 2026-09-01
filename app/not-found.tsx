import Link from "next/link";

// Global not-found boundary. Deliberately generic — per SECURITY.md §13,
// an authorization failure and a genuinely nonexistent record must
// render identically, so this page is the single rendering for both
// (see NotFoundOrForbiddenError usages throughout app/(shell)/**).
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-semibold text-slate-900">Not found</h1>
      <p className="max-w-sm text-sm text-slate-600">
        This page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/organisations" className="text-sm font-medium text-blue-700 hover:underline">
        Back to Organisations
      </Link>
    </div>
  );
}
