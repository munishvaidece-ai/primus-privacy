import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listAccessibleOrganisations } from "@/lib/domain/organisations";
import { Badge, statusTone } from "@/components/ui/badge";

// The first real, database-backed page (PHASE A instructions §10).
// Real PostgreSQL data only — no mock data. RLS (migration 0001's
// `organisations_select` policy) guarantees this list can never include
// another tenant's organisations, regardless of what this page's own
// query does or doesn't filter on (see lib/domain/organisations.ts).
export default async function OrganisationsPage() {
  const user = await requireAuthenticatedUser();
  const organisations = await withRequestDb(user.id, (db) => listAccessibleOrganisations(db));

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Organisations</h1>
      <p className="mt-1 text-sm text-slate-600">Client organisations you have access to.</p>

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
