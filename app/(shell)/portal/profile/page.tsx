import Link from "next/link";
import { loadPortal } from "@/lib/workspace/page";
import { listStakeholders } from "@/lib/workspace/portfolio";
import { PortalHeader } from "@/components/portal/header";
import { CARD, SideBadge, Table, TD, fmtDate, titleCase } from "@/components/ui/kit";

export default async function PortalProfile({ searchParams }: { searchParams: { e?: string } }) {
  const { portal, data } = await loadPortal(searchParams, ({ db, current }) => listStakeholders(db, { engagementId: current.id }));
  const m = portal.current;
  const field = (label: string, v: string | null) => <div><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-0.5 text-sm text-slate-900">{v || <span className="text-slate-400">Not recorded</span>}</dd></div>;
  return (
    <div>
      <PortalHeader title="Company profile" subtitle="How Primus has recorded your organisation, and the people working on your engagement." engagements={portal.engagements} current={m} />
      <section className={CARD} aria-labelledby="org">
        <h2 id="org" className="text-sm font-semibold text-slate-900">{m.organisationName}</h2>
        <dl className="mt-3 grid gap-4 md:grid-cols-3">
          {field("Industry", m.industry)}
          {field("Headquarters", m.hqLocation)}
          {field("Engagement", m.name)}
          {field("Type", titleCase(m.engagementType))}
          {field("Period", `${fmtDate(m.periodStart)} – ${fmtDate(m.periodEnd)}`)}
        </dl>
        <p className="mt-4 text-xs text-slate-500">If any of this is wrong, raise a <Link href={`/portal/clarifications${portal.q}`} className="underline">clarification</Link> and the Primus team will correct it.</p>
      </section>
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">People on this engagement</h2>
      <Table label="People" head={["Name", "Email", "Side", "Role"]}>
        {data.map((s, i) => <tr key={`${s.userId}-${s.role}-${i}`}><td className={TD}>{s.displayName ?? <span className="text-slate-400">—</span>}</td><td className={TD}>{s.email}</td><td className={TD}><SideBadge side={s.side} /></td><td className={TD}>{s.role}</td></tr>)}
      </Table>
    </div>
  );
}
