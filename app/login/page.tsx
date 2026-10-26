import { demoSignIn, signIn } from "@/lib/auth/actions";
import { isDemoAuthActive, listDemoUsers } from "@/lib/auth/demo-auth";
import { Button } from "@/components/ui/button";

// PHASE A instructions §3: login only (no social login, SSO, MFA,
// password reset, invitations, account management). A plain server-
// rendered form posting to a Server Action — works without client-side
// JavaScript, and every label/input/error message is a real,
// accessible HTML element (instructions §24).
//
// P2B.5 (Client Onboarding & Acceptance UX, brief §15): `returnTo`, when
// present, is threaded through unvalidated as a plain hidden field —
// `signIn` (lib/auth/actions.ts) itself is what validates it via
// `safeReturnTo` before ever calling `redirect()`, so this page does not
// need its own copy of that logic; a forged/unsafe value merely falls
// back to the same default `/organisations` destination this page
// already had before this slice.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; returnTo?: string };
}) {
  const error = searchParams.error;

  // Local demo sign-in: one click, no password, on this computer only
  // (see lib/auth/demo-auth.ts — it refuses to run in production).
  if (isDemoAuthActive()) {
    const people = await listDemoUsers();
    const team = people.filter((p) => p.side === "primus");
    const clients = people.filter((p) => p.side === "client");
    const Person = ({ p }: { p: (typeof people)[number] }) => (
      <li>
        <form action={demoSignIn}>
          <input type="hidden" name="userId" value={p.id} />
          {searchParams.returnTo ? <input type="hidden" name="returnTo" value={searchParams.returnTo} /> : null}
          <button type="submit" className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
            <span className="min-w-0"><span className="block truncate font-medium text-slate-900">{p.displayName ?? p.email}</span><span className="block truncate text-xs text-slate-500">{p.email}</span></span>
            <span className="shrink-0 text-xs text-slate-600">{p.roles.join(", ") || "no role yet"}</span>
          </button>
        </form>
      </li>
    );
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
          <p role="note" className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Local demo mode: no password is asked. This works only on this computer and is switched off in any real deployment.</p>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Sign in to PRIMUS PRIVACY</h1>
          {error ? <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          {people.length === 0 ? (
            <p className="mt-4 text-sm text-slate-700">No people exist yet. Run <code>npm run local:setup</code> to create the demo data, then reload this page.</p>
          ) : (
            <>
              {team[0] ? (
                <form action={demoSignIn} className="mt-4">
                  <input type="hidden" name="userId" value={team[0].id} />
                  {searchParams.returnTo ? <input type="hidden" name="returnTo" value={searchParams.returnTo} /> : null}
                  <Button type="submit" className="w-full">Sign in as {team[0].displayName ?? team[0].email}</Button>
                </form>
              ) : null}
              <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Primus team</h2>
              <ul className="mt-2 space-y-2">{team.map((p) => <Person key={p.id} p={p} />)}</ul>
              {clients.length > 0 ? (
                <>
                  <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Client users</h2>
                  <ul className="mt-2 space-y-2">{clients.map((p) => <Person key={p.id} p={p} />)}</ul>
                </>
              ) : null}
            </>
          )}
          <p className="mt-6 text-center text-xs text-slate-500"><a href="/site/index.html" className="underline">Back to the Primus Privacy site</a></p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Sign in to PRIMUS PRIVACY</h1>
        <p className="mt-1 text-sm text-slate-600">Use your PRIMUS or client account.</p>

        {error ? (
          <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <form action={signIn} className="mt-6 space-y-4">
          {searchParams.returnTo ? <input type="hidden" name="returnTo" value={searchParams.returnTo} /> : null}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            />
          </div>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-500">
          {/* Plain anchors, not next/link: the site is static HTML served from /public/site. */}
          <a href="/site/index.html" className="underline">
            &larr; Back to the Primus Privacy site
          </a>
          {" · "}
          <a href="/site/portal.html" className="underline">
            Demo portal
          </a>
        </p>
      </div>
    </div>
  );
}
