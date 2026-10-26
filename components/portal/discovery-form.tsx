"use client";

import { useRef, useState, type ReactNode } from "react";
import { autosaveDiscoveryAction } from "@/app/(shell)/workspace-actions";

/**
 * Wraps one questionnaire step. While the person types, the draft is saved in
 * the background a couple of seconds after they pause, and the status is
 * announced politely for screen readers. Nothing is marked complete until they
 * press "Save and mark complete".
 */
export function AutosaveForm({ action, children }: { action: (fd: FormData) => Promise<void>; children: ReactNode }) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    setStatus({ ok: true, text: "Unsaved changes…" });
    timer.current = setTimeout(async () => {
      if (!ref.current) return;
      const fd = new FormData(ref.current);
      const res = await autosaveDiscoveryAction(fd);
      setStatus({ ok: res.ok, text: res.message });
    }, 2000);
  }

  return (
    <form ref={ref} action={action} onChange={schedule} onInput={schedule}>
      {children}
      <p role="status" aria-live="polite" className={`mt-3 text-xs ${status && !status.ok ? "text-red-700" : "text-slate-500"}`}>{status?.text ?? ""}</p>
    </form>
  );
}
