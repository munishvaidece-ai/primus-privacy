import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { withRequestDb } from "@/lib/db/request-client";
import { getControlDetail, listRequirements } from "@/lib/domain/control-library";
import { canManageMethodology, NotFoundOrForbiddenError } from "@/lib/authorization/service";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateControlAction, deleteControlAction, associateRequirementAction, dissociateRequirementAction } from "./actions";

const CONTROL_TYPES: Array<{ value: string; label: string }> = [
  { value: "preventive", label: "Preventive" },
  { value: "detective", label: "Detective" },
  { value: "corrective", label: "Corrective" },
];

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

export default async function ControlDetailPage({
  params,
  searchParams,
}: {
  params: { versionId: string; controlId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const user = await requireAuthenticatedUser();

  const { control, canManage, requirementOptions } = await withRequestDb(user.id, async (db) => {
    try {
      const detail = await getControlDetail(db, user.id, params.controlId);
      const manage = await canManageMethodology(db, user.id, detail.tenantId);
      const options = await listRequirements(db, user.id);
      return { control: detail, canManage: manage, requirementOptions: options };
    } catch (err) {
      if (err instanceof NotFoundOrForbiddenError) notFound();
      throw err;
    }
  });

  if (control.controlLibraryVersionId !== params.versionId) notFound();

  const isDraft = control.versionStatus === "draft";
  const versionPath = `/methodology/control-library/${control.controlLibraryVersionId}`;
  const associatedIds = new Set(control.requirements.map((r) => r.id));
  const availableRequirements = requirementOptions.filter((r) => !associatedIds.has(r.id));

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-slate-500">
        <Link href={versionPath} className="hover:underline">
          {control.versionLabel}
        </Link>
      </p>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          {control.code} — {control.title}
        </h1>
        <Badge tone={statusTone(control.versionStatus)}>{control.versionStatus}</Badge>
      </div>

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

      {!isDraft ? (
        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          This control belongs to a {control.versionStatus} version and is immutable.
        </p>
      ) : null}

      {canManage && isDraft ? (
        <form action={updateControlAction} className="mt-6 space-y-4">
          <input type="hidden" name="controlLibraryVersionId" value={control.controlLibraryVersionId} />
          <input type="hidden" name="controlId" value={control.id} />

          <div>
            <label htmlFor="code" className="block text-sm font-medium text-slate-700">
              Code
            </label>
            <input id="code" name="code" type="text" required maxLength={50} defaultValue={control.code} className={INPUT_CLASS} />
          </div>
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-slate-700">
              Title
            </label>
            <input id="title" name="title" type="text" required maxLength={300} defaultValue={control.title} className={INPUT_CLASS} />
          </div>
          <div>
            <label htmlFor="controlType" className="block text-sm font-medium text-slate-700">
              Type
            </label>
            <select id="controlType" name="controlType" required defaultValue={control.controlType} className={INPUT_CLASS}>
              {CONTROL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-slate-700">
              Description
            </label>
            <textarea id="description" name="description" rows={4} maxLength={4000} defaultValue={control.description ?? ""} className={INPUT_CLASS} />
          </div>

          <Button type="submit" size="sm">
            Save Control
          </Button>
        </form>
      ) : (
        <dl className="mt-6 space-y-2 text-sm">
          <div>
            <dt className="font-medium text-slate-700">Type</dt>
            <dd className="text-slate-600">{control.controlType}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-700">Description</dt>
            <dd className="text-slate-600">{control.description ?? "—"}</dd>
          </div>
        </dl>
      )}

      {canManage && isDraft ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-red-700">Delete this control…</summary>
          <form action={deleteControlAction} className="mt-2">
            <input type="hidden" name="controlLibraryVersionId" value={control.controlLibraryVersionId} />
            <input type="hidden" name="controlId" value={control.id} />
            <p className="mb-2 text-sm text-slate-600">This permanently removes the control from this draft version.</p>
            <Button type="submit" size="sm" variant="destructive">
              Delete Control
            </Button>
          </form>
        </details>
      ) : null}

      <section className="mt-8 border-t border-slate-100 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Requirement Associations</h2>

        {control.requirements.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Not associated with any requirement yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {control.requirements.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="text-sm text-slate-900">{r.title}</span>
                {canManage && isDraft ? (
                  <form action={dissociateRequirementAction}>
                    <input type="hidden" name="controlLibraryVersionId" value={control.controlLibraryVersionId} />
                    <input type="hidden" name="controlId" value={control.id} />
                    <input type="hidden" name="requirementId" value={r.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      Remove
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManage && isDraft ? (
          availableRequirements.length > 0 ? (
            <form action={associateRequirementAction} className="mt-4 flex items-end gap-3">
              <input type="hidden" name="controlLibraryVersionId" value={control.controlLibraryVersionId} />
              <input type="hidden" name="controlId" value={control.id} />
              <div className="flex-1">
                <label htmlFor="requirementId" className="block text-xs font-medium text-slate-700">
                  Associate requirement
                </label>
                <select id="requirementId" name="requirementId" required defaultValue="" className={INPUT_CLASS}>
                  <option value="" disabled>
                    Select a requirement
                  </option>
                  {availableRequirements.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} ({r.regulatoryReferenceTitle})
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm">
                Associate
              </Button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              No more requirements to associate.{" "}
              <Link href="/methodology/regulatory-content" className="font-medium text-slate-900 underline">
                Create one
              </Link>
              .
            </p>
          )
        ) : null}
      </section>
    </div>
  );
}
