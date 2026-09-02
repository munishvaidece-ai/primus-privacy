import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getEngagementDetail } from "@/lib/domain/engagements";
import { listBusinessUnits } from "@/lib/domain/master-data";
import { listEngagementMembers } from "@/lib/domain/engagement-memberships";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Button } from "@/components/ui/button";
import { createProcessingActivityAction } from "../actions";

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

export default async function NewProcessingActivityPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string };
  searchParams: { error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const data = await withRequestDb(user.id, async (db) => {
    try {
      const engagement = await getEngagementDetail(db, user.id, params.engagementId);
      if (engagement.organisationId !== params.organisationId) return null;
      const [businessUnits, members] = await Promise.all([
        listBusinessUnits(db, user.id, params.organisationId),
        listEngagementMembers(db, user.id, { organisationId: params.organisationId, engagementId: params.engagementId }),
      ]);
      return { engagement, businessUnits, members };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!data) notFound();
  const { engagement, businessUnits, members } = data;

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/data-landscape`} className="hover:underline">
          Data Landscape
        </Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Create Processing Activity</h1>
      <p className="mt-1 text-sm text-slate-600">{engagement.name}</p>

      {searchParams.error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {searchParams.error}
        </p>
      ) : null}

      <form action={createProcessingActivityAction} className="mt-6 max-w-xl space-y-4">
        <input type="hidden" name="organisationId" value={params.organisationId} />
        <input type="hidden" name="engagementId" value={params.engagementId} />

        <div>
          <label htmlFor="name" className="block text-xs font-medium text-slate-700">
            Name
          </label>
          <input id="name" name="name" type="text" required maxLength={200} autoComplete="off" className={INPUT_CLASS} />
        </div>

        <div>
          <label htmlFor="description" className="block text-xs font-medium text-slate-700">
            Description
          </label>
          <textarea id="description" name="description" rows={3} className={INPUT_CLASS} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="businessUnitId" className="block text-xs font-medium text-slate-700">
              Business unit
            </label>
            <select id="businessUnitId" name="businessUnitId" defaultValue="" className={INPUT_CLASS}>
              <option value="">None</option>
              {businessUnits.map((bu) => (
                <option key={bu.id} value={bu.id}>
                  {bu.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ownerUserId" className="block text-xs font-medium text-slate-700">
              Owner
            </label>
            <select id="ownerUserId" name="ownerUserId" defaultValue="" className={INPUT_CLASS}>
              <option value="">None</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName ?? m.email}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="lawfulBasis" className="block text-xs font-medium text-slate-700">
            Lawful basis
          </label>
          <input id="lawfulBasis" name="lawfulBasis" type="text" className={INPUT_CLASS} placeholder="e.g. Consent" />
        </div>

        <Button type="submit">Create Processing Activity</Button>
      </form>
    </div>
  );
}
