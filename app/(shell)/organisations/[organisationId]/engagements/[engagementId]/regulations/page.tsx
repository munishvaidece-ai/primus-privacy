import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { getEngagementSectors } from "@/lib/domain/sectors";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclaimer, SectorPart } from "@/components/regulation/parts";
import { ApplicabilityHero, ApplicabilityPartA, ApplicabilityPartB, RulesTimeline } from "@/components/regulation/applicability";
import { loadEngagementApplicability } from "@/lib/workspace/applicability";
import { SECTORS, SELECTABLE_SECTORS, sectorByKey } from "@/lib/regulation";
import { saveSectorsAction } from "./actions";

/**
 * Regulations for one engagement. Part A is the DPDP Act and Rules, the same
 * for everyone. Part B is the sector rules for the sectors chosen here; the
 * AI uses the choice to decide which sector controls apply.
 */
export default async function EngagementRegulationsPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { error?: string; saved?: string };
}) {
  const user = await requireAuthenticatedUser();
  const data = await withRequestDb(user.id, async (db) => {
    try {
      const engagement = await getEngagementDetail(db, user.id, params.engagementId);
      if (engagement.organisationId !== params.organisationId) return null;
      const sectors = await getEngagementSectors(db, user.id, { engagementId: params.engagementId, organisationId: params.organisationId });
      const applicability = await loadEngagementApplicability(db, user.id, { engagementId: params.engagementId, organisationId: params.organisationId });
      return { engagement, sectors, applicability };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });
  if (!data) notFound();
  const { engagement, sectors, applicability } = data;
  const all = sectorByKey("all")!;

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}`} className="hover:underline">{engagement.name}</Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Regulations</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Which provisions of the DPDP Act and Rules bind this organisation, and which sector rules sit beside them. It updates as the questionnaire, the data map and the sectors change, and the AI uses the same answer when it decides which controls apply.
      </p>
      <div className="mt-5"><ApplicabilityHero a={applicability} orgName={engagement.organisationName} /></div>
      <div className="mt-3"><Disclaimer /></div>

      {searchParams.error ? <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{searchParams.error}</p> : null}
      {searchParams.saved ? <p role="status" className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Sectors saved.</p> : null}

      <form action={saveSectorsAction} className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <input type="hidden" name="organisationId" value={params.organisationId} />
        <input type="hidden" name="engagementId" value={params.engagementId} />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sectors this organisation operates in</h2>
        <p className="mt-1 text-xs text-slate-500">Pick every sector that applies. A broker that also runs a lending arm would pick both.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SELECTABLE_SECTORS.map((s) => (
            <label key={s.key} className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
              <input type="checkbox" name="sector" value={s.key} defaultChecked={sectors.includes(s.key)} className="mt-0.5" />
              <span><span className="font-medium text-slate-900">{s.label}</span><span className="block text-xs text-slate-500">{s.controls.length} added controls</span></span>
            </label>
          ))}
        </div>
        <div className="mt-3"><Button type="submit" size="sm">Save sectors</Button></div>
      </form>

      <nav aria-label="Jump to" className="mt-6 flex flex-wrap gap-4 text-sm"><a href="#part-a" className="font-medium text-brand-700 hover:underline">Part A: DPDP obligations</a><a href="#rules" className="font-medium text-brand-700 hover:underline">Rules and dates</a><a href="#part-b" className="font-medium text-brand-700 hover:underline">Part B: sector rules</a></nav>

      <h2 id="part-a" className="mt-8 font-display text-xl font-semibold text-slate-900">Part A · DPDP obligations for this organisation</h2>
      <div className="mt-4"><ApplicabilityPartA a={applicability} /></div>

      <h2 id="rules" className="mt-12 font-display text-xl font-semibold text-slate-900">The Rules that bind you, and from when</h2>
      <div className="mt-4"><RulesTimeline a={applicability} /></div>

      <h2 id="part-b" className="mt-12 font-display text-xl font-semibold text-slate-900">Part B · Sector rules</h2>
      <div className="mt-4"><ApplicabilityPartB a={applicability} referenceHref="/regulations" /></div>

      <section className="mt-10" aria-labelledby="b-all">
        <h3 id="b-all" className="text-base font-semibold text-slate-900">Across all sectors <Badge>{all.controls.length} controls</Badge></h3>
        <div className="mt-3"><SectorPart sector={all} /></div>
      </section>
      <p className="mt-8 text-xs text-slate-500">{SECTORS.length - 1} sectors are covered in the reference, with the full Act, Rules and penalty schedule. Browse them on the <Link href="/regulations" className="font-medium text-brand-700 hover:underline">Regulations reference</Link>.</p>
    </div>
  );
}
