import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { hasEngagementPermission } from "@/lib/authorization/service";
import { isDemoAuthActive } from "@/lib/auth/demo-auth";
import { getViewer } from "@/lib/workspace/common";
import { FIRM } from "@/lib/demo/orchid/content";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/kit";
import { resetDemoAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DemoEnvironmentPage({ searchParams }: { searchParams: { ok?: string; problem?: string } }) {
  if (!isDemoAuthActive()) notFound();
  const user = await requireAuthenticatedUser();
  const d = await withRequestDb(user.id, async (db) => {
    const viewer = await getViewer(db, user.id);
    if (viewer.isClient) return null;
    const r = (await db.execute<{ org: string; eng: string }>(sql`SELECT o.id AS org, e.id AS eng FROM organisations o JOIN engagements e ON e.organisation_id = o.id WHERE o.name = ${FIRM.name} ORDER BY e.created_at LIMIT 1`)).rows[0];
    if (!r) return { firm: null as null };
    const one = async (q: ReturnType<typeof sql>) => Number(((await db.execute<{ n: number }>(q)).rows[0]?.n) ?? 0);
    const counts = {
      units: await one(sql`SELECT count(*)::int AS n FROM business_units WHERE organisation_id = ${r.org}`),
      activities: await one(sql`SELECT count(*)::int AS n FROM processing_activities WHERE engagement_id = ${r.eng}`),
      files: await one(sql`SELECT count(*)::int AS n FROM intake_files WHERE engagement_id = ${r.eng}`),
      tests: await one(sql`SELECT count(*)::int AS n FROM control_tests WHERE engagement_id = ${r.eng}`),
      evidence: await one(sql`SELECT count(*)::int AS n FROM evidence WHERE engagement_id = ${r.eng}`),
      findings: await one(sql`SELECT count(*)::int AS n FROM findings WHERE engagement_id = ${r.eng}`),
      actions: await one(sql`SELECT count(*)::int AS n FROM remediation_actions WHERE engagement_id = ${r.eng}`),
    };
    return { firm: { org: r.org, eng: r.eng, counts, canReset: await hasEngagementPermission(db, user.id, r.eng, "ai.configure") } };
  });
  if (!d) notFound();
  const firm = d.firm;
  const total = firm ? Object.values(firm.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <PageHeader title="Demo environment" subtitle="Run the live demo for one audience, then clear it and run it again for the next. Only visible on this demo install." />
      {searchParams.ok ? <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.ok}</p> : null}
      {searchParams.problem ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{searchParams.problem}</p> : null}
      {!firm ? <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">The live-demo firm is not on this install. Run <code>npm run local:setup</code> to add it.</p> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card" aria-labelledby="firm">
            <p className="text-xs font-semibold uppercase tracking-wide text-copper">Live-demo firm</p>
            <h2 id="firm" className="mt-1 font-display text-xl font-semibold text-slate-900">{FIRM.name}</h2>
            <p className="text-sm text-slate-600">An invented stock broker and depository participant. Every name and number is fictional.</p>
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["Business units", firm.counts.units], ["Processing activities", firm.counts.activities], ["Files received", firm.counts.files], ["Control tests", firm.counts.tests], ["Evidence items", firm.counts.evidence], ["Findings", firm.counts.findings], ["Remediation actions", firm.counts.actions]] as const).map(([l, v]) => (
                <div key={l} className="rounded-lg border border-slate-200 p-3"><dt className="text-xs text-slate-500">{l}</dt><dd className="mt-0.5 font-display text-xl font-semibold text-slate-900">{v}</dd></div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-slate-700">{total === 0 ? "The firm is empty. You can start the demo from the first upload." : "The firm holds demo data from an earlier run."}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/organisations/${firm.org}/engagements/${firm.eng}/live`} className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">Open the Live Run</Link>
              <a href="/demo/Orchid_Hill_Demo_Pack.zip" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:border-copper hover:text-copper">Download the demo pack</a>
            </div>
          </section>

          <section className="rounded-2xl border border-red-200 bg-red-50/40 p-6" aria-labelledby="reset">
            <h2 id="reset" className="font-display text-lg font-semibold text-slate-900">Clear it for the next demo</h2>
            <p className="mt-2 text-sm text-slate-700">Removes everything the demo put in: sectors, data map, scope, tests, evidence, findings, actions, reports, AI work and every uploaded file. Keeps the firm, the people, the AI settings and the database connector.</p>
            <p className="mt-2 text-sm text-slate-700">It cannot be undone, and it touches no other organisation.</p>
            <form action={resetDemoAction} className="mt-4 space-y-3">
              <input type="hidden" name="organisationId" value={firm.org} />
              <input type="hidden" name="engagementId" value={firm.eng} />
              <label className="flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" name="sure" value="yes" className="mt-0.5" /> Yes, clear the demo data for {FIRM.name}.</label>
              <Button type="submit" disabled={!firm.canReset}>Clear the demo data</Button>
              {!firm.canReset ? <p className="text-xs text-amber-900">Only an Engagement Manager (for example Demo Administrator) can do this.</p> : null}
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
