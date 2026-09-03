"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Error boundary for the whole /invite subtree — mirrors
// app/(shell)/error.tsx exactly: a generic, user-visible message only,
// no stack trace, no raw database/error text, no internal identifiers
// (SECURITY.md §13, this slice's own brief §17/§18). Full detail goes
// to the server/browser console only, never rendered — and never
// includes the raw invitation token: `error.message`/`error.digest` are
// whatever Next.js's own framework produced from an UNCAUGHT exception
// (every expected invitation-acceptance failure is already handled as
// an ordinary rendered state or a safe redirect in page.tsx/actions.ts,
// never thrown this far), so this boundary has no route parameter of
// its own to accidentally include either.
export default function InviteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- server-side detail only, per SECURITY.md §13; nothing beyond this is shown to the user.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
      <p className="max-w-sm text-sm text-slate-600">
        An unexpected error occurred. Please try again — if this keeps happening, contact your PRIMUS PRIVACY
        administrator.
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
