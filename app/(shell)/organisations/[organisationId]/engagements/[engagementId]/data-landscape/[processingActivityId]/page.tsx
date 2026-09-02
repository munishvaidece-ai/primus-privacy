import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getProcessingActivityDetail } from "@/lib/domain/processing-activities";
import { getOrganisationDetail } from "@/lib/domain/organisations";
import { listEngagementMembers } from "@/lib/domain/engagement-memberships";
import {
  listBusinessUnits,
  listPurposes,
  listDataPrincipalCategories,
  listPersonalDataElements,
  listSystems,
  listDataStores,
  listProcessors,
} from "@/lib/domain/master-data";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  updateProcessingActivityAction,
  carryForwardProcessingActivityAction,
  linkPurposeAction,
  unlinkPurposeAction,
  linkDataPrincipalCategoryAction,
  unlinkDataPrincipalCategoryAction,
  linkPersonalDataElementAction,
  unlinkPersonalDataElementAction,
  linkSystemAction,
  unlinkSystemAction,
  linkDataStoreAction,
  unlinkDataStoreAction,
  linkProcessorAction,
  unlinkProcessorAction,
} from "../actions";

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

/**
 * Processing Activity detail (Slice D2, instructions §5/§9): edit the
 * activity's own fields, and manage its six relationship junctions —
 * each resolved-and-pinned to the linked master entity's CURRENT
 * version at the moment of linking (DATA_MODEL.md §5.3's service-layer
 * rule). "Carry forward" (§5.4) is offered here too, into any other
 * engagement of the same organisation.
 */
export default async function ProcessingActivityDetailPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; engagementId: string; processingActivityId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const data = await withRequestDb(user.id, async (db) => {
    try {
      const activity = await getProcessingActivityDetail(db, user.id, params.processingActivityId);
      if (activity.engagementId !== params.engagementId || activity.organisationId !== params.organisationId) return null;

      const [organisation, members, businessUnits, purposeOptions, dpcOptions, pdeOptions, systemOptions, dataStoreOptions, processorOptions] =
        await Promise.all([
          getOrganisationDetail(db, user.id, params.organisationId),
          listEngagementMembers(db, user.id, { organisationId: params.organisationId, engagementId: params.engagementId }),
          listBusinessUnits(db, user.id, params.organisationId),
          listPurposes(db, user.id, params.organisationId),
          listDataPrincipalCategories(db, user.id, params.organisationId),
          listPersonalDataElements(db, user.id, params.organisationId),
          listSystems(db, user.id, params.organisationId),
          listDataStores(db, user.id, params.organisationId),
          listProcessors(db, user.id, params.organisationId),
        ]);

      return { activity, organisation, members, businessUnits, purposeOptions, dpcOptions, pdeOptions, systemOptions, dataStoreOptions, processorOptions };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) return null;
      throw err;
    }
  });

  if (!data) notFound();
  const { activity, organisation, members, businessUnits, purposeOptions, dpcOptions, pdeOptions, systemOptions, dataStoreOptions, processorOptions } = data;

  const otherEngagements = organisation.engagements.filter((e) => e.id !== params.engagementId);
  const unlinkedPurposes = purposeOptions.filter((p) => !activity.purposes.some((l) => l.purposeId === p.id));
  const unlinkedDpc = dpcOptions.filter((c) => !activity.dataPrincipalCategories.some((l) => l.dataPrincipalCategoryId === c.id));
  const unlinkedPde = pdeOptions.filter((e) => !activity.personalDataElements.some((l) => l.personalDataElementId === e.id));
  const unlinkedSystems = systemOptions.filter((s) => !activity.systems.some((l) => l.systemId === s.id));
  const unlinkedDataStores = dataStoreOptions.filter((d) => !activity.dataStores.some((l) => l.dataStoreId === d.id));
  const unlinkedProcessors = processorOptions.filter((p) => !activity.processors.some((l) => l.processorId === p.id));

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${params.organisationId}/engagements/${params.engagementId}/data-landscape`} className="hover:underline">
          Data Landscape
        </Link>
      </p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{activity.name}</h1>
        <Badge tone={statusTone(activity.lifecycleStatus)}>{activity.lifecycleStatus}</Badge>
      </div>
      {activity.carriedForwardFromId ? (
        <p className="mt-1 text-xs text-slate-500">Carried forward from a prior engagement&rsquo;s Processing Activity.</p>
      ) : null}

      {searchParams.saved === "1" ? (
        <p role="status" className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Saved.
        </p>
      ) : null}
      {searchParams.error ? (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {searchParams.error}
        </p>
      ) : null}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Details</h2>
        <form action={updateProcessingActivityAction} className="mt-3 max-w-xl space-y-4 rounded-md border border-slate-200 bg-white p-4">
          <input type="hidden" name="organisationId" value={params.organisationId} />
          <input type="hidden" name="engagementId" value={params.engagementId} />
          <input type="hidden" name="processingActivityId" value={activity.id} />

          <div>
            <label htmlFor="name" className="block text-xs font-medium text-slate-700">Name</label>
            <input id="name" name="name" defaultValue={activity.name} required maxLength={200} className={INPUT_CLASS} />
          </div>
          <div>
            <label htmlFor="description" className="block text-xs font-medium text-slate-700">Description</label>
            <textarea id="description" name="description" defaultValue={activity.description ?? ""} rows={3} className={INPUT_CLASS} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="businessUnitId" className="block text-xs font-medium text-slate-700">Business unit</label>
              <select id="businessUnitId" name="businessUnitId" defaultValue={activity.businessUnitId ?? ""} className={INPUT_CLASS}>
                <option value="">None</option>
                {businessUnits.map((bu) => (
                  <option key={bu.id} value={bu.id}>{bu.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ownerUserId" className="block text-xs font-medium text-slate-700">Owner</label>
              <select id="ownerUserId" name="ownerUserId" defaultValue={activity.ownerUserId ?? ""} className={INPUT_CLASS}>
                <option value="">None</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.displayName ?? m.email}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="lifecycleStatus" className="block text-xs font-medium text-slate-700">Lifecycle status</label>
              <select id="lifecycleStatus" name="lifecycleStatus" defaultValue={activity.lifecycleStatus} className={INPUT_CLASS}>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="under_review">under_review</option>
                <option value="retired">retired</option>
              </select>
            </div>
            <div>
              <label htmlFor="lawfulBasis" className="block text-xs font-medium text-slate-700">Lawful basis</label>
              <input id="lawfulBasis" name="lawfulBasis" defaultValue={activity.lawfulBasis ?? ""} className={INPUT_CLASS} />
            </div>
          </div>
          <Button type="submit" size="sm">Save</Button>
        </form>
      </section>

      {otherEngagements.length > 0 ? (
        <section className="mt-6">
          <details>
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-500">Carry forward…</summary>
            <div className="mt-3 max-w-xl rounded-md border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">
                Creates a new Processing Activity in the target engagement, linked back to this one, with every
                relationship re-resolved to each master entity&rsquo;s current version.
              </p>
              <form action={carryForwardProcessingActivityAction} className="mt-3 flex items-end gap-3">
                <input type="hidden" name="organisationId" value={params.organisationId} />
                <input type="hidden" name="engagementId" value={params.engagementId} />
                <input type="hidden" name="processingActivityId" value={activity.id} />
                <div className="flex-1">
                  <label htmlFor="targetEngagementId" className="block text-xs font-medium text-slate-700">Target engagement</label>
                  <select id="targetEngagementId" name="targetEngagementId" required defaultValue="" className={INPUT_CLASS}>
                    <option value="" disabled>Select an engagement</option>
                    {otherEngagements.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                <Button type="submit" size="sm">Carry forward</Button>
              </form>
            </div>
          </details>
        </section>
      ) : null}

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RelationshipCard title="Purposes">
          <ul className="space-y-1">
            {activity.purposes.map((l) => (
              <li key={l.linkId} className="flex items-center justify-between gap-2 text-sm">
                <span>{l.name}</span>
                <form action={unlinkPurposeAction}>
                  <input type="hidden" name="organisationId" value={params.organisationId} />
                  <input type="hidden" name="engagementId" value={params.engagementId} />
                  <input type="hidden" name="processingActivityId" value={activity.id} />
                  <input type="hidden" name="purposeId" value={l.purposeId} />
                  <Button type="submit" size="sm" variant="destructive">Unlink</Button>
                </form>
              </li>
            ))}
            {activity.purposes.length === 0 ? <li className="text-sm text-slate-500">None linked.</li> : null}
          </ul>
          {unlinkedPurposes.length > 0 ? (
            <form action={linkPurposeAction} className="mt-3 flex items-end gap-2">
              <input type="hidden" name="organisationId" value={params.organisationId} />
              <input type="hidden" name="engagementId" value={params.engagementId} />
              <input type="hidden" name="processingActivityId" value={activity.id} />
              <select name="purposeId" required defaultValue="" className={INPUT_CLASS}>
                <option value="" disabled>Link a purpose…</option>
                {unlinkedPurposes.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <Button type="submit" size="sm">Link</Button>
            </form>
          ) : null}
        </RelationshipCard>

        <RelationshipCard title="Data Principal Categories">
          <ul className="space-y-1">
            {activity.dataPrincipalCategories.map((l) => (
              <li key={l.linkId} className="flex items-center justify-between gap-2 text-sm">
                <span>{l.name}</span>
                <form action={unlinkDataPrincipalCategoryAction}>
                  <input type="hidden" name="organisationId" value={params.organisationId} />
                  <input type="hidden" name="engagementId" value={params.engagementId} />
                  <input type="hidden" name="processingActivityId" value={activity.id} />
                  <input type="hidden" name="dataPrincipalCategoryId" value={l.dataPrincipalCategoryId} />
                  <Button type="submit" size="sm" variant="destructive">Unlink</Button>
                </form>
              </li>
            ))}
            {activity.dataPrincipalCategories.length === 0 ? <li className="text-sm text-slate-500">None linked.</li> : null}
          </ul>
          {unlinkedDpc.length > 0 ? (
            <form action={linkDataPrincipalCategoryAction} className="mt-3 flex items-end gap-2">
              <input type="hidden" name="organisationId" value={params.organisationId} />
              <input type="hidden" name="engagementId" value={params.engagementId} />
              <input type="hidden" name="processingActivityId" value={activity.id} />
              <select name="dataPrincipalCategoryId" required defaultValue="" className={INPUT_CLASS}>
                <option value="" disabled>Link a category…</option>
                {unlinkedDpc.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <Button type="submit" size="sm">Link</Button>
            </form>
          ) : null}
        </RelationshipCard>

        <RelationshipCard title="Personal Data Elements">
          <ul className="space-y-1">
            {activity.personalDataElements.map((l) => (
              <li key={l.linkId} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {l.name}
                  {l.sensitivityNote ? <span className="ml-1 text-xs text-slate-500">({l.sensitivityNote})</span> : null}
                </span>
                <form action={unlinkPersonalDataElementAction}>
                  <input type="hidden" name="organisationId" value={params.organisationId} />
                  <input type="hidden" name="engagementId" value={params.engagementId} />
                  <input type="hidden" name="processingActivityId" value={activity.id} />
                  <input type="hidden" name="personalDataElementId" value={l.personalDataElementId} />
                  <Button type="submit" size="sm" variant="destructive">Unlink</Button>
                </form>
              </li>
            ))}
            {activity.personalDataElements.length === 0 ? <li className="text-sm text-slate-500">None linked.</li> : null}
          </ul>
          {unlinkedPde.length > 0 ? (
            <form action={linkPersonalDataElementAction} className="mt-3 flex items-end gap-2">
              <input type="hidden" name="organisationId" value={params.organisationId} />
              <input type="hidden" name="engagementId" value={params.engagementId} />
              <input type="hidden" name="processingActivityId" value={activity.id} />
              <select name="personalDataElementId" required defaultValue="" className={INPUT_CLASS}>
                <option value="" disabled>Link an element…</option>
                {unlinkedPde.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
              <input name="sensitivityNote" placeholder="Sensitivity note (optional)" className={INPUT_CLASS} />
              <Button type="submit" size="sm">Link</Button>
            </form>
          ) : null}
        </RelationshipCard>

        <RelationshipCard title="Systems">
          <ul className="space-y-1">
            {activity.systems.map((l) => (
              <li key={l.linkId} className="flex items-center justify-between gap-2 text-sm">
                <span>{l.name}</span>
                <form action={unlinkSystemAction}>
                  <input type="hidden" name="organisationId" value={params.organisationId} />
                  <input type="hidden" name="engagementId" value={params.engagementId} />
                  <input type="hidden" name="processingActivityId" value={activity.id} />
                  <input type="hidden" name="systemId" value={l.systemId} />
                  <Button type="submit" size="sm" variant="destructive">Unlink</Button>
                </form>
              </li>
            ))}
            {activity.systems.length === 0 ? <li className="text-sm text-slate-500">None linked.</li> : null}
          </ul>
          {unlinkedSystems.length > 0 ? (
            <form action={linkSystemAction} className="mt-3 flex items-end gap-2">
              <input type="hidden" name="organisationId" value={params.organisationId} />
              <input type="hidden" name="engagementId" value={params.engagementId} />
              <input type="hidden" name="processingActivityId" value={activity.id} />
              <select name="systemId" required defaultValue="" className={INPUT_CLASS}>
                <option value="" disabled>Link a system…</option>
                {unlinkedSystems.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <Button type="submit" size="sm">Link</Button>
            </form>
          ) : null}
        </RelationshipCard>

        <RelationshipCard title="Data Stores">
          <ul className="space-y-1">
            {activity.dataStores.map((l) => (
              <li key={l.linkId} className="flex items-center justify-between gap-2 text-sm">
                <span>{l.name}</span>
                <form action={unlinkDataStoreAction}>
                  <input type="hidden" name="organisationId" value={params.organisationId} />
                  <input type="hidden" name="engagementId" value={params.engagementId} />
                  <input type="hidden" name="processingActivityId" value={activity.id} />
                  <input type="hidden" name="dataStoreId" value={l.dataStoreId} />
                  <Button type="submit" size="sm" variant="destructive">Unlink</Button>
                </form>
              </li>
            ))}
            {activity.dataStores.length === 0 ? <li className="text-sm text-slate-500">None linked.</li> : null}
          </ul>
          {unlinkedDataStores.length > 0 ? (
            <form action={linkDataStoreAction} className="mt-3 flex items-end gap-2">
              <input type="hidden" name="organisationId" value={params.organisationId} />
              <input type="hidden" name="engagementId" value={params.engagementId} />
              <input type="hidden" name="processingActivityId" value={activity.id} />
              <select name="dataStoreId" required defaultValue="" className={INPUT_CLASS}>
                <option value="" disabled>Link a data store…</option>
                {unlinkedDataStores.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <Button type="submit" size="sm">Link</Button>
            </form>
          ) : null}
        </RelationshipCard>

        <RelationshipCard title="Processors">
          <ul className="space-y-1">
            {activity.processors.map((l) => (
              <li key={l.linkId} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {l.name} <span className="text-xs text-slate-500">({l.role})</span>
                </span>
                <form action={unlinkProcessorAction}>
                  <input type="hidden" name="organisationId" value={params.organisationId} />
                  <input type="hidden" name="engagementId" value={params.engagementId} />
                  <input type="hidden" name="processingActivityId" value={activity.id} />
                  <input type="hidden" name="processorId" value={l.processorId} />
                  <Button type="submit" size="sm" variant="destructive">Unlink</Button>
                </form>
              </li>
            ))}
            {activity.processors.length === 0 ? <li className="text-sm text-slate-500">None linked.</li> : null}
          </ul>
          {unlinkedProcessors.length > 0 ? (
            <form action={linkProcessorAction} className="mt-3 flex items-end gap-2">
              <input type="hidden" name="organisationId" value={params.organisationId} />
              <input type="hidden" name="engagementId" value={params.engagementId} />
              <input type="hidden" name="processingActivityId" value={activity.id} />
              <select name="processorId" required defaultValue="" className={INPUT_CLASS}>
                <option value="" disabled>Link a processor…</option>
                {unlinkedProcessors.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select name="role" defaultValue="processor" className={INPUT_CLASS}>
                <option value="processor">processor</option>
                <option value="joint_controller">joint_controller</option>
              </select>
              <Button type="submit" size="sm">Link</Button>
            </form>
          ) : null}
        </RelationshipCard>
      </section>
    </div>
  );
}

function RelationshipCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}
