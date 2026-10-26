import { signOut } from "@/lib/auth/actions";

function initials(s: string): string {
  const base = s.split("@")[0] ?? s;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// The session indicator + logout control. A plain Server Action form — no
// client-side JavaScript is required for logout to work.
export function UserMenu({ email, name, side }: { email: string | null; name?: string | null; side?: "primus" | "client" }) {
  const label = name || email || "Signed in";
  return (
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-2.5 sm:flex">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-copper-light to-copper-deep font-display text-xs font-semibold text-white" aria-hidden="true">{initials(label)}</span>
        <span className="leading-tight" aria-label="Signed in as">
          <span className="block text-sm font-semibold text-slate-900">{label}</span>
          {side ? <span className="block text-[11px] font-medium uppercase tracking-wider text-copper">{side === "client" ? "Client portal" : "Primus workspace"}</span> : null}
        </span>
      </div>
      <form action={signOut}>
        <button type="submit" className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-display text-xs font-semibold text-slate-900 transition hover:border-copper hover:text-copper">
          Log out
        </button>
      </form>
    </div>
  );
}
