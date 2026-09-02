import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listRopaEntries } from "@/lib/domain/processing-activities";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";

/**
 * ROPA (Record of Processing Activities) — Slice D2 instructions §10:
 * a read view over Processing Activities and their relationships, NOT a
 * separate persisted object. Every field here is resolved from
 * `processing_activities` and its six junction tables
 * (`lib/domain/processing-activities.ts`'s `listRopaEntries`) — nothing
 * on this page is written anywhere new. Export/PDF stays out of scope
 * (R1 already owns Engagement Report generation).
 */
export default async function RopaPage({ params }: { params: { organisationId: string; engagementId: string } }) {
  const user = await requireAuthenticatedUser();

  const data = await withRequestDb(user.id, async (db) => {
    try {
      const engagement = await getEngagementDetail(db, user.id, params.engagementId);
      if (engagement.organisationId !== params.organisationId) return null;
      const entries = await listRopaEntries(db, user.id, { engagementId: params.engagementId, organisationId: params.organisationId });
      return { engagement, entries };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!data) notFound();
  const { engagement, entries } = data;

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/data-landscape`} className="hover:underline">
          Data Landscape
        </Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">ROPA — {engagement.name}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Record of Processing Activities: every Processing Activity in this engagement with its full resolved
        relationship set, as recorded at this moment.
      </p>

      {entries.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
          No processing activities recorded yet.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {entries.map((e) => (
            <article key={e.id} className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{e.name}</h2>
                  {e.description ? <p className="mt-1 text-sm text-slate-600">{e.description}</p> : null}
                </div>
                <Badge tone={statusTone(e.lifecycleStatus)}>{e.lifecycleStatus}</Badge>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <RopaField label="Business unit" value={e.businessUnitName} />
                <RopaField label="Owner" value={e.ownerEmail} />
                <RopaField label="Lawful basis" value={e.lawfulBasis} />
                <RopaField label="Purposes" value={e.purposes.map((p) => p.name).join(", ") || null} />
                <RopaField label="Data principal categories" value={e.dataPrincipalCategories.map((c) => c.name).join(", ") || null} />
                <RopaField
                  label="Personal data elements"
                  value={e.personalDataElements.map((p) => (p.sensitivityNote ? `${p.name} (${p.sensitivityNote})` : p.name)).join(", ") || null}
                />
                <RopaField label="Systems" value={e.systems.map((s) => s.name).join(", ") || null} />
                <RopaField label="Data stores" value={e.dataStores.map((d) => d.name).join(", ") || null} />
                <RopaField label="Processors" value={e.processors.map((p) => `${p.name} (${p.role})`).join(", ") || null} />
              </dl>

              <Link
                href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/data-landscape/${e.id}`}
                className="mt-3 inline-block text-sm font-medium text-slate-900 underline"
              >
                Open
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function RopaField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value ?? "—"}</dd>
    </div>
  );
}
