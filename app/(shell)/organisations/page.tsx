import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPage } from "@/lib/workspace/page";
import { organisationOverviews } from "@/lib/workspace/portfolio";
import { getUserTenantId, isActiveTenantMember } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Empty, FilterBar, FilterSelect, FilterText, PageHeader, PhaseBadge, Progress, Table, TD, includesCI } from "@/components/ui/kit";

// Portfolio of client organisations. Row security decides which exist for the
// caller; the filters here only narrow what they already may see.
export default async function OrganisationsPage({ searchParams }: { searchParams: { q?: string; industry?: string; status?: string } }) {
  const { viewer, user, data } = await loadPage(async ({ db, user, viewer }) => {
    const orgs = await organisationOverviews(db);
    const tenantId = await getUserTenantId(db, user.id);
    const canCreate = !viewer.isClient && tenantId ? await isActiveTenantMember(db, user.id, tenantId) : false;
    return { orgs, canCreate };
  });
  // A client with a single organisation goes straight to their portal.
  if (viewer.isClient) redirect("/portal");
  void user;
  const industries = Array.from(new Set(data.orgs.map((o) => o.industry).filter((x): x is string => !!x))).sort();
  const rows = data.orgs.filter((o) => includesCI(`${o.name} ${o.hqLocation ?? ""}`, searchParams.q) && (!searchParams.industry || o.industry === searchParams.industry) && (!searchParams.status || o.status === searchParams.status));

  return (
    <div>
      <PageHeader
        title="Organisations"
        subtitle="Client organisations you have access to."
        actions={data.canCreate ? <Link href="/organisations/new" className="inline-flex h-9 items-center justify-center rounded-lg bg-brand font-display font-semibold px-4 text-sm font-medium text-white transition-colors hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Create Organisation</Link> : null}
      />
      <FilterBar reset="/organisations">
        <FilterText name="q" label="Search name or location" value={searchParams.q} />
        <FilterSelect name="industry" label="Industry" value={searchParams.industry} options={industries.map((i) => ({ value: i, label: i }))} />
        <FilterSelect name="status" label="Status" value={searchParams.status} options={[{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "offboarded", label: "Offboarded" }]} />
      </FilterBar>
      {data.orgs.length === 0 ? (
        <Empty>No organisations yet — you have no membership on any client organisation or its engagements.</Empty>
      ) : rows.length === 0 ? (
        <Empty>No organisation matches those filters.</Empty>
      ) : (
        <Table label="Organisations" head={["Organisation", "Industry", "Headquarters", "Status", "Engagements", "Phase", "Progress", "Critical/high"]}>
          {rows.map((o) => (
            <tr key={o.id}>
              <td className={TD}><Link href={`/organisations/${o.id}`} className="font-medium text-slate-900 hover:underline">{o.name}</Link></td>
              <td className={TD}>{o.industry ?? <span className="text-slate-400">—</span>}</td>
              <td className={TD}>{o.hqLocation ?? <span className="text-slate-400">—</span>}</td>
              <td className={TD}><Badge tone={statusTone(o.status)}>{o.status}</Badge></td>
              <td className={`${TD} tabular-nums`}>{o.activeEngagements} active / {o.engagements}</td>
              <td className={TD}>{o.phase ? <PhaseBadge phase={o.phase} /> : <span className="text-slate-400">—</span>}</td>
              <td className={TD}>{o.progress !== null ? <Progress value={o.progress} label={`${o.name} progress`} /> : <span className="text-slate-400">—</span>}</td>
              <td className={`${TD} tabular-nums`}>{o.criticalHigh}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
