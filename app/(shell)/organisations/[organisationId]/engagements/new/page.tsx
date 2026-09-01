import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getOrganisationDetail } from "@/lib/domain/organisations";
import { listSelectableControlLibraryVersions } from "@/lib/domain/engagements";
import { canCreateEngagement, NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Button } from "@/components/ui/button";
import { createEngagementAction } from "./actions";

const ENGAGEMENT_TYPES: Array<{ value: string; label: string }> = [
  { value: "readiness", label: "Readiness" },
  { value: "annual_assessment", label: "Annual Assessment" },
  { value: "dpia_programme", label: "DPIA Programme" },
  { value: "third_party_assessment", label: "Third-Party Assessment" },
  { value: "continuous_compliance", label: "Continuous Compliance" },
];

export default async function NewEngagementPage({
  params,
  searchParams,
}: {
  params: { organisationId: string };
  searchParams: { error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const data = await withRequestDb(user.id, async (db) => {
    let organisation;
    try {
      organisation = await getOrganisationDetail(db, user.id, params.organisationId);
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
    const canCreate = await canCreateEngagement(db, user.id, organisation.id, organisation.tenantId);
    const controlLibraryVersions = canCreate
      ? await listSelectableControlLibraryVersions(db, organisation.tenantId)
      : [];
    return { organisation, canCreate, controlLibraryVersions };
  });

  if (!data) notFound();
  const { organisation, canCreate, controlLibraryVersions } = data;

  if (!canCreate) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Create Engagement</h1>
        <p role="alert" className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You do not have permission to create an engagement for {organisation.name}. This requires
          practice-wide (tenant) access or organisation-wide access to this client.
        </p>
      </div>
    );
  }

  const error = searchParams.error;

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold text-slate-900">Create Engagement</h1>
      <p className="mt-1 text-sm text-slate-600">for {organisation.name}</p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <form action={createEngagementAction} className="mt-6 space-y-4">
        <input type="hidden" name="organisationId" value={organisation.id} />

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700">
            Engagement name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={200}
            autoComplete="off"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          />
        </div>

        <div>
          <label htmlFor="engagementType" className="block text-sm font-medium text-slate-700">
            Engagement type
          </label>
          <select
            id="engagementType"
            name="engagementType"
            required
            defaultValue="readiness"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            {ENGAGEMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="periodStart" className="block text-sm font-medium text-slate-700">
              Period start
            </label>
            <input
              id="periodStart"
              name="periodStart"
              type="date"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            />
          </div>
          <div>
            <label htmlFor="periodEnd" className="block text-sm font-medium text-slate-700">
              Period end
            </label>
            <input
              id="periodEnd"
              name="periodEnd"
              type="date"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            />
          </div>
        </div>

        <div>
          <label htmlFor="controlLibraryVersionId" className="block text-sm font-medium text-slate-700">
            Control library version
          </label>
          <select
            id="controlLibraryVersionId"
            name="controlLibraryVersionId"
            defaultValue=""
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <option value="">Not yet pinned</option>
            {controlLibraryVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.versionLabel} ({v.status})
              </option>
            ))}
          </select>
          {controlLibraryVersions.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              No published control library version is available for your practice yet. You can create
              the engagement without one and pin it later.
            </p>
          ) : null}
        </div>

        <Button type="submit">Create Engagement</Button>
      </form>
    </div>
  );
}
