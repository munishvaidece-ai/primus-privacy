import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { listRegulatoryReferences, listRequirements } from "@/lib/domain/control-library";
import { getUserTenantId, canManageMethodology, NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createRegulatoryReferenceAction, createRequirementAction } from "./actions";

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

/**
 * Regulatory References and Requirements (instructions §1) — unlike the
 * Control Library Version's draft/published/retired lifecycle, these
 * are always editable while `active` (DECISIONS.md R-44) — no
 * publish step, just plain create forms.
 */
export default async function RegulatoryContentPage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const { references, requirementRows, canManage } = await withRequestDb(user.id, async (db) => {
    try {
      const refs = await listRegulatoryReferences(db, user.id);
      const reqs = await listRequirements(db, user.id);
      const tenantId = await getUserTenantId(db, user.id);
      const manage = tenantId ? await canManageMethodology(db, user.id, tenantId) : false;
      return { references: refs, requirementRows: reqs, canManage: manage };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  return (
    <div>
      <p className="text-sm text-slate-500">
        <Link href="/methodology" className="hover:underline">
          Methodology
        </Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">Regulatory Content</h1>
      <p className="mt-1 text-sm text-slate-600">
        Regulatory references and requirements — shared, tenant-wide reference content Controls
        associate with across every control library version.
      </p>

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

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Regulatory References ({references.length})
        </h2>
        {references.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {references.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{r.title}</p>
                  <p className="text-xs text-slate-500">{r.frameworkName}</p>
                </div>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <form action={createRegulatoryReferenceAction} className="mt-4 space-y-2 rounded-md border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-700">Add regulatory reference</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="frameworkName" className="block text-xs font-medium text-slate-700">
                  Framework name
                </label>
                <input id="frameworkName" name="frameworkName" type="text" required maxLength={300} className={INPUT_CLASS} />
              </div>
              <div>
                <label htmlFor="citation" className="block text-xs font-medium text-slate-700">
                  Citation
                </label>
                <input id="citation" name="citation" type="text" required maxLength={300} className={INPUT_CLASS} />
              </div>
              <div>
                <label htmlFor="title" className="block text-xs font-medium text-slate-700">
                  Title
                </label>
                <input id="title" name="title" type="text" required maxLength={500} className={INPUT_CLASS} />
              </div>
              <div>
                <label htmlFor="version" className="block text-xs font-medium text-slate-700">
                  Version <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <input id="version" name="version" type="text" maxLength={100} className={INPUT_CLASS} />
              </div>
            </div>
            <Button type="submit" size="sm">
              Add Reference
            </Button>
          </form>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Requirements ({requirementRows.length})
        </h2>
        {requirementRows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {requirementRows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{r.title}</p>
                  <p className="text-xs text-slate-500">{r.regulatoryReferenceTitle}</p>
                </div>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          references.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Add a regulatory reference above before creating a requirement.</p>
          ) : (
            <form action={createRequirementAction} className="mt-4 space-y-2 rounded-md border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-700">Add requirement</p>
              <div>
                <label htmlFor="primaryRegulatoryReferenceId" className="block text-xs font-medium text-slate-700">
                  Regulatory reference
                </label>
                <select id="primaryRegulatoryReferenceId" name="primaryRegulatoryReferenceId" required defaultValue="" className={INPUT_CLASS}>
                  <option value="" disabled>
                    Select a reference
                  </option>
                  {references.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reqTitle" className="block text-xs font-medium text-slate-700">
                  Title
                </label>
                <input id="reqTitle" name="title" type="text" required maxLength={500} className={INPUT_CLASS} />
              </div>
              <div>
                <label htmlFor="description" className="block text-xs font-medium text-slate-700">
                  Description <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <textarea id="description" name="description" rows={3} maxLength={4000} className={INPUT_CLASS} />
              </div>
              <Button type="submit" size="sm">
                Add Requirement
              </Button>
            </form>
          )
        ) : null}
      </section>
    </div>
  );
}
