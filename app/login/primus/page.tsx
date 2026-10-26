import Link from "next/link";
import { redirect } from "next/navigation";
import { demoSignIn } from "@/lib/auth/actions";
import { isDemoAuthActive, listDemoUsers } from "@/lib/auth/demo-auth";
import { LoginFrame, DemoBanner, Avatar, roleBlurb } from "@/components/login/login-frame";

// Demo door A: the Primus team. Only exists in local demo mode; otherwise
// it sends the visitor to the normal sign-in page.
export const dynamic = "force-dynamic";

export default async function PrimusLogin({ searchParams }: { searchParams: { returnTo?: string } }) {
  if (!isDemoAuthActive()) redirect("/login");
  const team = (await listDemoUsers()).filter((p) => p.side === "primus");
  const rt = searchParams.returnTo;
  return (
    <LoginFrame>
      <DemoBanner />
      <div className="rise rounded-2xl border border-slate-200 bg-white p-8 shadow-lift">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-copper">Account type A</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-slate-900">Primus team workspace</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">Pick a team member. The administrator can do everything; the others show what each role can and cannot do.</p>
        {team.length === 0 ? <p className="mt-6 text-sm text-slate-700">No team members yet. Run <code>npm run local:setup</code>.</p> : (
          <>
            <form action={demoSignIn} className="mt-6">
              <input type="hidden" name="userId" value={team[0]!.id} />
              {rt ? <input type="hidden" name="returnTo" value={rt} /> : null}
              <button type="submit" className="w-full rounded-xl bg-brand px-5 py-3.5 font-display text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px hover:bg-brand-dark">Sign in as {team[0]!.displayName ?? team[0]!.email} →</button>
            </form>
            <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Or choose another role</p>
            <ul className="mt-2 grid gap-2">
              {team.map((p) => (
                <li key={p.id}>
                  <form action={demoSignIn}>
                    <input type="hidden" name="userId" value={p.id} />
                    {rt ? <input type="hidden" name="returnTo" value={rt} /> : null}
                    <button type="submit" className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left transition hover:-translate-y-px hover:border-copper hover:shadow-card">
                      <Avatar name={p.displayName ?? p.email} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{p.displayName ?? p.email}</span>
                        <span className="block text-xs text-copper-deep">{p.roles.join(" · ") || "no role yet"}</span>
                        <span className="block text-xs text-slate-500">{roleBlurb(p.roles)}</span>
                      </span>
                      <span className="text-slate-400" aria-hidden="true">→</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-6 text-center text-xs text-slate-500"><Link href="/login" className="underline">← Choose a different door</Link></p>
      </div>
    </LoginFrame>
  );
}
