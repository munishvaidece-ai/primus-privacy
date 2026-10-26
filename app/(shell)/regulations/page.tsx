import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Disclaimer, PartA, SectorPart } from "@/components/regulation/parts";
import { SECTORS, SELECTABLE_SECTORS, sectorByKey } from "@/lib/regulation";

/** Reference view of the whole regulation map: Part A (DPDP) and Part B for one sector at a time. */
export default async function RegulationsPage({ searchParams }: { searchParams: { sector?: string } }) {
  await requireAuthenticatedUser();
  const picked = searchParams.sector ? sectorByKey(searchParams.sector) : undefined;
  const sector = picked && picked.key !== "all" ? picked : SELECTABLE_SECTORS[0]!;
  const total = SECTORS.reduce((n, s) => n + s.controls.length, 0);
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Regulations reference</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Part A is the DPDP Act and Rules for every organisation. Part B is the sector rules, one sector at a time. {SELECTABLE_SECTORS.length} sectors and {total} sector controls are mapped. To apply them to a client, choose the sectors on the engagement&rsquo;s Regulations page.
      </p>
      <div className="mt-3"><Disclaimer /></div>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Part A · Digital Personal Data Protection Act, 2023 and Rules, 2025</h2>
      <div className="mt-3"><PartA /></div>

      <h2 className="mt-12 text-lg font-semibold text-slate-900">Part B · Sector rules</h2>
      <nav aria-label="Sectors" className="mt-3 flex flex-wrap gap-2">
        {SELECTABLE_SECTORS.map((s) => (
          <Link key={s.key} href={`/regulations?sector=${s.key}#part-b`} className={`rounded-full px-3 py-1 text-sm ring-1 ring-inset ${s.key === sector.key ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`} aria-current={s.key === sector.key ? "page" : undefined}>{s.label}</Link>
        ))}
      </nav>
      <section id="part-b" className="mt-5">
        <h3 className="text-base font-semibold text-slate-900">{sector.label} <Badge>{sector.controls.length} controls</Badge></h3>
        <div className="mt-3"><SectorPart sector={sector} /></div>
      </section>
      <section className="mt-10">
        <h3 className="text-base font-semibold text-slate-900">Across all sectors</h3>
        <div className="mt-3"><SectorPart sector={sectorByKey("all")!} /></div>
      </section>
    </div>
  );
}
