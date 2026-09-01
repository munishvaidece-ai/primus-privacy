import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listAccessibleOrganisations } from "@/lib/domain/organisations";
import { getUserTenantId, isActiveTenantMember } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";

// The first real, database-backed page (PHASE A instructions §10).
// Real PostgreSQL data only — no mock data. RLS (migration 0001's
// `organisations_select` policy) guarantees this list can never include
// another tenant's organisations, regardless of what this page's own
// query does or doesn't filter on (see lib/domain/organisations.ts).
export default async function OrganisationsPage() {
  const user = await requireAuthenticatedUser();
  const { organisations, canCreate } = await withRequestDb(user.id, async (db) => {
    const list = await listAccessibleOrganisations(db);
    const tenantId = await getUserTenantId(db, user.id);
    const create = tenantId ? await isActiveTenantMember(db, user.id, tenantId) : false;
    return { organisations: list, canCreate: create };
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Organisations</h1>
          <p className="mt-1 text-sm text-slate-600">Client organisations you have access to.</p>
        </div>
        {canCreate ? (
          <Link
            href="/organisations/new"
            className="inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            Create Organisation
          </Link>
        ) : null}
      </div>

      {organisations.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          No organisations yet — you have no membership on any client organisation or its engagements.
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {organisations.map((org) => (
            <li key={org.id}>
              <Link
                href={`/organisations/${org.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
              >
                <span className="text-sm font-medium text-slate-900">{org.name}</span>
                <Badge tone={statusTone(org.status)}>{org.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
