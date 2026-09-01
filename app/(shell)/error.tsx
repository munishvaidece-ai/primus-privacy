"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Error boundary for the authenticated shell (PHASE A instructions §17):
// generic, user-visible message only — no stack trace, no raw database
// error text, no internal identifiers (SECURITY.md §13). Full detail
// goes to the server/browser console only, via the framework's own
// error reporting, never rendered to the user.
export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- server-side detail only, per SECURITY.md §13; nothing beyond this is shown to the user.
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
      <p className="max-w-sm text-sm text-slate-600">
        An unexpected error occurred. Please try again — if this keeps happening, contact your PRIMUS PRIVACY
        administrator.
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
