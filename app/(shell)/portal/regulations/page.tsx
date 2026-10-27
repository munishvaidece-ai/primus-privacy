import { loadPortal } from "@/lib/workspace/page";
import { loadEngagementApplicability } from "@/lib/workspace/applicability";
import { PortalHeader } from "@/components/portal/header";
import { Disclaimer } from "@/components/regulation/parts";
import { ApplicabilityHero, ApplicabilityPartA, ApplicabilityPartB, RulesTimeline } from "@/components/regulation/applicability";

/** What the DPDP Act and Rules mean for this organisation, read-only for the client. */
export default async function PortalRegulations({ searchParams }: { searchParams: { e?: string } }) {
  const { portal, data } = await loadPortal(searchParams, async ({ db, user, current }) => ({
    a: await loadEngagementApplicability(db, user.id, { engagementId: current.id, organisationId: current.organisationId }),
  }));
  const m = portal.current;
  return (
    <div>
      <PortalHeader title="What applies to you" subtitle="The provisions of the DPDP Act and Rules that bind your organisation, and the sector rules beside them. It updates as your answers and data map change." engagements={portal.engagements} current={m} />
      <ApplicabilityHero a={data.a} orgName={m.organisationName} />
      <div className="mt-3"><Disclaimer /></div>
      <h2 className="mt-8 font-display text-xl font-semibold text-slate-900">DPDP obligations for your organisation</h2>
      <div className="mt-4"><ApplicabilityPartA a={data.a} /></div>
      <h2 className="mt-12 font-display text-xl font-semibold text-slate-900">The Rules that bind you, and from when</h2>
      <div className="mt-4"><RulesTimeline a={data.a} /></div>
      <h2 className="mt-12 font-display text-xl font-semibold text-slate-900">Sector rules</h2>
      <div className="mt-4"><ApplicabilityPartB a={data.a} /></div>
    </div>
  );
}
