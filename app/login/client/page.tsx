import Link from "next/link";
import { redirect } from "next/navigation";
import { demoSignIn } from "@/lib/auth/actions";
import { isDemoAuthActive, listDemoUsers, type DemoUser } from "@/lib/auth/demo-auth";
import { LoginFrame, DemoBanner, Avatar, roleBlurb } from "@/components/login/login-frame";

// Demo door B: client organisations. Each demo organisation lists its own
// people. Only exists in local demo mode.
export const dynamic = "force-dynamic";

export default async function ClientLogin({ searchParams }: { searchParams: { returnTo?: string } }) {
  if (!isDemoAuthActive()) redirect("/login");
  const clients = (await listDemoUsers()).filter((p) => p.side === "client");
  const byOrg = new Map<string, DemoUser[]>();
  for (const c of clients) byOrg.set(c.orgName ?? "Organisation", [...(byOrg.get(c.orgName ?? "Organisation") ?? []), c]);
  const rt = searchParams.returnTo;
  return (
    <LoginFrame wide>
      <DemoBanner />
      <div className="rise mx-auto max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-copper">Account type B</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-slate-900 sm:text-4xl">Client organisation portal</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">Choose your organisation, then your name. You see only your own organisation, and only what Primus has released to you.</p>
      </div>
      {clients.length === 0 ? <p className="mt-8 text-center text-sm text-slate-700">No client users yet. Run <code>npm run local:setup</code>.</p> : (
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {[...byOrg.entries()].map(([org, people]) => (
            <section key={org} className="rise flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-lift">
              <div className="border-b border-slate-200 pb-4">
                <h2 className="font-display text-lg font-bold text-slate-900">{org}</h2>
                <p className="text-xs font-medium text-copper">{people[0]?.orgIndustry ?? "—"}</p>
              </div>
              <form action={demoSignIn} className="mt-4">
                <input type="hidden" name="userId" value={people[0]!.id} />
                {rt ? <input type="hidden" name="returnTo" value={rt} /> : null}
                <button type="submit" className="w-full rounded-xl bg-brand px-4 py-3 font-display text-sm font-semibold text-white transition hover:-translate-y-px hover:bg-brand-dark">Enter as {people[0]!.displayName} →</button>
              </form>
              <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Sign in as</p>
              <ul className="mt-2 grid gap-2">
                {people.map((p) => (
                  <li key={p.id}>
                    <form action={demoSignIn}>
                      <input type="hidden" name="userId" value={p.id} />
                      {rt ? <input type="hidden" name="returnTo" value={rt} /> : null}
                      <button type="submit" className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-copper hover:shadow-card">
                        <Avatar name={p.displayName ?? p.email} tone="copper" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">{p.displayName ?? p.email}</span>
                          <span className="block truncate text-xs text-copper-deep">{p.roles.join(" · ") || "no role yet"}</span>
                          <span className="block text-xs leading-snug text-slate-500">{roleBlurb(p.roles)}</span>
                        </span>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="mt-8 text-center text-xs text-slate-500"><Link href="/login" className="underline">← Choose a different door</Link></p>
    </LoginFrame>
  );
}
