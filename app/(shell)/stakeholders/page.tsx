import Link from "next/link";
import { loadPage } from "@/lib/workspace/page";
import { listStakeholders } from "@/lib/workspace/portfolio";
import { Empty, FilterBar, FilterSelect, FilterText, PageHeader, SideBadge, Table, TD, includesCI } from "@/components/ui/kit";

export default async function StakeholdersPage({ searchParams }: { searchParams: { q?: string; side?: string; role?: string } }) {
  const { data } = await loadPage(({ db }) => listStakeholders(db));
  const roles = Array.from(new Set(data.map((s) => s.role))).sort();
  const rows = data.filter((s) => includesCI(`${s.email} ${s.displayName ?? ""} ${s.organisationName}`, searchParams.q) && (!searchParams.side || s.side === searchParams.side) && (!searchParams.role || s.role === searchParams.role));
  return (
    <div>
      <PageHeader title="Stakeholders" subtitle="Everyone with a role on the engagements you can open: the Primus team and the client's people. To add or remove someone, use the Members section of the engagement." />
      <FilterBar reset="/stakeholders">
        <FilterText name="q" label="Search name, email or client" value={searchParams.q} />
        <FilterSelect name="side" label="Side" value={searchParams.side} options={[{ value: "primus", label: "Primus team" }, { value: "client", label: "Client" }]} />
        <FilterSelect name="role" label="Role" value={searchParams.role} options={roles.map((r) => ({ value: r, label: r }))} />
      </FilterBar>
      {data.length === 0 ? <Empty>No stakeholders to show.</Empty> : rows.length === 0 ? <Empty>No one matches those filters.</Empty> : (
        <Table label="Stakeholders" head={["Name", "Email", "Side", "Role", "Client", "Engagement"]}>
          {rows.map((s, i) => (
            <tr key={`${s.userId}-${s.role}-${s.engagementId}-${s.scope}-${i}`}>
              <td className={TD}>{s.displayName ?? <span className="text-slate-400">—</span>}</td>
              <td className={TD}>{s.email}</td>
              <td className={TD}><SideBadge side={s.side} /></td>
              <td className={TD}>{s.role}{s.scope === "organisation" ? <span className="text-xs text-slate-500"> (whole organisation)</span> : null}</td>
              <td className={TD}><Link href={`/organisations/${s.organisationId}`} className="hover:underline">{s.organisationName}</Link></td>
              <td className={TD}><Link href={`/organisations/${s.organisationId}/engagements/${s.engagementId}`} className="hover:underline">{s.engagementName}</Link></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
