import Link from "next/link";
import { signIn } from "@/lib/auth/actions";
import { isDemoAuthActive, listDemoUsers } from "@/lib/auth/demo-auth";
import { Button } from "@/components/ui/button";
import { LoginFrame, DemoBanner } from "@/components/login/login-frame";
import { NavIcon } from "@/components/shell/sidebar";

// Sign-in. In the local demo there are TWO doors: the Primus team workspace
// and the client organisation portal (each lists its own demo people). In a
// real deployment this is the normal email-and-password form.
// `returnTo` is passed through; `signIn` validates it with `safeReturnTo`.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: { error?: string; returnTo?: string } }) {
  const error = searchParams.error;
  const rt = searchParams.returnTo ? `?returnTo=${encodeURIComponent(searchParams.returnTo)}` : "";

  if (isDemoAuthActive()) {
    const people = await listDemoUsers();
    const team = people.filter((p) => p.side === "primus");
    const clients = people.filter((p) => p.side === "client");
    const orgs = new Set(clients.map((c) => c.orgId));
    return (
      <LoginFrame wide>
        <DemoBanner />
        <div className="rise mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-copper">Choose how you want to enter</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">One platform, <em className="not-italic text-copper">two views</em></h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">See the product the way the consulting team sees it, then the way a client organisation sees it. The two sides are fully separate: clients never see Primus working notes or unreleased findings.</p>
        </div>
        {error ? <p role="alert" className="mx-auto mt-6 max-w-xl rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{error}</p> : null}
        {people.length === 0 ? (
          <p className="mx-auto mt-8 max-w-xl text-center text-sm text-slate-700">No people exist yet. Run <code>npm run local:setup</code> to create the demo data, then reload this page.</p>
        ) : (
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Link href={`/login/primus${rt}`} className="rise group relative flex flex-col overflow-hidden rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-8 text-white shadow-lift transition hover:-translate-y-1">
              <div className="hero-grid-bg pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden="true" />
              <span className="relative grid h-12 w-12 place-items-center rounded-xl bg-white/10 text-[#f0c9a0]"><NavIcon name="shield" className="h-6 w-6" /></span>
              <p className="relative mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-[#f0c9a0]">Account type A</p>
              <h2 className="relative mt-1 font-display text-2xl font-bold">Primus team workspace</h2>
              <p className="relative mt-3 text-sm leading-relaxed text-white/80">Manage every client engagement: discovery, assessments, evidence review, findings, risks, remediation and report release, from one command centre.</p>
              <ul className="relative mt-5 grid gap-1.5 text-sm text-white/90">
                {["Portfolio dashboard across all clients", "Validate answers and release findings", "Publish versioned reports to clients", "Full audit trail"].map((t) => <li key={t} className="flex gap-2"><span className="text-[#f0c9a0]">✓</span>{t}</li>)}
              </ul>
              <span className="relative mt-7 inline-flex items-center gap-2 font-display text-sm font-semibold text-[#f0c9a0]">Enter the workspace <span className="transition group-hover:translate-x-1">→</span></span>
              <span className="relative mt-3 text-xs text-white/60">{team.length} demo team members</span>
            </Link>
            <Link href={`/login/client${rt}`} className="rise group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-8 shadow-lift transition hover:-translate-y-1 hover:border-copper">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-copper-soft text-copper-deep"><NavIcon name="building" className="h-6 w-6" /></span>
              <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-copper">Account type B</p>
              <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">Client organisation portal</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">What a client sees: a guided path to answer the assessment, upload evidence once, follow clarifications, and read only the findings and reports that have been released to them.</p>
              <ul className="mt-5 grid gap-1.5 text-sm text-slate-700">
                {["Guided discovery questionnaire", "Answer assigned questions, upload evidence", "Released findings and remediation tracker", "Data Principal rights request log"].map((t) => <li key={t} className="flex gap-2"><span className="text-copper">✓</span>{t}</li>)}
              </ul>
              <span className="mt-7 inline-flex items-center gap-2 font-display text-sm font-semibold text-copper">Enter the client portal <span className="transition group-hover:translate-x-1">→</span></span>
              <span className="mt-3 text-xs text-slate-500">{orgs.size} demo organisations · {clients.length} client users</span>
            </Link>
          </div>
        )}
      </LoginFrame>
    );
  }

  return (
    <LoginFrame>
      <div className="rise rounded-2xl border border-slate-200 bg-white p-8 shadow-lift">
        <h1 className="font-display text-2xl font-bold text-slate-900">Sign in to Primus Privacy</h1>
        <p className="mt-1 text-sm text-slate-600">Use your Primus or client account.</p>
        {error ? <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{error}</p> : null}
        <form action={signIn} className="mt-6 space-y-4">
          {searchParams.returnTo ? <input type="hidden" name="returnTo" value={searchParams.returnTo} /> : null}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" />
          </div>
          <Button type="submit" className="w-full">Sign in</Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-500">
          <a href="/site/index.html" className="underline">&larr; Back to the Primus Privacy site</a>
        </p>
      </div>
    </LoginFrame>
  );
}
