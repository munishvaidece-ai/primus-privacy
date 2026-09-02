import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import * as masterData from "@/lib/domain/master-data";
import { NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MASTER_DATA_CATEGORIES, CATEGORY_LABELS, isMasterDataCategory, type MasterDataCategory } from "../categories";
import {
  createBusinessUnitAction,
  updateBusinessUnitAction,
  createDataPrincipalCategoryAction,
  createDataPrincipalCategoryVersionAction,
  retireDataPrincipalCategoryAction,
  createPersonalDataElementAction,
  createPersonalDataElementVersionAction,
  retirePersonalDataElementAction,
  createPurposeAction,
  createPurposeVersionAction,
  retirePurposeAction,
  createSystemAction,
  createSystemVersionAction,
  retireSystemAction,
  createDataStoreAction,
  createDataStoreVersionAction,
  retireDataStoreAction,
  createProcessorAction,
  createProcessorVersionAction,
  retireProcessorAction,
} from "./actions";

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

/**
 * Client Master Data (Slice D2, instructions §9/§11 — PRODUCT_UX_
 * BLUEPRINT.md §5 row 5 / §14). One screen, tabbed by category (the
 * six SCD2-versioned entity types plus Business Unit), instead of
 * seven near-identical route trees. "Add" always creates a new CURRENT
 * version for the six versioned categories (never edits an existing
 * version row in place — DATA_MODEL.md §5.1) and a plain in-place edit
 * for Business Unit (the one entity DATA_MODEL.md §5.1/§5.3 explicitly
 * carves out of version-pinning). Write access is `requireOrganisation
 * Access` — the same broad organisation-membership check migration
 * 0003's RLS policies already use for these tables; there is no
 * dedicated master-data permission (see DECISIONS.md).
 */
export default async function MasterDataCategoryPage({
  params,
  searchParams,
}: {
  params: { organisationId: string; category: string };
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();
  if (!isMasterDataCategory(params.category)) notFound();
  const category: MasterDataCategory = params.category;
  const { organisationId } = params;

  let content;
  try {
    content = await withRequestDb(user.id, async (db) => {
      switch (category) {
        case "business-units": {
          const items = await masterData.listBusinessUnits(db, user.id, organisationId);
          return (
            <>
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {items.length === 0 ? (
                  <li className="px-6 py-8 text-center text-sm text-slate-500">No business units yet.</li>
                ) : (
                  items.map((bu) => (
                    <li key={bu.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{bu.name}</p>
                          {bu.parentBusinessUnitId ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              Parent: {items.find((x) => x.id === bu.parentBusinessUnitId)?.name ?? bu.parentBusinessUnitId}
                            </p>
                          ) : null}
                        </div>
                        <Badge tone={statusTone(bu.status)}>{bu.status}</Badge>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Edit</summary>
                        <form action={updateBusinessUnitAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                          <input type="hidden" name="organisationId" value={organisationId} />
                          <input type="hidden" name="businessUnitId" value={bu.id} />
                          <input name="name" defaultValue={bu.name} required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                          <select name="parentBusinessUnitId" defaultValue={bu.parentBusinessUnitId ?? ""} className={INPUT_CLASS}>
                            <option value="">No parent</option>
                            {items.filter((x) => x.id !== bu.id).map((x) => (
                              <option key={x.id} value={x.id}>{x.name}</option>
                            ))}
                          </select>
                          <select name="status" defaultValue={bu.status} className={INPUT_CLASS}>
                            <option value="active">active</option>
                            <option value="retired">retired</option>
                          </select>
                          <Button type="submit" size="sm">Save</Button>
                        </form>
                      </details>
                    </li>
                  ))
                )}
              </ul>
              <form action={createBusinessUnitAction} className="mt-6 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-3">
                <input type="hidden" name="organisationId" value={organisationId} />
                <p className="sm:col-span-3 text-xs font-medium text-slate-700">Add business unit</p>
                <input name="name" required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                <select name="parentBusinessUnitId" defaultValue="" className={INPUT_CLASS}>
                  <option value="">No parent</option>
                  {items.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
                <Button type="submit" size="sm">Add</Button>
              </form>
            </>
          );
        }

        case "data-principal-categories": {
          const items = await masterData.listDataPrincipalCategories(db, user.id, organisationId);
          return (
            <>
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {items.length === 0 ? (
                  <li className="px-6 py-8 text-center text-sm text-slate-500">No data principal categories yet.</li>
                ) : (
                  items.map((row) => (
                    <li key={row.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {row.name}
                            {row.isChildrenFlag ? <span className="ml-2 text-xs font-normal text-amber-700">children</span> : null}
                          </p>
                          {row.description ? <p className="mt-0.5 text-xs text-slate-500">{row.description}</p> : null}
                        </div>
                        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Edit (creates a new version)</summary>
                        <form action={createDataPrincipalCategoryVersionAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                          <input type="hidden" name="organisationId" value={organisationId} />
                          <input type="hidden" name="dataPrincipalCategoryId" value={row.id} />
                          <input name="name" defaultValue={row.name} required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                          <input name="description" defaultValue={row.description ?? ""} className={INPUT_CLASS} placeholder="Description" />
                          <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-700">
                            <input type="checkbox" name="isChildrenFlag" defaultChecked={row.isChildrenFlag} /> Children
                          </label>
                          <Button type="submit" size="sm">Save new version</Button>
                        </form>
                        {row.status === "active" ? (
                          <form action={retireDataPrincipalCategoryAction} className="mt-2">
                            <input type="hidden" name="organisationId" value={organisationId} />
                            <input type="hidden" name="dataPrincipalCategoryId" value={row.id} />
                            <Button type="submit" size="sm" variant="destructive">Retire</Button>
                          </form>
                        ) : null}
                      </details>
                    </li>
                  ))
                )}
              </ul>
              <form action={createDataPrincipalCategoryAction} className="mt-6 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-4">
                <input type="hidden" name="organisationId" value={organisationId} />
                <p className="sm:col-span-4 text-xs font-medium text-slate-700">Add data principal category</p>
                <input name="name" required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                <input name="description" className={INPUT_CLASS} placeholder="Description" />
                <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-700">
                  <input type="checkbox" name="isChildrenFlag" /> Children
                </label>
                <Button type="submit" size="sm">Add</Button>
              </form>
            </>
          );
        }

        case "personal-data-elements": {
          const items = await masterData.listPersonalDataElements(db, user.id, organisationId);
          return (
            <>
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {items.length === 0 ? (
                  <li className="px-6 py-8 text-center text-sm text-slate-500">No personal data elements yet.</li>
                ) : (
                  items.map((row) => (
                    <li key={row.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-medium text-slate-900">
                          {row.name} <span className="ml-1 text-xs font-normal text-slate-500">({row.sensitivityCategory})</span>
                        </p>
                        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Edit (creates a new version)</summary>
                        <form action={createPersonalDataElementVersionAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <input type="hidden" name="organisationId" value={organisationId} />
                          <input type="hidden" name="personalDataElementId" value={row.id} />
                          <input name="name" defaultValue={row.name} required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                          <select name="sensitivityCategory" defaultValue={row.sensitivityCategory} className={INPUT_CLASS}>
                            <option value="general">general</option>
                            <option value="sensitive">sensitive</option>
                            <option value="critical">critical</option>
                          </select>
                          <Button type="submit" size="sm">Save new version</Button>
                        </form>
                        {row.status === "active" ? (
                          <form action={retirePersonalDataElementAction} className="mt-2">
                            <input type="hidden" name="organisationId" value={organisationId} />
                            <input type="hidden" name="personalDataElementId" value={row.id} />
                            <Button type="submit" size="sm" variant="destructive">Retire</Button>
                          </form>
                        ) : null}
                      </details>
                    </li>
                  ))
                )}
              </ul>
              <form action={createPersonalDataElementAction} className="mt-6 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-3">
                <input type="hidden" name="organisationId" value={organisationId} />
                <p className="sm:col-span-3 text-xs font-medium text-slate-700">Add personal data element</p>
                <input name="name" required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                <select name="sensitivityCategory" defaultValue="general" className={INPUT_CLASS}>
                  <option value="general">general</option>
                  <option value="sensitive">sensitive</option>
                  <option value="critical">critical</option>
                </select>
                <Button type="submit" size="sm">Add</Button>
              </form>
            </>
          );
        }

        case "purposes": {
          const items = await masterData.listPurposes(db, user.id, organisationId);
          return (
            <>
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {items.length === 0 ? (
                  <li className="px-6 py-8 text-center text-sm text-slate-500">No purposes yet.</li>
                ) : (
                  items.map((row) => (
                    <li key={row.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{row.name}</p>
                          {row.description ? <p className="mt-0.5 text-xs text-slate-500">{row.description}</p> : null}
                        </div>
                        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Edit (creates a new version)</summary>
                        <form action={createPurposeVersionAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <input type="hidden" name="organisationId" value={organisationId} />
                          <input type="hidden" name="purposeId" value={row.id} />
                          <input name="name" defaultValue={row.name} required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                          <input name="description" defaultValue={row.description ?? ""} className={INPUT_CLASS} placeholder="Description" />
                          <Button type="submit" size="sm">Save new version</Button>
                        </form>
                        {row.status === "active" ? (
                          <form action={retirePurposeAction} className="mt-2">
                            <input type="hidden" name="organisationId" value={organisationId} />
                            <input type="hidden" name="purposeId" value={row.id} />
                            <Button type="submit" size="sm" variant="destructive">Retire</Button>
                          </form>
                        ) : null}
                      </details>
                    </li>
                  ))
                )}
              </ul>
              <form action={createPurposeAction} className="mt-6 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-3">
                <input type="hidden" name="organisationId" value={organisationId} />
                <p className="sm:col-span-3 text-xs font-medium text-slate-700">Add purpose</p>
                <input name="name" required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                <input name="description" className={INPUT_CLASS} placeholder="Description" />
                <Button type="submit" size="sm">Add</Button>
              </form>
            </>
          );
        }

        case "systems": {
          const items = await masterData.listSystems(db, user.id, organisationId);
          return (
            <>
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {items.length === 0 ? (
                  <li className="px-6 py-8 text-center text-sm text-slate-500">No systems yet.</li>
                ) : (
                  items.map((row) => (
                    <li key={row.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{row.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {row.owner ?? "no owner"} · {row.hostingEnvironment ?? "no hosting environment"}
                          </p>
                        </div>
                        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Edit (creates a new version)</summary>
                        <form action={createSystemVersionAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                          <input type="hidden" name="organisationId" value={organisationId} />
                          <input type="hidden" name="systemId" value={row.id} />
                          <input name="name" defaultValue={row.name} required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                          <input name="owner" defaultValue={row.owner ?? ""} className={INPUT_CLASS} placeholder="Owner" />
                          <input name="hostingEnvironment" defaultValue={row.hostingEnvironment ?? ""} className={INPUT_CLASS} placeholder="Hosting environment" />
                          <Button type="submit" size="sm">Save new version</Button>
                        </form>
                        {row.status === "active" ? (
                          <form action={retireSystemAction} className="mt-2">
                            <input type="hidden" name="organisationId" value={organisationId} />
                            <input type="hidden" name="systemId" value={row.id} />
                            <Button type="submit" size="sm" variant="destructive">Retire</Button>
                          </form>
                        ) : null}
                      </details>
                    </li>
                  ))
                )}
              </ul>
              <form action={createSystemAction} className="mt-6 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-4">
                <input type="hidden" name="organisationId" value={organisationId} />
                <p className="sm:col-span-4 text-xs font-medium text-slate-700">Add system</p>
                <input name="name" required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                <input name="owner" className={INPUT_CLASS} placeholder="Owner" />
                <input name="hostingEnvironment" className={INPUT_CLASS} placeholder="Hosting environment" />
                <Button type="submit" size="sm">Add</Button>
              </form>
            </>
          );
        }

        case "data-stores": {
          const [items, sysList] = await Promise.all([
            masterData.listDataStores(db, user.id, organisationId),
            masterData.listSystems(db, user.id, organisationId),
          ]);
          return (
            <>
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {items.length === 0 ? (
                  <li className="px-6 py-8 text-center text-sm text-slate-500">No data stores yet.</li>
                ) : (
                  items.map((row) => (
                    <li key={row.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{row.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {row.storageType ?? "no storage type"} · {row.location ?? "no location"}
                            {row.systemName ? ` · ${row.systemName}` : ""}
                          </p>
                        </div>
                        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Edit (creates a new version)</summary>
                        <form action={createDataStoreVersionAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-5">
                          <input type="hidden" name="organisationId" value={organisationId} />
                          <input type="hidden" name="dataStoreId" value={row.id} />
                          <input name="name" defaultValue={row.name} required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                          <input name="storageType" defaultValue={row.storageType ?? ""} className={INPUT_CLASS} placeholder="Storage type" />
                          <input name="location" defaultValue={row.location ?? ""} className={INPUT_CLASS} placeholder="Location" />
                          <select name="systemId" defaultValue="" className={INPUT_CLASS}>
                            <option value="">Keep current system</option>
                            {sysList.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          <Button type="submit" size="sm">Save new version</Button>
                        </form>
                        {row.status === "active" ? (
                          <form action={retireDataStoreAction} className="mt-2">
                            <input type="hidden" name="organisationId" value={organisationId} />
                            <input type="hidden" name="dataStoreId" value={row.id} />
                            <Button type="submit" size="sm" variant="destructive">Retire</Button>
                          </form>
                        ) : null}
                      </details>
                    </li>
                  ))
                )}
              </ul>
              <form action={createDataStoreAction} className="mt-6 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-5">
                <input type="hidden" name="organisationId" value={organisationId} />
                <p className="sm:col-span-5 text-xs font-medium text-slate-700">Add data store</p>
                <input name="name" required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                <input name="storageType" className={INPUT_CLASS} placeholder="Storage type" />
                <input name="location" className={INPUT_CLASS} placeholder="Location" />
                <select name="systemId" defaultValue="" className={INPUT_CLASS}>
                  <option value="">No system</option>
                  {sysList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <Button type="submit" size="sm">Add</Button>
              </form>
            </>
          );
        }

        case "processors": {
          const items = await masterData.listProcessors(db, user.id, organisationId);
          return (
            <>
              <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {items.length === 0 ? (
                  <li className="px-6 py-8 text-center text-sm text-slate-500">No processors yet.</li>
                ) : (
                  items.map((row) => (
                    <li key={row.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{row.name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {row.dpaVersionLabel ? `DPA ${row.dpaVersionLabel}` : "no DPA on file"}
                            {row.riskTier ? ` · risk tier: ${row.riskTier}` : ""}
                            {row.parentProcessorId ? ` · subprocessor of ${items.find((x) => x.id === row.parentProcessorId)?.name ?? row.parentProcessorId}` : ""}
                          </p>
                        </div>
                        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-slate-600">Edit (creates a new version)</summary>
                        <form action={createProcessorVersionAction} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                          <input type="hidden" name="organisationId" value={organisationId} />
                          <input type="hidden" name="processorId" value={row.id} />
                          <input name="name" defaultValue={row.name} required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                          <input name="dpaVersionLabel" defaultValue={row.dpaVersionLabel ?? ""} className={INPUT_CLASS} placeholder="DPA version label" />
                          <input name="riskTier" defaultValue={row.riskTier ?? ""} className={INPUT_CLASS} placeholder="Risk tier" />
                          <Button type="submit" size="sm">Save new version</Button>
                        </form>
                        {row.status === "active" ? (
                          <form action={retireProcessorAction} className="mt-2">
                            <input type="hidden" name="organisationId" value={organisationId} />
                            <input type="hidden" name="processorId" value={row.id} />
                            <Button type="submit" size="sm" variant="destructive">Retire</Button>
                          </form>
                        ) : null}
                      </details>
                    </li>
                  ))
                )}
              </ul>
              <form action={createProcessorAction} className="mt-6 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-4">
                <input type="hidden" name="organisationId" value={organisationId} />
                <p className="sm:col-span-4 text-xs font-medium text-slate-700">Add processor</p>
                <input name="name" required maxLength={200} className={INPUT_CLASS} placeholder="Name" />
                <input name="dpaVersionLabel" className={INPUT_CLASS} placeholder="DPA version label" />
                <input name="riskTier" className={INPUT_CLASS} placeholder="Risk tier" />
                <select name="parentProcessorId" defaultValue="" className={INPUT_CLASS}>
                  <option value="">No parent processor</option>
                  {items.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <Button type="submit" size="sm">Add</Button>
              </form>
            </>
          );
        }
      }
    });
  } catch (err) {
    if (err instanceof NotFoundOrForbiddenError) notFound();
    throw err;
  }

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href={`/organisations/${organisationId}`} className="hover:underline">
          Organisation
        </Link>
        {" · "}Master Data
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">{CATEGORY_LABELS[category]}</h1>

      <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-200 pb-3 text-sm">
        {MASTER_DATA_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/organisations/${organisationId}/master-data/${c}`}
            className={c === category ? "font-medium text-slate-900 underline" : "text-slate-500 hover:text-slate-900"}
          >
            {CATEGORY_LABELS[c]}
          </Link>
        ))}
      </nav>

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

      <div className="mt-6">{content}</div>
    </div>
  );
}
